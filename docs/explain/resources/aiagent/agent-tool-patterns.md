---
topic: agent-tool-patterns
description: Tool granularity options (granular/consolidated/action-parameterized) and context.toolResponse channel
---

## agent-tool-patterns — AI Agent Tool Design Patterns

### Tool granularity options

**Granular** — separate tool per action (real-world)
{ "toolId": "search_catalog_by_part_number", "description": "Search parts catalog by exact part number" }
{ "toolId": "search_catalog_by_vehicle", "description": "Search parts catalog by vehicle make/model/year" }
{ "toolId": "check_stock_by_branch", "description": "Check stock availability at specific branch" }

Pros: precise control, automates complexity
Cons: more tools to build, higher implementation effort

**Consolidated** — fewer tools, LLM synthesises (demo-friendly)
{
"toolId": "search_catalog",
"description": "Search parts catalog and retrieve part details, pricing, and stock. Returns comprehensive data for LLM to synthesize."
}

Pros: faster to build, fewer integration points
Cons: LLM must synthesise complex responses

**Action-parameterized** — one tool, multiple related actions via `action` parameter
{
"toolId": "process_policy_change",
"description": "Use this tool to cancel, transfer, or downgrade a policy.\n\nACTION: 'cancel' | 'transfer' | 'downgrade'\n\nCOMPLIANCE REQUIREMENTS:\n- ONE retention offer per reason. If declined, proceed immediately.\n- Cancel: two-pass confirmation. First call returns summary, does NOT execute. Second call (confirmed=true) executes.",
"useParameters": true,
"parameters": {
"type": "object",
"properties": {
"action": { "type": "string", "enum": ["cancel", "transfer", "downgrade"] },
"policyNumber": { "type": "string", "description": "Policy number to modify" },
"confirmed": { "type": "boolean", "description": "Set true on second call to execute after customer confirms" }
},
"required": ["action", "policyNumber"],
"additionalProperties": false
}
}

The code node branches on `input.aiAgent.toolArgs.action`.
Auth guard and policy resolution run once at the top, shared across all branches.

Pros: shared auth guards, single tool description to maintain, cleaner LLM decision space
Cons: tool description must carry branching rules clearly or LLM may misuse the `action` parameter
When to use: related actions sharing preconditions — e.g. all policy modification operations

When in doubt, ask:

- "Do you prefer granular tools (more precise, more build effort), consolidated tools (faster build, LLM synthesises), or action-parameterized (related actions with shared guards)?"

### context.toolResponse — tool communication channel

Every tool branch writes its result to `context.toolResponse`.
The Resolve Tool Action node (`aiAgentToolAnswer`) surfaces this to the LLM as the tool
output — but ONLY if its `answer` field is wired to it. Set the node config to:

// Resolve Tool Action (aiAgentToolAnswer) node config:
{ "answer": "{{JSON.stringify(context.toolResponse)}}", "maxLoops": 4 }

The `answer` field is the CognigyScript handed back to the LLM as the tool result.
**An empty `answer` (e.g. `config: {}`) returns nothing** — the model sees an empty tool
result and will stall or hallucinate. This applies to EVERY tool branch (transactional,
transfer, end-call). See explain("agent-tool-branch") Step 3 for the create call.

// Success:
context.toolResponse = {
success: true,
summary: "Policy ABC123 cancellation scheduled for 30/04/2026.",
data: { policyNumber: "ABC123", effectiveDate: "2026-04-30", refundAmount: 42.50 }
}

// Blocked/refused:
context.toolResponse = {
success: false,
blocked: true,
reason: "Retention offer already made for this reason. Proceeding with cancellation."
}

Initialise at session start (Set Context Node): `context.toolResponse = ""`
