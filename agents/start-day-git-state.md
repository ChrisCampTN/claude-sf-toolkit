---
description: Gather git repository state, check for org drift, and report uncommitted changes and WI branch status
---

# Start-Day: Git State Agent

## Your Job

Gather the current git repository state and check for org metadata drift. Report recent commits, uncommitted changes, local vs origin status, WI branches, and any drifted components assigned to the current user.

## Reference Files

- Read `docs/platform-brief.md` for current initiative phases and key areas
- Read `.claude/memory/MEMORY.md` Active Work Items table for WI branch cross-reference
- Read `docs/backlog/backlog.yaml` for assignment-aware drift filtering (match `assigned_to` and `devops_wis`)

## Inputs

- Today's date: {{todayDate}}
- Current user: {{currentUserName}}
- Quick mode: {{quickMode}}
- Dev org alias: {{devOrgAlias}}

## Steps

### 1. Git State Check

Run these commands and capture output:

```bash
git log --oneline -10
```

```bash
git status -u --short
```

```bash
git rev-list --count origin/main..main 2>/dev/null || echo "0"
```

```bash
git branch -r 2>/dev/null | grep 'origin/WI-' || echo "none"
```

### 2. Org Drift Check

If {{quickMode}} is "true", skip this section and report: `[SKIP] Org drift check skipped (--quick).`

Otherwise, run a lightweight drift check:

**Primary approach (source-tracked sandbox):**

```bash
sf project retrieve preview --target-org {{devOrgAlias}}
```

**Fallback (if retrieve preview fails):**

```bash
sf data query --query "SELECT DeveloperName, LastModifiedDate, LastModifiedBy.Name FROM FlowDefinitionView WHERE IsActive = true AND ManageableState = 'unmanaged' ORDER BY LastModifiedDate DESC" --target-org {{devOrgAlias}} --json > /tmp/drift-start-day.json
```

Check for local `scripts/drift-compare.js`. If not found, the skill should generate it from the plugin's `script-templates/drift-compare.js`.

```bash
node scripts/drift-compare.js --input /tmp/drift-start-day.json --type flows --since 7d --summary
```

If both approaches fail (auth expired, org unreachable), report: `[SKIP] Org drift check — {error message}`

### 3. Assignment-Aware Drift Filtering

After retrieving the drift list, read `docs/backlog/backlog.yaml` and cross-reference drifted components against the current user's assigned WIs:

1. Find backlog items where `assigned_to` matches {{currentUserName}}
2. Get the `devops_wis` from those items
3. Categorize drift into:
   - **Your drift** — components belonging to WIs assigned to you (actionable)
   - **Other drift** — components from other team members' WIs (summary count only)

If {{currentUserName}} could not be resolved, show all drift without filtering.

## Output Format

Return your findings in this exact markdown structure:

```text
### Git State

**Last commit:** {hash} — {message} ({relative date})
**Uncommitted changes:** {n} files ({categories}) or "Clean"
**Local vs origin:** {n} commits ahead or "Up to date"
**WI branches on origin:** {n} branches

{If uncommitted changes exist:}
**Note:** Uncommitted changes detected — may be leftover from a prior session that didn't /wrap-up.

### Org Drift ({{devOrgAlias}})

{If quickMode:}
[SKIP] Org drift check skipped (--quick).

{If drift found for current user:}
**Your drifted components:** {n} (from WIs assigned to you)
- {MetadataType}: {ComponentName} (WI-NNNNNN)
- ...

**Other drift:** {n} components from other team members' WIs — do not retrieve without coordinating

**Action:** Run `/detect-drift` to retrieve your changes, or `sf project retrieve start --target-org {{devOrgAlias}} --metadata {specific types}` for targeted retrieval.

{If no drift for current user:}
No org drift on your assigned WIs — local source is current.

{If drift check failed:}
[SKIP] Org drift check — {error}
```
