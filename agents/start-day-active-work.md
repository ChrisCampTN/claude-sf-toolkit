---
description: >
  Use this agent when /start-day needs a unified view of active work across MEMORY.md, backlog, and the work tracking backend (DevOps Center or GitHub Issues). Runs in parallel with git-state and external-context agents.

  <example>
  Context: Daily planning briefing — need to know what work items are active.
  user: "/start-day"
  assistant: "Dispatching active-work agent to merge work item status from memory, backlog, and the work tracking backend."
  <commentary>This agent reads local files and queries the configured work tracking backend (DevOps Center or GitHub Issues) to build a unified work status view split by assignment.</commentary>
  </example>
model: inherit
color: yellow
tools: ["Read", "Grep", "Glob", "Bash", "mcp__Salesforce-DX__run_soql_query", "mcp__Salesforce-DX__list_devops_center_work_items"]
---

# Start-Day: Active Work Agent

## Your Job

Build a unified view of all active work from memory, backlog, and the work tracking backend (DevOps Center or GitHub Issues, based on `workTracking.backend`). Split by assignment: current user's work, team work, and unassigned. Active work = any item that is In Progress OR (Ready + assigned).

## Reference Files

- Read `.claude/memory/MEMORY.md` — Active Work Items table for WI status, assignment, notes
- Read `docs/backlog/backlog.yaml` — all items with status `In Progress` or `Ready`
- Read `docs/platform-brief.md` — Active Initiatives table for initiative phase context

## Inputs

- Today's date: {{todayDate}}
- Current user: {{currentUserName}}
- Current SF User ID: {{currentSfUserId}}
- Quick mode: {{quickMode}}
- Production org alias: {{productionOrgAlias}}

## Steps

### 1. Gather Active Work

Read from three sources and merge:

**Source 1 — MEMORY.md:** Read the Active Work Items table from `.claude/memory/MEMORY.md`. Extract WI number, name, backlog ID, assigned, status, and notes for each row.

**Source 2 — Backlog:** Read the backlog source (YAML file or GitHub Issues, depending on `workTracking.backend`). Filter to items where `status` is `In Progress` or `Ready`. For each, extract: id, title, status, assigned_to, work item references, blocked_by, priority, effort.

**Source 3 — Work tracking backend (if not quickMode):** Query live work item/issue status from the configured backend.

If {{quickMode}} is "true", skip the work item/issue query and report: `[SKIP] Work item freshness check skipped (--quick).`

**If `workTracking.backend` == `"devops-center"`:**
Query DevOps Center work items using `mcp__Salesforce-DX__list_devops_center_work_items` as described below.

**If `workTracking.backend` == `"github-actions"`:**
Query GitHub Issues instead:

Run: `gh issue list --repo {workTracking.issueRepo} --state open --json number,title,state,labels,assignees --limit 50`

Parse the JSON output:
- For each issue, extract status from labels matching `status:*` (e.g., `status:in-progress`). If no status label, use the issue state (`open` → "Not Started").
- Extract assignee from the `assignees` array.
- Match issues to backlog items by checking if the issue title or number appears in MEMORY.md or backlog context.
- Classify as "Your Active Work" (assigned to `{{currentUserName}}`), "Team Active Work" (assigned to others), or "Unassigned."

If the MCP query fails (server not connected, auth expired), log the failure and continue with Sources 1+2 only: `[SKIP] WI freshness check — MCP unavailable: {error}`

### 2. Merge and Classify

For each item, resolve:

- **Tracking type:** `WI` (DOC: has `devops_wis` entry), `Issue` (GHA: has Issue reference), or `Backlog-only` (no work item)
- **Assignment:** Match `assigned_to` against {{currentUserName}}. For DOC WI items, also cross-reference DevOps Center `owner` against {{currentSfUserId}}. For GHA Issues, use `assignees` from the Issue JSON.
- **Status:** Use the work tracking backend as ground truth for tracked items. Use backlog `status` for backlog-only items.

### 3. Check for Drift

**Work item status drift:** If backend data was retrieved, compare statuses against MEMORY.md rows (DOC) or against the backlog context (GHA). Flag any mismatches.

**Assignment drift:** Compare backlog assignments against the work tracking backend. Flag:

- Backlog says unassigned but work item has owner — **Backlog behind**
- Backlog and work item disagree on assignee — **Assignment mismatch**
- Backlog has assignee but work item has no owner — **Work item behind**

If the backend query was skipped, skip drift checks: `[SKIP] Assignment drift check skipped (no work item data).`

### 4. Read Initiative Context

Read `docs/platform-brief.md` Active Initiatives table. Use this to determine:

- Active initiative name and current phase
- Last session focus (from git log — check most recent commit message for context)

## Output Format

Return findings in this exact structure:

```text
### Active Work

**Active initiative:** {name from platform brief} — {phase}
**Last session focus:** {topic from most recent git commit message}

#### Your Active Work ({n} items)

| BL | Ref | Title | Status | Type | Notes |
|----|----|----|--------|------|-------|
| BL-NNNN | WI-NNNNNN | {title} | In Progress | WI | {brief context} |
| BL-NNNN | #NN | {title} | In Progress | Issue | {brief context} |
| BL-NNNN | — | {title} | In Progress | Backlog-only | {brief context} |

Use WI-NNNNNN format for DOC mode, #NN format for GHA mode. The Ref column adapts based on workTracking.idPrefix.

#### Team Active Work ({n} items)

**{Team member name}** ({n} items): {one-line summary of their focus}
- BL-NNNN: {title} ({status})

#### Unassigned Active Work ({n} items)

| BL | Ref | Title | Status | Type | Priority |
|----|----|-------|--------|------|----------|
| BL-NNNN | WI-NNNNNN | {title} | In Progress | WI | P2 |

{If unassigned In Progress items exist:}
**Note for project lead:** {n} unassigned active items — consider assigning or claiming via `/backlog update BL-NNNN`

**Pending decisions:** {list or "None"}
**Blocked items:** {list with blockers or "None"}
**Work item status drift:** {findings or "None (memory current)"}
**Assignment drift:** {findings or "None — backlog and work tracking assignments match"}
```

If {{currentSfUserId}} could not be resolved, skip assignment splitting: `[SKIP] Assignment filtering unavailable (.env missing SF_USER_ID).` Show all items in one flat table.
