---
topic: extensions-resource
description: no verified create/update body shape yet — discovery recipe for resource_type=extensions (installed extension config, distinct from explain("extension-map")'s node-type lookup table)
---

## extensions-resource — No Verified Body Shape Yet

Not to be confused with explain("extension-map") — that topic documents which extension package a node _type_ belongs to; this topic is about the "extensions" resource_type itself (installed/configured extensions).

No confirmed `cognigy_create`/`cognigy_update` body shape exists for
`resource_type="extensions"` in this codebase — no live-verified example and no
working code reference to draw from. Do not guess field names.

### Discovery recipe

1. If an extension already exists in the target project, read its real shape:
   `cognigy_list(resource_type="extensions", project_id="<projectId>", full_objects=true)`
2. Fall back to describe_resource_schema(resource_type="extensions", operation="create") —
   it looks up the field-level shape directly from the live OpenAPI spec (no session
   cookie needed, just the same API key already configured).

### Once you confirm a working shape

File it back as an amendment to this topic (or a dedicated one) so the next
session doesn't repeat this discovery from scratch — see this repo's CLAUDE.md
documentation-workflow rule.
