---
topic: node-positioning
description: append vs appendChild modes, moving an existing node via cognigy_update, child branch population for Once, IF, ifThenElse nodes, lookup default branch
---

## node-positioning — Inserting and Moving Nodes

### Mode: append

Only reliable insertion mode. Target = node you want to insert AFTER.
body: {"type": "say", "label": "My Node", "mode": "append", "target": "<previousNodeId>"}

### Mode: appendChild (for tool branch nodes)

Use when adding aiAgentJobTool as a child of an aiAgentJob node.
body: {"type": "aiAgentJobTool", "mode": "appendChild", "target": "<aiAgentJobNodeId>"}

See explain("agent-job-node") for the aiAgentJob node's own creation/insertion sequence.

### Moving an existing node

There is no `cognigy_invoke` move operation — `resource_type="node", operation="move"` is not
a real API endpoint and 404s (see issue #237). To reposition an existing node, PATCH it via
`cognigy_update` with the same `mode`/`target` fields used at creation time:
cognigy_update(resource_type="node", resource_id="<nodeId>", flow_id="<flowId>",
body={"mode": "append", "target": "<node-to-move-after>"})

### Common mistakes

- Using chartReference as target → 404 "Failed to find chart node"
- New flows have Start and End nodes; list them first to get Start ID as initial append target
- Child nodes (tool branches) only exist in childIds[], NOT in next chain — append returns 404 on them

### Child branch population (Once node example)

Once nodes auto-create two branch marker nodes: OnFirstTime and Afterwards.
Each marker appears as a child of the Once node with its own \_id.

Content inside a branch must be a SIBLING of the marker (append after it), not a child of it:
CORRECT: mode: "append", target: <branchMarkerId> ← sibling-after-marker, renders inside branch
WRONG: mode: "appendChild", target: <branchMarkerId> ← child OF marker, breaks UI rendering

Example: Once node "a1b2" with childIds ["c3d4", "e5f6"]

- "c3d4" is the OnFirstTime branch marker
- "e5f6" is the Afterwards branch marker
- To add a Code node to OnFirstTime:
  cognigy_create(body={"mode": "append", "target": "c3d4", "flowId": "..."})
  → Code becomes sibling of c3d4 within Once's children = renders inside OnFirstTime section

Common pitfall: targeting the parent Once node's \_id ("a1b2") instead of the branch marker ("c3d4").

### IF node branch population

IF nodes (type: "if") auto-create two branch marker nodes when created.
Each marker appears in the IF node's childIds[]:

- childIds[0] = Then branch marker
- childIds[1] = Else branch marker

Content inside a branch must be a SIBLING of the marker (same rule as Once above):
CORRECT: mode: "append", target: <branchMarkerId>
WRONG: mode: "appendChild", target: <branchMarkerId>

Steps to populate an IF branch:

1. Create the IF node via cognigy_create (see flow-chart-reading for correct config schema)
2. GET the flow chart — find the IF node's childIds array
3. childIds[0] is the Then marker \_id, childIds[1] is the Else marker \_id
4. Create content nodes with mode: "append", target: <branch-marker-\_id>

Example: IF node "if-abc" with childIds ["then-xyz", "else-xyz"]

- To add a Say node to Then: mode="append", target="then-xyz"
- To add a Code node to Else: mode="append", target="else-xyz"

Common pitfall: targeting the IF node's own \_id ("if-abc") instead of the branch marker.

### ifThenElse branch population

Same append-not-appendChild rule as Once and IF nodes.

**ifThenElse** auto-creates: `then` and `else` child branch markers

Steps to populate a branch:

1. Create the `if` node (type string `"if"` via `cognigy_create`) or work with a UI-created `ifThenElse` node
2. List nodes to find the auto-created child IDs: `cognigy_list` or `get_flow_chart`
3. Create content nodes with `mode: "append"`, `target: <branch-child-_id>`

Example — add a Say node to the `then` branch:
// ifThenElse node "ifte-abc" has childIds ["then-xyz", "else-xyz"]
cognigy_create(body={"type": "say", "mode": "append", "target": "then-xyz", "flowId": "..."})

**Type string note:** `ifThenElse` (UI-created) and `if` (API-created via `cognigy_create`)
are distinct type strings — both exist in real charts, same branch population rules apply.

### lookup node branches

`lookup` auto-creates a `default` branch marker at creation time. Additional `case` branches
are user-defined. The `default` branch follows the same append-after-marker rule as all other
branch types. Creating programmatic case branches is not documented here — use the Cognigy UI
for case branch management or consult the OpenAPI spec for the cases config schema.
