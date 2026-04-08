---
name: release-review
description: Salesforce release note analysis, feature evaluation, and backlog item proposals
---

# /release-review — Salesforce Release Review

Review Salesforce release notes for the current (or specified) release, highlight features relevant to this project, update the project API version, and propose backlog items for new platform capabilities.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- Empty — auto-detect the current release from production API version
- `--release <name>` — target a specific release (e.g., `Summer '26`, `Winter '27`)
- `--api-version-only` — skip release notes analysis, just check and update the API version in CLAUDE.md and MEMORY.md
- `--no-backlog` — analyze release notes but don't propose backlog items. The review report is still generated — run `/release-review --backlog-only` later to process it.
- `--backlog-only` — skip release notes analysis, process existing review findings into backlog items. Reads `docs/release-reviews/platform.md`, extracts unprocessed Adopt Now and Evaluate features, and runs the backlog proposal workflow (Step 4). Use this to process findings from a previous run.
- `--watch-only` — only review and update the watch list (skip full release analysis)
- `--context <area>` — domain-specific platform capability lookup (e.g., `--context agentforce`, `--context flow`, `--context data-cloud`). Reports what platform features exist for this area. Does NOT update the rolling file.

Examples:

```
/release-review
/release-review --release Summer '26
/release-review --api-version-only
/release-review --no-backlog
/release-review --backlog-only
/release-review --context agentforce
/release-review --context flow
```

---

## Resolution

Dispatch the `sf-toolkit-resolve` agent. Use the returned context for all
org references, team lookups, and path resolution in subsequent steps.
If `missing` contains values this skill requires, stop and instruct the
developer to run `/setup`.

---

## Argument Resolution

Parse `$ARGUMENTS` and resolve flags:

```
RELEASE = value after --release, or auto-detect
API_VERSION_ONLY = true if --api-version-only
NO_BACKLOG = true if --no-backlog
BACKLOG_ONLY = true if --backlog-only
WATCH_ONLY = true if --watch-only
CONTEXT_AREA = value after --context, or null
```

**Mode resolution:**

- `--backlog-only` → skip Steps 0-3, read the rolling file `docs/release-reviews/platform.md`, extract Adopt Now and Evaluate features, and jump to Step 4 (Propose Backlog Items). After processing, annotate the "Recent Reviews" entry as backlog-processed.
- `--no-backlog` → run Steps 0-3 normally, skip Step 4. The rolling report is still updated for later use with `--backlog-only`.
- `--context <area>` → run Context Lookup flow (below). Does NOT update rolling file.
- Default → run all steps.

---

## Step 0 — Determine Release & API Version

**If `--backlog-only`:** Skip this step entirely. Jump to Step 4 (Backlog-Only Mode).

Query the production org for the current API version:

```bash
sf org display --target-org {context.orgs.productionAlias} --json
```

Extract `apiVersion` from the result. Compare against the version in CLAUDE.md and MEMORY.md.

**Salesforce release cadence:**

| Release | GA Window | API Version Pattern |
| ------- | --------- | ------------------- |
| Spring  | ~Feb      | Even year releases  |
| Summer  | ~Jun      | Mid-year releases   |
| Winter  | ~Oct      | Odd version bumps   |

Map the API version to a release name if `--release` was not provided. For reference:

- API 60.0 = Spring '24, 61.0 = Summer '24, 62.0 = Winter '25
- API 63.0 = Spring '25, 64.0 = Summer '25, 65.0 = Winter '26
- API 66.0 = Spring '26, 67.0 = Summer '26, 68.0 = Winter '27

Set:

```
CURRENT_API = {version from production}
DOCUMENTED_API = {version from CLAUDE.md, i.e. context.apiVersion}
RELEASE_NAME = {mapped or provided release name}
API_CHANGED = true if CURRENT_API != DOCUMENTED_API
```

Report:

```text
### Release Review Setup

**Production API version:** {CURRENT_API}
**Documented API version:** {DOCUMENTED_API}
**Release:** {RELEASE_NAME}
**API version update needed:** {yes/no}
```

If `--api-version-only`, jump to Step 5 (update version and stop).

---

## Step 1 — Fetch Release Notes

Fetch the Salesforce release notes for the target release. Use web search to find the official release notes page:

```
WebSearch: "Salesforce {RELEASE_NAME} release notes site:help.salesforce.com"
```

Also search for highlights and summaries:

```
WebSearch: "Salesforce {RELEASE_NAME} release highlights new features"
```

Fetch the main release notes page and any top-level summary/highlights pages using WebFetch. Focus on the feature summary and "new and changed" sections rather than trying to read the entire release notes (they're hundreds of pages).

If WebFetch cannot retrieve the full notes, use WebSearch results to build the feature list from multiple sources (Salesforce blog posts, admin summaries, developer highlights).

---

## Step 2 — Filter for Relevant Features

Review the release notes through the lens of the project's stack. Score each feature for relevance.

### Relevance Filtering

Read the platform brief for the relevance filter:

```
Read docs/platform-brief.md
```

Match features against the **Salesforce Features** table tags and **Active Initiatives** key areas. Use the same classification taxonomy: Adopt Now, Evaluate, Watch, Informational.

For each relevant feature, classify it:

- **Adopt Now** — Directly useful, can leverage immediately or in current initiatives
- **Evaluate** — Potentially useful, needs investigation to determine fit
- **Watch** — Not actionable yet but relevant to the project's roadmap (e.g., beta features, future enhancements to current tools)
- **Informational** — Good to know, no action needed (e.g., deprecation warnings, limit changes)

### Feature Entry Format

For each relevant feature, capture:

```yaml
feature: { feature name }
area: { Flow Builder | Data Cloud | etc. }
classification: { Adopt Now | Evaluate | Watch | Informational }
summary: { 2-3 sentence description of what changed }
project_impact: { 1-2 sentences on how this specifically affects the project }
action: { what to do about it, if anything }
tags: [{ matching backlog tags }]
```

---

## Step 3 — Update Rolling Release Review Report

Update the rolling report at `docs/release-reviews/platform.md`. If the file doesn't exist, create it with the structure below.

**Header updates:** Update the header fields each run:

```markdown
# Salesforce Platform — Release Reviews

**Current API Version:** {CURRENT_API}
**Current Release:** {RELEASE_NAME}
**Last Reviewed:** {today}
**Reviewed by:** Claude + {developer}
```

**Add new findings to existing sections.** Do not replace previous entries — append new features from this release to the appropriate classification section. Tag each entry with the release name so origin is traceable.

```markdown
## Adopt Now

| Feature | Area | Release | Impact | Action | Status |
| ------- | ---- | ------- | ------ | ------ | ------ |
| ...     | ...  | ...     | ...    | ...    | Active |

{Detailed subsections for each new Adopt Now feature:}

### {Feature Name} ({RELEASE_NAME})

**Area:** {area}
**Summary:** {what changed}
**Project Impact:** {why it matters}
**Action:** {what to do}

## Evaluate

| Feature | Area | Release | Impact | Action | Status |
| ------- | ---- | ------- | ------ | ------ | ------ |

## Watch

| Feature | Area | Release | Why Watch | Expected GA |
| ------- | ---- | ------- | --------- | ----------- |

## Informational

- **{feature}** ({RELEASE_NAME}) — {one-line note}

## Completed

{Features previously in Adopt Now that have been acted on. Move rows here when adopted.}

| Feature | Release | Adopted | Backlog Item |
| ------- | ------- | ------- | ------------ |

## Not Relevant

{Notable features explicitly excluded and why, to avoid re-reviewing. Tag with release.}

## Recent Reviews

| Release        | Date    | Adopt Now | Evaluate | Watch | Informational | Backlog Processed |
| -------------- | ------- | --------- | -------- | ----- | ------------- | ----------------- |
| {RELEASE_NAME} | {today} | {n}       | {n}      | {n}   | {n}           | —                 |
```

**For each new review run:** Add a row to the "Recent Reviews" table with counts. Set "Backlog Processed" to "—" initially (updated by `--backlog-only` mode later).

**Moving adopted items:** When a feature from Adopt Now has been fully acted on (backlog item completed, feature integrated), move its row from the Adopt Now table to the Completed table and update its Status.

---

## Step 4 — Propose Backlog Items

Skip this step if `--no-backlog`.

### Backlog-Only Mode

**If `--backlog-only`:** Skip Steps 0-3. Read the rolling file:

```
Read docs/release-reviews/platform.md
```

Check the "Recent Reviews" table for entries where "Backlog Processed" is "—" (not yet processed). Only process unprocessed reviews.

For each unprocessed review (identified by release name in the Recent Reviews table):

1. **Extract features** from the "Adopt Now" and "Evaluate" sections that are tagged with that release name.
2. **Parse each feature** — extract the feature name, area, impact description, and action from the tables and subsections.
3. **Run the standard backlog proposal workflow below** (overlap check, draft entries, propose for approval) using the extracted features.
4. **After processing, update the Recent Reviews table** — change the "Backlog Processed" column from "—" to: `{today's date} — {n} proposed, {m} approved, {k} covered`

Report which reviews were processed:

```text
### Release Review Backlog Processing

**Unprocessed reviews found:** {list of release names}
**Already processed:** {list, or "none"}
**Processing now:** {list}
```

Then continue with the standard backlog proposal workflow below for each extracted feature.

### Standard Backlog Proposal Workflow

For each **Adopt Now** and **Evaluate** feature, determine if it warrants a backlog item:

1. **Check for existing backlog overlap.** For each script below, check for a local copy in the project's `scripts/` directory first. If not found, generate it from the plugin's `script-templates/` directory.

   ```bash
   node scripts/backlog-search.js --text "{feature keywords}"
   ```

   If an existing item covers this feature, note it as an expansion candidate rather than a new item.

2. **Draft backlog entries.** For each new item:

   ```yaml
   title: "{action verb} {feature name} — {RELEASE_NAME}"
   description: "{what to do and why, referencing the release review}"
   category: "{matching category}"
   priority: null # developer assigns during review
   effort: "{S|M|L|XL estimate}"
   complexity: "{Low|Med|High}"
   tags: ["{from relevance filter}"]
   source: "release-review"
   submitted_by: "Claude"
   notes:
     - date: "{today}"
       author: "Claude"
       text: "Identified in {RELEASE_NAME} release review. See docs/release-reviews/platform.md"
   ```

3. **Present proposals for approval:**

```text
### Proposed Backlog Items ({n} new, {m} expansions)

**New Items:**

1. **{title}** — {one-line summary}
   Effort: {S/M/L/XL} | Tags: {tags}

2. ...

**Expand Existing:**

1. **BL-NNNN: {existing title}** — add: {what to add from this release}

Approve all / approve 1,3 / skip 2 / edit 1: {text} / none
```

Wait for developer approval before writing any backlog items. For approved items, use `backlog-add.js`:

For each script below, check for a local copy in the project's `scripts/` directory first. If not found, generate it from the plugin's `script-templates/` directory.

```bash
node scripts/backlog-add.js --title "{title}" --description "{desc}" --category "{cat}" --effort "{effort}" --complexity "{complexity}" --tags "{tags}" --source "release-review" --submitted-by "Claude"
```

For expansion candidates, use the `/backlog update` workflow.

After all backlog writes, re-render:

```bash
node scripts/backlog-render.js
```

---

## Context Lookup Mode (`--context <area>`)

On-demand platform capability scan. Does NOT update rolling file.

### Step C1 — Map Area to Platform Brief

Read `docs/platform-brief.md`. Map the provided `<area>` argument to platform brief tags:

| Input (flexible)         | Platform Brief Tag |
| ------------------------ | ------------------ |
| agentforce, agent        | ai-agents          |
| data-cloud, datacloud    | data-cloud         |
| analytics, crm-analytics | analytics          |
| flow, flows              | flow               |
| lwc, lightning           | lwc                |
| portal, experience       | portal             |
| devops                   | devops             |
| testing, test            | testing            |
| knowledge, kb            | kb                 |
| apex                     | apex               |
| compliance, shield       | compliance         |
| platform                 | platform           |

If the area doesn't match any tag, report available areas and stop.

### Step C2 — Scan Platform Features

Read `docs/release-reviews/platform.md`. Extract all features from Adopt Now, Evaluate, and Watch sections that match the area tag or keywords.

### Step C3 — Cross-Reference Backlog

For each script below, check for a local copy in the project's `scripts/` directory first. If not found, generate it from the plugin's `script-templates/` directory.

```bash
node scripts/backlog-search.js --text "{area}"
```

List active backlog items related to this area.

### Step C4 — Report

Report to console (do NOT update rolling file):

```text
### {Area} Platform Features — Context Lookup

**Adopt Now (available to use):**
- {feature} — {impact summary}
- ...

**Evaluate (needs investigation):**
- {feature} — {impact summary}
- ...

**Watch (upcoming):**
- {feature} — {expected GA}
- ...

**Your {Area} Backlog:**
- BL-NNNN: {title} ({status})
- ...

**Recommendation:** {what to adopt, what to evaluate, how it maps to active work}
```

### Step C5 — Optional Backlog Proposals

If significant adoption opportunities found, offer to propose backlog items using the standard propose-then-approve workflow.

---

## Step 5 — Update API Version

If `API_CHANGED` is true:

1. Update CLAUDE.md — find the `API version:` line and update to `{CURRENT_API}`
2. Update `.claude/memory/MEMORY.md` — find the `API v` reference in the Project Summary and update

Report:

```text
API version updated: {DOCUMENTED_API} → {CURRENT_API} in CLAUDE.md and MEMORY.md
```

If `API_CHANGED` is false, report:

```text
API version is current ({CURRENT_API}) — no update needed.
```

---

## Step 6 — Update Watch List

Read the existing watch list from `.claude/memory/project_release_watch_list.md` (create if it doesn't exist).

Update the watch list:

- **Add** new Watch items from this review
- **Graduate** Watch items that became GA in this release (move to Adopt Now/Evaluate and propose backlog items in Step 4)
- **Remove** Watch items that were dropped by Salesforce or are no longer relevant to the project

Watch list format:

```markdown
---
name: Release Watch List
description: Salesforce features in beta/pilot/preview that are relevant to this project — tracked across releases
type: project
---

## Active Watch Items

| Feature | Area | First Seen | Expected GA | Why Watching | Status |
| ------- | ---- | ---------- | ----------- | ------------ | ------ |
| ...     | ...  | ...        | ...         | ...          | ...    |

## Graduated (now in backlog)

| Feature | Release | Backlog Item |
| ------- | ------- | ------------ |
| ...     | ...     | BL-NNNN      |

## Dropped

| Feature | Release | Reason |
| ------- | ------- | ------ |
| ...     | ...     | ...    |
```

Update `.claude/memory/MEMORY.md` index if the watch list file is new.

---

## Step 7 — Final Report

```text
### Release Review Complete — {RELEASE_NAME}

**Report:** docs/release-reviews/platform.md
**Features reviewed:** {total}
**Project-relevant:** {count} (Adopt Now: {n}, Evaluate: {n}, Watch: {n}, Informational: {n})
**API version:** {updated/current} ({CURRENT_API})
**Backlog items:** {n} proposed, {m} approved
**Watch list:** {n} added, {m} graduated, {k} dropped

Next release review: {estimated next release name and approximate date}
```

---

## Behavior Notes

- **Propose-then-approve for backlog items.** Same pattern as `/platform-review` and `/lookback` — Claude proposes, developer approves before writing.
- **Web fetching may be incomplete.** Salesforce release notes are massive. Focus on the summary/highlights pages and area-specific sections relevant to the project. It's better to cover the key areas well than to attempt exhaustive coverage.
- **Watch list is cumulative.** Items persist across releases until graduated or dropped. This prevents features from falling through the cracks between reviews.
- **Run after each major release GA.** Ideally within 2 weeks of a release going GA, so the team can plan adoption in the current quarter.
- **`/platform-review` handles the lightweight check.** If you just need to verify the API version is current, use `/platform-review` or `/release-review --api-version-only`. The full `/release-review` is for deep analysis.
- **Source attribution.** All backlog items from release reviews use `source: release-review` for traceability. Notes reference the specific report file.
