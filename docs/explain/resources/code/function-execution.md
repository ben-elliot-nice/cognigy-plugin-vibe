---
topic: function-execution
description: async pattern, inject-back via sessions API, create-body-shape gap
---

## function-execution — Cognigy Functions (Async Pattern)

### What Cognigy Functions are

Serverless JS/TS functions that run outside the flow on Cognigy infrastructure.
Used for long-running async operations (>30s timeout for flows).

### Execute a function

cognigy_invoke(resource_type="functions", resource_id=<functionId>,
operation="execute", body={"parameters": {...}})
Path: POST /v2.0/functions/{functionId}/instances

### Check instance status

cognigy_get(resource_type="functioninstances", resource_id=<instanceId>)
Returns: {status: "pending"|"running"|"done"|"error", result: {...}}

### Inject result back into conversation

cognigy_invoke(resource_type="sessions", resource_id=<sessionId>,
operation="inject-context", body={"context": {"functionResult": result}})

### In-flow pattern

Use Function Execution node (not raw API) when available.
The node handles invoke + polling + inject natively.

### Session ID for inject

The sessionId is the same value used in talk_to_agent.
In production: comes from input.sessionId within the flow.

### Creating a Function (resource_type="functions") — no verified body shape yet

Everything above covers _invoking_ an existing function. Creating a new
Function resource via `cognigy_create(resource_type="functions", body={...})`
has not been verified against a live Cognigy environment or any working code
in this repo — do not guess field names (e.g. source code field, runtime,
timeout) from other providers' conventions.

Discovery recipe if you need to create one:

1. If a Function already exists in the target project, read its real shape:
   cognigy_list(resource_type="functions", project_id="<projectId>", full_objects=true)
2. Fall back to describe_resource_schema(resource_type="functions", operation="create") —
   it looks up the field-level shape directly from the live OpenAPI spec (no session
   cookie needed, just the same API key already configured).
