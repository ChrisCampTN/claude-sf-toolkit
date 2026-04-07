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

echo ""
echo "Results: $PASS passed, $WARN warnings, $FAIL failed"
