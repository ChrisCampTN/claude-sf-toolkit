---
name: lookback
description: Retrospective skill — reviews recent commits, audits existing memories, proposes mechanism + shared memory changes, requires developer approval before writing
---

# /lookback — Retrospective & Shared Feedback Review

Review recent work, identify patterns worth encoding as shared feedback, and update `.claude/memory/` after explicit developer approval. **Propose-then-approve** — Claude drafts all memory changes; nothing is written until the developer reviews and confirms.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- Empty — review commits since the last lookback entry in `.claude/memory/MEMORY.md`, or last 10 commits if no prior lookback
- `--since {date}` — review commits after this date (ISO: `2026-03-20`)
- `--last {n}` — review the last N commits
- `--workstream {name}` — focus on a specific workstream (workstream names come from CLAUDE.md or docs/platform-brief.md in the target project)

Examples:

```
/lookback
/lookback --since 2026-03-20
/lookback --last 20
/lookback --workstream lwc
```

---

## Resolution

**Cache-first resolution:**

1. Read `.claude/sf-toolkit-cache.json` in the project root.
2. If the file exists and `_cache.expiresAt` is after the current date/time:
   - Read `.sf/config.json` — confirm `target-org` matches `orgs.devAlias` in the cached context.
   - If it matches: use the cached context (all keys except `_cache`). **Skip the agent dispatch.**
3. If the cache is missing, expired, or the org alias doesn't match: dispatch the `sf-toolkit-resolve` agent. It will resolve fresh context and update the cache.

Use the returned context for all org references, team lookups, and path resolution in subsequent steps. If `missing` contains values this skill requires, stop and instruct the developer to run `/setup`.

---

## Step 1 — Determine Scope

Parse `$ARGUMENTS` to set:

- `sinceDate` — from `--since`, or derive from last lookback entry in `.claude/memory/MEMORY.md`
- `commitLimit` — from `--last` (default: 10 if no date can be determined)
- `workstreamFilter` — from `--workstream` (empty = all)

Run:

```bash
git log --oneline --since="{sinceDate}" --no-merges
# or
git log --oneline -{commitLimit} --no-merges
```

Report the commit range being reviewed:

```text
### Lookback Scope

**Commits reviewed:** {n} ({date range})
**Workstream filter:** {name or "all"}
```

---

## Step 2 — Review Recent Work

For each commit in scope, read the diff summary to understand what changed:

```bash
git show --stat {hash}
```

Also read any relevant memory files updated during this period — check modification timestamps or grep for recent dates in `.claude/memory/`.

Build a list of:

- What was built or changed (feature, fix, refactor, tooling)
- What categories of files were touched (skills, scripts, force-app/, docs, memory)
- Anything noted as blocked, deferred, or requiring follow-up in commit messages or memory

---

## Step 3 — Identify Patterns

Analyze the work from Step 2 through these lenses. For each finding, rate confidence: **High** (clear pattern, seen multiple times) or **Low** (one-off, worth noting but not encoding yet).

### What slowed us down?

- Repeated back-and-forth to fix the same category of error
- Tool or workflow gaps that required manual workarounds
- Missing context that had to be re-established

### What worked well?

- Approaches that were efficient or produced clean results the first time
- Skill or script behaviors that saved time
- Conventions that prevented problems

### What should change?

- Patterns that belong in a `feedback` memory (something Claude should always/never do)
- Skills or scripts that need a new capability
- CLAUDE.md candidates (architecture rule, workflow note, or key command)

### What's outstanding?

- Deferred items that haven't surfaced as open Issues or tasks yet
- Technical debt that accumulated during this period

If `workstreamFilter` is set, focus analysis on commits and files matching that workstream.

---

## Step 3.5 — Audit Existing Memories

Lookback is the process step that owns memory hygiene — without it, `.claude/memory/` only grows. Review the feedback memories touched by or related to this period's work, plus the 3–5 oldest entries in the `MEMORY.md` index, and evaluate each:

- **Retire** — the memory's "Working if:" signal shows it never fires, the underlying tool or process is gone, or the guidance is demonstrably wrong.
- **Merge** — overlaps another memory; combine into one file and delete the weaker.
- **Graduate to mechanism** — the rule is deterministic (a hook, `.claude/rules/` entry, script gate, or CI lint could enforce it). Propose the mechanism; retire the memory once it lands.
- **Keep** — still earning its place. No proposal needed.

Retire/merge/graduate findings become proposals in Step 4 alongside the new ones.

---

## Step 4 — Draft Proposals

For each High-confidence finding, first classify it:

- **Deterministic** — a machine could detect or prevent it (file pattern, command output, schema check). Propose a **mechanism**: hook, `.claude/rules/` entry, script gate, preflight check, or CI lint in the target project. Memory is the fallback, not the default.
- **Judgment** — requires context or discretion to apply correctly. Propose a **memory**.

Draft a proposed change per finding (including Step 3.5 audit outcomes):

| #   | Type      | Action | Target file                             | Summary                     |
| --- | --------- | ------ | --------------------------------------- | --------------------------- |
| 1   | mechanism | Create | `.claude/rules/xxx.md` or hook/CI check | {what it detects/prevents}  |
| 2   | feedback  | Create | `feedback_xxx.md`                       | {one-line description}      |
| 3   | feedback  | Update | `feedback_yyy.md`                       | {what changes and why}      |
| 4   | feedback  | Retire | `feedback_zzz.md`                       | {why it's dead — Step 3.5}  |
| 5   | project   | Update | `MEMORY.md`                             | {section and change}        |
| 6   | CLAUDE.md | Update | `CLAUDE.md`                             | {rule or note to add}       |

Every drafted `feedback` memory must end with a **"Working if:"** line — the observable signal that the rule is helping (e.g., "Working if: no deploy failures from stale manifests since adoption"). Step 3.5 uses these signals to retire dead rules in future lookbacks.

For Low-confidence findings, list them separately as **Observations (not proposed for memory)**. These are worth reviewing but don't warrant a permanent memory change yet.

Show the full draft content for each proposed change — don't just summarize, show what you'd write.

---

## Step 5 — Developer Review

**Stop here and present all proposals.**

```text
### Proposed Memory Changes ({n} total)

**Proposal 1 — {type}: {target file}**
{full draft content}
Action: Create / Update / Skip?

**Proposal 2 — ...**
...

**Observations (not proposed):**
- {finding} — reason not encoded: {one-off / needs more data / already covered}
```

Wait for explicit developer input on each proposal. Accept responses like:

- `approve all` — write all proposed changes
- `approve 1,3` — write only proposals 1 and 3
- `skip 2` — skip proposal 2, write the rest
- `edit 1: {new text}` — rewrite proposal 1 with the given text before writing
- `none` — discard all proposals, end the lookback

Do not proceed to Step 6 until the developer responds.

---

## Step 6 — Write Approved Changes

For each approved proposal:

1. **New `feedback` or `project` file** — Write to `.claude/memory/{filename}.md` using the standard frontmatter format. Update `.claude/memory/MEMORY.md` index with a one-line entry under the appropriate section.
2. **Update existing memory file** — Apply the change to `.claude/memory/{filename}.md`. Update the MEMORY.md index description if the summary changed.
3. **CLAUDE.md update** — Apply directly to `CLAUDE.md`.
4. **Mechanism** — Apply the hook / rules-file / script / CI change in the target project. If a memory previously covered the same ground, retire it in the same pass (with approval).
5. **Retire / merge (from Step 3.5)** — Delete the memory file (or fold its content into the surviving file) and remove its `MEMORY.md` index line.

After all writes, add or update the lookback timestamp in `.claude/memory/MEMORY.md`:

```
> Last lookback: {date} — {n} memories updated
```

Commit these changes using the `commit-commands` plugin (`/commit`).

Report what was written:

```text
### Lookback Complete

**Written:** {list of files created/updated}
**Skipped:** {list with reasons}
**CLAUDE.md:** {updated / no changes}
```

---

## Behavior Notes

- **Propose-then-approve only.** Never write to `.claude/memory/` or `CLAUDE.md` without explicit developer approval in Step 5. This is a shared memory system — changes affect all developers.
- **High bar for new feedback memories.** A pattern should appear at least twice or cause a real problem before it's worth encoding. Resist creating memories for one-off events.
- **Additive by default.** New findings extend existing memories rather than replacing them. Only replace when the old guidance is demonstrably wrong.
- **Prevention over memory.** Deterministic detection belongs in a mechanism (hook, rules file, script gate, CI lint) — memory is for judgment. When both could work, propose the mechanism.
- **Retirement is part of the job.** Step 3.5 is the sanctioned path for deleting or merging stale memories — still propose-then-approve, never silent.
- **Low-confidence findings stay as observations.** Don't promote them to memory just to have something to show. Leave them as notes for the developer to decide later.
- **Workstream focus sharpens signal.** When `--workstream` is set, depth over breadth — go deep on that area rather than producing generic observations.
