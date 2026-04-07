---
name: wrap-up
description: End-of-session checklist — commit outstanding work, check docs staleness, maintain memory, sync WI status
---

# /wrap-up — End-of-Session Wrap-Up

Run through the standard end-of-conversation checklist: commit outstanding work, check for stale docs, maintain memory, and surface reminders. **Execute-first** — perform actions directly and report results. Only pause on errors, conflicts, or ambiguous WI assignment.

## Resolution

Dispatch the `sf-toolkit-resolve` agent. Use the returned context for all
org references, team lookups, and path resolution in subsequent steps.
If `missing` contains values this skill requires, stop and instruct the
developer to run `/setup`.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- Empty — run all checks
- `--review` — run `code-review:code-review` on session changes before committing (Step 2B)
- `--skip-memory` — skip the memory maintenance step
- `--skip-readme` — skip the README staleness check
- `--skip-wi-sync` — skip the WI status sync step

---

## Argument Resolution

Parse `$ARGUMENTS` once and resolve flags before entering any step:

- `runReview` = true if `--review` is present
- `skipReadme` = true if `--skip-readme` is present
- `skipMemory` = true if `--skip-memory` is present
- `skipWiSync` = true if `--skip-wi-sync` is present

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

- Work item status changes (e.g., a WI moved from "Not Started" to "Done")
- Tooling decisions that were revisited
- Error patterns that were resolved

### Execute

Create/update/remove memory files and update MEMORY.md directly. Report what changed:

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
| **Repo-only files** | `docs/**/*.md`, `.claude/commands/*.md`, `CLAUDE.md`, `README.md` | Commit on **main**, push to origin directly                                                                 |
| **SF metadata**     | `force-app/**` (flow XMLs, objects, fields, etc.)                 | Commit on **WI branch**, push WI branch for DevOps Center promotion                                         |
| **Skill files**     | `.claude/commands/*.md`                                           | Commit on **main** (repo-only), but remind: `/skill-preflight` should run before committing modified skills |

**Why the split:** SF metadata changes (`force-app/`) are source-tracked by DevOps Center and must go through the promotion pipeline (dev sandbox → Staging → Production). Committing them to main would bypass the pipeline. Repo-only files (docs, skills, memory) are not deployed to Salesforce and can live on main directly.

### 3c — Execute Commits

Execute directly — no confirmation prompt:

1. **Main commit first:** Stage repo-only files and commit using `/commit-commands:commit`. **NEVER stage `force-app/` files on main** — SF metadata must only be committed to WI branches. DevOps Center merges WI branches back to main after promotion.
2. **WI branch commit via `/devops-commit`:** If there are `force-app/` changes and a WI number is known, invoke `/devops-commit WI-NNNNNN` which handles: stashing, checking out the WI branch, committing only `force-app/` files, pushing, deploying to the dev sandbox, and returning to main.
3. **Return to main:** If `/devops-commit` was used, it handles the return automatically. Pop stash to restore any remaining uncommitted work from prior sessions.

**Pause only if:** no WI branch exists (user must create via DevOps Center UI), merge conflict, or ambiguous WI assignment for `force-app/` files.

Report results:

```text
### Commits

**main:** {short hash} — {message} (pushed to origin)
**WI-{number}:** {short hash} — {message} (pushed + deployed to dev sandbox)

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

### Also check for WI branches with undeployed metadata

WI branches may have been pushed to origin in prior sessions but never deployed to the dev sandbox. Without deployment, DevOps Center cannot promote them.

```bash
git branch -r | grep 'origin/WI-'
```

For each WI branch, check if it has `force-app/` changes vs main:

```bash
git diff --name-only origin/main..origin/{WI-branch} -- 'force-app/'
```

If any WI branches have undeployed metadata, report them. **Do not deploy prior-session WI branches automatically** — they are out of scope for this session. Flag them so the user has visibility:

```text
### WI Branches with Undeployed Metadata (prior sessions)

| Branch | Metadata files | Status |
|---|---|---|
| WI-{number} | {n} flow XMLs, {n} objects, ... | Pushed to origin, deploy status unknown |

Deploy these in their respective sessions or manually via:
sf project deploy start --target-org {context.orgs.devAlias} --source-dir {paths}
```

**Note:** Only deploy `force-app/` files — never deploy docs, skills, or CLAUDE.md to the org.

---

## Step 5 — WI Status Sync

Run `/wi-sync` (full sync — updates MEMORY.md) to reconcile live DevOps Center status against the WI tables in MEMORY.md. The sync queries `{context.orgs.productionAlias}` for current WI status.

If `skipWiSync` is set, report `[SKIP] WI sync skipped (--skip-wi-sync).` and move to Step 6.

If the org query fails (unreachable, auth expired), log the failure and continue — do not block the wrap-up.

This runs **after** commits and push (Steps 3–4) so any WIs deployed this session are reflected in the live status before memory is updated.

Report the sync result inline:

```text
### WI Sync

{n} rows updated, {n} discrepancies flagged, {n} skipped (manual review).
```

If zero changes: `[OK] MEMORY.md WI tables are current.`

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
- **One org query per wrap-up.** Step 5 queries `{context.orgs.productionAlias}` for WI status. All other checks are local git commands and file reads.
- **No lookback.** Retrospectives are not run automatically — they affect shared feedback memories and require intentional review. Surface lookback candidates in Step 6 but leave execution to the developer via `/lookback`.
- **Respect `--skip-*` flags.** Skip the indicated steps entirely.
- This skill can be invoked at any point, not just end-of-session. It's safe to run mid-conversation as a checkpoint.
