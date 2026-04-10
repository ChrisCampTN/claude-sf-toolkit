# claude-sf-toolkit — Plugin Development Guide

## Architecture
- Claude Code plugin (not MCP server) — provides skills, agents, hooks for Salesforce DX projects
- Skills (commands/*.md) orchestrate multi-step workflows using prompt-driven logic
- Agents (agents/*.md) are sub-agents dispatched by skills for data gathering
- Script templates (script-templates/*.js) are copyable Node.js utilities for consuming projects
- Hooks (hooks/hooks.json + hooks/*.sh) register via SessionStart for auto-dependency checks

## File Conventions
- Skills: `commands/{category}/{name}.md` with YAML frontmatter (name, description)
- Agents: `agents/{name}.md` with frontmatter (description, model, color, tools, `<example>` blocks)
- Scripts: `script-templates/{name}.js` — portable Node.js, no external deps beyond fs/path
- Templates: `templates/{name}.template` — scaffolded into consuming projects by /setup

## Key Patterns
- `${CLAUDE_PLUGIN_ROOT}` — always use for referencing plugin files (never `claude plugin path` or `realpath`)
- Cache-first resolution: skills read `.claude/sf-toolkit-cache.json` before dispatching resolver agent
- Script resolution: check local `scripts/` first, fall back to `${CLAUDE_PLUGIN_ROOT}/script-templates/`
- All 18 skills share identical Resolution section — batch-edit with `replace_all` when changing it
- Config-driven values: scripts read from `config/sf-toolkit.json`, fall back to extracting from data, never hardcode project-specific values (categories, team names, etc.)

## Version Management
- Three files must stay in sync: package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json
- Bump all three together. Cache includes pluginVersion for auto-invalidation on updates

## Editing Tips
- Read files before editing (Edit tool requires prior Read even if you've grepped the content)
- Use `replace_all: true` for renaming patterns across files (paths, common text blocks)
- 18 skill files share the same Resolution section — grep to verify all were updated, zero old matches remain
- Windows CRLF: when parsing markdown frontmatter with regex, always `.replace(/\r\n/g, "\n")` first

## Validation & Testing

### Automated (pre-commit)
- `node scripts/validate-plugin.js` — structural checks (JSON, versions, frontmatter, stale refs, hooks)
- `node scripts/test-resolve-cache.js` — unit tests for the cache validation script
- Both run automatically in the pre-commit hook when committing to the plugin repo

### Manual (after changes)
- After modifying hooks.json or session-start.sh, restart Claude Code to reload hooks
- After modifying agent frontmatter, restart to re-register agents
- Cache changes can be tested by deleting `.claude/sf-toolkit-cache.json` in a consuming project

### Plugin-dev review (before packaging releases)
After significant changes, run the plugin-dev skills for best-practice validation:
- `/plugin-dev:plugin-structure` — verify directory layout, plugin.json, `${CLAUDE_PLUGIN_ROOT}` usage
- `/plugin-dev:agent-development` — verify agent frontmatter (model, color, tools, `<example>` blocks)
- `/plugin-dev:hook-development` — verify hooks.json format, event registration, `$CLAUDE_ENV_FILE` usage
- `/plugin-dev:skill-development` — verify command descriptions, progressive disclosure, writing style
- `/plugin-dev:plugin-settings` — verify per-project state patterns (`.claude/` directory, gitignore)
- Use the `superpowers:code-reviewer` agent for a cross-cutting review against all checks at once

## Distribution
- Install requires two commands in the same session: `claude plugin marketplace add ChrisCampTN/claude-sf-toolkit && claude plugin install claude-sf-toolkit --scope project`
- Direct URL install (`claude plugin install https://...`) does NOT work
- Users must re-run the combined command to get updates (no auto-update)
- Session-start hook notifies users when the plugin version changes
