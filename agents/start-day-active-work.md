---
description: Merge work item status from MEMORY.md, backlog, and DevOps Center into a unified view with drift detection
---

# Start-Day: Active Work Agent

## Your Job

Build a unified view of all active work from memory, backlog, and DevOps Center. Split by assignment: current user's work, team work, and unassigned. Active work = any item that is In Progress OR (Ready + assigned).

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

**Source 2 — Backlog:** Read `docs/backlog/backlog.yaml`. Filter to items where `status` is `In Progress` or `Ready`. For each, extract: id, title, status, assigned_to, devops_wis, blocked_by, priority, effort.

**Source 3 — DevOps Center (if not quickMode):** Query live WI status. Use the Salesforce DX MCP tool `mcp__Salesforce-DX__list_devops_center_work_items` targeting **{{productionOrgAlias}}** (WorkItem only exists in production, not sandboxes).

If {{quickMode}} is "true", skip the DevOps Center query and report: `[SKIP] WI freshness check skipped (--quick).`

If the MCP query fails (server not connected, auth expired), log the failure and continue with Sources 1+2 only: `[SKIP] WI freshness check — MCP unavailable: {error}`

### 2. Merge and Classify

For each item, resolve:

- **Tracking type:** `WI` (has `devops_wis` entry) or `Backlog-only` (no WI)
- **Assignment:** Match `assigned_to` against {{currentUserName}}. For WI items, also cross-reference DevOps Center `owner` against {{currentSfUserId}}.
- **Status:** Use DevOps Center as ground truth for WI items. Use backlog `status` for non-WI items.

### 3. Check for Drift

**WI Status Drift:** If DevOps Center data was retrieved, compare WI statuses against MEMORY.md rows. Flag any mismatches.

**Assignment Drift:** Compare backlog `assigned_to` against DevOps Center WI `owner`. Flag:

- Backlog says unassigned but WI has owner — **Backlog behind**
- Backlog and WI disagree on assignee — **Assignment mismatch**
- Backlog has assignee but WI has no owner — **WI behind**

If DevOps Center was skipped, skip drift checks: `[SKIP] Assignment drift check skipped (no WI data).`

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

| BL | WI | Title | Status | Type | Notes |
|----|----|----|--------|------|-------|
| BL-NNNN | WI-NNNNNN | {title} | In Progress | WI | {brief context} |
| BL-NNNN | — | {title} | In Progress | Backlog-only | {brief context} |

#### Team Active Work ({n} items)

**{Team member name}** ({n} items): {one-line summary of their focus}
- BL-NNNN: {title} ({status})

#### Unassigned Active Work ({n} items)

| BL | WI | Title | Status | Type | Priority |
|----|----|-------|--------|------|----------|
| BL-NNNN | WI-NNNNNN | {title} | In Progress | WI | P2 |

{If unassigned In Progress items exist:}
**Note for project lead:** {n} unassigned active items — consider assigning or claiming via `/backlog update BL-NNNN`

**Pending decisions:** {list or "None"}
**Blocked items:** {list with blockers or "None"}
**WI status drift:** {findings or "None (memory current)"}
**Assignment drift:** {findings or "None — backlog and DevOps Center assignments match"}
```

If {{currentSfUserId}} could not be resolved, skip assignment splitting: `[SKIP] Assignment filtering unavailable (.env missing SF_USER_ID).` Show all items in one flat table.
