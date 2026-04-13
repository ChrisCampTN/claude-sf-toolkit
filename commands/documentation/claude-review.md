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
