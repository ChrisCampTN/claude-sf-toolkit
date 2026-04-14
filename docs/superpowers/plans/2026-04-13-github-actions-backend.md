# GitHub Actions Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-project DevOps backend toggle (SF DevOps Center vs GitHub Actions) with resolver adapter layer, skill conditionals, and backlog variant files.

**Architecture:** Resolver agent abstracts the backend via a `workTracking` cache block. Skills read `workTracking` fields for branching. Only `backlog` needs variant workflow files (DOC vs GHA); all other skills use inline conditionals or disable guards. Config toggle at `devops.backend` in `config/sf-toolkit.json`.

**Tech Stack:** Markdown skill files, Node.js validation scripts, `gh` CLI for GitHub Issues, YAML for backlog data model.

**Spec:** `docs/superpowers/specs/2026-04-13-github-actions-backend-design.md`

---

## File Map

### Created
| File | Responsibility |
|---|---|
| `commands/process/backlog-workflows/devops-center.md` | Extracted current YAML/DOC backlog sub-command implementations |
| `commands/process/backlog-workflows/github-actions.md` | New Issues-based backlog sub-command implementations |

### Modified
| File | Change |
|---|---|
| `templates/sf-toolkit.json` | Add `devops` key with `backend` and `environments` |
| `agents/sf-toolkit-resolve.md` | Read `devops.backend`, populate `workTracking` context, skip DOC queries in GHA mode |
| `agents/start-day-active-work.md` | Branch query strategy on `workTracking.backend` |
| `commands/devops/devops-commit.md` | Add disable guard after Resolution |
| `commands/devops/wi-sync.md` | Add disable guard after Resolution |
| `commands/devops/deploy-changed.md` | Add managed-env warning after target org resolution |
| `commands/devops/detect-drift.md` | Branch remediation text on backend |
| `commands/process/wrap-up.md` | GHA mode: query Issues live instead of calling `/wi-sync` |
| `commands/process/backlog.md` | Refactor into parent + backend routing (delegate to workflow files) |
| `commands/setup.md` | Add DevOps backend question + GHA label bootstrap step |
| `scripts/validate-plugin.js` | Add variant pair check + disabledSkills consistency check |
| `scripts/test-resolve-cache.js` | Add `workTracking` field validation test cases |
| `CLAUDE.md` | Document devops backend toggle, variant pattern, workTracking flow |

---

## Phase 1: Foundation

### Task 1: Config Template — Add `devops` Key

**Files:**
- Modify: `templates/sf-toolkit.json` (13 lines total)

- [ ] **Step 1: Edit the template**

In `templates/sf-toolkit.json`, replace the entire file with:

```json
{
  "searchKeywords": "",
  "searchKeywordsLastReviewed": "",
  "team": {},
  "backlog": {
    "backend": "yaml",
    "categories": []
  },
  "devops": {
    "backend": "devops-center",
    "environments": {
      "local": ["dev"],
      "managed": []
    }
  },
  "cache": {
    "ttlHours": 24
  }
}
```

Note: `devops.environments.managed` defaults to `[]` (DOC mode manages no envs via GHA). GHA projects override this to `["staging", "production"]` during `/setup`.

- [ ] **Step 2: Run validation**

Run: `node scripts/validate-plugin.js`
Expected: All checks pass (template is validated as valid JSON in Check 1).

- [ ] **Step 3: Commit**

```bash
git add templates/sf-toolkit.json
git commit -m "feat(config): add devops backend toggle to config template

Adds devops.backend (devops-center|github-actions) and
devops.environments (local/managed) to the config schema.
Default is devops-center for backwards compatibility."
```

---

### Task 2: Resolver Agent — Add `workTracking` Context

**Files:**
- Modify: `agents/sf-toolkit-resolve.md` (170 lines)

- [ ] **Step 1: Add config reading for devops.backend**

At line 62, the resolver reads `config/sf-toolkit.json`. Add devops config extraction. Find this text:

```
3. **Read `config/sf-toolkit.json`** — extract team mapping, searchKeywords, searchKeywordsLastReviewed, and backlog.backend. If file doesn't exist, add to missing array.
```

Replace with:

```
3. **Read `config/sf-toolkit.json`** — extract team mapping, searchKeywords, searchKeywordsLastReviewed, backlog.backend, and devops block (devops.backend, devops.environments). If file doesn't exist, add to missing array. If the `devops` key is missing, default to `{ "backend": "devops-center", "environments": { "local": ["dev"], "managed": [] } }`.
```

- [ ] **Step 2: Add GHA branch to DevOps Center query section**

At lines 68–72, the resolver queries DOC. Find this text:

```
6. **Query DevOps Center** (against production org from target-dev-hub):
   - `SELECT Id, Name FROM DevopsProject` — if exactly one result, use it. If multiple, include all and flag for skill to prompt selection. If zero or query fails, add to missing array.
   - `SELECT Id, Name FROM DevopsPipeline` — same logic.
   - `SELECT Id, Name, EnvironmentType FROM DevopsEnvironment` — return all as name→id map.
```

Replace with:

```
6. **Query DevOps Center OR derive GitHub context** (based on `devops.backend`):

   **If `devops.backend` == `"devops-center"` (or missing):**
   - `SELECT Id, Name FROM DevopsProject` — if exactly one result, use it. If multiple, include all and flag for skill to prompt selection. If zero or query fails, add to missing array.
   - `SELECT Id, Name FROM DevopsPipeline` — same logic.
   - `SELECT Id, Name, EnvironmentType FROM DevopsEnvironment` — return all as name→id map.

   **If `devops.backend` == `"github-actions"`:**
   - Skip all DevOps Center SOQL queries. Set `devopsCenter: null`.
   - Derive `issueRepo` from `git remote get-url origin`:
     - HTTPS format: `https://github.com/{owner}/{repo}.git` → extract `{owner}/{repo}`
     - SSH format: `git@github.com:{owner}/{repo}.git` → extract `{owner}/{repo}`
     - Run: `git remote get-url origin` and parse with the patterns above.
   - Read `devops.environments` from config (already extracted in step 3).
```

- [ ] **Step 3: Add `workTracking` block to cache output**

Find the cache output JSON template section (around lines 102–114). After the existing cache JSON structure, add a new section. Find this text:

```
     "orgs": { ... },
     ...rest of context
```

Replace with:

```
     "orgs": { ... },
     "devopsCenter": { "projectId": "...", "pipelineId": "...", "environments": { ... } },
     "workTracking": { ... },
     ...rest of context
```

Then add a new section AFTER the cache output JSON block:

```

### `workTracking` block

Populate based on `devops.backend`:

**If `devops.backend` == `"devops-center"` (or missing):**

```json
"workTracking": {
  "backend": "devops-center",
  "branchPattern": "WI-{id}",
  "idPrefix": "WI-",
  "idPattern": "WI-\\d{6}",
  "listActiveCmd": null,
  "listAllCmd": null,
  "viewItemCmd": null,
  "createItemCmd": null,
  "deployManagedEnvs": [],
  "deployLocalEnvs": ["dev", "staging", "production"],
  "disabledSkills": []
}
```

**If `devops.backend` == `"github-actions"`:**

```json
"workTracking": {
  "backend": "github-actions",
  "issueRepo": "{owner}/{repo}",
  "branchPattern": "feature/issue-{id}-{slug}",
  "idPrefix": "#",
  "idPattern": "#\\d+",
  "listActiveCmd": "gh issue list --repo {issueRepo} --state open --assignee @me --json number,title,state,labels,assignees",
  "listAllCmd": "gh issue list --repo {issueRepo} --state all --json number,title,state,labels,assignees --limit 100",
  "viewItemCmd": "gh issue view {id} --repo {issueRepo} --json number,title,body,state,labels,assignees,comments",
  "createItemCmd": "gh issue create --repo {issueRepo} --title \"{title}\" --body-file {bodyFile}",
  "deployManagedEnvs": ["{values from devops.environments.managed}"],
  "deployLocalEnvs": ["{values from devops.environments.local}"],
  "disabledSkills": ["devops-commit", "wi-sync"]
}
```

Replace `{issueRepo}` with the value derived in step 6. Replace `{values from ...}` with the arrays from `devops.environments` in config.

**Implicit backlog coupling:** If `devops.backend` == `"github-actions"` AND `backlog.backend` is NOT explicitly set to `"yaml"` or `"salesforce"` in the config, set `backlog.backend` to `"github-issues"` in the cache output.
```

- [ ] **Step 4: Add cache invalidation trigger for devops.backend change**

Find the cache validation section (around line 89 where it reads `cache.ttlHours`). This section describes when to invalidate. Add after the existing invalidation conditions:

```
- If `devops.backend` in the config differs from `workTracking.backend` in the cached context, invalidate (the user switched backends since last resolution).
```

- [ ] **Step 5: Run validation**

Run: `node scripts/validate-plugin.js`
Expected: All checks pass.

- [ ] **Step 6: Commit**

```bash
git add agents/sf-toolkit-resolve.md
git commit -m "feat(resolver): add workTracking context for devops backend abstraction

Resolver reads devops.backend from config and populates a
workTracking block in the cache. GHA mode: skips DOC SOQL,
derives issueRepo from git remote, sets disabledSkills.
DOC mode: adds thin workTracking wrapper for uniform access."
```

---

### Task 3: Cache Validation Tests — Add `workTracking` Test Cases

**Files:**
- Modify: `scripts/test-resolve-cache.js` (276 lines)

- [ ] **Step 1: Write failing tests for workTracking validation**

Add a new test section before the summary block (before line 266). Insert:

```javascript
// ─── workTracking schema validation ────────────────────────────────────────

console.log("\n  workTracking schema:");

test("valid DOC workTracking has required fields", () => {
  const wt = {
    backend: "devops-center",
    branchPattern: "WI-{id}",
    idPrefix: "WI-",
    idPattern: "WI-\\d{6}",
    listActiveCmd: null,
    deployManagedEnvs: [],
    deployLocalEnvs: ["dev", "staging", "production"],
    disabledSkills: [],
  };
  const result = validateWorkTracking(wt);
  assert(result.valid, "DOC workTracking should be valid: " + result.error);
});

test("valid GHA workTracking has required fields", () => {
  const wt = {
    backend: "github-actions",
    issueRepo: "owner/repo",
    branchPattern: "feature/issue-{id}-{slug}",
    idPrefix: "#",
    idPattern: "#\\d+",
    listActiveCmd: "gh issue list --repo owner/repo --state open --json number,title,state,labels,assignees",
    listAllCmd: "gh issue list --repo owner/repo --state all --json number,title,state,labels,assignees --limit 100",
    viewItemCmd: "gh issue view {id} --repo owner/repo --json number,title,body,state,labels,assignees,comments",
    createItemCmd: 'gh issue create --repo owner/repo --title "{title}" --body-file {bodyFile}',
    deployManagedEnvs: ["staging", "production"],
    deployLocalEnvs: ["dev"],
    disabledSkills: ["devops-commit", "wi-sync"],
  };
  const result = validateWorkTracking(wt);
  assert(result.valid, "GHA workTracking should be valid: " + result.error);
});

test("workTracking missing backend fails", () => {
  const wt = { branchPattern: "WI-{id}", idPrefix: "WI-", idPattern: "WI-\\d{6}" };
  const result = validateWorkTracking(wt);
  assert(!result.valid, "Missing backend should fail");
});

test("workTracking with unknown backend fails", () => {
  const wt = {
    backend: "jenkins",
    branchPattern: "feat-{id}",
    idPrefix: "#",
    idPattern: "#\\d+",
    deployManagedEnvs: [],
    deployLocalEnvs: [],
    disabledSkills: [],
  };
  const result = validateWorkTracking(wt);
  assert(!result.valid, "Unknown backend should fail");
});

test("GHA workTracking missing issueRepo fails", () => {
  const wt = {
    backend: "github-actions",
    branchPattern: "feature/issue-{id}-{slug}",
    idPrefix: "#",
    idPattern: "#\\d+",
    listActiveCmd: "gh issue list",
    deployManagedEnvs: [],
    deployLocalEnvs: [],
    disabledSkills: [],
  };
  const result = validateWorkTracking(wt);
  assert(!result.valid, "GHA missing issueRepo should fail");
});

test("workTracking missing deployManagedEnvs fails", () => {
  const wt = {
    backend: "devops-center",
    branchPattern: "WI-{id}",
    idPrefix: "WI-",
    idPattern: "WI-\\d{6}",
    listActiveCmd: null,
    deployLocalEnvs: ["dev"],
    disabledSkills: [],
  };
  const result = validateWorkTracking(wt);
  assert(!result.valid, "Missing deployManagedEnvs should fail");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node scripts/test-resolve-cache.js`
Expected: FAIL — `validateWorkTracking is not defined`

- [ ] **Step 3: Implement `validateWorkTracking` function**

Add the function near the top of the file, after the existing helper functions (after line 69):

```javascript
// ─── workTracking validation ───────────────────────────────────────────────

const VALID_BACKENDS = ["devops-center", "github-actions"];
const WORK_TRACKING_REQUIRED = [
  "backend",
  "branchPattern",
  "idPrefix",
  "idPattern",
  "deployManagedEnvs",
  "deployLocalEnvs",
  "disabledSkills",
];
const GHA_REQUIRED = ["issueRepo", "listActiveCmd"];

function validateWorkTracking(wt) {
  if (!wt || typeof wt !== "object") {
    return { valid: false, error: "workTracking must be an object" };
  }
  for (const field of WORK_TRACKING_REQUIRED) {
    if (!(field in wt)) {
      return { valid: false, error: `missing required field: ${field}` };
    }
  }
  if (!VALID_BACKENDS.includes(wt.backend)) {
    return {
      valid: false,
      error: `unknown backend: ${wt.backend} (expected: ${VALID_BACKENDS.join(", ")})`,
    };
  }
  if (!Array.isArray(wt.deployManagedEnvs)) {
    return { valid: false, error: "deployManagedEnvs must be an array" };
  }
  if (!Array.isArray(wt.deployLocalEnvs)) {
    return { valid: false, error: "deployLocalEnvs must be an array" };
  }
  if (!Array.isArray(wt.disabledSkills)) {
    return { valid: false, error: "disabledSkills must be an array" };
  }
  if (wt.backend === "github-actions") {
    for (const field of GHA_REQUIRED) {
      if (!wt[field]) {
        return { valid: false, error: `GHA backend missing required field: ${field}` };
      }
    }
  }
  return { valid: true, error: null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node scripts/test-resolve-cache.js`
Expected: All existing tests + all 6 new workTracking tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-resolve-cache.js
git commit -m "test(cache): add workTracking schema validation tests

Adds validateWorkTracking() function and 6 test cases covering
DOC mode, GHA mode, missing fields, unknown backend, and
GHA-specific required fields (issueRepo, listActiveCmd)."
```

---

## Phase 2: Skill Conditionals

### Task 4: Disable Guards — devops-commit and wi-sync

**Files:**
- Modify: `commands/devops/devops-commit.md` (lines 25–30 area)
- Modify: `commands/devops/wi-sync.md` (lines 27–30 area)

- [ ] **Step 1: Add disable guard to devops-commit.md**

In `commands/devops/devops-commit.md`, find the Resolution section. After the cache is loaded and validated (after the cache-first resolution steps that read the cache and check expiry), add a new step. Find this text at the end of the Resolution section's cache validation:

```
   - Read `.sf/config.json` — confirm `target-org` matches `orgs.devAlias` in the cached context.
```

After the full Resolution block (after the resolver dispatch fallback), add:

```

### Backend Check

If the resolved context contains `workTracking.disabledSkills` and it includes `"devops-commit"`:

> **Not available in GitHub Actions mode.**
>
> In GitHub Actions projects, metadata commits go through the standard git workflow:
>
> ```
> git add <files>
> git commit -m "feat: description (Fixes #NN)"
> git push
> gh pr create --title "feat: description" --body "Fixes #NN"
> ```
>
> GitHub Actions handles validation on PR open and deployment on merge to main.

Stop here — do not proceed to the workflow steps below.

---
```

- [ ] **Step 2: Add disable guard to wi-sync.md**

In `commands/devops/wi-sync.md`, add the same pattern after the Resolution section's cache validation. After the full Resolution block:

```

### Backend Check

If the resolved context contains `workTracking.disabledSkills` and it includes `"wi-sync"`:

> **Not available in GitHub Actions mode.**
>
> Issue status is queried live from GitHub — no sync to MEMORY.md needed.
> Active issue status appears directly in `/start-day` and `/wrap-up` via `gh issue list`.

Stop here — do not proceed to the workflow steps below.

---
```

- [ ] **Step 3: Run validation**

Run: `node scripts/validate-plugin.js`
Expected: All checks pass (both files still have the "Cache-first resolution" marker).

- [ ] **Step 4: Commit**

```bash
git add commands/devops/devops-commit.md commands/devops/wi-sync.md
git commit -m "feat(skills): add disable guards for GHA mode in devops-commit and wi-sync

Both skills check workTracking.disabledSkills after cache load.
In GHA mode they show a helpful alternative message and stop.
DOC mode behavior is unchanged (disabledSkills is empty)."
```

---

### Task 5: Deploy-Changed — Managed Environment Warning

**Files:**
- Modify: `commands/devops/deploy-changed.md` (around line 266, Step 5)

- [ ] **Step 1: Add managed-env check after target org resolution**

In `commands/devops/deploy-changed.md`, find the "Step 5 — Build Deploy Command" section (line 266). Insert a new sub-section right before the "Grouping strategy" heading. Find:

```
## Step 5 — Build Deploy Command

Construct the `sf project deploy start` command with targeted `--source-dir` flags.

### Grouping strategy:
```

Replace with:

```
## Step 5 — Build Deploy Command

Construct the `sf project deploy start` command with targeted `--source-dir` flags.

### Managed environment check

If the resolved context contains `workTracking.deployManagedEnvs` and the target org alias (or its environment name) matches any entry in that array:

> **Warning: {target-org} is managed by GitHub Actions.**
>
> Deployments to this environment happen automatically when PRs are merged to `main`.
> Direct deployment bypasses the CI/CD pipeline (validation, code analysis, test runs).
>
> **Options:**
> 1. **Deploy to a local env instead** — target `{first entry from workTracking.deployLocalEnvs}` for testing
> 2. **Proceed anyway** — deploy directly (use for emergency hotfixes only)
> 3. **Open a PR instead** — push your branch and run `gh pr create`

If the user chooses option 1, restart Step 5 with the local env alias. If they choose option 3, stop the skill. If they choose option 2, proceed with a warning banner in the deploy output.

If `workTracking.deployManagedEnvs` is empty or missing, skip this check entirely (DOC mode — all envs are local).

### Grouping strategy:
```

- [ ] **Step 2: Run validation**

Run: `node scripts/validate-plugin.js`
Expected: All checks pass.

- [ ] **Step 3: Commit**

```bash
git add commands/devops/deploy-changed.md
git commit -m "feat(deploy-changed): warn when targeting GHA-managed environments

Checks workTracking.deployManagedEnvs before building deploy
command. Shows options to redirect to local env, proceed anyway,
or open a PR. Skipped in DOC mode (empty managed list)."
```

---

### Task 6: Detect-Drift — Backend-Aware Remediation Text

**Files:**
- Modify: `commands/devops/detect-drift.md` (around lines 355–368, the "Next Steps" remediation)

- [ ] **Step 1: Branch the remediation suggestion**

In `commands/devops/detect-drift.md`, find the "Next Steps" block at the end of Step 5. Find:

```
### Next Steps:
1. Review the changes: git diff {context.metadataPath}/flows/
2. Stage and commit: git add {files} && git commit -m "Retrieve org drift: {summary}"
3. Deploy to dev sandbox: /deploy-changed
4. Associate with work item: /devops-commit WI-NNNNNN
```

Replace with:

```
### Next Steps:
1. Review the changes: `git diff {context.metadataPath}/flows/`
2. Stage and commit: `git add {files} && git commit -m "Retrieve org drift: {summary}"`
3. Deploy to dev sandbox: `/deploy-changed`

**If `workTracking.backend` == `"devops-center"`:**
4. Associate with work item: `/devops-commit WI-NNNNNN`

**If `workTracking.backend` == `"github-actions"`:**
4. Create an Issue and PR:
   ```
   gh issue create --title "Fix drift: {summary}" --label "bug"
   git checkout -b feature/issue-{id}-fix-drift
   git push -u origin feature/issue-{id}-fix-drift
   gh pr create --title "Fix drift: {summary}" --body "Fixes #{id}"
   ```
```

- [ ] **Step 2: Run validation**

Run: `node scripts/validate-plugin.js`
Expected: All checks pass.

- [ ] **Step 3: Commit**

```bash
git add commands/devops/detect-drift.md
git commit -m "feat(detect-drift): branch remediation text for DOC vs GHA backend

DOC mode suggests /devops-commit. GHA mode suggests creating
an Issue and opening a PR with Fixes #NN."
```

---

### Task 7: Wrap-Up — GHA Mode Skips wi-sync

**Files:**
- Modify: `commands/process/wrap-up.md` (lines 257–277, Step 5)

- [ ] **Step 1: Add GHA branch to Step 5**

In `commands/process/wrap-up.md`, find Step 5. Find:

```
## Step 5 — WI Status Sync

Run `/wi-sync` (full sync — updates MEMORY.md) to reconcile live DevOps Center status against the WI tables in MEMORY.md. The sync queries `{context.orgs.productionAlias}` for current WI status.

If `skipWiSync` is set, report `[SKIP] WI sync skipped (--skip-wi-sync).` and move to Step 6.

If the org query fails (unreachable, auth expired), log the failure and continue — do not block the wrap-up.

This runs **after** commits and push (Steps 3–4) so any WIs deployed this session are reflected in the live status before memory is updated.

Report the sync result inline:

```text
### WI Sync

{n} rows updated, {n} discrepancies flagged, {n} skipped (manual review).
```

If zero changes: `[OK] MEMORY.md WI tables are current.`

---
```

Replace with:

```
## Step 5 — Work Item / Issue Status Check

If `skipWiSync` is set, report `[SKIP] Status check skipped (--skip-wi-sync).` and move to Step 6.

**If `workTracking.backend` == `"devops-center"`:**

Run `/wi-sync` (full sync — updates MEMORY.md) to reconcile live DevOps Center status against the WI tables in MEMORY.md. The sync queries `{context.orgs.productionAlias}` for current WI status.

If the org query fails (unreachable, auth expired), log the failure and continue — do not block the wrap-up.

This runs **after** commits and push (Steps 3–4) so any WIs deployed this session are reflected in the live status before memory is updated.

Report the sync result inline:

```text
### WI Sync

{n} rows updated, {n} discrepancies flagged, {n} skipped (manual review).
```

If zero changes: `[OK] MEMORY.md WI tables are current.`

**If `workTracking.backend` == `"github-actions"`:**

Query current Issue status directly (no sync needed — Issues are always live):

Run: `{workTracking.listActiveCmd}` (substituting `{issueRepo}` with `workTracking.issueRepo`)

Parse the JSON output and report:

```text
### Active Issues

| # | Title | Status | Assignee |
|---|-------|--------|----------|
| {number} | {title} | {state + status label} | {assignee} |

{n} open issues assigned to you.
```

If the `gh` command fails (auth expired, no network), log the failure and continue.

---
```

- [ ] **Step 2: Run validation**

Run: `node scripts/validate-plugin.js`
Expected: All checks pass.

- [ ] **Step 3: Commit**

```bash
git add commands/process/wrap-up.md
git commit -m "feat(wrap-up): branch Step 5 for DOC (wi-sync) vs GHA (live issue query)

DOC mode: unchanged /wi-sync behavior.
GHA mode: runs gh issue list and shows active issues inline.
No MEMORY.md sync in GHA mode."
```

---

### Task 8: Start-Day Active-Work Agent — GHA Query Path

**Files:**
- Modify: `agents/start-day-active-work.md` (117 lines)

- [ ] **Step 1: Add GHA branch to work item query**

In `agents/start-day-active-work.md`, find the line about skipping DevOps Center query in quick mode (line 46):

```
If {{quickMode}} is "true", skip the DevOps Center query and report: `[SKIP] WI freshness check skipped (--quick).`
```

Replace with:

```
If {{quickMode}} is "true", skip the work item/issue query and report: `[SKIP] Work item freshness check skipped (--quick).`

**If `workTracking.backend` == `"devops-center"`:**
Query DevOps Center work items using `mcp__Salesforce-DX__list_devops_center_work_items` as described below.

**If `workTracking.backend` == `"github-actions"`:**
Query GitHub Issues instead:

Run: `gh issue list --repo {workTracking.issueRepo} --state open --json number,title,state,labels,assignees --limit 50`

Parse the JSON output:
- For each issue, extract status from labels matching `status:*` (e.g., `status:in-progress`). If no status label, use the issue state (`open` → "Not Started").
- Extract assignee from the `assignees` array.
- Match issues to backlog items by checking if the issue title or number appears in MEMORY.md or backlog context.
- Classify as "Your Active Work" (assigned to `{{currentUserName}}`), "Team Active Work" (assigned to others), or "Unassigned."
```

- [ ] **Step 2: Update the output format table headers**

Find the output format section (around line 89). The table currently uses `WI` column headers. Update to be backend-aware. Find:

```
| BL | WI | Title | Status | Type | Notes |
|----|----|----|--------|------|-------|
| BL-NNNN | WI-NNNNNN | {title} | In Progress | WI | {brief context} |
| BL-NNNN | — | {title} | In Progress | Backlog-only | {brief context} |
```

Replace with:

```
| BL | Ref | Title | Status | Type | Notes |
|----|-----|----|--------|------|-------|
| BL-NNNN | WI-NNNNNN | {title} | In Progress | WI | {brief context} |
| BL-NNNN | #NN | {title} | In Progress | Issue | {brief context} |
| BL-NNNN | — | {title} | In Progress | Backlog-only | {brief context} |
```

Use `WI-NNNNNN` format for DOC mode, `#NN` format for GHA mode. The `Ref` column adapts based on `workTracking.idPrefix`.

- [ ] **Step 3: Update the drift detection lines**

Find the drift reporting lines at the bottom of the output format (around line 111):

```
**WI status drift:** {findings or "None (memory current)"}
**Assignment drift:** {findings or "None — backlog and DevOps Center assignments match"}
```

Replace with:

```
**Work item status drift:** {findings or "None (memory current)"}
**Assignment drift:** {findings or "None — backlog and work tracking assignments match"}
```

- [ ] **Step 4: Run validation**

Run: `node scripts/validate-plugin.js`
Expected: All checks pass.

- [ ] **Step 5: Commit**

```bash
git add agents/start-day-active-work.md
git commit -m "feat(active-work-agent): add GHA query path using gh issue list

Agent branches on workTracking.backend: DOC mode uses MCP
list_devops_center_work_items, GHA mode uses gh issue list.
Output format uses generic Ref column for WI/Issue references."
```

---

## Phase 3: Backlog Variant

### Task 9: Backlog Parent Refactor + DOC Variant Extraction

**Files:**
- Modify: `commands/process/backlog.md` (738 lines)
- Create: `commands/process/backlog-workflows/devops-center.md`

This is the largest task. The parent keeps: frontmatter, intro, argument resolution, resolution section, and a new backend routing section. All sub-command implementations move to the DOC variant file.

- [ ] **Step 1: Create the backlog-workflows directory and DOC variant**

First, create the directory:

```bash
mkdir -p commands/process/backlog-workflows
```

Read `commands/process/backlog.md` fully. Extract everything from the first sub-command section through the end of the file (from `## Sub-command: \`dashboard\`` onward — approximately line 49 to line 738) into a new file `commands/process/backlog-workflows/devops-center.md`.

The variant file should start with:

```markdown
# Backlog Workflows — DevOps Center (YAML Backend)

> **Variant of:** `commands/process/backlog.md`
> **Backend:** `devops-center` (backlog.backend: `yaml` or `salesforce`)
> **Counterpart:** `commands/process/backlog-workflows/github-actions.md`

This file contains all sub-command implementations for the YAML/Salesforce backlog backend, used when `workTracking.backend` is `"devops-center"`.

The parent skill (`/backlog`) handles argument parsing and resolution before delegating here. All variables from the parent (subcommand, item_id, category, filters, resolved context) are available.

---

```

Then paste all the sub-command sections from the original backlog.md (dashboard, add, evaluate, prioritize, graduate, search, update, archive, render) below that header, preserving them exactly as-is.

- [ ] **Step 2: Refactor backlog.md into routing parent**

In `commands/process/backlog.md`, remove all sub-command implementations (everything after the Argument Resolution section, approximately line 49 onward). Replace with a backend routing section:

```markdown

## Backend Routing

Determine the effective backlog backend:

1. If `backlog.backend` in the resolved context is explicitly `"yaml"` or `"salesforce"`, use the DevOps Center variant regardless of `workTracking.backend`.
2. If `backlog.backend` is `"github-issues"`, use the GitHub Actions variant.
3. If `backlog.backend` is not explicitly set: follow `workTracking.backend`:
   - `"devops-center"` → DevOps Center variant
   - `"github-actions"` → GitHub Actions variant

**If DevOps Center variant:**
Read and follow the workflow in `${CLAUDE_PLUGIN_ROOT}/commands/process/backlog-workflows/devops-center.md`.

**If GitHub Actions variant:**
Read and follow the workflow in `${CLAUDE_PLUGIN_ROOT}/commands/process/backlog-workflows/github-actions.md`.

Pass through these resolved values: `subcommand`, `item_id`, `category`, `filters`, and the full resolved context.
```

Also update the frontmatter description (line 3). Find:

```
description: Upstream backlog management — add, evaluate, prioritize, graduate, search, render. YAML or Salesforce backend.
```

Replace with:

```
description: Upstream backlog management — add, evaluate, prioritize, graduate, search, render. YAML, Salesforce, or GitHub Issues backend.
```

- [ ] **Step 3: Run validation**

Run: `node scripts/validate-plugin.js`
Expected: All checks pass. The parent still has "Cache-first resolution" marker. The variant file is not a command (no frontmatter with `name:`), so it won't be checked as a skill.

- [ ] **Step 4: Commit**

```bash
git add commands/process/backlog.md commands/process/backlog-workflows/devops-center.md
git commit -m "refactor(backlog): extract DOC sub-commands into variant workflow file

backlog.md becomes a routing parent that delegates to
backlog-workflows/devops-center.md (existing YAML behavior)
or backlog-workflows/github-actions.md (to be created).
All sub-command implementations moved to DOC variant unchanged."
```

---

### Task 10: Backlog GitHub Actions Variant

**Files:**
- Create: `commands/process/backlog-workflows/github-actions.md`

- [ ] **Step 1: Create the GHA variant file**

Create `commands/process/backlog-workflows/github-actions.md` with the full Issues-based implementation:

```markdown
# Backlog Workflows — GitHub Actions (Issues Backend)

> **Variant of:** `commands/process/backlog.md`
> **Backend:** `github-actions` (backlog.backend: `github-issues`)
> **Counterpart:** `commands/process/backlog-workflows/devops-center.md`

This file contains all sub-command implementations for the GitHub Issues backlog backend, used when `workTracking.backend` is `"github-actions"`.

The parent skill (`/backlog`) handles argument parsing and resolution before delegating here. All variables from the parent (subcommand, item_id, category, filters, resolved context) are available.

**Issue repo:** `{workTracking.issueRepo}`

---

## Issue Body Template

When creating or evaluating issues, use this body structure:

```markdown
{description}

## Details
- **Category:** {category}
- **Source:** {source}
- **CBC Score:** {score}/5

## Dependencies
- **Blocked by:** (none)
- **Related:** (none)

## Design
(none)
```

---

## Sub-command: `dashboard`

**Trigger:** `/backlog` or `/backlog dashboard`

1. Run: `gh issue list --repo {workTracking.issueRepo} --state open --json number,title,state,labels,assignees --limit 50`
2. Parse the JSON output. For each issue, extract:
   - **Priority:** label matching `P1`–`P4` (default: "Unset")
   - **Status:** label matching `status:*` (default: state `open` → "Captured")
   - **Effort:** label matching `effort:*` (default: "Unset")
   - **Category:** label matching `cat:*` (default: "Uncategorized")
   - **Assignee:** from `assignees[0].login` (default: "Unassigned")
3. Group by status, sort by priority within each group.
4. Display:

```text
### Backlog Dashboard (GitHub Issues)

**{n} open issues** in {workTracking.issueRepo}

#### In Progress ({n})
| # | Title | Priority | Effort | Assignee |
|---|-------|----------|--------|----------|
| #{number} | {title} | {priority} | {effort} | {assignee} |

#### Ready ({n})
...

#### Prioritized ({n})
...

#### Captured ({n})
...
```

---

## Sub-command: `add`

**Trigger:** `/backlog add` or `/backlog add {title}`

1. If title was provided in arguments, use it. Otherwise prompt: "What's the title for this item?"
2. Prompt for:
   - **Description** (required): multi-line description of the work
   - **Category** (required): one of the categories from `context.backlog.categories`. If no categories configured, accept any value.
   - **Priority** (optional, default P3): P1 (critical), P2 (high), P3 (medium), P4 (low)
   - **Source** (optional, default "claude"): team, stakeholder, vendor, claude
3. Create a temporary file with the Issue body using the template above.
4. Run:

```bash
gh issue create --repo {workTracking.issueRepo} \
  --title "{title}" \
  --body-file {tempBodyFile} \
  --label "status:captured" \
  --label "cat:{category}" \
  --label "P{n}" \
  --label "source:{source}"
```

5. Parse the created issue URL/number from the output.
6. Report:

```text
### Created: #{number}

**{title}**
Priority: {priority} | Category: {category} | Status: Captured
URL: {issue_url}
```

---

## Sub-command: `search`

**Trigger:** `/backlog search {filters}`

Parse filters:
- Label-based filters: `cat:apex`, `P1`, `effort:L`, `status:in-progress`, `blocked` → map to `--label` flags
- Text search: remaining text → use `gh search issues --repo {workTracking.issueRepo} "{text}"`
- Assignee filter: `@me`, `@{name}` → map to `--assignee`

For label-only searches:

```bash
gh issue list --repo {workTracking.issueRepo} --state open --label "{label1}" --label "{label2}" --json number,title,state,labels,assignees
```

For text searches:

```bash
gh search issues --repo {workTracking.issueRepo} "{text}" --json number,title,state,labels,url
```

Display results in a table format matching the dashboard layout.

---

## Sub-command: `evaluate`

**Trigger:** `/backlog evaluate #{number}` or `/backlog evaluate {number}`

1. Fetch the issue:

```bash
gh issue view {number} --repo {workTracking.issueRepo} --json number,title,body,state,labels,assignees,comments
```

2. Read the issue title, body, and comments.
3. Run the CBC (Claude Build Confidence) scoring rubric:
   - **Score 1:** Vague idea, no clear scope or approach
   - **Score 2:** Concept defined but major unknowns remain
   - **Score 3:** Requirements clear, approach identified, some open questions
   - **Score 4:** Well-specified, clear implementation path, minor decisions remain
   - **Score 5:** Fully specified, ready for direct implementation

4. Assess effort (XS/S/M/L/XL) and complexity (Low/Med/High) based on:
   - Scope: how many components/files are affected?
   - Dependencies: are there blocking items or external integrations?
   - Risk: how likely is rework?

5. Update the issue body's CBC Score section and add effort/complexity labels:

```bash
gh issue edit {number} --repo {workTracking.issueRepo} \
  --add-label "effort:{effort}" \
  --add-label "complexity:{complexity}"
```

Update the issue body by reading current body, replacing the `**CBC Score:** .../5` line with the new score, and writing back:

```bash
gh issue edit {number} --repo {workTracking.issueRepo} --body "{updated_body}"
```

6. If current status label is `status:captured`, upgrade to `status:groomed`:

```bash
gh issue edit {number} --repo {workTracking.issueRepo} \
  --remove-label "status:captured" \
  --add-label "status:groomed"
```

7. Report:

```text
### Evaluated: #{number}

**{title}**
CBC Score: {score}/5
Effort: {effort} | Complexity: {complexity}
Status: Captured → Groomed
```

---

## Sub-command: `prioritize`

**Trigger:** `/backlog prioritize` or `/backlog prioritize {category}`

1. Fetch open issues, optionally filtered by category label:

```bash
gh issue list --repo {workTracking.issueRepo} --state open --label "status:groomed" {--label "cat:{category}" if specified} --json number,title,labels
```

2. Parse and display current priority ordering.
3. Present the list and ask the user to reorder by assigning priority labels (P1–P4).
4. For each issue that needs a priority change:

```bash
gh issue edit {number} --repo {workTracking.issueRepo} \
  --remove-label "P{old}" \
  --add-label "P{new}" \
  --remove-label "status:groomed" \
  --add-label "status:prioritized"
```

5. Report the updated priority list.

---

## Sub-command: `graduate`

**Trigger:** `/backlog graduate #{number}` or `/backlog graduate {number}`

In GitHub Actions mode, the Issue already IS the work item. "Graduate" means "activate for development."

1. Fetch the issue:

```bash
gh issue view {number} --repo {workTracking.issueRepo} --json number,title,body,state,labels,assignees
```

2. **Graduation gate check** — all must pass:

   **2a. Required labels:**
   - Must have an `effort:*` label
   - Must have a `complexity:*` label
   - Must have a `P*` priority label

   If any missing:

   ```text
   **Cannot graduate #{number}** — missing required labels:
   - effort: {current or "missing"}
   - complexity: {current or "missing"}
   - priority: {current or "missing"}

   Run `/backlog evaluate #{number}` to fill in missing evaluations first.
   ```

   **2b. Phase 1 architecture completeness:**

   Read the issue body, comments, and linked design doc (from the `## Design` section if present). Check whether these architecture decisions are documented:
   - [ ] **Build mode assigned:** Is one of agent-driven, human-focused, config-only, or multi-mode stated?
   - [ ] **Object model defined:** Are the objects/fields named (new or existing, relationships)?
   - [ ] **Sharing/security model:** Is it clear who needs access and which permission sets are involved?
   - [ ] **Scope boundaries:** Is it clear what's in and what's explicitly out?
   - [ ] **Dependencies:** Are blocking items or sequencing requirements identified? (Check `## Dependencies` section)

   Two additional checks apply conditionally:
   - [ ] **Integration pattern** (if the item involves external systems): API direction, auth model
   - [ ] **Multi-mode integration checkpoints** (if build mode is multi-mode): Are the handoff points between modes defined?

   Score as pass/warn/fail (same rubric as DOC variant).

   **2c. Design doc check** — if `## Design` section says "(none)" and CBC score >= 3:

   ```text
   **No design doc found for #{number}** (CBC score: {score}).

   Options:
   1. **Run brainstorming** — invoke `superpowers:brainstorming` to generate a design doc
   2. **Skip** — proceed without a spec (fine for CBC 5 / small changes)
   3. **Provide path** — link an existing design doc
   ```

3. Activate the issue:

```bash
gh issue edit {number} --repo {workTracking.issueRepo} \
  --remove-label "status:prioritized" \
  --add-label "status:in-progress"
```

If not already assigned, assign to the current user:

```bash
gh issue edit {number} --repo {workTracking.issueRepo} --add-assignee @me
```

4. Create the feature branch:

```bash
git checkout -b feature/issue-{number}-{slug}
```

Where `{slug}` is the issue title lowercased, spaces replaced with hyphens, non-alphanumeric characters removed, truncated to 40 characters.

5. Add a comment to the issue:

```bash
gh issue comment {number} --repo {workTracking.issueRepo} --body "Graduated to In Progress. Branch: \`feature/issue-{number}-{slug}\`"
```

6. Report:

```text
### Graduated: #{number} → In Progress

**{title}**
Assigned: {assignee}
Branch: feature/issue-{number}-{slug}

This issue will appear in `/start-day` as active work.
```

7. **Implementation plan offer** (same logic as DOC variant):

   If build mode is agent-driven (or CBC score >= 4) AND a design doc exists, offer to generate an implementation plan via `superpowers:writing-plans`.

---

## Sub-command: `update`

**Trigger:** `/backlog update #{number} {field} {value}`

Parse the field and value. Map to Issue operations:

| Field | Operation |
|---|---|
| `priority {P1-P4}` | Remove old `P*` label, add new one |
| `effort {XS-XL}` | Remove old `effort:*` label, add new one |
| `complexity {Low/Med/High}` | Remove old `complexity:*` label, add new one |
| `status {value}` | Remove old `status:*` label, add new one |
| `assigned_to {name}` | `gh issue edit --add-assignee {name}` |
| `blocked_by #{n}` | Update `## Dependencies` section in body, add `blocked` label |
| `related #{n}` | Update `## Dependencies` section in body |
| `design_doc {path}` | Update `## Design` section in body |
| `target_date {YYYY-MM-DD}` | Update `## Target` section in body (or assign to milestone) |

For body updates:
1. Fetch current body: `gh issue view {number} --json body`
2. Parse the relevant section, update the value
3. Write back: `gh issue edit {number} --body "{updated_body}"`

Report the change.

---

## Sub-command: `archive`

**Trigger:** `/backlog archive #{number}`

1. Close the issue with a reason:

```bash
gh issue close {number} --repo {workTracking.issueRepo} --reason "not planned" --comment "Archived via /backlog archive"
```

2. Add an `archived` label:

```bash
gh issue edit {number} --repo {workTracking.issueRepo} --add-label "archived"
```

3. Report: `Archived: #{number} — {title} (closed)`

---

## Sub-command: `render`

**Trigger:** `/backlog render`

1. Fetch all issues (open + closed):

```bash
gh issue list --repo {workTracking.issueRepo} --state all --json number,title,state,labels,assignees --limit 200
```

2. Parse and categorize by status labels.
3. Generate `docs/backlog/README.md` with the same format as the YAML variant:
   - Summary statistics (total, by status, by priority)
   - Table of active items (open issues, sorted by priority)
   - Table of completed items (closed issues with `status:done` or merged)
   - Table of archived items (closed with `archived` label)

4. Write the file and report the path.

---

## Sub-command: `migrate`

**Trigger:** `/backlog migrate`

One-time migration from YAML backlog to GitHub Issues. Only available when switching from DOC to GHA.

1. Check that `docs/backlog/backlog.yaml` exists. If not: "No backlog.yaml found — nothing to migrate."

2. Read and parse `docs/backlog/backlog.yaml`.

3. For each non-archived item:
   a. Create a GitHub Issue using the body template, mapping all fields to labels (priority, effort, complexity, category, status, source).
   b. If `devops_wis` is non-empty, add a note in the body: "Migrated from WI-NNNNNN" for each WI.
   c. If `assigned_to` is set, add assignee.
   d. If `blocked_by` is non-empty, populate the `## Dependencies` section with cross-references.
   e. If `design_doc` is set, populate the `## Design` section.
   f. Track the mapping: `BL-NNNN → #NN`

4. For archived items: create closed Issues with `archived` label.

5. Rename `backlog.yaml` to `backlog.yaml.archive`.

6. Report:

```text
### Migration Complete

Migrated {n} items from backlog.yaml to GitHub Issues:

| Old ID | New Issue | Title | Status |
|--------|-----------|-------|--------|
| BL-NNNN | #{nn} | {title} | {status} |

backlog.yaml renamed to backlog.yaml.archive.
```
```

- [ ] **Step 2: Run validation**

Run: `node scripts/validate-plugin.js`
Expected: All checks pass. The variant file has no `name:` frontmatter, so it's not validated as a command.

- [ ] **Step 3: Commit**

```bash
git add commands/process/backlog-workflows/github-actions.md
git commit -m "feat(backlog): add GitHub Actions variant with Issues-based workflow

All backlog sub-commands reimplemented using gh CLI:
add creates Issues, search uses label filters, evaluate
updates Issue body, graduate activates and creates feature
branch, migrate converts YAML backlog to Issues."
```

---

## Phase 4: Setup, Validation & Docs

### Task 11: Setup Skill — DevOps Backend Question + Label Bootstrap

**Files:**
- Modify: `commands/setup.md` (around lines 74–104, Step 3)

- [ ] **Step 1: Add DevOps backend question to Step 3**

In `commands/setup.md`, find Step 3's question list. After the "Backlog backend" question (around line 82), add a new question. Find:

```
3. **Backlog backend:** Ask "yaml" (file-based, works immediately) or "salesforce" (custom object — requires additional setup). Default to yaml.
```

Replace with:

```
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
```

- [ ] **Step 2: Update the config file template in Step 3**

Find the JSON template written to `config/sf-toolkit.json` (around line 86). Find:

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

Replace with:

```json
{
  "searchKeywords": "{user input}",
  "searchKeywordsLastReviewed": "{today's date}",
  "team": {
    "{email}": "{name}"
  },
  "backlog": {
    "backend": "{yaml|salesforce|github-issues}"
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

- [ ] **Step 3: Add label bootstrapping step for GHA mode**

After the config file is written, add a new step for GHA projects. Find the review assignments question (around line 106) and add BEFORE it:

```markdown

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

   # Dependencies
   gh label create "blocked" --description "Blocked by another item" --color "B60205" --force
   gh label create "archived" --description "Archived backlog item" --color "EEEEEE" --force
   ```

   For each category in `backlog.categories`:

   ```bash
   gh label create "cat:{category}" --description "Category: {category}" --color "006B75" --force
   ```

   Report: "Created {n} labels in {repo}. {n} already existed (skipped)."
```

Then renumber the review assignments question from 4 to 6.

- [ ] **Step 4: Run validation**

Run: `node scripts/validate-plugin.js`
Expected: All checks pass.

- [ ] **Step 5: Commit**

```bash
git add commands/setup.md
git commit -m "feat(setup): add DevOps backend question and GHA label bootstrapping

/setup now asks which DevOps backend the project uses.
GHA mode: creates full label taxonomy via gh label create,
sets backlog.backend to github-issues, configures managed
vs local environment lists."
```

---

### Task 12: Validate-Plugin.js — New Checks

**Files:**
- Modify: `scripts/validate-plugin.js` (316 lines)

- [ ] **Step 1: Add variant pair completeness check**

After Check 8 (hooks.json structure, around line 303), add a new check section:

```javascript
// ─── Check 9: Backlog variant pair completeness ──────────────────────────────

console.log("\n9. Backlog workflow variant pairs");

const variantDir = path.join(root, "commands", "process", "backlog-workflows");
if (fs.existsSync(variantDir)) {
  const ghaVariant = path.join(variantDir, "github-actions.md");
  const docVariant = path.join(variantDir, "devops-center.md");

  const ghaExists = fs.existsSync(ghaVariant);
  const docExists = fs.existsSync(docVariant);

  if (ghaExists && docExists) {
    pass("Both variant files exist");

    // Check that both implement the same sub-commands
    const subCmdPattern = /## Sub-command: `(\w+)`/g;
    const ghaContent = fs.readFileSync(ghaVariant, "utf8");
    const docContent = fs.readFileSync(docVariant, "utf8");

    const ghaSubs = [...ghaContent.matchAll(subCmdPattern)].map((m) => m[1]).sort();
    const docSubs = [...docContent.matchAll(subCmdPattern)].map((m) => m[1]).sort();

    // GHA may have extra sub-commands (e.g., migrate) that DOC doesn't need
    const missingInGha = docSubs.filter((s) => !ghaSubs.includes(s));
    if (missingInGha.length === 0) {
      pass("GHA variant implements all DOC sub-commands");
    } else {
      fail(`GHA variant missing sub-commands from DOC: ${missingInGha.join(", ")}`);
    }
  } else if (ghaExists && !docExists) {
    fail("github-actions.md exists but devops-center.md is missing");
  } else if (!ghaExists && docExists) {
    fail("devops-center.md exists but github-actions.md is missing");
  } else {
    pass("No variant files yet (both absent — OK)");
  }
} else {
  pass("No backlog-workflows directory yet (OK)");
}
```

- [ ] **Step 2: Add disabledSkills consistency check**

After Check 9, add:

```javascript
// ─── Check 10: disabledSkills consistency ────────────────────────────────────

console.log("\n10. Disabled skills have backend check guards");

const DISABLED_IN_GHA = ["devops-commit", "wi-sync"];
const backendCheckMarker = "Backend Check";

for (const skillName of DISABLED_IN_GHA) {
  const skillFile = allCommands.find((f) => path.basename(f, ".md") === skillName);
  if (!skillFile) {
    fail(`${skillName}.md — file not found`);
    continue;
  }
  const content = fs.readFileSync(skillFile, "utf8");
  if (content.includes(backendCheckMarker)) {
    pass(`${skillName}.md has backend check guard`);
  } else {
    fail(`${skillName}.md — listed in disabledSkills but missing "${backendCheckMarker}" section`);
  }
}
```

- [ ] **Step 3: Run validation**

Run: `node scripts/validate-plugin.js`
Expected: All checks pass (variant files exist from Task 9–10, disabled skills have guards from Task 4).

- [ ] **Step 4: Run cache tests too**

Run: `node scripts/test-resolve-cache.js`
Expected: All tests pass (including workTracking tests from Task 3).

- [ ] **Step 5: Commit**

```bash
git add scripts/validate-plugin.js
git commit -m "feat(validation): add variant pair and disabledSkills consistency checks

Check 9: verifies backlog-workflows/ has both DOC and GHA files,
and that GHA implements all DOC sub-commands.
Check 10: verifies skills in disabledSkills have Backend Check
guard sections."
```

---

### Task 13: CLAUDE.md — Document DevOps Backend Toggle

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add DevOps Backend section**

In `CLAUDE.md`, find the "## Key Patterns" section. Add a new section after it:

```markdown
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
```

- [ ] **Step 2: Run validation**

Run: `node scripts/validate-plugin.js`
Expected: All checks pass.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE.md): document devops backend toggle and variant pattern

Adds section covering workTracking context flow, disabledSkills,
managed env warnings, backlog variant routing, and the rule
to check counterpart variants on edit."
```

---

### Task 14: Final Validation Pass

**Files:** None (verification only)

- [ ] **Step 1: Run full validation suite**

```bash
node scripts/validate-plugin.js
```

Expected: All 10 checks pass, zero failures.

- [ ] **Step 2: Run cache tests**

```bash
node scripts/test-resolve-cache.js
```

Expected: All tests pass (including 6 new workTracking tests).

- [ ] **Step 3: Verify no stale references**

Search for any remaining hardcoded DOC references in modified files that should now be backend-aware:

```bash
grep -r "devops-commit WI-" commands/devops/detect-drift.md
grep -r "/wi-sync" commands/process/wrap-up.md
```

Expected: No matches for the old hardcoded patterns in the sections that were updated. (Other sections that only apply in DOC mode may still reference them — that's fine.)

- [ ] **Step 4: Verify variant pair sub-commands match**

```bash
grep "## Sub-command:" commands/process/backlog-workflows/devops-center.md | sort
grep "## Sub-command:" commands/process/backlog-workflows/github-actions.md | sort
```

Expected: GHA variant has all DOC sub-commands plus `migrate`.

- [ ] **Step 5: Commit (if any fixups were needed)**

Only if earlier steps surfaced issues that required fixes. Otherwise skip.
