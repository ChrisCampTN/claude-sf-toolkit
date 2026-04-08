---
name: help
description: Interactive skill discovery, usage reference, and topical help for the SF Toolkit plugin
---

# /help — SF Toolkit Help & Discovery

## Arguments

Parse the first argument to determine help mode:

- **No argument** → Overview mode: show all skills grouped by category
- **A skill name** (e.g., `deploy-changed`, `backlog`, `setup`) → Detail mode: show detailed usage for that skill
- **A group name** (`devops`, `documentation`, `process`, `meta`) → Group mode: show all skills in that group
- **A topic** (`first-run`, `config`, `chaining`) → Topic mode: show topical help

## Mode: Overview (no argument)

Display all skills organized by group with one-line descriptions:

```
SF TOOLKIT — Skill Reference

SF DevOps (7):
  /deploy-changed    Build and execute targeted SF deployments from git changes
  /devops-commit     Cherry-pick workflow for DevOps Center work item association
  /detect-drift      Compare org metadata against local git source
  /validate-build    Interactive post-build validation against design spec
  /package-audit     Installed managed package dependency audit
  /test-flows        Native FlowTest metadata generator for record-triggered flows
  /wi-sync           Sync DevOps Center WI status against MEMORY.md

Documentation (6):
  /release-review    Salesforce release note analysis and backlog item proposals
  /doc-flows         Flow technical documentation with interactive first-run
  /doc-components    Hybrid component stack documentation (LWC → Apex → Flow)
  /platform-review   Multi-persona platform review (7 personas)
  /tooling-review    SF CLI + MCP Server release tracking
  /design-review     Design document accuracy review against org and standards

Process (5):
  /backlog           Upstream backlog management (YAML or Salesforce backend)
  /start-day         Daily planning briefing (calendar, email, Slack, git, memory)
  /wrap-up           End-of-session checklist (commit, staleness, memory, lookback)
  /skill-preflight   Pre-run validation checks
  /lookback          Retrospective and shared feedback review

Meta (2):
  /setup             Interactive project bootstrapping and health check
  /help              This help reference

Run /help {skill} for detailed usage, or /help {topic} for topical guides.
Topics: first-run, config, chaining
```

Check each group directory (`commands/devops/`, `commands/documentation/`, `commands/process/`) for installed skill files. If a directory is empty, show the skills listed above with "(not yet installed — coming in a future phase)" appended.

## Mode: Skill Detail (skill name argument)

1. Determine which group the skill belongs to:
   - `deploy-changed`, `devops-commit`, `detect-drift`, `validate-build`, `package-audit`, `test-flows`, `wi-sync` → `commands/devops/`
   - `release-review`, `doc-flows`, `doc-components`, `platform-review`, `tooling-review`, `design-review` → `commands/documentation/`
   - `backlog`, `start-day`, `wrap-up`, `skill-preflight`, `lookback` → `commands/process/`
   - `setup`, `help` → `commands/`

2. Try to read the skill file from the appropriate directory. If found:
   - Extract the description from frontmatter or first paragraph
   - Extract arguments/parameters from any "Arguments" or "Inputs" section
   - Extract prerequisites from any "Prerequisites" or resolution block
   - Extract skill chaining info from any "chains with" or "next steps" references
   - Present in a structured format:

   ```
   /deploy-changed — Build and Execute Targeted SF Deployments

   Description: Filters git changes to deployable Salesforce metadata,
   constructs targeted --source-dir deploy commands, and executes them.

   Arguments:
     --target-org {alias}    Override default dev sandbox
     --dry-run               Validate only, don't deploy

   Prerequisites:
     - Authenticated target org (sf org login)
     - Git changes in force-app/ directory

   Chains with:
     Before: /skill-preflight deploy-changed
     After:  /devops-commit (associate deploy with work item)

   Example:
     /deploy-changed
     /deploy-changed --target-org MySandbox --dry-run
   ```

3. If the skill file is not found (not yet installed), show the description from the overview list and note: "This skill is not yet installed. It will be available in a future phase of the SF Toolkit plugin."

## Mode: Group (group name argument)

Show all skills in the requested group with their full descriptions. Use the same logic as skill detail mode but for all skills in the group.

Valid groups: `devops`, `documentation`, `process`, `meta`

## Mode: Topic (topic argument)

### Topic: `first-run`

```
SF TOOLKIT — First Run Guide

Setting up a new Salesforce DX project with the SF Toolkit:

1. Create your SFDX project:
   sf project generate --name MyProject
   cd MyProject

2. Initialize git:
   git init && git add -A && git commit -m "Initial SFDX project"

3. Authenticate your orgs:
   sf org login web --alias DevSandbox --instance-url https://test.salesforce.com
   sf org login web --alias Production --instance-url https://login.salesforce.com

4. Set default orgs:
   sf config set target-org DevSandbox
   sf config set target-dev-hub Production

5. Install required SF CLI plugins:
   sf plugins install lightning-flow-scanner
   sf plugins install sfdx-git-delta
   sf plugins install sfdmu

6. Install required Claude Code plugins:
   claude plugin install superpowers --scope project
   claude plugin install commit-commands --scope project

7. Run /setup — this will:
   - Scaffold project directories
   - Create config/sf-toolkit.json (team, keywords, backlog)
   - Resolve your SF_USER_ID
   - Generate docs/platform-brief.md from your org
   - Scaffold CLAUDE.md and README.md from templates
   - Verify org connectivity and DevOps Center

8. Customize your scaffolded files:
   - docs/coding-standards.md — adjust naming conventions, test targets
   - docs/build-review-process.md — adjust review modes for your team

9. Start working:
   /start-day          — plan your session
   /backlog add        — capture work items
   /deploy-changed     — deploy your changes
   /devops-commit      — associate with DevOps Center WI
   /wrap-up            — end your session cleanly
```

### Topic: `config`

```
SF TOOLKIT — Configuration Model

The SF Toolkit resolves most configuration automatically from your
Salesforce project files. Only two things require manual config.

AUTO-RESOLVED (no config needed):
  Dev sandbox alias     .sf/config.json → target-org
  Production alias      .sf/config.json → target-dev-hub
  API version           sfdx-project.json → sourceApiVersion
  Metadata path         sfdx-project.json → packageDirectories[0].path
  SF User ID            .env → SF_USER_ID (auto-resolved on first /setup)
  DevOps Center IDs     SOQL at runtime against production
  Flow categories       docs/flows/flow-categories.json (built by /doc-flows)

MANUAL CONFIG (config/sf-toolkit.json):
  team                  Email → display name mapping for all team members
  searchKeywords        Keywords for /release-review and /tooling-review
  backlog.backend       "yaml" (file-based) or "salesforce" (custom object)

PER-DEVELOPER (.env — gitignored):
  SF_USER_ID            Your Salesforce user ID
  SLACK_WEBHOOK_URL     Slack webhook for flow change notifications
```

### Topic: `chaining`

```
SF TOOLKIT — Skill Chaining Workflows

Common skill chains for daily Salesforce development:

SESSION START:
  /start-day → prioritized work plan from memory, git, calendar, Slack

BUILD CYCLE:
  /skill-preflight {skill}  → validate pre-conditions
  [build work]              → write code/metadata
  /deploy-changed           → deploy to dev sandbox
  /devops-commit            → associate commit with WI

DRIFT RECOVERY:
  /detect-drift             → find org changes not in source
  [retrieve changes]        → pull into local source
  /deploy-changed           → push to dev sandbox
  /devops-commit            → track with work item

DOCUMENTATION:
  /doc-flows                → document flows (first-run: categorize)
  /doc-components           → document LWC stacks

PLANNING:
  /backlog add              → capture new work
  /backlog evaluate         → assess priority/effort
  /backlog graduate         → create DevOps Center WI
    → /design-review        → validate design doc (auto-called)

REVIEW:
  /platform-review          → quarterly multi-persona review
  /release-review           → Salesforce release analysis
  /tooling-review           → SF CLI + MCP updates

SESSION END:
  /wrap-up                  → commit, staleness check, memory, lookback
  /lookback                 → retrospective (standalone, not in wrap-up)

HEALTH CHECK:
  /setup --check            → project dependency status
  /wi-sync                  → sync WI status from DevOps Center
  /package-audit            → managed package health
```
