# Design: /claude-review Skill

## Problem

Claude Code is a core dependency of the SF Toolkit plugin and every workflow it provides. New Claude Code features (hook types, agent capabilities, tool improvements, plugin ecosystem changes) directly affect what the plugin and consuming projects can do. Currently nothing tracks these releases. The team could miss capabilities that improve existing skills or enable new ones.

The existing `/tooling-review` skill tracks SF CLI and MCP Server releases but is purpose-built around those tools' structured APIs (`sf whatsnew`, `sf commands --json`, npm registry). Claude Code has fundamentally different information sources and a different relevance model, making it a poor fit for extension.

## Solution

Create a new `/claude-review` skill that tracks Claude Code and installed plugin releases. It follows the same mode vocabulary and patterns as `/tooling-review` (weekly review, quarterly audit, context lookup, backlog-only) but with purpose-built version checking, release note fetching, and relevance filtering.

Additionally, add a `reviewAssignments` config to `config/sf-toolkit.json` and retrofit assignment-aware cadence checks to all four review skills in `/start-day`.

## Scope

### In Scope

- New `/claude-review` skill with four modes (weekly, audit, context, backlog-only)
- Rolling report at `docs/tooling-reviews/claude-code.md`
- `/start-day` cadence check for claude-review (7-day threshold)
- `reviewAssignments` config in `config/sf-toolkit.json`
- Retrofit assignment-aware logic to all three cadence-based review checks in `/start-day`
- `/setup` step for configuring review assignments
- `/help` and `README.md` updates
- Version bump to 1.6.0

### Out of Scope

- New plugin discovery (deferred to `claude-automation-recommender`)
- Claude API/model release tracking (can be added later)
- Modifying `/tooling-review` itself
- Auto-update mechanisms for plugins

## Design

### 1. Skill Identity

**File:** `commands/documentation/claude-review.md`

```yaml
---
name: claude-review
description: Claude Code + plugin release tracking — weekly review, quarterly audit, context lookup
---
```

**No Resolution section.** This skill does not need SF org context. It reads Claude Code and project configuration directly. This is the first skill without the shared Resolution block.

**Arguments:** `$ARGUMENTS`

| Flag | Mode | Description |
|------|------|-------------|
| (none) | weekly | Check versions, fetch notes, classify, update report, propose backlog |
| `--audit` | audit | Full capability inventory, cross-reference docs |
| `--context <area>` | context | On-demand domain lookup (read-only) |
| `--backlog-only` | backlog-only | Process existing report into backlog items |
| `--plugin` | (modifier) | Switch relevance filter from project context to plugin architecture |

### 2. Weekly Review (Default Mode) — Steps 0-5

#### Step 0 — Check Versions

**Claude Code:**

```bash
claude --version
```

Compare against `docs/tooling-reviews/claude-code.md` header's "Claude Code Version" field. If the report doesn't exist, treat as first run (baseline mode).

**Installed plugins:**

```bash
claude plugin list
```

Parse installed versions for tracked plugins. The tracked plugin list comes from `${CLAUDE_PLUGIN_ROOT}/scripts/check-dependencies.sh` — currently: `superpowers`, `commit-commands` (required) and `context7`, `skill-creator` (optional).

Compare against "Plugin Versions" in the rolling report header.

**Version comparison:**

```
CC_CURRENT = claude --version output
CC_LAST = "Claude Code Version" from report header
PLUGINS_CURRENT = { name: version } from claude plugin list
PLUGINS_LAST = { name: version } from report header
CC_CHANGED = CC_CURRENT != CC_LAST
PLUGINS_CHANGED = any plugin version differs
```

If nothing changed: report "No new releases" and stop. If either changed: report what updated and continue.

#### Step 1 — Fetch Release Notes

**Claude Code (if CC_CHANGED):**

1. Primary: `WebSearch` for `"claude code" release {version} site:github.com/anthropics` then `WebFetch` the releases page
2. Secondary: `npm view @anthropic-ai/claude-code --json` for package metadata
3. Tertiary: `WebSearch` for Anthropic blog posts or changelog entries
4. Graceful degradation: if all fail, note what was skipped, proceed with version-only tracking

**Installed plugins (if PLUGINS_CHANGED):**

For each changed plugin, check its GitHub repo for release notes. Most Claude Code plugins are published on GitHub. Use `WebSearch` for `"{plugin-name}" claude plugin release` if the source URL isn't in the plugin list output.

Collect all NEW/CHANGE/FIX/DEPRECATION entries from each source.

#### Step 2 — Build Relevance Context

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

#### Step 3 — Filter and Classify

For each release note entry, match against the relevance context:

| Match Type | Meaning |
|---|---|
| Architecture match | Feature affects a component type in use (hooks, agents, skills) |
| Dependency match | Feature affects something scripts or templates depend on |
| Workflow match | Feature could improve an existing skill or workflow |
| Ecosystem match | Feature changes plugin distribution, install, or configuration |

Skip entries with no project/plugin relevance.

Classify relevant entries:

- **Adopt Now** — directly useful, can leverage immediately
- **Evaluate** — potentially useful, needs investigation
- **Watch** — not actionable yet but relevant to roadmap
- **Informational** — good to know, no action needed

For installed plugin changes, additional filter: only surface changes related to features the project actually invokes (grep for skill invocations, agent references, hook patterns in project files).

Report classification summary with counts.

#### Step 4 — Update Rolling Report

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

#### Step 5 — Propose Backlog Items

Same propose-then-approve pattern as `/tooling-review` and `/release-review`.

For each Adopt Now and Evaluate feature:

1. Check for existing backlog overlap: `node scripts/backlog-search.js --text "{feature keywords}"`
2. Draft backlog entries with `source: "claude-review"` and `submitted_by: "Claude"`
3. Present proposals for developer approval — never auto-write
4. Write approved items: `node scripts/backlog-add.js`
5. Re-render backlog: `node scripts/backlog-render.js`
6. Update report with "Backlog proposed: BL-NNNN" line

### 3. Audit Mode (`--audit`)

Full capability review of Claude Code features and installed plugins against current usage.

**Step A1 — Claude Code Capability Scan:**

Enumerate current Claude Code capabilities through documentation and available commands:
- `claude --help` for available commands
- Installed plugins: `claude plugin list`
- Configured hooks from `.claude/settings.json`
- Configured MCP servers from `.mcp.json`
- Available deferred tools from system context

**Step A2 — Cross-Reference with Documentation:**

Compare the capability scan against:
- Rolling report's "Capabilities We Use" — what's documented vs what's actually configured
- Rolling report's "Adoption Opportunities" — what was identified but not yet adopted

**Step A3 — Reference Automation Recommender:**

For broader ecosystem discovery (new plugins, MCP servers, hooks the project doesn't know about), explicitly suggest:

```text
For a broader Claude Code ecosystem scan (new plugins, MCP servers, and automations),
run the `claude-automation-recommender` skill from the claude-code-setup plugin.
```

Do not duplicate the automation recommender's work. The audit focuses on what you already have vs what you're using.

**Step A4 — Update Rolling Report:**

Add audit findings to Adoption Opportunities with `Status: Audit — {date}`. Add audit subsection to Recent Changes.

**Step A5 — Propose Backlog Items:**

Same propose-then-approve workflow for significant audit findings.

**Step A6 — Report:**

Summary with counts: capabilities scanned, in use, opportunities identified, backlog items proposed.

### 4. Context Lookup Mode (`--context <area>`)

On-demand domain-specific capability scan. Read-only — does not update rolling files.

**Area-to-tag mapping:**

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

**Steps:**
1. Map area to tag (reject unknown areas with available list)
2. Scan rolling report for existing entries related to this area
3. Scan configured capabilities for this area
4. Cross-reference backlog for related items
5. Report to console (read-only)
6. Optionally propose backlog items if developer agrees

### 5. Backlog-Only Mode (`--backlog-only`)

Process existing rolling report into backlog items without re-running analysis.

1. Read `docs/tooling-reviews/claude-code.md`
2. Extract Adopt Now / Evaluate items not yet processed into backlog
3. Run propose-then-approve workflow
4. Mark processed entries in the report

### 6. Review Assignments Config

**New config key in `config/sf-toolkit.json`:**

```json
{
  "reviewAssignments": {
    "claude-review": "Display Name",
    "tooling-review": "Display Name",
    "platform-review": "Display Name"
  }
}
```

Values are display names from the `team` config. `null` or missing = everyone sees the reminder. Only skills with cadence checks in `/start-day` are included — `/release-review` is triggered by Salesforce release cycles, not cadence.

### 7. Start-Day Cadence Check Changes

**New block** after the existing Tooling Review Cadence Check (line ~437):

```markdown
### Claude Review Cadence Check

Read `config/sf-toolkit.json` → `reviewAssignments.claude-review`. If assigned and `currentUserName` does not match, skip silently.

Check `docs/tooling-reviews/claude-code.md` for the Last Reviewed date. Remind if >7 days:

{bash}
head -5 docs/tooling-reviews/claude-code.md 2>/dev/null | grep "Last Reviewed:"
{/bash}

Extract the date. If missing or >7 days:

{text}
---
**Claude review reminder:** It's been more than 7 days since `/claude-review` was last run{or "No Claude Code review baseline exists yet — run /claude-review to establish baseline"}.
Claude Code and plugin releases ship frequently — check for new capabilities.

Run: `/claude-review` (weekly check) or `/claude-review --audit` (capability audit)
---
{/text}
```

**Retrofit** the same assignment-aware pattern to the two existing cadence checks:

1. **Tooling Review Cadence Check** (existing, lines ~419-437): Add `reviewAssignments.tooling-review` guard
2. **Platform Review Cadence Check** (existing, lines ~400-415): Add `reviewAssignments.platform-review` guard

Note: `/release-review` does not have a cadence check in start-day — it's triggered by Salesforce release cycles (~3x/year), not weekly cadence. Start-day checks for unprocessed release review *reports* (Step 4d), which is a different pattern and does not need assignment filtering.

Pattern for each cadence check: read assignment from config → if assigned and `currentUserName` doesn't match → skip silently. If not assigned or matches → proceed with existing logic.

### 8. Setup Step

**New step in `/setup`:** "Review Assignments"

After the existing config steps:

1. Check if `reviewAssignments` exists in `config/sf-toolkit.json`
2. If missing, present the question:
   - List the three cadence-based review skills (claude-review, tooling-review, platform-review)
   - For each, ask who should be responsible (from the `team` config)
   - Single-developer projects: default all to that person
   - Multi-developer projects: allow different assignments per review type
3. Write to `config/sf-toolkit.json`

**Setup health check** (non-blocking): If `reviewAssignments` is missing, surface suggestion: "Review assignments not configured — re-run `/setup` to assign review responsibilities."

### 9. Help and README Updates

**`/help`:** Add `/claude-review` to the Documentation group (becomes 7 skills). Add to file path listing. Add to REVIEW chain.

**`README.md`:** Add row to Documentation skills table.

### 10. Version Bump

Bump `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` from 1.5.0 to 1.6.0.

## Behavior Notes

- **Project context is the default relevance filter.** The skill runs in consuming projects by default. Use `--plugin` when developing the plugin itself.
- **Rolling files, not per-run files.** Update `docs/tooling-reviews/claude-code.md` in place. Git history preserves snapshots.
- **Version state lives in report headers.** "Claude Code Version", "Plugin Versions", and "Last Reviewed" in the header are the source of truth. No memory file duplication for weekly reviews.
- **Propose-then-approve for backlog items.** Same pattern as all other review skills. Never auto-write.
- **Graceful degradation.** If web search fails, if `claude --version` output format changes, if plugin list output is unparseable — skip what's broken, complete what you can, report what was skipped.
- **Installed-plugin tracking, not new-plugin discovery.** This skill tracks changes in tools you already use. For discovering new plugins/automations, it defers to `claude-automation-recommender`.
- **First run creates baseline.** If the rolling report doesn't exist, first run creates it with current versions and documents current capabilities. No delta analysis on first run.
- **Review assignments are optional.** Without `reviewAssignments` config, cadence checks fire for everyone (backward compatible).

## Files to Create

| File | Purpose |
|---|---|
| `commands/documentation/claude-review.md` | New skill (~350-400 lines) |

## Files to Modify

| File | Change |
|---|---|
| `commands/process/start-day.md` | Add claude-review cadence check; retrofit assignment-aware logic to all four review cadence checks |
| `commands/setup.md` | Add Review Assignments step; add health check for missing assignments |
| `commands/help.md` | Add /claude-review to Documentation group, file paths, REVIEW chain |
| `README.md` | Add row to Documentation skills table |
| `config/sf-toolkit.json` (template or schema) | Add `reviewAssignments` key documentation |
| `package.json` | Version 1.5.0 -> 1.6.0 |
| `.claude-plugin/plugin.json` | Version 1.5.0 -> 1.6.0 |
| `.claude-plugin/marketplace.json` | Version 1.5.0 -> 1.6.0 |

## Verification

1. `node scripts/validate-plugin.js` — must pass with zero failures
2. `node scripts/test-resolve-cache.js` — must still pass (no cache changes)
3. Manual: invoke `/help` and confirm `/claude-review` appears in Documentation group
4. Manual: read `commands/documentation/claude-review.md` and confirm structure matches design
5. Manual: read `commands/process/start-day.md` and confirm all four cadence checks have assignment-aware logic
6. Manual: read `commands/setup.md` and confirm Review Assignments step exists
7. Manual: run `/claude-review` in a test project to verify baseline creation
