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
