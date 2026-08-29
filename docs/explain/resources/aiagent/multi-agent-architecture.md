---
topic: multi-agent-architecture
description: Concierge + Specialists pattern, specialist job types, routing, context schema, stub agent
---

## multi-agent-architecture — Multi-Agent Architecture Patterns

### Concierge + Specialists pattern

Standard architecture for complex AI agent systems.

Inbound Contact
│
Concierge Flow

- Intent detect
- Authenticate
- Gather context
  │
  ┌────┼────┐
  │ │ │
  Spec 1 Spec 2 Spec N

### Concierge role

Front-of-house orchestrator.

Tools: `route_to_specialist_1` ... `route_to_specialist_n`, `escalate_to_human`

Capabilities: intent detection, customer auth/identification, context gathering, intelligent routing, context preservation on handoff.

### Specialist role

Domain-specific expert. Every specialist has `return_to_concierge`:

{
"toolId": "return_to_concierge",
"description": "Return user to concierge agent when query is outside this specialist's scope.",
"useParameters": false
}

Use when customer asks about a different domain or specialist cannot handle the request.

### Specialist job patterns

**Information Retrieval** — search catalogs, knowledge bases, databases
Tools: `search_catalog`, `get_item_details`, `check_availability`
Instructions: Gather search criteria. Use search tools. Present findings and offer follow-up.
xApp: product images, specs, comparisons

**Transaction** — execute transactions, process payments, create orders
Tools: info retrieval tools + `create_order`, `process_payment`, `apply_discount`
Instructions: Confirm order details (items, quantities, pricing). Use payment tool. Provide confirmation.
xApp: payment form, order summary, confirmation

**Booking** — schedule appointments, manage calendar
Tools: `check_availability`, `create_booking`, `cancel_booking`, `reschedule_booking`
Instructions: Check availability. Collect details (name, contact, service type). Confirm and send confirmation.
xApp: calendar view, booking confirmation

**Support** — troubleshooting, account management, returns
Tools: `lookup_order`, `process_return`, `update_account`, `escalate_to_human`
Instructions: Gather order/account details. Use tools to resolve. Escalate with summary if unable to resolve.

**Stub** — placeholder for a not-yet-built specialist
Tools: none, or just `return_to_concierge`
Instructions: "You are a specialist agent for [domain]. For this demo phase, provide basic assistance and return to concierge for complex queries."
Benefit: enables knowledge-based responses even without full tool implementation.

### Context schema categories

| Category       | Path                        | LLM-visible                   | Lifetime                   |
| -------------- | --------------------------- | ----------------------------- | -------------------------- |
| Transient      | `input.*`                   | Yes                           | Per turn — wiped each turn |
| Session memory | `context.shortTermMemory.*` | Yes                           | Full session               |
| Tool result    | `context.toolResponse`      | Yes (via Resolve Tool Action) | Overwritten each tool call |
| State / config | `context.<namespace>.*`     | No (by default)               | Full session               |

Initialise at session start (Set Context Node):
context.toolResponse = ""
context.shortTermMemory = {}

Context schema example — e-commerce:
context.ecommerce.config = { defaultBranch: "melbourne", supportedRegions: ["au", "nz"] }
context.shortTermMemory.customerProfile = { name: "", accountId: "", accountType: "retail" }
context.shortTermMemory.activeCart = { items: [], total: 0 }
context.shortTermMemory.lastProductViewed = {}
