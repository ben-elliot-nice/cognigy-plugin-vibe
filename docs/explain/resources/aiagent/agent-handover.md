---
topic: agent-handover
description: Escalation to human pattern and handover context artefact design (two-consumer model)
---

## agent-handover — Escalation and Handover Patterns

### escalate_to_human tool definition

{
"toolId": "escalate_to_human",
"description": "Escalate to human agent when unable to resolve or customer requests human assistance",
"useParameters": true,
"parameters": {
"type": "object",
"properties": {
"reason": { "type": "string", "description": "Reason for escalation" },
"conversationSummary": { "type": "string", "description": "Summary of conversation for handoff to human agent" }
},
"required": ["reason", "conversationSummary"]
}
}

### When to escalate

- Customer requests human explicitly
- Required information unavailable to the agent
- Complex or exception scenario not covered by available tools
- Technical issue preventing resolution

### Handover context artefact — two-consumer model

Design the handover package upfront. Two distinct consumers need different data.

**Consumer 1: ACD / routing system** — structured fields for screen pop and routing

context.handoverContext = {
customer: {
name: context.shortTermMemory.customerName,
policyNumber: context.shortTermMemory.policyNumber,
authenticated: context.authVerified
},
conversation: {
intent: context.shortTermMemory.intent,
summary: context.shortTermMemory.conversationSummary,
retentionAttempted: context.shortTermMemory.retentionOffered ?? false
},
escalation: {
reason: input.aiAgent.toolArgs.reason,
timestamp: new Date().toISOString()
}
}

**Consumer 2: Agent Assist / live agent reading** — natural language summary

context.shortTermMemory.handoverSummary =
`Customer ${context.shortTermMemory.customerName} ` +
`called about ${context.shortTermMemory.intent}. ` +
(context.shortTermMemory.retentionOffered ?
"Retention offer was made and declined. " : "") +
`Policy: ${context.shortTermMemory.policyNumber}. ` +
`Authenticated: ${context.authVerified ? "Yes" : "No"}.`

Identify both consumers, their required data, and which context paths hold that data
before writing the escalation code node. The handover context is a designed artefact.
