# Claude SF Toolkit — Changelog

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
