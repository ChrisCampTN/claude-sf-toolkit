# GitHub Actions Backend Design

**Date:** 2026-04-13
**Status:** Approved (design review)
**Scope:** Add per-project DevOps backend toggle (SF DevOps Center vs GitHub Actions) to claude-sf-toolkit, including work-item replacement with GitHub Issues, backlog absorption, and resolver adapter layer.

---

## Context

The plugin currently assumes SF DevOps Center (DOC) as the sole DevOps backend. WPL-Salesforce is transitioning to a GitHub Actions CI/CD pipeline where:

- PR merge to `main` triggers automatic staging deployment via GHA workflows
- Production deploys are manual `workflow_dispatch` triggers
- GitHub Issues replace Work Items as the work-tracking primitive
- Feature branches follow `feature/issue-{id}-{slug}` naming (not `WI-NNNNNN`)
- `backlog.yaml` is deprecated in favor of Issues-only tracking

The plugin must support both backends simultaneously (per-project config), since other consuming projects remain on DevOps Center.

## Design Decisions

| Decision | Resolution |
|---|---|
| Config toggle | `devops.backend: "devops-center" \| "github-actions"` in `config/sf-toolkit.json` |
| Work tracking | GitHub Issues replace both WIs and backlog items in GHA mode |
| Backlog | `/backlog` rewrites to manage Issues via `gh` CLI. Issue body template includes Dependencies section |
| `/deploy-changed` | Active in GHA mode for dev sandbox only. Warns if targeting a GHA-managed env |
| `/devops-commit` | Disabled in GHA mode. Standard `git commit` + `gh pr create` replaces it |
| `/wi-sync` | Disabled in GHA mode. `start-day`/`wrap-up` query Issues live |
| MEMORY.md | No Active Work Items table in GHA mode. Fresh `gh issue list` on every call |
| Resolver agent | Skips DOC SOQL queries in GHA mode. Populates `workTracking` context instead |
| Issue dependencies | Body template `## Dependencies` section + `blocked` label. Skill parses/writes dependency section |
| Architecture | Resolver adapter layer (Approach C) for simple branching; variant files (Approach B) only for `backlog` |

## Architecture

### Strategy: Resolver Adapter + Single Variant Pair

The resolver agent abstracts the backend via a `workTracking` context block in the cache. Skills read `workTracking` fields instead of hardcoding DOC-specific commands or GHA-specific commands. This handles all cases where the difference is "swap the query/command."

For `backlog` — where the workflow logic is fundamentally different (YAML manipulation vs Issue management) — the parent skill delegates to backend-specific workflow files. This is the only variant pair in the system.

**Change categories:**
- **Disabled in GHA mode (2):** `devops-commit`, `wi-sync`
- **Minor inline conditional (4):** `deploy-changed`, `detect-drift`, `wrap-up`, `start-day`
- **Agent conditional (2):** `sf-toolkit-resolve`, `start-day-active-work`
- **Deep variant (1):** `backlog` (parent + 2 workflow files)
- **Unchanged (11+):** `help`, `setup`, `claude-review`, all documentation skills, `test-flows`, `package-audit`, `validate-build`, `skill-preflight`, `lookback`

## Config Schema

New `devops` key in `config/sf-toolkit.json`:

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
      "managed": ["staging", "production"]
    }
  },
  "cache": {
    "ttlHours": 24
  }
}
```

- **`devops.backend`**: `"devops-center"` (default) or `"github-actions"`
- **`devops.environments.local`**: Envs that `/deploy-changed` can push to directly
- **`devops.environments.managed`**: Envs handled by GHA (deploy-changed warns/blocks)
- **Implicit backlog coupling**: When `devops.backend == "github-actions"`, `backlog.backend` is treated as `"github-issues"` at runtime even if the config file still says `"yaml"`. To opt out (e.g., keep YAML backlog with GHA deploys), explicitly set `backlog.backend: "yaml"` — the resolver checks for an explicit override before applying the default
- **Backwards-compatible**: Projects without a `devops` key behave as `"devops-center"` with no changes

## Resolver & Cache Changes

### GHA mode cache

```json
{
  "pluginVersion": "x.y.z",
  "resolvedAt": "2026-04-13T...",
  "orgs": { "productionAlias": "WPL-Prod", "devAlias": "WPL-Dev" },
  "apiVersion": "63.0",
  "team": {},
  "devopsCenter": null,
  "workTracking": {
    "backend": "github-actions",
    "issueRepo": "ChrisCampTN/WPL-Salesforce",
    "branchPattern": "feature/issue-{id}-{slug}",
    "idPrefix": "#",
    "idPattern": "#\\d+",
    "listActiveCmd": "gh issue list --repo {repo} --state open --assignee @me --json number,title,state,labels,assignees",
    "listAllCmd": "gh issue list --repo {repo} --state all --json number,title,state,labels,assignees --limit 100",
    "viewItemCmd": "gh issue view {id} --repo {repo} --json number,title,body,state,labels,assignees,comments",
    "createItemCmd": "gh issue create --repo {repo} --title '{title}' --body-file {bodyFile}",
    "deployManagedEnvs": ["staging", "production"],
    "deployLocalEnvs": ["dev"],
    "disabledSkills": ["devops-commit", "wi-sync"]
  }
}
```

### DOC mode cache (augmented)

```json
{
  "devopsCenter": {
    "projectId": "...",
    "pipelineId": "...",
    "environments": { "staging": "...", "production": "..." }
  },
  "workTracking": {
    "backend": "devops-center",
    "branchPattern": "WI-{id}",
    "idPrefix": "WI-",
    "idPattern": "WI-\\d{6}",
    "listActiveCmd": null,
    "deployManagedEnvs": [],
    "deployLocalEnvs": ["dev", "staging", "production"],
    "disabledSkills": []
  }
}
```

### Resolver behavior changes

- **GHA mode**: Skips `DevopsProject`, `DevopsPipeline`, `DevopsEnvironment` SOQL queries. Sets `devopsCenter: null`. Derives `issueRepo` from `git remote get-url origin` by parsing the `owner/repo` segment from either HTTPS (`https://github.com/owner/repo.git`) or SSH (`git@github.com:owner/repo.git`) URLs. Populates `workTracking` from config `devops` block.
- **DOC mode**: Existing behavior unchanged. Adds thin `workTracking` wrapper for uniform field access.
- **Cache invalidation**: Existing triggers (TTL, plugin version, org alias) plus new trigger: `devops.backend` value changed since last resolution.

## Skill Impact Details

### Disabled skills

**`devops-commit.md`** and **`wi-sync.md`** — Add 3-line disable check at top of Resolution section:

```
If context.workTracking.disabledSkills includes this skill name:
  Show: "Not available in GitHub Actions mode. Use [alternative]."
  Stop.
```

- `devops-commit` alternative: "`git commit && git push && gh pr create --title '...' --body 'Fixes #NN'`"
- `wi-sync` alternative: "Issue status is queried live from GitHub. No sync needed."

Full DOC behavior untouched.

### Inline conditional skills

**`deploy-changed.md`** — After computing target org alias, cross-reference against `workTracking.deployManagedEnvs`. If match: warn that the env is GHA-managed and suggest opening a PR instead. Dev sandbox deploys proceed normally.

**`detect-drift.md`** — When drift is found, remediation suggestion varies: DOC mode suggests `/devops-commit WI-NNNNNN`, GHA mode suggests "create an Issue and open a PR."

**`wrap-up.md`** — DOC mode: calls `/wi-sync --dry-run` as today. GHA mode: runs `workTracking.listActiveCmd` via bash, shows current Issue status inline, skips sync step entirely.

**`start-day.md`** — Dispatches `start-day-active-work` agent as today. No direct changes; the agent handles backend branching.

### Agent changes

**`sf-toolkit-resolve.md`** — Reads `devops.backend` from `config/sf-toolkit.json`. Branches query strategy as described in Resolver section above.

**`start-day-active-work.md`** — Reads `workTracking.backend` from cache:
- DOC: queries `mcp__Salesforce-DX__list_devops_center_work_items` as today
- GHA: runs `gh issue list` via bash, parses JSON output for open Issues with `status:in-progress` label, merges with MEMORY.md context
- Output format identical either way (active items table with status/assignee)

### Backlog variant

**`backlog.md`** (parent) retains: skill description, resolution section, sub-command routing, output formatting.

Delegates workflow to:
- `commands/process/backlog-workflows/devops-center.md` — Current YAML behavior
- `commands/process/backlog-workflows/github-actions.md` — Issues-based behavior

Routing: parent reads `workTracking.backend` (or `backlog.backend` if explicitly overridden) and includes the appropriate workflow file.

## Backlog GitHub Actions Variant

### Data model mapping

| YAML field | GitHub Issues equivalent |
|---|---|
| `id: BL-NNNN` | Issue `#NN` (native numbering) |
| `title` | Issue title |
| `description` | Issue body (first section) |
| `category` | Label: `cat:{category}` |
| `status` | Issue state (open/closed) + label: `status:captured`, `status:groomed`, `status:prioritized`, `status:in-progress`, `status:deferred` |
| `priority` | Label: `P1`, `P2`, `P3`, `P4` |
| `effort` | Label: `effort:S`, `effort:M`, `effort:L`, `effort:XL` |
| `complexity` | Label: `complexity:low`, `complexity:med`, `complexity:high` |
| `cbc_score` | Body section: `## Claude Build Confidence: {score}/5` |
| `tags[]` | Additional labels (project-specific) |
| `source` | Label: `source:team`, `source:stakeholder`, `source:vendor`, `source:claude` |
| `submitted_by` | Issue author (automatic) |
| `assigned_to` | Issue assignee |
| `target_date` | Milestone or body section: `## Target: YYYY-MM-DD` |
| `devops_wis[]` | N/A (the Issue IS the work item) |
| `blocked_by[]` | Body section `## Dependencies` + `blocked` label |
| `related[]` | Body section `## Dependencies` |
| `notes[]` | Issue comments (timestamped, attributed automatically) |
| `design_doc` | Body section: `## Design: {path}` |

### Issue body template

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

Labels carry queryable metadata (priority, effort, complexity, status, category). Body carries narrative and structured data that doesn't fit labels.

### Sub-command mapping

| Sub-command | GHA behavior |
|---|---|
| `/backlog add` | `gh issue create` with body template + labels for category, priority, effort. Prompts interactively. |
| `/backlog search` | `gh issue list` with label filters. Full-text via `gh search issues`. |
| `/backlog render` | Queries all Issues, formats `docs/backlog/README.md`. Same output format as YAML variant. |
| `/backlog evaluate` | `gh issue view` to read Issue, runs CBC scoring, updates body CBC section + effort/complexity labels via `gh issue edit`. |
| `/backlog prioritize` | Lists open Issues by priority labels, presents reordering. Updates labels via `gh issue edit`. |
| `/backlog graduate` | Issue already IS the work item. "Graduate" becomes "activate": set `status:in-progress` label, assign, create feature branch `feature/issue-{id}-{slug}`. |

### Label bootstrapping

`/setup` in GHA mode creates the full label taxonomy via `gh label create` (idempotent, skips existing):
- Priority: `P1`, `P2`, `P3`, `P4`
- Effort: `effort:S`, `effort:M`, `effort:L`, `effort:XL`
- Complexity: `complexity:low`, `complexity:med`, `complexity:high`
- Status: `status:captured`, `status:groomed`, `status:prioritized`, `status:in-progress`, `status:deferred`
- Category: `cat:{name}` for each entry in `config.backlog.categories`
- Source: `source:team`, `source:stakeholder`, `source:vendor`, `source:claude`
- Dependency: `blocked`

## Validation & Testing

### `validate-plugin.js` additions

1. **Variant pair completeness** — If `backlog-workflows/github-actions.md` exists, `backlog-workflows/devops-center.md` must exist (and vice versa). Both must implement the same sub-command set (parsed from `## /backlog {sub-command}` headers).

2. **`disabledSkills` consistency** — Skills listed in `workTracking.disabledSkills` (GHA cache shape) must have a matching disable guard in their Resolution section. Prevents listing a skill as disabled without the actual check.

3. **`workTracking` cache schema** — `test-resolve-cache.js` gets new test cases for both backend shapes. Validates required fields (`backend`, `branchPattern`, `idPattern`, `deployManagedEnvs`, `deployLocalEnvs`, `disabledSkills`) are present regardless of backend.

### `/setup` changes

New question during project bootstrapping:
> "Which DevOps backend does this project use?" — SF DevOps Center (default) / GitHub Actions

Based on answer:
- Writes `devops` block to `config/sf-toolkit.json`
- GHA mode: runs label bootstrap, sets `backlog.backend: "github-issues"`
- DOC mode: existing behavior unchanged

### Manual testing

- Switch `devops.backend` in config, delete cache, run each affected skill to verify correct behavior
- Verify disabled skills show helpful messages (not errors)
- Verify `deploy-changed` warns on managed envs and allows local envs
- Verify `start-day` and `wrap-up` query Issues live in GHA mode

## Migration Path (DOC to GHA)

For projects transitioning mid-flight (like WPL-Salesforce):

1. **Config update** — Add `devops` block to `config/sf-toolkit.json` (manually or re-run `/setup`)
2. **Label bootstrap** — `/setup` creates label taxonomy, or manual `gh label create` batch
3. **Backlog migration (optional)** — `/backlog migrate` sub-command:
   - Reads `docs/backlog/backlog.yaml`
   - For each non-archived item: creates GitHub Issue with body template + labels
   - Maps `devops_wis` references to Issue body notes ("Migrated from WI-000042")
   - Renames `backlog.yaml` to `backlog.yaml.archive`
4. **MEMORY.md cleanup** — Remove Active Work Items table (live queries replace it)
5. **Cache invalidation** — Delete `.claude/sf-toolkit-cache.json` to force re-resolution

Steps 3-4 are optional. A project can start fresh with Issues and let YAML age out.

## CLAUDE.md Additions

New section documenting:
- The `devops.backend` toggle and its effect on skill behavior
- The variant pattern (parent skill delegates to `backlog-workflows/{backend}.md`)
- How `workTracking` context flows: config → resolver → cache → skills
- Rule: when editing a variant file, check the counterpart for matching changes
- Default behavior for projects without the `devops` key (backwards-compatible DOC mode)

## Out of Scope

- **Jira / Jenkins / other backends** — The architecture supports adding new backends (new resolver profile + new backlog workflow variant), but only DOC and GHA are implemented in this iteration
- **GitHub Projects v2 integration** — Labels and Issue state are sufficient for status tracking. Projects board management is manual via GitHub UI
- **GHA workflow file generation** — The plugin does not create `.github/workflows/*.yml`. Those are project-specific and authored separately (see WPL-Salesforce design docs)
- **PR review/approval automation** — The plugin does not manage PR approvals or branch protection rules
