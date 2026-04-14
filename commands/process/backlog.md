---
name: backlog
description: Upstream backlog management — add, evaluate, prioritize, graduate, search, render. YAML, Salesforce, or GitHub Issues backend.
---

# /backlog — Backlog Management

Manage the upstream backlog — add, evaluate, prioritize, graduate, search, and render. The backlog is the **single source of truth** for the full work lifecycle, from initial capture through completion. DevOps Center work items are the execution mechanism for In Progress and Done stages.

**Arguments:** $ARGUMENTS

Arguments can be:

- Empty or `dashboard` — show dashboard (default)
- `add` — interactive add via AskUserQuestion
- `evaluate BL-NNNN` — triage an item (set effort, complexity, priority, tags)
- `prioritize [category]` — review and reorder priorities
- `graduate BL-NNNN` — verify scoped + assigned, link DevOps Center WI(s), set Ready
- `search {filters}` — filter items by category, tag, status, assignee, or free text
- `update BL-NNNN` — edit fields on an existing item
- `archive` — move Done items to archive.yaml
- `render` — regenerate README.md from YAML

---

## Resolution

**Cache-first resolution:**

1. Read `.claude/sf-toolkit-cache.json` in the project root.
2. If the file exists and `_cache.expiresAt` is after the current date/time:
   - Read `.sf/config.json` — confirm `target-org` matches `orgs.devAlias` in the cached context.
   - If it matches: use the cached context (all keys except `_cache`). **Skip the agent dispatch.**
3. If the cache is missing, expired, or the org alias doesn't match: dispatch the `sf-toolkit-resolve` agent. It will resolve fresh context and update the cache.

Use the returned context for all org references, team lookups, and path resolution in subsequent steps. If `missing` contains values this skill requires, stop and instruct the developer to run `/setup`.

---

## Argument Resolution

Parse `$ARGUMENTS` once:

- `subcommand` = first word (dashboard/add/evaluate/prioritize/graduate/search/update/archive/render). Default: `dashboard`
- `item_id` = `BL-NNNN` pattern if present (for evaluate, graduate, update)
- `category` = category name after `prioritize` if present. Categories are project-specific — read CLAUDE.md or `docs/platform-brief.md` for valid category names. If no categories are defined, accept any category and suggest the user define them in CLAUDE.md.
- `filters` = remaining text after `search`

---

## Backlog Backend

Check `context.backlog.backend`:

- `"yaml"` — use file-based operations (scripts, YAML files). This is the default.
- `"salesforce"` — Salesforce backend is planned for a future release. Fall back to yaml and notify the user.

All file paths below are relative to the project root. The backlog directory is at `context.backlog.path` (default: `docs/backlog`).

---

## Key Files

| File                                          | Purpose                                        |
| --------------------------------------------- | ---------------------------------------------- |
| `{context.backlog.path}/backlog.yaml`         | Source of truth — all active backlog items     |
| `{context.backlog.path}/archive.yaml`         | Completed items (moved by archive or migrated) |
| `{context.backlog.path}/tags.yaml`            | Controlled tag list (SSOT)                     |
| `{context.backlog.path}/README.md`            | Auto-generated readable view                   |

## Scripts

Use these scripts for data manipulation instead of manually parsing/writing YAML. They handle validation, formatting, and cross-references.

For each script below, check for a local copy in `scripts/` first. If not found, copy from `${CLAUDE_PLUGIN_ROOT}/script-templates/` to `scripts/`.

| Script                        | Purpose                                  | Usage                                                                     |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| `scripts/backlog-render.js`   | Generate README.md from YAML             | `node scripts/backlog-render.js`                                          |
| `scripts/backlog-validate.js` | Validate schema, tags, cross-refs        | `node scripts/backlog-validate.js [--fix]`                                |
| `scripts/backlog-stats.js`    | Dashboard stats as JSON or table         | `node scripts/backlog-stats.js [--table]`                                 |
| `scripts/backlog-add.js`      | Add new item with auto-ID and validation | `node scripts/backlog-add.js --title "..." --category Platform [options]` |
| `scripts/backlog-search.js`   | Filter items by category/tag/status/text | `node scripts/backlog-search.js tag:lwc [--json\|--count]`                |

**When to use scripts vs. manual YAML editing:**

- **Adding items:** Always use `backlog-add.js` — handles ID generation, tag validation, YAML formatting
- **Rendering:** Always use `backlog-render.js` — produces consistent README.md
- **Dashboard/search:** Use `backlog-stats.js` and `backlog-search.js` — faster than parsing YAML in-context
- **Evaluating/updating/graduating:** Read YAML with scripts for context, but edit fields directly (scripts don't cover all status transitions yet)
- **Validation:** Run `backlog-validate.js` after any manual YAML edit

## YAML Schema Reference

```yaml
- id: "BL-NNNN"
  title: "..."
  description: "..."
  category: "{project-specific category}" # read valid categories from CLAUDE.md or docs/platform-brief.md
  status: Captured | Evaluated | Prioritized | Ready | In Progress | Done | Deferred
  priority: P1 | P2 | P3 | P4 | Unset
  effort: S | M | L | XL | Unset
  complexity: Low | Med | High | Unset
  cbc_score: 1 | 2 | 3 | 4 | 5 | null # Claude Build Confidence — see below
  tags: [] # validated against tags.yaml
  source: team-member | stakeholder-request | vendor-eval | claude-session
  submitted_by: "..."
  assigned_to: null # nullable
  target_date: null # nullable, YYYY-MM-DD
  design_doc: null # nullable, relative path under docs/design/
  devops_wis: [] # array of WI-NNNNNN strings
  blocked_by: [] # array of BL-NNNN IDs
  related: [] # array of BL-NNNN IDs (non-blocking)
  created: "YYYY-MM-DD"
  updated: "YYYY-MM-DD"
  notes:
    - date: "YYYY-MM-DD"
      author: "..."
      text: "..."
```

### Status Lifecycle

```
Captured -> Evaluated -> Prioritized -> Ready -> In Progress -> Done
   |           |            |                      |
   |           |            |                      +---> archive.yaml
   |           |            |
   +-----------+------------+---> Deferred (can re-enter at any stage)
         (small items can skip stages)
```

**Deferred** — Deliberately parked pending an external decision, dependency, or strategic evaluation. Unlike Captured (not yet triaged), Deferred items have been reviewed and intentionally held. Notes should explain the deferral reason and re-evaluation trigger.

### Claude Build Confidence (CBC) Score

Reflects confidence that an item can be efficiently built by Claude agents with minimal human intervention.

| Score | Label          | Criteria                                                                                                                 |
| ----- | -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 5     | **Ship it**    | Complete spec/design doc, agent-driven build mode, no blockers, deployable metadata, existing pattern to follow          |
| 4     | **High**       | Spec exists, agent-driven, minor gaps Claude can resolve during build (e.g., blocked by another item that's nearly done) |
| 3     | **Moderate**   | Partial spec or mixed build mode, some human decisions needed mid-build                                                  |
| 2     | **Low**        | Config-only or needs significant human input, vendor dependency, or missing spec                                         |
| 1     | **Evaluation** | Research/decision item, not a build                                                                                      |
| null  | **Not scored** | Not yet evaluated for CBC                                                                                                |

**Scoring factors (+1 each):** design doc exists, agent-driven build mode, clear scope with no open questions, no blockers/dependencies resolved, existing pattern to follow.

CBC 5 items can be dispatched as parallel background agents. CBC 4 items are next-up once their blockers clear. CBC 1-3 need human input before build.

### Multi-WI Rollup Rules

- **In Progress** if ANY WI is in progress
- **Done** only when ALL WIs are promoted/closed
- `/wi-sync` checks each WI and updates backlog status accordingly

---

## Step 1 — Load Data

Read the following files:

1. `{context.backlog.path}/backlog.yaml` — parse YAML, extract `items`, `next_id`, `last_updated`
2. `{context.backlog.path}/tags.yaml` — parse YAML, extract `tags` array for validation
3. `{context.backlog.path}/archive.yaml` — parse YAML, extract `items` (for archive count in dashboard)

If `backlog.yaml` does not exist, report error and exit:

```text
**Error:** `{context.backlog.path}/backlog.yaml` not found. Initialize the backlog first.
```

---

## Step 2 — Route to Sub-command

Based on `subcommand`, execute the corresponding section below.

---

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
