# Deploy Code Scanning & Plugin Dependency Management

**Date:** 2026-04-08
**Status:** Approved
**Scope:** claude-sf-toolkit plugin

## Summary

Three enhancements to the sf-toolkit plugin:

1. **Code quality scanning in `/deploy-changed`** — scan Apex, Flows, LWC, and Visualforce files before deployment using ApexGuru, Code Analyzer, and lightning-flow-scanner
2. **Auto-install plugin dependencies at session start** — `session-start.sh` hook installs missing required plugins (`superpowers`, `commit-commands`) at project scope
3. **Project-scope default** — all plugin install references across the repo use `--scope project`

---

## Change 1: Code Quality Scanning in `/deploy-changed`

### Location

New **Step 4B — "Scan Deployed Code"** in `commands/devops/deploy-changed.md`, inserted after metadata validation (Step 3) and before building the deploy command (Step 4).

### Trigger

Classify files in the deploy set by type. If any scannable types are present, run the relevant analysis. If no scannable files exist, skip entirely with no output.

### Analysis Matrix

| Files in deploy set | Tool | Tier | Notes |
|---|---|---|---|
| `.cls` (Apex) | `scan_apex_class_for_antipatterns` (ApexGuru) | **Prominent** | One call per class. Org-aware severity when ApexGuru is enabled on the target org. |
| `.cls` (Apex) | `run_code_analyzer` with selector `Apex:Recommended` | Informational | Batch up to 10 files per call. PMD best practices + security rules. |
| `.flow-meta.xml` (Flows) | `sf flow scan` with `--files` listing each changed flow path | **Prominent** | Missing fault paths, DML in loops, hardcoded IDs via lightning-flow-scanner. If `--files` is not supported, pass `--directory` pointed at the parent `flows/` directory and filter results to only changed flows. |
| `.js`, `.html` (LWC/Aura) | `run_code_analyzer` with selector `(JavaScript,HTML):Recommended` | Informational | JavaScript best practices and security. |
| `.page`, `.component` (VF) | `run_code_analyzer` with selector `Visualforce:Security` | Informational | XSS and security scanning only. |

### Tiered Display

- **Prominent** findings get their own named section in the Step 5 deploy preview:
  - "Performance Risks" for ApexGuru findings — listed with severity and recommendation
  - "Flow Issues" for flow scanner findings — listed with rule name and affected flow
- **Informational** findings appear in a collapsible "Code Analysis" section, grouped by severity. Lower visual weight.

### Non-Blocking

Neither tier blocks the deploy. The existing Step 5 preview-and-confirm workflow handles the go/no-go decision. The user sees all findings and decides whether to proceed.

### Parallelism

- ApexGuru: sequential (one MCP call per class)
- Code Analyzer: can run in parallel with flow scan (independent tools, different files)
- Flow scan: can run in parallel with Code Analyzer

### Preview Integration

The Step 5 deploy preview table gains new sections when findings exist:

```
## Deploy Plan

Target org: {alias}
Mode: Deploy
Changed files: 12
Deployable files: 8

### Performance Risks (ApexGuru)
| Severity | Class | Finding | Recommendation |
|---|---|---|---|
| High | AccountService | SOQL query without WHERE clause (line 45) | Add filtering criteria |
| Medium | BatchProcessor | Schema.getGlobalDescribe() in loop (line 12) | Cache describe result |

### Flow Issues
| Rule | Flow | Description |
|---|---|---|
| MissingFaultPath | Handle_Payment | Fault path missing on Create Records element |
| DMLInLoop | Process_Batch | DML statement inside loop element |

### Code Analysis (informational)
| Severity | File | Rule | Message |
|---|---|---|---|
| High | AccountService.cls | ApexCRUDViolation | CRUD/FLS check missing |
| Moderate | paymentForm.js | no-unused-vars | Unused variable 'temp' |

### Files to Deploy
| # | Type | Path |
|---|---|---|
| 1 | ApexClass | force-app/.../classes/AccountService.cls |
| ... | ... | ... |

Deploy these 8 files to DevOpsCC?
```

### Skip Condition

If no `.cls`, `.flow-meta.xml`, `.js`, `.html`, `.page`, or `.component` files are in the deploy set (e.g., deploying only custom fields or permission sets), Step 4B is skipped entirely with no output.

### Tool Dependencies

- `scan_apex_class_for_antipatterns` — requires Salesforce DX MCP server (already configured)
- `run_code_analyzer` — requires Salesforce DX MCP server (already configured)
- `sf flow scan` — requires `lightning-flow-scanner` CLI plugin (checked by `/setup` and preflight)

---

## Change 2: Auto-Install Plugin Dependencies at Session Start

### Location

`hooks/session-start.sh`

### Current Behavior

Checks for `superpowers`, `commit-commands`, `code-review` via `claude plugin list`. Prints a warning if any are missing. No action taken.

### New Behavior

**Required plugins** (auto-install if missing):
- `superpowers`
- `commit-commands`

**Removed:**
- `code-review` — dropped entirely. Generic GitHub PR reviewer; not valuable for SF/DevOps Center workflow.

**Recommended plugins** (warn only, no auto-install):
- `context7`
- `skill-creator`

### Install Logic

```bash
# 1. Capture plugin list once
PLUGIN_LIST=$(claude plugin list 2>/dev/null)

# 2. Required plugins — auto-install at project scope
for plugin in superpowers commit-commands; do
  if ! echo "$PLUGIN_LIST" | grep -q "$plugin"; then
    claude plugin install "$plugin" --scope project 2>/dev/null
    echo "  Installed $plugin (project scope)"
  fi
done

# 3. Recommended plugins — warn only
for plugin in context7 skill-creator; do
  if ! echo "$PLUGIN_LIST" | grep -q "$plugin"; then
    echo "  Optional: claude plugin install $plugin --scope project"
  fi
done
```

### Key Details

- All installs use `--scope project` — never global
- Silent when all required plugins are already present (no noise on clean sessions)
- If an install fails (network, registry issue), warn and continue — never block the session
- The hook already runs at session start; no new hook needed

### Cascading Updates

- **`commands/setup.md` Step 10** — update required list to `superpowers`, `commit-commands` only. Remove `code-review`. All install commands use `--scope project`.
- **`scripts/check-dependencies.sh`** — update required/recommended lists to match. All install suggestion messages use `--scope project`.

---

## Change 3: Project-Scope Default for All Plugin Guidance

### Principle

Every place in the plugin repo that references `claude plugin install` uses `--scope project`. No exceptions. If someone copies a command from any file in this repo, it installs at project scope.

### Files Affected

| File | Change |
|---|---|
| `hooks/session-start.sh` | Covered by Change 2 — auto-installs use `--scope project` |
| `commands/setup.md` Step 10 | Update install commands to include `--scope project` |
| `scripts/check-dependencies.sh` | Update warning messages to include `--scope project` |
| `commands/help.md` | Update any plugin install references to include `--scope project` |
| `README.md` | Update getting-started / install instructions to use `--scope project` |

### Rationale

Project-scoped plugins avoid cross-project contamination in the shared `~/.claude/plugins/installed_plugins.json` registry. Claude Code currently loads all project entries from the global registry regardless of the active project, causing duplicate plugin loading when multiple projects share the same plugins at different scopes.

---

## Files Modified (Summary)

| File | Changes |
|---|---|
| `commands/devops/deploy-changed.md` | Add Step 4B (code quality scanning) and update Step 5 preview format |
| `hooks/session-start.sh` | Auto-install required plugins, remove code-review, add --scope project |
| `commands/setup.md` | Update Step 10 plugin lists and install commands |
| `scripts/check-dependencies.sh` | Update required/recommended lists and install commands |
| `commands/help.md` | Update any plugin install references |
| `README.md` | Update install instructions |

No new files created. No new scripts or templates needed — all scanning uses existing MCP tools and CLI plugins.