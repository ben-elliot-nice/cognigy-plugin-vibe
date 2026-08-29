---
topic: flow-resource
description: no verified create/update body shape yet — discovery recipe for resource_type=flows (raw flow creation, distinct from flow/clone via cognigy_invoke)
---

## flow-resource — No Verified Body Shape Yet

If you just need a copy of an existing flow, cognigy_invoke(resource_type="flow", resource_id=<flowId>, operation="clone") is a confirmed working shortcut — see the mapping in flow_ops.py's \_invoke_path. This topic is only about creating a flow from scratch, which is unverified.

No confirmed `cognigy_create`/`cognigy_update` body shape exists for
`resource_type="flows"` in this codebase — no live-verified example and no
working code reference to draw from. Do not guess field names.

### Discovery recipe

1. If a flow already exists in the target project, read its real shape:
   `cognigy_list(resource_type="flows", project_id="<projectId>", full_objects=true)`
2. Fall back to describe_resource_schema(resource_type="flows", operation="create") —
   it looks up the field-level shape directly from the live OpenAPI spec (no session
   cookie needed, just the same API key already configured).

### Once you confirm a working shape

File it back as an amendment to this topic (or a dedicated one) so the next
session doesn't repeat this discovery from scratch — see this repo's CLAUDE.md
documentation-workflow rule.
