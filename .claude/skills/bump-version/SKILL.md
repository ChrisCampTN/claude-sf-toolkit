---
name: bump-version
description: Sync the plugin version across package.json, .claude-plugin/plugin.json, and .claude-plugin/marketplace.json. Usage - /bump-version 1.6.1
disable-model-invocation: true
---

# /bump-version — Sync plugin version across all three files

**Arguments:** `$ARGUMENTS` — the new semver version string (e.g., `1.6.1`, `1.7.0`, `2.0.0`). Required.

Plugin versions must stay synced across three files per `CLAUDE.md`:

- `package.json` (line 3)
- `.claude-plugin/plugin.json` (line 4)
- `.claude-plugin/marketplace.json` (line 11)

Drift between these breaks install/update flows and is flagged by `scripts/validate-plugin.js`. This skill updates all three atomically and verifies the sync.

---

## Steps

### Step 1 — Validate input

If `$ARGUMENTS` is empty, stop and report:

```text
Usage: /bump-version <new-version>
Example: /bump-version 1.6.1
```

Otherwise, trim whitespace and extract the version string. It must match `^[0-9]+\.[0-9]+\.[0-9]+$` (standard three-part semver, no pre-release suffix). If it doesn't match, report:

```text
Invalid version: "{input}". Expected format: MAJOR.MINOR.PATCH (e.g., 1.6.1). Pre-release suffixes are not supported by this skill.
```

And stop.

### Step 2 — Read current version

Read the current version from `package.json` (look for `"version": "X.Y.Z"` on line 3). Capture as `OLD_VERSION`.

If `OLD_VERSION == NEW_VERSION`, report:

```text
package.json is already at {NEW_VERSION}. Running validator to confirm sync with the other two files.
```

Then skip to Step 4 (no edits needed, just verify).

### Step 3 — Update all three files

Use `Edit` with `old_string: "version": "{OLD_VERSION}"` and `new_string: "version": "{NEW_VERSION}"` on each file:

1. `package.json`
2. `.claude-plugin/plugin.json`
3. `.claude-plugin/marketplace.json`

If any Edit fails (old_string not found), stop and report which file is out of sync. The user will need to investigate — the version may already have drifted.

### Step 4 — Validate

Run:

```bash
node scripts/validate-plugin.js
```

Confirm the output includes:

```
PASS  All files at v{NEW_VERSION}
```

If the "Version consistency" check fails, report the output and stop — the edit may have partially succeeded.

### Step 5 — Report

```text
Version bumped: {OLD_VERSION} -> {NEW_VERSION}

Files updated:
- package.json
- .claude-plugin/plugin.json
- .claude-plugin/marketplace.json

Validator: PASS (all three in sync at {NEW_VERSION})

Next steps:
- Review the changes with `git diff`
- Commit with `/commit` or `git commit -m "chore: bump to v{NEW_VERSION} — {one-line summary}"`
```

**Do not commit automatically.** The user stages and commits with their preferred workflow (often bundling the version bump into a feature commit or using `/commit`).
