---
topic: agent-tool-scaffold
description: Cognigy auto-scaffolds a default placeholder tool node when an AI Agent Job node is created — detect and delete it before authoring real tools
---

## agent-tool-scaffold — Auto-Scaffolded Placeholder Tool on Job Node Creation

### The behavior

Creating an `aiAgentJob` node — whether via `cognigy_create` (see `explain("tool-selection")`)
or via the NiCE `create_ai_agent` tool — causes the Cognigy platform to auto-scaffold a
default placeholder `aiAgentJobTool` child node alongside it. This is NOT created by
cognigy-vibe-mcp or any plugin skill; it is server-side behavior on the Cognigy platform
itself, intended as a UI convenience for someone building the agent manually in the
Cognigy Studio.

Observed example: `[aiAgentJobTool] Tool (<id>)` with preview/label `unlock_account`.
The exact placeholder name is not a contract — treat the specific `toolId`/label as
illustrative, not something to detect by string match.

### Guidance: delete it, then build fresh

Do NOT edit the scaffold tool in place, and do NOT leave it alongside your own tools —
it is not part of the agent design and will confuse both the LLM's tool selection and
anyone reading the flow chart later. Delete it immediately after job-node creation,
before authoring any real tools:

1. Call `get_flow_chart` on the flow right after creating the `aiAgentJob` node.
2. Find the `aiAgentJobTool` child already present under the new job node — at this point
   it is the only tool child, since no real tools have been created yet.
3. Delete it:
   ```
   cognigy_delete {
     resource_type: "node",
     resource_id: "<scaffoldToolNodeId>",
     flow_id: "<flowId>"
   }
   ```
4. Proceed to author your own tools as normal (see `explain("agent-tool-json")` and
   `push_agent_tool`).

If no `aiAgentJobTool` child is present, the platform did not scaffold one this time —
skip the delete and proceed straight to authoring your own tools. If more than one is
present, delete all of them before authoring real tools; none of them were created by
this skill.

### Why not edit it in place

Repurposing the scaffold node (renaming its `toolId`/label/description for your first
real tool) saves one delete call, but makes the first tool in every build a special case:
it was never authored through the normal `.tool.json` → `push_agent_tool` path, so it
won't have the `debugMessage`/`useParameters` normalization `push_agent_tool` applies,
and its node config may carry other platform-scaffolded defaults that were never
audited. Deleting it and creating every tool through the same path keeps all tools on
one, auditable code path.
