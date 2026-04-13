#!/bin/bash
# Project-local PostToolUse hook for claude-sf-toolkit plugin development.
# Runs scripts/validate-plugin.js after edits to plugin files and surfaces only failures.
# Registered in .claude/settings.json. Exits 0 on success, non-zero would block.

set -u

# Read the tool use payload from stdin
TOOL_INPUT=$(cat 2>/dev/null || echo "")

# Extract edited file path (works for Edit, Write, MultiEdit)
if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  # Fallback: regex extraction (handles the first file_path value)
  FILE_PATH=$(echo "$TOOL_INPUT" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
fi

# Exit silently if no file path was captured
[ -z "$FILE_PATH" ] && exit 0

# Only run validator for plugin-relevant edits
case "$FILE_PATH" in
  */commands/*.md|*/agents/*.md|*/hooks/hooks.json|*/hooks/*.sh)
    ;;
  */.claude-plugin/plugin.json|*/.claude-plugin/marketplace.json|*/package.json)
    ;;
  */scripts/validate-plugin.js|*/scripts/test-resolve-cache.js)
    ;;
  *)
    exit 0
    ;;
esac

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0
[ -f scripts/validate-plugin.js ] || exit 0

# Run validator and capture output
OUTPUT=$(node scripts/validate-plugin.js 2>&1)
FAILURES=$(echo "$OUTPUT" | grep -E "FAIL" | head -10)

if [ -n "$FAILURES" ]; then
  echo "validate-plugin.js reported failures after editing $(basename "$FILE_PATH"):"
  echo "$FAILURES"
  echo "$OUTPUT" | tail -1
fi

exit 0
