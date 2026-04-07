---
name: validate-build
description: Interactive post-build validation — walk through deployed features against design spec, capture pass/fail/adjust verdicts
---

# /validate-build — Interactive Build Validation

Walk through a Claude-built feature against its design spec, verifying each component in the org and capturing structured feedback as you go. Designed for the "Claude builds, humans verify" model — turns validation from ad-hoc poking into a guided checklist with tracked results.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- A backlog item: `BL-0001` (resolves design_doc + devops_wis from backlog.yaml)
- A work item: `WI-000010` (resolves to BL item via devops_wis, then design_doc)
- A design doc path: `docs/design/example.md` (direct)
- Flags:
  - `--section "Section Name"` — scope to a specific section/component group within the design doc (e.g., `--section "Custom Notification Types"` or `--section "Provider Alert Flows"`)
  - `--target-org <alias>` — override target org (default: `{context.orgs.devAlias}`)
  - `--resume` — resume a previously interrupted validation session from `.validation-session.json`

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

## Step 3 — Interactive Walkthrough

Walk through each item that needs attention (failures, warnings, and items requiring visual/functional verification). For items the automation passed, ask if the user wants to review them too or accept the auto-verdicts.

### Per-Item Flow

For each item:

1. **Show context** — what the spec says, what the automated check found
2. **Show how to verify** — specific steps the user can take (navigate to Setup > ..., open the record, run this SOQL, etc.)
3. **Ask for verdict** — PASS / FAIL / ADJUST / SKIP / DEFER
4. **Capture feedback** — if FAIL or ADJUST, ask what's wrong or what needs to change. Record verbatim.

Example interaction:

```
### Item 7/14: Flow | Account_Watch_Alert

**Spec says:** Record-triggered flow on Account, fires when Risk_Level__c
changes to "Watch". Sends Watch_Risk_Alert notification to Account owner.

**Auto-check found:** Flow exists in source and org but is INACTIVE.

**To verify:**
1. In Setup > Flows, find "Account_Watch_Alert"
2. Check if it was intentionally left inactive (dependency on notification type?)
3. If it should be active, activate it and re-test

**Your verdict?**
```

User responds, e.g.: "FAIL - it should be active but there's an error when I try to activate. Says the notification type reference is invalid."

Record: `{ item: "Account_Watch_Alert", verdict: "FAIL", feedback: "Cannot activate - notification type reference invalid", category: "bug" }`

### Feedback Categories

When the user provides FAIL or ADJUST feedback, classify it:

| Category      | Meaning                                                |
| ------------- | ------------------------------------------------------ |
| `bug`         | Doesn't work as specified — needs a fix              |
| `spec-gap`    | Spec was ambiguous or incomplete — needs spec update |
| `cosmetic`    | Works but looks wrong — formatting, labels, layout   |
| `ux`          | Works but user experience could be better              |
| `enhancement` | Works as specified but user wants more                 |
| `blocker`     | Prevents other items from being validated              |

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
  "items": [
    {
      "id": 1,
      "type": "NotifType",
      "api_name": "Critical_Risk_Alert",
      "description": "Critical risk threshold breach notification",
      "verdict": "PASS",
      "source": "auto",
      "feedback": null,
      "category": null
    },
    {
      "id": 7,
      "type": "Flow",
      "api_name": "Account_Watch_Alert",
      "description": "Triggered on Risk_Level = Watch",
      "verdict": "FAIL",
      "source": "manual",
      "feedback": "Cannot activate - notification type reference invalid",
      "category": "bug"
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

**Overall: NEEDS FIXES** (2 failures)

### Failures

| # | Component | Issue | Category |
|---|-----------|-------|----------|
| 7 | Flow: Account_Watch_Alert | Cannot activate - notification type reference invalid | bug |
| 11 | Field: Account.Risk_Score__c | Type mismatch: deployed Number(8,2), spec says Number(5,2) | bug |

### Adjustments Requested

| # | Component | Requested Change | Category |
|---|-----------|-----------------|----------|
| 9 | Layout: Account-Provider Layout | Move Risk_Score to top of section | cosmetic |

### Skipped

| # | Component | Reason |
|---|-----------|--------|
| 14 | Flow: Weekly_Digest | Depends on scheduled job not yet configured |

### All Items

| # | Type | Component | Verdict | Notes |
|---|------|-----------|---------|-------|
| 1 | NotifType | Critical_Risk_Alert | PASS | Auto-verified |
| 2 | NotifType | Elevated_Risk_Alert | PASS | Auto-verified |
...

### Session Feedback
{Any general feedback the user provided during the session}
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
- The interactive walkthrough is the core value — it turns "go check if it works" into a structured, tracked process.
- Auto-checks run first to minimize manual effort. The user only handles items that need human judgment.
- Session state persists so validation can span multiple sittings (common for large features).
- Validation reports in `docs/validation/` create an audit trail of what was checked and by whom.
- When validating large batch builds, run once per BL item or use `--section` to break a large design doc into manageable chunks.
- The skill is read-heavy by default (queries, describes, file reads). It only writes when applying fixes the user approves.
