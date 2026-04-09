# Claude SF Toolkit

A Claude Code plugin that packages reusable Salesforce DX skills, agent prompts, script templates, git hooks, and project scaffolding. Near-zero configuration — resolves org aliases, API versions, and DevOps Center IDs from native Salesforce project files and runtime SOQL queries.

## Prerequisites

- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (v2+)
- [Node.js](https://nodejs.org/) (LTS)
- [Claude Code](https://claude.ai/claude-code)

### Required SF CLI Plugins

```bash
sf plugins install lightning-flow-scanner   # Flow static analysis
sf plugins install sfdx-git-delta           # Delta package.xml from git diffs
sf plugins install sfdmu                    # Data backup/restore across sandbox refreshes
```

### Required Claude Code Plugins

```bash
claude plugin install superpowers --scope project
claude plugin install commit-commands --scope project
```

## Installation

```bash
claude plugin marketplace add ChrisCampTN/claude-sf-toolkit && claude plugin install claude-sf-toolkit --scope project
```

### Updating

```bash
claude plugin marketplace add ChrisCampTN/claude-sf-toolkit && claude plugin install claude-sf-toolkit --scope project
```

The marketplace add refreshes the source, and the install picks up the latest version. Both commands must run in the same session.

On your next session, the hook will print a notice if the version changed.

## Quick Start

After installation, open your Salesforce DX project in Claude Code and run:

```
/setup
```

This will walk you through:
1. Scaffolding standard project directories
2. Creating `config/sf-toolkit.json` (team mapping, search keywords, backlog backend)
3. Resolving your `SF_USER_ID` from the org
4. Generating `docs/platform-brief.md` from live org queries
5. Scaffolding `CLAUDE.md` and `README.md` from templates
6. Verifying org connectivity and DevOps Center

Run `/setup --check` anytime for a project health report.

## Skills Reference

### SF DevOps (7)

| Skill | Description | Key Parameters |
|-------|-------------|----------------|
| `/deploy-changed` | Build and execute targeted SF deployments from git changes | `--target-org`, `--dry-run` |
| `/devops-commit` | Cherry-pick workflow for DevOps Center work item association | `--deploy-org` |
| `/detect-drift` | Compare org metadata against local git source | `--target-org` |
| `/validate-build` | Interactive post-build validation against design spec | `BL-NNNN` or `WI-NNNNNN`, `--section` |
| `/package-audit` | Installed managed package dependency audit | `--target-org` |
| `/test-flows` | Native FlowTest metadata generator for record-triggered flows | `--target-org` |
| `/wi-sync` | Sync DevOps Center WI status against MEMORY.md | `--dry-run` |

### Documentation (6)

| Skill | Description | Key Parameters |
|-------|-------------|----------------|
| `/release-review` | Salesforce release note analysis and backlog item proposals | — |
| `/doc-flows` | Flow technical documentation with interactive first-run categorization | `--target-org` |
| `/doc-components` | Hybrid component stack documentation (LWC → Apex → Flow) | — |
| `/platform-review` | Multi-persona platform review (7 personas) | `--target-org` |
| `/tooling-review` | SF CLI + MCP Server release tracking | — |
| `/design-review` | Design document accuracy review against org metadata and standards | doc path or `BL-NNNN` |

### Process (5)

| Skill | Description | Key Parameters |
|-------|-------------|----------------|
| `/backlog` | Upstream backlog management (YAML or Salesforce backend) | subcommand: `add`, `evaluate`, `graduate`, `search`, `render` |
| `/start-day` | Daily planning briefing (calendar, email, Slack, git, memory) | `--no-external` |
| `/wrap-up` | End-of-session checklist (commit, staleness, memory, lookback) | — |
| `/skill-preflight` | Pre-run validation checks | skill name |
| `/lookback` | Retrospective and shared feedback review | — |

### Meta (2)

| Skill | Description | Key Parameters |
|-------|-------------|----------------|
| `/setup` | Interactive project bootstrapping and health check | `--check` |
| `/help` | Interactive skill discovery and usage reference | skill name, group, or topic |

## Configuration

### Self-Resolving Values (no config needed)

| Value | Source | Method |
|-------|--------|--------|
| Dev sandbox alias | `.sf/config.json` | `target-org` field |
| Production org alias | `.sf/config.json` | `target-dev-hub` field |
| API version | `sfdx-project.json` | `sourceApiVersion` field |
| Metadata path | `sfdx-project.json` | `packageDirectories[0].path` |
| SF User ID | `.env` | `SF_USER_ID` — auto-resolved on first `/setup` |
| DevOps Center IDs | SOQL at runtime | Queries against production |
| Flow categories | `docs/flows/flow-categories.json` | Built by `/doc-flows` interactive first-run |

### Manual Config (`config/sf-toolkit.json`)

The only file you need to create — and `/setup` does it interactively:

```json
{
  "searchKeywords": "salesforce OR deploy OR sandbox OR production",
  "searchKeywordsLastReviewed": "2026-04-07",
  "team": {
    "dev@example.com": "Developer Name"
  },
  "backlog": {
    "backend": "yaml"
  }
}
```

### Per-Developer Config (`.env` — gitignored)

```
SF_USER_ID=005XXXXXXXXXXXX
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

## How It Resolves Context

Every skill invocation starts with the **resolver agent** (`sf-toolkit-resolve`), which:

1. Reads `.sf/config.json` for org aliases
2. Reads `sfdx-project.json` for API version and metadata path
3. Reads `config/sf-toolkit.json` for team and backlog config
4. Reads `.env` for user ID and webhook
5. Queries DevOps Center (production) for project/pipeline/environment IDs
6. Returns a structured context object consumed by all skills

Results are cached per session — SOQL queries only run once.

## First-Run Behaviors

Some skills have interactive first-run setup:

- **`/doc-flows`** — First run in a new project prompts you to categorize all flows into functional groups. Saves to `docs/flows/flow-categories.json`. Subsequent runs use the saved categories.
- **`/doc-components`** — First run generates `docs/components/skip-list.json` for components to exclude from documentation.
- **`/setup`** — Always interactive on first run. Subsequent runs detect existing config and skip completed steps.

## Skill Chaining

Common workflows:

```
Session start:     /start-day
Build cycle:       /skill-preflight → [build] → /deploy-changed → /devops-commit
Drift recovery:    /detect-drift → [retrieve] → /deploy-changed → /devops-commit
Planning:          /backlog add → /backlog evaluate → /backlog graduate → /design-review
Review:            /platform-review, /release-review, /tooling-review
Session end:       /wrap-up
```

## Hooks

The plugin provides three hooks:

| Hook | Trigger | Behavior |
|------|---------|----------|
| `session-start.sh` | Session start | Warns on missing plugins and config |
| `pre-commit` | `git commit` | Runs lint-staged + blocks `force-app/` on main |
| `post-commit` | After commit | Detects flow changes, queues for `/doc-flows`, Slack notification |

Hooks are in the `hooks/` directory. Copy them to your project's `.husky/` or configure via Husky.

## Templates

Project scaffolding templates in `templates/`:

| Template | Purpose |
|----------|---------|
| `CLAUDE.md.template` | AI assistant instructions with SF-specific architecture rules |
| `README.md.template` | Project README with SF DX setup instructions |
| `MEMORY.md.template` | Shared project memory index |
| `platform-brief.md.template` | Org metadata brief (auto-populated by agent) |
| `build-review-process.md.template` | Build session review discipline |
| `coding-standards.md.template` | SF declarative + Apex development standards |
| `backlog.yaml` | Empty backlog with schema documentation |
| `tags.yaml` | Empty tag list for backlog items |
| `sf-toolkit.json` | Empty plugin config |

## Updating

The plugin auto-updates when installed from a git URL. To manually update:

```bash
claude plugin update claude-sf-toolkit
```

Skills, agents, and templates update automatically. Project files (`config/sf-toolkit.json`, customized templates) are never overwritten.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Skills not appearing | Run `claude plugin list` to verify installation |
| Org connection fails | Run `sf org login web --alias {alias}` to re-authenticate |
| DevOps Center queries fail | Ensure `target-dev-hub` points to production (DevOps Center lives there) |
| MCP server not connecting | Check `cmd /c` wrapper on Windows (see CLAUDE.md template) |
| `force-app/` commit blocked | Use `/devops-commit` for WI branches, or `ALLOW_FORCEAPP_ON_MAIN=1` |
| Missing SF_USER_ID | Run `/setup` — it auto-resolves from the org |
| Flow scanner not found | Run `sf plugins install lightning-flow-scanner` |

## Interactive Help

Run `/help` in any project for:
- `/help` — overview of all skills
- `/help deploy-changed` — detailed usage for a specific skill
- `/help devops` — all skills in the DevOps group
- `/help first-run` — step-by-step new project guide
- `/help config` — configuration model explained
- `/help chaining` — common skill workflows

## License

MIT
