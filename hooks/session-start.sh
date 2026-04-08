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