---
topic: say-node
description: say node config schema: correct text field, required _cognigy/_data fields, generativeAI_customInputs
---

## say-node — Say Node Config Schema

### CRITICAL: text must be a plain string array

The say node's config.say.text field is a plain string array — NOT an array of objects.

WRONG (causes [object Object] in output):
Passing objects instead of strings — e.g. text as an array of {type, content} objects.
This is a common mistake when following a rich-text schema pattern.
DO NOT use object elements in the text array.

CORRECT:
"config": {
"say": {
"text": ["Hello, how can I help?"]
}
}

### Full minimal config with all required fields

cognigy_create(resource_type="node", flow_id=..., body={
"type": "say",
"label": "Greeting",
"mode": "append",
"target": "<previousNodeId>",
"config": {
"say": {
"text": ["Hello, how can I help you today?"],
"type": "text",
"data": "",
"linear": false,
"loop": false,
"\_cognigy": {},
"\_data": {"\_cognigy": {}}
},
"generativeAI_customInputs": []
}
})

### Required fields

- "text": ["..."] — plain string array; one string per output variation
- "type": "text" — output type; always "text" for standard text output
- "data": "" — data payload; empty string is valid
- "linear": false — whether to cycle through text variants linearly
- "loop": false — whether to loop back to first variant after last
- "\_cognigy": {} — internal Cognigy metadata; must be present as empty object
- "\_data": {"\_cognigy": {}} — internal data wrapper; must be present with \_cognigy key
- "generativeAI_customInputs": [] — empty array (NOT empty string "")

### Using CognigyScript in say text

CognigyScript interpolation works in the say node text field:
"text": ["Hello {{context.shortTermMemory.customerName}}, how can I help?"]

### Multiple output variations (random selection)

"text": ["Hello! How can I help?", "Hi there! What can I do for you?"]
Cognigy picks one at random each time the node fires.
With "linear": true — cycles through in order instead of random selection.

### Common mistake

Passing a string directly instead of an array:
WRONG: "text": "Hello"
CORRECT: "text": ["Hello"]

### Updating an existing say node

Say nodes have no dedicated update tool — edit them directly with the generic
`cognigy_update(resource_type="node", ...)` primitive, same as any other node type.
Always use `merge_config=True` so unrelated fields (e.g. `linear`, `_cognigy`) aren't
silently dropped by Cognigy's full-replace PATCH semantics — see explain("node-config-update").

cognigy_update(resource_type="node", resource_id=<nodeId>, flow_id=<flowId>,
merge_config=True, body={
"config": {
"say": {
"text": ["Updated greeting text"]
}
}
})
