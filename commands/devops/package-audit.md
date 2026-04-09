---
name: package-audit
description: Installed managed package dependency audit
---

# /package-audit — Installed Package Dependency Audit

Analyze an installed Salesforce package to identify all components, map dependencies, and classify each as REMOVE / REVIEW / REWORK for uninstall planning.

**Arguments:** `<package-name> [--target-org <alias>]`

- `package-name` — Full or partial name of the installed package (e.g., "Stripe Billing", "bt_stripe")
- `--target-org` — Salesforce org alias to audit (default: resolved dev alias)

## Resolution

**Cache-first resolution:**

1. Read `.claude/sf-toolkit-cache.json` in the project root.
2. If the file exists and `_cache.expiresAt` is after the current date/time, **and** no `--target-org` override was provided:
   - Read `.sf/config.json` — confirm `target-org` matches `orgs.devAlias` in the cached context.
   - If it matches: use the cached context (all keys except `_cache`). **Skip the agent dispatch.**
3. If the cache is missing, expired, or the org alias doesn't match: dispatch the `sf-toolkit-resolve` agent. It will resolve fresh context and update the cache.

Use the returned context for all org references, team lookups, and path resolution in subsequent steps. If `missing` contains values this skill requires, stop and instruct the developer to run `/setup`.

---

## Step 0 — Parse Arguments & Validate

```
TARGET_ORG = argument --target-org, or {context.orgs.devAlias} if not provided
PACKAGE_NAME = first positional argument (required)
```

If `PACKAGE_NAME` is empty, stop and ask the user which package to audit.

Verify org connectivity:

```bash
sf org display --target-org {TARGET_ORG} --json
```

If the org matches `{context.orgs.productionAlias}` or contains "prod"/"production", warn:

```
⚠ Targeting production org ({TARGET_ORG}). This skill is READ-ONLY — no changes will be made.
```

---

## Step 1 — Identify the Package

Query installed packages via Tooling API:

```soql
SELECT Id, SubscriberPackage.Name, SubscriberPackage.NamespacePrefix,
       SubscriberPackageVersion.Name, SubscriberPackageVersion.MajorVersion,
       SubscriberPackageVersion.MinorVersion
FROM InstalledSubscriberPackage
```

Match the user's `PACKAGE_NAME` against `SubscriberPackage.Name` (case-insensitive partial match).

If no match found, list all installed packages and ask the user to select.

If match found, display:

```
Package: {name}
Namespace: {prefix or "(none)"}
Version: {version name} ({major}.{minor})
Type: {Managed / Unlocked / Unmanaged}
```

Retrieve the `SubscriberPackageVersion` details via REST API to get:

- `Package2ContainerOptions` (Managed/Unlocked)
- `IsManaged`
- `Dependencies` (other packages this depends on)
- `RemoteSiteSettings`
- `Profiles` (source profiles)

---

## Step 2 — Inventory Package Components

Query each metadata type via Tooling API for components with the package's `ManageableState`:

- For managed packages with namespace: filter by `NamespacePrefix = '{namespace}'`
- For unlocked/unmanaged (no namespace): filter by `ManageableState = 'installedEditable'` AND `NamespacePrefix = null`

**WARNING:** For no-namespace packages, `installedEditable` may include components from OTHER unlocked packages. Cross-reference component names against the package's domain to filter.

### Metadata types to query:

| Type                              | Tooling API sObject     | Key Fields                                                                                                                                  |
| --------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom Objects                    | `CustomObject`          | `DeveloperName, ManageableState, NamespacePrefix`                                                                                           |
| Custom Fields on Standard Objects | `CustomField`           | `DeveloperName, TableEnumOrId, ManageableState` (filter `TableEnumOrId IN ('Account','Contact','Opportunity','Lead','Case','Task','User')`) |
| Apex Classes                      | `ApexClass`             | `Name, ManageableState`                                                                                                                     |
| Apex Triggers                     | `ApexTrigger`           | `Name, ManageableState, TableEnumOrId`                                                                                                      |
| Visualforce Pages                 | `ApexPage`              | `Name, ManageableState`                                                                                                                     |
| Aura Components                   | `AuraDefinitionBundle`  | `DeveloperName, ManageableState`                                                                                                            |
| Lightning Pages                   | `FlexiPage`             | `DeveloperName, ManageableState, Type, EntityDefinitionId`                                                                                  |
| Lightning Actions                 | `QuickActionDefinition` | `DeveloperName, SobjectType, ManageableState`                                                                                               |

Present inventory as a summary table:

```
## Package Inventory

| Type | Count | Examples |
|---|---|---|
| Custom Objects | {n} | {first 5 names} |
| Apex Classes | {n} | {first 5 names} |
| ... | | |
```

---

## Step 3 — Map Dependencies

For each component type, check what references it from OUTSIDE the package:

### 3a. Flow References

Search source XML in `{context.metadataPath}/flows/` for exact object references using the pattern `>ObjectName__c<` (XML element value match). Do NOT use substring matching — it produces false positives (e.g., "Transaction__c" matching "Billing_Transaction__c").

### 3b. Apex Class → Aura/VF/LWC References

For each Apex class, check if Aura components, VF pages, or LWC components reference it. The fastest way: attempt a dry-run destructive deploy of a small batch and read the error messages — Salesforce will list all referencing components.

### 3c. Lightning Page Assignments

Check if any package FlexiPages are assigned as active record pages (action overrides on objects) or referenced by Lightning Apps.

### 3d. Lightning Action → Layout References

Lightning Actions on standard objects may be embedded in page layouts. Dry-run destructive deploy will surface these.

### 3e. Experience Cloud References

Check if Aura components are embedded in Experience Cloud sites by querying `Network` for active sites and examining the dry-run errors for site references.

### 3f. Scheduled/Queued Apex

Query `CronTrigger` for scheduled package classes.

### 3g. Integration Config

If the org uses managed integration packages, grep for package component names in relevant custom metadata.

---

## Step 4 — Classify Components

Apply the REMOVE / REVIEW / REWORK taxonomy to every component:

- **REMOVE** — Component is built entirely on legacy/deprecated objects, has no external references, or all references are also being removed. Safe to delete.
- **REVIEW** — Component touches standard objects (User, Task, Account) or has ambiguous references. Needs code/config review to determine if logic is still active. After review, reclassify as REMOVE or REWORK.
- **REWORK** — Component has mixed references (both package and active platform objects/logic). Requires surgical editing to remove package references while preserving active functionality. Or: still-active logic must be extracted and recreated outside the package.

**Triage rules:**

- Triggers/classes that ONLY touch package custom objects → REMOVE
- Triggers/classes on standard objects (User, Task, Account) → REVIEW (read source, produce narrative summary)
- Flows built 100% on package objects → REMOVE
- Flows mixing package + active objects → REWORK
- Aura/VF components referenced by active Experience Cloud sites → cannot remove without replacement
- FlexiPages with active assignments → must deactivate before removal
- Lightning Actions on page layouts → must remove from layouts before deletion

---

## Step 5 — Generate Report

Write the audit report to `docs/{package-short-name}-audit-report.md` with these sections:

1. **Executive Summary** — package name, type, namespace, component counts, key findings
2. **Package Inventory** — full component tables by type
3. **Dependency Analysis** — flow references, Apex→Aura dependencies, page assignments, scheduled jobs
4. **Classification Summary** — REMOVE / REVIEW / REWORK counts and component lists
5. **Trigger & Class Narratives** — for REVIEW items on standard objects, read source and summarize purpose
6. **Recommended Removal Phases** — phased approach based on dependency order
7. **Risk Factors** — no-namespace identification challenges, data loss, community component dependencies

---

## Step 6 — Present Summary

```
## Audit Complete

Package: {name} ({version})
Report: docs/{package-short-name}-audit-report.md

| Classification | Count |
|---|---|
| REMOVE | {n} components |
| REVIEW | {n} components |
| REWORK | {n} components |

Key findings:
- {1-3 bullet summary of most important findings}

Next step: Review the REVIEW items, then build destructive deployment manifests for REMOVE items.
```

---

## Behavior Notes

- This skill is **read-only**. It queries the org and reads source files but never deploys or modifies anything.
- For no-namespace packages, clearly warn that `installedEditable` components may come from multiple packages.
- Use SOQL file approach (`scripts/soql/`) for Tooling API queries to avoid PowerShell quoting issues on Windows.
- When reading Apex source for narrative summaries, use the Tooling API `Body` field — the source may not exist in the local repo if it's a package component.
- Save reusable SOQL queries to `scripts/soql/` for future audits.
