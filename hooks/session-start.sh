#!/bin/bash
# claude-sf-toolkit session-start hook
# Registered via hooks/hooks.json — runs automatically at session start
#
# Responsibilities:
#   1. Auto-install required Claude Code plugins
#   2. Warn on missing recommended plugins and project config
#   3. Detect SF CLI plugin availability and export as env vars
#   4. Warn when the installed version is behind, or the marketplace clone is stale

set -euo pipefail

# Use standard plugin env vars
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
cd "$PROJECT_DIR"

WARNINGS=()
INSTALLED=()
CURRENT_VERSION=""
NEWER="no"

# --- 0. Plugin version notification ---

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
if [ -n "$PLUGIN_ROOT" ] && [ -f "$PLUGIN_ROOT/package.json" ]; then
  CURRENT_VERSION=$(node -e "console.log(require('$PLUGIN_ROOT/package.json').version)" 2>/dev/null || echo "")
  LAST_VERSION_FILE="$PROJECT_DIR/.claude/sf-toolkit-last-version"

  if [ -n "$CURRENT_VERSION" ]; then
    LAST_VERSION=""
    if [ -f "$LAST_VERSION_FILE" ]; then
      LAST_VERSION=$(cat "$LAST_VERSION_FILE" 2>/dev/null || echo "")
    fi

    if [ "$CURRENT_VERSION" != "$LAST_VERSION" ]; then
      mkdir -p "$(dirname "$LAST_VERSION_FILE")"
      echo "$CURRENT_VERSION" > "$LAST_VERSION_FILE"
      if [ -n "$LAST_VERSION" ]; then
        echo "SF Toolkit updated: v${LAST_VERSION} -> v${CURRENT_VERSION} — run /help or see docs/plugin-changelog.md"
      fi
    fi
  fi
fi

# --- 0b. Upstream staleness ---
#
# The block above compares the running version against the version that ran here
# last time. Both are local, so it reports a change only AFTER an upgrade and can
# never say that one is available. These two checks close that gap without a
# network call.
#
# Signal B is the one that matters most: on 2026-09-02 this project was found
# running v1.8.0 against a v2.0.0 upstream for roughly two months, because the
# marketplace clone had not been refreshed since 2026-04-23. Installed and clone
# versions AGREED at 1.8.0, so a version comparison alone stays silent — the age
# of the clone is the only local evidence that upstream was never consulted.

MARKETPLACE_STALE_DAYS=14
KNOWN_MARKETPLACES="${HOME}/.claude/plugins/known_marketplaces.json"

if [ -n "${CURRENT_VERSION:-}" ] && [ -f "$KNOWN_MARKETPLACES" ] && command -v node >/dev/null 2>&1; then
  # Emit "<available>|<clone_age_days>", or nothing if either is undeterminable.
  MARKET_INFO=$(node -e '
    const fs = require("fs");
    try {
      const km = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const entry = km["claude-sf-toolkit"];
      if (!entry) process.exit(0);
      let available = "";
      if (entry.installLocation) {
        try {
          available = JSON.parse(
            fs.readFileSync(entry.installLocation + "/package.json", "utf8")
          ).version || "";
        } catch {}
      }
      let ageDays = "";
      if (entry.lastUpdated) {
        const then = Date.parse(entry.lastUpdated);
        if (!Number.isNaN(then)) {
          ageDays = String(Math.floor((Date.now() - then) / 86400000));
        }
      }
      console.log(available + "|" + ageDays);
    } catch {}
  ' "$KNOWN_MARKETPLACES" 2>/dev/null || echo "")

  AVAILABLE_VERSION="${MARKET_INFO%%|*}"
  CLONE_AGE_DAYS="${MARKET_INFO##*|}"

  # A. An upgrade is already sitting in the local clone.
  if [ -n "$AVAILABLE_VERSION" ] && [ "$AVAILABLE_VERSION" != "$CURRENT_VERSION" ]; then
    NEWER=$(node -e '
      const norm = (v) => String(v).split(".").map((n) => parseInt(n, 10) || 0);
      const [a, b] = [norm(process.argv[1]), norm(process.argv[2])];
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] || 0, y = b[i] || 0;
        if (x !== y) { console.log(x > y ? "yes" : "no"); process.exit(0); }
      }
      console.log("no");
    ' "$AVAILABLE_VERSION" "$CURRENT_VERSION" 2>/dev/null || echo "no")
    if [ "$NEWER" = "yes" ]; then
      WARNINGS+=("SF Toolkit v${AVAILABLE_VERSION} is available (running v${CURRENT_VERSION}) — run: claude plugin update claude-sf-toolkit --scope project, then restart")
    fi
  fi

  # B. The clone has not been refreshed lately, so upstream may be further ahead
  #    than the clone reports. Skipped when A already fired — one nudge is enough.
  if [ "$NEWER" != "yes" ] && [ -n "$CLONE_AGE_DAYS" ] && [ "$CLONE_AGE_DAYS" -gt "$MARKETPLACE_STALE_DAYS" ]; then
    WARNINGS+=("SF Toolkit marketplace last refreshed ${CLONE_AGE_DAYS} days ago — v${CURRENT_VERSION} may be behind upstream. Run: claude plugin marketplace update claude-sf-toolkit && claude plugin update claude-sf-toolkit --scope project")
  fi
fi

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
