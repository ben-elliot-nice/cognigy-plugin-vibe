---
topic: agent-tool-branch
description: aiAgentJobTool + code + toolAnswer assembly, tool args access
---

## agent-tool-branch — Building the AI Agent Tool Branch

### Three-node structure

Every AI Agent tool is a branch under an aiAgentJob:
aiAgentJob
└── aiAgentJobTool (the tool definition — appendChild of aiAgentJob)
└── Code Node (implementation — append after tool node)
└── aiAgentToolAnswer (surfaces result — append after code node)

This topic assumes the aiAgentJob node already exists. See explain("agent-job-node") for
how to create it and attach the first tool in one sequence.

### Step 1: Create the tool definition (push_agent_tool)

Write a .tool.json file first — see explain("agent-tool-json") for the convention.

push_agent_tool(
tool_file="/path/to/my_tool.tool.json",
flow_id=<flowId>,
job_node_id=<aiAgentJobNodeId>
)

Returns node_id of the new aiAgentJobTool node.

### Step 2: Create the code node (push_code_node)

push_code_node(
script_file="/path/to/my_tool.js",
flow_id=<flowId>,
mode="append",
target=<toolNodeId>,
label="[TOOL] my_tool"
)

Returns node_id of the new code node.

### Step 3: Append aiAgentToolAnswer

cognigy_create(resource_type="node", flow_id=<flowId>, body={
"type": "aiAgentToolAnswer",
"mode": "append",
"target": <codeNodeId>,
"config": { "answer": "{{JSON.stringify(context.toolResponse)}}", "maxLoops": 4 }
})

The `answer` field is REQUIRED and is the whole point of the node — it is the CognigyScript
the node hands back to the LLM as the tool result. Set it to
`{{JSON.stringify(context.toolResponse)}}` so the object your code node wrote is surfaced
verbatim as JSON. **Do NOT leave `config: {}`** — an empty `answer` returns an empty tool
result and the LLM sees nothing back from the tool (it will stall or hallucinate). `maxLoops`
(default 4) caps tool-call recursion. (Same form already used in `explain("xapp-event-handling")`.)

### Reading tool arguments in the code node

Parameters the LLM collected are available as:
const amount = input.aiAgent.toolArgs.amount;
const reason = input.aiAgent.toolArgs.reason;
These are NOT in input.data — they come via input.aiAgent.toolArgs.<paramName>.

### Updating an existing tool definition

push_agent_tool(
tool_file="/path/to/my_tool.tool.json",
flow_id=<flowId>,
node_id=<toolNodeId>
)

Edit the .tool.json file locally first, then push. PATCH is additive on config —
fields not in the file are preserved. No conflict detection (tool config is the file).

### Updating an existing code node

push_code_node(
script_file="/path/to/my_tool.js",
flow_id=<flowId>,
node_id=<codeNodeId>
)

### context.toolResponse

Code node writes: context.toolResponse = {summary: "...", data: {...}}
The aiAgentToolAnswer node surfaces this to the LLM via its `answer` field, which MUST be
wired to `{{JSON.stringify(context.toolResponse)}}` (see Step 3). The node does NOT
auto-read context.toolResponse — if `answer` is empty, the LLM receives an empty tool result.
toolResponse.summary = what the LLM reads back to the customer naturally.

### Tool conditions (hide tool from LLM when false)

Set condition in the .tool.json file before pushing. See explain("tool-conditions").
