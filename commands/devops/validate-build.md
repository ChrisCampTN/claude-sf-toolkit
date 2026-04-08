---
name: validate-build
description: Interactive post-build validation — walk through deployed features against design spec, capture pass/fail/adjust verdicts
---

# /validate-build — Interactive Build Validation

Walk through a built feature against its design spec, verifying each component in the org and capturing structured feedback. Supports both directions from the team build model:

- **Human validates Claude-built work (default):** Claude runs automated pre-checks, then walks the human through interactive verification of items requiring judgment (visual inspection, UX assessment, business logic correctness). Human gives verdicts.
- **Claude validates human-built work (`--claude-validates`):** For config-only builds (screen flows, reports, Experience Cloud, approval processes) where humans configure in the UI. Claude runs all automated checks AND provides its own verdicts on org-queried state vs spec. Human reviews Claude's findings and overrides where needed.

The validation direction is inferred from build mode: agent-driven metadata builds (source files exist locally) default to human-validates; config-only builds (no local source, only org state) default to claude-validates.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- A backlog item: `BL-0001` (resolves design_doc + devops_wis from backlog.yaml)
- A work item: `WI-000010` (resolves to BL item via devops_wis, then design_doc)
- A design doc path: `docs/design/example.md` (direct)
- Flags:
  - `--section "Section Name"` — scope to a specific section/component group within the design doc (e.g., `--section "Custom Notification Types"` or `--section "Provider Alert Flows"`)
  - `--target-org <alias>` — override target org (default: `{context.orgs.devAlias}`)
  - `--resume` — resume a previously interrupted validation session from `.validation-session.json`
  - `--claude-validates` — Claude provides verdicts (for human-built config-only work). Claude queries the org, compares against spec, and assigns PASS/FAIL/ADJUST verdicts with evidence. Human reviews and overrides.
  - `--human-validates` — human provides verdicts (default for agent-built metadata). Explicit override when auto-detection picks the wrong direction.

Examples:

```
/validate-build BL-0001
/validate-build WI-000010 --section "Custom Notification Types"
/validate-build BL-0002 --target-org SomeOrg
/validate-build docs/design/example.md --section "Provider Alert Flows"
/validate-build --resume
```

---

## Resolution

Dispatch the `sf-toolkit-resolve` agent. Use the returned context for all
org references, team lookups, and path resolution in subsequent steps.
If `missing` contains values this skill requires, stop and instruct the
developer to run `/setup`.

---

## Concepts

**Validation item:** A single checkable component from the design spec — a field, a flow, a notification type, a permission set entry, a layout section, etc.

**Verdict:** Each item gets one of:

- **PASS** — works as specified
- **FAIL** — does not match spec or is broken (captures what's wrong)
- **ADJUST** — works but needs a tweak (captures what to change)
- **SKIP** — not testable right now (captures why)
- **DEFER** — depends on something not yet built (captures dependency)

**Feedback:** Free-form notes the user provides during validation. Attached to specific items or to the session overall.

---

## Step 0 — Resolve Input & Load Context

1. **Parse arguments.** Extract BL-NNNN, WI-NNNNNN, doc path, flags.

2. **Resolve the design doc:**
   - If `BL-NNNN`: read the backlog source, find the item, extract `design_doc` and `devops_wis`. If no `design_doc`, STOP: "BL-NNNN has no design_doc — nothing to validate against."
   - If `WI-NNNNNN`: scan the backlog source for any item whose `devops_wis` contains this WI. Then resolve as BL item.
   - If doc path: verify file exists, use directly.
   - If `--resume`: load `.validation-session.json` from repo root. Verify it exists. Skip to Step 3 with loaded state.

3. **Read the design doc** into context. If `--section` is specified, identify the relevant section boundaries.

4. **Resolve target org.** Default: `{context.orgs.devAlias}`. Override with `--target-org`.

5. **Display session header:**

```
## Validation Session

**Item:** BL-0001 — {description}
**Design doc:** {path}
**Section:** {section name} ({n} components)
**Target org:** {context.orgs.devAlias}
**WIs:** {wi list}
**Assigned to:** {assignee}
**Started:** {timestamp}
```

---

## Step 1 — Build the Validation Checklist

Extract every verifiable component from the design doc (or scoped section). Group by type:

### Component Extraction Rules

| Design Doc Pattern           | Validation Item Type | How to Verify                                                                |
| ---------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| Custom object spec           | **Object**           | `sf sobject describe --sobject {Name} --target-org {org}`                    |
| Field spec (new or modified) | **Field**            | Describe object, check field exists with correct type/length/picklist values |
| Flow spec                    | **Flow**             | Check flow XML exists in source + query org for active version               |
| Permission set entry         | **PermSet**          | Read perm set XML, verify object/field permissions match spec                |
| Custom notification type     | **NotifType**        | Query `CustomNotificationType` in org                                        |
| Page layout spec             | **Layout**           | Check layout XML exists in source, verify sections/fields listed             |
| LWC component                | **LWC**              | Check component directory exists, verify key behaviors described             |
| Apex class                   | **Apex**             | Check class exists, verify test coverage                                     |
| Validation rule              | **VR**               | Check rule XML exists, verify formula and error message                      |
| Record type                  | **RecordType**       | Query org or check source XML                                                |

For each extracted item, create a checklist entry:

```
[ ] {Type} | {API Name} | {Brief description from spec}
```

### Present the Checklist

Show the full checklist grouped by type, with item count:

```
### Validation Checklist (14 items)

**Custom Notification Types (6)**
[ ] NotifType | Critical_Risk_Alert | Critical risk threshold breach notification
[ ] NotifType | Elevated_Risk_Alert | Elevated risk threshold notification
...

**Flows (4)**
[ ] Flow | Account_Critical_Alert | Triggered on Risk_Level = Critical
...
```

**Ask the user:** "Ready to start? I'll verify each item and walk you through. You can also tell me to skip a group or reorder."

---

## Step 2 — Automated Pre-Check

Before the interactive walkthrough, run automated checks on all items to pre-populate results. This saves time — the user only needs to manually verify items that require visual/functional inspection.

For each item, run the appropriate verification:

### Automated Checks by Type

**Object / Field / Flow / PermSet / NotifType / Layout / Apex / VR / RecordType:**

- Verify existence in source (glob for the file under `{context.metadataPath}/`)
- Verify existence in org (describe/query via SF CLI or MCP)
- For fields: verify data type, length, picklist values match spec
- For flows: verify the flow is Active in the org, check `processType` matches
- For perm sets: verify field-level security entries match spec
- For notification types: query `SELECT DeveloperName, CustomNotifTypeName FROM CustomNotificationType WHERE DeveloperName = '{name}'`

**LWC:**

- Verify component directory and key files exist (`.js`, `.html`, `.js-meta.xml`)
- Check `isExposed` and targets in meta XML match spec

### Pre-Check Results

Present results with auto-verdicts where possible:

```
### Pre-Check Results

**Custom Notification Types — 6/6 found in org**
[PASS] NotifType | Critical_Risk_Alert | Found in org, name matches spec
[PASS] NotifType | Elevated_Risk_Alert | Found in org, name matches spec
...

**Flows — 3/4 found, 1 issue**
[PASS] Flow | Account_Critical_Alert | Active in org, processType matches
[FAIL] Flow | Account_Watch_Alert | Found but INACTIVE in org
...

**Fields — 8/9 match spec**
[PASS] Field | Account.Risk_Level__c | Picklist, 3 values match spec
[ADJUST?] Field | Account.Risk_Score__c | Type is Number(8,2) but spec says Number(5,2)
...
```

Items marked `[PASS]` by automation are tentatively passed. Items marked `[FAIL]` or `[ADJUST?]` need user attention. The user can override any auto-verdict.

---

## Step 2B — Claude-Validates Mode (config-only builds)

When `--claude-validates` is active (or auto-detected for config-only builds with no local source files), Claude goes beyond existence checks and provides **substantive verdicts**:

For each item, Claude:

1. **Queries the org** for the full component state (not just existence — field values, flow logic, picklist entries, layout sections, etc.)
2. **Compares against the design spec** — checks every specified property, value, and behavior
3. **Assigns a verdict** with evidence:
   - `[PASS]` — org state matches spec. Cite the specific org query result.
   - `[FAIL]` — org state differs from spec. Show expected vs actual.
   - `[ADJUST?]` — works but differs from spec in a way that might be intentional. Flag for human review.
   - `[SKIP]` — cannot verify via org query (e.g., visual layout, UX flow). Mark for human spot-check.

Present all verdicts at once, then ask the human to review:

```text
### Claude Validation Results

**Auto-verified:** {n} PASS, {n} FAIL, {n} ADJUST?, {n} SKIP

Items needing your review:
- [FAIL] Flow: {FlowName} — expected trigger on Update, found trigger on CreateAndUpdate
- [ADJUST?] Field: {FieldName} — spec says Help Text "xyz", org has "xyz (updated)"
- [SKIP] Layout: {LayoutName} — field order requires visual verification

Override any verdict? (enter item numbers, or "accept all")
```

This mode is faster for config-only builds because Claude does the heavy lifting. The human only reviews exceptions.

---

## Step 3 — Interactive Guided Walkthrough (human-validates mode)

Walk through **every** item one at a time with structured prompts. Each item gets a dedicated review card with spec requirements, verification guidance, and a feedback form. The user submits a verdict and feedback before moving to the next item. No items are skipped silently — auto-passed items are presented briefly for confirmation.

**Skip this step entirely in `--claude-validates` mode** — Step 2B handles the walkthrough.

### 3A — Present Review Order

Before starting, show the walkthrough plan so the user knows the scope:

```text
### Walkthrough Plan ({n} items)

I'll walk you through each item one at a time. For each one you'll see:
- What the spec requires
- What the automated check found
- Step-by-step verification instructions
- A feedback form

Items auto-passed by Step 2 will be presented briefly — confirm or override.
Items that need attention are marked with a flag.

Group 1: Custom Notification Types (6 items) — 6 auto-passed
Group 2: Flows (4 items) — 3 auto-passed, 1 flagged
Group 3: Fields (4 items) — 3 auto-passed, 1 flagged

Ready to start? (You can also jump to a group: "start at Flows")
```

### 3B — Per-Item Review Card

Present each item as a structured review card. Wait for the user's response before moving to the next item.

**For auto-passed items** (brief confirmation):

```text
---
### Item {n}/{total}: {Type} | {API Name}
Status: AUTO-PASSED

**Spec requirement:**
{Extracted requirement from design doc — the specific property/behavior being validated}

**Verified:** {What the auto-check confirmed — e.g., "Exists in org, DeveloperName matches, CustomNotifTypeName = 'Critical Risk Alert'"}

Quick confirm: **accept** / override with verdict + feedback
---
```

**For flagged items** (full review card):

```text
---
### Item {n}/{total}: {Type} | {API Name}
Status: NEEDS REVIEW {reason: e.g., "inactive in org", "type mismatch"}

**Spec requirement:**
{Extracted requirement — be specific about every property the spec defines}

**Auto-check result:**
{What was found — show expected vs actual for any discrepancy}

**Verification steps:**
1. {Step-by-step instructions specific to this item type — see Type-Specific Prompts below}
2. {Next step}
3. {Next step}

**Feedback form:**
- **Verdict:** PASS / FAIL / ADJUST / SKIP / DEFER
- **What did you find?** (describe what you see in the org)
- **If FAIL/ADJUST — what needs to change?**
- **Severity:** blocker / major / minor / cosmetic
- **Screenshots or notes:** (optional, paste any relevant detail)
---
```

### 3C — Type-Specific Verification Prompts

Each item type gets tailored verification steps:

**Flow:**
1. Open Setup > Flows > search for "{FlowName}"
2. Confirm the flow is Active (or check why it's inactive)
3. Open the flow in Flow Builder — verify the trigger object and trigger type match spec
4. Walk through the first decision element — do the conditions match spec?
5. Check that actions (notifications, record updates) reference the correct targets
6. If testable: create/update a test record that meets entry criteria, verify the flow fires

**Field:**
1. Open Setup > Object Manager > {ObjectName} > Fields & Relationships > {FieldName}
2. Confirm: field type, length/precision, picklist values (if applicable), help text, description
3. Check field-level security: is it visible to the expected profiles/perm sets?
4. If formula: verify the formula text matches spec
5. Navigate to a record — is the field visible on the page layout where expected?

**Permission Set:**
1. Open Setup > Permission Sets > {PermSetName}
2. Check Object Settings > {ObjectName} — verify CRUD permissions match spec
3. Check field-level security for each field listed in spec
4. Verify assigned users (if spec defines expected assignments)

**Custom Notification Type:**
1. Open Setup > Custom Notifications > find "{NotifTypeName}"
2. Confirm: name, description, supported channels (Desktop, Mobile, Slack)
3. Check if it's referenced by the expected flow(s)

**Page Layout:**
1. Open Setup > Object Manager > {ObjectName} > Page Layouts > {LayoutName}
2. Verify sections exist as specified
3. Check field placement within each section
4. Confirm related lists at the bottom of the layout

**LWC Component:**
1. Open the target page in the org where the component is placed
2. Verify the component renders without errors
3. Test the primary user interaction (click, input, submit)
4. Check responsiveness if spec mentions mobile/tablet support
5. Verify data displays correctly (not just placeholder/empty state)

**Apex Class:**
1. Open Developer Console > {ClassName}
2. Verify the class compiles without errors
3. Check test coverage: Setup > Apex Test Execution > run the test class
4. Confirm coverage meets the 90% target from coding standards

### 3D — Feedback Collection

After each item's verdict, record structured feedback:

```json
{
  "item_id": 7,
  "api_name": "Account_Watch_Alert",
  "type": "Flow",
  "verdict": "FAIL",
  "source": "manual",
  "what_found": "Flow is inactive. When I try to activate, error: 'Referenced CustomNotificationType Watch_Risk_Alert not found'",
  "what_needs_to_change": "Fix the notification type API name reference in the Send Notification action",
  "severity": "major",
  "category": "bug",
  "notes": ""
}
```

### 3E — Progress Tracking Between Items

After each item, show a running tally:

```text
Progress: {completed}/{total} | PASS: {n} | FAIL: {n} | ADJUST: {n} | SKIP: {n} | DEFER: {n}
Next: Item {n+1}/{total}: {Type} | {API Name} — {auto-passed or flagged}

Continue / pause session / jump to item #?
```

### Feedback Categories

When classifying FAIL or ADJUST feedback:

| Category      | Meaning                                                |
| ------------- | ------------------------------------------------------ |
| `bug`         | Doesn't work as specified — needs a fix              |
| `spec-gap`    | Spec was ambiguous or incomplete — needs spec update |
| `cosmetic`    | Works but looks wrong — formatting, labels, layout   |
| `ux`          | Works but user experience could be better              |
| `enhancement` | Works as specified but user wants more                 |
| `blocker`     | Prevents other items from being validated              |

### Severity Levels

| Severity    | Meaning                                              |
| ----------- | ---------------------------------------------------- |
| `blocker`   | Cannot proceed with other validation or deployment   |
| `major`     | Must fix before promotion — functionality broken   |
| `minor`     | Should fix but doesn't block promotion             |
| `cosmetic`  | Nice to fix — labels, formatting, help text        |

---

## Step 4 — Save Session State

After completing the walkthrough (or if the user wants to pause), save the session to `.validation-session.json` at repo root:

```json
{
  "version": 1,
  "backlog_item": "BL-0001",
  "work_items": ["WI-000010"],
  "design_doc": "docs/design/example.md",
  "section": "Custom Notification Types",
  "target_org": "{context.orgs.devAlias}",
  "started": "2026-04-01T14:30:00-05:00",
  "updated": "2026-04-01T15:15:00-05:00",
  "validator": "{context.user.displayName}",
  "validation_mode": "human-validates",
  "items": [
    {
      "id": 1,
      "type": "NotifType",
      "api_name": "Critical_Risk_Alert",
      "description": "Critical risk threshold breach notification",
      "verdict": "PASS",
      "source": "auto",
      "what_found": "Exists in org, DeveloperName matches, channels match spec",
      "what_needs_to_change": null,
      "severity": null,
      "category": null,
      "notes": ""
    },
    {
      "id": 7,
      "type": "Flow",
      "api_name": "Account_Watch_Alert",
      "description": "Triggered on Risk_Level = Watch",
      "verdict": "FAIL",
      "source": "manual",
      "what_found": "Flow is inactive. Activation error: Referenced CustomNotificationType Watch_Risk_Alert not found",
      "what_needs_to_change": "Fix notification type API name reference in Send Notification action",
      "severity": "major",
      "category": "bug",
      "notes": ""
    }
  ],
  "session_feedback": [],
  "status": "in_progress"
}
```

This file is gitignored (ephemeral, per-session). Add `.validation-session.json` to `.gitignore` if not already present.

**Tell the user:** "Session saved. Run `/validate-build --resume` to continue, or keep going now."

---

## Step 5 — Validation Report

When all items have verdicts (or the user says "wrap up"), generate the report.

### Report Format

```
## Build Validation Report

**Item:** BL-0001 — {description}
**Design doc:** {path}
**Section:** {section name}
**Validation mode:** {human-validates / claude-validates}
**Validated by:** {context.user.displayName}
**Date:** {date}
**Target org:** {context.orgs.devAlias}

### Summary

| Verdict | Count |
|---------|-------|
| PASS    | 10    |
| FAIL    | 2     |
| ADJUST  | 1     |
| SKIP    | 1     |
| DEFER   | 0     |
| **Total** | **14** |

**Overall: NEEDS FIXES** (2 failures — 1 blocker, 1 major)

### Failures

| # | Component | What Was Found | What Needs to Change | Severity | Category |
|---|-----------|---------------|---------------------|----------|----------|
| 7 | Flow: Account_Watch_Alert | Inactive. Activation error: notification type reference invalid | Fix API name reference in Send Notification action | major | bug |
| 11 | Field: Account.Risk_Score__c | Deployed as Number(8,2) | Change to Number(5,2) per spec | major | bug |

### Adjustments Requested

| # | Component | What Was Found | Requested Change | Severity | Category |
|---|-----------|---------------|-----------------|----------|----------|
| 9 | Layout: Account-Provider Layout | Risk_Score at bottom of section | Move Risk_Score to top of PRA section | cosmetic | cosmetic |

### Skipped

| # | Component | Reason |
|---|-----------|--------|
| 14 | Flow: Weekly_Digest | Depends on scheduled job not yet configured |

### All Items (detailed)

| # | Type | Component | Verdict | Source | What Found | Severity |
|---|------|-----------|---------|--------|-----------|----------|
| 1 | NotifType | Critical_Risk_Alert | PASS | auto | Exists, name + channels match spec | — |
| 2 | NotifType | Elevated_Risk_Alert | PASS | auto | Exists, name + channels match spec | — |
| 7 | Flow | Account_Watch_Alert | FAIL | manual | Inactive, notification ref invalid | major |
| 9 | Layout | Account-Provider Layout | ADJUST | manual | Risk_Score placement | cosmetic |
| 11 | Field | Account.Risk_Score__c | FAIL | manual | Type mismatch (8,2 vs 5,2) | major |
| 14 | Flow | Weekly_Digest | SKIP | manual | Dependency not ready | — |
...

### Verbatim Feedback Log

Captures exactly what the validator reported at each step, in order:

- **Item 7 (Account_Watch_Alert):** "Flow is inactive. When I try to activate, error says the notification type reference is invalid. Checked the notification type — it exists but the API name in the flow is wrong."
- **Item 9 (Account-Provider Layout):** "Risk Score field is buried at the bottom. Should be at the top of the PRA section since it's the primary indicator."
- **Item 11 (Account.Risk_Score__c):** "Field shows 8 digits, spec says 5. The extra precision isn't needed and wastes space on the layout."

### Session Feedback
{Any general feedback the user provided during the session — not tied to a specific item}
```

### Report Output

1. **Display the report** in the conversation.
2. **Save to `docs/validation/`** as `{BL-NNNN}_{date}.md` (e.g., `BL-0001_2026-04-01.md`). Create the directory if needed.
3. **Clean up** `.validation-session.json` (delete it — the report is the permanent record).

---

## Step 6 — Action Items

After the report, generate actionable next steps from the failures and adjustments:

### For Bugs (FAIL + bug category)

- If the fix is straightforward (typo, wrong value, missing activation): **offer to fix it now** with user confirmation.
- If the fix requires design changes: note it as a spec update needed.
- If the fix requires manual org work: provide exact steps.

### For Adjustments

- Group by category (cosmetic, ux, enhancement).
- For cosmetic/ux: offer to make the change if it's in source-tracked metadata.
- For enhancements: suggest adding to backlog as a follow-up item.

### For Deferred Items

- List the dependencies and when they're expected to be ready.
- Suggest scheduling a follow-up validation.

### Output

```
### Action Items

**Immediate Fixes (can do now):**
1. Flow Account_Watch_Alert: notification type API name mismatch in flow reference. [Offer: fix now?]
2. Field Account.Risk_Score__c: change precision from (8,2) to (5,2) per spec. [Offer: fix now?]

**Manual Steps:**
3. Layout: Move Risk_Score__c field in the relevant section of Account layout.

**Follow-up:**
4. Schedule re-validation after scheduled job is configured.
```

If the user accepts a fix, make the change, deploy, and re-verify that specific item.

---

## Step 7 — Re-Validation Loop

After fixes are applied, offer to re-run just the failed/adjusted items:

"2 fixes applied. Want me to re-verify those items now?"

If yes, run the automated checks on just those items and present updated verdicts. Update the saved report.

Continue this loop until all items are PASS, SKIP, or DEFER.

---

## Step 8 — Close Session

When the user is satisfied:

1. **Update the validation report** with final verdicts.
2. **Log to memory** if there's reusable feedback:
   - Recurring build issues (e.g., "flows always deploy inactive") → suggest a feedback memory
   - Spec patterns that cause confusion → suggest a feedback memory
   - Only save feedback that applies to future builds, not one-off fixes
3. **Suggest next steps:**
   - If all PASS: "Ready for promotion via DevOps Center."
   - If DEFER items remain: "Schedule follow-up validation for {deferred items}."
   - If this was one section: "Run `/validate-build {BL-NNNN}` without `--section` to validate remaining components."

---

## Notes

- This skill complements `/design-review` (pre-build) and the build review process (during build). It fills the post-build verification gap.
- **Two validation directions** match the team build model: human-validates for Claude-built metadata (agent-driven), claude-validates for human-built config (screen flows, reports, Experience Cloud, approval processes). Direction is auto-detected from build mode but can be overridden.
- **Human-validates mode:** Interactive walkthrough is the core value — turns "go check if it works" into a guided process where the human submits feedback at each step. Claude facilitates, human judges.
- **Claude-validates mode:** Claude does the substantive comparison (org state vs spec) and presents verdicts with evidence. Human reviews exceptions only. Faster for config-only builds.
- Auto-checks run first in both modes to minimize effort.
- Session state persists so validation can span multiple sittings (common for large features).
- Validation reports in `docs/validation/` create an audit trail of what was checked, by whom, and in which direction.
- When validating large batch builds, run once per BL item or use `--section` to break a large design doc into manageable chunks.
- The skill is read-heavy by default (queries, describes, file reads). It only writes when applying fixes the user approves.
