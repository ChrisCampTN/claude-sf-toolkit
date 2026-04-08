---
name: design-review
description: Design document accuracy review against org metadata, source files, and coding standards
---

# /design-review — Design Document Accuracy Review

Validate design documents against actual org metadata, source files, and coding standards before a backlog item graduates to a work item. Catches API name typos, missing fields, incorrect object references, standards violations, and stale consumer references.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- A design doc path: `docs/design/feature-name/spec.md`
- A backlog item ID: `BL-0054` (resolves design_doc from backlog.yaml)
- Empty — prompts user to specify

If a backlog item ID is provided and has no `design_doc` set, report FAIL and stop.

---

## Integration Points

### /backlog graduate

`/backlog graduate` should invoke `/design-review BL-NNNN` as part of its graduation gate (Check 2b). Design review must PASS or WARN (with user acknowledgment) before WI creation proceeds.

### /skill-preflight

Add `design-review` to the skill-suite mapping:

| Skill           | Suites Run        |
| --------------- | ----------------- |
| `design-review` | `git`, `metadata` |

---

## Resolution

Dispatch the `sf-toolkit-resolve` agent. Use the returned context for all
org references, team lookups, and path resolution in subsequent steps.
If `missing` contains values this skill requires, stop and instruct the
developer to run `/setup`.

---

## Step 0 — Resolve Input

1. If argument is `BL-NNNN`: read `{context.backlog.path}/backlog.yaml`, find the item, extract `design_doc` path. If `design_doc` is null, report FAIL: "BL-NNNN has no design_doc — cannot review."
2. If argument is a file path: verify the file exists.
3. Read the design document into context.
4. Extract the backlog item ID from the doc or argument (for cross-referencing).

---

## Step 1 — Metadata Accuracy Checks

### M1 — Object Names

Extract all `__c` object references from the design doc. For each:

- Check if `{context.metadataPath}/objects/{ObjectName}/` directory exists in source
- If not in source, query the dev org via MCP: `sf sobject describe --sobject {ObjectName} --target-org {context.orgs.devAlias}`
- **PASS:** Object exists in source or org
- **FAIL:** Object not found anywhere — likely a typo

### M2 — Field API Names

Extract all `__c` field references (pattern: `ObjectName.FieldName__c` or `FieldName__c` with context). For each:

- Check if `{context.metadataPath}/objects/{ObjectName}/fields/{FieldName}.field-meta.xml` exists
- If the field is proposed as NEW in the design doc (explicitly marked as new), skip validation — it doesn't exist yet
- For standard fields (no `__c`), verify via `sf sobject describe` if not obvious (e.g., `Account.Name` is always valid)
- **PASS:** Field exists or is explicitly marked as new
- **WARN:** Field referenced but object context is ambiguous (can't determine parent object)
- **FAIL:** Field not found on the specified object

### M3 — Flow Names

Extract all flow references from the design doc. For each:

- Check if `{context.metadataPath}/flows/{FlowName}.flow-meta.xml` exists in source
- For flows proposed as NEW in the design doc, skip validation
- **PASS:** Flow exists or is new
- **FAIL:** Flow name not found — typo or stale reference

### M4 — Permission Set Names

Extract permission set references. For each:

- Check if `{context.metadataPath}/permissionsets/{PermSetName}.permissionset-meta.xml` exists
- **PASS:** Permission set exists
- **WARN:** Permission set not found in source (may exist in org but not tracked)
- **FAIL:** Referenced as granting specific access but doesn't exist anywhere

### M5 — LWC Component Names

Extract LWC component references. For each:

- Check if `{context.metadataPath}/lwc/{componentName}/` directory exists
- For components proposed as NEW, skip validation
- **PASS:** Component exists or is new
- **FAIL:** Component name not found

### M6 — Apex Class Names

Extract Apex class references. For each:

- Check if `{context.metadataPath}/classes/{ClassName}.cls` exists
- For classes proposed as NEW, skip validation
- **PASS:** Class exists or is new
- **FAIL:** Class not found

### M7 — Picklist Values

If the doc references specific picklist values (e.g., `Status__c = 'Active'`):

- For existing fields: read the field XML and verify the value exists in `<valueSet>`
- For new fields: verify the doc defines the picklist values (at minimum, lists them)
- **PASS:** Values match or are fully defined for new fields
- **WARN:** Values referenced but field is new and values aren't explicitly listed

---

## Step 2 — Standards Compliance Checks

### S1 — Flow Naming Conventions

Check all proposed flow names against `docs/coding-standards.md`:

- Subflows: must start with `Subflow_`
- Record-triggered: should follow `{Object}_{Trigger_Event}_{Description}` pattern
- Screen flows: should follow `ScreenFlow{Description}` pattern
- Snake_case required
- **PASS:** All names follow conventions
- **WARN:** Minor deviation (casing, missing prefix)
- **FAIL:** Name violates conventions with no documented exception

### S2 — Architecture Pattern

Check the component architecture against CLAUDE.md rules:

- If LWC is involved: verify the doc specifies LWC + thin Apex pattern
- If writes are involved: verify business logic routes through a headless Flow (not direct Apex DML)
- If portal-facing: verify dual-target is specified (`lightningCommunity__Page` + internal target)
- **PASS:** Architecture follows documented patterns
- **WARN:** Pattern not explicitly stated but inferable
- **FAIL:** Architecture contradicts CLAUDE.md rules (e.g., business logic in Apex without Flow)

### S3 — Security Model

Check for required security patterns:

- Apex queries must specify `WITH SECURITY_ENFORCED` or `WITH USER_MODE`
- `with sharing` on all Apex controller classes
- FLS enforcement documented for portal-facing components
- Permission model defined (who can view, who can edit)
- **PASS:** Security patterns present
- **WARN:** Security mentioned but incomplete
- **FAIL:** No security model documented for a component that serves multiple user types

### S4 — Fault Handling

For proposed subflows or autolaunched flows:

- Verify the doc specifies fault handling (per coding standards: Subflow_Error_Handler pattern)
- Check severity and category are defined
- **PASS:** Fault handling specified
- **WARN:** Fault handling mentioned but incomplete
- **FAIL:** No fault handling for a flow that performs DML or callouts

### S5 — Variable Naming

Check proposed variable names against coding standards:

- camelCase for Flow variables
- Descriptions required on input/output variables
- **PASS:** All variables follow conventions
- **WARN:** Minor issues

### S6 — API Version

Check if the design doc specifies an API version:

- Must be `{context.apiVersion}` (or match current org standard)
- **PASS:** Correct version or not specified (will default at build time)
- **FAIL:** Specifies wrong version

---

## Step 3 — Cross-Reference Checks

### X1 — Field Display Lists vs Actual Fields

If the doc lists fields to display (e.g., in a data table spec):

- Verify every listed field exists on the object (per M2)
- Verify no critical fields are omitted that consumers likely need (compare against full field list)
- **PASS:** All listed fields exist
- **INFO:** Object has additional fields not listed (not an error — may be intentional exclusion)
- **FAIL:** Listed field doesn't exist on the object

### X2 — Consumer Flow References

If the doc lists consuming flows (e.g., migration plan):

- Verify each named flow exists (per M3)
- Verify each flow actually queries the objects claimed (grep for `<object>` or `<objectType>` in the flow XML)
- **PASS:** Flow exists and references the object
- **WARN:** Flow exists but object reference not confirmed (may use dynamic references)
- **FAIL:** Flow doesn't reference the claimed object

### X3 — Permission Set Coverage

If the doc lists permission sets that grant access:

- Verify each permission set references the objects/fields claimed
- Grep the permission set XML for the object/field API names
- **PASS:** Permission set references confirmed
- **WARN:** Permission set exists but doesn't reference the specific field (may need update)
- **FAIL:** Permission set doesn't reference the object at all

### X4 — Backlog Item Consistency

If reviewing via `BL-NNNN`:

- Verify the design doc title/purpose aligns with the backlog item title/description
- Check that `blocked_by` items are addressed in the design (dependencies documented)
- Check that `related` items are referenced where relevant
- **PASS:** Consistent
- **WARN:** Minor misalignment (title drift is normal during spec refinement)

---

## Step 4 — Report

### Output Format

```
## /design-review Results

**Document:** {path}
**Backlog Item:** {BL-NNNN} (if applicable)
**Reviewed:** {timestamp}

### Metadata Accuracy
- [PASS] M1 — All 4 object references verified in source
- [PASS] M2 — 26/28 field references verified (2 marked as new)
- [FAIL] M3 — Flow "Subflow_Process_Payment_V2" not found (did you mean "Subflow_Process_Payment"?)
- [PASS] M4 — 3/3 permission sets verified
...

### Standards Compliance
- [PASS] S1 — Flow names follow conventions
- [PASS] S2 — LWC + thin Apex + headless Flow pattern confirmed
- [WARN] S3 — Apex example uses WITH SECURITY_ENFORCED but portal FLS enforcement not explicitly documented
...

### Cross-References
- [PASS] X1 — All 14 display fields verified
- [WARN] X2 — Consumer flow reference confirmed, dynamic loop variable not resolvable
...

### Summary
| Severity | Count |
|----------|-------|
| PASS     | 14    |
| INFO     | 2     |
| WARN     | 3     |
| FAIL     | 1     |

### Recommendation
[BLOCKED] 1 FAIL must be resolved before graduation.
Fix: "Subflow_Process_Payment_V2" → "Subflow_Process_Payment" (line 47 of design doc)
```

### Severity Rules

- **FAIL present** → Report `[BLOCKED]`. Design doc must be fixed before `/backlog graduate` proceeds.
- **WARN only** → Report `[REVIEW]`. User can acknowledge warnings and proceed.
- **All PASS/INFO** → Report `[APPROVED]`. Ready for graduation.

---

## Step 5 — Auto-Fix Offers

For specific FAIL types, offer targeted fixes with user confirmation:

| FAIL Type                           | Auto-Fix                                         |
| ----------------------------------- | ------------------------------------------------ |
| Field name typo (close match found) | Suggest correction, offer to edit the design doc |
| Flow name typo (close match found)  | Suggest correction, offer to edit the design doc |
| Wrong API version                   | Offer to update to `{context.apiVersion}`        |
| Missing fault handling section      | Offer to append standard fault handling spec     |
| Missing security model section      | Offer to append standard security section        |

Always confirm before editing. Never auto-fix silently.

---

## Notes

- This skill is **read-only by default** — it reads source files, queries the org, and reports findings. It only writes if auto-fix is accepted.
- For large design docs with many references, use parallel glob/grep calls to minimize runtime.
- New metadata proposed in the design doc should be clearly distinguishable from existing metadata references. Look for patterns like "New Fields", "Proposed", "To be created", or table headers that indicate new schema.
- The skill should be invoked at least once before `/backlog graduate`. It can also be run standalone during spec writing to catch issues early.
