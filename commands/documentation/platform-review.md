---
name: platform-review
description: Multi-persona platform review (Security, QA, Standards, Docs, Agentforce, Analytics, DevOps) — produces prioritized findings report
---

# /platform-review — Multi-Persona Platform Review

Run a structured, multi-pass review of the Salesforce platform using 7 expert personas. Each persona examines targeted areas of the codebase and org, producing classified findings. Results are consolidated into a prioritized report that feeds directly into the backlog.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- `all` or empty — run all 7 personas sequentially (default)
- Comma-separated persona keys: `security,qa,docs`
- `--resume` — pick up from last checkpoint directory
- `--target-org <alias>` — org for queries (default: `{context.orgs.devAlias}`)
- `--severity-threshold <level>` — minimum severity for backlog candidates: Critical, High, Medium, Low (default: Medium)
- `--no-backlog` — skip the Backlog Bridge (Step 9). Run personas + consolidation only. The `backlog-candidates.json` is still generated — run `/platform-review --backlog-only` later to pick it up.
- `--backlog-only` — skip personas and consolidation, jump straight to Backlog Bridge (Step 9) using the most recent checkpoint directory. Use this to process findings from a previous run.

**Persona keys:** `security`, `qa`, `docs`, `coding-standards`, `agentforce`, `analytics`, `devops`

---

## Resolution

Dispatch the `sf-toolkit-resolve` agent. Use the returned context for all
org references, team lookups, and path resolution in subsequent steps.
If `missing` contains values this skill requires, stop and instruct the
developer to run `/setup`.

### Script Resolution

This skill uses helper scripts. For each script reference, check the local project `scripts/` directory first. If not found locally, check the plugin `script-templates/` directory and copy to the project's `scripts/` before use.

| Script                              | Purpose                                          |
| ----------------------------------- | ------------------------------------------------ |
| `platform-review-consolidate.js`    | Merge, deduplicate, and sort persona findings    |
| `backlog-add.js`                    | Add items to backlog                             |
| `backlog-render.js`                 | Regenerate backlog README                        |
| `flow-index.js`                     | Flow metadata for QA and Standards personas      |

---

## Step 0 — Preflight & Setup

Invoke `/skill-preflight platform-review` to run the `git`, `org`, and `metadata` suites. If any FAIL-level issues are found, stop.

Parse arguments:

```
TARGET_ORG = argument --target-org, or "{context.orgs.devAlias}" if not provided
SEVERITY_THRESHOLD = argument --severity-threshold, or "Medium" if not provided
PERSONAS = argument list, or all 7 if empty / "all"
RESUME = true if --resume flag present
NO_BACKLOG = true if --no-backlog flag present
BACKLOG_ONLY = true if --backlog-only flag present
DATE = today's date (YYYY-MM-DD)
CHECKPOINT_DIR = docs/platform-review/{DATE}
```

**Mode resolution:**

- `--backlog-only` -> skip Steps 0-8, find the most recent `docs/platform-review/*/` directory with a `backlog-candidates.json`, and jump to Step 9 (Backlog Bridge).
- `--no-backlog` -> run Steps 0-8 normally, skip Step 9 (Backlog Bridge). The consolidation script still generates `backlog-candidates.json` for later use.
- Default -> run all steps including Backlog Bridge.

Create the checkpoint directory if it doesn't exist. If `--resume`, find the most recent `docs/platform-review/*/` directory and read `_progress.json` to determine which personas are already complete — skip them.

Initialize `_progress.json`:

```json
{
  "started_at": "{ISO timestamp}",
  "target_org": "{TARGET_ORG}",
  "severity_threshold": "{SEVERITY_THRESHOLD}",
  "personas_requested": ["{list}"],
  "completed": {},
  "pending": ["{remaining personas}"],
  "current": null
}
```

**API version check (lightweight):** Query production API version and compare to project configuration. If they differ, note that the project API version should be updated and that a full `/release-review` should be run for the new release.

```bash
sf org display --target-org {context.orgs.productionAlias} --json
```

Compare the `apiVersion` result to `{context.apiVersion}`. If mismatched, note the discrepancy in the final report recommending `/release-review`.

**Platform context:** Read `docs/platform-brief.md` for the current tech stack, active initiatives, license constraints, and integrations. All 7 personas should use this as their baseline context for what the platform uses and where the active work is focused.

**Safety:** This skill is **read-only** (Tier 1). It queries orgs and reads source files but never deploys, modifies records, or writes to any org. The production org may be queried for read-only data (Data Cloud, Knowledge, Reports) per production read-only access rules.

---

## Step 1 — Security Analyst

**Persona context:** You are a Salesforce security analyst reviewing the platform. You are assessing the platform's security posture, identifying vulnerabilities, and evaluating whether protective features are enabled.

### Scope

- `{context.metadataPath}/permissionsets/*.permissionset-meta.xml` — FLS grants, object permissions, system permissions
- `{context.metadataPath}/profiles/*.profile-meta.xml` — Community profiles, guest user access
- `{context.metadataPath}/classes/*.cls` — sharing model, SOQL injection patterns, `@AuraEnabled` FLS enforcement
- `{context.metadataPath}/lwc/` — client-side security
- `{context.metadataPath}/aura/` — Aura component security
- `{context.metadataPath}/customMetadata/` — sensitive data in CMT records
- Org query: guest user profile permissions, session settings

### Examination

1. **Permission model review:**
   - Read each Community profile XML — flag `ModifyAllData`, `ViewAllData`, `AuthorApex`, or other overprivileged system permissions
   - Review permission sets for minimal-privilege compliance
   - Check for FLS grants on sensitive fields (SSN, financial data, PHI) in Community-facing permission sets

2. **Apex security scan:**
   - Grep classes for `without sharing` — flag any that handle sensitive data
   - Grep for dynamic SOQL without `String.escapeSingleQuotes` — SOQL injection risk
   - Grep for `@AuraEnabled` methods — verify they enforce FLS (check for `WITH USER_MODE` or `WITH SECURITY_ENFORCED` or manual FLS checks)
   - Check trigger framework for proper `with sharing` declaration

3. **LWC/Aura client-side review:**
   - Review LWC components for sensitive data handling (e.g., payment card inputs, PCI scope)
   - Check `@api` properties that could leak data to parent components
   - Review wire adapters for over-fetching sensitive fields

4. **Experience Cloud exposure:**
   - Query org for guest user profile: `SELECT Id, Name FROM Profile WHERE UserType = 'Guest'`
   - Check guest user object permissions — should be extremely minimal
   - Review Community self-registration settings

5. **API flow authentication:**
   - Review `API_*` flows — are they invocable-only (requiring authenticated context) or auto-launched with potential external triggers?

6. **Salesforce Shield evaluation:**
   - Assess Platform Encryption opportunities — field-level encryption for PII/PHI fields
   - Assess Event Monitoring value — login forensics, API usage tracking, report export monitoring for compliance
   - Assess Field Audit Trail — extended field history beyond 18-month standard for compliance-critical fields
   - Query org for existing Shield enablement status
   - Recommend Shield features that address identified security gaps, with priority based on data sensitivity

### Output

Write findings to `{CHECKPOINT_DIR}/security.findings.json` using the finding schema (ID prefix: `SEC-`). Update `_progress.json`.

Display progress: "Security Analyst complete: {n} Critical, {n} High, {n} Medium, {n} Low findings."

---

## Step 2 — QA Lead

**Persona context:** You are a QA lead reviewing test coverage and quality assurance gaps across the platform. Your job is to identify the highest-risk untested areas and recommend a testing strategy.

### Scope

- `{context.metadataPath}/flowtests/` — existing flow test inventory
- `{context.metadataPath}/classes/*Test*.cls` and `*_Test.cls` — Apex test class inventory
- `{context.metadataPath}/flows/` — full flow catalog
- `docs/design/` — design docs with testing requirements

### Examination

1. **Flow test coverage:**
   - Run `node scripts/flow-index.js --stats` to get flow counts by category and type
   - Count record-triggered flows vs. flow test files — calculate coverage percentage
   - Identify the top 20 highest-risk untested flows by priority:
     - Flows touching financial objects (billing, payment, transaction objects)
     - Payment processing flows
     - Application processing flows: intake, decisioning, funding
     - Batch/scheduled flows with financial impact

2. **Apex test coverage:**
   - Use MCP `get_apex_code_coverage` to query org-level coverage data (if available)
   - List production classes without corresponding test classes
   - Identify test classes with minimal assertions (smoke tests vs. real validation)

3. **Integration test gaps:**
   - Identify untested integration paths: callback flows, payment flows, integration-triggered flows
   - Assess whether sandbox data supports meaningful integration testing

4. **E2E test strategy assessment:**
   - Check `docs/design/` for any existing test strategy documents
   - Identify screen flows with complex user journeys that need E2E coverage
   - Assess regression risk: which areas break most often?

5. **Test data concerns:**
   - Flag flows that require realistic data to test properly
   - Note high-volume objects — test data must account for governor limits

### Output

Write findings to `{CHECKPOINT_DIR}/qa.findings.json` (ID prefix: `QA-`). Update `_progress.json`.

---

## Step 3 — Coding Standards Manager

**Persona context:** You are a development manager reviewing compliance with the team's coding standards document (`docs/coding-standards.md`). You are looking for violations, anti-patterns, and optimization opportunities.

### Scope

- `docs/coding-standards.md` — the authoritative standard (read first)
- `{context.metadataPath}/flows/*.flow-meta.xml` — naming, design patterns
- `{context.metadataPath}/classes/*.cls` — Apex standards
- `{context.metadataPath}/objects/` — object/field naming conventions
- `{context.metadataPath}/triggers/` — trigger framework compliance

### Examination

1. **Flow naming compliance:**
   - Run `node scripts/flow-index.js` to get all flow names
   - Check naming convention per coding standards (type prefixes, casing rules)
   - Flag flows with incorrect prefixes or non-compliant names

2. **Flow design standards:**
   - Run `sf flow scan --directory {context.metadataPath}/flows` (lightning-flow-scanner) for automated anti-pattern detection
   - Sample 20-30 flow XMLs checking for:
     - Missing `<description>` elements
     - Missing fault paths on DML/callout elements
     - DML in loops
     - Hardcoded record IDs
   - Report flow-scanner results with specific flow names and violation types

3. **Apex standards:**
   - Sample Apex classes for naming compliance: UpperCamelCase classes, lowerCamelCase methods (verb-first)
   - Check trigger framework: triggers should delegate to handler classes, handlers should use singleton pattern with recursion guards
   - Grep for anti-patterns: `global` modifier (should be avoided), `System.debug()` in non-test classes, `Test.isRunningTest()` branching
   - Check SOQL patterns: keywords should be uppercase, bind variables preferred, `WITH USER_MODE` or `WITH SECURITY_ENFORCED` present

4. **Object/field naming:**
   - Check custom objects in `{context.metadataPath}/objects/` for PascalCase convention
   - Sample custom fields for naming convention compliance and required descriptions

5. **New vs legacy compliance:**
   - Compare recently-built components against older components — are new builds following standards?
   - Identify technical debt from standards non-compliance

### Output

Write findings to `{CHECKPOINT_DIR}/coding-standards.findings.json` (ID prefix: `STD-`). Update `_progress.json`.

---

## Step 4 — Documentation Analyst

**Persona context:** You are a documentation analyst assessing completeness and freshness of all platform documentation — flow docs, KB articles, design specs, onboarding guides, and inline metadata descriptions.

### Scope

- `docs/flows/_index.md` — flow documentation master index
- `docs/flows/.pending-docs.txt` — queued undocumented flows
- `docs/flows/flow-categories.json` — category definitions and exclusion criteria
- `docs/design/` — design document directory
- `docs/onboarding/` — developer setup and onboarding (if exists)
- `docs/coding-standards.md` — standards currency
- `CLAUDE.md` — project instructions

### Examination

1. **Flow documentation coverage:**
   - Run `node scripts/flow-index.js --stats` for documented vs. total counts
   - Read `docs/flows/flow-categories.json` and **apply the same exclusion criteria used by `/doc-flows`** — sunset flows, one-time migration flows, temp/test flows, and unbuilt flows should be excluded from the "undocumented" gap count
   - Only flag genuinely missing documentation for flows that `/doc-flows` would document
   - Check `docs/flows/.pending-docs.txt` for pending queue size

2. **Project knowledge base coverage:**
   - Check for a project knowledge base document and assess coverage against actual platform features
   - Identify features or processes with no documentation
   - Assess whether documentation exists for all relevant user audiences

3. **Design doc freshness:**
   - Check design docs in `docs/design/` against current implementation state
   - Flag design docs that reference components that have been renamed or removed

4. **Onboarding completeness:**
   - Check `docs/onboarding/` (if exists) for developer setup and onboarding docs
   - Assess: does a new developer have everything they need? Are tool installations, org setup, DevOps workflow, and skill usage covered?

5. **Standards doc coverage:**
   - Does `docs/coding-standards.md` cover all metadata types in active use?
   - Are there areas with informal conventions not yet codified?

### Output

Write findings to `{CHECKPOINT_DIR}/docs.findings.json` (ID prefix: `DOC-`). Update `_progress.json`.

---

## Step 5 — Agentforce Expert

**Persona context:** You are a Salesforce AI specialist evaluating Agentforce, Einstein, and Data Cloud opportunities across the entire platform. You are looking for high-value automation and intelligence opportunities in Sales, Service, and Custom Operations.

### Scope

- `docs/design/` — design specs for AI/agent features
- `{context.metadataPath}/flows/` — flow catalog for agent action candidates
- Org query: Data Cloud endpoints (`/ssot/` on `{context.orgs.productionAlias}`, read-only)
- Org query: Einstein permission sets, Agentforce agent configuration
- Project knowledge base document (if available) — business process understanding

### Examination

1. **Current AI/agent initiative status:**
   - Review design docs in `docs/design/` for any Agentforce or AI agent configuration specs
   - Query Data Cloud status: `sf api request rest /ssot/ --target-org {context.orgs.productionAlias}` (production read-only)
   - Assess current Data Cloud data model, ingestion streams, and calculated insights

2. **Business-wide AI opportunity scan:**

   **Sales opportunities:**
   - Lead qualification agents — can Agentforce score and route inbound inquiries?
   - Application intake automation — can an agent guide users through application processes?
   - Onboarding assistants — agent-guided setup and documentation collection
   - Recommendation agents — agent that suggests optimal options based on user profile

   **Service opportunities:**
   - Case triage/routing agents — auto-classify and route cases by type
   - Inquiry resolution — agent that can look up status, explain details, and initiate adjustments
   - Dispute handling — agent-guided dispute intake and resolution workflow
   - Support automation — agent for partner-side questions
   - KB-powered self-service agents — agent for portal users backed by Knowledge articles

   **Custom/Operations opportunities:**
   - Batch processing monitoring agents — alert and investigate when batch operations are anomalous
   - Reconciliation assistants — agent that surfaces exceptions for human review
   - Compliance alert responders — agent that triages risk alerts
   - Risk alerting extensions — expand existing agent capabilities beyond current scope

3. **Einstein feature assessment:**
   - Einstein Next Best Action — engagement recommendations
   - Einstein Case Classification — auto-classify incoming cases
   - Einstein Article Recommendations — surface relevant KB articles in portals
   - Einstein Search — readiness of Knowledge Base for Einstein Search (article count, Data Category Groups, record types)

4. **Flow-to-agent action mapping:**
   - Scan flow catalog for screen flows and invocable flows that could become Agentforce agent actions
   - Identify high-value candidates based on user interaction frequency and complexity

5. **Data Cloud readiness:**
   - Check what data is flowing into Data Cloud
   - Identify data gaps that limit AI feature effectiveness
   - Assess identity resolution configuration

### Output

Write findings to `{CHECKPOINT_DIR}/agentforce.findings.json` (ID prefix: `AGT-`). Update `_progress.json`.

---

## Step 6 — Analytics SME

**Persona context:** You are a Salesforce analytics specialist evaluating reporting, dashboards, CRM Analytics, and metrics strategy for the platform. You are identifying gaps in what the business tracks and recommending metrics they should measure.

### Scope

- Org query: `SELECT Id, Name, FolderName FROM Report LIMIT 200` + `SELECT Id, Title, FolderName FROM Dashboard LIMIT 200`
- `{context.metadataPath}/objects/` — reportable fields review
- `docs/design/` — analytics-related design specs
- Project knowledge base document (if available) — business model understanding

### Examination

1. **Report/dashboard inventory:**
   - Query org for existing reports and dashboards
   - Categorize by folder/domain
   - Identify reports referencing legacy/deprecated objects (cross-reference with package audit report if available)

2. **CRM Analytics utilization:**
   - Check if CRM Analytics (Tableau CRM) datasets exist
   - Assess Data Cloud analytics views
   - Identify CRM Analytics opportunities

3. **Business-model-driven metric recommendations:**
   Review the project knowledge base (if available) and platform brief to understand the business model, then recommend metrics by domain:

   **Portfolio health:** Default rate trends, aging bucket distribution, recovery rates by program type, risk score distribution

   **Application pipeline:** Conversion rates by stage, approval-to-funding velocity, decline reason analysis, channel attribution

   **Partner performance:** Submission volume trends, payment velocity, dispute rates, partner lifetime value

   **Operational efficiency:** Batch processing cycle time, reconciliation exception rates, manual intervention frequency

   **Financial:** Revenue per partner, cost-to-collect ratios, reserve adequacy trending

   **Service rep performance:** Agent handle time, first-contact resolution rate, case reopen rate, CSAT/sentiment from transcripts, escalation frequency, resolution rate by channel, agent utilization, queue wait times, knowledge article deflection rate, sentiment trending, customer effort score proxies

   **AI/Agentforce adoption & efficacy:** Agent invocation volume and trends, agent resolution rate (resolved without human handoff), handoff-to-human rate and reasons, agent response accuracy, agent conversation duration, user adoption rate by team/role, agent-assisted case deflection, time-to-resolution comparison (agent-assisted vs. manual), agent action success/failure rates by topic, cost-per-resolution with vs. without agent, user satisfaction with agent interactions, Data Cloud data freshness and ingestion lag

4. **Data availability assessment:**
   - For each recommended metric, note whether the underlying data already exists (fields/objects) or requires new instrumentation
   - For transcript-based metrics, assess whether Service Cloud Voice and/or Chat transcripts are captured and whether sentiment analysis is enabled
   - For Agentforce metrics, check whether `AgentWork`, `BotSession`, `ConversationEntry`, and Event Monitoring logs are available and retained

5. **Executive dashboard gaps:**
   - What would a C-suite dashboard need? Revenue, risk, pipeline, partner health at a glance
   - Are current dashboards self-service or do they require manual refresh/curation?

### Output

Write findings to `{CHECKPOINT_DIR}/analytics.findings.json` (ID prefix: `ANL-`). Update `_progress.json`.

---

## Step 7 — DevOps Expert

**Persona context:** You are a Salesforce DevOps specialist evaluating the development pipeline, tooling, automation, and operational efficiency for a team using DevOps Center, SF CLI, and Claude Code skills.

### Scope

- `.husky/` — git hook configuration
- `scripts/` — helper script inventory
- `.claude/commands/` — skill chain analysis
- `config/` — configuration files
- `manifest/` and `manifests/` — deployment manifests
- Org query: DevOps Center work item pipeline metrics

### Examination

1. **Deployment workflow efficiency:**
   - Map the current workflow: code change -> deploy -> commit -> promote
   - Identify manual steps that could be automated
   - Check if pre-deploy validation is consistently run
   - Assess deployment error handling and rollback procedures

2. **DevOps Center pipeline health:**
   - Query WI status distribution: `SELECT Status, COUNT(Id) cnt FROM WorkItem GROUP BY Status`
   - Identify bottlenecks: items stuck in review, stale WIs, promotion queue depth
   - Assess branching strategy: WI branch pattern, main branch protection

3. **Git hook coverage:**
   - Review `.husky/` hooks for completeness
   - Are there operations that should be hooked but aren't? (e.g., pre-push validation, post-merge retrieval)

4. **Skill chain analysis:**
   - Review `.claude/commands/` for workflow gaps
   - Are there common multi-step operations not covered by a skill?
   - Assess skill interdependencies and failure modes

5. **Sandbox management:**
   - How are sandbox refreshes managed?
   - Is config backup/restore (`sfdmu`) part of the refresh procedure?
   - Are there automated health checks after refresh?

6. **Toolset evaluation:**
   - **SF CLI plugins:** Are there newer/better plugins for tasks currently done manually? Check for alternatives to installed plugins
   - **MCP servers:** Are there additional MCP servers that could extend Claude Code capabilities?
   - **CI/CD tooling:** Is there value in GitHub Actions, pre-deploy validation automation, or scheduled org health checks beyond what DevOps Center provides?
   - **Testing tools:** Evaluate E2E testing options for screen flows, static analysis tools
   - **Developer experience:** IDE extensions, code generation tools, documentation generators not yet in use
   - **Reference `docs/tooling-gap-analysis.md`** (if exists) for previously evaluated tools and decisions — do not re-recommend rejected tools without new justification

### Output

Write findings to `{CHECKPOINT_DIR}/devops.findings.json` (ID prefix: `OPS-`). Update `_progress.json`.

---

## Step 8 — Consolidation

Run the consolidation script to merge all persona findings:

```bash
node scripts/platform-review-consolidate.js --checkpoint-dir {CHECKPOINT_DIR} --severity-threshold {SEVERITY_THRESHOLD}
```

This script:

- Reads all `*.findings.json` files from the checkpoint directory
- Deduplicates findings that appear across multiple personas
- Sorts by severity then effort
- Produces `platform-review-report.md` (consolidated markdown)
- Produces `backlog-candidates.json` (candidates mapped to backlog schema + existing backlog items for context)

The script handles merging, deduplication, severity sorting, report formatting, and backlog schema mapping. **Overlap classification (New/Expand/Duplicate) is deferred to Claude** in Step 9 — the script outputs candidates alongside existing backlog items so Claude can compare semantically.

Review the report for coherence. Ensure cross-cutting themes are captured.

---

## Step 9 — Backlog Bridge

**Skip this step if `--no-backlog` was passed.** The `backlog-candidates.json` file is still available in the checkpoint directory — run `/platform-review --backlog-only` in a future session to process it.

**If `--backlog-only`:** Find the most recent `docs/platform-review/*/backlog-candidates.json` and use that checkpoint directory. Skip all prior steps.

Read `{CHECKPOINT_DIR}/backlog-candidates.json`. The file contains `candidates` (findings mapped to backlog schema) and `existing_backlog_items` (current backlog for comparison).

**Claude performs semantic overlap classification:** For each candidate, read its title, description, category, and tags. Compare against each existing backlog item by _meaning_, not just keyword overlap. Classify as:

- **New** — no existing backlog item covers this finding's scope
- **Expand** — an existing item covers related ground but this finding adds new scope or detail
- **Duplicate** — an existing item already fully covers this finding

Present findings grouped by classification:

```
## Backlog Candidates ({n} total)

### New Items ({n})
Items with no overlap to existing backlog — will be added as new entries.

| # | Finding | Title | Severity | Effort | Category | Tags |
|---|---------|-------|----------|--------|----------|------|

### Expand Existing Items ({n})
Items that overlap with existing backlog entries — propose adding new scope/detail.

| # | Finding | Existing Item | What to Add |
|---|---------|---------------|-------------|

### Already Covered ({n} — skipped)
Items fully covered by existing backlog entries.

| # | Finding | Covered By |
|---|---------|------------|
```

Ask the user to choose:

- `add all new` — add all new candidates to backlog
- `add 1,3,5` — add specific new items by number
- `expand 2,4` — expand specific existing items with new detail
- `add all new + expand all` — both operations
- `skip` — skip backlog integration, review report only

For **new items**, run `node scripts/backlog-add.js` for each approved item with:

- `--title` from finding title
- `--description` from finding description + recommendation
- `--category` from finding category
- `--priority` mapped from severity (Critical=P1, High=P2, Medium=P3, Low=P4)
- `--effort` from finding effort
- `--complexity` from finding complexity
- `--tags` from finding tags
- `--source claude-session`
- `--note "Added from /platform-review {persona} finding {id}"`

For **expand items**, update the existing backlog item's notes array in the backlog data file with a new note entry referencing the platform review finding.

After all additions/expansions, regenerate the backlog:

```bash
node scripts/backlog-render.js
```

---

## Step 10 — Report

Present the final summary:

```
## /platform-review Complete

Date: {DATE}
Checkpoint: docs/platform-review/{DATE}/
Personas run: {n} of 7

| Severity | Count |
|----------|-------|
| Critical | {n}   |
| High     | {n}   |
| Medium   | {n}   |
| Low      | {n}   |
| **Total**| {n}   |

Cross-persona duplicates merged: {n}

Backlog integration: {if --no-backlog: "Skipped (--no-backlog). Run /platform-review --backlog-only to process later."}
- New items added: {n}
- Existing items expanded: {n}
- Already covered (skipped): {n}

Report: docs/platform-review/{DATE}/platform-review-report.md
Backlog candidates: docs/platform-review/{DATE}/backlog-candidates.json

Top 3 recommendations:
1. {title} ({severity}) — {one-line recommendation}
2. ...
3. ...
```

---

## Finding Schema

Each persona writes a `{persona}.findings.json` to the checkpoint directory with this structure:

```json
{
  "persona": "Security Analyst",
  "completed_at": "{ISO timestamp}",
  "findings": [
    {
      "id": "SEC-001",
      "title": "Short descriptive title",
      "description": "What the issue is and why it matters",
      "severity": "Critical|High|Medium|Low",
      "category": "Platform|Integrations|Portal|Operations",
      "effort": "S|M|L|XL",
      "complexity": "Low|Med|High",
      "tags": ["compliance"],
      "evidence": "file path, query result, or code snippet",
      "recommendation": "Specific actionable recommendation",
      "backlog_candidate": true
    }
  ],
  "summary": "Reviewed X files/queries. Found N Critical, N High, N Medium, N Low findings."
}
```

**ID prefixes by persona:**

| Persona                  | Prefix |
| ------------------------ | ------ |
| Security Analyst         | `SEC-` |
| QA Lead                  | `QA-`  |
| Coding Standards Manager | `STD-` |
| Documentation Analyst    | `DOC-` |
| Agentforce Expert        | `AGT-` |
| Analytics SME            | `ANL-` |
| DevOps Expert            | `OPS-` |

**Severity guidelines:**

| Severity | Criteria                                                                              |
| -------- | ------------------------------------------------------------------------------------- |
| Critical | Security vulnerability, data loss risk, compliance violation, production-impacting    |
| High     | Significant gap with business impact, major technical debt, missing critical coverage |
| Medium   | Improvement opportunity, moderate gap, efficiency gain                                |
| Low      | Nice-to-have, minor cleanup, future consideration                                     |

**Tags** should come from the project's tag definitions (e.g., `docs/backlog/tags.yaml` if present). Primary mapping:

- Security -> `compliance` | QA -> `testing` | Docs -> `documentation` | Standards -> `tech-debt` | Agentforce -> `ai-agents`, `data-cloud` | Analytics -> `analytics` | DevOps -> `devops`

Findings may use multiple tags when appropriate (e.g., a portal security issue: `compliance, portal`).

---

## Behavior Notes

- **Read-only (Tier 1).** This skill never deploys metadata, modifies records, or writes to any Salesforce org. All org interactions are SOQL queries, describes, and REST API GETs.
- **Production read-only access** is permitted for Data Cloud endpoints, Knowledge queries, Report/Dashboard inventories, and Einstein configuration checks — per production read-only rules.
- **Resumability.** Each persona writes its own checkpoint file. Use `--resume` to continue after interruption. The skill reads `_progress.json` and skips completed personas.
- **Progress reporting.** After each persona completes, display a one-line summary with finding counts before proceeding to the next persona.
- **Flow exclusion alignment.** The Documentation Analyst persona uses the same exclusion criteria as `/doc-flows` (from `docs/flows/flow-categories.json`) — sunset, one-time, temp, and unbuilt flows are not counted as documentation gaps.
- **Backlog overlap detection.** The Backlog Bridge step cross-references findings against existing backlog data to avoid duplicates and enrich existing items where appropriate.
- **No auto-add to backlog.** All backlog additions require explicit user approval. The skill presents candidates and waits for the user to choose.
