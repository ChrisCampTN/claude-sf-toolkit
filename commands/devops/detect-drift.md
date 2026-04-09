---
name: detect-drift
description: Compare org metadata against local git source to find components modified outside DevOps Center
---

# /detect-drift — Detect Org Metadata Drift

Compare metadata in a Salesforce org against local git source to find components modified directly in the org (outside the DevOps Center pipeline). Produces a drift report and offers targeted retrieval.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- Empty — scan flows in production (most common: hotfixes go in outside DevOps Center)
- `flows` — scan flows only (default if no type specified)
- `objects` — scan custom objects and fields
- `all` — scan all supported metadata types
- `--target-org {alias}` — override target org (default: `{context.orgs.productionAlias}`)
- `--since {date}` — only flag drift after this date (ISO format: 2026-03-01). Default: 30 days
- `--since {n}d` — shorthand: `7d`, `30d`, `90d` for relative days
- Combinable: `flows --target-org {alias} --since 7d`

Examples:

```
/detect-drift
/detect-drift flows
/detect-drift objects --since 14d
/detect-drift all --target-org {dev-sandbox-alias}
/detect-drift flows --since 2026-03-01
```

---

## Resolution

**Cache-first resolution:**

1. Read `.claude/sf-toolkit-cache.json` in the project root.
2. If the file exists and `_cache.expiresAt` is after the current date/time, **and** no `--target-org` override was provided:
   - Read `.sf/config.json` — confirm `target-org` matches `orgs.devAlias` in the cached context.
   - If it matches: use the cached context (all keys except `_cache`). **Skip the agent dispatch.**
3. If the cache is missing, expired, or the org alias doesn't match: dispatch the `sf-toolkit-resolve` agent. It will resolve fresh context and update the cache.

Use the returned context for all org references, team lookups, and path resolution in subsequent steps. If `missing` contains values this skill requires, stop and instruct the developer to run `/setup`.

---

## Supported Metadata Types

| Type Argument | Org Query Target                                | What It Detects                                |
| ------------- | ----------------------------------------------- | ---------------------------------------------- |
| `flows`       | `FlowDefinitionView`                            | Flows activated/modified in org but not in git |
| `objects`     | `CustomObject` + `CustomField` via Metadata API | Custom fields added/modified in org            |

> **Extensibility:** New types can be added by defining a query strategy and a local-source mapping function. The pattern is: query org for metadata + LastModifiedDate → map to local file path → compare dates.

---

## Step 0 — Preflight

### Parse Arguments

1. **Metadata type:** Default to `flows` if not specified.
2. **Target org:** Default to `{context.orgs.productionAlias}`. Parse `--target-org` if provided.
3. **Since date:** Default to 30 days ago. Parse `--since` if provided — convert relative (`7d`) to absolute date.

### Org Connectivity

Invoke `/skill-preflight detect-drift` to verify the target org is reachable. If unreachable, stop — cannot detect drift without org access.

### Safety Gate (Tier 1 — Read-only)

If target org is Production, display:

```text
Note: This is a READ-ONLY operation. No changes will be made to the org.
Querying {target-org} for metadata last-modified dates...
```

---

## Step 1 — Query Org Metadata Dates

### For `flows`:

Query `FlowDefinitionView` for all active **unmanaged** flows with their last-modified dates:

```sql
SELECT DurableId, DeveloperName, ActiveVersionId, LatestVersionId,
       LastModifiedDate, LastModifiedBy, Description,
       ManageableState, NamespacePrefix, InstalledPackageName
FROM FlowDefinitionView
WHERE IsActive = true
  AND ManageableState = 'unmanaged'
ORDER BY LastModifiedDate DESC
```

Use the Salesforce DX MCP `run_soql_query` tool or:

```bash
sf data query --query "SELECT DurableId, DeveloperName, ActiveVersionId, LatestVersionId, LastModifiedDate, LastModifiedBy, Description, ManageableState, NamespacePrefix, InstalledPackageName FROM FlowDefinitionView WHERE IsActive = true AND ManageableState = 'unmanaged' ORDER BY LastModifiedDate DESC" --target-org {target-org} --json
```

> **Important:** `FlowDefinitionView` returns the definition-level LastModifiedDate (when any version was last activated/modified). This is the right comparison point — it tells us when the flow was last touched in the org, regardless of version.
>
> **Managed package filter:** The `ManageableState = 'unmanaged'` clause excludes flows installed by managed packages. These are not source-controlled and would otherwise appear as false-positive "ORG-ONLY" drift. The `FlowDefinitionView` object exposes `ManageableState` (picklist: unmanaged/installed/released/beta/etc.), `NamespacePrefix`, and `InstalledPackageName` — use these fields rather than filename heuristics when querying the org directly.

### For `objects`:

Use `sf mdapi listmetadata` for custom objects:

```bash
sf mdapi listmetadata --metadata-type CustomObject --target-org {target-org} --json
```

For custom fields on standard objects, query:

```sql
SELECT DeveloperName, TableEnumOrId, LastModifiedDate, LastModifiedBy.Name
FROM CustomField
WHERE LastModifiedDate > {since-date}
ORDER BY LastModifiedDate DESC
```

> **Note:** Tooling API is needed for `CustomField` queries. Use `sf api request rest` if the MCP server doesn't support Tooling API directly:
>
> ```bash
> sf api request rest "/services/data/v{context.apiVersion}/tooling/query?q=SELECT+DeveloperName,TableEnumOrId,LastModifiedDate,LastModifiedBy.Name+FROM+CustomFieldDefinition+WHERE+LastModifiedDate>{since-date-iso}+ORDER+BY+LastModifiedDate+DESC" --target-org {target-org} --json
> ```

---

## Step 2 — Map & Compare via Script

Save the org query JSON from Step 1 to a temp file, then run the drift-compare script to handle org-to-local mapping, date comparison, and candidate classification.

### Locate the Script

Check for a local project script first:

```bash
ls scripts/drift-compare.js 2>/dev/null
```

If not found, fall back to the plugin's bundled version:

```bash
node "${CLAUDE_PLUGIN_ROOT}/script-templates/drift-compare.js" --input /tmp/drift-org-query.json --type {flows|objects} --since {since_date} --json
```

If found locally, use the local version:

```bash
node scripts/drift-compare.js --input /tmp/drift-org-query.json --type {flows|objects} --since {since_date} --json
```

The script handles:

- Mapping each org `DeveloperName` to its local file path (`{context.metadataPath}/flows/{name}.flow-meta.xml` or `objects/{name}/`)
- Looking up each local file's last git commit date (`git log -1 --format="%aI"`)
- Comparing org vs git dates and classifying each component:
  - **CANDIDATE** — org date is newer than git date (proceed to Step 3b content diff)
  - **IN_SYNC** — local source is current or newer
  - **ORG_ONLY** — exists in org but not in local source
  - **LOCAL_ONLY** — exists locally but not active in org
- Applying the `--since` filter to exclude old acknowledged drift

Use `--json` output for programmatic consumption in Step 3b. Use without `--json` for the table display in Step 4.

Report candidate count before proceeding: "Found {n} candidates with newer org dates. Retrieving for content comparison..."

> **Note:** The script performs the deterministic date comparison. Step 3b (content diff) still requires retrieve + `git diff` which Claude handles directly.

---

## Step 3b — Content Diff (False Positive Elimination)

Date differences alone are unreliable. A component's `LastModifiedDate` updates when:

- Someone opens it in Setup/Flow Builder and saves without changes
- A deploy lands (the source is already current but the org date moves forward)
- Metadata API reformats XML (whitespace, element ordering)

For each candidate from Step 2, retrieve the org version and diff against local source.

### Retrieve to Temp Directory

Retrieve candidates to a temporary directory (not the working tree) to avoid overwriting local files prematurely:

```bash
sf project retrieve start --target-org {target-org} --metadata "Flow:{FlowName}" --output-dir /tmp/drift-check --json
```

If `--output-dir` is not supported by the retrieve command, use a workaround:

1. Copy the local file to a `.bak` temp location
2. Retrieve in-place
3. Diff the retrieved version against the `.bak`
4. Restore the `.bak` to the working tree

### Normalize and Diff

XML retrieved from the org may have cosmetic differences (attribute ordering, whitespace, line endings). Before diffing:

1. **Ignore XML declaration differences** — `<?xml version="1.0" encoding="UTF-8"?>` variations
2. **Ignore trailing whitespace and line-ending differences** (CRLF vs LF)
3. **Compare semantic content** — use `git diff --no-index --ignore-all-space` between the local and retrieved files as a reasonable approximation

```bash
git diff --no-index --ignore-all-space --stat "{context.metadataPath}/flows/{FlowName}.flow-meta.xml" "/tmp/drift-check/{context.metadataPath}/flows/{FlowName}.flow-meta.xml"
```

### Drift Classification

| Diff Result                                                    | Classification | Meaning                                                       |
| -------------------------------------------------------------- | -------------- | ------------------------------------------------------------- |
| Content differs (non-whitespace changes)                       | **DRIFTED**    | Real logic/config change in the org                           |
| No meaningful diff (whitespace/formatting only)                | **IN SYNC**    | Save-without-change or deploy timestamp bump — false positive |
| Retrieve failed (component exists in query but can't retrieve) | **WARN**       | Flag for manual review                                        |

### Cleanup

Remove the temp directory after all comparisons are complete.

> **Performance note:** Retrieving individual components is slower than a single SOQL query, but the candidate list is typically small (date filter + since window narrows it). For large candidate lists (>20), batch the retrieve into groups of 10 metadata flags per command.

---

## Step 4 — Present Drift Report

### Summary Header

```
## /detect-drift Report

Target org: {alias}
Metadata type: {type(s)}
Since: {date}
Scanned: {timestamp}

### Summary
- Components scanned: {n}
- Date candidates: {n} (org date newer than git date)
- Confirmed drifted: {n} (content differs after retrieve + diff)
- False positives filtered: {n} (date-only — no content change)
- Org-only: {n}
- Local-only: {n}
```

### Confirmed Drift Table

Only components where the content diff confirmed real changes:

```
### Confirmed Drifted Components

| # | Component | Type | Org Modified | Org Modified By | Git Date | Gap | Diff Summary |
|---|---|---|---|---|---|---|---|
| 1 | BatchFlowXyz | Flow | 2026-03-18 14:30 | Jane Admin | 2026-02-01 | 45 days | +12 -3 lines |
| 2 | SomeOtherFlow | Flow | 2026-03-15 09:12 | John Dev | 2026-01-15 | 59 days | +45 -20 lines |
```

### False Positives Filtered (informational)

Show candidates that were eliminated by the content diff — helps build trust in the process:

```
### Date-Only Candidates (no content change)

| Component | Type | Org Modified | Org Modified By | Reason |
|---|---|---|---|---|
| NoChangeFlow | Flow | 2026-03-17 | Jane Admin | Whitespace/formatting only |
| RedeployedFlow | Flow | 2026-03-10 | CI User | Identical content (re-deploy) |
```

### Org-Only Components

```
### Org-Only (not in source control)

| # | Component | Type | Org Modified | Org Modified By |
|---|---|---|---|---|
| 1 | QuickFix_Flow | Flow | 2026-03-19 | Jane Admin |
```

### Local-Only Components (informational)

```
### Local-Only (in source, not active in org)

| # | Component | Type | Git Date | Notes |
|---|---|---|---|---|
| 1 | Deprecated_Flow | Flow | 2025-12-01 | May have been deactivated in org |
```

### No Drift Found

If no content differences after the two-pass check:

```
### No Drift Detected

All {n} {type} components in {target-org} match local source.
Date candidates checked: {n} (all resolved as false positives — no content differences)
Last org modification: {date} by {user} on {component}
```

---

## Step 5 — Retrieval Actions

If confirmed-drifted or org-only components were found, offer to retrieve them into the working tree.

> **Note:** Step 3b already retrieved candidates to a temp directory for diffing. This step retrieves into the actual working tree so the changes appear in `git diff`.

```
### Recommended Actions

{n} component(s) have confirmed content drift from source control.

**Option A — Retrieve all drifted components** (recommended):
Overwrites local files with the org version. You already saw the diff summaries above.

**Option B — Retrieve specific components:**
Tell me which component numbers to retrieve (e.g., "1, 3, 5").

**Option C — Skip retrieval:**
Use this report as a reference and retrieve manually later.

Which option? (A/B/C)
```

### Execute Retrieval (if user chooses A or B)

For flows:

```bash
sf project retrieve start --target-org {target-org} --metadata "Flow:{FlowName1}" --metadata "Flow:{FlowName2}"
```

For objects/fields:

```bash
sf project retrieve start --target-org {target-org} --metadata "CustomField:{Object}.{FieldName}" --metadata "CustomObject:{ObjectName}"
```

After retrieval:

1. Run `git diff` on the retrieved files to show the full diff (not just the stat summary from Step 3b)
2. Report the diff summary (files changed, insertions, deletions)
3. Suggest next steps:

```
## Retrieval Complete

Retrieved {n} components from {target-org}.

### Changes detected:
- {FlowName}.flow-meta.xml: {+n lines, -m lines}
- ...

### Next Steps:
1. Review the changes: git diff {context.metadataPath}/flows/
2. Stage and commit: git add {files} && git commit -m "Retrieve org drift: {summary}"
3. Deploy to dev sandbox: /deploy-changed
4. Associate with work item: /devops-commit WI-NNNNNN
```

### Org-Only Component Retrieval

For ORG-ONLY components (exist in org, not in source), retrieval creates a new local file rather than overwriting an existing one:

1. **Retrieve to local:** Same `sf project retrieve start` command — SF CLI creates the local file.
2. **Warn about untracked dependencies:** An org-only flow may reference objects, fields, or other flows that also aren't in source. Flag this risk.
3. **Suggest review before committing:** These are net-new files that need to be reviewed for whether they belong in this repo.

Display for each org-only component:

```text
Warning: Org-only component "{name}" will be retrieved as a new file.
It may reference components not yet in source control.
Review before committing to ensure all dependencies are tracked.
```

---

## Safety Rails

- **Read-only by default.** Steps 0–4 are pure read operations. No writes to the org or local filesystem.
- **Retrieval requires explicit user opt-in** (Step 5). Never auto-retrieve.
- **Production is safe to query.** Read-only API calls may target production for configuration verification.
- **Never deploy during drift detection.** This skill detects and retrieves — deploying is a separate action via `/deploy-changed`.
- **Git diff before commit.** Always show the diff after retrieval so the user knows exactly what changed.
- **Respect the since window.** Old drift is often intentional (e.g., a flow was hotfixed and the source was never updated). The since filter prevents noise.

---

## Error Handling

### Query Failures

If the SOQL query fails (permissions, API limits, etc.):

- Report the specific error
- Suggest alternative: `sf mdapi listmetadata --metadata-type Flow --target-org {target-org} --json` as a fallback for flows
- For Tooling API failures on fields, suggest the standard Metadata API approach

### Large Result Sets

If the org returns >500 components for a type:

- Process in batches
- Show progress: "Processing flows 1-200 of 487..."
- Apply the since filter server-side (in the SOQL WHERE clause) to reduce result size

### Source Tracking Available

If the target org is a sandbox with source tracking enabled, note that `sf project retrieve preview` would be more accurate and suggest it as an alternative:

```
Note: {target-org} appears to be a source-tracked sandbox.
For source-tracked orgs, `sf project retrieve preview` provides exact change detection.
Run it? (Y/N)
```
