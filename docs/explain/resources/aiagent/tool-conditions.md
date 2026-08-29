---
topic: tool-conditions
description: CognigyScript condition field, hiding tools from LLM
---

## tool-conditions — Controlling Tool Visibility

### What conditions do

The condition field on an aiAgentJobTool is a CognigyScript expression stored in `config.condition`.
When falsy → tool is hidden from the LLM. LLM cannot call what it cannot see.
This is more reliable than code guards (LLM can ignore code; can't call hidden tool).

### Setting a condition

Use push_agent_tool with condition set in the .tool.json file (see explain("agent-tool-json")).
Or update directly:
cognigy_update(resource_type="node", resource_id=<toolNodeId>, flow_id=<flowId>,
merge_config=False,
body={"config": {"condition": "!context.authVerified"}}
)

**Important:** condition is inside `config`, NOT a top-level field. Sending it top-level
returns HTTP 400: "Field 'condition' is not allowed."

### Condition examples

"!context.authVerified" // show authenticate_caller only before auth
"context.contracts.booking.stage === 0" // show only at correct workflow stage
"context.shortTermMemory.policyLoaded" // show after policy is loaded

### Removing a condition (always show)

body={"config": {"condition": ""}} or body={"config": {"condition": null}}

### CognigyScript in conditions

- Use context.\* variables (set by code nodes or Set Context nodes)
- Use input.data.\* for per-turn data
- Operators: ===, !==, &&, ||, !, >, <
- No function calls, no complex expressions

### Context namespace visibility

- context.shortTermMemory.\* → VISIBLE to LLM (included in agent context)
- context.contracts.\* → NOT visible to LLM (use for enforcement state)
- context.ami.\* → NOT visible to LLM (use for config/flags)
