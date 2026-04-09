---
name: tooling-review
description: SF CLI + MCP Server release tracking — weekly review, quarterly audit, context lookup
---

# /tooling-review — SF CLI & MCP Server Tooling Review

Review SF CLI and MCP Server releases for adoption opportunities, audit tool capabilities against current workflows, and provide domain-specific capability lookups.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- Empty — weekly review (default). Check for new releases, filter for relevance, update rolling reports, propose backlog items.
- `--audit` — quarterly full capability audit of CLI + MCP against current workflows
- `--context <area>` — on-demand domain-specific capability lookup (e.g., `agentforce`, `data-cloud`, `devops`)
- `--backlog-only` — process existing report adoption opportunities into backlog items without re-running analysis

Examples:

```
/tooling-review
/tooling-review --audit
/tooling-review --context agentforce
/tooling-review --backlog-only
```

---

## Resolution

**Cache-first resolution:**

1. Read `.claude/sf-toolkit-cache.json` in the project root.
2. If the file exists and `_cache.expiresAt` is after the current date/time:
   - Read `.sf/config.json` — confirm `target-org` matches `orgs.devAlias` in the cached context.
   - If it matches: use the cached context (all keys except `_cache`). **Skip the agent dispatch.**
3. If the cache is missing, expired, or the org alias doesn't match: dispatch the `sf-toolkit-resolve` agent. It will resolve fresh context and update the cache.

Use the returned context for all org references, team lookups, and path resolution in subsequent steps. If `missing` contains values this skill requires, stop and instruct the developer to run `/setup`.

---

## Argument Resolution

Parse `$ARGUMENTS` and resolve flags:

```
AUDIT = true if --audit
CONTEXT_AREA = value after --context, or null
BACKLOG_ONLY = true if --backlog-only
MODE = "audit" if AUDIT, "context" if CONTEXT_AREA, "backlog-only" if BACKLOG_ONLY, else "weekly"
```

**Mode resolution:**

- `--audit` → run Quarterly Audit flow (below)
- `--context <area>` → run Context Lookup flow (below). Does NOT update rolling files.
- `--backlog-only` → skip Steps 0-4, read existing reports, extract Adopt Now / Evaluate items, run Step 5 (Propose Backlog Items)
- Default (no flags) → run Weekly Review Steps 0-5

Report the resolved mode:

```text
### Tooling Review — {MODE}
```

---

## Weekly Review (Default Mode) — Steps 0-5

### Step 0 — Check Versions

Get the current installed/published versions and compare against last-reviewed versions stored in the rolling report headers.

**Get current versions:**

```bash
sf version --json
```

```bash
npm view @salesforce/mcp version
```

**Read last-reviewed state from report headers:**

Read the first 5 lines of `docs/tooling-reviews/sf-cli.md` and `docs/tooling-reviews/mcp-server.md`. Parse:

- `**Current Version:**` — the version at last review
- `**Last Reviewed:**` — date of last review

If a report file does not exist, treat this as a **first run** (baseline mode) — proceed through all steps and create the report file. Use the report structure from the design spec.

**Version comparison:**

```
CLI_CURRENT = version from sf version --json
CLI_LAST = "Current Version" from sf-cli.md header
MCP_CURRENT = version from npm view
MCP_LAST = "Current Version" from mcp-server.md header
CLI_CHANGED = CLI_CURRENT != CLI_LAST
MCP_CHANGED = MCP_CURRENT != MCP_LAST
```

If BOTH are unchanged (no new releases since last review):

```text
### No New Releases

**SF CLI:** {CLI_CURRENT} (last reviewed {date})
**MCP Server:** {MCP_CURRENT} (last reviewed {date})

No new releases since last review. Run `/tooling-review --audit` for a capability audit or `/tooling-review --context <area>` for a domain lookup.
```

Stop here. Do not proceed to Step 1.

If either changed, report which tools have updates and continue:

```text
### Version Check

**SF CLI:** {CLI_LAST} -> {CLI_CURRENT} {NEW or unchanged}
**MCP Server:** {MCP_LAST} -> {MCP_CURRENT} {NEW or unchanged}

Proceeding with review for updated tool(s).
```

---

### Step 1 — Fetch Release Notes

Only fetch notes for tools that have new versions (from Step 0).

**SF CLI (if CLI_CHANGED):**

Run `sf whatsnew` for the current version's release notes. If multiple versions were missed (gap between CLI_LAST and CLI_CURRENT), also try `sf whatsnew --version <v>` for intermediate versions.

If `sf whatsnew --version` does not support version targeting or returns no output, fall back to web search:

```
WebSearch: "salesforce cli {version} release notes site:github.com/forcedotcom/cli"
```

Then WebFetch the most relevant result.

**MCP Server (if MCP_CHANGED):**

```
WebSearch: "@salesforce/mcp changelog site:github.com"
```

WebFetch the GitHub releases page for version-specific notes. If unavailable, use npm metadata:

```bash
npm view @salesforce/mcp@{MCP_CURRENT} --json
```

Collect all NEW/CHANGE/FIX entries from the release notes for each tool.

---

### Step 2 — Read Platform Brief

Read the platform brief for relevance filtering:

```
Read docs/platform-brief.md
```

Use the **Salesforce Features**, **CLI Tools**, **MCP Server Toolsets**, and **Active Initiatives** tables as the relevance filter for Step 3.

---

### Step 3 — Filter and Classify

For each NEW/CHANGE/FIX entry from Step 1, apply relevance matching against the platform brief:

1. **Direct match** — feature area matches a Salesforce Features row tag (e.g., "Agentforce" matches `ai-agents`)
2. **Initiative match** — feature relates to an active initiative's key areas
3. **Tooling match** — feature affects a tool we have installed
4. **Constraint match** — feature changes a license or limit that constrains us

**Skip** entries with no project relevance.

**Classify** relevant entries using the same taxonomy as `/release-review`:

- **Adopt Now** — directly useful, can leverage immediately or in current initiatives
- **Evaluate** — potentially useful, needs investigation to determine fit
- **Watch** — not actionable yet but relevant to roadmap
- **Informational** — good to know, no action needed

For each relevant entry, capture:

```yaml
feature: { feature name }
area: { matching platform brief area }
classification: { Adopt Now | Evaluate | Watch | Informational }
summary: { 2-3 sentence description }
project_impact: { 1-2 sentences on specific project impact }
action: { what to do, if anything }
```

Report the classification summary:

```text
### Classification Summary

**Total entries reviewed:** {n}
**Project-relevant:** {count} (Adopt Now: {n}, Evaluate: {n}, Watch: {n}, Informational: {n})
**Skipped (not relevant):** {count}
```

---

### Step 4 — Update Rolling Reports

Update `docs/tooling-reviews/sf-cli.md` and/or `docs/tooling-reviews/mcp-server.md` (only for tools with new versions).

For each report file:

1. **Update header** — set "Current Version" and "Last Reviewed" to current values
2. **Add Adoption Opportunities** — new Adopt Now / Evaluate items go into the "Adoption Opportunities" table with `Status: New — {version}`
3. **Add Recent Changes entry** — add a new version subsection under "Recent Changes" with the NEW/CHANGE/FIX entries. Keep only the last 4 review entries — older entries are preserved in git history
4. **Move adopted items** — if any "Adoption Opportunities" items have been adopted since last review, move them to the "Completed" table with the adoption date and associated backlog item
5. **Update Capabilities We Use** — if the review reveals we've started using something new since last review, add it

**Report structure for reference** (follow the format already established in the baseline reports):

Header:

```markdown
**Current Version:** {version}
**Last Reviewed:** {date}
**Baseline Established:** {original baseline date}
```

Adoption Opportunities table columns: `Command / Feature | Area | Why Consider | Classification | Status`

Recent Changes: version subsections with NEW/CHANGE/FIX lists, plus "Backlog proposed" line if applicable.

---

### Step 5 — Propose Backlog Items

Same propose-then-approve pattern as `/release-review`.

For each **Adopt Now** and **Evaluate** feature from Step 3:

1. **Check for existing backlog overlap:**

   For each script below, check for a local copy in `scripts/` first. If not found, copy from `${CLAUDE_PLUGIN_ROOT}/script-templates/` to `scripts/`.

   ```bash
   node scripts/backlog-search.js --text "{feature keywords}"
   ```

   If an existing item covers this feature, note it as an expansion candidate rather than a new item.

2. **Draft backlog entries** for new items:

   ```yaml
   title: "{action verb} {feature name}"
   description: "{what to do and why, referencing the tooling review}"
   category: "{matching category}"
   priority: null
   effort: "{S|M|L|XL estimate}"
   complexity: "{Low|Med|High}"
   tags: ["{from platform brief}"]
   source: "tooling-review"
   submitted_by: "Claude"
   notes:
     - date: "{today}"
       author: "Claude"
       text: "Identified in tooling review ({tool} {version}). See docs/tooling-reviews/{tool}.md"
   ```

3. **Present proposals for approval:**

   ```text
   ### Proposed Backlog Items ({n} new, {m} expansions)

   **New Items:**

   1. **{title}** — {one-line summary}
      Effort: {S/M/L/XL} | Tags: {tags}

   2. ...

   **Expand Existing:**

   1. **BL-NNNN: {existing title}** — add: {what to add from this review}

   Approve all / approve 1,3 / skip 2 / edit 1: {text} / none
   ```

   **Wait for developer approval before writing any backlog items.**

4. **Write approved items:**

   For each script below, check for a local copy in `scripts/` first. If not found, copy from `${CLAUDE_PLUGIN_ROOT}/script-templates/` to `scripts/`.

   ```bash
   node scripts/backlog-add.js --title "{title}" --description "{desc}" --category "{cat}" --effort "{effort}" --complexity "{complexity}" --tags "{tags}" --source "tooling-review" --submitted-by "Claude"
   ```

5. **Re-render backlog:**

   For each script below, check for a local copy in `scripts/` first. If not found, copy from `${CLAUDE_PLUGIN_ROOT}/script-templates/` to `scripts/`.

   ```bash
   node scripts/backlog-render.js
   ```

6. **Update report** — add "Backlog proposed: BL-NNNN" line to the version's Recent Changes entry.

If no features warrant backlog items, report:

```text
No new backlog items proposed — all changes are informational or already covered by existing items.
```

---

## Quarterly Audit Mode (`--audit`)

Full capability review of CLI + MCP against current workflows.

### Step A1 — SF CLI Audit

Get the full command surface:

```bash
sf commands --json
```

Parse the JSON output. Group commands by topic (the first segment of the command name, e.g., `sf agent *`, `sf data *`, `sf project *`).

Read `docs/tooling-reviews/sf-cli.md` — compare the full command list against:

- **Capabilities We Use** — commands we already use
- **Adoption Opportunities** — commands already identified

For each topic area in the platform brief, identify commands that exist but we have not documented in either table. These are **audit findings** — potential capabilities we should evaluate.

### Step A2 — MCP Server Audit

Review all MCP tools available to Claude Code. Use the deferred tool list from the system context to enumerate available `mcp__Salesforce-DX__*` tools.

Read `docs/tooling-reviews/mcp-server.md` — compare available tools against:

- **Capabilities We Use** — tools already in use
- **Adoption Opportunities** — tools already identified

Check the MCP Server Toolsets table in `docs/platform-brief.md` for enabled vs available toolsets. Identify tools in enabled toolsets that we haven't documented.

### Step A3 — Cross-Reference with Platform Brief

Read `docs/platform-brief.md`. For each Active Initiative, check whether existing CLI commands or MCP tools could accelerate the work but aren't being used.

### Step A4 — Update Rolling Reports

Update both `docs/tooling-reviews/sf-cli.md` and `docs/tooling-reviews/mcp-server.md`:

1. Add new audit findings to the "Adoption Opportunities" table with `Status: Audit — {date}`
2. Add an audit subsection to "Recent Changes":

   ```markdown
   ### {date} — Quarterly Audit

   **Commands/tools audited:** {count}
   **New opportunities identified:** {count}
   **Key findings:**

   - {finding 1}
   - {finding 2}
   ```

3. Update "Capabilities We Use" if the audit reveals we're using something not yet documented

### Step A5 — Update Memory

Update `.claude/memory/project_tooling_review.md`:

- Set "Last audit" to today's date
- Set "Next target" to 3 months from today

### Step A6 — Propose Backlog Items

Run the same propose-then-approve workflow as Step 5 (Weekly Review) for any significant adoption opportunities found during the audit.

### Step A7 — Report

```text
### Quarterly Tooling Audit Complete

**SF CLI:** {n} commands across {n} topics ({n} used, {n} opportunities, {n} new findings)
**MCP Server:** {n} tools across {n} toolsets ({n} used, {n} opportunities, {n} new findings)
**Backlog items:** {n} proposed, {m} approved
**Next audit:** {date}
```

---

## Context Lookup Mode (`--context <area>`)

On-demand domain-specific capability scan. Does NOT update rolling files.

### Step C1 — Map Area to Platform Brief

Read `docs/platform-brief.md`. Map the provided `<area>` argument to platform brief tags:

| Input (flexible)         | Platform Brief Tag |
| ------------------------ | ------------------ |
| agentforce, agent        | ai-agents          |
| data-cloud, datacloud    | data-cloud         |
| analytics, crm-analytics | analytics          |
| flow, flows              | flow               |
| lwc, lightning           | lwc                |
| portal, experience       | portal             |
| devops                   | devops             |
| testing, test            | testing            |
| knowledge, kb            | kb                 |
| apex                     | apex               |
| compliance, shield       | compliance         |
| platform                 | platform           |

If the area doesn't match any tag, report:

```text
Area "{area}" not found in platform brief. Available areas: {list of tags}
```

And stop.

### Step C2 — Scan CLI Commands

```bash
sf commands --json
```

Filter the command list for commands matching the mapped area (by topic name or description keywords). List all matching commands with their descriptions.

### Step C3 — Scan MCP Tools

Review the available `mcp__Salesforce-DX__*` tools from the deferred tool list. Filter for tools matching the area by name or description.

### Step C4 — Cross-Reference Backlog

For each script below, check for a local copy in `scripts/` first. If not found, copy from `${CLAUDE_PLUGIN_ROOT}/script-templates/` to `scripts/`.

```bash
node scripts/backlog-search.js --text "{area}"
```

List active backlog items related to this area.

### Step C5 — Report

Report to console (do NOT update rolling files):

```text
### {Area} Tooling — Context Lookup

**CLI Commands (sf {topic} *):**
- sf {command} — {description}
- ...

**MCP Server Tools:**
- {tool_name} — {description}
- ... (or "none specific to {area} currently")

**Your {Area} Backlog:**
- BL-NNNN: {title} ({status})
- ...

**Capabilities in Use:**
- {list from rolling reports, if any}

**Adoption Opportunities Already Identified:**
- {list from rolling reports, if any}

**Recommendation:** {contextual recommendation for the area — what to adopt, what to evaluate, how it maps to active work}
```

### Step C6 — Optional Backlog Proposals

If the context lookup reveals significant adoption opportunities not already in the backlog, offer to propose backlog items using the same propose-then-approve workflow as Step 5.

---

## Backlog-Only Mode (`--backlog-only`)

Process existing rolling reports into backlog items without re-running analysis.

### Step B1 — Read Reports

Read both rolling report files:

- `docs/tooling-reviews/sf-cli.md`
- `docs/tooling-reviews/mcp-server.md`

### Step B2 — Extract Opportunities

Parse the "Adoption Opportunities" table from each report. Extract entries classified as **Adopt Now** or **Evaluate** that have not already been processed into backlog items.

Check for processing markers — if a "Backlog proposed" line in Recent Changes already references a version's findings, skip those entries.

### Step B3 — Run Backlog Proposal Workflow

Run the same propose-then-approve workflow as Step 5 (Weekly Review) for all extracted opportunities.

### Step B4 — Mark Processed

After processing, add a note to the relevant Recent Changes entry in each report:

```markdown
**Backlog processed:** {today's date} — {n} items proposed, {m} approved
```

---

## Behavior Notes

- **Platform brief is THE relevance filter.** Do not embed inline filter tables — always read `docs/platform-brief.md` for the current tech stack context.
- **Rolling files, not per-run files.** Update `docs/tooling-reviews/sf-cli.md` and `docs/tooling-reviews/mcp-server.md` in place. Git history preserves per-run snapshots. Never create new report files per run.
- **Version state lives in report headers.** The "Current Version" and "Last Reviewed" fields in the report file headers are the single source of truth for what has been reviewed. Do not duplicate this in memory files.
- **Propose-then-approve for backlog items.** Same pattern as `/release-review`, `/platform-review`, and `/lookback` — Claude proposes, developer approves before writing. Never auto-write backlog items.
- **Graceful degradation.** If `npm` is unavailable or web search fails for MCP notes, skip the MCP portion, complete CLI review, and report what was skipped. If `sf whatsnew` fails, fall back to web search. Always complete what you can.
- **Context lookup is read-only.** The `--context` mode reports to console only — it does not update rolling report files. It may optionally propose backlog items if the developer agrees.
- **Audit updates memory.** Only `--audit` mode updates `.claude/memory/project_tooling_review.md` (audit cadence tracking). Weekly reviews do not touch memory — report headers track the review state.
- **Source attribution.** All backlog items from tooling reviews use `source: tooling-review` for traceability. Notes reference the specific report file.
- **First run creates baseline.** If report files don't exist, the first run creates them with the current version as baseline. All current capabilities are documented, no delta analysis is performed (there's no previous version to compare against).
- **Weekly reminder.** `/start-day` includes a tooling review reminder when 7+ days have elapsed since last review. The reminder checks "Last Reviewed" in the report headers, not a memory file.
