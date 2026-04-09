---
name: doc-components
description: Generate technical documentation for hybrid component stacks (LWC → Apex → Flow)
---

# /doc-components — Hybrid Component Stack Documentation

Generate technical documentation for LWC + thin Apex + headless Flow component stacks. Documents the full hybrid pattern as a single unit — the LWC UI layer, its Apex controller, and the headless flows it invokes.

**Scope:** New components built with the hybrid pattern that go through the DevOps pipeline. Legacy LWC components (pre-initiative) are excluded unless explicitly requested.

**Arguments:** `$ARGUMENTS`

Arguments can be:

- A component name (LWC folder name): e.g. `paymentForm`
- `all` — document every eligible hybrid component (confirm with user before starting)
- Empty — check for undocumented components and ask the user which to document
- `--target-org {alias}` — override the org for verification queries (defaults to `{context.orgs.devAlias}`)

---

## Resolution

**Cache-first resolution:**

1. Read `.claude/sf-toolkit-cache.json` in the project root.
2. If the file exists and `_cache.expiresAt` is after the current date/time, **and** no `--target-org` override was provided:
   - Read `.sf/config.json` — confirm `target-org` matches `orgs.devAlias` in the cached context.
   - If it matches: use the cached context (all keys except `_cache`). **Skip the agent dispatch.**
3. If the cache is missing, expired, or the org alias doesn't match: dispatch the `sf-toolkit-resolve` agent. It will resolve fresh context and update the cache.

Use the returned context for all org references, team lookups, and path resolution in subsequent steps. If `missing` contains values this skill requires, stop and instruct the developer to run `/setup`.

---

## Step 1 — Determine Scope

Parse `$ARGUMENTS`:

1. If empty: scan `{context.metadataPath}/lwc/` for components not in the skip list, cross-reference against existing docs in `docs/components/`. List undocumented components and ask the user which to document.
2. If a component name: locate `{context.metadataPath}/lwc/{componentName}/`.
3. If `all`: list all non-skipped components, show count, confirm before proceeding.

### Skip List

Components excluded by default (document only if explicitly requested). The skip list is maintained in `docs/components/skip-list.json` (project-specific, initialized as `[]` by `/setup`).

Read the skip list:

```bash
cat docs/components/skip-list.json
```

If the file does not exist, treat the skip list as empty and warn the user to run `/setup` or create the file manually.

Update the skip list in `docs/components/skip-list.json` when new legacy or excluded components are identified — not inline in this skill.

---

## Step 2 — Discover the Stack

For each component in scope, map the full hybrid stack:

### 2a — LWC Layer

Read the component directory (`{context.metadataPath}/lwc/{componentName}/`):

- `{componentName}.js` — imports, `@api` properties, `@wire` methods, event handlers, imperative Apex calls
- `{componentName}.html` — template structure, conditional rendering, iteration, event bindings
- `{componentName}.js-meta.xml` — targets (Lightning page, Experience page, Flow screen), API version, design attributes
- `{componentName}.css` — custom styles (if present)
- Any utility modules (e.g., helper JS files)

Extract:

- **Public API:** All `@api` properties with types and descriptions
- **Apex controller:** Class name from `import ... from '@salesforce/apex/{ClassName}.{methodName}'`
- **Wire adapters:** Any `@wire` decorators (Lightning Data Service, custom Apex)
- **Events fired:** `CustomEvent` names and detail payloads
- **Events handled:** Event listener registrations
- **External dependencies:** CDN scripts, platform imports (`@salesforce/label`, `@salesforce/schema`)
- **Targets:** Where the component can be placed (from `.js-meta.xml`)

### 2b — Apex Controller Layer

If an Apex controller was identified in 2a, read the class file (`{context.metadataPath}/classes/{ClassName}.cls`):

- **Methods:** `@AuraEnabled` methods — name, parameters, return type, cacheable flag
- **Security model:** `with sharing` / `without sharing` / `inherited sharing`, FLS enforcement (`USER_MODE`, `SECURITY_ENFORCED`, `stripInaccessible`)
- **SOQL queries:** Objects queried, filter criteria, fields selected
- **DML operations:** Objects created/updated/deleted
- **Callouts:** External service calls (REST callouts, managed package integrations)
- **Flow invocations:** Any `Flow.Interview` references or `@InvocableMethod` annotations
- **Test class:** Matching test class (from `@testClass` header tag or `Test_{ClassName}` convention)

### 2c — Headless Flow Layer

Identify connected headless autolaunched flows:

1. **From Apex:** Search the controller for `Flow.Interview.{FlowName}` references
2. **From LWC:** Search for `lightning-flow` component usage or `flowApiName` references in JS
3. **From design docs:** Check `docs/design/` for design documents matching the component name
4. **From org (if connected):** Query `FlowDefinitionView` for flows with names matching the component's domain

For each connected flow:

- Check if `/doc-flows` has already documented it at `docs/flows/{category}/{FlowName}.md`
- If documented: link to existing doc. Read its Purpose section for the component doc.
- If not documented: flag it for `/doc-flows` in the Step 8 report

---

## Step 3 — Check Design Docs

Look for a design document under `docs/design/` that matches the component:

```bash
ls docs/design/
```

If a matching design doc exists, read it to extract:

- Original requirements and business context
- Architecture decisions (why this pattern was chosen)
- Integration points not obvious from code (e.g., event bridge pattern for CDN scripts)
- Security considerations documented during design

This context enriches the Purpose and Architecture Decisions sections of the output.

---

## Step 4 — Verify Against Org (Optional)

If the target org is connected, verify deployed state:

1. **LWC exists in org:**

   ```soql
   SELECT Id, DeveloperName, ApiVersion FROM LightningComponentBundle WHERE DeveloperName = '{componentName}'
   ```

2. **Apex controller exists:**

   ```soql
   SELECT Id, Name, ApiVersion, Status FROM ApexClass WHERE Name = '{ClassName}'
   ```

3. **Test coverage (Apex):**
   ```soql
   SELECT NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate WHERE ApexClassOrTrigger.Name = '{ClassName}'
   ```

If org is unreachable, skip with a warning — documentation proceeds from source only.

---

## Step 5 — Write Component Documentation

**File path:** `docs/components/{componentName}.md`

Create `docs/components/` if it doesn't exist.

### Documentation Template

````markdown
# {Human-Readable Component Name}

**LWC:** `{context.metadataPath}/lwc/{componentName}/`
**Apex Controller:** `{context.metadataPath}/classes/{ClassName}.cls`
**Test Class:** `{context.metadataPath}/classes/{TestClassName}.cls`
**Pattern:** LWC → Thin Apex → Headless Flow
**Targets:** {Lightning Page, Experience Page, Flow Screen — from .js-meta.xml}
**API Version:** {from .js-meta.xml}
**Last Documented:** {today's date}

## Purpose

{2-4 sentence description of what this component does, why it exists, and what business problem it solves. Draw from design doc if available.}

## Architecture

{Describe the hybrid pattern as implemented for this component. How the LWC, Apex, and Flow layers interact. Note any deviations from the standard pattern (e.g., event bridge for CDN scripts, standalone placement vs Flow screen). Reference the design doc if one exists.}

### Data Flow

```mermaid
sequenceDiagram
    participant U as User
    participant L as LWC
    participant A as Apex Controller
    participant F as Headless Flow
    participant S as Salesforce

    {Sequence showing how data moves through the stack. Include external services if applicable.}
```

## LWC Layer

### Public API (`@api` Properties)

| Property   | Type   | Description        |
| ---------- | ------ | ------------------ |
| {propName} | {type} | {what it controls} |

_Omit if no `@api` properties._

### Events

| Event Name  | Direction       | Payload        | Description    |
| ----------- | --------------- | -------------- | -------------- |
| {eventName} | Fired / Handled | {detail shape} | {when and why} |

_Omit if no custom events._

### External Dependencies

| Dependency | Type                               | Purpose            |
| ---------- | ---------------------------------- | ------------------ |
| {name}     | CDN Script / Platform Import / npm | {what it provides} |

_Omit if no external dependencies beyond standard LWC imports._

## Apex Controller — `{ClassName}`

**Sharing:** {with sharing / without sharing / inherited sharing}
**FLS Enforcement:** {USER_MODE / SECURITY_ENFORCED / stripInaccessible / none}

### Methods

| Method       | Parameters         | Returns      | Cacheable | Purpose        |
| ------------ | ------------------ | ------------ | --------- | -------------- |
| {methodName} | {param: Type, ...} | {ReturnType} | {Yes/No}  | {what it does} |

### Security Notes

{Any security-relevant details: sharing model justification, FLS approach, CRUD checks, callout authentication method.}

## Connected Flows

| Flow                                            | Type                    | Documentation               | Purpose            |
| ----------------------------------------------- | ----------------------- | --------------------------- | ------------------ |
| [{FlowName}](../flows/{category}/{FlowName}.md) | {Autolaunched / Screen} | {Documented / Undocumented} | {one-line purpose} |

_Omit if the component does not invoke any flows._

## Test Coverage

### Apex Tests — `{TestClassName}`

| Test Method      | Scenario        | Category                                  |
| ---------------- | --------------- | ----------------------------------------- |
| {testMethodName} | {what it tests} | {Positive / Negative / Bulk / Permission} |

**Coverage:** {n}% ({n}/{n} lines) — _from org query or "source-only, verify after deploy"_

### Jest Tests

| Test File      | Scenario        |
| -------------- | --------------- |
| {testFileName} | {what it tests} |

_Omit sections with no tests. Note any testing gaps._

## Dependencies

- **Objects read:** {list}
- **Objects written:** {list}
- **Managed packages:** {list, if any}
- **Platform features:** {Experience Cloud, Lightning App Builder, etc.}
- **Related components:** {other LWCs that interact with this one}

## Notes

{Known quirks, governor limit concerns, browser compatibility notes, Experience Cloud template considerations, or links to design documents.}

## Change Log

| Date           | Description                                  |
| -------------- | -------------------------------------------- |
| {today's date} | {Initial documentation / change description} |

{Append new rows at the top (newest first). Preserve all prior entries.}
````

---

## Step 6 — Update Component Index

**File path:** `docs/components/_index.md`

Create if it doesn't exist. Update with newly documented components.

```markdown
# Component Documentation Index

**Component count:** {n} documented
**Last updated:** {today's date}

## Overview

Technical documentation for LWC hybrid-pattern components (LWC + thin Apex + headless Flow). Legacy components pre-dating the hybrid architecture are not included unless individually documented.

## Components

| Component                               | Apex Controller | Connected Flows | Targets   | Purpose            |
| --------------------------------------- | --------------- | --------------- | --------- | ------------------ |
| [{componentName}](./{componentName}.md) | {ClassName}     | {flow count}    | {targets} | {one-line purpose} |

## Architecture Pattern

All documented components follow the **LWC → Thin Apex → Headless Flow** pattern:

- **LWC** handles UI rendering, user interaction, and client-side validation
- **Thin Apex controller** provides `@AuraEnabled` methods with FLS enforcement
- **Headless autolaunched Flows** contain business logic (admin-changeable without code deploys)

See [Architecture Rules](../../CLAUDE.md) and [Coding Standards](../coding-standards.md) for the full pattern specification.
```

---

## Step 7 — Cross-Reference Flow Docs

For each headless flow connected to the documented component, update its flow documentation to add a cross-reference.

If `docs/flows/{category}/{FlowName}.md` exists, add to its **Dependencies** section:

```markdown
- **Called by LWC:** [{componentName}](../../components/{componentName}.md) via {ClassName}.{methodName}
```

If the flow doc doesn't have a Dependencies section, add one. If the cross-reference already exists, skip.

**Do not modify flow XML files** — this skill only writes markdown documentation.

---

## Step 8 — Report Results

```text
## /doc-components Complete

**Documented:** {n} components
  - {componentName} — {change description}
    LWC: {file count} files | Apex: {ClassName} | Flows: {n} connected
  - ...

**Flow cross-references updated:** {n} flow docs
  - {FlowName} — added "Called by LWC: {componentName}" to Dependencies
  - ...

**Undocumented connected flows (run /doc-flows):** {n}
  - {FlowName} — invoked by {componentName}, no doc at docs/flows/
  - ...

**Skipped (in skip list):** {n} components
  - {componentName} — in docs/components/skip-list.json
  - ...

**Testing gaps identified:**
  - {componentName} — missing Jest tests
  - {ClassName} — {n}% coverage (below 90% target)
  - ...

**Files written:**
- docs/components/_index.md (created/updated)
- docs/components/{componentName}.md (created/updated) x {n}
- docs/flows/{category}/{FlowName}.md (cross-reference added) x {n}

Next steps:
1. Commit docs: `git add docs/components/ docs/flows/ && git commit -m "[docs-only] Document {componentName} component stack"`
2. Run `/doc-flows {flowNames}` for any undocumented connected flows.
```
