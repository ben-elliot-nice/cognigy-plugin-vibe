---
topic: turn-structure
description: Once/OnFirstTime/Afterwards, input.execution, context reset prevention, child branch API patterns
---

## turn-structure — Canonical Cognigy Turn Architecture

### Standard flow structure

Start
└── Once
├── OnFirstTime (runs once at session start)
│ ├── Set Context (config, auth flags, etc.)
│ ├── Code: Build Greeting (builds context.greetingText)
│ └── Say: Proactive Greeting (outputs context.greetingText)
└── Afterwards (runs every turn after the first)
└── AI Agent Job (Concierge)
End

### Why this matters

Set Context in the main chain runs every turn — resets context on every message.
Set Context in OnFirstTime runs once — persists for the session.
AI Agent Job in Afterwards — never runs on the very first turn (greeting runs instead).

### First-turn signal

input.execution === 1 is the canonical way to detect the first turn in a code node.
Do NOT use turn-count variables or session flags for this.
if (input.execution === 1) {
// first turn setup
}

### Proactive greeting pattern

// Code node:
const name = context.shortTermMemory?.customerName || 'there';
context.greetingText = `Hello ${name}, I'm Vera. How can I help you today?`;
// Then: Say node outputs {{context.greetingText}}
This guarantees on-brand, correctly personalised greeting with zero LLM latency.

### Flow close pattern

Once → next → End
The Once node's "next" pointer leads to End for clean termination.
Do NOT put any nodes after End or the flow will loop.

### Context reset prevention

If context resets every turn, check:

1. Set Context is in main chain (move to OnFirstTime)
2. Flow is being reset by a goTo with reset=true
3. Multiple flows calling into each other with shared context

### Programmatic child branch population

Once nodes auto-create OnFirstTime and Afterwards branches — do NOT attempt to create
them manually (returns HTTP 400 "operation conflicts with constraints").

To add a node to a child branch via the API:

1. GET the flow chart to find the Once node and its childIds
2. The childIds array contains the branch marker \_ids (onFirstExecution and afterwards)
3. Create your node with mode="append", target="<branch-marker-id>"

The node inserts as a sibling after the branch marker — it renders inside that branch section.
Do NOT use appendChild mode on a branch marker: that nests the node INSIDE the marker, breaking UI rendering.

Full example — adding a Code node to OnFirstTime:
// Step 1: get_flow_chart to find the Once node
// Chart shows Once node "once-abc" with childIds ["onfirst-xyz", "after-xyz"]
// "onfirst-xyz" = OnFirstTime branch marker (\_id)
// "after-xyz" = Afterwards branch marker (\_id)

// Step 2: create the Code node as sibling after OnFirstTime marker
cognigy_create(resource_type="node", body={
"flowId": "<flow-id>",
"type": "code",
"label": "Load Guest Profile",
"mode": "append",
"target": "onfirst-xyz",
"config": {"code": "const profile = await api.httpRequest({...});"}
})

Same rule as IF node branches — mode="append" after the branch marker, not appendChild into it.
See node-positioning for the appendChild vs append distinction.
