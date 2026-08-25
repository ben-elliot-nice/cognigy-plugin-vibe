---
topic: node-wiring
description: chart structure, relations array, sequential vs child chains
---

## node-wiring — Understanding the Flow Chart Structure

### Chart shape

GET /v2.0/flows/{flowId}/chart returns:
{
"nodes": [...], // all node objects (metadata only — no config)
"relations": [...] // positional relationships
}

### Relations entry shape

{
"node": "abc", // the node ID this relation describes
"\_id": "rel-id", // the relation's own MongoDB ID (different from node \_id)
"next": "def", // next node in sequential chain (null if last)
"children": ["..."] // child node IDs (e.g. tool branches, if-node branches)
}

### Sequential chain vs children

- Sequential: follow "next" links from start node
- Children: follow "children" array from parent (aiAgentJob, if node branches)
- Tool branches are children of aiAgentJob, NOT in sequential chain

### IMPORTANT: Chart endpoint returns metadata only

GET /v2.0/flows/{flowId}/chart does NOT include node config fields (code, conditions, toolId).
To read a node's config: cognigy_get(resource_type="node", resource_id=nodeId, flow_id=flowId)

### Non-core node types require extension field

{"type": "initAppSession", "extension": "@cognigy/basic-nodes"}
{"type": "setHTMLAppState", "extension": "@cognigy/basic-nodes"}
{"type": "aiAgentJob", "extension": "@cognigy/basic-nodes"}
{"type": "aiAgentJobTool", "extension": "@cognigy/basic-nodes"}
{"type": "aiAgentToolAnswer", "extension": "@cognigy/basic-nodes"}

See explain("agent-job-node") for the full node body (config schema) and creation call —
this snippet shows only the extension-injection shape.
