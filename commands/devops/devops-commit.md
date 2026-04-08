---
name: devops-commit
description: Commit SF metadata changes to a DevOps Center work item branch — primary mode for uncommitted changes, recovery mode for cherry-picks
---

# /devops-commit — DevOps Center Work Item Commit

Commit SF metadata changes directly to a DevOps Center work item branch. SF metadata (`{context.metadataPath}/../..` tree) must NEVER be committed to main — it belongs exclusively on WI branches, which DevOps Center promotes through the pipeline and merges back to main after promotion.

**Primary mode:** Stage and commit uncommitted metadata changes directly to the WI branch.
**Recovery mode:** Cherry-pick a commit that was accidentally made on main onto the WI branch.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- `WI-NNNNNN` — work item number (required). Commits uncommitted metadata changes to the WI branch.
- `WI-NNNNNN --cherry-pick abc1234` — recovery mode: cherry-pick an existing commit onto the WI branch
- `WI-NNNNNN --cherry-pick abc1234 def5678` — recovery: multiple commit SHAs (cherry-picked in order)
- `WI-NNNNNN --cherry-pick HEAD~3..HEAD` — recovery: commit range
- `--target-org {alias}` — override the deploy target org. Defaults to the user's SF CLI default org (`sf config get target-org`). Only affects the Step 7 deploy; WI queries always target `{context.orgs.productionAlias}`.
- Empty — list uncommitted metadata changes and open work items, then ask the user to pick

---

## Resolution

Dispatch the `sf-toolkit-resolve` agent. Use the returned context for all
org references, team lookups, and path resolution in subsequent steps.
If `missing` contains values this skill requires, stop and instruct the
developer to run `/setup`.

---

## Step 0 — Preflight

Run the `git` and `org` suites from `/skill-preflight` logic inline (do NOT invoke the skill — just run the same checks directly to avoid circular dependencies):

### Git State Checks

1. **Staged changes check:** Run `git status`. If there are staged but uncommitted changes, **stop** — report the staged files and ask the user to commit or stash first.
2. **Unstaged metadata changes:** In primary mode, these are the files to commit. List them. If none exist, **stop** — nothing to commit (unless `--cherry-pick` mode).
3. **Current branch:** Record the current branch name (we'll return here after). If already on the target `WI-*` branch, note it — no branch switch needed.

### Org Connectivity (lightweight)

4. **Production org check:** Verify connectivity to `{context.orgs.productionAlias}` (needed to query work items):
   ```
   sf data query --query "SELECT Id FROM Organization LIMIT 1" --target-org {context.orgs.productionAlias} --json
   ```
   If unreachable, warn that work item validation will be skipped but the commit can still proceed.

If any **stop**-level issue is found, report it and exit. For **warn**-level issues, report and ask whether to proceed.

---

## Step 1 — Resolve Arguments

### If no arguments provided:

Show the user context to help them decide:

1. **Uncommitted metadata changes:**

   ```bash
   git status --short -- '{context.metadataPath}/../..'
   ```

2. **Open work items in DevOps Center** (if `{context.orgs.productionAlias}` is connected):

   Read `SF_USER_ID` from `.env` at repo root. If present, filter to the current user's assigned WIs:

   ```soql
   SELECT Name, sf_devops__Subject__c, sf_devops__State__c, sf_devops__Assigned_To__r.Name, CreatedDate
   FROM sf_devops__Work_Item__c
   WHERE sf_devops__Project__c = '{context.devopsCenter.projectId}'
   AND sf_devops__Promoted__c = false
   AND sf_devops__Assigned_To__c = '{context.user.sfUserId}'
   ORDER BY CreatedDate DESC
   LIMIT 15
   ```

   If `SF_USER_ID` is not set in `.env`, omit the `sf_devops__Assigned_To__c` filter to show all open WIs.

3. Ask the user: "Which work item should these changes go to?"

### If arguments provided:

Parse the WI number and optional `--cherry-pick` flag with commit reference(s).

**Validate the WI number format:** Must match `WI-\d{6}` (e.g., `WI-000054`).

**If `--cherry-pick` mode:** Validate commit SHAs — for each SHA, verify it exists:

```bash
git cat-file -t {sha}
```

If a range is specified (e.g., `HEAD~3..HEAD`), expand it to individual SHAs:

```bash
git rev-list --reverse {range}
```

---

## Step 2 — Validate the Work Item

If `{context.orgs.productionAlias}` is connected, verify the work item exists and is in a valid state:

```soql
SELECT Id, Name, sf_devops__Subject__c, sf_devops__Status__c
FROM sf_devops__Work_Item__c
WHERE Name = '{WI-NNNNNN}'
LIMIT 1
```

- If not found: **warn** — the work item may not exist yet or the name may be wrong. Ask to proceed anyway or abort.
- If found with status `Completed`: **warn** — committing against a completed work item is unusual. Ask to confirm.
- If found with valid status: **proceed** — display the subject for confirmation.

---

## Step 3 — Verify the WI Branch Exists

The branch must have been created by DevOps Center (via "Check Out" in the UI). Check if it exists:

```bash
git fetch origin
git branch -r --list "origin/{WI-NNNNNN}"
```

- If the branch exists: **proceed**
- If the branch does NOT exist: **stop** — display this message:

  ```
  Branch origin/{WI-NNNNNN} not found.

  DevOps Center must create this branch — creating it manually in git
  won't create the required sf_devops__Branch__c record.

  Action required:
  1. Open DevOps Center in {context.orgs.productionAlias}
  2. Find work item {WI-NNNNNN}
  3. Click "Check Out" to create the branch
  4. Re-run: /devops-commit {WI-NNNNNN} {commit refs}
  ```

---

## Step 4 — Preview

Before executing, show the user exactly what will happen:

### Primary mode (direct commit):

```text
## Commit Plan

Work item: {WI-NNNNNN} — {subject from Step 2, or "unverified" if org unavailable}
Target branch: {WI-NNNNNN}
Return to: {current branch}

Files to commit ({n}):
  {list of metadata files from git status}

Commit message: [docs-only] WI-{number}: {description}
  (or non-docs-only message if changes include logic)
```

### Recovery mode (`--cherry-pick`):

```text
## Cherry-Pick Plan (recovery)

Work item: {WI-NNNNNN} — {subject from Step 2, or "unverified" if org unavailable}
Target branch: {WI-NNNNNN}
Return to: {current branch}

Commits to cherry-pick ({n}):
  {sha1} {commit message}
  {sha2} {commit message}

Files affected:
  {list of files from git diff --name-only for the commit(s)}
```

Ask: "Proceed?" Wait for confirmation.

---

## Step 5 — Execute

Run the following sequence. If any step fails, abort and report — do NOT continue with partial state.

### 5A — Stash all uncommitted changes

```bash
git stash push -m "devops-commit: auto-stash before switching to {WI-NNNNNN}"
```

Record that a stash was created (we'll pop it in Step 6).

### 5B — Check out the WI branch

```bash
git checkout {WI-NNNNNN}
```

If this fails because the branch only exists on remote:

```bash
git checkout -b {WI-NNNNNN} origin/{WI-NNNNNN}
```

### 5C — Apply changes

**Primary mode:** Restore only the metadata files from the stash onto the WI branch, stage, and commit:

```bash
git checkout stash@{0} -- {context.metadataPath}/path/to/file1 {context.metadataPath}/path/to/file2 ...
git add {context.metadataPath}/
git commit -m "{commit message}"
```

**IMPORTANT:** Only restore metadata files from the stash. Do NOT restore docs, skills, or other repo-only files — those belong on main.

**Recovery mode (`--cherry-pick`):** Cherry-pick the specified commit(s):

```bash
git cherry-pick {sha1} {sha2} ...
```

**If cherry-pick conflicts:**

1. Report the conflicting files
2. **Do NOT auto-resolve** — conflicts in metadata can be subtle
3. Offer two options:
   - **Abort:** `git cherry-pick --abort` -> return to original branch -> report failure
   - **Resolve:** Let the user resolve manually, then continue with `git cherry-pick --continue`

### 5C.1 — Auto-Update Flow XML Descriptions (if flow files are staged)

After staging the metadata files (Step 5C) and **before committing**, check whether any `.flow-meta.xml` files are in the staged changes:

```bash
git diff --cached --name-only -- '{context.metadataPath}/flows/*.flow-meta.xml'
```

If flow XML files are found:

1. **Extract flow names** from the staged file paths (strip directory and `.flow-meta.xml` suffix).
2. **Run the description sync script** (local project script first, plugin template fallback):

   ```bash
   if [ -f scripts/flow-description-sync.js ]; then
     node scripts/flow-description-sync.js {FlowName1} {FlowName2} ...
   fi
   ```

   If neither the local script nor a plugin `script-templates/flow-description-sync.js` exists, **skip this sub-step** silently — flow description sync is optional.

   The script:
   - Looks up each flow's category by scanning `docs/flows/` directories
   - Reads the Purpose from the existing markdown doc (if one exists)
   - Builds a description: `"{purpose sentence} Docs: {github url}"`
   - Updates the top-level `<description>` element in the XML (255 char max)
   - Skips flows that have no documentation (logs them)

3. **Re-stage the updated XMLs** (the script modifies files in-place):

   ```bash
   git add {context.metadataPath}/flows/{FlowName}.flow-meta.xml ...
   ```

4. **Report what was updated** in the commit preview:

   ```text
   Flow XML descriptions auto-synced ({n} flows):
     - {FlowName} — "{first 60 chars of description}..."
   Skipped (no doc found): {list, if any}
   ```

**Important constraints:**

- Only updates the `<description>` element — never modifies flow logic, triggers, or variables
- Only runs for flows that have existing documentation in `docs/flows/`
- Flows without docs are skipped silently (they'll get docs from a future `/doc-flows` run)
- The markdown docs on `main` are NOT modified — they continue to reflect the production-current state
- After the WI is promoted and merged to main, the post-commit hook queues the flows to `.pending-docs.txt` for the next `/doc-flows` run to update the markdown docs

**Why this works safely:** The description is metadata-only — it doesn't affect flow execution. Including it in the same WI commit means the description deploys to production alongside the logic change, eliminating the need for a separate description-only deployment.

### 5D — Push to remote

```bash
git push origin {WI-NNNNNN}
```

If push fails (e.g., remote rejected), report the error. Do NOT force-push.

---

## Step 6 — Return to Original Branch

```bash
git checkout {original branch from Step 0}
```

### 6A — Pop stash (if created in Step 5A)

```bash
git stash pop
```

If the stash pop conflicts, warn the user — their working changes may need manual resolution.

**After stash pop:** The metadata files that were committed to the WI branch will show as "already up to date" in the working directory (since stash had them modified and now the working directory matches). The non-metadata files (docs, etc.) will be restored as unstaged changes on main — where they belong.

---

## Step 7 — Deploy to Target Org and Verify

After the WI branch is pushed, the metadata must also be deployed to the target org for DevOps Center to pick it up for promotion. Resolve the target org:

1. If `--target-org {alias}` was provided, use that.
2. Otherwise, read the user's SF CLI default: `sf config get target-org --json`
3. If no default is set, ask the user which org to deploy to.

```bash
sf project deploy start --target-org {target-org} --source-dir {file1} --source-dir {file2} ...
```

**Production safety gate (Tier 2):** If `{target-org}` is `{context.orgs.productionAlias}` or contains "prod"/"production", display a prominent warning and ask for explicit confirmation before deploying.

Confirm with the user before deploying. If the deploy fails on any file, report the failure and offer to retry the failing files individually.

### 7A — Post-Deploy Verification (mandatory)

Apply `superpowers:verification-before-completion` discipline: **no success claims without fresh evidence.**

After the deploy command returns, run verification to confirm the metadata actually landed in the target org. Do NOT report success based solely on the deploy command's exit code — deploy commands can report success without actually deploying.

1. **Run `sf project deploy report`** to confirm the deployment:

   ```bash
   sf project deploy report --use-most-recent --target-org {target-org} --json
   ```

2. **Spot-check at least one deployed component** in the org. Choose the verification method based on what was deployed:

   | Metadata type   | Verification command                                                                                                                                |
   | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Custom fields   | `sf sobject describe --sobject {ObjectName} --target-org {target-org}` — confirm the field appears                                                  |
   | Flows           | `sf data query --query "SELECT Id, Status FROM Flow WHERE Definition.DeveloperName = '{FlowName}' AND Status = 'Active'" --target-org {target-org}` |
   | Permission sets | `sf data query --query "SELECT Id FROM PermissionSet WHERE Name = '{PermSetName}'" --target-org {target-org}`                                       |
   | Other types     | Use the most appropriate describe/query for that type                                                                                               |

3. **Evidence gate:** Only proceed to Step 8 if verification confirms the deploy landed. If verification fails or contradicts the deploy command's reported success:
   - Report the discrepancy with evidence (command output)
   - Do NOT claim success
   - Suggest: re-deploy with `--metadata` flag instead of `--source-dir`, or deploy individual files

---

## Step 8 — Report Results

```text
## /devops-commit Complete

Work item: {WI-NNNNNN} — {subject}
Mode: {Primary commit / Cherry-pick recovery}
Files committed: {n}
Branch {WI-NNNNNN} pushed to origin.
Deployed to {target-org}: {Yes / No / Partial}
Current branch: {original branch}
```

### 8A — Offer MCP-Driven Promotion (optional)

After a successful commit + push + deploy, offer to start the promotion pipeline via MCP instead of requiring the user to open the DevOps Center UI:

```text
Ready to promote? Options:
1. **Check for conflicts first:** detect merge conflicts before promoting
2. **Promote now:** create a pull request and promote through the pipeline
3. **Skip:** promote manually in DevOps Center later
```

If the user chooses option 1:

```
detect_devops_center_merge_conflict(workItemName: "{WI-NNNNNN}")
```

If conflicts are detected, report them and ask whether to attempt resolution or abort. If clean:

```
promote_devops_center_work_item(workItemName: "{WI-NNNNNN}")
```

If the user chooses option 2 (promote directly):

```
promote_devops_center_work_item(workItemName: "{WI-NNNNNN}")
```

**Important:** Promotion targets Staging, not Production. The Staging → Production promotion is always human-initiated in DevOps Center (bundled promotions).

If the user chooses option 3, show manual next steps:

```text
Next steps:
1. Open DevOps Center in {context.orgs.productionAlias}
2. Work item {WI-NNNNNN} should show the new commit(s)
3. Promote through the pipeline when ready
```

---

## Error Recovery

If the skill fails mid-execution, always attempt to return to a clean state:

1. If on the WI branch and cherry-pick failed: `git cherry-pick --abort`
2. Return to original branch: `git checkout {original branch}`
3. Pop stash if one was created: `git stash pop`
4. Report exactly where it failed and what state the repo is in

Never leave the user on the WI branch or with an uncommitted cherry-pick.
