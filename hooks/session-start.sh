#!/bin/bash
# claude-sf-toolkit session-start hook
# Checks for required plugins and project configuration
# Warns but does not block

WARNINGS=()

# Check required plugins
for plugin in superpowers commit-commands code-review; do
  if ! claude plugin list 2>/dev/null | grep -q "$plugin"; then
    WARNINGS+=("Missing required plugin: $plugin — run: claude plugin add $plugin")
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

# Print warnings
if [ ${#WARNINGS[@]} -gt 0 ]; then
  echo "SF Toolkit warnings:"
  for w in "${WARNINGS[@]}"; do
    echo "  - $w"
  done
fi
