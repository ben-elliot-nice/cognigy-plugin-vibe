---
topic: llm-resources
description: org-level vs project-level LLMs, assign_org_llm tool, discovery pattern, referenceId resolution, manage_packages fallback
---

## llm-resources — LLM Discovery and Project Assignment

### resourceLevel: organisation vs project

Every LLM on a Cognigy tenant has a `resourceLevel` field:

- `"organisation"` — tenant-wide model managed by an admin. Visible to all projects that have been granted access via `assignedToProjects`. This is the standard model for shared demo builds.
- `"project"` — lives only inside one project. Not accessible from other projects without a `manage_packages` export/import.

### Discovering available LLMs

Call `cognigy_list` **without** a `project_id` to get all LLMs on the tenant (both org-level and project-level):

```
cognigy_list {
  resource_type: "largelanguagemodels",
  full_objects: true,
  fields: ["_id", "name", "referenceId", "resourceLevel", "modelType", "provider"]
}
```

Filter for org-level generation models:

- Keep: `resourceLevel == "organisation"`
- Exclude: `modelType` contains `"embedding"` (case-insensitive)

This gives the list to present to users during setup — real names, not hardcoded UUIDs.

To list LLMs scoped to a specific project (e.g. to verify before generation):

```
cognigy_list { resource_type: "largelanguagemodels", project_id: "<projectId>", full_objects: true,
               fields: ["_id", "name", "referenceId", "modelType", "provider"] }
```

### referenceId resolution

Builders configure LLMs by **label** (readable, stable across people); the build needs the **`referenceId`**. Resolve label → referenceId by listing with `full_objects: true` and matching on `name`. Never hardcode a referenceId — confirm it exists in the **target** project first.

### Assigning an org-level LLM to a new project

Use `assign_org_llm` after creating the agent resource (`cognigy_create(resource_type="aiagents", ...)`). It appends the project to the LLM's `assignedToProjects` list safely:

```
assign_org_llm {
  project_id: "<new project _id>",
  llm_id: "<org-level LLM _id — NOT referenceId>"
}
```

Returns:

- `{ already_assigned: true, llm_name: "..." }` — no write made (idempotent, safe to call twice)
- `{ assigned: true, llm_name: "...", project_id: "..." }` — project added
- `{ error: "not_org_level", hint: "..." }` — LLM is project-scoped; use `manage_packages` instead
- `{ error: "llm_not_found", llm_id: "..." }` — bad `llm_id`

**Always use `assign_org_llm`, never hand-write the GET+PATCH.** The raw PATCH requires sending the full `assignedToProjects` array — a hand-written PATCH that omits an entry drops it. `assign_org_llm` prevents this by reading the current array before writing.

> **Concurrency note.** `assign_org_llm` prevents duplicate entries (if the project is already in the array, it skips the PATCH) but does not protect against two simultaneous _first_-assignment calls targeting the same LLM. In that race, both calls read the same pre-write array, and each writes a version without the other's entry — one assignment is lost. In practice this is harmless for demo builds (sequential per-build usage), but do not rely on it for concurrent automated provisioning.

### Activating an LLM for Generative AI use-cases at the project level

`assign_org_llm` only appends a project to an LLM's `assignedToProjects` array — it does **not**
make the project actually use that model for Cognigy's Generative AI features (agent generation,
prompt nodes, sentiment analysis, knowledge search, etc.). That requires a separate project-level
settings PATCH:

```
set_project_generative_ai_settings {
  project_id: "<projectId>",
  use_case_settings: {
    "aiAgent": "<llm _id>",
    "knowledgeSearch": "<embedding llm _id>"
    // ... any of: gptPromptNode, aiEnhancedOutputs, sentimentAnalysis,
    //     designTimeGeneration, answerExtraction, conversationAnalyzer
  }
}
```

This PATCHes `generativeAISettings.useCasesSettings` on the project resource. It merges by
use-case key — a partial call only touches the keys you pass, leaving other use-cases untouched.
Call this **in addition to** `assign_org_llm`, not instead of it: the project needs both the LLM
assigned to it (`assign_org_llm`) and told which use-cases should use it (`set_project_generative_ai_settings`).

`use_case_settings` keys are validated against the known use-case set (the seven generation
use-cases plus `knowledgeSearch`) before the PATCH is sent — an unrecognised key (e.g. a typo like
`knowledgesearch`) returns `{"error": "unknown_use_case", "unknown_keys": [...], "allowed_keys": [...]}`
instead of being forwarded to the API.

For Knowledge AI specifically, the `knowledgeSearch` use-case must be set to an **embedding**
model's `_id` (not a generation model's) — see `explain("knowledge-store")`.

### Reading a project's current Generative AI settings

`generativeAISettings` is **not** returned by `cognigy_get(resource_type="projects", resource_id=<projectId>)`
— that call hits `GET /v2.0/projects/<projectId>`, which only returns top-level project fields
(`_id`, `name`, `color`, `primaryLocaleReference`, etc). The settings live on a separate
sub-resource, `GET /v2.0/projects/<projectId>/settings`, which is not modeled as its own
`resource_type`.

Reach it with the existing `cognigy_get` tool by appending `/settings` to `resource_id` — the tool
builds its path as `/v2.0/{resource_type}/{resource_id}` with no validation against slashes, so
this composes into the right URL without any new tool:

```
cognigy_get {
  resource_type: "projects",
  resource_id: "<projectId>/settings",
  fields: ["generativeAISettings"]
}
```

This returns the full `useCasesSettings` map (each use-case's current `largeLanguageModelId`) plus
other project-wide settings (`audioPreviewSettings`, `knowledgeAISettings`, `timezone`, etc) that
live on the same sub-resource. Use `fields` to trim the response to just what you need.

### When `manage_packages` is still appropriate

If the user's chosen LLM is `resourceLevel: "project"` (e.g. a custom connection not promoted to org level), `assign_org_llm` will refuse. Export the LLM from its source project and import it into the new project:

```
manage_packages { operation: "list_exportable", projectId: "<source project id>" }
# → find the llm_model resource id

manage_packages {
  operation: "export",
  projectId: "<source project id>",
  resourceIds: ["<llm_model id>"],
  includeDependencies: true,
  outputPath: "<absolute path>/llm-backup.zip",
  waitForCompletion: true
}

manage_packages {
  operation: "import",
  projectId: "<new project id>",
  packagePath: "<absolute path>/llm-backup.zip",
  waitForCompletion: true
}
```

### `_id` vs `referenceId`

- `_id` — MongoDB ObjectId hex string. Required by `assign_org_llm` and for direct API calls (`GET /v2.0/largelanguagemodels/<_id>`).
- `referenceId` — UUID. Required by the `aiAgentJob` node's `config.llmProviderReferenceId` — see `explain("agent-job-node")`.

Both are returned by `cognigy_list`. Store both in `buildConfig.llm.options[]` (`id` for assignment, `referenceId` for the job config patch).

### Confirming the resource path per region

`largelanguagemodels` is the standard path across regions. If a `cognigy_list` returns unexpected results on a non-AU1 tenant, confirm the exact collection name against that environment's OpenAPI spec (`GET https://cognigy-api-<region>.nicecxone.com/openapi/openapi-viewer.json`) — the spec is the source of truth for resource paths.

### Connections are project-scoped

Every Cognigy Connection belongs to exactly one project. A `connectionId` from project A
cannot be used in project B — it will fail with "Connection does not exist".

This is why `manage_packages` exports BOTH the LLM resource and its connection together.
Passing a cross-project `connectionId` directly to any tool (Knowledge AI settings,
direct API calls, etc.) will always fail.

Rules:

- Never reuse a `connectionId` across projects
- When exporting an LLM for transfer, always include its connection in the same package
- When multiple LLMs share one connection in the source project, export all of them
  together with that single connection in one package — do not re-import the same
  connection in a separate package later
