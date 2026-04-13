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
