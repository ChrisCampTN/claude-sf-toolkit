---
name: wrap-up
description: End-of-session checklist — commit outstanding work, check docs staleness, maintain memory, check Issue status
---

# /wrap-up — End-of-Session Wrap-Up

Run through the standard end-of-conversation checklist: commit outstanding work, check for stale docs, maintain memory, and surface reminders. **Execute-first** — perform actions directly and report results. Only pause on errors, conflicts, or ambiguous session scope.

## Resolution

**Cache-first resolution:**

1. Read `.claude/sf-toolkit-cache.json` in the project root.
2. If the file exists and `_cache.expiresAt` is after the current date/time:
   - Read `.sf/config.json` — confirm `target-org` matches `orgs.devAlias` in the cached context.
   - If it matches: use the cached context (all keys except `_cache`). **Skip the agent dispatch.**
3. If the cache is missing, expired, or the org alias doesn't match: dispatch the `sf-toolkit-resolve` agent. It will resolve fresh context and update the cache.

Use the returned context for all org references, team lookups, and path resolution in subsequent steps. If `missing` contains values this skill requires, stop and instruct the developer to run `/setup`.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- Empty — run all checks
- `--review` — run `code-review:code-review` on session changes before committing (Step 2B)
- `--skip-memory` — skip the memory maintenance step
- `--skip-readme` — skip the README staleness check
- `--skip-status-check` — skip the Issue status check step

---

## Argument Resolution

Parse `$ARGUMENTS` once and resolve flags before entering any step:

- `runReview` = true if `--review` is present
- `skipReadme` = true if `--skip-readme` is present
- `skipMemory` = true if `--skip-memory` is present
- `skipStatusCheck` = true if `--skip-status-check` is present

Steps check these resolved flags and skip entirely if set, reporting `[SKIP] {step} skipped ({flag}).`

---

## Step 1 — README Staleness Check

Determine whether this session introduced structural changes that could make README.md stale. This runs first so any README edits are included in the Step 3 commit.

**Trigger conditions** — run this check if ANY of the following changed during the session (check git log for commits made today, plus any uncommitted changes):

- New or renamed files in `.claude/commands/` (skills)
- New top-level directories or files in `scripts/`, `config/`, `docs/`
- Changes to `CLAUDE.md` (new commands, architecture rules, key paths)
- New SF CLI plugins or MCP server configuration
- Changes to `docs/coding-standards.md` or `docs/build-review-process.md`

**How to check:**

```bash
git diff --name-only HEAD~{n}..HEAD
git status --short
```

Where `{n}` is the number of commits made during this session. Include both committed and uncommitted changes.

Cross-reference changed paths against what README.md documents:

1. Read README.md
2. Check: does the skills table match `.claude/commands/`?
3. Check: does the project structure section reflect current top-level dirs?
4. Check: are key commands still accurate?
5. Check: does `docs/coding-standards.md` content match any references in README.md?
6. Check: does `docs/build-review-process.md` content match any references in README.md?

**If gaps found:** Apply edits directly. Report what changed — the edits will be included in Step 3's commit.

**If no structural changes or docs are current:**

```text
[OK] README and docs are current — no structural changes this session.
```

If `skipReadme` is set, report `[SKIP] README check skipped (--skip-readme).` and move to Step 2.

---

## Step 2 — Memory Maintenance

Review what happened this session and determine if any memories should be created, updated, or removed. This runs before the commit step so any new/updated memory files are included.

### Check for new memories to create

Scan the conversation for:

- **User feedback** — corrections ("don't do X"), confirmations of approach ("yes, that's right"), or explicit preferences. These become `feedback` type memories.
- **Project decisions** — new work items, status changes, architecture decisions, deadline changes. These become `project` type memories.
- **User context** — new info about the user's role, expertise, or working style. These become `user` type memories.
- **External references** — URLs, tool locations, Slack channels, dashboards. These become `reference` type memories.

### Check for stale memories to update

Read `MEMORY.md` and scan for memories that this session's work may have obsoleted:

- Issue status changes (e.g., an Issue moved from "in progress" to "done")
- Tooling decisions that were revisited
- Error patterns that were resolved

### Execute

Create/update/remove memory files and update MEMORY.md directly. **Before adding index lines, run `wc -l .claude/memory/MEMORY.md`** — the harness loads only the first 200 lines (25KB) at session start, so if the addition would push past ~195 lines, route it to a topical sub-index (`index_*.md`) instead. Report what changed:

```text
### Memory Maintenance

**Created:** {filename} — {one-line description}
**Updated:** {filename} — {what changed}
**Removed:** {filename} — {why}
**No action needed** — {reason, e.g., "No new patterns or feedback emerged"}
```

If `skipMemory` is set, report `[SKIP] Memory maintenance skipped (--skip-memory).` and move to Step 3.

---

## Step 2B — Code Review (opt-in)

If `runReview` is true, run `code-review:code-review` against the session's changes before committing. This provides a lightweight quality gate — catches bugs, CLAUDE.md compliance issues, and code quality problems that session momentum may have glossed over.

1. Identify the diff scope: all uncommitted changes plus any commits made during this session.
2. Invoke `code-review:code-review` with that scope.
3. Report findings. If high-confidence issues (score >= 80) are found:
   - List them with file paths and descriptions
   - Ask: "Fix these before committing, or proceed as-is?"
   - If the user wants fixes, apply them before moving to Step 3.

If `runReview` is false (default), skip this step entirely — no message needed.

---

## Step 3 — Uncommitted Changes

Check for outstanding work that hasn't been committed. **Only handle changes made during the current session** — do not stage or commit uncommitted work left over from prior sessions. Use conversation context (what skills ran, what categories were documented, what files were edited) to determine session scope.

```bash
git status -u
git diff --stat
git diff --cached --stat
```

**If changes exist:**

### 3a — Scope to Current Session

Filter the full `git status` output to only files touched during this session. Indicators of session scope:

- Files created or modified by tools used in this conversation
- Categories processed by `/doc-flows`, `/deploy-changed`, or other skills this session
- Files explicitly edited or created by the user's requests

Changes from prior sessions should be noted but **not committed**. Report them under a separate "Prior session changes (not committed)" heading so the user has visibility.

### 3b — Categorize Session Changes

Split current-session changes into two commit routes:

| Category            | How to identify                                                   | Commit route                                                                                                |
| ------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Repo-only files** | `docs/**/*.md`, `.claude/commands/*.md`, `CLAUDE.md`, `README.md` | Commit on the **feature branch**, push to origin |
| **SF metadata**     | `force-app/**` (flow XMLs, objects, fields, etc.)                 | Commit on the **feature branch**, push to origin |
| **Skill files**     | `.claude/commands/*.md`                                           | Same as repo-only, but remind: `/skill-preflight` should run before committing modified skills |

All changes (repo-only AND SF metadata) go on the **feature branch** (`feature/issue-{id}-{slug}`) — the feature branch is the work unit. Commit everything together and push. GitHub Actions handles validation on PR and deployment on merge.

### 3c — Execute Commits

Execute directly — no confirmation prompt:

1. **Single commit on feature branch:** Stage all changes (repo-only + `force-app/`) and commit using `/commit-commands:commit`. All files belong on the feature branch together.
2. **Push:** `git push` the feature branch to origin.

**Pause only if:** not on a feature branch (suggest creating one via `/backlog graduate #{NN}`), or merge conflict.

Report results:

```text
### Commits

**feature/issue-{id}-{slug}:** {short hash} — {message} (pushed to origin)

**Prior session changes (not committed):**
- {n} files from other sessions still uncommitted
```

**If no current-session changes:** Report clean and move on.

```text
[CLEAN] No uncommitted changes from this session.
{n} files from prior sessions remain uncommitted (use /wrap-up in those sessions or commit manually).
```

---

## Step 4 — Push Status

Check if local main is ahead of origin. If ahead, push directly.

```bash
git rev-list --count origin/main..main
```

**If ahead:** Push and report:

```text
[PUSHED] {n} commits pushed to origin/main.
```

**If current:**

```text
[OK] Local main is up to date with origin.
```

---

## Step 5 — Issue Status Check

If `skipStatusCheck` is set, report `[SKIP] Status check skipped (--skip-status-check).` and move to Step 6.

Query current Issue status directly (no sync needed — Issues are always live):

Run: `{workTracking.listActiveCmd}` (substituting `{issueRepo}` with `workTracking.issueRepo`)

Parse the JSON output and report:

```text
### Active Issues

| # | Title | Status | Assignee |
|---|-------|--------|----------|
| {number} | {title} | {state + status label} | {assignee} |

{n} open issues assigned to you.
```

If the `gh` command fails (auth expired, no network), log the failure and continue.

---

## Step 6 — Session Summary

Present a concise summary of everything that happened.

```text
## Session Summary

**Commits this session:** {n}
- {short hash} {message}
- ...

**Files changed:** {n} across {categories}
**Deployed:** {yes/no — note any /deploy-changed runs}
**Skills modified:** {list or "none"}
**Memory updates:** {list or "none"}
**Open items for next session:** {any TODOs, unfinished work, or follow-ups}
**Lookback candidate:** {yes — reason (e.g. major workstream closed, initiative pivot) | no}
```

If a lookback is warranted, note it but do not run it. Suggest: `Run /lookback to capture patterns and update shared feedback memories.`

---

## Behavior Notes

- **Execute-first.** Commit, push, and deploy current-session work without asking. Only pause on errors, conflicts, or ambiguous scope.
- **Current session only.** Never commit, push, or deploy work from prior sessions. Report prior-session leftovers for visibility but leave them untouched.
- **No org queries.** Step 5 queries GitHub (`gh`) for Issue status. All other checks are local git commands and file reads.
- **No lookback.** Retrospectives are not run automatically — they affect shared feedback memories and require intentional review. Surface lookback candidates in Step 6 but leave execution to the developer via `/lookback`.
- **Respect `--skip-*` flags.** Skip the indicated steps entirely.
- This skill can be invoked at any point, not just end-of-session. It's safe to run mid-conversation as a checkpoint.
