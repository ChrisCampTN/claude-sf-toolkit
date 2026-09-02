#!/bin/bash
# Regression test for the upstream-staleness signals in hooks/session-start.sh.
# Run: bash scripts/test-session-start-staleness.sh
# Exit codes: 0 = all cases pass, 1 = a case failed.
#
# Why this exists: the hook's original version block compared the running version
# against the version that ran here last time — both local — so it could only
# report a change after an upgrade, never that one was available. On 2026-09-02 a
# consuming project was found running v1.8.0 against a v2.0.0 upstream for roughly
# two months while that block fired every session and correctly said nothing.
#
# The case that matters most is B: installed and clone versions AGREE, and only the
# AGE of the marketplace clone reveals that upstream was never consulted. A version
# comparison alone stays silent there, which is exactly how the incident hid.
set -u

HOOK="${1:-$(cd "$(dirname "$0")/.." && pwd)/hooks/session-start.sh}"
[ -f "$HOOK" ] || { echo "FAIL  hook not found: $HOOK"; exit 1; }

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
PASSED=0
FAILED=0

# Stub the CLIs the hook shells out to, so the auto-install branch cannot touch
# anything real during the test.
mkdir -p "$T/bin"
cat > "$T/bin/claude" <<'STUB'
#!/bin/bash
[ "${1:-}" = "plugin" ] && [ "${2:-}" = "list" ] && echo "superpowers commit-commands context7 skill-creator"
exit 0
STUB
printf '#!/bin/bash\nexit 0\n' > "$T/bin/sf"
chmod +x "$T/bin/claude" "$T/bin/sf"
mkdir -p "$T/project/.claude" "$T/home/.claude/plugins" "$T/plugin" "$T/clone"

# run_case <label> <installed> <clone_version> <lastUpdated> <expect regex|NONE>
run_case() {
  local label="$1" installed="$2" clone_ver="$3" last_updated="$4" expect="$5"
  echo "{\"version\":\"$installed\"}" > "$T/plugin/package.json"
  echo "{\"version\":\"$clone_ver\"}" > "$T/clone/package.json"
  printf '{"claude-sf-toolkit":{"installLocation":"%s","lastUpdated":"%s"}}\n' \
    "$T/clone" "$last_updated" > "$T/home/.claude/plugins/known_marketplaces.json"
  rm -f "$T/project/.claude/sf-toolkit-last-version"

  local out matched
  out=$(HOME="$T/home" PATH="$T/bin:$PATH" CLAUDE_PROJECT_DIR="$T/project" \
        CLAUDE_PLUGIN_ROOT="$T/plugin" bash "$HOOK" 2>&1)
  matched=$(echo "$out" | grep -cE "is available \(running|marketplace last refreshed" || true)

  if [ "$expect" = "NONE" ]; then
    if [ "$matched" -eq 0 ]; then
      echo "PASS  $label"; PASSED=$((PASSED + 1))
    else
      echo "FAIL  $label — expected silence, got:"; echo "$out" | grep -E "available|refreshed" | sed 's/^/        /'
      FAILED=$((FAILED + 1))
    fi
  else
    if echo "$out" | grep -qE "$expect"; then
      echo "PASS  $label"; PASSED=$((PASSED + 1))
    else
      echo "FAIL  $label — expected /$expect/, got:"; echo "$out" | sed 's/^/        /'
      FAILED=$((FAILED + 1))
    fi
  fi
}

FRESH=$(date -u -d '2 days ago' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%S.000Z)
OLD=$(date -u -d '132 days ago' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || echo "2026-04-23T18:40:36.792Z")

echo "session-start.sh — upstream staleness"
echo

run_case "A: clone newer than installed warns"          2.1.2 2.1.3 "$FRESH" "v2\.1\.3 is available \(running v2\.1\.2\)"
run_case "B: versions agree, clone 132d stale warns"    1.8.0 1.8.0 "$OLD"   "marketplace last refreshed 132 days ago"
run_case "current + freshly refreshed is silent"        2.1.3 2.1.3 "$FRESH" NONE
run_case "installed ahead of clone is silent"           9.9.9 2.1.3 "$FRESH" NONE
run_case "only one nudge when both conditions hold"     1.8.0 2.1.3 "$OLD"   "is available \(running v1\.8\.0\)"

# Robustness: a missing marketplace file must not break session start.
echo '{"version":"2.1.3"}' > "$T/plugin/package.json"
rm -f "$T/home/.claude/plugins/known_marketplaces.json"
if HOME="$T/home" PATH="$T/bin:$PATH" CLAUDE_PROJECT_DIR="$T/project" \
   CLAUDE_PLUGIN_ROOT="$T/plugin" bash "$HOOK" >/dev/null 2>&1; then
  echo "PASS  no marketplace file — hook still exits 0"; PASSED=$((PASSED + 1))
else
  echo "FAIL  hook errored with no marketplace file"; FAILED=$((FAILED + 1))
fi

echo
echo "──────────────────────────────────────────────────"
if [ "$FAILED" -eq 0 ]; then
  echo "  $PASSED passed"
  echo "──────────────────────────────────────────────────"
  exit 0
fi
echo "  $PASSED passed, $FAILED failed"
echo "──────────────────────────────────────────────────"
exit 1
