---
name: doc-flows
description: Generate technical documentation for Salesforce flows — individual docs, category indexes, XML descriptions
---

# /doc-flows — Salesforce Flow Technical Documentation

Generate technical documentation for Salesforce flows in the project repository.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- A category name from `docs/flows/flow-categories.json`
- A specific flow name (without `.flow-meta.xml`): e.g. `My_Flow_Name`
- `all` — document every eligible active flow (confirm with user before starting)
- Empty — check `docs/flows/.pending-docs.txt` for flows queued by the post-commit hook; if the file is empty or missing, ask the user which flows or category to document
- `--target-org {alias}` — override the org for freshness queries (defaults to `{context.orgs.productionAlias}`)
- `--update-xml` — force XML `<description>` updates (catchup scenarios only)

---

## Resolution

**Cache-first resolution:**

1. Read `.claude/sf-toolkit-cache.json` in the project root.
2. If the file exists and `_cache.expiresAt` is after the current date/time, **and** no `--target-org` override was provided:
   - Read `.sf/config.json` — confirm `target-org` matches `orgs.devAlias` in the cached context.
   - If it matches: use the cached context (all keys except `_cache`). **Skip the agent dispatch.**
3. If the cache is missing, expired, or the org alias doesn't match: dispatch the `sf-toolkit-resolve` agent. It will resolve fresh context and update the cache.

Use the returned context for all org references, team lookups, and path resolution in subsequent steps. If `missing` contains values this skill requires, stop and instruct the developer to run `/setup`.

### Flow Categories

Read `docs/flows/flow-categories.json` for category definitions and flow-to-category mappings.

**If the file is empty `{}` or missing**, trigger interactive first-run categorization:

1. List all flow XML files from `{context.metadataPath}/flows/`.
2. Present them to the user grouped by naming prefix patterns (e.g., flows starting with `Batch_`, `API_`, `Screen_`, etc.).
3. Prompt the user to define categories and assign flows to each.
4. Save the result to `docs/flows/flow-categories.json` in this format:
   ```json
   {
     "categories": {
       "category_name": {
         "label": "Human-Readable Category Name",
         "description": "What flows in this category do",
         "patterns": ["regex_pattern_1", "regex_pattern_2"],
         "exact": ["Exact_Flow_Name_1", "Exact_Flow_Name_2"]
       }
     },
     "filters": {
       "skip": ["flow_names_to_always_skip"],
       "sunset": ["deprecated_flow_names"],
       "oneTime": ["one_time_migration_flows"],
       "tempTest": ["temporary_or_test_flows"],
       "unbuilt": ["flows_not_yet_built"]
     }
   }
   ```
5. Confirm categories with the user before saving, then continue with the documentation run.

---

### Script Resolution

This skill uses helper scripts. For each script reference, check `scripts/` locally first. If not found, copy from `${CLAUDE_PLUGIN_ROOT}/script-templates/` to `scripts/`.

| Script                        | Purpose                                        |
| ----------------------------- | ---------------------------------------------- |
| `flow-index.js`               | Filter, categorize, and extract flow metadata  |
| `flow-doc-generator.js`       | Bulk doc generation from flow XML              |
| `flow-changelog-detector.js`  | Detect changes since last documentation        |
| `flow-description-sync.js`    | Sync markdown Purpose to XML `<description>`   |

---

<!-- Phase A: Scoping (Steps 1-2b) — Determine what flows to process -->

## Step 1 — Determine Scope

Parse `$ARGUMENTS`:

1. If empty: read `docs/flows/.pending-docs.txt`. If it contains flow names, use that list. If empty/missing, ask the user what to document.
2. If a category name: use `node scripts/flow-index.js --category {name}` to get all flows in that category (already filtered).
3. If a specific flow name: locate `{context.metadataPath}/flows/{FlowName}.flow-meta.xml`.
4. If `all`: use `node scripts/flow-index.js --stats` to show totals, confirm with the user before proceeding.

---

## Step 2 — Filter Flows

Use `scripts/flow-index.js` for filtering and categorization instead of manual XML parsing:

```bash
node scripts/flow-index.js --category {name}
```

```bash
node scripts/flow-index.js
```

```bash
node scripts/flow-index.js --include-inactive
```

```bash
node scripts/flow-index.js --stats
```

The script applies all skip filters from `docs/flows/flow-categories.json` automatically: inactive, managed package, templates, sunset, one-time, temp/test, unbuilt. Each filtered flow includes a `filterReason` in the JSON output.

Report any skipped flows with the reason at the end of the run.

---

## Step 2b — Freshness Check (Skip Unchanged Flows)

For each flow that passed the Step 2 filters, determine whether it has been modified since the last time it was documented. A flow is **unchanged** if ALL of the following are true:

1. A documentation file already exists at `docs/flows/{category}/{FlowName}.md`.
2. That file contains a `**Last Documented:**` line with a valid date (e.g. `2026-03-19`).
3. The flow has **not** been modified in **either** git or the org since that date. Check both sources:

   **Source A — Git commit date:**

   ```bash
   git log -1 --format=%ai -- "{context.metadataPath}/flows/{FlowName}.flow-meta.xml"
   ```

   **Source B — Production org last-modified date (catches Flow Builder edits not yet pulled to source):**

   Query `FlowDefinitionView` in **`{context.orgs.productionAlias}`** (production is the source of truth for active flow versions — dev sandboxes may lag behind). Batch all flows in scope into a single query:

   ```soql
   SELECT DeveloperName, ActiveVersionId, LastModifiedDate
   FROM FlowDefinitionView
   WHERE DeveloperName IN ('FlowName1', 'FlowName2', ...)
   ```

   Use the **later** of Source A and Source B as the flow's effective last-modified date. If the effective date is on or before the `Last Documented` date, the flow is unchanged.

   **If the org query fails** (e.g. production not connected), fall back to git-only comparison and log a warning:
   `Warning: Could not query production org — freshness check used git dates only. Flows modified in Flow Builder may be missed.`

**Unchanged flows are skipped** — do not re-read, re-parse, or regenerate their documentation.

**Flows that ARE processed** (i.e. treated as "changed"):

- Effective last-modified date (git or org, whichever is later) is **after** the `Last Documented` date
- No existing documentation file (new flow — never documented)
- Existing doc file is missing the `Last Documented` field (treat as stale — re-document)
- The `$ARGUMENTS` explicitly names a specific flow (user override — always process regardless of freshness)

### Step 2b.3 — Handle Org-Stale Flows

When any flows are flagged as changed due to the **org date** being newer than git, the local XML is stale — documenting it would produce inaccurate output. Invoke `/detect-drift` for those specific flows:

```text
/detect-drift flows --since {Last Documented date of earliest flagged flow}
```

`/detect-drift` handles content-diff verification, false-positive elimination, and retrieval with user confirmation. After it completes:

- **Retrieved flows:** Proceed to document using the freshly retrieved XML.
- **IN SYNC (false positive):** Treat as unchanged, skip documentation.
- **Not retrieved (user skipped):** Skip documentation, log in Step 12: `Warning: {FlowName} — org version newer but not retrieved. Docs reflect stale local XML.`

Report skipped-as-unchanged flows in the Step 12 summary under a separate heading.

**Early exit:** If, after this freshness check, **zero flows** remain to be processed (all were unchanged), skip directly to Step 12 and report:

```text
## /doc-flows Complete — No Updates Needed

All {n} flows in scope are unchanged since their last documentation date. No documentation files were created or updated.

**Skipped (unchanged since last documented):** {n} flows
  - {FlowName} (last documented: {date}, git: {date}, org: {date})
  - ...

No downstream artifacts were generated.
```

Do **not** create a work item or Issue (skip Step 13), do **not** update indexes, and do **not** modify any XML descriptions.

---

<!-- Phase B: Analysis (Steps 3-5b) — Read and analyze flow XML -->

## Step 3 — Flag Deactivated Flows

For every flow skipped as **inactive** (Obsolete, Draft, InvalidDraft, Inactive) in Step 2, check whether documentation artifacts exist. If they do, flag them — do **not** delete documentation or remove XML descriptions. Preserving docs keeps historical context available.

### 3a — Flag Flow Documentation as Inactive

1. Check if `docs/flows/{category}/{FlowName}.md` exists (try all categories if the category is unknown — check the master index first).
2. If the doc file exists, update its header metadata:
   - Change `**Status:** Active` to `**Status:** {Obsolete / Draft / InvalidDraft / Inactive}` (use the actual status from the XML).
   - Add a deactivation notice immediately after the Status line: `**Deactivated:** {today's date}`
3. In the category index `docs/flows/{category}/_index.md`:
   - Prefix the flow's Purpose column with **`[INACTIVE]`** (e.g., `**[INACTIVE]** — Creates $99 flat platform fee...`).
   - Do **not** remove the row or change the flow count.
4. In the master index `docs/flows/_index.md`:
   - Prefix the flow's Purpose column with **`[INACTIVE]`**, same as above.
   - Do **not** remove the row. Update the documented count only if flows were newly documented in this run.
5. Leave the XML `<description>` element intact — the doc link still points to a valid (now-flagged) file.

### 3b — Flag References in Project Knowledge Base

Search the project knowledge base document (if available) for the flow name (both `{FlowName}` and its human-readable equivalent). If found:

- Add a `[DEACTIVATED]` prefix to the flow reference inline.
- If the flow was the **primary subject** of a KB section (i.e., appears in a section heading or is the only flow cited), add a note: `> This flow was deactivated on {today's date}. This section may need revision or removal.`

### 3c — Flag References in Salesforce Knowledge Articles

If the production org is connected, query `Knowledge__kav` for articles referencing the inactive flow name. Do **NOT** modify articles automatically — log any matches in the Step 12 report for manual review via the KB approval workflow.

### 3d — Skip if no artifacts found

If no documentation exists for the inactive flow, skip silently (it was never documented — nothing to flag).

Report all flagging actions in Step 12.

---

## Step 4 — Categorize Active Flows

Assign each flow to a category using the rules in `docs/flows/flow-categories.json`. The file defines pattern-matching rules (regex patterns and exact-match sets) with first-match-wins priority.

For individual flow categorization, apply the regex patterns and exact-match sets from the categories definition in priority order. For batch categorization, run `node scripts/flow-index.js` to get the full breakdown.

---

## Step 5 — Read and Parse Each Flow XML

**Script acceleration:** Use `scripts/flow-index.js` for metadata extraction and `scripts/flow-doc-generator.js` for bulk doc generation:

```bash
node scripts/flow-index.js --category {name}
```

```bash
node scripts/flow-doc-generator.js --category {name} --dry-run
```

```bash
node scripts/flow-doc-generator.js {FlowName}
```

```bash
node scripts/flow-doc-generator.js --xml-description-only --category {name}
```

```bash
node scripts/flow-changelog-detector.js --category {name} --table
```

```bash
node scripts/flow-changelog-detector.js --changed
```

Use script output as the foundation, then review and enhance with context from the org (SOQL queries, describe calls) where the script's regex-based parsing may miss nuance.

For each flow, read the `.flow-meta.xml` file and extract:

- `<processType>` — e.g. `AutoLaunchedFlow`, `Flow` (screen flow), `Workflow`
- `<triggerType>` — e.g. `RecordBeforeSave`, `RecordAfterSave`, `Scheduled`, `PlatformEvent`, `None`
- `<start>` — entry criteria, object, scheduled path details
- `<variables>` — name, dataType, objectType (if sobject), isInput, isOutput, description
- `<decisions>` — name, label, rules with conditions in plain English
- `<assignments>` — what fields/variables are assigned and what values
- `<loops>` — what collection is iterated, variable name
- `<recordLookups>` — object, filter criteria, fields retrieved, assign null if no records
- `<recordCreates>` — object, fields set
- `<recordUpdates>` — object or record variable, fields set
- `<recordDeletes>` — what records are deleted
- `<subflows>` — which subflow is called, input/output variable mappings
- `<actionCalls>` — action type (send notification, send email, invoke Apex, etc.), action name, parameters
- `<screens>` — screen components (for screen flows)
- `<faultConnectors>` / fault paths — how errors are handled

---

## Step 5b — Build Change Description

For each flow that passed freshness checks (i.e. will be documented), build a **change description** summarizing what changed since the last documentation. This description is used in two places: the repo documentation Change Log section and the flow XML `<description>` element.

### How to detect changes

1. **New flow (no prior doc):** Change description = `"Initial documentation."` — skip diffing.
2. **Previously documented flow:** Compare the current XML against what the prior documentation describes. Use the existing doc's Process Logic, Variables, Trigger, and Dependencies sections as the "before" state. Identify material differences:
   - **Trigger changes:** Object changed, entry conditions added/removed/modified, schedule changed
   - **Logic changes:** Decisions added/removed/reordered, new branches, changed conditions
   - **DML changes:** New record creates/updates/deletes, changed fields or filter criteria
   - **Variable changes:** New input/output variables, type changes, removed variables
   - **Action changes:** New subflow calls, notification types, email alerts, Apex invocations added/removed
   - **Error handling changes:** Fault paths added/removed
3. **Explicitly named flow (user override):** If the user provided a specific flow name AND the flow is unchanged since last documented, still build a change description. Compare XML to existing doc — if identical, use `"Re-documented — no logic changes detected."`

### Change description format

Write a concise, plain-English summary of the material changes. Lead with the most significant change. Use semicolons to separate multiple changes. Keep under 120 characters for the XML-compatible version (see Step 10).

**Examples:**

- `"Added fault path on payment record update; new decision branch for zero-balance accounts."`
- `"Entry criteria now excludes inactive billing accounts; removed unused variable."`
- `"Scheduled path changed from daily to weekly; added volume guard (skip if > 50k records)."`
- `"Initial documentation."`

### Store for later steps

Hold the change description for each flow in memory — it will be consumed by Step 7 (repo docs) and Step 10 (XML description).

---

<!-- Phase C: Output (Steps 6-10) — Write documentation artifacts -->

## Step 6 — Determine Document Depth

**Lightweight format** applies to:

- All `batch` category flows that are purely operational: cleanup jobs, stamp jobs, status update sweeps, and data load one-time runs. Identifiable by names containing `Delete`, `Cleanup`, `Stamp`, `Inactive`, `One_Time`, `Historical`.
- Any scheduled flow whose sole purpose is to delete or archive records.

**Full depth format** applies to all other flows, including batch flows with significant business logic.

---

## Step 7 — Write Individual Flow Documentation

**File path:** `docs/flows/{category}/{FlowName}.md`

Create the directory if it doesn't exist.

### Full Depth Template

````markdown
# {Human-readable Flow Name}

**File:** `{context.metadataPath}/flows/{FlowName}.flow-meta.xml`
**Category:** {category}
**Type:** {processType} — {triggerType}
**Object:** {triggering object, if applicable}
**Status:** {Active / Inactive}
**Last Documented:** {today's date}

## Purpose

{2-4 sentence plain-English description of what this flow does, why it exists, and what business problem it solves.}

## Trigger

{Describe when this flow runs: what event, what object, what entry conditions, any scheduled path details.}

## Variables

| Name           | Type       | Direction              | Purpose         |
| -------------- | ---------- | ---------------------- | --------------- |
| {variableName} | {dataType} | Input / Output / Local | {what it holds} |

_Omit this section if the flow has no variables._

## Flow Diagram

{For flows with 5+ decisions or parallel paths, generate a Mermaid flowchart (`flowchart TD`) showing the element sequence. Include decision diamonds, action rectangles, and loop indicators. Use edge labels for decision outcomes (Yes/No, condition text). Keep to 20 nodes max — collapse simple sequential elements into grouped nodes.

For simpler flows (fewer than 5 decisions, linear path), OMIT this section — the numbered steps in Process Logic are sufficient.

Wrap in a ```mermaid code fence.}

## Process Logic

{Walk through the flow in plain English. Use numbered steps. For each decision, describe the conditions and what happens on each branch. For each DML operation, describe what records are created/updated/deleted and what fields are set. Be specific — include field API names where relevant.}

Example:

1. **Entry check:** If `Account.Type` is not "Provider", the flow exits immediately.
2. **Look up related records:** Queries all active related records where `Status__c = 'Active'`.
3. **Decision — Has active records?**
   - Yes -> proceeds to calculate totals
   - No -> exits without changes
4. **Calculate totals:** Assigns the sum of `Amount__c` from all retrieved records to `varTotalAmount`.
5. **Update record:** Sets the total field to `varTotalAmount`.

## Actions & Integrations

{List any external actions: send notification (include notification type name), send email, callout, invoke subflow, etc.}

| Action        | Type                                                      | Details        |
| ------------- | --------------------------------------------------------- | -------------- |
| {action name} | {Send Notification / Send Email / Subflow / Apex / etc.}  | {what it does} |

_Omit this section if there are no external actions._

## Error Handling

{Describe fault paths if present. If none, state: "No fault paths defined."}

## Dependencies

- **Objects read:** {list}
- **Objects written:** {list}
- **Subflows called:** {list with links to their docs}
- **Called by LWC:** {list with links to component docs in `docs/components/`, if any — check for `@salesforce/apex` imports or `lightning-flow` references that invoke this flow}
- **Notification types used:** {list}
- **Related flows:** {any flows that call this one, or that this one calls}

## Notes

{Any known quirks, governor limit concerns, business rules not obvious from the logic, or links to design documents.}

## Change Log

| Date           | Description                       |
| -------------- | --------------------------------- |
| {today's date} | {change description from Step 5b} |

{Append new rows at the top (newest first). Preserve all prior entries. For first-time documentation, the single entry will read "Initial documentation."}
````

### Lightweight Template (batch/admin operational flows)

```markdown
# {Human-readable Flow Name}

**File:** `{context.metadataPath}/flows/{FlowName}.flow-meta.xml`
**Category:** batch
**Type:** {processType} — {triggerType}
**Schedule:** {when it runs, if scheduled}
**Last Documented:** {today's date}

## What It Does

{1-2 paragraph plain-English description. Include: what object it processes, what filter criteria it uses, what action it takes (delete, update, create), and any conditions that gate the action.}

## Side Effects

- **Records affected:** {object name, what happens to them}
- **Volume consideration:** {note if this touches high-volume objects}

## Notes

{Governor limit concerns, known issues, or operational guidance for admins.}

## Change Log

| Date           | Description                       |
| -------------- | --------------------------------- |
| {today's date} | {change description from Step 5b} |

{Append new rows at the top (newest first). Preserve all prior entries.}
```

---

## Step 8 — Update Category Index

**File path:** `docs/flows/{category}/_index.md`

If the file doesn't exist, create it. If it exists, update the flows table to include any newly documented flows.

````markdown
# {Category Name} Flows

**Category:** {category}
**Flow count:** {n}
**Last updated:** {today's date}

## Overview

{3-5 sentence narrative of what this category of flows does collectively. Describe the business domain, when these flows run, and what they collectively accomplish. This is the entry point for someone who wants to understand the full process before diving into individual flows.}

## Process Diagram

{Generate a Mermaid flowchart showing how the flows in this category chain together. Use `flowchart LR` (left-to-right) for linear processes or `flowchart TD` (top-down) for branching processes. Each node should be a flow name (abbreviated for readability) with the full flow name in the node text. Use solid arrows (`-->`) for primary flow, dotted arrows (`-.->`) for conditional/error paths, and subgraphs to group related stages. Link node text to the individual flow doc where possible.

Guidelines:

- Keep diagrams to 15 nodes or fewer — split into multiple diagrams if the category has distinct sub-processes
- Use descriptive edge labels for conditions (e.g., `-->|"fields changed"`)
- Color-code with Mermaid styles if helpful: green for entry points, red for error paths, blue for integrations
- Wrap the diagram in a ```mermaid code fence so it renders on GitHub}

## Process Narrative

{Walk through the end-to-end process that these flows collectively implement. Use numbered steps or a prose description with subheadings. Reference individual flow names. This should give an admin a mental map of how the flows relate to each other. The narrative should describe what the diagram shows, adding business context that the diagram alone cannot convey.}

## Flows in This Category

| Flow                          | Type                                | Trigger               | Purpose            |
| ----------------------------- | ----------------------------------- | --------------------- | ------------------ |
| [{FlowName}](./{FlowName}.md) | {AutoLaunched / Screen / Scheduled} | {trigger description} | {one-line purpose} |

## Key Objects

{List the primary Salesforce objects read or written by flows in this category.}

## Related Categories

{Links to other category indexes that interact with this one.}
````

---

## Step 9 — Update Master Index

**File path:** `docs/flows/_index.md`

Append or update entries for each documented flow in the master catalog table. The master index should always be a complete catalog of all documented flows.

Format for each row:

```text
| [{FlowName}](./category/FlowName.md) | {category} | {type} | {trigger object} | {one-line purpose} |
```

---

## Step 10 — XML Descriptions (SKIPPED by default)

**By default, XML `<description>` updates are handled during the commit workflow** (DOC mode: `/devops-commit` syncs descriptions when committing to WI branches; GHA mode: descriptions are committed with the feature branch). The sync uses `scripts/flow-description-sync.js` to copy the Purpose from the markdown doc into the flow XML.

`/doc-flows` no longer modifies `{context.metadataPath}/` files. It only writes markdown documentation and updates indexes on `main`.

**Override:** Pass `--update-xml` to force `/doc-flows` to update XML descriptions (for catchup scenarios where flows were deployed outside the normal pipeline). When `--update-xml` is used, follow the legacy Step 10 behavior:

1. Run `node scripts/flow-description-sync.js {FlowName1} {FlowName2} ...` for all documented flows.
2. The script reads the Purpose from each flow's markdown doc and updates the XML `<description>`.
3. Commit the XML changes with `ALLOW_FORCEAPP_ON_MAIN=1` (catchup deploys bypass the normal pipeline).

**Commit step (docs only):**

After Steps 11-12 complete, commit documentation to main:

```bash
git add docs/flows/{category}/
```

```bash
git add docs/flows/_index.md
```

```bash
git commit -m "[docs-only] Document {category} flows"
```

Do NOT use `git add .` or `git add -A`.

---

<!-- Phase D: Cleanup (Steps 11-13) — Finalize and report -->

## Step 11 — Update Pending Docs File

If `docs/flows/.pending-docs.txt` exists, remove the names of flows you just documented from it. If the file becomes empty, delete it.

---

## Step 12 — Report Results

After completing all flows, output a summary:

```text
## /doc-flows Complete

**Documented:** {n} flows
  - {FlowName} — {change description from Step 5b}
  - ...

**Flagged as inactive:** {n} flows
  - {FlowName} ({status}) — flagged doc, marked [INACTIVE] in {category} index + master index
  - ...
  Project KB references flagged: {n}
  Salesforce Knowledge articles to review:
    - KA-{number}: "{Article Title}" — references {FlowName}
    - ...
  (If none: "No inactive flows had existing documentation to flag.")

**Skipped (unchanged since last documented):** {n} flows
  - {FlowName} (last documented: {date}, git: {date}, org: {date})
  - ...

**Org drift detected -> /detect-drift invoked:** {n} flows
  - {FlowName} — retrieved and documented (org {date} > git {date})
  - {FlowName} — false positive (content identical, date-only drift)
  - {FlowName} — not retrieved (user skipped) -- docs reflect stale local XML
  - ...
  (If none: omit this section.)

**Skipped (filtered):** {n} flows
  - Inactive (Obsolete/Draft/InvalidDraft/Inactive) without docs: {list if any}
  - Managed package: {list if any}
  - Template flows: {list if any}

**Files written:**
- docs/flows/_index.md (updated)
- docs/flows/{category}/_index.md (updated)
- docs/flows/{category}/{FlowName}.md (created/updated) x {n}
- docs/flows/{category}/{FlowName}.md (flagged inactive) x {n}

Next steps:
1. Commit docs to main: `git add docs/flows/ && git commit -m "[docs-only] Document {category} flows"`
2. Run `/kb-gap-analysis` to identify Knowledge Base gaps based on the new documentation.
3. XML descriptions will sync automatically when flow logic is next committed via `/devops-commit`.
```

---

## Step 13 — REMOVED (no longer needed)

XML description updates are handled by `/devops-commit` — they go into the same WI as the logic change. `/doc-flows` only writes markdown docs and indexes to `main`, which don't require a WI.
