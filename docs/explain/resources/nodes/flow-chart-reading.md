---
topic: flow-chart-reading
description: reading chart output, node type strings, extension field
---

## flow-chart-reading — Reading get_flow_chart Output

### Verified node type strings (exact, case-sensitive)

Core types (no extension needed):
say, question, code, setContext, goTo, once, lookup, log, stopBot, httpRequest
if (note: NOT "ifThenElse") (created via cognigy_create)
ifThenElse (created via Cognigy UI or cognigy-plugin — both exist in real charts)

AI Agent types (extension: "@cognigy/basic-nodes"):
aiAgentJob, aiAgentJobTool, aiAgentToolAnswer

xApp/Voice types (extension: "@cognigy/basic-nodes"):
initAppSession (NOT "xAppInitSession")
setHTMLAppState (NOT "setHTMLxAppState")

### Reading node objects

{
"\_id": "abc123", // use this as node_id in tool calls
"type": "say",
"label": "Greeting", // human-readable
"config": {...}, // type-specific configuration (ONLY in cognigy_get, not chart)
"position": {"x": 0, "y": 100}
}

### if / ifThenElse nodes

`if` is created via cognigy_create (type string "if"). `ifThenElse` is the type string
used by nodes created in the Cognigy UI or via cognigy-plugin — both appear in real charts.
cognigy_create(resource_type="node", flow_id=..., body={
"type": "if",
"mode": "append",
"target": "<previousNodeId>",
"config": {
"condition": {
"type": "rule",
"rule": {
"left": "context.someVar",
"operand": "neq", // equals, notEquals (neq), contains, greaterThan, lessThan
"right": "someValue"
}
}
}
})
Creating an if node auto-creates two branch container nodes: Then (childIds[0]) and Else (childIds[1]).
To add nodes inside a branch: use mode="append", target="<branch-marker-\_id>" (same rule as Once nodes — append after the marker, not as a child of it).
Branches are in childIds[]: index 0 = Then (true), index 1 = Else (false).

### Reading the hierarchy string

get_flow_chart returns "hierarchy": a tree string like:
[start] Start (abc)
[say] Greeting (def)
[aiAgentJob] Concierge (ghi)
[aiAgentJobTool] authenticate_caller (jkl)
[code] [TOOL] authenticate_caller (mno)
[aiAgentToolAnswer] Tool Answer (pqr)

See explain("agent-job-node") for how an aiAgentJob node and its tool children are created.

### Finding a node's ID: resolve_resource vs get_flow_chart

`resolve_resource(name=..., resource_type="nodes")` only finds nodes created via
`cognigy_create` earlier in the _current_ session — it's a local session-state lookup,
not an API call. It returns nothing for nodes that already existed in the flow before
this session started (built via the Cognigy UI, a prior session, etc.).

For any node not created in the current session, use `get_flow_chart(flow_id=...)` and
scan the returned nodes/hierarchy by label or type instead.
