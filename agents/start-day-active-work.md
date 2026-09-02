---
name: start-day-active-work
description: Use this agent when /start-day needs a unified view of active work across MEMORY.md, the backlog, and GitHub Issues. Runs in parallel with the git-state and external-context agents. Typical triggers include a daily briefing that must report what work is currently active, and a need to see that work split by assignee. See "When to invoke" in the agent body for worked scenarios.
model: inherit
color: yellow
tools: ["Read", "Grep", "Glob", "Bash"]
---

# Start-Day: Active Work Agent

## When to invoke

- **A daily briefing needs the active work list.** Merges status from memory, the backlog, and GitHub Issues into a single view rather than three partial ones.
- **Work needs separating by assignment.** Reads local files and queries Issues to split owned work from unowned.

## Your Job

Build a unified view of all active work from memory, backlog, and GitHub Issues. Split by assignment: current user's work, team work, and unassigned. Active work = any item that is In Progress OR (Ready + assigned).

## Reference Files

- Read `.claude/memory/MEMORY.md` — Active Work Items table for Issue status, assignment, notes
- Query `gh issue list --state open --label "status:in-progress" --json number,title,labels,assignees` (repeat for `status:ready`)
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

**Source 1 — MEMORY.md:** Read the Active Work Items table from `.claude/memory/MEMORY.md`. Extract Issue number, name, backlog ID, assigned, status, and notes for each row.

**Source 2 — Backlog:** Read the backlog source (GitHub Issues or YAML file, depending on `backlog.backend`). Filter to items where `status` is `In Progress` or `Ready`. For each, extract: id, title, status, assigned_to, Issue references, blocked_by, priority, effort.

**Source 3 — GitHub Issues (if not quickMode):** Query live Issue status from GitHub.

If {{quickMode}} is "true", skip the Issue query and report: `[SKIP] Issue freshness check skipped (--quick).`

Run: `gh issue list --repo {workTracking.issueRepo} --state open --json number,title,state,labels,assignees --limit 50`

Parse the JSON output:
- For each issue, extract status from labels matching `status:*` (e.g., `status:in-progress`). If no status label, use the issue state (`open` → "Not Started").
- Extract assignee from the `assignees` array.
- Match issues to backlog items by checking if the issue title or number appears in MEMORY.md or backlog context.
- Classify as "Your Active Work" (assigned to `{{currentUserName}}`), "Team Active Work" (assigned to others), or "Unassigned."

If the `gh` query fails (not authenticated, no network), log the failure and continue with Sources 1+2 only: `[SKIP] Issue freshness check — gh unavailable: {error}`

### 2. Merge and Classify

For each item, resolve:

- **Tracking type:** `Issue` (has an Issue reference) or `Backlog-only` (no Issue)
- **Assignment:** Match `assigned_to` against {{currentUserName}}. For Issues, use `assignees` from the Issue JSON.
- **Status:** Use GitHub Issues as ground truth for tracked items. Use backlog `status` for backlog-only items.

### 3. Check for Drift

**Issue status drift:** If Issue data was retrieved, compare statuses against MEMORY.md rows and the backlog context. Flag any mismatches.

**Assignment drift:** Compare backlog assignments against GitHub Issues. Flag:

- Backlog says unassigned but Issue has assignee — **Backlog behind**
- Backlog and Issue disagree on assignee — **Assignment mismatch**
- Backlog has assignee but Issue has no assignee — **Issue behind**

If the Issue query was skipped, skip drift checks: `[SKIP] Assignment drift check skipped (no Issue data).`

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
| BL-NNNN | #NN | {title} | In Progress | Issue | {brief context} |
| BL-NNNN | — | {title} | In Progress | Backlog-only | {brief context} |

#### Team Active Work ({n} items)

**{Team member name}** ({n} items): {one-line summary of their focus}
- BL-NNNN: {title} ({status})

#### Unassigned Active Work ({n} items)

| BL | Ref | Title | Status | Type | Priority |
|----|----|-------|--------|------|----------|
| BL-NNNN | #NN | {title} | In Progress | Issue | P2 |

{If unassigned In Progress items exist:}
**Note for project lead:** {n} unassigned active items — consider assigning or claiming via `/backlog update BL-NNNN`

**Pending decisions:** {list or "None"}
**Blocked items:** {list with blockers or "None"}
**Issue status drift:** {findings or "None (memory current)"}
**Assignment drift:** {findings or "None — backlog and Issue assignments match"}
```

If {{currentSfUserId}} could not be resolved, skip assignment splitting: `[SKIP] Assignment filtering unavailable (.env missing SF_USER_ID).` Show all items in one flat table.
