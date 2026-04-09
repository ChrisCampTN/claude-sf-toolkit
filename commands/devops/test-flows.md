---
name: test-flows
description: Native FlowTest metadata generator for record-triggered flows
---

# /test-flows — Native Flow Test Generator

Generate native Salesforce FlowTest metadata for record-triggered flows. Reads flow XML and optional documentation to produce deployable `.flowtest-meta.xml` files with test scenarios covering happy paths, decision branches, boundary conditions, and negative paths.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- A specific flow name (without `.flow-meta.xml`): e.g. `Account_Before_Save_Max_Term_Sync`
- A category name matching categories defined in `docs/flows/flow-categories.json`
- `all` — generate tests for every eligible record-triggered flow (confirm with user before starting)
- Empty — ask the user which flows or category to test
- `--target-org {alias}` — override the default target org
- `--tdd` — TDD mode for new flows (see below)

**Scope:** Native FlowTests only support record-triggered flows (Before Save, After Save). Screen flows, scheduled/batch flows, and subflows are automatically excluded.

## Resolution

**Cache-first resolution:**

1. Read `.claude/sf-toolkit-cache.json` in the project root.
2. If the file exists and `_cache.expiresAt` is after the current date/time, **and** no `--target-org` override was provided:
   - Read `.sf/config.json` — confirm `target-org` matches `orgs.devAlias` in the cached context.
   - If it matches: use the cached context (all keys except `_cache`). **Skip the agent dispatch.**
3. If the cache is missing, expired, or the org alias doesn't match: dispatch the `sf-toolkit-resolve` agent. It will resolve fresh context and update the cache.

Use the returned context for all org references, team lookups, and path resolution in subsequent steps. If `missing` contains values this skill requires, stop and instruct the developer to run `/setup`.

### TDD Mode (new flows)

When generating tests for a flow that **does not yet exist** (or is being substantially rewritten), apply `superpowers:test-driven-development` discipline — write the test first, deploy it, confirm it fails (flow missing or behavior wrong), then build the flow to make the test pass. This inverts the default workflow (test existing flows) into a test-first workflow for new development.

**When to use TDD mode:** The user explicitly requests it (`/test-flows --tdd {FlowName}`), or the target flow XML does not yet exist in `{context.metadataPath}/`. In TDD mode, skip Step 3 (parse flow XML) — instead, derive test scenarios from the design doc or user-provided requirements. The generated FlowTest should fail when deployed because the flow doesn't exist yet. That failure is expected and confirms the test is testing the right thing.

**When to use normal mode:** The flow already exists and you're generating tests for existing behavior (default).

---

## Step 0 — Preflight

### P1/P2 — Git State & Org Connectivity

Invoke `/skill-preflight test-flows` to run the `git`, `org`, and `metadata` suites. Pass the resolved `--target-org` value (default: `{context.orgs.devAlias}`). If any FAIL-level issues are found, stop. Warn if there are uncommitted modifications to `{context.metadataPath}/` files — generated test files need a clean baseline for commit tracking.

### P3 — Schema Cache Check

Check if `config/flowtest-schema/sample.flowtest-meta.xml` exists.

**If missing — STOP and bootstrap:**

1. Check if any FlowTests exist in the target org:

   ```soql
   SELECT Id, TestName FROM FlowTestView LIMIT 1
   ```

2. **If tests exist in org:** Retrieve one:

   ```bash
   sf project retrieve start --metadata FlowTest --target-org {TARGET_ORG} --output-dir config/flowtest-schema/
   ```

   Parse the retrieved XML and create `config/flowtest-schema/schema-notes.md` documenting the element names, nesting structure, required vs. optional elements, and attribute formats.

3. **If no tests exist in org:** Identify the simplest active record-triggered flow in the repo (fewest elements, straightforward entry criteria) and instruct the user:

   ```text
   ## Schema Bootstrap Required

   No FlowTest metadata has been found in the target org or locally. A sample is needed
   to discover the exact XML schema before generating tests.

   **Action required:**
   1. Open the target org: Setup > Flows > {SimplestFlowName} > View Tests > New Test
   2. Name it "Sample_Bootstrap_Test"
   3. Set the trigger to "Created" (or "Updated" if the flow only fires on update)
   4. Set any one field value on the triggering record
   5. Add one assertion (any field, any expected value)
   6. Save the test
   7. Re-run `/test-flows`

   The skill will retrieve the test and cache the schema for all future runs.
   ```

   Exit gracefully. Do not proceed to Step 1.

### P4 — FlowTest Directory Check

Check if `{context.metadataPath}/flowtests/` exists. Note if it needs to be created (done in Step 6).

---

## Step 1 — Parse Arguments

Parse `$ARGUMENTS`:

1. If empty: ask the user what to test.
2. If a category name: glob `{context.metadataPath}/flows/` and collect all flows in that category (use the category rules in `docs/flows/flow-categories.json`).
3. If a specific flow name: locate `{context.metadataPath}/flows/{FlowName}.flow-meta.xml`.
4. If `all`: count eligible record-triggered flows, show the count, and ask for confirmation before proceeding.

---

## Step 2 — Filter to Testable Flows

**Use `scripts/flow-index.js`** to get the pre-filtered, categorized flow list. Check for a local copy in `scripts/` first. If not found, copy from `${CLAUDE_PLUGIN_ROOT}/script-templates/`.

```bash
# Record-triggered flows only (already filtered by flow-categories.json)
node scripts/flow-index.js --record-triggered

# Specific category
node scripts/flow-index.js --record-triggered --category {name}

# Stats to show scope
node scripts/flow-index.js --record-triggered --stats
```

The script handles all standard filters (inactive, managed package, templates, sunset, one-time, temp/test) automatically via `docs/flows/flow-categories.json`. Apply these additional test-specific filters to the script output:

### SKIP — Delete-Triggered Flows

From the JSON output, exclude flows where `triggerType` is `RecordBeforeDelete`. Native FlowTests do not support delete triggers.

### Freshness Check — Already Tested

For each remaining flow, check if a `.flowtest-meta.xml` already exists in `{context.metadataPath}/flowtests/` with a filename starting with the flow's API name. If tests exist AND the flow XML has not been modified since the test was last generated (compare git log dates), skip it.

**Override:** If the user explicitly named a specific flow, always process it regardless of existing tests.

Report all skipped flows with reasons at the end of the run (Step 8).

---

## Step 3 — Read and Parse Flow XML

For each flow in scope, read the `.flow-meta.xml` and extract:

### Trigger Metadata

- `<start>` element:
  - `<object>` — the triggering sObject
  - `<triggerType>` — `RecordBeforeSave` or `RecordAfterSave`
  - `<recordTriggerType>` — `Create`, `Update`, `CreateAndUpdate`
  - `<doesRequireRecordChangedToMeetCriteria>` — boolean
  - `<filterLogic>` — entry condition logic (e.g., `and`, `1 AND (2 OR 3)`)
  - `<filters>` — each filter's `<field>`, `<operator>`, `<value>`
  - `<scheduledPaths>` — any scheduled paths

### Decision Elements

Each `<decisions>` element: name, label, rules (each rule's conditions, conditionLogic, connector/targetReference), defaultConnectorLabel, defaultConnector

### DML Operations

- `<recordUpdates>` — object, fields set, filter criteria
- `<recordCreates>` — object, fields set
- `<recordDeletes>` — object, filter criteria
- `<recordLookups>` — object, filters, fields retrieved (for test data context)

### Variables and Formulas

- `<variables>` — name, dataType, objectType, isInput, isOutput
- `<formulas>` — name, dataType, expression (affects decision outcomes)
- `$Record` and `$Record__Prior` references throughout the flow

### Actions

- `<actionCalls>` — action type, action name, parameters
- `<subflows>` — subflow references, input/output mappings

### Error Handling

- `<faultConnectors>` — presence/absence on DML and action elements

---

## Step 3b — Read Flow Documentation (Optional Enrichment)

For each flow, check if `docs/flows/{category}/{FlowName}.md` exists. If it does, read:

- **Purpose** — business context (informs test naming and description)
- **Process Logic** — step-by-step walkthrough (informs test scenario design)
- **Notes** — known quirks, edge cases, business rules (directly translates to boundary tests)
- **Dependencies** — objects read/written (informs assertion targets)

This is optional enrichment — XML alone is sufficient for test generation. Documentation improves test quality by surfacing business intent that XML alone cannot convey.

---

## Step 4 — Generate Test Scenarios

For each flow, analyze the parsed XML and generate test scenarios. Apply the following algorithm:

### 4a — Entry Criteria Analysis

Parse the `<start>` element's `<filters>` and `<filterLogic>`:

1. **Determine required field values**: Translate each filter into a concrete test field value:
   - `EqualTo` → set field to the specified value
   - `NotEqualTo` → set field to a DIFFERENT value than specified (for happy path)
   - `IsNull` true → set field to null; `IsNull` false → set to a non-null value
   - `IsChanged` → for update tests, set initial and updated values that differ
   - `Contains` → set field to a value containing the required substring
   - `GreaterThan` / `LessThan` → set field to a value meeting the threshold
   - `StartsWith` / `EndsWith` → set field accordingly

2. **Handle complex filterLogic**: Parse expressions like `1 AND (2 OR 3)`:
   - For happy path: find the simplest combination satisfying ALL conditions
   - For negative tests: find values that violate at least one required condition

3. **Handle hardcoded IDs**: If a filter uses a literal 15/18-character Salesforce ID (e.g., RecordTypeId = `012...`):
   - Use the hardcoded ID in the test value
   - Flag it in the test description: `"Uses hardcoded RecordTypeId — test is org-specific. Will fail in orgs with different ID values."`

4. **Handle `$Record__Prior`**: For update-triggered flows referencing prior values, define both initial and updated record states in the test.

### 4b — Decision Path Analysis

For each `<decisions>` element:

1. **Named rules** (explicit branches): Each rule with conditions becomes a test scenario with field values that route to that branch
2. **Default outcome**: Field values that match NO named rules — always generates a scenario
3. **Chained decisions**: Trace full paths through sequential decisions for end-to-end scenarios

### 4c — Scenario Types (Priority Order)

| Priority | Scenario                | When to Generate                                                                                  |
| -------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| 1        | **Happy Path (Create)** | Flow supports Create trigger (`CreateAndUpdate` or `Create`)                                      |
| 2        | **Happy Path (Update)** | Flow supports Update trigger (`CreateAndUpdate` or `Update`)                                      |
| 3        | **Decision Branch**     | Each named decision rule with 2+ outcomes — one scenario per rule                                 |
| 4        | **Default Branch**      | Each decision with a defaultConnector                                                             |
| 5        | **Negative Path**       | Always — record does NOT meet entry criteria, flow should not run                                 |
| 6        | **Boundary**            | Entry criteria include numeric comparisons, null checks, `IsChanged`, or picklist values at edges |

**Cap:** Maximum **8 tests per flow**. For flows with many decisions, prioritize:

- All happy paths (Create + Update)
- First 3 decision branches (by flow element order)
- One negative path
- Boundary tests only if space remains

**Cap per run:** Maximum **50 tests total**. For `all` mode, process flows in batches of 10 and report progress between batches.

### 4d — Test Data Value Strategy

For each scenario, determine concrete field values:

| Field Type         | Strategy                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| String / Picklist  | Exact API values from flow conditions (e.g., `"Active"`, `"Nonrecourse"`)                                                                        |
| Number / Currency  | Round numbers clearly satisfying or violating thresholds (e.g., 12 for range 6-24)                                                               |
| Boolean            | `true` or `false` per condition                                                                                                                  |
| Date / DateTime    | Fixed date `2026-01-15` or `2026-01-15T12:00:00.000Z`                                                                                            |
| Lookup / Reference | **Do NOT fabricate IDs.** Note in test description: `"Requires a valid {ObjectName} record ID in the org. Populate {FieldName} before running."` |
| RecordTypeId       | Use hardcoded value if present in flow. Flag as org-specific.                                                                                    |
| Checkbox           | `true` or `false`                                                                                                                                |

### 4e — Assertion Strategy

Each test should have **2-4 assertions**. Focus on:

1. **Element-was-visited assertions**: Assert that a flow element was executed using `EqualTo` operator with `<booleanValue>true</booleanValue>` on the element's API name (e.g., `leftValueReference: Update_Account_Field`, operator: `EqualTo`, rightValue: `true`). This covers decision outcomes, DML elements, and action elements.
2. **Field update assertions** (Before Save flows): Assert that `$Record.{FieldName}` equals the expected value after assignment elements run (use `EqualTo` with the appropriate typed value — `<stringValue>`, `<numberValue>`, `<booleanValue>`)
3. **Negative test assertion**: Assert that the flow's first substantive element was NOT visited using `EqualTo` with `<booleanValue>false</booleanValue>` (entry criteria prevented execution)

Do not over-assert — too many assertions make tests brittle and hard to maintain.

---

## Step 5 — Present Test Plan

Show a structured preview BEFORE writing any files. Wait for user confirmation.

```text
## /test-flows Test Plan

**Flows in scope:** {n} record-triggered flows
**Tests to generate:** {total} across {n} flows
**Schema source:** config/flowtest-schema/sample.flowtest-meta.xml

### Test Coverage by Flow

| Flow | Object | Trigger | Tests | Scenarios |
|---|---|---|---|---|
| {FlowName} | {Object} | {Before/After Save (Create/Update)} | {n} | {comma-separated scenario names} |
| ... | ... | ... | ... | ... |

### Warnings
- {n} tests use hardcoded IDs (org-specific — will fail in orgs with different IDs)
- {n} tests reference lookup fields (require valid parent records in org)
- {n} flows have no fault paths (tests generated but coverage is limited)
- {n} flows had no documentation (test scenarios based on XML analysis only)

Generate these tests?
```

Do NOT proceed until the user confirms.

---

## Step 6 — Write FlowTest Files

1. Create `{context.metadataPath}/flowtests/` directory if it does not exist.
2. For each test scenario, generate a `.flowtest-meta.xml` file using the cached schema (`config/flowtest-schema/sample.flowtest-meta.xml`) as the structural template.

### File Naming Convention

**Filename:** `{FlowApiName}_{ScenarioSuffix}.flowtest-meta.xml`

| Scenario Type       | Suffix              | Example Filename                                                                    |
| ------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| Happy Path (Create) | `HappyPath_Create`  | `Billing_Account_Cancel_HappyPath_Create.flowtest-meta.xml`                         |
| Happy Path (Update) | `HappyPath_Update`  | `Account_Before_Save_Max_Term_Sync_HappyPath_Update.flowtest-meta.xml`              |
| Decision Branch     | `Branch_{RuleName}` | `RecordTriggeredBillingAccountAfterSaveUpdates_Branch_Version.flowtest-meta.xml`    |
| Default Branch      | `Branch_Default`    | `RecordTriggeredBillingAccountAfterSaveUpdates_Branch_Default.flowtest-meta.xml`    |
| Negative Path       | `Negative`          | `Account_Before_Save_Max_Term_Sync_Negative.flowtest-meta.xml`                      |
| Boundary            | `Boundary_{Desc}`   | `First_Transaction_Approved_Move_to_Active_Boundary_NullResponse.flowtest-meta.xml` |

### Test Label Convention

**Label:** `{Human-Readable Flow Name}: {Scenario Description}`

Example: `"Account: Before Save Max Term Sync - Happy Path (Update)"`

### Test Description

Include in each test's `<description>`:

- What scenario is being tested
- What entry criteria values are set and why
- What assertions verify
- Any org-specific dependencies (hardcoded IDs, lookup fields needing real data)

### Critical: Use Cached Schema as Template

### XML Structure Reference

The exact format is documented in `config/flowtest-schema/schema-notes.md`. Key structural rules:

**Two `<testPoints>` blocks per test:**

1. **Start block** (`<elementApiName>Start</elementApiName>`) — defines the triggering record:
   - For **create** tests: one `<parameters>` with `<type>InputTriggeringRecordInitial</type>`
   - For **update** tests: two `<parameters>` — `InputTriggeringRecordInitial` (before state) and `InputTriggeringRecordUpdated` (after state with changes)
   - Record data goes in `<value><sobjectValue>` as a JSON string with HTML-entity-encoded quotes (`&quot;`)

2. **Finish block** (`<elementApiName>Finish</elementApiName>`) — defines assertions:
   - Each `<assertions>` has `<conditions>` (leftValueReference, operator, rightValue) and `<errorMessage>`
   - Element-was-visited: `leftValueReference` = element API name, `operator` = `EqualTo`, `rightValue` = `<booleanValue>true</booleanValue>`
   - Value types: `<booleanValue>`, `<stringValue>`, `<numberValue>`, `<dateValue>`, `<dateTimeValue>`

**Omit `<flowTestFlowVersions>`** — let the test run against the active version. Including version numbers couples the test to specific versions and breaks on new activations.

**sobjectValue JSON format:**

```
{&quot;Field_Api_Name__c&quot;:&quot;string value&quot;,&quot;Number_Field__c&quot;:150,&quot;Boolean_Field__c&quot;:false}
```

Refer to `config/flowtest-schema/sample.flowtest-meta.xml` as the structural template for all generated files.

---

## Step 7 — Validate Generated Tests

Before presenting results, validate each generated file:

1. **XML well-formedness** — the file parses as valid XML
2. **Field reference check** — all field API names in test data and assertions appear in the flow XML or are standard fields on the triggering object
3. **Element reference check** — all decision outcomes and action elements referenced in assertions exist in the flow XML
4. **Schema compliance** — all required elements per the cached schema are present
5. **Non-empty assertions** — every test has at least one assertion
6. **Filename length** — Salesforce metadata API has limits; warn if filename exceeds 80 characters

Report any validation issues. Offer to fix automatically where possible (e.g., truncate long filenames, remove references to nonexistent elements).

---

## Step 8 — Report Results

```text
## /test-flows Complete

**Generated:** {n} flow tests across {m} record-triggered flows

### Coverage Summary

| Flow | Tests | Happy | Decisions | Negative | Boundary |
|---|---|---|---|---|---|
| {FlowName} | {n} | {x} | {y} | {z} | {w} |
| ... | ... | ... | ... | ... | ... |
| **Total** | **{n}** | **{x}** | **{y}** | **{z}** | **{w}** |

### Files Created
- {context.metadataPath}/flowtests/{TestName}.flowtest-meta.xml x {n}

### Warnings
- {n} tests use hardcoded IDs — will only pass in orgs with matching RecordType/ID values
- {n} tests need lookup field IDs populated before running
- {n} flows had no documentation — test scenarios based on XML analysis only
- {n} flows have no fault paths defined (coding standards recommend fault paths on all DML)

### Skipped (not record-triggered): {n} flows
  - {FlowName} — {type} (screen / scheduled / autolaunched / platform event)

### Skipped (filtered): {n} flows
  - Inactive: {list if any}
  - Managed package: {list if any}
  - Sunset: {list if any}
  - One-time/migration: {list if any}
  - Delete-triggered: {list if any}
  - Already tested (unchanged): {list if any}

### Next Steps
1. **Review generated tests** — check field values and assertions for accuracy
2. **Populate lookup fields** — fill in real record IDs for any tests flagged with lookup dependencies
3. **Deploy to dev sandbox:** `/deploy-changed`
4. **Run tests from CLI:**
   ```bash
   sf flow run test --name "{FlowTestName}" --target-org {target-org}
   sf flow get test --name "{FlowTestName}" --target-org {target-org}
   ```
   Or run all Apex + Flow tests together: `sf logic run test --target-org {target-org}`
   UI alternative: Setup > Flows > {FlowName} > View Tests > Run All
5. **Fix failures and iterate** — re-run `/test-flows {FlowName}` to regenerate after flow changes
6. **Commit:** `/devops-commit WI-{number}`
```

---

## Guard Rails

1. **Never auto-deploy.** Always present the test plan (Step 5) and wait for user confirmation before writing files. Never deploy without explicit user request.
2. **Never overwrite existing tests without confirmation.** If test files already exist for a flow, show what would change and ask.
3. **Schema bootstrap is mandatory.** Refuse to generate tests if `config/flowtest-schema/sample.flowtest-meta.xml` does not exist. Always go through the bootstrap flow.
4. **Do not fabricate Salesforce record IDs.** For lookup/reference fields, note the dependency — never invent fake 15/18-character IDs.
5. **Flag org-specific values.** Any test using hardcoded IDs or RecordType IDs gets a prominent warning in the description and report.
6. **Respect test caps.** 8 tests per flow, 50 per run. For large batches, process in groups of 10 and report between groups.
7. **API version alignment.** Generated tests use the project's API version from `{context.apiVersion}` (resolved from `sfdx-project.json`), or match the flow's `<apiVersion>` if different.
