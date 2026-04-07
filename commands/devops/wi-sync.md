---
name: wi-sync
description: Sync DevOps Center WI status against MEMORY.md
---

# /wi-sync — Work Item Status Sync

Query live DevOps Center work item status from production and reconcile against MEMORY.md. Flags stale rows, updates status where safe to do so automatically, and surfaces discrepancies for human review.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- Empty — full sync (query all WIs, update MEMORY.md)
- `--dry-run` — show diff only, do not write to MEMORY.md
- `--wi {WI-NNNNNN,...}` — sync specific WIs only (comma-separated)

Examples:

```
/wi-sync
/wi-sync --dry-run
/wi-sync --wi WI-000044,WI-000051
/wi-sync --dry-run --wi WI-000074
```

## Resolution

Dispatch the `sf-toolkit-resolve` agent. Use the returned context for all
org references, team lookups, and path resolution in subsequent steps.
If `missing` contains values this skill requires, stop and instruct the
developer to run `/setup`.

**Required context values:**
- `{context.orgs.productionAlias}` — production org for read-only SOQL queries
- `{context.devopsCenter.projectId}` — DevOps Center project ID for WI query filter
- `{context.devopsCenter.environments}` — environment name→ID map for status derivation

---

## Argument Resolution

Parse `$ARGUMENTS` once before entering any step:

- `dryRun` = true if `--dry-run` is present
- `wiFilter` = list of WI numbers parsed from `--wi {value}` (empty = all)

---

## Step 1 — Query Live WI Status

This is a **read-only** operation against production. Queries the **native DevOps Center** (`WorkItem` standard object).

Build SOQL:

```sql
SELECT Name, Subject, Status, DevelopmentEnvironmentId, DevopsPipelineStageId,
       AssignedToId, LastModifiedDate
FROM WorkItem
WHERE DevopsProjectId = '{context.devopsCenter.projectId}'
ORDER BY Name ASC
```

If `wiFilter` is non-empty, append: `AND Name IN ('WI-NNNNNN', ...)`.

Use `mcp__Salesforce-DX__run_soql_query` with `usernameOrAlias` set to `{context.orgs.productionAlias}` and `directory` set to the repo root.

**Derive a canonical `LiveStatus` for each WI:**

Resolve environment and pipeline stage IDs from `{context.devopsCenter.environments}`. The environments map returns name→ID pairs. Use the environment named for the dev sandbox to match `DevelopmentEnvironmentId`, and the pipeline stage entries to identify Production and Staging stages.

| Condition                                                                  | LiveStatus               |
| -------------------------------------------------------------------------- | ------------------------ |
| `Status = 'COMPLETED'` or `DevopsPipelineStageId` is the Production stage | `Done`                   |
| `Status = 'IN_PROGRESS'` AND `DevelopmentEnvironmentId` is set            | `In Progress (Dev)` |
| `Status = 'NEW'` AND `DevelopmentEnvironmentId` is set                    | `In Progress (Dev)` |
| `Status = 'NEW'` AND `DevelopmentEnvironmentId` is null                   | `Not Started`            |

Also capture `AssignedToId` (null = unassigned) for display only. To resolve the name, query `SELECT Name FROM User WHERE Id = '{AssignedToId}'` if needed.

---

## Step 2 — Read MEMORY.md WI Tables

Read `.claude/memory/MEMORY.md` and locate the **Active Work Items** table under `## Active Work Items`.

Parse each row: extract the WI (native) number (column 1), WI (legacy) number (column 2), Name (column 3), Backlog reference (column 4), and current Status (column 5).

The table uses native WI numbers (WI-000001+) with a legacy column for cross-reference. Match against the native WI number from the SOQL query.

---

## Step 3 — Diff

For each WI found in MEMORY.md, look up its `LiveStatus` from Step 1.

**Skip rows** where the memory status contains any of the following — these require human review and must not be auto-updated:

- `Orphaned`
- `Retired`
- `Done/Verify`
- `Partial`
- `Blocked`

**Classify each WI:**

| Classification | Condition                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------- |
| `No change`    | Memory status already reflects LiveStatus (see matching rules below)                         |
| `Update`       | LiveStatus is unambiguously better/newer than memory status, and row is not in the skip list |
| `Discrepancy`  | Memory says Done but live says Not Started — flag for human review, do not auto-update       |
| `New`          | WI exists in DevOps Center but has no row in either MEMORY.md table                          |

**Status matching rules** (memory → live equivalence):

- Memory `Done`, `Done (Promoted...)`, or `**Done**` ↔ LiveStatus `Done`
- Memory `Not Started` ↔ LiveStatus `Not Started`
- Memory `In Progress`, `In Dev`, or `In Progress (Dev)` ↔ LiveStatus `In Progress (Dev)` or similar
- Anything else is an `Update` or `Discrepancy`

---

## Step 4 — Report

Output a sync summary table regardless of `--dry-run`:

```text
### WI Sync | {context.orgs.productionAlias} | {date} {time}

#### Metadata Deploy WIs
| WI | Subject | Live | Memory | Action |
|---|---|---|---|---|
| WI-000050 | Field History Tracking (Initial Setup) | Done | Done | No change |
| WI-000051 | ... | In Progress (Dev) | Not Started | Update |
...

#### Manual Config WIs
| WI | Subject | Live | Memory | Action |
|---|---|---|---|---|
...

Summary: {n} updated, {n} discrepancies flagged, {n} new WIs found, {n} skipped (manual review)
```

If `--dry-run`, stop here and report:

```text
[DRY RUN] No changes written to MEMORY.md.
```

---

## Step 5 — Update MEMORY.md

> **Skip this step entirely if `--dry-run` is set.**

For each WI classified as `Update`:

- Locate the exact row in MEMORY.md
- Replace only the Status cell with the new LiveStatus
- Preserve the WI number, description/name column, and row formatting exactly

For WIs classified as `Discrepancy` or `New`:

- Do **not** auto-update the row
- Add a blockquote note directly below the relevant table:
  ```
  > **Sync note ({date}):** {WI} — {issue}. Verify manually.
  ```

After all edits, update the last-synced timestamp line at the bottom of the WI section. Add it if not present:

```
> Last synced from {context.orgs.productionAlias}: {date}
```

Report the final count: `Sync complete — {n} rows updated, {n} flagged for review.`

---

## Step 6 — Backlog Auto-Sync

If `docs/backlog/backlog.yaml` exists, sync backlog item statuses from DevOps Center query results.

**WI number mapping:** The backlog.yaml may reference **legacy WI numbers** from a previous DevOps Center configuration. The native DevOps Center may have restarted numbering. Use the `Subject` field to match legacy WI references to native WIs (subjects are typically preserved during migration). Check `.claude/memory/` for any reference files documenting the WI number mapping.

1. Read `docs/backlog/backlog.yaml`
2. For each item with non-empty `devops_wis`:
   a. Look up each WI's live status from the DevOps Center query results (already fetched in Step 1). Match by native WI name first; if not found, match by subject text against legacy WI references.
   b. Apply multi-WI rollup rules:
   - If ANY WI is in progress → backlog status should be `In Progress`
   - If ALL WIs are promoted/closed → backlog status should be `Done`
   - If all WIs are NEW → backlog status stays as-is (Ready/Prioritized)
     c. If the derived status differs from the current backlog item `status`:
   - Update `status` and `updated` date
   - Add a note: `date: {today}, author: "wi-sync", text: "Auto-synced from DevOps Center. {WI-NNNNNN}: {live status}."`
3. Write back to `docs/backlog/backlog.yaml` if any changes were made (skip if `--dry-run`)
4. Report:

```text
### Backlog Sync

**Updated:** {n} items
- BL-NNNN: {title} — {old status} → {new status} (WI-NNNNNN: {live status})

**No change:** {n} items with WIs — statuses match
**No WIs:** {n} items — not yet graduated, skipped
```

If `--dry-run`, report discrepancies but don't write changes.

### MEMORY.md Active Work Items Cleanup

After syncing the backlog, check the Active Work Items table in MEMORY.md. For any WI that is now promoted/closed in DevOps Center:

1. The backlog/archive already has the item — remove the row from the Active Work Items table
2. Add a note to the report: `"Removed WI-NNNNNN from Active Work Items (promoted/closed)"`

If the Active Work Items table becomes empty, keep the section header and blockquote but show an empty table.

---

## Behavior Notes

- **Read-only against the org.** No writes to Salesforce at any point.
- **Conservative auto-update.** Only update rows where the live state is unambiguously clearer than the memory state. When in doubt, classify as Discrepancy and let the user decide.
- **Idempotent.** Running twice in a row with no org changes produces zero updates.
- **MEMORY.md Active Work Items + backlog.yaml are targets.** Step 5 updates MEMORY.md Active Work Items table. Step 6 updates `docs/backlog/backlog.yaml` statuses and cleans up promoted/closed WI rows from MEMORY.md.
- **Called by `/start-day` and `/wrap-up`.** When invoked from those skills, `--dry-run` is the default so the user sees the diff without files being auto-modified mid-briefing.
