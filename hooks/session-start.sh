#!/bin/bash
# claude-sf-toolkit session-start hook
# Registered via hooks/hooks.json — runs automatically at session start
#
# Responsibilities:
#   1. Auto-install required Claude Code plugins
#   2. Warn on missing recommended plugins and project config
#   3. Detect SF CLI plugin availability and export as env vars

set -euo pipefail

# Use standard plugin env vars
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
cd "$PROJECT_DIR"

WARNINGS=()
INSTALLED=()

# --- 1. Claude Code plugin dependencies ---

PLUGIN_LIST=$(claude plugin list 2>/dev/null || echo "")

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

# --- 2. Project config checks ---

if [ ! -f "config/sf-toolkit.json" ]; then
  WARNINGS+=("No config/sf-toolkit.json found — run: /setup")
fi

if [ ! -f ".sf/config.json" ]; then
  WARNINGS+=("No .sf/config.json found — run: sf config set target-org {alias}")
else
  if ! grep -q "target-org" .sf/config.json 2>/dev/null; then
    WARNINGS+=("No target-org configured — run: sf config set target-org {alias}")
  fi
  if ! grep -q "target-dev-hub" .sf/config.json 2>/dev/null; then
    WARNINGS+=("No target-dev-hub configured — run: sf config set target-dev-hub {alias}")
  fi
fi

# --- 3. SF CLI plugin detection → export as env vars ---

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  # Check each optional SF CLI plugin and export availability flags
  SF_PLUGINS=$(sf plugins 2>/dev/null || echo "")

  if echo "$SF_PLUGINS" | grep -q "lightning-flow-scanner"; then
    echo "export SF_HAS_FLOW_SCANNER=true" >> "$CLAUDE_ENV_FILE"
  else
    echo "export SF_HAS_FLOW_SCANNER=false" >> "$CLAUDE_ENV_FILE"
    WARNINGS+=("SF CLI plugin missing: lightning-flow-scanner — run: sf plugins install lightning-flow-scanner")
  fi

  if echo "$SF_PLUGINS" | grep -q "sfdx-git-delta"; then
    echo "export SF_HAS_GIT_DELTA=true" >> "$CLAUDE_ENV_FILE"
  else
    echo "export SF_HAS_GIT_DELTA=false" >> "$CLAUDE_ENV_FILE"
    WARNINGS+=("SF CLI plugin missing: sfdx-git-delta — run: sf plugins install sfdx-git-delta")
  fi

  if echo "$SF_PLUGINS" | grep -q "sfdmu"; then
    echo "export SF_HAS_SFDMU=true" >> "$CLAUDE_ENV_FILE"
  else
    echo "export SF_HAS_SFDMU=false" >> "$CLAUDE_ENV_FILE"
    WARNINGS+=("SF CLI plugin missing: sfdmu — run: sf plugins install sfdmu")
  fi
fi

# --- Output ---

if [ ${#INSTALLED[@]} -gt 0 ]; then
  echo "SF Toolkit — installed missing plugins:"
  for p in "${INSTALLED[@]}"; do
    echo "  + $p (project scope)"
  done
fi

if [ ${#WARNINGS[@]} -gt 0 ]; then
  echo "SF Toolkit warnings:"
  for w in "${WARNINGS[@]}"; do
    echo "  - $w"
  done
fi
