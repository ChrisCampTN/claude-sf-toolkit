---
name: skill-preflight
description: Pre-run validation checks for git state, org connectivity, metadata files, flows, and Knowledge Base articles
---

# /skill-preflight — Pre-Run Validation Checks

Run validation checks before executing a skill or deploying metadata. Catches common issues early — duplicate XML elements, inactive flows in doc scope, missing frontmatter, dirty git state, org connectivity failures.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- A skill name: `doc-flows`, `doc-components`, `kb-gap-analysis`, `kb-publish`, `devops-commit`, `deploy-changed`, `detect-drift`, `test-flows`, `wi-sync`, `lookback`
- A check suite: `git`, `org`, `metadata`, `flows`, `kb`
- Multiple comma-separated: `git, org` or `doc-flows, kb-publish`
- Empty — runs all check suites

---

## Resolution

Dispatch the `sf-toolkit-resolve` agent. Use the returned context for all
org references, team lookups, and path resolution in subsequent steps.
If `missing` contains values this skill requires, stop and instruct the
developer to run `/setup`.

---

## Check Suites

Each suite is a group of related checks. When preflight is called with a skill name, it maps to the relevant suites automatically.

### Skill → Suite Mapping

| Skill             | Suites Run                                            |
| ----------------- | ----------------------------------------------------- |
| `doc-flows`       | `git`, `flows`, `metadata`                            |
| `doc-components`  | `git`, `org`, `metadata`                              |
| `kb-gap-analysis` | `git`, `org`, `kb`                                    |
| `kb-publish`      | `git`, `org`, `kb`                                    |
| `devops-commit`   | _(inline only — circular dependency, see note below)_ |
| `design-review`   | `git`, `metadata`                                     |
| `validate-build`  | `git`, `org`                                          |
| `deploy-changed`  | `git`, `org`, `metadata`                              |
| `detect-drift`    | `org`                                                 |
| `test-flows`      | `git`, `org`, `metadata`                              |
| `wrap-up`         | `git`                                                 |
| `package-audit`   | `org`                                                 |
| `wi-sync`         | `git`, `org`                                          |
| `lookback`        | `git`                                                 |
| `platform-review` | `git`, `org`, `metadata`                              |

> **Note:** `devops-commit` runs git and org checks inline rather than invoking `/skill-preflight`. This avoids circular dependencies — `devops-commit` is called by `/wrap-up` and suggested by `/deploy-changed`.

---

## Suite: `git` — Git State Checks

### G1 — Uncommitted Changes Inventory

Run `git status` and report:

- Staged changes (ready to commit)
- Unstaged modifications
- Untracked files

Classify as:

- **Clean** — no staged or unstaged changes
- **Safe to proceed** — only untracked files (docs, scripts, memory)
- **Warning** — unstaged modifications to metadata files (`{context.metadataPath}/`)
- **Blocker** — staged changes that haven't been committed (risk of accidental inclusion in next commit)

For `devops-commit` preflight: a blocker-level staged change is critical — the cherry-pick will fail or include unintended files.

### G2 — Branch Check

Report the current branch. Flag if:

- On a `WI-*` branch instead of `main` (unexpected for most skill runs)
- Detached HEAD state
- Branch is behind `origin/main` by more than 5 commits

### G3 — Pending Docs Check

Read `docs/flows/.pending-docs.txt` if it exists. Report how many flows are queued. This is informational for `doc-flows` — helps the user decide scope.

---

## Suite: `org` — Salesforce Org Connectivity

When a calling skill passes a `--target-org` value, use that org for O1. Otherwise default to `{context.orgs.devAlias}`.

### O1 — Target Org Connectivity

Run a lightweight query against the target org to confirm it is reachable:

```bash
sf data query --query "SELECT Id FROM Organization LIMIT 1" --target-org {target-org} --json
```

Default `{target-org}` by context:

- Skills that deploy or read from a dev sandbox (`deploy-changed`, `test-flows`, `package-audit`): **{context.orgs.devAlias}**
- Skills that read production (`detect-drift`, `doc-flows` freshness, `kb-gap-analysis`, `kb-publish`): **{context.orgs.productionAlias}**
- Standalone preflight run with no context: **{context.orgs.devAlias}**

Report: **Connected** or **Unreachable** (with error message).

If unreachable and target is the dev sandbox, suggest: `sf org login web --alias {context.orgs.devAlias} --instance-url https://test.salesforce.com`
If unreachable and target is production, suggest: `sf org login web --alias {context.orgs.productionAlias} --instance-url https://login.salesforce.com`

### O2 — Secondary Org Connectivity (if suite requires it)

Some skills interact with two orgs. Check the secondary org only when needed:

- `devops-commit` (inline): `{context.orgs.productionAlias}` for WI queries + `{context.orgs.devAlias}` for deploy
- `doc-flows`: `{context.orgs.productionAlias}` for freshness queries (if target-org is the dev sandbox for deploy)

Run the same connectivity query against the secondary org and report status.

### O3 — Default Org Check

Check if a default org is set and report which one. Flag if the default org is Production (risk of accidental writes).

```bash
sf config get target-org --json
```

---

## Suite: `metadata` — Metadata File Validation

**Use `scripts/metadata-validator.js`** for all metadata validation checks. Check if `scripts/metadata-validator.js` exists locally. If not, generate it from the plugin's `script-templates/metadata-validator.js`.

```bash
# Validate all metadata under the configured metadata path
node scripts/metadata-validator.js --metadata-path {context.metadataPath} --api-version {context.apiVersion} --summary

# Validate specific files (e.g., from deploy-changed scope)
node scripts/metadata-validator.js --metadata-path {context.metadataPath} --api-version {context.apiVersion} --files "path1,path2,..."

# Validate git diff (changed files only)
node scripts/metadata-validator.js --metadata-path {context.metadataPath} --api-version {context.apiVersion} --git-diff

# Full JSON output for programmatic consumption
node scripts/metadata-validator.js --metadata-path {context.metadataPath} --api-version {context.apiVersion} --json
```

The script performs all M1–M3 checks automatically:

### M1 — Duplicate XML Elements

The script scans for duplicate `<description>`, `<label>`, `<processType>`, `<apiVersion>`, and `<status>` elements. Also detects merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`). Reports each duplicate with file path and element name.

### M2 — Malformed XML Check

The script verifies non-empty files with balanced XML tags. Flags truncated or malformed files.

### M3 — API Version Consistency

The script flags files where `<apiVersion>` differs from `{context.apiVersion}`. Informational, not a blocker.

**Additional checks the script provides:**

- Standard object custom field detection (package.xml wildcard warning)
- Metadata type classification and grouping
- Deployable vs non-deployable file filtering

---

## Suite: `flows` — Flow-Specific Checks (for /doc-flows)

### F1 — Inactive Flow Detection

For each flow in the documentation scope, read the `<status>` element from the XML:

- **Active** — proceed
- **Obsolete / Draft / InvalidDraft / Inactive** — flag as skippable, report the count

This prevents documenting flows that aren't running.

### F2 — Managed Package Detection

Check flow filenames for a **namespace prefix** — a managed package namespace followed by `__` at the start of the base name (e.g., `sfdc_cms__Something.flow-meta.xml`, `AC__FlowName.flow-meta.xml`). This is the only reliable indicator in local source files; the `ManageableState` field exists only in the Tooling API, not in `.flow-meta.xml`. Report any found — these should never be modified or documented.

### F3 — Existing Documentation Check

For each flow in scope, check if documentation already exists at `docs/flows/{category}/{FlowName}.md`. Report:

- **New** — no existing doc (will be created)
- **Update** — doc exists (will be updated)
- **Stale** — doc exists but flow XML has been modified since the doc's `Last Documented` date

This gives the user a preview of what `/doc-flows` will do.

### F4 — Flow Description Slot Check

For each flow in scope, check whether a `<description>` element exists in the XML:

- **Has description** — report current content (truncated to 80 chars)
- **No description** — will be added by `/doc-flows`

Helps estimate the XML changes that will result.

---

## Suite: `kb` — Knowledge Base Checks (for /kb-gap-analysis, /kb-publish)

### K1 — Draft Directory Inventory

List all directories under `docs/kb-drafts/` with file counts. For `/kb-publish`, this helps the user pick the right draft directory.

### K2 — Publish Log Check

For each draft directory, check if `_publish-log.md` exists and report:

- How many articles were published in prior runs
- How many are still pending (skipped)
- How many were discarded

### K3 — Duplicate Article Detection

Check for potential duplicates:

1. **Within drafts:** Compare article slugs across all draft directories. Flag if the same slug appears in multiple directories (risk of publishing twice).
2. **Draft vs. Salesforce:** If org is connected, query `Knowledge__kav` for existing articles and compare titles/URL names against draft slugs. Flag matches — these may need an update (`gap-type B`) rather than a new article (`gap-type A`).

### K4 — Frontmatter Validation

For each draft article in the target directory, verify required frontmatter fields are present:

**Required for all articles:**

- `audience` — must be one of: `internal`, `external-provider`, `external-applicant`
- `priority` — must be `high`, `medium`, or `low`
- `gap-type` — must be `A`, `B`, `C`, `D`, or `E`
- `publish-to` — must be an array containing `salesforce` and/or `repo`
- `record-type` — must be `Documentation` or `FAQ`

**Required for Type B (stale content) articles:**

- `replaces-article` — title of the article being replaced
- `replaces-article-id` — KnowledgeArticleId of the article being replaced
- `staleness-reason` — why the existing article is stale

Flag any article missing required fields. This prevents `/kb-publish` from failing mid-run.

### K5 — Record Type Consistency

Check that articles in `faq/` subdirectories have `record-type: FAQ` and articles outside `faq/` have `record-type: Documentation`. Flag mismatches — these cause wrong field mapping during publish.

---

## Output Format

Present results grouped by suite, using clear pass/warn/fail indicators:

```
## /skill-preflight Results

**Target:** {skill name or suite list}
**Suites run:** {list}
**Run time:** {timestamp}

### Git State
- [PASS] G1 — Working tree clean
- [WARN] G2 — Current branch is main, 2 commits behind origin/main
- [INFO] G3 — 3 flows pending in .pending-docs.txt

### Org Connectivity
- [PASS] O1 — {context.orgs.devAlias} connected
- [PASS] O2 — {context.orgs.productionAlias} connected
- [PASS] O3 — Default org: {context.orgs.devAlias}

### Metadata Validation
- [FAIL] M1 — Duplicate <description> in 2 files:
  - {context.metadataPath}/flows/Something.flow-meta.xml
  - {context.metadataPath}/flows/Other.flow-meta.xml
- [PASS] M2 — All files well-formed
- [INFO] M3 — 3 flows below minimum API version (found older version)

### Flow Checks
- [INFO] F1 — 4 inactive flows in scope (will be skipped)
- [PASS] F2 — No managed package flows in scope
- [INFO] F3 — 12 new, 3 updates, 0 stale
- [INFO] F4 — 8 flows missing <description> element

---

**Summary:** 1 failure, 1 warning, 5 info, 4 passed
**Recommendation:** Fix M1 (duplicate descriptions) before proceeding.
```

### Severity Levels

| Level    | Meaning                                   | Action                                      |
| -------- | ----------------------------------------- | ------------------------------------------- |
| **PASS** | Check passed, no issues                   | Proceed                                     |
| **INFO** | Informational finding, no action needed   | Proceed (user awareness)                    |
| **WARN** | Potential issue, may cause problems       | Proceed with caution, consider fixing first |
| **FAIL** | Issue that will cause errors or data loss | Fix before proceeding                       |

### Auto-Fix Offers

For certain FAIL-level issues, offer to fix them automatically:

| Issue                                  | Auto-Fix                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| M1 — Duplicate `<description>`         | Remove the duplicate element, keeping the one with content (or the first if both have content) |
| K4 — Missing `record-type` frontmatter | Infer from directory location (`faq/` → FAQ, else → Documentation) and add                     |
| K5 — Record type mismatch              | Correct to match directory location                                                            |

Ask the user before applying any auto-fix. Report what was changed.

---

## Final Step — Recommendation

Based on results, give a clear go/no-go:

- **All PASS/INFO:** "Preflight complete. Clear to run {skill}."
- **WARN present:** "Preflight complete with warnings. Review above before running {skill}."
- **FAIL present:** "Preflight found {n} issue(s) that should be fixed first. Fix and re-run `/skill-preflight {skill}` to verify."

If auto-fixes were applied, suggest re-running preflight to confirm the fixes resolved the issues.

---

## Production Safety Gate Tiers

When a skill targets a production org, apply the appropriate safety gate tier. Each skill documents which tier it uses.

| Tier                            | When                                                     | Behavior                                                                                    |
| ------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Tier 1 — Read-only**          | Skill only reads from the org (SOQL, describe, retrieve) | Display note: "This is a READ-ONLY operation against {target-org}." No confirmation needed. |
| **Tier 2 — Write with warning** | Skill writes to the org (deploy, create/update records)  | Display prominent warning, ask for explicit confirmation once before proceeding.            |
| **Tier 3 — Destructive**        | Skill deletes components or force-overwrites             | Double confirmation: user must type the org alias AND confirm "yes".                        |

### Skill Tier Assignments

| Skill                          | Tier | Rationale                                        |
| ------------------------------ | ---- | ------------------------------------------------ |
| `detect-drift`                 | 1    | Read-only queries and retrieval to local         |
| `package-audit`                | 1    | Read-only Tooling API queries                    |
| `doc-flows` (freshness check)  | 1    | Read-only FlowDefinitionView query               |
| `doc-components`               | 1    | Read-only org queries for verification           |
| `kb-gap-analysis`              | 1    | Read-only Knowledge article queries              |
| `deploy-changed`               | 2    | Deploys metadata to target org                   |
| `devops-commit` (deploy step)  | 2    | Deploys metadata to dev sandbox                  |
| `test-flows` (when deploying)  | 2    | Deploys FlowTest metadata                        |
| `kb-publish`                   | 2    | Creates/updates Knowledge articles in production |
| `platform-review`              | 1    | Read-only queries and source file analysis       |
| `flow-version-cleanup.sh`      | 3    | Deletes old Flow versions via Tooling API        |
