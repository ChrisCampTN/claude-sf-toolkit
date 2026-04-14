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

   **Evaluation:** Score as pass/warn/fail:
   - **Pass:** All applicable checks have answers in the docs/notes
   - **Warn:** 1-2 non-critical gaps (e.g., scope boundaries implied but not explicit). Report the gaps, ask the user whether to proceed or resolve first.
   - **Fail:** Build mode missing, or object model missing, or security model missing. These are blockers — cannot graduate without them.

   ```text
   **Phase 1 Architecture Review — #{number}**

   [checkmark] Build mode: {value found}
   [checkmark] Object model: {summary}
   [warning] Scope boundaries: not explicitly stated — inferred from description
   [checkmark] Security: {permission sets named}
   [checkmark] Dependencies: {blocked_by list or "none"}
   [n/a] Integration pattern: no external systems
   [n/a] Multi-mode checkpoints: single build mode

   **Result:** PASS / WARN ({n} gaps — confirm to proceed) / FAIL ({n} blockers)
   ```

   If FAIL, stop and report.

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

7. **Implementation plan offer:**

   If build mode is agent-driven (or CBC score >= 4) AND a design doc exists, offer:

   ```text
   **This item is agent-buildable (CBC {score}).** Generate an implementation plan?

   1. **Yes — generate plan** — invoke `superpowers:writing-plans`
   2. **Skip** — graduate without a plan
   ```

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
