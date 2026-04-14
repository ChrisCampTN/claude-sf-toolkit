# Backlog Workflows — DevOps Center (YAML Backend)

> **Variant of:** `commands/process/backlog.md`
> **Backend:** `devops-center` (backlog.backend: `yaml` or `salesforce`)
> **Counterpart:** `commands/process/backlog-workflows/github-actions.md`

This file contains all sub-command implementations for the YAML/Salesforce backlog backend, used when `workTracking.backend` is `"devops-center"`.

The parent skill (`/backlog`) handles argument parsing and resolution before delegating here. All variables from the parent (subcommand, item_id, category, filters, resolved context) are available.

---

## Sub-command: `dashboard`

**Trigger:** `/backlog` or `/backlog dashboard`

1. Compute summary stats from backlog items:
   - Total active items
   - Count by status: Captured, Evaluated, Prioritized, Ready, In Progress, Done, Deferred
   - Count by category (use categories found in the data)
   - Count by priority: P1, P2, P3, P4, Unset
   - Archive count (from archive.yaml)

2. List all P1 and P2 items with: ID, title, status, effort, assigned_to, devops_wis

3. List all items with status `Captured` (needs triage): ID + title

4. List 5 most recently updated items (by `updated` date): ID, title, updated, latest note summary

5. **Grooming cadence check:** Scan all item notes for text containing "grooming" or "triage" or "prioritize". Find the most recent such note date. If no grooming note exists or the most recent is older than 14 days:

```text
---
**Grooming reminder:** It's been more than 14 days since the last backlog grooming session.
Last grooming: {date} or "Never"
Consider running `/backlog prioritize` to review and reorder items.
---
```

6. Output formatted dashboard:

```text
### Backlog Dashboard

**Total:** {n} active items | **Archived:** {n}

| Status | Count |
|--------|-------|
| Captured | {n} |
| Evaluated | {n} |
| Prioritized | {n} |
| Ready | {n} |
| In Progress | {n} |

| Category | Total | P1 | P2 | P3 | P4 | Unset |
|----------|-------|----|----|----|-----|-------|
| {category} | ... |
...

#### P1 -- Critical
| ID | Title | Status | Effort | Assigned | WIs |
|----|-------|--------|--------|----------|-----|
...

#### P2 -- High
| ID | Title | Status | Effort | Assigned | WIs |
|----|-------|--------|--------|----------|-----|
...

#### Needs Triage ({n} Captured items)
- BL-NNNN: {title}
- ...

#### Recently Updated
| ID | Title | Updated | Change |
|----|-------|---------|--------|
...

{grooming reminder if applicable}
```

---

## Sub-command: `add`

**Trigger:** `/backlog add`

1. Use AskUserQuestion to gather item details. Ask up to 4 questions:

   **Question 1:** Title and description
   - Ask: "What's the title and a brief description of this backlog item?"

   **Question 2:** Category
   - Options: Read valid categories from CLAUDE.md or `docs/platform-brief.md`. If no categories are defined, accept free-text input and suggest the user define categories in CLAUDE.md.

   **Question 3:** Tags (multiSelect)
   - Options: populated from `tags.yaml` (show all tags as options)

   **Question 4:** Sizing (if enough context)
   - Options: "Set now (I know the scope)" or "Skip (evaluate later)"
   - If "Set now": ask priority (P1-P4), effort (S/M/L/XL), complexity (Low/Med/High) in follow-up

2. Determine `source`:
   - If the user is explicitly submitting for themselves -> `team-member`
   - If Claude identified this during a session -> `claude-session`
   - If it came from a stakeholder request -> `stakeholder-request`
   - If it's a vendor evaluation -> `vendor-eval`

3. Determine `submitted_by`:
   - Resolve current user from `context.user.displayName`. If not available, fall back to `git config user.name`.

4. Set `assigned_to`:
   - If the submitter wants to self-assign (ask if sizing was provided): set to their name
   - Otherwise: null

5. Build the new item with defaults:
   - `id`: `BL-{next_id zero-padded to 4 digits}`
   - `status`: `Captured` (or `Evaluated`/`Prioritized` if sizing was provided)
   - `target_date`: null
   - `design_doc`: null
   - `devops_wis`: []
   - `blocked_by`: []
   - `related`: []
   - `created`: today's date
   - `updated`: today's date
   - `notes`: one entry with today's date, author from submitted_by or "Claude", text summarizing why this was added

6. Append to `backlog.yaml` items array, increment `next_id`, set `last_updated` to today

7. **Slack notification:** If `.env` contains `SLACK_WEBHOOK_URL`, post:

   ```
   [Backlog] BL-NNNN added: {title} (by {submitted_by}, status: {status})
   ```

   Use `curl` to POST to the webhook URL. Skip silently if webhook is not set or curl fails.

8. Report:

```text
### Added: BL-NNNN

**{title}**
Category: {category} | Status: {status} | Priority: {priority}
{suggest `/backlog evaluate BL-NNNN` if any fields are Unset}
```

### Proactive Add (Claude-initiated)

When Claude identifies an opportunity during any session (tech debt, missing test, improvement, etc.), it may add items directly without user prompting:

1. Set `source: claude-session`, `submitted_by` to current user, `status: Captured`
2. Follow the same add flow but skip AskUserQuestion — use context from the session
3. Report the addition at the end of the response
4. Still send Slack notification

---

## Sub-command: `evaluate`

**Trigger:** `/backlog evaluate BL-NNNN`

1. Find item by ID in backlog.yaml
2. If not found, report error and exit
3. Display current state of the item (all fields)
4. Assess based on description, design_doc content (read if exists), and codebase context:
   - Suggest effort (S/M/L/XL) with rationale
   - Suggest complexity (Low/Med/High) with rationale
   - Suggest priority (P1-P4) based on priority factors:
     1. User pain / requests
     2. Dependency unblocking (check `blocked_by` — does this item block others?)
     3. Compliance / risk
   - Suggest tags to add/remove
5. Present suggestions to user, ask for confirmation or overrides
6. Update item:
   - Set `effort`, `complexity`, `priority`, tags as confirmed
   - If status was `Captured`, advance to `Evaluated`
   - Set `updated` to today
   - Add note: `"Evaluated: effort={E}, complexity={C}, priority={P}. {rationale summary}"`
7. Write back to backlog.yaml

---

## Sub-command: `prioritize`

**Trigger:** `/backlog prioritize [category]`

1. Filter items to `Evaluated` + `Prioritized` status (optionally filtered by `category`)
2. Display current priority ordering as a table
3. Ask user for changes:
   - Reorder priorities (change P1/P2/P3/P4 assignments)
   - Move items between priority tiers
   - Advance items from `Evaluated` to `Prioritized`
4. Apply changes:
   - Update `priority` and `status` (-> `Prioritized`) on affected items
   - Set `updated` to today
   - Add note on each changed item: `"Reprioritized: {old} -> {new}. {reason if provided}"`
5. Add a grooming note to the first item touched: `"Backlog grooming session -- {n} items reviewed"`
6. Write back to backlog.yaml

---

## Sub-command: `graduate`

**Trigger:** `/backlog graduate BL-NNNN`

1. Find item by ID
2. **Graduation gate check** — all must pass:

   **2a. Required fields:**
   - `effort` != Unset
   - `complexity` != Unset
   - `priority` != Unset

   Note: `assigned_to` is not required for graduation. Assignment happens when work begins (Ready -> In Progress), as team capacity may shift between prioritization and execution.

   If any fail:

   ```text
   **Cannot graduate BL-NNNN** -- missing required fields:
   - effort: {current value}
   - complexity: {current value}
   - priority: {current value}

   Run `/backlog evaluate BL-NNNN` to fill in missing fields first.
   ```

   **2b. Phase 1 architecture completeness:**

   Read the item's `description`, `notes`, and `design_doc` (if set, read the file). Check whether the following architecture decisions are documented — in the item notes, the design doc, or the description:
   - [ ] **Build mode assigned:** Is one of agent-driven, human-focused, config-only, or multi-mode stated?
   - [ ] **Object model defined:** Are the objects/fields named (new or existing, relationships)?
   - [ ] **Sharing/security model:** Is it clear who needs access and which permission sets are involved?
   - [ ] **Scope boundaries:** Is it clear what's in and what's explicitly out?
   - [ ] **Dependencies:** Are blocking items or sequencing requirements identified? (Check `blocked_by` field too)

   Two additional checks apply conditionally:
   - [ ] **Integration pattern** (if the item involves external systems): API direction, auth model
   - [ ] **Multi-mode integration checkpoints** (if build mode is multi-mode): Are the handoff points between modes defined?

   **Evaluation:** Score as pass/warn/fail:
   - **Pass:** All applicable checks have answers in the docs/notes
   - **Warn:** 1-2 non-critical gaps (e.g., scope boundaries implied but not explicit). Report the gaps, ask the user whether to proceed or resolve first.
   - **Fail:** Build mode missing, or object model missing, or security model missing. These are blockers — cannot graduate without them.

   ```text
   **Phase 1 Architecture Review -- BL-NNNN**

   [checkmark] Build mode: {value found}
   [checkmark] Object model: {summary}
   [warning] Scope boundaries: not explicitly stated -- inferred from description
   [checkmark] Security: {permission sets named}
   [checkmark] Dependencies: {blocked_by list or "none"}
   [n/a] Integration pattern: no external systems
   [n/a] Multi-mode checkpoints: single build mode

   **Result:** PASS / WARN ({n} gaps -- confirm to proceed) / FAIL ({n} blockers)
   ```

   If FAIL, stop and report. The user must resolve architecture gaps (add notes, update design doc, or fill in fields) before graduating.

   **2c. Design doc check** — if `design_doc` is null and `cbc_score` >= 3 (item is buildable but has no spec):

   ```text
   **No design doc found for BL-NNNN** (CBC score: {score}).

   This item is buildable but has no spec. Options:
   1. **Run brainstorming** -- invoke `superpowers:brainstorming` to explore requirements and generate a design doc at `docs/design/{topic}/`. Recommended for CBC 3-4 items with open questions.
   2. **Skip** -- proceed with graduation. Acceptable for CBC 5 items with clear scope that don't need a formal spec (quick-wins, small config changes).
   3. **Provide path** -- if a design doc already exists elsewhere, provide the path to link it.
   ```

   Wait for the user's choice. If they choose brainstorming, invoke `superpowers:brainstorming` with the item's title and description as context. The brainstorming skill will write the spec to `docs/design/` (override its default `docs/superpowers/specs/` location). After brainstorming completes, update `design_doc` on the item and resume graduation from step 3.

3. If `devops_wis` is empty:
   - Prompt: "Create a Work Item in DevOps Center, then provide the WI number(s)."
   - Use `{context.orgs.productionAlias}` for MCP DevOps tools when creating or querying work items.
   - Accept one or more WI-NNNNNN values
   - Update `devops_wis`

4. Set `status: Ready`
5. Set `updated` to today
6. Add note: `"Graduated to Ready. WIs: {list}.{' Assigned to: ' + name + '.' if assigned_to else ''}"`
7. Write back to backlog.yaml

8. **Slack notification:**

   ```
   [Backlog] BL-NNNN graduated to Ready: {title} (WIs: {list}{', assigned: ' + name if assigned_to else ''})
   ```

   Use `curl` to POST to the webhook URL from `.env` `SLACK_WEBHOOK_URL`. Skip silently if webhook is not set or curl fails.

9. **Implementation plan offer** (for agent-driven items):

   If the item's build mode is agent-driven (or the `cbc_score` >= 4) AND a `design_doc` exists, offer to generate an implementation plan:

   ```text
   **This item is agent-buildable (CBC {score}).** Generate an implementation plan?

   1. **Yes -- generate plan** -- invoke `superpowers:writing-plans` to create a step-by-step implementation plan with TDD steps, exact file paths, and code blocks. Saves to `docs/design/{topic}/implementation-plan.md`. Recommended for L/XL effort items or multi-file changes.
   2. **Skip** -- graduate without a plan. Fine for S/M effort items with clear scope, or items where the assigned developer prefers to plan during build.
   ```

   If the user chooses to generate a plan:
   - Invoke `superpowers:writing-plans` with the design doc content as context
   - Override the default plan location from `docs/superpowers/plans/` to `docs/design/{topic}/implementation-plan.md` (co-locate with the design doc)
   - After plan is written, add a note to the item: `"Implementation plan generated: {path}"`
   - The plan can later be executed via `superpowers:executing-plans` or `superpowers:subagent-driven-development`

10. Report:

```text
### Graduated: BL-NNNN -> Ready

**{title}**
{Assigned: {name} | }WIs: {list}
{Implementation plan: {path} | No plan generated}
This item will appear in `/start-day` as "Ready to start."
```

---

## Sub-command: `search`

**Trigger:** `/backlog search {filters}`

1. Parse filters (AND logic for multiple filters):
   - `category:{value}` — exact match on category
   - `tag:{value}` — item has this tag
   - `status:{value}` — exact match on status
   - `assigned:{value}` — partial match on assigned_to
   - `priority:{value}` — exact match (P1, P2, etc.)
   - `blocked` — items with non-empty `blocked_by`
   - `no-wi` — items with empty `devops_wis`
   - `needs-design` — items with `needs-design` tag but no `design_doc`
   - Free text — searches title + description + notes text

2. Apply filters to backlog items
3. Display results as table:

```text
### Search Results: {filter summary}

**{n} items found**

| ID | Title | Category | Status | Priority | Effort | Tags |
|----|-------|----------|--------|----------|--------|------|
...
```

---

## Sub-command: `update`

**Trigger:** `/backlog update BL-NNNN`

1. Find item by ID
2. Display current state
3. Accept field updates from the user (any field except `id` and `created`):
   - If updating `tags`, validate each against `tags.yaml`
   - If adding to `devops_wis`, accept WI-NNNNNN format
   - If setting `design_doc`, verify the path exists under `docs/design/`
4. If user provides a note, add it to the notes array
5. Set `updated` to today
6. Write back to backlog.yaml
7. Report changes

---

## Sub-command: `archive`

**Trigger:** `/backlog archive`

1. Find all items with `status: Done` in backlog.yaml
2. If none found: report "Nothing to archive" and exit
3. For each Done item:
   - Change `id` from `BL-NNNN` to `BL-ANNNN` (add 'A' prefix, keep number)
   - Add note: `"Archived on {today}."`
   - Append to `archive.yaml` items array
   - Remove from `backlog.yaml` items array
4. Update `last_updated` on both files
5. Write both files

6. **Slack notification** for each archived item:

   ```
   [Backlog] BL-NNNN completed: {title} (archived)
   ```

   Use `curl` to POST to the webhook URL from `.env` `SLACK_WEBHOOK_URL`. Skip silently if webhook is not set or curl fails.

7. Report:

```text
### Archived: {n} items

| ID | Title | WIs |
|----|-------|-----|
| BL-ANNNN | ... | ... |
...
```

---

## Sub-command: `render`

**Trigger:** `/backlog render`

Generate `{context.backlog.path}/README.md` from backlog.yaml and archive.yaml.

1. Read both YAML files
2. Build the following sections:

### Executive Summary

Write 2-3 sentences for stakeholders:

- How many items are in progress and what categories they cover
- Top 3 Ready/Prioritized P1-P2 items by title
- Any blocked items
- Upcoming milestones (items with `target_date` in next 30 days)

```markdown
## Executive Summary

{2-3 sentences}

**Active workstreams:** {in-progress categories with counts}
**Next up:** {top 3 Ready/P1-P2 items}
**Upcoming milestones:** {items with target_date in next 30 days}
```

### Summary Table

```markdown
## Summary

| Metric                  | Count |
| ----------------------- | ----- |
| Total active items      | {n}   |
| Captured (needs triage) | {n}   |
| Evaluated               | {n}   |
| Prioritized             | {n}   |
| Ready                   | {n}   |
| In Progress             | {n}   |
| Archived (historical)   | {n}   |
```

### By Category Matrix

Generate a row for each category found in the data:

```markdown
### By Category

| Category     | Total | P1  | P2  | P3  | P4  | Unset |
| ------------ | ----- | --- | --- | --- | --- | ----- |
| {category}   | ...   |
...
```

### Priority Board

For each priority tier (P1 through P4, then Unset), generate a table:

```markdown
## Priority Board

### P1 -- Critical

| ID  | Title | Category | Status | Effort | Complexity | Assigned | WIs | Design Doc |
| --- | ----- | -------- | ------ | ------ | ---------- | -------- | --- | ---------- |

...
```

### Work Item Cross-Reference

Reverse lookup table: given a WI, find the backlog item.

```markdown
## Work Item Cross-Reference

| WI        | Backlog | Title | Status | Category |
| --------- | ------- | ----- | ------ | -------- |
| WI-NNNNNN | BL-NNNN | ...   | ...    | ...      |

...
```

Build by iterating all items with non-empty `devops_wis`, flattening to one row per WI. Sort by WI number.

### By Category Sections

For each category found in the data:

```markdown
## By Category

### {Category} ({n} items)

| ID  | Title | Status | Priority | Effort | Tags | Design Doc |
| --- | ----- | ------ | -------- | ------ | ---- | ---------- |

...
```

### Tags Index

```markdown
## Tags Index

| Tag        | Count | Items                 |
| ---------- | ----- | --------------------- |
| {tag}      | {n}   | BL-NNNN, BL-NNNN, ... |

...
```

### Recently Updated

Items updated in last 7 days:

```markdown
## Recently Updated (last 7 days)

| ID  | Title | Updated | Change |
| --- | ----- | ------- | ------ |

...
```

"Change" = summary of the latest note text (truncated to 60 chars).

### Footer

```markdown
---

> Auto-generated from `backlog.yaml` by `/backlog render` on {date}. Do not edit manually.
> {n} items archived. See `archive.yaml` for history.
```

3. Write `{context.backlog.path}/README.md`
4. Report: "Rendered `{context.backlog.path}/README.md` -- {n} active items, {n} archived."

---

## Git Commits

When this skill modifies files (add, evaluate, update, graduate, archive, render), use `/commit-commands:commit` to commit the changes. Do not use raw `git commit` commands.

---

## Behavior Notes

- **Read-only operations** (dashboard, search) do not modify files.
- **Write operations** (add, evaluate, update, graduate, archive, render) update YAML and set `last_updated`.
- **Tag validation:** Every tag is checked against `{context.backlog.path}/tags.yaml`. Unknown tags are rejected with the suggestion: "Unknown tag '{tag}'. Valid tags: {list}. To add a new tag, update `{context.backlog.path}/tags.yaml`."
- **Design doc validation:** When setting `design_doc`, verify the path exists under `docs/design/`. Warn if not found.
- **Grooming cadence:** Dashboard checks for grooming activity in notes. Reminder surfaces after 14 days of inactivity.
- **Slack notifications:** Best-effort — don't fail the operation if webhook is unset or curl fails. Read `SLACK_WEBHOOK_URL` from `.env` at repo root.
- **Proactive adds:** Claude may add items directly as `Captured` with `source: claude-session` during any session when it spots tech debt, missing tests, or improvement opportunities. No user prompt needed. Always report the addition.
- **Multi-WI support:** `devops_wis` is an array. A single backlog item may spawn multiple WIs. `/backlog graduate` can link multiple WIs at once. `/backlog update` can add WIs as work is decomposed.
- **Team members:** Resolve current user from `context.user.displayName`. Resolve team members from `context.team` mapping. All team members can submit items. Assign based on team roles and capacity.
- **YAML integrity:** After any write operation, the YAML file should remain parseable. If a write fails, report the error and do not leave the file in a corrupted state.
- **Categories:** Categories are project-specific. Read valid categories from CLAUDE.md or `docs/platform-brief.md`. If no categories are defined, accept any category value.
