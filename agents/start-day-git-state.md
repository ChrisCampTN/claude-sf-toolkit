---
name: start-day-git-state
description: Use this agent when /start-day needs git repository state and org drift analysis. Runs in parallel with the active-work and external-context agents. Typical triggers include a daily briefing that must report uncommitted changes and branch status, and a drift check comparing org metadata against local source. See "When to invoke" in the agent body for worked scenarios.
model: inherit
color: blue
tools: ["Read", "Bash", "Grep", "Glob", "mcp__Salesforce-DX__run_soql_query"]
---

# Start-Day: Git State Agent

## When to invoke

- **A daily briefing needs repository state.** Uncommitted changes, the current branch, and feature-branch status, so the plan reflects where the working tree actually is.
- **Org metadata may have drifted from source.** Runs git commands and optionally queries the org, using `drift-compare.js` when it is available.

## Your Job

Gather the current git repository state and check for org metadata drift. Report recent commits, uncommitted changes, local vs origin status, feature branches, and any drifted components assigned to the current user.

## Reference Files

- Read `docs/platform-brief.md` for current initiative phases and key areas
- Read `.claude/memory/MEMORY.md` Active Work Items table for feature branch cross-reference
- Query `gh issue list --state open --assignee @me --json number,title` for assignment-aware drift filtering

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
git branch -r 2>/dev/null | grep 'origin/feature/' || echo "none"
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

Check for local `scripts/drift-compare.js`. If not found, copy from `${CLAUDE_PLUGIN_ROOT}/script-templates/drift-compare.js`.

```bash
node scripts/drift-compare.js --input /tmp/drift-start-day.json --type flows --since 7d --summary
```

If both approaches fail (auth expired, org unreachable), report: `[SKIP] Org drift check — {error message}`

### 3. Assignment-Aware Drift Filtering

After retrieving the drift list, query the current user's assigned open Issues (`gh issue list --state open --assignee {{currentUserName}} --json number,title`) and cross-reference drifted components:

1. Match drifted components to the metadata named in those Issues (title, body, linked design doc)
2. Categorize drift into:
   - **Your drift** — components belonging to Issues assigned to you (actionable)
   - **Other drift** — components from other team members' Issues (summary count only)

If {{currentUserName}} could not be resolved, show all drift without filtering.

## Output Format

Return your findings in this exact markdown structure:

```text
### Git State

**Last commit:** {hash} — {message} ({relative date})
**Uncommitted changes:** {n} files ({categories}) or "Clean"
**Local vs origin:** {n} commits ahead or "Up to date"
**Feature branches on origin:** {n} branches

{If uncommitted changes exist:}
**Note:** Uncommitted changes detected — may be leftover from a prior session that didn't /wrap-up.

### Org Drift ({{devOrgAlias}})

{If quickMode:}
[SKIP] Org drift check skipped (--quick).

{If drift found for current user:}
**Your drifted components:** {n} (from Issues assigned to you)
- {MetadataType}: {ComponentName} (#NN)
- ...

**Other drift:** {n} components from other team members' Issues — do not retrieve without coordinating

**Action:** Run `/detect-drift` to retrieve your changes, or `sf project retrieve start --target-org {{devOrgAlias}} --metadata {specific types}` for targeted retrieval.

{If no drift for current user:}
No org drift on your assigned Issues — local source is current.

{If drift check failed:}
[SKIP] Org drift check — {error}
```
