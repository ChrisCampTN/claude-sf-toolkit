# /claude-review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a `/claude-review` skill that tracks Claude Code and installed plugin releases, add review assignment config, and retrofit assignment-aware cadence checks to `/start-day`.

**Architecture:** New skill at `commands/documentation/claude-review.md` follows the same mode vocabulary as `/tooling-review` (weekly, audit, context, backlog-only) with Claude Code-specific version checking, web-based release note fetching, and project/plugin relevance filtering. Rolling report at `docs/tooling-reviews/claude-code.md`. Assignment config in `config/sf-toolkit.json` gates all three cadence checks in `/start-day`.

**Tech Stack:** Markdown skill files, bash commands (`claude --version`, `claude plugin list`), WebSearch/WebFetch for release notes, existing backlog scripts.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `commands/documentation/claude-review.md` | Create | New skill — all 4 modes |
| `commands/process/start-day.md` | Modify (lines 396-438) | Add claude-review cadence check; retrofit assignment guards to all 3 existing checks |
| `commands/setup.md` | Modify (after Step 3, lines 98-103) | Add Review Assignments sub-step; add health check entry |
| `commands/help.md` | Modify (lines 33, 62, 223-226) | Add to Documentation group, file paths, REVIEW chain |
| `README.md` | Modify (lines 74, 82-83) | Update count, add table row |
| `package.json` | Modify (line 3) | Version 1.5.0 -> 1.6.0 |
| `.claude-plugin/plugin.json` | Modify (line 4) | Version 1.5.0 -> 1.6.0 |
| `.claude-plugin/marketplace.json` | Modify (line 11) | Version 1.5.0 -> 1.6.0 |

---

## Task 1: Create the claude-review skill — Frontmatter, Arguments, and Mode Resolution

**Files:**
- Create: `commands/documentation/claude-review.md`

This task creates the skill file with frontmatter, the introductory section, argument parsing, and mode resolution. No Resolution section (this is the first skill that doesn't need SF org context). Subsequent tasks append the mode implementations.

- [ ] **Step 1: Create the skill file with frontmatter, intro, and argument resolution**

Create `commands/documentation/claude-review.md` with the following content:

````markdown
---
name: claude-review
description: Claude Code + plugin release tracking — weekly review, quarterly audit, context lookup
---

# /claude-review — Claude Code & Plugin Release Review

Review Claude Code and installed plugin releases for adoption opportunities, audit capabilities against current workflows, and provide domain-specific capability lookups.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- Empty — weekly review (default). Check for new releases, fetch notes, classify, update report, propose backlog items.
- `--audit` — full capability inventory, cross-reference with project/plugin docs
- `--context <area>` — on-demand domain-specific capability lookup (e.g., `hooks`, `agents`, `mcp`)
- `--backlog-only` — process existing report adoption opportunities into backlog items without re-running analysis
- `--plugin` — switch relevance filter from project context to plugin architecture (modifier, combinable with any mode)

Examples:

```
/claude-review
/claude-review --audit
/claude-review --context hooks
/claude-review --backlog-only
/claude-review --plugin
/claude-review --audit --plugin
```

---

## Argument Resolution

Parse `$ARGUMENTS` and resolve flags:

```
AUDIT = true if --audit
CONTEXT_AREA = value after --context, or null
BACKLOG_ONLY = true if --backlog-only
PLUGIN_MODE = true if --plugin
MODE = "audit" if AUDIT, "context" if CONTEXT_AREA, "backlog-only" if BACKLOG_ONLY, else "weekly"
```

**Mode resolution:**

- `--audit` → run Audit flow (below)
- `--context <area>` → run Context Lookup flow (below). Does NOT update rolling files.
- `--backlog-only` → skip Steps 0-4, read existing report, extract Adopt Now / Evaluate items, run Step 5 (Propose Backlog Items)
- Default (no flags) → run Weekly Review Steps 0-5
- `--plugin` is a modifier — it switches the relevance context from the consuming project to the plugin's own architecture. Combinable with any mode.

Report the resolved mode:

```text
### Claude Review — {MODE}{" (plugin context)" if PLUGIN_MODE}
```
````

- [ ] **Step 2: Verify the file was created correctly**

Run:
```bash
head -60 commands/documentation/claude-review.md
```

Expected: Frontmatter with `name: claude-review`, title line, arguments table, mode resolution section.

- [ ] **Step 3: Run plugin validation**

```bash
node scripts/validate-plugin.js
```

Expected: PASS (the new command file has valid frontmatter and is discoverable).

- [ ] **Step 4: Commit**

```bash
git add commands/documentation/claude-review.md
git commit -m "feat(claude-review): add skill file with frontmatter and argument resolution"
```

---

## Task 2: Weekly Review — Step 0 (Check Versions)

**Files:**
- Modify: `commands/documentation/claude-review.md` (append after Argument Resolution)

- [ ] **Step 1: Append the Weekly Review header and Step 0**

Append to `commands/documentation/claude-review.md` after the closing of the Argument Resolution section (after the mode report code block):

````markdown

---

## Weekly Review (Default Mode) — Steps 0-5

### Step 0 — Check Versions

Get the current installed versions and compare against last-reviewed versions stored in the rolling report header.

**Claude Code version:**

```bash
claude --version
```

**Installed plugins:**

```bash
claude plugin list
```

Parse the output for tracked plugins. The tracked plugin list comes from `${CLAUDE_PLUGIN_ROOT}/scripts/check-dependencies.sh` — currently: `superpowers`, `commit-commands` (required) and `context7`, `skill-creator` (optional).

**Read last-reviewed state from report header:**

Read the first 10 lines of `docs/tooling-reviews/claude-code.md`. Parse:

- `**Claude Code Version:**` — the version at last review
- `**Plugin Versions:**` — `name version` pairs at last review
- `**Last Reviewed:**` — date of last review

If the report file does not exist, treat this as a **first run** (baseline mode) — proceed through all steps and create the report file.

**Version comparison:**

```
CC_CURRENT = claude --version output
CC_LAST = "Claude Code Version" from report header
PLUGINS_CURRENT = { name: version } from claude plugin list
PLUGINS_LAST = { name: version } from report header
CC_CHANGED = CC_CURRENT != CC_LAST
PLUGINS_CHANGED = any plugin version differs
```

If BOTH are unchanged (no new releases since last review):

```text
### No New Releases

**Claude Code:** {CC_CURRENT} (last reviewed {date})
**Plugins:** all unchanged (last reviewed {date})

No new releases since last review. Run `/claude-review --audit` for a capability audit or `/claude-review --context <area>` for a domain lookup.
```

Stop here. Do not proceed to Step 1.

If either changed, report which have updates and continue:

```text
### Version Check

**Claude Code:** {CC_LAST} -> {CC_CURRENT} {NEW or unchanged}
**Plugins:**
  superpowers: {last} -> {current} {NEW or unchanged}
  commit-commands: {last} -> {current} {NEW or unchanged}
  context7: {last} -> {current} {NEW or unchanged}
  skill-creator: {last} -> {current} {NEW or unchanged}

Proceeding with review for updated tool(s).
```
````

- [ ] **Step 2: Verify the appended content**

Run:
```bash
wc -l commands/documentation/claude-review.md
```

Expected: ~120-130 lines (frontmatter + argument resolution + Step 0).

- [ ] **Step 3: Commit**

```bash
git add commands/documentation/claude-review.md
git commit -m "feat(claude-review): add weekly Step 0 — version checking"
```

---

## Task 3: Weekly Review — Step 1 (Fetch Release Notes)

**Files:**
- Modify: `commands/documentation/claude-review.md` (append after Step 0)

- [ ] **Step 1: Append Step 1 — Fetch Release Notes**

Append to `commands/documentation/claude-review.md` after the Step 0 section:

````markdown

---

### Step 1 — Fetch Release Notes

Only fetch notes for tools that have new versions (from Step 0).

**Claude Code (if CC_CHANGED):**

1. Primary: WebSearch for `"claude code" release {CC_CURRENT} site:github.com/anthropics`
   Then WebFetch the most relevant result (releases page or changelog).

2. Secondary: Check npm package metadata:
   ```bash
   npm view @anthropic-ai/claude-code --json 2>/dev/null
   ```

3. Tertiary: WebSearch for `"claude code" {CC_CURRENT} changelog site:docs.anthropic.com OR site:anthropic.com`

4. Graceful degradation: if all sources fail, note what was skipped and proceed with version-only tracking.

**Installed plugins (if PLUGINS_CHANGED):**

For each changed plugin, check its GitHub repo for release notes:

1. WebSearch for `"{plugin-name}" claude code plugin release {version} site:github.com`
2. If the plugin list output includes a source URL, WebFetch that URL's releases page.
3. If no release notes are found, note: "Release notes unavailable for {plugin-name} {version}"

Collect all NEW/CHANGE/FIX/DEPRECATION entries from each source.
````

- [ ] **Step 2: Commit**

```bash
git add commands/documentation/claude-review.md
git commit -m "feat(claude-review): add weekly Step 1 — fetch release notes"
```

---

## Task 4: Weekly Review — Step 2 (Build Relevance Context)

**Files:**
- Modify: `commands/documentation/claude-review.md` (append after Step 1)

- [ ] **Step 1: Append Step 2 — Build Relevance Context**

Append to `commands/documentation/claude-review.md`:

````markdown

---

### Step 2 — Build Relevance Context

The relevance context determines how release note entries are filtered and classified. The `--plugin` modifier switches which context is used.

**Default mode (project context):**

Read the consuming project's Claude Code configuration:

- `.claude/settings.json` — hooks configured, permission rules
- `CLAUDE.md` — project instructions, patterns, constraints
- `.mcp.json` — MCP servers configured
- `.claude/agents/*.md` — project-level agents (if any)
- `.claude/skills/**` — project-level skills (if any)

Produce a "capabilities in use" inventory: which hook events, which MCP servers, which agent patterns, which skill features the project actively uses.

**`--plugin` mode (plugin architecture context):**

Read the plugin's own architecture:

- `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` — registered hooks, agents, skills
- `${CLAUDE_PLUGIN_ROOT}/CLAUDE.md` — key patterns, conventions
- `${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json` — hook event types in use
- `${CLAUDE_PLUGIN_ROOT}/agents/*.md` frontmatter — agent features (model, tools, color)
- `${CLAUDE_PLUGIN_ROOT}/commands/**/*.md` frontmatter — skill patterns (`$ARGUMENTS`, `${CLAUDE_PLUGIN_ROOT}`)

Produce a "plugin capabilities" inventory: which hook event types, which agent dispatch patterns, which skill frontmatter features, which `${CLAUDE_PLUGIN_ROOT}` resolution patterns the plugin uses.
````

- [ ] **Step 2: Commit**

```bash
git add commands/documentation/claude-review.md
git commit -m "feat(claude-review): add weekly Step 2 — build relevance context"
```

---

## Task 5: Weekly Review — Step 3 (Filter and Classify)

**Files:**
- Modify: `commands/documentation/claude-review.md` (append after Step 2)

- [ ] **Step 1: Append Step 3 — Filter and Classify**

Append to `commands/documentation/claude-review.md`:

````markdown

---

### Step 3 — Filter and Classify

For each release note entry from Step 1, match against the relevance context from Step 2:

| Match Type | Meaning |
|---|---|
| Architecture match | Feature affects a component type in use (hooks, agents, skills, plugins) |
| Dependency match | Feature affects something scripts or templates depend on |
| Workflow match | Feature could improve an existing skill or workflow |
| Ecosystem match | Feature changes plugin distribution, install, or configuration |

**Skip** entries with no project/plugin relevance.

**Classify** relevant entries:

- **Adopt Now** — directly useful, can leverage immediately
- **Evaluate** — potentially useful, needs investigation
- **Watch** — not actionable yet but relevant to roadmap
- **Informational** — good to know, no action needed

For installed plugin changes, additional filter: only surface changes related to features the project actually invokes. Grep for skill invocations, agent references, and hook patterns in project files to determine actual usage.

For each relevant entry, capture:

```yaml
feature: { feature name }
area: { matching relevance context area }
classification: { Adopt Now | Evaluate | Watch | Informational }
summary: { 2-3 sentence description }
impact: { 1-2 sentences on specific project/plugin impact }
action: { what to do, if anything }
```

Report the classification summary:

```text
### Classification Summary

**Total entries reviewed:** {n}
**Project-relevant:** {count} (Adopt Now: {n}, Evaluate: {n}, Watch: {n}, Informational: {n})
**Skipped (not relevant):** {count}
```
````

- [ ] **Step 2: Commit**

```bash
git add commands/documentation/claude-review.md
git commit -m "feat(claude-review): add weekly Step 3 — filter and classify"
```

---

## Task 6: Weekly Review — Step 4 (Update Rolling Report)

**Files:**
- Modify: `commands/documentation/claude-review.md` (append after Step 3)

- [ ] **Step 1: Append Step 4 — Update Rolling Report**

Append to `commands/documentation/claude-review.md`:

````markdown

---

### Step 4 — Update Rolling Report

Update `docs/tooling-reviews/claude-code.md`.

**Report header:**

```markdown
**Claude Code Version:** {version}
**Plugin Versions:** superpowers {v}, commit-commands {v}, context7 {v}, skill-creator {v}
**Last Reviewed:** {date}
**Baseline Established:** {date}
```

**Report sections** (same structure as sf-cli.md):

1. **Adoption Opportunities** — table with columns: `Feature | Area | Why Consider | Classification | Status`
2. **Recent Changes** — version subsections with NEW/CHANGE/FIX lists (keep last 4 reviews; older in git history)
3. **Capabilities We Use** — documented usage of Claude Code features
4. **Completed** — previously adopted features
5. **Not Relevant** — explicitly excluded features

Operations:
1. Update header with current versions and date
2. Add new Adopt Now / Evaluate items to Adoption Opportunities with `Status: New — {version}`
3. Add version subsection to Recent Changes
4. Move adopted items to Completed (if any were adopted since last review)
5. Update Capabilities We Use if review reveals new usage
````

- [ ] **Step 2: Commit**

```bash
git add commands/documentation/claude-review.md
git commit -m "feat(claude-review): add weekly Step 4 — update rolling report"
```

---

## Task 7: Weekly Review — Step 5 (Propose Backlog Items)

**Files:**
- Modify: `commands/documentation/claude-review.md` (append after Step 4)

- [ ] **Step 1: Append Step 5 — Propose Backlog Items**

Append to `commands/documentation/claude-review.md`:

````markdown

---

### Step 5 — Propose Backlog Items

Same propose-then-approve pattern as `/tooling-review` and `/release-review`.

For each **Adopt Now** and **Evaluate** feature from Step 3:

1. **Check for existing backlog overlap:**

   For each script below, check for a local copy in `scripts/` first. If not found, copy from `${CLAUDE_PLUGIN_ROOT}/script-templates/` to `scripts/`.

   ```bash
   node scripts/backlog-search.js --text "{feature keywords}"
   ```

   If an existing item covers this feature, note it as an expansion candidate rather than a new item.

2. **Draft backlog entries** for new items:

   ```yaml
   title: "{action verb} {feature name}"
   description: "{what to do and why, referencing the claude review}"
   category: "{matching category}"
   priority: null
   effort: "{S|M|L|XL estimate}"
   complexity: "{Low|Med|High}"
   tags: ["{relevant tags}"]
   source: "claude-review"
   submitted_by: "Claude"
   notes:
     - date: "{today}"
       author: "Claude"
       text: "Identified in Claude review (Claude Code {version}). See docs/tooling-reviews/claude-code.md"
   ```

3. **Present proposals for approval:**

   ```text
   ### Proposed Backlog Items ({n} new, {m} expansions)

   **New Items:**

   1. **{title}** — {one-line summary}
      Effort: {S/M/L/XL} | Tags: {tags}

   2. ...

   **Expand Existing:**

   1. **BL-NNNN: {existing title}** — add: {what to add from this review}

   Approve all / approve 1,3 / skip 2 / edit 1: {text} / none
   ```

   **Wait for developer approval before writing any backlog items.**

4. **Write approved items:**

   For each script below, check for a local copy in `scripts/` first. If not found, copy from `${CLAUDE_PLUGIN_ROOT}/script-templates/` to `scripts/`.

   ```bash
   node scripts/backlog-add.js --title "{title}" --description "{desc}" --category "{cat}" --effort "{effort}" --complexity "{complexity}" --tags "{tags}" --source "claude-review" --submitted-by "Claude"
   ```

5. **Re-render backlog:**

   For each script below, check for a local copy in `scripts/` first. If not found, copy from `${CLAUDE_PLUGIN_ROOT}/script-templates/` to `scripts/`.

   ```bash
   node scripts/backlog-render.js
   ```

6. **Update report** — add "Backlog proposed: BL-NNNN" line to the version's Recent Changes entry.

If no features warrant backlog items, report:

```text
No new backlog items proposed — all changes are informational or already covered by existing items.
```
````

- [ ] **Step 2: Commit**

```bash
git add commands/documentation/claude-review.md
git commit -m "feat(claude-review): add weekly Step 5 — propose backlog items"
```

---

## Task 8: Audit Mode

**Files:**
- Modify: `commands/documentation/claude-review.md` (append after Weekly Review)

- [ ] **Step 1: Append the Audit Mode section**

Append to `commands/documentation/claude-review.md`:

````markdown

---

## Audit Mode (`--audit`)

Full capability review of Claude Code features and installed plugins against current usage.

### Step A1 — Claude Code Capability Scan

Enumerate current Claude Code capabilities:

- `claude --help` for available top-level commands
- `claude plugin list` for installed plugins and their versions
- `.claude/settings.json` for configured hooks and permission rules
- `.mcp.json` for configured MCP servers
- Available deferred tools from the system context (enumerate `mcp__*` tools)

Organize findings by area: hooks, agents, skills, MCP, plugins, permissions.

### Step A2 — Cross-Reference with Documentation

Compare the capability scan against:

- Rolling report's "Capabilities We Use" — what's documented vs what's actually configured
- Rolling report's "Adoption Opportunities" — what was identified but not yet adopted
- Report any discrepancies: capabilities in use but not documented, or documented but no longer in use

### Step A3 — Reference Automation Recommender

For broader ecosystem discovery (new plugins, MCP servers, hooks the project doesn't know about), explicitly suggest:

```text
For a broader Claude Code ecosystem scan (new plugins, MCP servers, and automations),
run the `claude-automation-recommender` skill from the claude-code-setup plugin.
```

Do not duplicate the automation recommender's work. The audit focuses on what you already have vs what you're using.

### Step A4 — Update Rolling Report

Add audit findings to the "Adoption Opportunities" table with `Status: Audit — {date}`.

Add an audit subsection to "Recent Changes":

```markdown
### {date} — Capability Audit

**Capabilities scanned:** {count}
**In use:** {count}
**New opportunities identified:** {count}
**Key findings:**

- {finding 1}
- {finding 2}
```

Update "Capabilities We Use" if the audit reveals usage not yet documented.

### Step A5 — Propose Backlog Items

Run the same propose-then-approve workflow as Step 5 (Weekly Review) for significant audit findings.

### Step A6 — Report

```text
### Capability Audit Complete

**Claude Code:** {version}
**Plugins scanned:** {n} ({n} capabilities, {n} in use, {n} opportunities)
**Backlog items:** {n} proposed, {m} approved
```
````

- [ ] **Step 2: Commit**

```bash
git add commands/documentation/claude-review.md
git commit -m "feat(claude-review): add audit mode (Steps A1-A6)"
```

---

## Task 9: Context Lookup Mode

**Files:**
- Modify: `commands/documentation/claude-review.md` (append after Audit Mode)

- [ ] **Step 1: Append the Context Lookup Mode section**

Append to `commands/documentation/claude-review.md`:

````markdown

---

## Context Lookup Mode (`--context <area>`)

On-demand domain-specific capability scan. Does NOT update rolling files.

### Step C1 — Map Area to Tag

Map the provided `<area>` argument to a capability domain:

| Input | Tag | What it scans |
|---|---|---|
| hooks, hook | hooks | Hook event types, settings.json patterns, PreToolUse/PostToolUse/Stop/SessionStart/SessionStop |
| agents, agent, subagent | agents | Agent frontmatter, dispatch, parallel, isolation, worktrees |
| skills, commands, slash | skills | Skill/command capabilities, arguments, frontmatter, `${CLAUDE_PLUGIN_ROOT}` |
| mcp, tools, servers | mcp | MCP protocol, tool types, resources, server configuration |
| sdk, api, anthropic | sdk | Anthropic SDK, model capabilities, API features |
| plugins, marketplace | plugins | Plugin system, marketplace, install flow, versioning, settings |
| plan, planning | plan | Plan mode features, worktrees, approval workflow |
| permissions, security | permissions | Permission model, settings.json, allow/deny rules |

If the area doesn't match any tag, report:

```text
Area "{area}" not recognized. Available areas: hooks, agents, skills, mcp, sdk, plugins, plan, permissions
```

And stop.

### Step C2 — Scan Current Capabilities

For the matched tag, scan what's currently configured/in use:

- **hooks:** Read `.claude/settings.json` for hook entries, check `${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json` for plugin hooks
- **agents:** Read `.claude/agents/*.md` for project agents, `${CLAUDE_PLUGIN_ROOT}/agents/*.md` for plugin agents
- **skills:** Read `.claude/skills/**` for project skills, enumerate `${CLAUDE_PLUGIN_ROOT}/commands/**/*.md` for plugin skills
- **mcp:** Read `.mcp.json` for configured MCP servers, enumerate available `mcp__*` deferred tools
- **plugins:** Run `claude plugin list`, read `.claude-plugin/plugin.json` if in plugin mode
- **permissions:** Read `.claude/settings.json` for allow/deny rules
- **sdk/plan:** Check rolling report and backlog for related entries

### Step C3 — Scan Rolling Report

Read `docs/tooling-reviews/claude-code.md` and filter for entries related to this area:

- Adoption Opportunities tagged with this area
- Recent Changes entries mentioning this area
- Capabilities We Use entries for this area

### Step C4 — Cross-Reference Backlog

For each script below, check for a local copy in `scripts/` first. If not found, copy from `${CLAUDE_PLUGIN_ROOT}/script-templates/` to `scripts/`.

```bash
node scripts/backlog-search.js --text "{area}"
```

List active backlog items related to this area.

### Step C5 — Report

Report to console (do NOT update rolling files):

```text
### {Area} — Context Lookup

**Current Configuration:**
- {what's configured for this area}
- ...

**In Rolling Report:**
- {relevant entries from claude-code.md, or "No entries for {area}"}

**Related Backlog Items:**
- BL-NNNN: {title} ({status})
- ... (or "None")

**Recommendation:** {contextual recommendation — what to adopt, evaluate, or watch for this area}
```

### Step C6 — Optional Backlog Proposals

If the context lookup reveals significant adoption opportunities not already in the backlog, offer to propose backlog items using the same propose-then-approve workflow as Step 5.
````

- [ ] **Step 2: Commit**

```bash
git add commands/documentation/claude-review.md
git commit -m "feat(claude-review): add context lookup mode (Steps C1-C6)"
```

---

## Task 10: Backlog-Only Mode and Behavior Notes

**Files:**
- Modify: `commands/documentation/claude-review.md` (append after Context Lookup)

- [ ] **Step 1: Append Backlog-Only Mode and Behavior Notes**

Append to `commands/documentation/claude-review.md`:

````markdown

---

## Backlog-Only Mode (`--backlog-only`)

Process existing rolling report into backlog items without re-running analysis.

### Step B1 — Read Report

Read `docs/tooling-reviews/claude-code.md`.

### Step B2 — Extract Opportunities

Parse the "Adoption Opportunities" table. Extract entries classified as **Adopt Now** or **Evaluate** that have not already been processed into backlog items.

Check for processing markers — if a "Backlog proposed" line in Recent Changes already references a version's findings, skip those entries.

### Step B3 — Run Backlog Proposal Workflow

Run the same propose-then-approve workflow as Step 5 (Weekly Review) for all extracted opportunities.

### Step B4 — Mark Processed

After processing, add a note to the relevant Recent Changes entry in the report:

```markdown
**Backlog processed:** {today's date} — {n} items proposed, {m} approved
```

---

## Behavior Notes

- **Project context is the default relevance filter.** The skill runs in consuming projects by default. Use `--plugin` when developing the plugin itself.
- **No Resolution section.** This skill does not need SF org context. It reads Claude Code and project configuration directly. This is the first skill without the shared Resolution block.
- **Rolling files, not per-run files.** Update `docs/tooling-reviews/claude-code.md` in place. Git history preserves per-run snapshots. Never create new report files per run.
- **Version state lives in report headers.** "Claude Code Version", "Plugin Versions", and "Last Reviewed" in the header are the single source of truth. Do not duplicate this in memory files.
- **Propose-then-approve for backlog items.** Same pattern as `/tooling-review`, `/release-review`, and `/platform-review` — Claude proposes, developer approves before writing. Never auto-write backlog items.
- **Graceful degradation.** If web search fails, if `claude --version` output format changes, if plugin list output is unparseable — skip what's broken, complete what you can, report what was skipped.
- **Installed-plugin tracking, not new-plugin discovery.** This skill tracks changes in tools you already use. For discovering new plugins/automations, it defers to `claude-automation-recommender`.
- **First run creates baseline.** If the rolling report doesn't exist, first run creates it with current versions and documents current capabilities. No delta analysis on first run.
- **Source attribution.** All backlog items use `source: "claude-review"` for traceability. Notes reference `docs/tooling-reviews/claude-code.md`.
- **Weekly reminder.** `/start-day` includes a claude review reminder when 7+ days have elapsed since last review. The reminder checks "Last Reviewed" in the report header, not a memory file.
````

- [ ] **Step 2: Check the final line count**

Run:
```bash
wc -l commands/documentation/claude-review.md
```

Expected: ~380-420 lines (spec estimated 350-400).

- [ ] **Step 3: Run plugin validation**

```bash
node scripts/validate-plugin.js
```

Expected: PASS with zero failures.

- [ ] **Step 4: Commit**

```bash
git add commands/documentation/claude-review.md
git commit -m "feat(claude-review): add backlog-only mode and behavior notes — skill complete"
```

---

## Task 11: Retrofit Assignment-Aware Logic to Existing Cadence Checks in start-day

**Files:**
- Modify: `commands/process/start-day.md` (lines 373-438)

This task adds the `reviewAssignments` guard pattern to all three existing cadence checks. The pattern is: read assignment from `config/sf-toolkit.json` → if assigned and `currentUserName` doesn't match → skip silently. The variable `currentUserName` is already resolved at line 65 of start-day.md from `context.user.displayName`.

- [ ] **Step 1: Read the current cadence check sections to confirm exact content**

Read `commands/process/start-day.md` lines 373-438 to confirm the exact text before editing.

- [ ] **Step 2: Add assignment guard to Lookback Cadence Check**

In `commands/process/start-day.md`, find the Lookback Cadence Check section and add the assignment guard. Replace:

```markdown
### Lookback Cadence Check

After presenting the session plan options, check if lookback is due by scanning git log for feedback memory commits in the last 7 days:
```

With:

```markdown
### Lookback Cadence Check

After presenting the session plan options, check if lookback is due.

**Note:** Lookback does not have a review assignment — it applies to all team members because feedback memory is a shared resource. No assignment filtering for this check.

Check by scanning git log for feedback memory commits in the last 7 days:
```

- [ ] **Step 3: Add assignment guard to Platform Review Cadence Check**

In `commands/process/start-day.md`, find the Platform Review Cadence Check section and add the assignment guard. Replace:

```markdown
### Platform Review Cadence Check

Check when `/platform-review` was last run by looking for the most recent `docs/platform-review/*/` directory:
```

With:

```markdown
### Platform Review Cadence Check

Read `config/sf-toolkit.json` → `reviewAssignments.platform-review`. If the key exists and its value does not match `currentUserName`, skip this check silently. If the key is missing or null, proceed (backward compatible — everyone sees the reminder).

Check when `/platform-review` was last run by looking for the most recent `docs/platform-review/*/` directory:
```

- [ ] **Step 4: Add assignment guard to Tooling Review Cadence Check**

In `commands/process/start-day.md`, find the Tooling Review Cadence Check section and add the assignment guard. Replace:

```markdown
### Tooling Review Cadence Check

Check `docs/tooling-reviews/` for the Last Reviewed date. Remind if >7 days:
```

With:

```markdown
### Tooling Review Cadence Check

Read `config/sf-toolkit.json` → `reviewAssignments.tooling-review`. If the key exists and its value does not match `currentUserName`, skip this check silently. If the key is missing or null, proceed (backward compatible — everyone sees the reminder).

Check `docs/tooling-reviews/` for the Last Reviewed date. Remind if >7 days:
```

- [ ] **Step 5: Verify all three edits**

Run:
```bash
grep -n "reviewAssignments" commands/process/start-day.md
```

Expected: Two matches — one in Platform Review, one in Tooling Review. Lookback intentionally has no assignment guard.

- [ ] **Step 6: Commit**

```bash
git add commands/process/start-day.md
git commit -m "feat(start-day): retrofit assignment-aware logic to platform-review and tooling-review cadence checks"
```

---

## Task 12: Add Claude Review Cadence Check to start-day

**Files:**
- Modify: `commands/process/start-day.md` (insert after Tooling Review Cadence Check, before `---` separator at line 440)

- [ ] **Step 1: Read the insertion point to confirm exact content**

Read `commands/process/start-day.md` around line 438-442 to confirm the exact boundary.

- [ ] **Step 2: Insert the new Claude Review Cadence Check**

In `commands/process/start-day.md`, find the line `If the last review is within 7 days, skip silently.` at the end of the Tooling Review Cadence Check (followed by `---`). Insert the new block between that line and the `---` separator.

Find this text:

```markdown
If the last review is within 7 days, skip silently.

---

## Behavior Notes
```

Replace with:

```markdown
If the last review is within 7 days, skip silently.

### Claude Review Cadence Check

Read `config/sf-toolkit.json` → `reviewAssignments.claude-review`. If the key exists and its value does not match `currentUserName`, skip this check silently. If the key is missing or null, proceed (backward compatible — everyone sees the reminder).

Check `docs/tooling-reviews/claude-code.md` for the Last Reviewed date. Remind if >7 days:

```bash
head -5 docs/tooling-reviews/claude-code.md 2>/dev/null | grep "Last Reviewed:"
```

Extract the date from the "Last Reviewed:" line. If the file doesn't exist or the date is more than 7 days ago, surface the reminder:

```text
---
**Claude review reminder:** It's been more than 7 days since `/claude-review` was last run{or "No Claude Code review baseline exists yet — run /claude-review to establish baseline"}.
Claude Code and plugin releases ship frequently — check for new capabilities.

Run: `/claude-review` (weekly check) or `/claude-review --audit` (capability audit)
---
```

If the last review is within 7 days, skip silently.

---

## Behavior Notes
```

- [ ] **Step 3: Verify the new check exists**

Run:
```bash
grep -n "Claude Review Cadence" commands/process/start-day.md
```

Expected: One match at the expected line number, after Tooling Review Cadence Check.

- [ ] **Step 4: Commit**

```bash
git add commands/process/start-day.md
git commit -m "feat(start-day): add claude-review cadence check with assignment guard"
```

---

## Task 13: Add Review Assignments Step to /setup

**Files:**
- Modify: `commands/setup.md` (add sub-step within Step 3, add health check entry)

The spec says to add a Review Assignments step to `/setup`. The natural location is as part of Step 3 (Create `config/sf-toolkit.json`) since `reviewAssignments` is a key in that file. We add it as additional interactive prompts within that step, and add a health check note.

- [ ] **Step 1: Read setup.md Step 3 to confirm exact content**

Read `commands/setup.md` lines 73-103 to confirm the exact text.

- [ ] **Step 2: Add reviewAssignments to the config template in Step 3**

In `commands/setup.md`, find the JSON template block in Step 3 and add the `reviewAssignments` key. Replace:

```json
{
  "searchKeywords": "{user input}",
  "searchKeywordsLastReviewed": "{today's date}",
  "team": {
    "{email}": "{name}"
  },
  "backlog": {
    "backend": "{yaml|salesforce}"
  },
  "cache": {
    "ttlHours": 24
  }
}
```

With:

```json
{
  "searchKeywords": "{user input}",
  "searchKeywordsLastReviewed": "{today's date}",
  "team": {
    "{email}": "{name}"
  },
  "backlog": {
    "backend": "{yaml|salesforce}"
  },
  "cache": {
    "ttlHours": 24
  },
  "reviewAssignments": {
    "claude-review": "{name or null}",
    "tooling-review": "{name or null}",
    "platform-review": "{name or null}"
  }
}
```

- [ ] **Step 3: Add the Review Assignments interactive prompt**

In `commands/setup.md`, find the line:

```
The `cache.ttlHours` controls how long the resolver cache
```

Insert the following block **before** that line (after the config JSON template):

```markdown
4. **Review assignments:** After the team mapping is complete, ask who should be responsible for each cadence-based review skill. Present the three review types:
   - `claude-review` — Claude Code + plugin release tracking (weekly cadence)
   - `tooling-review` — SF CLI + MCP Server release tracking (weekly cadence)
   - `platform-review` — Multi-persona platform review (quarterly cadence)

   For single-developer teams (only one entry in `team`): default all three to that person.
   For multi-developer teams: ask which team member should own each review type. Values are display names from the `team` config. Use `null` for "everyone sees the reminder" (no assignment).

```

- [ ] **Step 4: Add health check entry for reviewAssignments**

In `commands/setup.md`, find the health check fallback list (lines 21-28) and add a check. Find:

```markdown
6. Check for `docs/platform-brief.md`, `CLAUDE.md`, `README.md`
```

Insert after that line:

```markdown
7. Check for `reviewAssignments` key in `config/sf-toolkit.json` — if missing, surface suggestion: "Review assignments not configured — re-run `/setup` to assign review responsibilities."
```

- [ ] **Step 5: Verify the edits**

Run:
```bash
grep -n "reviewAssignments" commands/setup.md
```

Expected: Multiple matches — in the JSON template, in the interactive prompt section, and in the health check.

- [ ] **Step 6: Commit**

```bash
git add commands/setup.md
git commit -m "feat(setup): add reviewAssignments config and health check"
```

---

## Task 14: Update /help

**Files:**
- Modify: `commands/help.md` (lines 33, 62, 223-226)

- [ ] **Step 1: Add /claude-review to the Documentation group in overview mode**

In `commands/help.md`, find:

```
Documentation (6):
```

Replace with:

```
Documentation (7):
```

Then find:

```
  /tooling-review    SF CLI + MCP Server release tracking
  /design-review     Design document accuracy review against org and standards
```

Replace with:

```
  /tooling-review    SF CLI + MCP Server release tracking
  /claude-review     Claude Code + plugin release tracking
  /design-review     Design document accuracy review against org and standards
```

- [ ] **Step 2: Add /claude-review to the Skill Detail mode routing**

In `commands/help.md`, find:

```
   - `release-review`, `doc-flows`, `doc-components`, `platform-review`, `tooling-review`, `design-review` → `commands/documentation/`
```

Replace with:

```
   - `release-review`, `doc-flows`, `doc-components`, `platform-review`, `tooling-review`, `claude-review`, `design-review` → `commands/documentation/`
```

- [ ] **Step 3: Add /claude-review to the REVIEW chain**

In `commands/help.md`, find:

```
REVIEW:
  /platform-review          → quarterly multi-persona review
  /release-review           → Salesforce release analysis
  /tooling-review           → SF CLI + MCP updates
```

Replace with:

```
REVIEW:
  /platform-review          → quarterly multi-persona review
  /release-review           → Salesforce release analysis
  /tooling-review           → SF CLI + MCP updates
  /claude-review            → Claude Code + plugin updates
```

- [ ] **Step 4: Verify all three insertion points**

Run:
```bash
grep -n "claude-review" commands/help.md
```

Expected: Three matches — overview listing, skill detail routing, REVIEW chain.

- [ ] **Step 5: Commit**

```bash
git add commands/help.md
git commit -m "feat(help): add /claude-review to documentation group, routing, and REVIEW chain"
```

---

## Task 15: Update README.md

**Files:**
- Modify: `README.md` (lines 74, 82-83)

- [ ] **Step 1: Update Documentation skills count and add table row**

In `README.md`, find:

```
### Documentation (6)
```

Replace with:

```
### Documentation (7)
```

Then find:

```
| `/tooling-review` | SF CLI + MCP Server release tracking | — |
| `/design-review` | Design document accuracy review against org metadata and standards | doc path or `BL-NNNN` |
```

Replace with:

```
| `/tooling-review` | SF CLI + MCP Server release tracking | — |
| `/claude-review` | Claude Code + plugin release tracking | `--audit`, `--context <area>`, `--plugin` |
| `/design-review` | Design document accuracy review against org metadata and standards | doc path or `BL-NNNN` |
```

- [ ] **Step 2: Verify the changes**

Run:
```bash
grep -n "claude-review" README.md
```

Expected: One match in the Documentation skills table.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add /claude-review to README documentation skills table"
```

---

## Task 16: Version Bump to 1.6.0

**Files:**
- Modify: `package.json` (line 3)
- Modify: `.claude-plugin/plugin.json` (line 4)
- Modify: `.claude-plugin/marketplace.json` (line 11)

- [ ] **Step 1: Bump version in package.json**

In `package.json`, find:

```
"version": "1.5.0",
```

Replace with:

```
"version": "1.6.0",
```

- [ ] **Step 2: Bump version in plugin.json**

In `.claude-plugin/plugin.json`, find:

```
"version": "1.5.0",
```

Replace with:

```
"version": "1.6.0",
```

- [ ] **Step 3: Bump version in marketplace.json**

In `.claude-plugin/marketplace.json`, find:

```
"version": "1.5.0",
```

Replace with:

```
"version": "1.6.0",
```

- [ ] **Step 4: Run plugin validation to verify version sync**

```bash
node scripts/validate-plugin.js
```

Expected: PASS — all three files report version 1.6.0 and are in sync.

- [ ] **Step 5: Run cache validation (no cache changes expected)**

```bash
node scripts/test-resolve-cache.js
```

Expected: PASS — no cache schema changes in this release.

- [ ] **Step 6: Commit**

```bash
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore: bump to v1.6.0 — /claude-review, review assignments, cadence check updates"
```

---

## Task 17: Final Validation

This task runs all verification checks from the design spec.

- [ ] **Step 1: Run plugin validation**

```bash
node scripts/validate-plugin.js
```

Expected: PASS with zero failures.

- [ ] **Step 2: Run cache validation**

```bash
node scripts/test-resolve-cache.js
```

Expected: PASS.

- [ ] **Step 3: Verify /claude-review appears in help**

Read `commands/help.md` and confirm `/claude-review` appears in:
1. Documentation group overview (with count 7)
2. Skill Detail mode routing
3. REVIEW chain

- [ ] **Step 4: Verify claude-review.md structure matches design**

Read `commands/documentation/claude-review.md` and confirm:
1. Frontmatter has `name: claude-review`
2. No Resolution section
3. Four modes: weekly (Steps 0-5), audit (A1-A6), context (C1-C6), backlog-only (B1-B4)
4. `--plugin` modifier documented
5. Behavior Notes section at the end

- [ ] **Step 5: Verify start-day cadence checks**

Read `commands/process/start-day.md` and confirm:
1. Platform Review Cadence Check has `reviewAssignments.platform-review` guard
2. Tooling Review Cadence Check has `reviewAssignments.tooling-review` guard
3. Claude Review Cadence Check exists with `reviewAssignments.claude-review` guard
4. Lookback Cadence Check has a note explaining why it has no assignment guard

- [ ] **Step 6: Verify setup.md Review Assignments**

Read `commands/setup.md` and confirm:
1. `reviewAssignments` key in the config JSON template
2. Interactive prompt for assigning review responsibilities
3. Health check entry for missing `reviewAssignments`

- [ ] **Step 7: Verify README**

Read `README.md` and confirm Documentation section shows count (7) and includes `/claude-review` row.

- [ ] **Step 8: Verify version sync**

```bash
grep '"version"' package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json
```

Expected: All three show `"1.6.0"`.
