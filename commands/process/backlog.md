---
name: backlog
description: Upstream backlog management — add, evaluate, graduate, search, render. GitHub Issues backend.
---

# /backlog — Backlog Management

Manage the upstream backlog — add, evaluate, graduate, search, and render. The backlog is the **single source of truth** for the full work lifecycle, from initial capture through completion. GitHub Issues are the execution mechanism for In Progress and Done stages.

**Arguments:** $ARGUMENTS

Arguments can be:

- Empty or `dashboard` — show dashboard (default)
- `add` — interactive add via AskUserQuestion
- `evaluate #NN` — triage an item (set effort, complexity, priority, tags). Prioritization is folded into evaluation — there is no separate `prioritize` subcommand.
- `graduate #NN` — verify scoped + assigned, activate issue, set In Progress
- `search {filters}` — filter items by category, tag, status, assignee, or free text
- `update #NN` — edit fields on an existing item
- `archive #NN` — close the issue with the `archived` label
- `render` — regenerate README.md from GitHub Issues

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

- `subcommand` = first word (dashboard/add/evaluate/graduate/search/update/archive/render). Default: `dashboard`
- `item_id` = `#NN` issue number if present (for evaluate, graduate, update, archive)
- `filters` = remaining text after `search`

---

## Backlog Backend

GitHub Issues is the only backlog backend (as of v2.0.0 — the YAML and Salesforce backends were removed). Items live as Issues in `{workTracking.issueRepo}` from the resolved context, with fields encoded as labels (`status:*`, `cat:*`, `effort:*`, `complexity:*`, `cbc:*`, `source:*`, `P*`, `tag:*`).

The auto-generated readable view is written to `{context.backlog.path}/README.md` (default backlog directory: `docs/backlog`), relative to the project root.

## Scripts

Use these scripts for data access and creation instead of hand-rolling `gh` queries. They shell out to `gh issue list/create` and map label-encoded fields to a consistent internal item shape.

For each script below, check for a local copy in `scripts/` first. If not found, copy from `${CLAUDE_PLUGIN_ROOT}/script-templates/` to `scripts/`.

All scripts require `--repo {workTracking.issueRepo}` (from the resolved context).

| Script                        | Purpose                                  | Usage                                                                                    |
| ----------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `scripts/backlog-render.js`   | Generate README.md from Issues           | `node scripts/backlog-render.js --repo OWNER/REPO [--output PATH] [--project-name NAME]` |
| `scripts/backlog-stats.js`    | Dashboard stats as JSON or table         | `node scripts/backlog-stats.js --repo OWNER/REPO [--table]`                               |
| `scripts/backlog-add.js`      | Create a new item as a GitHub Issue      | `node scripts/backlog-add.js --repo OWNER/REPO --title "..." --category Platform [options]` |
| `scripts/backlog-search.js`   | Filter items by category/tag/status/text | `node scripts/backlog-search.js --repo OWNER/REPO tag:lwc [--json\|--count]`              |

**When to use scripts vs. direct `gh` commands:**

- **Adding items:** Always use `backlog-add.js` — handles label slugging, source/complexity label normalization, and issue body templating
- **Rendering:** Always use `backlog-render.js` — produces consistent README.md
- **Dashboard/search:** Use `backlog-stats.js` and `backlog-search.js` — faster than parsing JSON in-context
- **Evaluating/updating/graduating:** Read data with scripts for context, but edit labels/body via `gh issue edit` (scripts don't cover all status transitions yet)

## Status Lifecycle

```
Captured -> Evaluated -> Ready -> In Progress -> Done
   |           |                    |
   |           |                    +---> archived (`archived` label, closed)
   |           |
   +-----------+---> Deferred (can re-enter at any stage)
         (small items can skip stages)
```

Priority (P1-P4) is set during evaluation — there is no separate Prioritized status (the `status:prioritized` label was retired).

**Deferred** — Deliberately parked pending an external decision, dependency, or strategic evaluation. Unlike Captured (not yet triaged), Deferred items have been reviewed and intentionally held. Notes should explain the deferral reason and re-evaluation trigger.

## Claude Build Confidence (CBC) Score

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

---

## Route to Sub-command

Read and follow the workflow in `${CLAUDE_PLUGIN_ROOT}/commands/process/backlog-workflows/github-actions.md`, executing the section matching `subcommand`.

Pass through these resolved values: `subcommand`, `item_id`, `filters`, and the full resolved context.
