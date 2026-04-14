# claude-sf-toolkit — Plugin Development Guide

## Architecture
- Claude Code plugin (not MCP server) — provides skills, agents, hooks for Salesforce DX projects
- Skills (commands/*.md) orchestrate multi-step workflows using prompt-driven logic
- Agents (agents/*.md) are sub-agents dispatched by skills for data gathering
- Script templates (script-templates/*.js) are copyable Node.js utilities for consuming projects
- Hooks (hooks/hooks.json + hooks/*.sh) register via SessionStart for auto-dependency checks

## File Conventions
- Skills: `commands/{category}/{name}.md` with YAML frontmatter (name, description)
- Workflow variants: `commands/{category}/{name}-workflows/{backend}.md` — no frontmatter, delegated by parent skill
- Agents: `agents/{name}.md` with frontmatter (description, model, color, tools, `<example>` blocks)
- Scripts: `script-templates/{name}.js` — portable Node.js, no external deps beyond fs/path
- Templates: `templates/{name}.template` — scaffolded into consuming projects by /setup

## Key Patterns
- `${CLAUDE_PLUGIN_ROOT}` — always use for referencing plugin files (never `claude plugin path` or `realpath`)
- Cache-first resolution: skills read `.claude/sf-toolkit-cache.json` before dispatching resolver agent
- Script resolution: check local `scripts/` first, fall back to `${CLAUDE_PLUGIN_ROOT}/script-templates/`
- All skills with Resolution sections share identical cache-first pattern — batch-edit with `replace_all` when changing it
- Config-driven values: scripts read from `config/sf-toolkit.json`, fall back to extracting from data, never hardcode project-specific values (categories, team names, etc.)

## DevOps Backend Toggle
- `config/sf-toolkit.json` → `devops.backend`: `"devops-center"` (default) or `"github-actions"`
- Projects without a `devops` key behave as `"devops-center"` with no changes
- `workTracking` context in cache abstracts backend: skills read `workTracking.*` fields, not backend-specific commands
- Resolver agent populates `workTracking` based on `devops.backend` — GHA mode skips DOC SOQL queries
- `workTracking.disabledSkills`: skills listed here show "not available" message and stop (devops-commit, wi-sync in GHA mode)
- `workTracking.deployManagedEnvs`: deploy-changed warns when targeting these environments
- Backlog has variant workflow files: `commands/process/backlog-workflows/{devops-center,github-actions}.md`
- Parent `backlog.md` routes to the correct variant based on `workTracking.backend` (or explicit `backlog.backend` override)
- When editing a variant file, check the counterpart for matching changes to shared sub-commands
- `/validate-build` gate: DOC promotions and GHA PRs should complete validate-build first (--skip-validation to bypass)

## Version Management
- Three files must stay in sync: package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json
- Bump all three together. Cache includes pluginVersion for auto-invalidation on updates

## Editing Tips
- Read files before editing (Edit tool requires prior Read even if you've grepped the content)
- Use `replace_all: true` for renaming patterns across files (paths, common text blocks)
- Skill files share the same Resolution section — grep to verify all were updated, zero old matches remain
- Skills without SF org context (help, setup, claude-review) must be added to `EXCLUDED_COMMANDS` in `scripts/validate-plugin.js` to skip the Cache-first resolution check
- Windows CRLF: when parsing markdown frontmatter with regex, always `.replace(/\r\n/g, "\n")` first
- When batch-editing shared sections, preserve skill-specific content above/below — only touch the targeted pattern
- After any multi-file change, run `node scripts/validate-plugin.js` before claiming done — zero failures required
- If a change touches scripts, also run `node scripts/test-resolve-cache.js`

## Validation & Testing

### Automated (pre-commit)
- `node scripts/validate-plugin.js` — structural checks (JSON, versions, frontmatter, stale refs, hooks, variant pairs, disabledSkills guards)
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

## Worktree workflow
- `gh pr merge --delete-branch` fails from a feature worktree when the parent worktree has `main` checked out — the GitHub merge still succeeds; manually `git pull` in the parent, then `git branch -D <feature>` and `git worktree remove <path>`
- Squash-merging a PR whose feature branch descends from an unpushed local main commit creates a redundant merge commit on pull — `git reset --hard origin/main` is safe to drop it since the content is already in the squash
