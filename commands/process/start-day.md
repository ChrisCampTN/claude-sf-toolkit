---
name: start-day
description: Daily planning briefing — calendar, email, Slack, git state, and memory for a prioritized work plan
---

# /start-day — Daily Planning Briefing

Review project state, surface open items from memory, git, calendar, email, and Slack, then produce a prioritized work plan for the session. **Read-only** — this skill gathers context and organizes, it does not modify code, deploy, or commit.

## Resolution

Dispatch the `sf-toolkit-resolve` agent. Use the returned context for all
org references, team lookups, and path resolution in subsequent steps.
If `missing` contains values this skill requires, stop and instruct the
developer to run `/setup`.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- Empty — full briefing (all steps)
- `--quick` — skip Steps 2, 3, and 5, produce a compact plan
- `--focus {topic}` — highlight items related to a specific workstream (e.g., `--focus deployment`, `--focus testing`, `--focus cleanup`)
- `--no-external` — skip Step 3 (calendar, email, Slack). Use when MCP servers are unavailable or you want a repo-only briefing.
- `--slack-channel {name}` — include a specific Slack channel in the Step 3 scan (repeatable: `--slack-channel deploys --slack-channel general`)

---

## Argument Resolution

Parse `$ARGUMENTS` once and resolve flags before entering any step:

- `quick` = true if `--quick` is present
- `noExternal` = true if `--no-external` is present
- `focusTopic` = value after `--focus` if present (lowercase)
- `slackChannels` = list of values after each `--slack-channel` (lowercase). Empty list if none provided.

### Date & Time Resolution

Resolve today's date **and current time** from the system clock — do **not** rely on the `currentDate` system context, which may be stale (set at conversation start, not at skill execution time).

```bash
date +%Y-%m-%d
date +%H:%M
```

Store as:

- `todayDate` — used for briefing header, calendar search ranges, email/Slack `after:` filters, relative date calculations
- `currentTime` — used for calendar time-awareness (filtering past meetings, calculating remaining focus windows)

Resolve the user's timezone from personal memory (e.g., `user_timezone.md`). If unavailable, default to the system clock timezone. All calendar event times from MCP are UTC — convert to the user's local timezone before display and comparison.

Cross-check: if email or calendar results contain timestamps from a different date than `todayDate`, trust the system clock (`date` command) over system context.

### Current User Resolution

Before entering any step, resolve the current user's identity for assignment-aware filtering using the resolver context:

- `currentUserName` ← `context.user.displayName`
- `currentSfUserId` ← `context.user.sfUserId`

If either value is in `missing`, log a warning and continue without assignment filtering. The briefing still works — it just can't highlight "your" items.

---

## Steps 1-3 — Parallel Data Gathering

Dispatch 3 purpose-built agents in parallel to gather independent data. Each agent returns structured markdown that feeds into Steps 4-6.

### Agent Prompt Files

1. `start-day-git-state` agent — Git state + org drift check
2. `start-day-active-work` agent — Memory + backlog + DevOps Center merge
3. `start-day-external-context` agent — Calendar, email, Slack

### Variable Substitution

Before dispatching, read each agent prompt file and replace `{{variable}}` placeholders with resolved values:

| Variable                  | Source                           | Value                         |
| ------------------------- | -------------------------------- | ----------------------------- |
| `{{todayDate}}`           | `date +%Y-%m-%d`                 | Resolved date                 |
| `{{currentTime}}`         | `date +%H:%M`                    | Resolved time                 |
| `{{currentUserName}}`     | `context.user.displayName`       | Resolved name or "unknown"    |
| `{{currentSfUserId}}`     | `context.user.sfUserId`          | Salesforce User ID or empty   |
| `{{quickMode}}`           | `--quick` flag                   | "true" or "false"             |
| `{{noExternal}}`          | `--no-external` flag             | "true" or "false"             |
| `{{yesterdayDate}}`       | todayDate minus 1 day            | Yesterday's date              |
| `{{slackChannels}}`       | `--slack-channel` args           | Comma-separated list or empty |
| `{{devOrgAlias}}`         | `context.orgs.devAlias`          | Dev sandbox org alias         |
| `{{productionOrgAlias}}`  | `context.orgs.productionAlias`   | Production org alias          |
| `{{searchKeywords}}`      | `context.searchKeywords`         | Keywords for external search  |

### Dispatch

Dispatch all 3 agents as **parallel foreground agents** in a single message using the Agent tool. Use `subagent_type: "general-purpose"` for all 3. Each agent receives its prompt with variables already substituted.

```
Agent 1: start-day-git-state
         description="Start-day: git state check"
         variables: {{todayDate}}, {{currentUserName}}, {{quickMode}}, {{devOrgAlias}}

Agent 2: start-day-active-work
         description="Start-day: active work review"
         variables: {{todayDate}}, {{currentUserName}}, {{currentSfUserId}}, {{quickMode}}, {{productionOrgAlias}}

Agent 3: start-day-external-context
         description="Start-day: external context"
         variables: {{todayDate}}, {{currentTime}}, {{yesterdayDate}}, {{noExternal}}, {{slackChannels}}, {{searchKeywords}}
```

### Collecting Results

Each agent returns structured markdown sections. Combine them into the data set for Steps 4-6:

- **Git State Agent** → provides: Git State section, Org Drift section
- **Active Work Agent** → provides: Active Work section (your work / team / unassigned), pending decisions, blocked items, WI drift, assignment drift
- **External Context Agent** → provides: Calendar section, Email section, Slack section

Present the combined results to the user in order: Git State → Org Drift → Active Work → Calendar → Email → Slack.

### Failure Handling

Three tiers of degradation:

**Tier 1 — Partial results:** Agent returns results with `[SKIP]` markers (e.g., org drift failed but git state succeeded). Use what it returned — the agent handled the failure gracefully.

**Tier 2 — Agent failure:** An agent fails completely (timeout, crash, tool permission denied). Log the failure and proceed with the other agents' results:

```text
[SKIP] {agent name} — agent failed: {error summary}
```

**Tier 3 — Total failure:** All 3 agents fail. Fall back to minimal briefing from local file reads only:

1. Run `git log --oneline -5` directly
2. Read `docs/backlog/backlog.yaml` for In Progress items
3. Read memory files for WI status
4. Skip external context entirely
5. Report: `[DEGRADED] Full briefing unavailable — showing minimal git + backlog state`

---

## Step 4 — Open Items Inventory

Build the consolidated open items list by pulling from all sources:

### 4a — Memory-sourced items

Scan memory files for open work **not already covered by Step 2 (active work) or Step 4a-bis (backlog pipeline)**:

- Cleanup tasks noted in project memories (orphaned metadata, stale docs, etc.)
- Items flagged as "next step", "pending", "open" that aren't tracked in backlog
- Sync notes or verification flags from memory (e.g., "verify WI-000016 status")

Skip items that are already tracked in the backlog — check `devops_wis` cross-references to avoid duplicates.

### 4a-bis — Backlog Pipeline

Read `docs/backlog/backlog.yaml` if it exists. **Skip items already surfaced in Step 2** (In Progress and Ready+Assigned are active work, not pipeline). This section covers what's coming next — the queue feeding into active work.

Extract:

1. **Ready but unassigned** — fully scoped, waiting for someone to claim. Show BL ID, title, effort, priority.
2. **Prioritized P1/P2** — evaluated but not yet Ready. Show BL ID, title, and what's missing (effort, complexity, assigned_to, design doc).
3. **Captured count** — untriaged items needing `/backlog evaluate`. Surface count + titles (max 5, then "and {n} more").
4. **Recently-modified incomplete items** — Check for backlog items with status `Captured` or `Evaluated` that were added or updated in the last 3 days (compare item `created` or `updated` dates against `todayDate - 3 days`). These represent **warm work from a recent session that may have been left incomplete**. Surface them separately:

```text
**Recently added / modified (last 3 days):**
- BL-NNNN: {title} (status: {status}, updated: {date}) — {context: "added last session", "modified but still Captured", etc.}
```

When listing backlog items, annotate assignment relative to the current user:

- Items where `assigned_to` matches `currentUserName` → show as **(you)**
- Items assigned to someone else → show their name
- Unassigned items → show **unassigned**

Report:

```text
### Backlog Pipeline

**Ready, unassigned:** {n}
- BL-NNNN: {title} (effort: {size}, priority: {P#})

**High priority, not Ready:** {n}
- BL-NNNN: {title} — needs: {missing fields}

**Needs triage:** {n} Captured items
- {titles, max 5, then "and {n} more"}
```

If `docs/backlog/backlog.yaml` does not exist, report `[SKIP] No backlog file found.`

### 4b — Git-sourced items

Check for signals in the repo:

- `.pending-docs.txt` — flows queued for `/doc-flows` documentation
- Uncommitted `force-app/` changes that may need a WI branch
- WI branches that exist on origin but may not be deployed/promoted

### 4c — External-sourced items (from Step 3)

If Step 3 ran, incorporate:

- Action-needed emails as open items (workstream: whichever matches, or "Incoming Requests")
- Actionable Slack mentions/DMs as open items
- Meetings that imply pre-work (e.g., a "deploy review" meeting means you should prep the deploy)

### 4d — Unprocessed Review Reports

Check for platform review and release review findings that haven't been processed into backlog items.

**Platform review:**

```bash
ls -d docs/platform-review/*/ 2>/dev/null | sort -r | head -1
```

If a platform review directory exists, check for `backlog-candidates.json`. If the file exists with candidates, check whether any backlog items reference `platform-review` as their `source`. If candidates exist but zero backlog items have `source: platform-review`, flag:

```text
**Unprocessed platform review:** {n} backlog candidates from {date} review — run `/platform-review --backlog-only` to triage
```

**Release reviews:**

```bash
ls docs/release-reviews/*.md 2>/dev/null
```

If release review files exist, check each for a `**Backlog processed:**` line at the end. Files without this marker have not been processed. Also check whether any backlog items reference `release-review` as their `source`. If unprocessed reviews exist, flag:

```text
**Unprocessed release reviews:** {list of unprocessed files} — run `/release-review --backlog-only` to systematically process into backlog
```

If both are fully processed or don't exist, skip silently.

### 4e — Categorize

Group all open items into workstreams. Read CLAUDE.md and `docs/platform-brief.md` for active initiative names and workstreams. Use these for focus filtering and priority assignment.

If `focusTopic` is set, lead with that workstream and mark others as "also open".

Report:

```text
### Open Items by Workstream

#### {Workstream 1} ({n} items)
| # | Item | Source | Status | Next Action |
|---|------|--------|--------|-------------|
| 1 | ... | memory/git/email/slack | ... | ... |

#### {Workstream 2} ({n} items)
...
```

---

## Step 5 — Prioritization

Rank all open items into a single prioritized list using these criteria:

1. **Assigned to you** — items from "Your Active Work" (Step 2) rank highest. These are _your_ work — they come first regardless of priority level.
2. **In-flight work** — items with branches, partial deploys, or active WIs come first (momentum). Both WI-backed and backlog-only items count equally if In Progress.
3. **Assignment-aware gating** — drift items, WIs, and backlog items assigned to other team members must **never** appear in "Do Today" or session recommendations, even as quick wins. They belong in "Team Active Work" reporting only. Unassigned items can appear in "Do Today" only for the backlog manager or if the item has no WI (pure backlog-only).
4. **Unblocked dependencies** — items that unblock other items rank higher
5. **Quick wins** — small items (<30 min) that clear clutter
6. **Business impact** — revenue and security initiatives over housekeeping (read CLAUDE.md and `docs/platform-brief.md` for current initiative priorities)
7. **Session fit** — prefer items that can be completed in a single session over multi-session epics
8. **Calendar awareness** — if Step 3 ran, scope "Do Today" to what fits in _remaining_ focus windows (from `currentTime`, not start of day). Flag items that need pre-meeting attention for upcoming meetings only — do not flag prep for meetings that have already ended.
9. **External urgency** — action-needed emails and Slack mentions with time pressure rank higher
10. **Backlog pipeline items** — Prioritized P1/P2 items from Step 4a-bis are candidates for promotion to active work, especially if unblocked and assigned
11. **Backlog triage** — if 5+ items have status `Captured` in the backlog, suggest a "Backlog triage" as a quick-win task

Apply tier labels:

| Tier          | Meaning                                             |
| ------------- | --------------------------------------------------- |
| **Do Today**  | High priority, unblocked, fits in available time    |
| **This Week** | Important but can wait a day or two                 |
| **Backlog**   | Open but not urgent — pick up when bandwidth allows |
| **Blocked**   | Cannot proceed until a dependency clears            |

If `quick` is set, report `[SKIP] Prioritization skipped (--quick).` and move to Step 6.

If `focusTopic` is set, prioritize items in that workstream as "Do Today" where possible and deprioritize unrelated items.

Report:

```text
### Prioritized Plan

**Available focus time:** {remaining hours} (from `currentTime` forward) or "Rest of day open" if no upcoming meetings / Step 3 skipped

#### Do Today
| # | Item | Est. Effort | Notes |
|---|------|-------------|-------|
| 1 | ... | ... | ... |

#### This Week
...

#### Backlog
...

#### Blocked
| # | Item | Blocked By |
|---|------|------------|
```

---

## Step 6 — Session Recommendations

Based on the prioritized list, suggest 1-2 concrete session plans. Each option ends with a **prompt starter** — a ready-to-paste message the user can send to kick off the session immediately.

````text
### Recommended Session Plan

**Option A — {theme}** ({estimated scope})
1. {first task}
2. {second task}
3. {third task}
Expected outcome: {what's done by end of session}

**Prompt starter:**
\```
{a natural-language prompt that would initiate Option A's work, e.g., "Deploy the notification types (WI-000044) and permission sets (WI-000045), then run /devops-commit for each."}
\```

**Option B — {theme}** ({estimated scope})
1. ...
Expected outcome: ...

**Prompt starter:**
\```
{a natural-language prompt that would initiate Option B's work}
\```
````

Criteria for good session plans:

- Tasks are in dependency order
- Mix of quick wins and substantive work where possible
- Clear stopping point (don't leave force-app/ changes uncommitted)
- Ends with a `/wrap-up` or clean git state
- **Time-boxed to remaining focus windows** if calendar data is available — only reference _upcoming_ windows, not past ones (e.g., "fits in your 1:00-2:30pm window before the next meeting")
- **Active work first:** Session options should draw primarily from "Your Active Work" (Step 2). Include unassigned active items only if you're the backlog manager or they align with the session theme.
- **Pipeline promotion:** If Ready+unassigned items from Step 4a-bis fit the session theme, suggest claiming and starting them.
- **Backlog triage option:** If 5+ Captured items exist, offer a dedicated "Backlog triage" session option using `/backlog prioritize`

If `focusTopic` is set, both options should center on that workstream.

Criteria for good prompt starters:

- **Specific and actionable** — name the exact WIs, files, or skills involved so Claude can start immediately without clarification
- **Scoped to the session plan** — covers the full sequence of tasks in the option, not just the first one
- **Includes skill invocations** where appropriate (e.g., `/deploy-changed`, `/devops-commit WI-NNNNNN`, `/doc-flows`)
- **One prompt per option** — the user picks an option and pastes the prompt to go

### Lookback Cadence Check

After presenting the session plan options, check if lookback is due by scanning git log for feedback memory commits in the last 7 days:

```bash
git log --oneline --since="7 days ago" -- '.claude/memory/feedback_*.md'
```

If this returns any commits, lookback has run recently — skip the reminder.

If no commits are returned (no feedback memory changes in the last 7 days), surface the reminder:

```text
---
**Lookback reminder:** It's been more than 7 days since `/lookback` was last run.
Shared feedback memories help the whole team — consider running it before starting today's session or at the end if a meaningful workstream closes.

Run: `/lookback` (or `/lookback --workstream {topic}` to focus)
---
```

If the check cannot be determined (e.g., git log unavailable), skip silently.

### Platform Review Cadence Check

Check when `/platform-review` was last run by looking for the most recent `docs/platform-review/*/` directory:

```bash
ls -d docs/platform-review/*/ 2>/dev/null | sort -r | head -1
```

If no directory exists or the most recent is more than 80 days old, surface a reminder:

```text
---
**Platform review reminder:** It's been more than 90 days since the last `/platform-review` run{or "No platform review has been run yet"}.
Quarterly reviews keep security, testing, documentation, and tooling gaps from compounding.

Run: `/platform-review --no-backlog` (backlog bridge can be done separately with `--backlog-only`)
---
```

If the last review is within 80 days, skip silently.

---

### Tooling Review Cadence Check

Check `docs/tooling-reviews/` for the Last Reviewed date. Remind if >7 days:

```bash
head -5 docs/tooling-reviews/sf-cli.md 2>/dev/null | grep "Last Reviewed:"
```

Extract the date from the "Last Reviewed:" line. If the file doesn't exist or the date is more than 7 days ago, surface the reminder:

```text
---
**Tooling review reminder:** It's been more than 7 days since `/tooling-review` was last run{or "No tooling review baseline exists yet — run /tooling-review to establish baseline"}.
SF CLI and MCP server releases ship weekly — check for new capabilities and adoption opportunities.

Run: `/tooling-review` (weekly check) or `/tooling-review --audit` (full capability audit)
---
```

If the last review is within 7 days, skip silently.

---

## Behavior Notes

- **Read-only.** This skill does not modify files, deploy, or commit. It gathers context and presents a plan.
- **Memory is context, not truth.** Memory entries may be stale. When a memory claims something exists or has a certain status, note it but flag if verification is needed (e.g., "WI-000021 — memory says Done/Verify, confirm in org").
- **Don't overwhelm.** If there are 30+ open items, summarize the lower-priority ones rather than listing every detail. The goal is a clear, actionable plan — not an exhaustive inventory.
- **Respect focus.** When `--focus` is set, the user wants to zoom in. Keep other workstreams to a one-line mention, not full tables.
- **No time estimates.** Avoid giving time predictions. Use effort labels (Small / Medium / Large) instead of hours.
- **Graceful degradation.** If Outlook or Slack MCP servers are not connected, log which source was unavailable and continue with the rest. The briefing should never fail because an external tool is down.
- **Privacy-conscious.** Summarize email/Slack content — don't dump full message bodies into the briefing. Keep summaries to one line per item.
- **Deduplication.** The same item may surface from multiple sources (e.g., a Slack message about a WI that's also in memory). Merge duplicates and note all sources.
