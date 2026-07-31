---
topic: tool-selection
description: when to use push_agent_tool vs push_code_node vs cognigy_create vs cognigy_update
---

## tool-selection — Choosing the Right Tool

### Decision tree

- "Creating or updating an AI Agent tool definition?" → push_agent_tool (file-backed, maps .tool.json to Cognigy config)
- "Creating a Code node from a local .js/.ts file?" → push_code_node (provides conflict detection against Cognigy UI edits)
- "Creating any other node (Say, Once, HTTP Request, AI Agent Job, etc.)?" → cognigy_create
- "Creating an HTML/xApp node from a local .html file?" → push_html_node (sets mode='full' automatically)
- "Updating an existing node's config?" → cognigy_update with merge_config=true
- "Reading a node or resource?" → cognigy_get

### Why push_agent_tool for aiAgentJobTool nodes?

push_agent_tool handles the JSON serialization Cognigy requires (parameters must be a JSON string,
not an object), auto-derives useParameters, and sets debugMessage:true. cognigy_create is blocked
for aiAgentJobTool — attempting it returns an error redirecting here.

### Why push_code_node for Code nodes?

push_code_node provides conflict detection: if someone edited the node in the Cognigy UI
since your last push, the push is blocked with a diff. cognigy_create is also blocked for code nodes.

### File-backed vs direct

- push_agent_tool / push_code_node / push_html_node: local file → remote node
- cognigy_create: create node from scratch inline — blocked for code and aiAgentJobTool types

### AI Agent tool branch

See explain("agent-tool-branch") for the full three-node assembly sequence.
See explain("agent-tool-json") for the .tool.json file convention.
