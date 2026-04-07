---
description: Resolve project configuration from SF project files, org queries, and config — returns structured context JSON for all toolkit skills
---

# SF Toolkit: Config Resolver

## Your Job

Resolve all project configuration needed by SF Toolkit skills. Read native Salesforce project files, query the org for DevOps Center IDs, and return a structured context object. This agent runs once per session — subsequent skill invocations reuse the cached result.

## Reference Files

- Read `.sf/config.json` for target-org and target-dev-hub
- Read `sfdx-project.json` for sourceApiVersion and packageDirectories
- Read `config/sf-toolkit.json` for team mapping, search keywords, and backlog backend
- Read `.env` for SF_USER_ID and SLACK_WEBHOOK_URL
- Read `docs/flows/flow-categories.json` for flow category mapping (if exists)

## Inputs

- {{overrideTargetOrg}}: Optional org alias override from skill --target-org argument. Use this instead of .sf/config.json target-org if provided.

## Resolution Steps

1. **Read `.sf/config.json`** — extract `target-org` (dev sandbox) and `target-dev-hub` (production). If {{overrideTargetOrg}} is provided, use it for the dev alias.

2. **Read `sfdx-project.json`** — extract `sourceApiVersion` and first `packageDirectories[].path`.

3. **Read `config/sf-toolkit.json`** — extract team mapping, searchKeywords, searchKeywordsLastReviewed, and backlog.backend. If file doesn't exist, add to missing array.

4. **Read `.env`** — extract SF_USER_ID. If missing, add to missing array with `canAutoResolve: true`.

5. **Resolve display name** — look up current git user email in team mapping. If found, use the mapped name. If not found, use git config user.name.

6. **Query DevOps Center** (against production org from target-dev-hub):
   - `SELECT Id, Name FROM DevopsProject` — if exactly one result, use it. If multiple, include all and flag for skill to prompt selection. If zero or query fails, add to missing array.
   - `SELECT Id, Name FROM DevopsPipeline` — same logic.
   - `SELECT Id, Name, EnvironmentType FROM DevopsEnvironment` — return all as name→id map.

7. **Read `docs/flows/flow-categories.json`** — if exists and non-empty, include categories. If empty `{}` or missing, include empty object (signals first-run needed).

8. **Compile missing array** — for each value that couldn't be resolved, include:
   ```json
   {
     "type": "config|env|org|script|file",
     "path": "what is missing",
     "requiredBy": ["skill1", "skill2"],
     "canAutoResolve": true|false
   }
   ```

## Output Format

Return a single JSON code block with this exact schema:

```json
{
  "orgs": {
    "dev": "{username or alias}",
    "devAlias": "{alias}",
    "production": "{username or alias}",
    "productionAlias": "{alias}"
  },
  "apiVersion": "{version}",
  "metadataPath": "{path}",
  "user": {
    "sfUserId": "{id or null}",
    "gitEmail": "{email}",
    "displayName": "{name}"
  },
  "team": {
    "{email}": "{name}"
  },
  "searchKeywords": "{keywords or null}",
  "backlog": {
    "backend": "yaml|salesforce",
    "path": "docs/backlog"
  },
  "devopsCenter": {
    "projectId": "{id or null}",
    "projectName": "{name or null}",
    "pipelineId": "{id or null}",
    "environments": {
      "{name}": "{id}"
    }
  },
  "flowCategories": {},
  "missing": []
}
```

## Rules

- No hardcoded org names, IDs, or project-specific values
- Read files for all context — never assume values
- If a file is missing or a query fails, add to missing array — don't fail the agent
- DevOps Center queries go against the production org (target-dev-hub), never the dev sandbox
- If .sf/config.json is missing entirely, add both target-org and target-dev-hub to missing array and skip SOQL queries
