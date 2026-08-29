---
topic: agent-job-node
description: aiAgentJob node — assumptions, resolution/insertion procedure, config schema, tool-node creation
---

## agent-job-node — Creating an AI Agent Job Node

### Assumptions

The flow and the AI Agent resource must already exist. This topic does not cover creating
either — see `cognigy_create(resource_type="flows", ...)` and
`cognigy_create(resource_type="aiagents", ...)` for those.

### Step 1: Resolve the flow

Given a name (not a 24-char hex ID), call `resolve_resource(name=<flow name>, resource_type="flows")`.
If it returns no match, fall back to `cognigy_list(resource_type="flows")` and scan the results.

- Exactly one match → use it.
- Multiple matches → show them and ask the user to choose.
- No match → stop; the flow was not found.

Capture: `flowId`

### Step 2: Resolve the AI Agent

Given a name, call `resolve_resource(name=<agent name>, resource_type="aiagents")`.
If it returns no match, fall back to `cognigy_list(resource_type="aiagents")`.
Apply the same exactly-one / multiple / no-match handling as Step 1.

Capture the agent's **`referenceId`** field (UUID format, e.g. `d484bc76-6d77-487f-b97e-6d18f728c232`).
Do NOT use `_id` — the node's `aiAgent` config field requires the `referenceId`.

Capture: `agentReferenceId`, `agentName`

### Step 3: Gather job details

Collect, in a single batched prompt if asking a user interactively:

1. **Job label** — display name for the node (e.g. "Renewals Specialist")
2. **Job description** — what this specialist handles (1-2 sentences; blank if not needed)
3. **Job instructions** — standing guidance for this job (blank if not needed)
4. **Tools** — list of tools to add as child nodes (see Step 5 below); each needs a
   `toolId` (snake_case), `label`, `description`, and whether it takes parameters.

If description, instructions, or tools are not provided, use empty strings and skip tool creation.

### Step 4: Resolve the insertion point

Call `get_flow_chart(flow_id=<flowId>)` to retrieve the flow hierarchy. Find the target node:

- If a node identifier (ID, label, or type) was given, locate it in the hierarchy.
- Otherwise, default to the Start node (type `start`).

Capture: `targetNodeId`

### Step 5: Create the AI Agent Job node

```
cognigy_create(resource_type="node", flow_id=<flowId>, body={
  "type": "aiAgentJob",
  "label": "<job label>",
  "target": "<targetNodeId>",
  "mode": "append",
  "config": {
    "aiAgent": "<agentReferenceId>",
    "name": "<job label>",
    "description": "<job description>",
    "instructions": "<job instructions>",
    "toolChoice": "auto",
    "memoryType": "inherit",
    "temperature": 0.7,
    "maxTokens": 4000,
    "knowledgeSearchBehavior": "onDemand"
  }
})
```

`mode: "append"` is required — `insertAfter` returns a 500 from the Cognigy API for this
node type. The extension field is omitted; the MCP server auto-injects the correct
extension for `aiAgentJob` nodes.

Capture: `jobNodeId` (the `_id` from the response)

### Step 5.5: Delete the platform's auto-scaffolded placeholder tool

Creating the `aiAgentJob` node causes Cognigy to auto-scaffold a default placeholder
`aiAgentJobTool` child node alongside it (observed example: `unlock_account`) — this is
platform behavior, not something this skill or the MCP server created. See
`explain("agent-tool-scaffold")` for the full explanation.

1. Call `get_flow_chart` with `flow_id: <flowId>`.
2. Find the `aiAgentJobTool` child already present under `<jobNodeId>` — at this point
   it is the only tool child, since Step 6 hasn't created any tools yet.
3. Delete it: `cognigy_delete { resource_type: "node", resource_id: "<scaffoldToolNodeId>", flow_id: "<flowId>" }`.

Do this BEFORE Step 6 — do not edit the scaffold tool in place, and do not leave it
alongside the tools you create next. If no `aiAgentJobTool` child is present, the
platform didn't scaffold one this time — skip the delete and go straight to Step 6. If
more than one is present, delete all of them.

### Step 6: Create tool nodes

For each tool gathered in Step 3, write a `.tool.json` file first (see
`explain("agent-tool-json")` for the file convention), then call `push_agent_tool` — not
`cognigy_create`, which is blocked for `aiAgentJobTool` nodes:

```
push_agent_tool(tool_file=<absolute path to .tool.json>, flow_id=<flowId>, job_node_id=<jobNodeId>)
```

`push_agent_tool` always uses `mode: appendChild` — no need to specify it. It returns the
new node's `_id` as `<toolNodeId>`.

If any tool creation fails, stop immediately and report which tools succeeded and which
failed — do not continue to the next tool. See `explain("agent-tool-branch")` for the
full three-node branch assembly (tool node → code node → `aiAgentToolAnswer`).

### Step 7: Report

Summarize created resources in a table: flow (existing), AI Agent (existing), Job node
(new, with `jobNodeId`), and each tool node (new, with its `_id`).

### Notes

- The `aiAgent` config field takes the agent's `referenceId` (UUID), not `_id`.
- All node operations in this sequence require `flow_id`.
- The MCP server auto-injects the correct extension for `aiAgentJob` and `aiAgentJobTool`
  nodes — never include an `extension` field in the body yourself.
- Cognigy auto-scaffolds a default placeholder tool node when the `aiAgentJob` node is
  created — Step 5.5 deletes it before Step 6 runs. See `explain("agent-tool-scaffold")`.
