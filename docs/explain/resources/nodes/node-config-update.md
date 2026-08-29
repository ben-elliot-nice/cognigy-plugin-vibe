---
topic: node-config-update
description: full-replace semantics, merge_config pattern, silent field deletion
---

## node-config-update — Safe Config Updates

### CRITICAL: Cognigy PATCH is FULL REPLACE on config

If you PATCH {"config": {"code": "..."}} on a code node that also has
{"config": {"code": "...", "preview": "..."}} — the preview field is SILENTLY DELETED.

### Always use merge_config=True for partial updates

cognigy_update(resource_type="node", resource_id=..., merge_config=True, body={
"config": {"code": "new code here"}
})
This will GET current config, deep-merge your changes, then PATCH.

### Safe pattern for any update

1. cognigy_get to see current state
2. cognigy_update with merge_config=True
3. cognigy_get again to confirm

### Known fields silently deleted if not included

- code nodes: preview, triggers
- aiAgentJobTool: conditions array when updating toolId only
- Any node: position.x/y when updating config without including position

### Object-typed config fields: unguarded CognigyScript can drop keys entirely

Any object-typed config field (e.g. `sendMetadata`) that interpolates a
CognigyScript expression which can resolve to `undefined` will have that key
OMITTED from the serialized payload, not rendered as an empty string — see
explain("cognigyScript") for the full mechanism and the guard pattern.

### GoTo node: use referenceId (UUID), NOT \_id (hex)

GoTo nodes reference their target flow by UUID referenceId, not the hex \_id.
// flow.\_id = "64a3f1c2b9e7d05a8c4f2e91" ← hex, DO NOT use
// flow.referenceId = "550e8400-e29b-..." ← UUID, USE THIS
Get referenceId from cognigy_get(resource_type="flows", resource_id=...) → result.referenceId

### Chart endpoint returns metadata only

GET /v2.0/flows/{id}/chart returns node structure and positions only.
Node config fields are NOT included — use cognigy_get(resource_type="node", ...) to read config.

### setContext node: one entry per node

The setContext node stores only the FIRST entry in `contextEntries`, even if multiple
are provided. Additional entries are silently ignored. (Verified: cognigy-plugin R&D
repo documentation, 2026-07-07.)

WRONG — only "greeting" is written, "authenticated" is dropped:
{ "contextEntries": [{ "key": "greeting", "value": "Hi" }, { "key": "authenticated", "value": "false" }] }

CORRECT — one setContext node per value:
Node 1: { "contextEntries": [{ "key": "greeting", "value": "Hi" }] }
Node 2: { "contextEntries": [{ "key": "authenticated", "value": "false" }] }

ALSO CORRECT — use a Code node to write multiple values at once:
context.greeting = "Hi";
context.authenticated = false;
