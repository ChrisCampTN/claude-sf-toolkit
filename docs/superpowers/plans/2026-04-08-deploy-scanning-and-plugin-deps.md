# Deploy Scanning & Plugin Dependency Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pre-deploy code quality scanning (ApexGuru, Code Analyzer, flow scanner) to `/deploy-changed`, auto-install required plugin dependencies at session start, and standardize all install commands to `--scope project`.

**Architecture:** Six existing files modified — no new files. Scanning uses MCP tools (`scan_apex_class_for_antipatterns`, `run_code_analyzer`) and the `sf flow scan` CLI plugin already available in the toolchain. Plugin dependency management is handled in the session-start hook with `claude plugin install --scope project`.

**Tech Stack:** Bash (hooks), Markdown (skill definitions), Salesforce DX MCP tools, lightning-flow-scanner CLI plugin.

**Spec:** `docs/specs/2026-04-08-deploy-scanning-and-plugin-deps-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `hooks/session-start.sh` | Modify | Auto-install required plugins, remove code-review, add recommended warnings |
| `scripts/check-dependencies.sh` | Modify | Update required/recommended lists, --scope project |
| `commands/setup.md` | Modify | Update Step 10 plugin lists and install commands |
| `commands/help.md` | Modify | Update first-run topic install commands |
| `README.md` | Modify | Update Required Claude Code Plugins section |
| `commands/devops/deploy-changed.md` | Modify | Add Step 4B code quality scanning, update Step 5 preview format |

---

### Task 1: Update `hooks/session-start.sh` — Auto-Install Plugin Dependencies

**Files:**
- Modify: `hooks/session-start.sh` (lines 1–41, full file rewrite)

- [ ] **Step 1: Replace the plugin check block**

Replace the current file contents with:

```bash
#!/bin/bash
# claude-sf-toolkit session-start hook
# Auto-installs required plugins at project scope
# Warns on missing recommended plugins and project config

WARNINGS=()
INSTALLED=()

# Capture plugin list once
PLUGIN_LIST=$(claude plugin list 2>/dev/null)

# Required plugins — auto-install at project scope if missing
for plugin in superpowers commit-commands; do
  if ! echo "$PLUGIN_LIST" | grep -q "$plugin"; then
    if claude plugin install "$plugin" --scope project 2>/dev/null; then
      INSTALLED+=("$plugin")
    else
      WARNINGS+=("Failed to install required plugin: $plugin — run: claude plugin install $plugin --scope project")
    fi
  fi
done

# Recommended plugins — warn only
for plugin in context7 skill-creator; do
  if ! echo "$PLUGIN_LIST" | grep -q "$plugin"; then
    WARNINGS+=("Optional: claude plugin install $plugin --scope project")
  fi
done

# Check for sf-toolkit.json
if [ ! -f "config/sf-toolkit.json" ]; then
  WARNINGS+=("No config/sf-toolkit.json found — run: /setup")
fi

# Check for .sf/config.json
if [ ! -f ".sf/config.json" ]; then
  WARNINGS+=("No .sf/config.json found — run: sf config set target-org {alias}")
else
  # Check target-org is set
  if ! grep -q "target-org" .sf/config.json 2>/dev/null; then
    WARNINGS+=("No target-org configured — run: sf config set target-org {alias}")
  fi
  # Check target-dev-hub is set
  if ! grep -q "target-dev-hub" .sf/config.json 2>/dev/null; then
    WARNINGS+=("No target-dev-hub configured — run: sf config set target-dev-hub {alias}")
  fi
fi

# Print installed plugins
if [ ${#INSTALLED[@]} -gt 0 ]; then
  echo "SF Toolkit — installed missing plugins:"
  for p in "${INSTALLED[@]}"; do
    echo "  + $p (project scope)"
  done
fi

# Print warnings
if [ ${#WARNINGS[@]} -gt 0 ]; then
  echo "SF Toolkit warnings:"
  for w in "${WARNINGS[@]}"; do
    echo "  - $w"
  done
fi
```

- [ ] **Step 2: Verify the script is valid bash**

Run: `bash -n hooks/session-start.sh`
Expected: No output (no syntax errors)

- [ ] **Step 3: Commit**

```bash
git add hooks/session-start.sh
git commit -m "feat: auto-install required plugins at project scope in session-start hook

Remove code-review from required plugins. Auto-install superpowers and
commit-commands with --scope project if missing. Warn-only for recommended
plugins (context7, skill-creator)."
```

---

### Task 2: Update `scripts/check-dependencies.sh` — Plugin Lists and Scope

**Files:**
- Modify: `scripts/check-dependencies.sh` (lines 1–49, full file rewrite)

- [ ] **Step 1: Replace the file contents**

```bash
#!/bin/bash
# claude-sf-toolkit dependency checker
# Returns structured pass/warn/fail output for /setup --check

PASS=0
WARN=0
FAIL=0

check() {
  local label="$1"
  local condition="$2"
  local fix="$3"

  if eval "$condition"; then
    echo "  ✓ $label"
    ((PASS++))
  else
    echo "  ⚠ $label — $fix"
    ((WARN++))
  fi
}

echo "SF Toolkit Health Check:"
echo ""

# Project files
check "sfdx-project.json found" "[ -f sfdx-project.json ]" "Not an SFDX project"
check ".sf/config.json found" "[ -f .sf/config.json ]" "Run: sf config set target-org {alias}"
check "config/sf-toolkit.json found" "[ -f config/sf-toolkit.json ]" "Run: /setup"

# Env
check ".env exists" "[ -f .env ]" "Run: /setup to create"
if [ -f ".env" ]; then
  check ".env has SF_USER_ID" "grep -q SF_USER_ID .env" "Run: /setup to auto-resolve"
fi

# Directories
for dir in docs/backlog docs/flows docs/components docs/design config scripts .claude/memory; do
  check "$dir/ exists" "[ -d $dir ]" "Run: /setup to scaffold"
done

# Templates
check "docs/platform-brief.md exists" "[ -f docs/platform-brief.md ]" "Run: /setup to generate"
check "CLAUDE.md exists" "[ -f CLAUDE.md ]" "Run: /setup to scaffold"
check "README.md exists" "[ -f README.md ]" "Run: /setup to scaffold"

# Claude Code plugins
echo ""
echo "Claude Code Plugins:"
PLUGIN_LIST=$(claude plugin list 2>/dev/null)
for plugin in superpowers commit-commands; do
  check "$plugin installed" "echo \"\$PLUGIN_LIST\" | grep -q \"$plugin\"" "Run: claude plugin install $plugin --scope project"
done
echo ""
echo "Recommended (optional):"
for plugin in context7 skill-creator; do
  check "$plugin installed" "echo \"\$PLUGIN_LIST\" | grep -q \"$plugin\"" "Run: claude plugin install $plugin --scope project"
done

# SF CLI plugins
echo ""
echo "SF CLI Plugins:"
SF_PLUGINS=$(sf plugins 2>/dev/null)
for plugin in lightning-flow-scanner sfdx-git-delta sfdmu; do
  check "$plugin installed" "echo \"\$SF_PLUGINS\" | grep -q \"$plugin\"" "Run: sf plugins install $plugin"
done

echo ""
echo "Results: $PASS passed, $WARN warnings, $FAIL failed"
```

- [ ] **Step 2: Verify the script is valid bash**

Run: `bash -n scripts/check-dependencies.sh`
Expected: No output (no syntax errors)

- [ ] **Step 3: Commit**

```bash
git add scripts/check-dependencies.sh
git commit -m "feat: update dependency checker — remove code-review, add --scope project, add SF CLI plugin checks"
```

---

### Task 3: Update `commands/setup.md` — Step 10 Plugin Lists

**Files:**
- Modify: `commands/setup.md` (lines 185–194)

- [ ] **Step 1: Replace Step 10 content**

Find lines 185–194 (the Step 10 block) and replace with:

```markdown
Check for required Claude Code plugins:

```bash
claude plugin list 2>/dev/null
```

Required: `superpowers`, `commit-commands`
Recommended: `context7`, `skill-creator`

For any missing required plugins, install them:

```bash
claude plugin install {plugin} --scope project
```

Report which are installed, which were auto-installed, and which recommended plugins are missing with install commands.
```

- [ ] **Step 2: Commit**

```bash
git add commands/setup.md
git commit -m "fix: update setup Step 10 — remove code-review, add --scope project"
```

---

### Task 4: Update `commands/help.md` — First-Run Topic Install Commands

**Files:**
- Modify: `commands/help.md` (lines 129–136, the first-run topic Claude Code plugin section)

- [ ] **Step 1: Replace the first-run plugin install block**

Find lines 129–136:

```
5. Install required SF CLI plugins:
   sf plugins install lightning-flow-scanner
   sf plugins install sfdx-git-delta
   sf plugins install sfdmu

6. Install required Claude Code plugins:
   claude plugin add superpowers
   claude plugin add commit-commands
   claude plugin add code-review
```

Replace with:

```
5. Install required SF CLI plugins:
   sf plugins install lightning-flow-scanner
   sf plugins install sfdx-git-delta
   sf plugins install sfdmu

6. Install required Claude Code plugins:
   claude plugin install superpowers --scope project
   claude plugin install commit-commands --scope project
```

- [ ] **Step 2: Commit**

```bash
git add commands/help.md
git commit -m "fix: update help first-run topic — remove code-review, use --scope project"
```

---

### Task 5: Update `README.md` — Install Instructions

**Files:**
- Modify: `README.md` (lines 19–25, Required Claude Code Plugins section)

- [ ] **Step 1: Replace the Required Claude Code Plugins block**

Find lines 19–25:

```markdown
### Required Claude Code Plugins

```bash
claude plugin add superpowers
claude plugin add commit-commands
claude plugin add code-review
```
```

Replace with:

```markdown
### Required Claude Code Plugins

```bash
claude plugin install superpowers --scope project
claude plugin install commit-commands --scope project
```
```

- [ ] **Step 2: Update the Installation section**

Find line 31:

```bash
claude plugin add https://github.com/ChrisCampTN/claude-sf-toolkit
```

Replace with:

```bash
claude plugin install https://github.com/ChrisCampTN/claude-sf-toolkit --scope project
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "fix: update README install commands — remove code-review, use --scope project"
```

---

### Task 6: Add Step 4B Code Quality Scanning to `deploy-changed.md`

**Files:**
- Modify: `commands/devops/deploy-changed.md` (insert after line 133, before current Step 4)

This is the largest change. The new Step 4B goes between the current Step 3 (Metadata Validation) and current Step 4 (Build Deploy Command). Current Steps 4–7 become Steps 5–8. The step numbering throughout the file shifts by one.

- [ ] **Step 1: Insert the new Step 4B block after the current Step 3**

After line 133 (the end of the Step 3 section, `If errors are found, offer to auto-fix and re-run validation before continuing.`), insert:

```markdown

---

## Step 4 — Code Quality Scanning

Scan deployable code files for performance risks, security issues, and best-practice violations. This step runs only when the deploy set contains scannable file types. If no scannable files exist, skip this step entirely with no output.

### Classify files in deploy set

Group deployable files by type:

| Extension | Type | Scan tool |
|---|---|---|
| `.cls` | Apex | ApexGuru + Code Analyzer |
| `.flow-meta.xml` | Flow | lightning-flow-scanner |
| `.js`, `.html` | LWC/Aura | Code Analyzer |
| `.page`, `.component` | Visualforce | Code Analyzer |

If none of these extensions are in the deploy set, skip to Step 5.

### Apex scanning (if `.cls` files present)

**ApexGuru (prominent tier):** Run `scan_apex_class_for_antipatterns` on each Apex class in the deploy set. Use the resolved `--target-org` as the `usernameOrAlias` parameter so severity reflects actual runtime metrics when ApexGuru is enabled on the org. Collect findings into a "Performance Risks" list with severity, class name, finding description, and recommendation.

```
For each .cls file in deploy set:
  scan_apex_class_for_antipatterns(
    className: "{class name without extension}",
    apexFilePath: "{absolute path to .cls file}",
    directory: "{project root}",
    usernameOrAlias: "{target-org alias}"
  )
```

**Code Analyzer (informational tier):** Run `run_code_analyzer` with selector `Apex:Recommended` on all Apex files in the deploy set (batch up to 10 files per call). If more than 10 Apex files, split into multiple calls. After completion, use `query_code_analyzer_results` to extract findings. Collect into a "Code Analysis" list grouped by severity.

```
run_code_analyzer(
  target: ["{absolute path 1}", "{absolute path 2}", ...],
  selector: "Apex:Recommended"
)
```

### Flow scanning (if `.flow-meta.xml` files present)

**lightning-flow-scanner (prominent tier):** Run `sf flow scan` targeting the changed flow files. If the `--files` flag is supported, pass each changed flow path directly. Otherwise, run `sf flow scan --directory {metadataPath}/flows` and filter the output to only include flows in the deploy set.

```bash
sf flow scan --files "{path1},{path2},..."
```

Or fallback:

```bash
sf flow scan --directory {context.metadataPath}/flows
# Then filter results to only flows in the deploy set
```

Collect findings into a "Flow Issues" list with rule name, flow name, and description.

### LWC/Aura scanning (if `.js` or `.html` files present)

**Code Analyzer (informational tier):** Run `run_code_analyzer` with selector `(JavaScript,HTML):Recommended` on all JS/HTML files in the deploy set.

```
run_code_analyzer(
  target: ["{absolute path 1}", "{absolute path 2}", ...],
  selector: "(JavaScript,HTML):Recommended"
)
```

### Visualforce scanning (if `.page` or `.component` files present)

**Code Analyzer (informational tier):** Run `run_code_analyzer` with selector `Visualforce:Security` on all VF files in the deploy set.

```
run_code_analyzer(
  target: ["{absolute path 1}", "{absolute path 2}", ...],
  selector: "Visualforce:Security"
)
```

### Parallelism

ApexGuru calls run sequentially (one MCP call per class). Code Analyzer and flow scan can run in parallel since they target different files and use independent tools. Structure execution as:

1. Start ApexGuru scanning (sequential per class)
2. In parallel: start Code Analyzer batch + flow scan
3. Collect all results before proceeding to Step 5

### No findings

If all scans complete with zero findings, report briefly: "Code quality scan: no issues found" and proceed to Step 5.
```

- [ ] **Step 2: Renumber Steps 4–7 to Steps 5–8**

In the remainder of `deploy-changed.md`, update all step references:

- "Step 4 — Build Deploy Command" → "Step 5 — Build Deploy Command"
- "Step 5 — Preview and Confirm" → "Step 6 — Preview and Confirm"
- "Step 6 — Execute Deploy" → "Step 7 — Execute Deploy"
- "Step 7 — Post-Deploy Verification" → "Step 8 — Post-Deploy Verification"

Also update any cross-references within steps (e.g., "proceed to Step 5" → "proceed to Step 6").

- [ ] **Step 3: Update the Preview section (now Step 6) to include scan results**

In the Preview section (previously Step 5, now Step 6), add the scan result sections to the preview template. After the existing "Mode" line and before the "Files to Deploy" table, insert:

```markdown
If Step 4 produced findings, include these sections in the preview:

### Performance Risks (ApexGuru)

Show only if ApexGuru found issues. Table format:

| Severity | Class | Finding | Recommendation |
|---|---|---|---|
| {severity} | {className} | {finding description} | {recommendation} |

### Flow Issues

Show only if flow scanner found issues. Table format:

| Rule | Flow | Description |
|---|---|---|
| {ruleName} | {flowName} | {description} |

### Code Analysis (informational)

Show only if Code Analyzer found issues across any file type. Table format:

| Severity | File | Rule | Message |
|---|---|---|---|
| {severity} | {fileName} | {ruleName} | {message} |
```

- [ ] **Step 4: Update the post-deploy summary (now Step 8) next-steps reference**

In the post-deploy verification section, the next-steps block references `/commit-commands:commit`. Verify this reference is still correct after renumbering. No content change needed — just confirm the step number in the summary text says "Step 8" if it self-references.

- [ ] **Step 5: Commit**

```bash
git add commands/devops/deploy-changed.md
git commit -m "feat: add pre-deploy code quality scanning (ApexGuru, Code Analyzer, flow scanner)

New Step 4 scans Apex (ApexGuru + Code Analyzer), Flows (lightning-flow-scanner),
LWC/Aura, and Visualforce before deployment. Prominent tier for performance risks
and flow issues, informational tier for general code analysis. Non-blocking —
findings shown in deploy preview for user decision."
```

---

### Task 7: Bump Plugin Version

**Files:**
- Modify: `package.json` (line 3)

- [ ] **Step 1: Update version**

Change `"version": "1.1.0"` to `"version": "1.2.0"`.

- [ ] **Step 2: Commit and push**

```bash
git add package.json
git commit -m "chore: bump version to 1.2.0 — deploy scanning + plugin dependency management"
git push origin main
```

---

## Execution Order

Tasks 1–5 are independent (different files, no dependencies between them) and can be executed in parallel. Task 6 is the largest and can also run in parallel with 1–5. Task 7 (version bump) must run last after all other tasks are committed.

```
┌──────────────────────────────────────────────┐
│  Parallel: Tasks 1, 2, 3, 4, 5, 6           │
│  (independent files, no cross-dependencies)  │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
              Task 7: Version bump
              (after all commits)
```