---
topic: two-pass-confirm
description: inter-turn flag management, STOP gate wording
---

## two-pass-confirm — Staged Confirmation Pattern

### Problem

LLM will collapse propose+execute into a single tool call without explicit instructions.

### Pattern

Pass 1: Tool called without confirmation flag → returns summary, does NOT execute.
Pass 2: Tool called with confirmation flag → executes.

### Tracking state between turns

// Code node (Pass 1):
context.contracts.myTool = {pendingConfirm: true, ...details};
context.toolResponse = {summary: "I'll do X. Confirm?"};

// Code node (Pass 2):
if (!context.contracts.myTool?.pendingConfirm) {
context.toolResponse = {error: "No pending confirmation"};
return;
}
// execute...
context.contracts.myTool = null; // clear
context.toolResponse = {summary: "Done."};

### toolResponse.summary vs pre-call instructions

- toolResponse.summary: what LLM reads BACK to customer after tool completes
- Tool description: rules LLM reads BEFORE deciding to call the tool
- Do NOT put "Say this to the customer" in tool description — it runs before the call

### STOP gate wording that works

In AI job instructions:
"Your ONLY spoken output before calling confirm_action is: [exact words].
Stop there. DO NOT add anything else. Call the tool."

### Inter-turn flag via context.contracts.\*

Use context.contracts namespace — LLM cannot see this namespace (short-term memory blind spot).
context.shortTermMemory IS visible to LLM. context.contracts.\* is NOT.
