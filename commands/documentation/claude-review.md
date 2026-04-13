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
- **No Resolution section.** This skill does not need SF org context. It reads Claude Code and project configuration directly. This is the first skill without the shared Resolution block — registered in the `EXCLUDED_COMMANDS` list in the plugin validator to skip the Cache-first resolution check.
- **Rolling files, not per-run files.** Update `docs/tooling-reviews/claude-code.md` in place. Git history preserves per-run snapshots. Never create new report files per run.
- **Version state lives in report headers.** "Claude Code Version", "Plugin Versions", and "Last Reviewed" in the header are the single source of truth. Do not duplicate this in memory files.
- **Propose-then-approve for backlog items.** Same pattern as `/tooling-review`, `/release-review`, and `/platform-review` — Claude proposes, developer approves before writing. Never auto-write backlog items.
- **Graceful degradation.** If web search fails, if `claude --version` output format changes, if plugin list output is unparseable — skip what's broken, complete what you can, report what was skipped.
- **Installed-plugin tracking, not new-plugin discovery.** This skill tracks changes in tools you already use. For discovering new plugins/automations, it defers to `claude-automation-recommender`.
- **First run creates baseline.** If the rolling report doesn't exist, first run creates it with current versions and documents current capabilities. No delta analysis on first run.
- **Source attribution.** All backlog items use `source: "claude-review"` for traceability. Notes reference `docs/tooling-reviews/claude-code.md`.
- **Weekly reminder.** `/start-day` includes a claude review reminder when 7+ days have elapsed since last review. The reminder checks "Last Reviewed" in the report header, not a memory file.
