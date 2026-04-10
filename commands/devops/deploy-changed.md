---
name: deploy-changed
description: Build and execute targeted SF deployments from git changes — filters to deployable metadata, constructs source-dir commands, verifies deployment
---

# /deploy-changed — Deploy Changed Metadata

Build and execute a targeted Salesforce deployment from git changes. Reads `git diff` to identify changed metadata files, filters to deployable types, constructs the `sf project deploy start` command with individual `--source-dir` flags, and runs it.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- Empty — detect changes automatically (unstaged + staged vs HEAD)
- `staged` — only deploy staged changes
- `commit {sha}` — deploy the files changed in a specific commit
- `range {from}..{to}` — deploy files changed across a commit range
- `branch {branch-name}` — deploy files changed between current branch and the named branch
- `--dry-run` — append to any of the above to validate without deploying
- `--target-org {alias}` — override the default target org (defaults to `{context.orgs.devAlias}`)

Examples:

```
/deploy-changed
/deploy-changed staged
/deploy-changed commit abc1234
/deploy-changed range HEAD~3..HEAD --dry-run
/deploy-changed branch main --target-org MyDevSandbox
```

---

## Resolution

**Cache-first resolution:**

1. Read `.claude/sf-toolkit-cache.json` in the project root.
2. If the file exists and `_cache.expiresAt` is after the current date/time, **and** no `--target-org` override was provided:
   - Read `.sf/config.json` — confirm `target-org` matches `orgs.devAlias` in the cached context.
   - If it matches: use the cached context (all keys except `_cache`). **Skip the agent dispatch.**
3. If the cache is missing, expired, or the org alias doesn't match: dispatch the `sf-toolkit-resolve` agent. It will resolve fresh context and update the cache.

Use the returned context for all org references, team lookups, and path resolution in subsequent steps. If `missing` contains values this skill requires, stop and instruct the developer to run `/setup`.

---

## Step 0 — Preflight

Invoke `/skill-preflight deploy-changed` to run the `git`, `org`, and `metadata` suites. Pass the resolved `--target-org` value so preflight checks the correct org.

1. **Git status:** If the working tree is completely clean and no commit/range argument was given, report "Nothing to deploy" and exit.
2. **Org connectivity:** If preflight reports the target org as unreachable, stop — cannot deploy without connectivity.
3. **Production safety gate (Tier 2):** If `--target-org` is `{context.orgs.productionAlias}` or any alias containing `prod`/`production` (case-insensitive), display a prominent warning:
   ```text
   !! TARGET ORG IS PRODUCTION !!
   You are about to deploy to Production. This bypasses the DevOps Center pipeline.
   Only org-level settings metadata (DataCategoryGroup, etc.) should be deployed directly.
   ```
   Ask for explicit confirmation before proceeding.

---

## Step 1 — Identify Changed Files

Based on the argument, get the list of changed files:

### No argument (working tree changes):

```bash
git diff --name-only HEAD
git diff --name-only --cached HEAD
```

Combine both lists (deduplicate).

### `staged` argument:

```bash
git diff --name-only --cached HEAD
```

### `commit {sha}` argument:

```bash
git diff-tree --no-commit-id --name-only -r {sha}
```

### `range {from}..{to}` argument:

```bash
git diff --name-only {from}..{to}
```

### `branch {branch-name}` argument:

```bash
git diff --name-only {branch-name}...HEAD
```

---

## Step 2 — Filter to Deployable Metadata

**Use the metadata-validator script** for filtering and validation instead of manual file-by-file checks.

First, check for the script locally, then fall back to the plugin template:

```bash
# Prefer local project script, fall back to plugin
if [ -f scripts/metadata-validator.js ]; then
  VALIDATOR="scripts/metadata-validator.js"
else
  VALIDATOR="${CLAUDE_PLUGIN_ROOT}/script-templates/metadata-validator.js"
fi
```

Run the validator:

```bash
# Validate files from git diff (most common use case)
node "$VALIDATOR" --git-diff

# Validate specific files
node "$VALIDATOR" --files "path1,path2,..."

# JSON output for programmatic consumption
node "$VALIDATOR" --git-diff --json

# Summary only
node "$VALIDATOR" --git-diff --summary
```

The script handles all filtering (non-deployable exclusions, standard object field detection), XML validation (duplicate elements, well-formedness, API version), and metadata type classification automatically.

If no deployable files remain after filtering, report "No deployable metadata changes found" and list what was filtered out (so the user knows their changes are docs/scripts only).

---

## Step 3 — Metadata Validation

Review the metadata-validator output from Step 2:

- **Errors (exit code 1):** Duplicate XML elements, malformed XML, merge conflict markers. Fix before deploying.
- **Warnings:** API version mismatches (informational — don't block deploy).
- **Standard object fields:** Listed with the package.xml wildcard reminder.

If errors are found, offer to auto-fix and re-run validation before continuing.

---

## Step 4 — Code Quality Scanning

Scan deployable code files for performance risks, security issues, and best-practice violations. This step runs only when the deploy set contains scannable file types. If no scannable files exist, skip this step entirely with no output.

### Classify files in deploy set

Group deployable files by type:

| Extension | Type | Scan tool |
|---|---|---|
| `.cls` | Apex | ApexGuru + Code Analyzer |
| `.flow-meta.xml` | Flow | lightning-flow-scanner |
| `.js`, `.html` | LWC/Aura | Code Analyzer |
| `.page`, `.component` | Visualforce | Code Analyzer |

If none of these extensions are in the deploy set, skip to Step 5.

### Apex scanning (if `.cls` files present)

**ApexGuru (prominent tier):** Run `scan_apex_class_for_antipatterns` on each Apex class in the deploy set. Use the resolved `--target-org` as the `usernameOrAlias` parameter so severity reflects actual runtime metrics when ApexGuru is enabled on the org. Collect findings into a "Performance Risks" list with severity, class name, finding description, and recommendation.

```
For each .cls file in deploy set:
  scan_apex_class_for_antipatterns(
    className: "{class name without extension}",
    apexFilePath: "{absolute path to .cls file}",
    directory: "{project root}",
    usernameOrAlias: "{target-org alias}"
  )
```

**Code Analyzer (informational tier):** Run `run_code_analyzer` with selector `Apex:Recommended` on all Apex files in the deploy set (batch up to 10 files per call). If more than 10 Apex files, split into multiple calls. After completion, use `query_code_analyzer_results` to extract findings. Collect into a "Code Analysis" list grouped by severity.

```
run_code_analyzer(
  target: ["{absolute path 1}", "{absolute path 2}", ...],
  selector: "Apex:Recommended"
)
```

### Flow scanning (if `.flow-meta.xml` files present)

**lightning-flow-scanner (prominent tier):** Run `sf flow scan` targeting the changed flow files. If the `--files` flag is supported, pass each changed flow path directly. Otherwise, run `sf flow scan --directory {metadataPath}/flows` and filter the output to only include flows in the deploy set.

```bash
sf flow scan --files "{path1},{path2},..."
```

Or fallback:

```bash
sf flow scan --directory {context.metadataPath}/flows
# Then filter results to only flows in the deploy set
```

Collect findings into a "Flow Issues" list with rule name, flow name, and description.

### LWC/Aura scanning (if `.js` or `.html` files present)

**Code Analyzer (informational tier):** Run `run_code_analyzer` with selector `(JavaScript,HTML):Recommended` on all JS/HTML files in the deploy set.

```
run_code_analyzer(
  target: ["{absolute path 1}", "{absolute path 2}", ...],
  selector: "(JavaScript,HTML):Recommended"
)
```

### LWC Jest tests (if `.js` LWC files present and Jest configured)

**Jest (informational tier):** Check if the project has `@salesforce/sfdx-lwc-jest` configured:

```bash
node -e "try { require.resolve('@salesforce/sfdx-lwc-jest'); console.log('true'); } catch { console.log('false'); }"
```

If Jest is available, run related tests for changed LWC JavaScript files:

```bash
npx lwc-jest -- --findRelatedTests {space-separated .js file paths} --passWithNoTests 2>&1
```

Collect results:
- If tests pass: report "LWC Jest: {n} tests passed" (informational)
- If tests fail: report failures as **prominent tier** — list failing test names and assertion errors. Warn the user but don't block deployment (they may be deploying a fix).
- If no tests found: silently skip (no output)

If Jest is NOT configured, skip this subsection entirely (no warning — W3 in preflight already covers this).

### Visualforce scanning (if `.page` or `.component` files present)

**Code Analyzer (informational tier):** Run `run_code_analyzer` with selector `Visualforce:Security` on all VF files in the deploy set.

```
run_code_analyzer(
  target: ["{absolute path 1}", "{absolute path 2}", ...],
  selector: "Visualforce:Security"
)
```

### Parallelism

ApexGuru calls run sequentially (one MCP call per class). Code Analyzer, flow scan, and Jest can run in parallel since they target different files and use independent tools. Structure execution as:

1. Start ApexGuru scanning (sequential per class)
2. In parallel: start Code Analyzer batch + flow scan + Jest (if configured)
3. Collect all results before proceeding to Step 5

### No findings

If all scans complete with zero findings, report briefly: "Code quality scan: no issues found" and proceed to Step 5.

---

## Step 5 — Build Deploy Command

Construct the `sf project deploy start` command with targeted `--source-dir` flags.

### Grouping strategy:

**Directories vs individual files:** If ALL files within a metadata subdirectory are changed (e.g., every field file under `{context.metadataPath}/objects/MyObject__c/fields/`), use the directory path instead of listing each file. This keeps the command shorter while remaining targeted.

Otherwise, list each file individually.

### Command construction:

```bash
sf project deploy start --target-org {target-org} {--dry-run if applicable} --source-dir "{path1}" --source-dir "{path2}" --source-dir "{path3}"
```

**Important formatting rules:**

- Wrap paths containing spaces in double quotes
- Use forward slashes in paths (bash shell on Windows)
- Single-line command (PowerShell VS Code terminal compatibility)
- Maximum ~20 `--source-dir` flags per command. If more than 20, split into batches and deploy sequentially.

---

## Step 6 — Preview and Confirm

Show the user the full deployment plan before executing:

```
## Deploy Plan

Target org: {alias}
Mode: {Deploy / Dry-Run (validation only)}
Changed files: {total count}
Deployable files: {filtered count}
Filtered out: {n} non-metadata files
```

If Step 4 produced findings, include these sections in the preview:

### Performance Risks (ApexGuru)

Show only if ApexGuru found issues. Table format:

| Severity | Class | Finding | Recommendation |
|---|---|---|---|
| {severity} | {className} | {finding description} | {recommendation} |

### Flow Issues

Show only if flow scanner found issues. Table format:

| Rule | Flow | Description |
|---|---|---|
| {ruleName} | {flowName} | {description} |

### Code Analysis (informational)

Show only if Code Analyzer found issues across any file type. Table format:

| Severity | File | Rule | Message |
|---|---|---|---|
| {severity} | {fileName} | {ruleName} | {message} |

```
### Files to Deploy

| # | Type | Path |
|---|---|---|
| 1 | Flow | {context.metadataPath}/flows/SomeFlow.flow-meta.xml |
| 2 | CustomField | {context.metadataPath}/objects/Account/fields/Risk_Score__c.field-meta.xml |
| ... | ... | ... |

### Command
{the full sf project deploy start command}

### Filtered Out (not deployed)
- docs/flows/batch/SomeFlow.md (documentation)
- scripts/cleanup.sh (script)
```

Ask: "Deploy these {n} files to {target-org}?" Wait for confirmation.

For `--dry-run` mode, note: "This is a validation-only run. No changes will be applied to the org."

---

## Step 7 — Execute Deploy

Run the deploy command:

```bash
sf project deploy start --target-org {target-org} {flags} --source-dir "{path1}" --source-dir "{path2}" ...
```

### Monitor the result:

**If the deploy succeeds:**
Report the component success counts and any warnings.

**If the deploy fails:**

1. Parse the error output for specific component failures
2. Report each failure with:
   - Component name and type
   - Error message
   - File path
3. Categorize the failures:
   - **Dependency errors** — a referenced component doesn't exist in the target org. Suggest deploying dependencies first.
   - **Validation errors** — field type mismatch, duplicate API name, etc. These need manual fixes.
   - **Pre-existing failures** — errors on components NOT in your deploy list. These are org issues unrelated to your changes. Report them separately and note they're not caused by this deploy.
4. If using `--dry-run` and validation passed: report success and suggest running without `--dry-run` to apply.

---

## Step 8 — Post-Deploy Verification (mandatory)

Apply `superpowers:verification-before-completion` discipline: **no success claims without fresh evidence.** Deploy commands can report success without actually deploying metadata. Never trust exit codes alone.

After a successful (non-dry-run) deploy:

1. **Run `sf project deploy report`** to confirm the deployment completed:

   ```bash
   sf project deploy report --use-most-recent --target-org {target-org} --json
   ```

2. **Spot-check at least one deployed component** in the org to confirm the metadata actually landed:

   | Metadata type   | Verification command                                                                                                                                |
   | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Custom fields   | `sf sobject describe --sobject {ObjectName} --target-org {target-org}` — confirm the field appears                                                  |
   | Flows           | `sf data query --query "SELECT Id, Status FROM Flow WHERE Definition.DeveloperName = '{FlowName}' AND Status = 'Active'" --target-org {target-org}` |
   | Permission sets | `sf data query --query "SELECT Id FROM PermissionSet WHERE Name = '{PermSetName}'" --target-org {target-org}`                                       |
   | Other types     | Use the most appropriate describe/query for that type                                                                                               |

3. **Run FlowTests (if flow files were deployed):** If the deploy set included `.flow-meta.xml` files and corresponding `.flowtest-meta.xml` files exist in `{context.metadataPath}/flowtests/`, run them:

   ```bash
   sf flow run test --name "{FlowTestName}" --target-org {target-org}
   ```

   Or run all flow tests in a single unified command:

   ```bash
   sf logic run test --target-org {target-org}
   ```

   Report pass/fail counts. FlowTest failures are **warnings** (don't block deploy success), but flag them prominently so the user can investigate.

4. **Evidence gate:** Only report success if verification confirms the deploy landed. If verification fails or contradicts the deploy command output:
   - Report the discrepancy with evidence (command output)
   - Do NOT claim success
   - Suggest: re-deploy with `--metadata` flag instead of `--source-dir`, or deploy individual files

5. **Summarize results** (only after verification passes):

   ```text
   ## /deploy-changed Complete

   Target org: {alias}
   Status: Succeeded (verified)
   Components deployed: {n}
     - Flows: {n}
     - Custom Fields: {n}
     - Permission Sets: {n}
     - ... (by type)
   Verification: {component name} confirmed in org via {method}
   Warnings: {n or "None"}

   Files deployed:
     {list}

   Next steps:
   - Commit these changes using /commit-commands:commit
   - Associate with work item: /devops-commit {WI-NNNNNN} {sha}
   ```

5. **Suggest commit message** based on the deployed files — follow the patterns from recent commits (WI prefix if applicable, descriptive summary).

---

## Batch Mode (>20 files)

If the deploy list exceeds 20 files:

1. Group files by metadata type (flows, fields, permsets, etc.)
2. Deploy each group as a separate command
3. Report results for each batch
4. If any batch fails, ask whether to continue with remaining batches or abort

```
Deploy batch 1/3: 15 Flows -> Succeeded
Deploy batch 2/3: 8 Custom Fields -> Succeeded
Deploy batch 3/3: 3 Permission Sets -> Failed (see errors below)
```

---

## Safety Rails

- **Never deploy to Production without explicit user confirmation** (Step 0 safety check)
- **Never force-deploy** (`--ignore-errors` or similar) — if components fail, report them
- **Never deploy `.env`, credentials, or config files** — these are always filtered out in Step 2
- **Always show the command before running it** — the user should see exactly what will execute
- **Respect `--dry-run`** — if the user asked for validation only, never auto-promote to a real deploy
