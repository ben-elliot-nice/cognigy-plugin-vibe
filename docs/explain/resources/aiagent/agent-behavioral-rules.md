---
topic: agent-behavioral-rules
description: Silent tool execution, outcome-based framing, compliance rules in tool descriptions
---

## agent-behavioral-rules — AI Agent Behavioral Rules

### Silent tool execution

All tools execute silently. Never describe, announce, or narrate tool calls to the customer.

Include in every agent's instructions:

ALWAYS:

- Execute tools silently — do not announce, describe, or narrate tool calls
- Do not say anything before a tool call if the tool produces a customer-facing message — this causes duplicate output

This applies to all tools: search tools, action tools, routing tools, xApp tools.

Exception: `escalate_to_human` IS customer-facing — communicate it explicitly:
"Let me connect you with one of our team members."

Routing tools (`route_to_*`, `return_to_concierge`) execute silently. The agent is presented as singular.

### Outcome-based framing

Write instructions that tell the agent what to achieve, not what to avoid.
Rule-heavy CRITICAL/NEVER lists produce worse behaviour.

Anti-pattern:
CRITICAL: NEVER offer more than one retention deal.
CRITICAL: NEVER apply pressure if customer declines.
CRITICAL: NEVER proceed without confirmation.

Better:
Your goal is to help the customer make an informed choice — not to prevent cancellation.
If they want to leave, understand why and present one relevant option clearly.
If they decline, accept it and ask what they'd like to do next.

Rule: more than 3 NEVER/CRITICAL lines → reframe as outcomes instead.
Specific compliance obligations belong in tool descriptions, not standing orders.

### Tool descriptions as compliance contracts

Tool descriptions are read at the moment the LLM selects a tool.
Put compliance rules where the LLM is reading when it is about to act.

process_policy_change: Use this tool to cancel, transfer, or downgrade a policy.

ACTION parameter: "cancel" | "transfer" | "downgrade"

COMPLIANCE REQUIREMENTS:

- ONE retention offer per reason. If the customer declines, proceed immediately — do not offer again.
- Cancel uses two-pass confirmation: first call returns summary only and does NOT execute. Second call (confirmed=true) executes.
- Reason routing is MANDATORY before any action.

What belongs where:

| Tool descriptions                             | Agent instructions                                |
| --------------------------------------------- | ------------------------------------------------- |
| Rules specific to this tool being called      | Universal behavioural rules (tone, auth, silence) |
| Confirmation requirements before executing    | Localisation rules                                |
| Obligation limits (one-offer, single-attempt) | Rules that apply regardless of tool               |
| Branching/sequencing requirements             | Outcome framing                                   |
