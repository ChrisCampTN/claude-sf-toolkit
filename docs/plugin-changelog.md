# Claude SF Toolkit — Changelog

## v2.2.0 (2026-09-29)

### Added
- **`/claude-review --audit` skill usage scan** — new Step A1b runs `claude -p "/skill-doctor" --output-format text`, buckets skills as Heavy / Light / Never, and feeds "Never" skills and "Plugins not used recently" into the discrepancy check and Adoption Opportunities. Never-invoked is per-machine — a prompt to check, not a verdict. The audit subsection template gains a "Usage snapshot" table
- **Optional plugins tracked** — `pr-review-toolkit` and `plugin-dev` added to the recommended list in `scripts/check-dependencies.sh`
- **SessionStart hook** — the recommended-plugin warning list now matches `check-dependencies.sh` (`context7`, `skill-creator`, `pr-review-toolkit`, `plugin-dev`)

### Changed
- **Agent models** — all five agents (`sf-toolkit-resolve`, `sf-toolkit-platform-brief`, `start-day-git-state`, `start-day-active-work`, `start-day-external-context`) now use `model: sonnet` instead of `inherit`. They do mechanical gathering, so they no longer run at the parent session's model rate. `sonnet` is an alias for the current Sonnet generation
- **Docs** — README, `/setup`, and `/claude-review` Step 0 list the expanded optional plugin set
- **Changelog** — backfilled v2.0.0 through v2.1.3

## v2.1.3 (2026-09-02)

### Added
- **Stale-plugin warnings in the SessionStart hook** — warns when the marketplace clone holds a newer version than the installed plugin, and when the clone has not been refreshed in more than 14 days. No network call. Both warnings name the exact update command
- **`scripts/test-session-start-staleness.sh`** — runs the real hook against a synthetic HOME with six cases

## v2.1.2 (2026-09-02)

### Changed
- **Agent descriptions** — all five agents adopt plugin-dev's shape: a prose summary of triggers plus a pointer, with worked scenarios moved to a `## When to invoke` body section
- **Validator** — the `<example>` check in `validate-plugin.js` is inverted: an `<example>` block in a description is now flagged, with warnings for a description with no pointer and a body with no matching section

## v2.1.1 (2026-09-02)

### Fixed
- **`/deploy-changed`** — set `disable-model-invocation: true` so the model cannot deploy to a live org implicitly; the slash command is unchanged

## v2.1.0 (2026-09-02)

### Fixed
- **`/wrap-up --review`** — points at Claude Code's built-in `code-review` skill instead of the `code-review` plugin, which is not a toolkit dependency. The `score >= 80` filter is replaced by verdict-based reporting (`CONFIRMED` / `PLAUSIBLE`)
- **Agent frontmatter** — added the missing required `name` field to all five agents
- **Dangling v2.0.0 references** — removed leftover DevOps Center and YAML/Salesforce backlog backend references (`plugin.json`, `CLAUDE.md`, `README.md`, `/setup`, `templates/sf-toolkit.json`)

### Changed
- **Command descriptions** — all commands now say when to use them; destructive skills carry anti-eager wording
- **Validator** — `validate-plugin.js` requires `name` in agent frontmatter and flags stale `code-review:code-review` references
- **CI** — `.github/workflows/claude-code-review.yml` uses the built-in `code-review` skill with `pull-requests: write`

## v2.0.0 (2026-07-11)

### Changed
- **BREAKING: GitHub-only** — DevOps Center and the non-GitHub backlog backends are removed. GitHub Issues, Actions, and PRs are the sole DevOps and work-tracking backend; `--repo` is now required for backlog scripts and `--backend` accepts only `github`
- **Resolver contract** — `workTracking` is a single GitHub shape; no DevOps Center ID resolution

### Removed
- **Skills** — `/devops-commit`, `/wi-sync`
- **Backlog** — `prioritize` subcommand and `status:prioritized` label, `backlog-validate.js`, `templates/backlog.yaml`, `templates/tags.yaml`, the `devops-center` backlog workflow

### Added
- **Backlog** — `needs-review` label support in render and stats, `tag:{value}` label emission, stale-status warning for closed issues
- **`/lookback`** — Step 3.5 audits existing memories; findings are classified mechanism-vs-memory; drafted feedback memories end with a "Working if:" signal

## v1.5.0 (2026-04-10)

### Added
- **LWC bundle completeness check** — metadata-validator.js verifies .js, .html, .js-meta.xml all exist when any LWC file is in scope
- **Apex controller import verification** — metadata-validator.js scans LWC .js files for `@salesforce/apex/` imports and confirms the class exists locally
- **LWC preflight suite** — skill-preflight.md new `lwc` suite: W1 bundle structure, W2 Apex imports, W3 Jest test coverage, W4 LWC dependency graph
- **Jest test execution in deploy** — deploy-changed.md runs `npx lwc-jest --findRelatedTests` on changed LWC files (conditional on `@salesforce/sfdx-lwc-jest` being installed)
- **Jest pre-check in build validation** — validate-build.md runs Jest for LWC components, reports pass/fail as auto-verdicts
- **LWC readiness check in /setup** — Step 11 detects LWC components, checks for Jest config, scans for test files, recommends install

### Fixed
- **Hardcoded backlog categories removed** — backlog-render.js, backlog-add.js, backlog-validate.js now read categories from `config/sf-toolkit.json` → `backlog.categories`, fall back to extracting from data
- **Plugin install command** — corrected to two-step `marketplace add && install` (direct URL doesn't work)

### Changed
- **CLAUDE.md** — added config-driven values pattern, CRLF warning, distribution instructions

## v1.4.0 (2026-04-09)

### Added
- **Resolver cache** — skills read `.claude/sf-toolkit-cache.json` directly and skip the resolver agent when cache is fresh (24h TTL, configurable via `cache.ttlHours` in `config/sf-toolkit.json`)
- **Cache validation script** — `script-templates/resolve-cache.js` for standalone cache inspection and invalidation
- **Plugin structural validation** — `scripts/validate-plugin.js` runs 65 checks (JSON validity, version consistency, agent frontmatter, stale references, hooks format)
- **Unit tests** — `scripts/test-resolve-cache.js` with 11 tests for cache validation logic
- **Session hook auto-registration** — `hooks/hooks.json` registers the SessionStart hook automatically (no manual Husky setup needed for session hooks)
- **SF CLI plugin detection** — session-start hook exports `SF_HAS_FLOW_SCANNER`, `SF_HAS_GIT_DELTA`, `SF_HAS_SFDMU` env vars via `$CLAUDE_ENV_FILE`
- **Update notification** — session-start hook prints a one-line notice when the plugin version changes
- **CLAUDE.md** — plugin development guide with architecture, conventions, validation tiers

### Changed
- **Cache path** — `.claude/sf-toolkit-cache.json` (was project root) per plugin-settings convention
- **Script paths** — all skills use `${CLAUDE_PLUGIN_ROOT}/script-templates/` instead of fragile `$(dirname ...)` patterns
- **Agent frontmatter** — all 5 agents now have `model`, `color`, `tools`, and `<example>` blocks per plugin-dev best practices
- **Version sync** — package.json, plugin.json, marketplace.json all at 1.4.0
- **Pre-commit hook** — runs `validate-plugin.js` and `test-resolve-cache.js` before commits in the plugin repo
- **Cache includes pluginVersion** — auto-invalidates when plugin is updated

### Fixed
- Version mismatch between package.json (was 1.3.0) and plugin.json/marketplace.json (were 1.0.0)
- Inconsistent script resolution patterns across 6+ skills (4 different approaches → 1 standard)
- Silent failures in session-start.sh (now uses `set -euo pipefail`)

## v1.0.0 (2026-04-07)

### Added

- Initial plugin release
- 20 skills across 4 groups (DevOps, Documentation, Process, Meta)
- 15 agent prompt files
- 7 script templates
- 9 document/config templates
- Session-start dependency check hook
- Git hooks (pre-commit, post-commit)
- Interactive `/setup` and `/help` skills
