---
name: setup
description: Interactive project bootstrapping and health check for Salesforce DX projects using the SF Toolkit plugin
---

# /setup — Project Setup & Health Check

## Arguments

- No arguments: full interactive setup (detect state, scaffold, configure, generate)
- `--check`: health check mode — run dependency check and report, no modifications

## Mode: Health Check (`--check`)

Run `scripts/check-dependencies.sh` from the plugin directory and report results. No modifications to the project.

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/check-dependencies.sh"
```

If the script is not found, fall back to inline checks:
1. Check for `sfdx-project.json`
2. Check for `.sf/config.json` with `target-org` and `target-dev-hub`
3. Check for `config/sf-toolkit.json`
4. Check for `.env` with `SF_USER_ID`
5. Check required directories exist
6. Check for `docs/platform-brief.md`, `CLAUDE.md`, `README.md`
7. Check for `reviewAssignments` key in `config/sf-toolkit.json` — if missing, surface suggestion: "Review assignments not configured — re-run `/setup` to assign review responsibilities."

Report results as pass/warn/fail table, then stop.

## Mode: Full Setup (no arguments)

### Step 1: Detect Project State

Read these files and directories to understand what already exists:

- `sfdx-project.json` — is this an SFDX project?
- `.sf/config.json` — are orgs configured?
- `config/sf-toolkit.json` — has the toolkit been configured?
- `.env` — does it have SF_USER_ID?
- Check directories: `docs/backlog`, `docs/flows`, `docs/components`, `docs/design`, `docs/tooling-reviews`, `docs/release-reviews`, `docs/platform-reviews`, `docs/validation`, `config`, `scripts`, `.claude/memory`, `.claude/agents`
- Check files: `docs/platform-brief.md`, `CLAUDE.md`, `README.md`, `.claude/memory/MEMORY.md`, `docs/coding-standards.md`, `docs/build-review-process.md`

Report what was found and what's missing. If `sfdx-project.json` doesn't exist, warn that this doesn't appear to be an SFDX project and ask if the user wants to continue.

### Step 2: Scaffold Missing Directories

Run the scaffold script or create directories inline:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-project.js" "$(pwd)" "{backlogBackend}"
```

If the script isn't available, create directories using mkdir:

```
docs/backlog/           (only if backlog backend is "yaml")
docs/flows/
docs/components/
docs/design/
docs/tooling-reviews/
docs/release-reviews/
docs/platform-reviews/
docs/validation/
config/
scripts/
.claude/memory/
.claude/agents/
```

Report what was created vs what already existed.

### Step 3: Create `config/sf-toolkit.json` (Interactive)

If `config/sf-toolkit.json` doesn't exist, walk the developer through creating it:

1. **Team mapping:** Ask for each team member's email and display name. Keep asking until they say "done". Format as `{"email": "name"}` pairs.

2. **Search keywords:** Ask what keywords to use for `/release-review` and `/tooling-review` searches (e.g., "salesforce OR deploy OR sandbox OR production"). Explain these filter release notes and tooling updates.

3. **Backlog backend:** Ask "yaml" (file-based, works immediately) or "salesforce" (custom object — requires additional setup). Default to yaml. (This may be overridden by the DevOps backend choice below.)

4. **DevOps backend:** Ask which DevOps backend this project uses:
   - **SF DevOps Center** (default) — Work Items, DOC pipeline, SOQL-based tracking
   - **GitHub Actions** — GitHub Issues for tracking, GHA workflows for CI/CD, PR-based promotion

   If "GitHub Actions" is selected:
   - Set `devops.backend` to `"github-actions"`
   - Ask which environments are managed by GHA (default: `["staging", "production"]`)
   - Ask which environments allow local deploys (default: `["dev"]`)
   - Override `backlog.backend` to `"github-issues"` (inform the user: "Backlog will use GitHub Issues since you're using GitHub Actions for DevOps.")
   
   If "SF DevOps Center" is selected (or default):
   - Set `devops.backend` to `"devops-center"`
   - Set `devops.environments.managed` to `[]`
   - Set `devops.environments.local` to `["dev", "staging", "production"]`

Write the file:

```json
{
  "searchKeywords": "{user input}",
  "searchKeywordsLastReviewed": "{today's date}",
  "team": {
    "{email}": "{name}"
  },
  "backlog": {
    "backend": "{yaml|salesforce}"
  },
  "devops": {
    "backend": "{devops-center|github-actions}",
    "environments": {
      "local": ["{env aliases for local deploy}"],
      "managed": ["{env aliases managed by GHA}"]
    }
  },
  "cache": {
    "ttlHours": 24
  },
  "reviewAssignments": {
    "claude-review": "{name or null}",
    "tooling-review": "{name or null}",
    "platform-review": "{name or null}"
  }
}
```

5. **GitHub label bootstrapping** (GHA mode only):

   If `devops.backend` is `"github-actions"`, create the label taxonomy in the GitHub repo. Derive the repo from `git remote get-url origin`.

   Run these commands (idempotent — `gh label create` skips existing labels):

   ```bash
   # Priority
   gh label create "P1" --description "Critical priority" --color "B60205" --force
   gh label create "P2" --description "High priority" --color "D93F0B" --force
   gh label create "P3" --description "Medium priority" --color "FBCA04" --force
   gh label create "P4" --description "Low priority" --color "0E8A16" --force

   # Effort
   gh label create "effort:XS" --description "Extra small effort" --color "C5DEF5" --force
   gh label create "effort:S" --description "Small effort" --color "C5DEF5" --force
   gh label create "effort:M" --description "Medium effort" --color "C5DEF5" --force
   gh label create "effort:L" --description "Large effort" --color "C5DEF5" --force
   gh label create "effort:XL" --description "Extra large effort" --color "C5DEF5" --force

   # Complexity
   gh label create "complexity:low" --description "Low complexity" --color "D4C5F9" --force
   gh label create "complexity:med" --description "Medium complexity" --color "D4C5F9" --force
   gh label create "complexity:high" --description "High complexity" --color "D4C5F9" --force

   # Status
   gh label create "status:captured" --description "Backlog: captured" --color "E4E669" --force
   gh label create "status:groomed" --description "Backlog: groomed/evaluated" --color "E4E669" --force
   gh label create "status:prioritized" --description "Backlog: prioritized" --color "E4E669" --force
   gh label create "status:in-progress" --description "Backlog: in progress" --color "1D76DB" --force
   gh label create "status:deferred" --description "Backlog: deferred" --color "E4E669" --force

   # Source
   gh label create "source:team" --description "Team member submission" --color "BFD4F2" --force
   gh label create "source:stakeholder" --description "Stakeholder request" --color "BFD4F2" --force
   gh label create "source:vendor" --description "Vendor evaluation" --color "BFD4F2" --force
   gh label create "source:claude" --description "Claude session submission" --color "BFD4F2" --force

   # CBC (Claude Build Confidence)
   gh label create "cbc:1" --description "CBC 1 — vague idea" --color "F9D0C4" --force
   gh label create "cbc:2" --description "CBC 2 — concept defined, unknowns remain" --color "F9D0C4" --force
   gh label create "cbc:3" --description "CBC 3 — requirements clear, some open questions" --color "FBCA04" --force
   gh label create "cbc:4" --description "CBC 4 — well-specified, minor decisions" --color "0E8A16" --force
   gh label create "cbc:5" --description "CBC 5 — fully specified, ready to build" --color "0E8A16" --force

   # Dependencies
   gh label create "blocked" --description "Blocked by another item" --color "B60205" --force
   gh label create "archived" --description "Archived backlog item" --color "EEEEEE" --force
   ```

   For each category in `backlog.categories`:

   ```bash
   gh label create "cat:{category}" --description "Category: {category}" --color "006B75" --force
   ```

   Report: "Created {n} labels in {repo}. {n} already existed (skipped)."

6. **Review assignments:** After the team mapping is complete, ask who should be responsible for each cadence-based review skill. Present the three review types:
   - `claude-review` — Claude Code + plugin release tracking (weekly cadence)
   - `tooling-review` — SF CLI + MCP Server release tracking (weekly cadence)
   - `platform-review` — Multi-persona platform review (quarterly cadence)

   For single-developer teams (only one entry in `team`): default all three to that person.
   For multi-developer teams: ask which team member should own each review type. Values are display names from the `team` config. Use `null` for "everyone sees the reminder" (no assignment).

The `cache.ttlHours` controls how long the resolver cache (`.claude/sf-toolkit-cache.json`) is valid before skills re-dispatch the resolver agent. Default is 24 hours. Set lower for rapidly-changing environments, or higher for stable orgs.

If the file already exists, show its contents and ask if the user wants to update it. If not, skip.

### Step 4: Scaffold Starter Files

Copy templates for any missing files. Only create files that don't already exist.

| Missing File | Template Source (from plugin) | Notes |
|---|---|---|
| `docs/backlog/backlog.yaml` | `templates/backlog.yaml` | Only if backend is "yaml" |
| `docs/backlog/tags.yaml` | `templates/tags.yaml` | Only if backend is "yaml" |
| `docs/flows/flow-categories.json` | Write `{}` | Empty signals /doc-flows first-run |
| `docs/components/skip-list.json` | Write `[]` | Empty skip list |
| `docs/coding-standards.md` | `templates/coding-standards.md.template` | Tell user to customize |
| `docs/build-review-process.md` | `templates/build-review-process.md.template` | Tell user to customize |
| `.claude/memory/MEMORY.md` | `templates/MEMORY.md.template` | Replace {{PROJECT_NAME}} with project name from sfdx-project.json or user input |

For template files, read from `${CLAUDE_PLUGIN_ROOT}/templates/` and write to the project. Replace `{{PROJECT_NAME}}` placeholders with the actual project name.

### Step 5: `.env` + SF_USER_ID

If `.env` is missing or doesn't contain `SF_USER_ID`:

1. Read the current target-org from `.sf/config.json`
2. If target-org is set, run: `sf config get target-org --json` to get the username
3. Query: `SELECT Id FROM User WHERE Username = '{username}'` against the target-org
4. Present to developer: "Your Salesforce User ID appears to be {id}. Is this correct?"
5. If confirmed, write/append to `.env`:
   ```
   SF_USER_ID={id}
   ```
6. If `.env` doesn't exist, create it. If it exists, append.
7. Verify `.env` and `.claude/sf-toolkit-cache.json` are in `.gitignore`. If not, warn the user.

Also check for `SLACK_WEBHOOK_URL` in `.env`. If missing, inform the user that Slack notifications won't work until they add it, and provide the format: `SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...`

### Step 6: Platform Brief

If `docs/platform-brief.md` doesn't exist or the user requests a refresh:

1. Dispatch the `sf-toolkit-platform-brief` agent with:
   - `{{productionOrg}}`: production org alias from `.sf/config.json` → `target-dev-hub`
   - `{{mode}}`: "create" if file doesn't exist, "refresh" if it does

2. The agent will query the org and present results for review
3. After developer approval, write to `docs/platform-brief.md`

If the production org isn't configured yet, skip this step and note it in the final report.

### Step 7: CLAUDE.md

If `CLAUDE.md` doesn't exist:

1. Read `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md.template`
2. Ask the user to fill in the interactive placeholders:
   - `{{PROJECT_DESCRIPTION}}`: one paragraph about the project
   - `{{MANAGED_PACKAGE_NOTES}}`: what middleware/packages handle integrations
   - `{{LICENSE_TYPES}}`: license types in use (e.g., "Enterprise (internal), Community Plus (partners)")
   - `{{ORG_SPECIFIC_DEVOPS_NOTES}}`: project-specific DevOps Center or pipeline notes
   - `{{PROJECT_SPECIFIC_WARNINGS}}`: any additional critical warnings
   - `{{DATA_MODEL_SUMMARY}}`: key objects and their relationships (can reference a KB doc)
3. Replace placeholders and write the file

If `CLAUDE.md` already exists:

1. Read the existing file
2. Check for missing sections compared to the template (Architecture Rules, Org & DevOps, Key Commands, MCP Servers, SF CLI Plugins, Skills, Critical Warnings, Working With Claude, Shared Memory Architecture)
3. If sections are missing, propose additions. Show what would be added and ask for confirmation.
4. If all sections present, report "CLAUDE.md looks complete" and skip.

### Step 8: README.md

Same pattern as CLAUDE.md:

- If missing: read `templates/README.md.template`, walk through placeholders (`{{PROJECT_NAME}}`, `{{PROJECT_DESCRIPTION}}`, `{{ARCHITECTURE_SUMMARY}}`, `{{TEAM_TABLE}}`), write file
- If exists: check for completeness, propose additions if needed

### Step 9: Verify Org Connectivity & DevOps Center

1. Run `sf org display --target-org {dev-alias} --json` — verify dev sandbox is reachable
2. Run `sf org display --target-org {production-alias} --json` — verify production is reachable
3. Query `SELECT Id, Name FROM DevopsProject` against production — verify DevOps Center is configured
4. Report results: connected/unreachable for each org, DevOps Center project name(s)

If either org is unreachable, provide the auth command to fix it.

### Step 10: Check Plugin Dependencies

Check for required Claude Code plugins:

```bash
claude plugin list 2>/dev/null
```

Required: `superpowers`, `commit-commands`
Recommended: `context7`, `skill-creator`

For any missing required plugins, install them:

```bash
claude plugin install {plugin} --scope project
```

Report which are installed, which were auto-installed, and which recommended plugins are missing with install commands.

### Step 11: LWC Development Readiness

Check if the project has LWC components and whether the testing toolchain is configured:

1. **Detect LWC presence:** Check if `{context.metadataPath}/lwc/` exists and contains component directories.
2. **If LWC components exist:**
   - Check if `package.json` exists at the project root. If not, warn: "No package.json — LWC Jest tests require a Node.js project. Run `npm init -y` to create one."
   - Check if `@salesforce/sfdx-lwc-jest` is in `devDependencies`:
     ```bash
     node -e "try { require.resolve('@salesforce/sfdx-lwc-jest'); console.log('installed'); } catch { console.log('missing'); }"
     ```
   - If missing, recommend: `npm install --save-dev @salesforce/sfdx-lwc-jest`
   - Check if a Jest config exists (`jest.config.js`, `jest.config.ts`, or `jest` key in `package.json`). If missing, recommend creating one.
   - Check if any `__tests__/` directories exist under `{context.metadataPath}/lwc/`. If zero test files found across all components, note: "No LWC test files found. The `/deploy-changed` and `/validate-build` skills will run Jest tests automatically when they exist."
3. **If no LWC components exist:** Skip this step silently.

### Step 12: Invalidate Resolver Cache


Delete `.claude/sf-toolkit-cache.json` if it exists — setup may have changed org aliases, team mapping, or config values that would make a stale cache dangerous.

```bash
rm -f .claude/sf-toolkit-cache.json
```

### Step 13: Summary Report

Print a structured summary:

```
SF TOOLKIT SETUP — COMPLETE

Project: {name}
Dev Org: {alias} — {connected/unreachable}
Production: {alias} — {connected/unreachable}
DevOps Center: {project name or "not configured"}

Created:
  ✓ config/sf-toolkit.json
  ✓ .claude/memory/MEMORY.md
  ✓ docs/platform-brief.md
  ... (list everything created)

Skipped (already existed):
  - CLAUDE.md
  - README.md
  ... (list everything that already existed)

LWC Readiness:
  {LWC components found: N components}
  {Jest: installed / ⚠ not installed}
  {Test files: N components with tests, M without}

Warnings:
  ⚠ Missing SLACK_WEBHOOK_URL in .env
  ... (list any warnings)

Next Steps:
  1. Review and customize docs/coding-standards.md
  2. Review and customize docs/build-review-process.md
  3. Add SLACK_WEBHOOK_URL to .env for flow change notifications
  4. {If Jest missing and LWC present: Install LWC Jest: npm install --save-dev @salesforce/sfdx-lwc-jest}
  5. Run /help to explore available skills
  6. Run /start-day to begin your first session
```
