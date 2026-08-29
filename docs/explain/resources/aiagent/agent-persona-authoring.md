---
topic: agent-persona-authoring
description: AI Agent description and instructions field authoring — structure, constraints, speaking style
---

## agent-persona-authoring — Authoring AI Agent Fields

### Field purposes

| Field          | Focus                                                                     | Maps to                      |
| -------------- | ------------------------------------------------------------------------- | ---------------------------- |
| `description`  | WHO the agent is — character, role, communication style                   | Persona statement            |
| `instructions` | HOW the agent operates — rules, localisation, scope, behavioral DO/DON'Ts | Standing orders for all jobs |

### What NOT to put in description or instructions

These belong in Job instructions, not the AI Agent level:

- Tool names or when to use them
- Data paths (`context.shortTermMemory`, `input.*`)
- Step-by-step process flows
- Routing logic or handoff instructions
- Job-specific operational details

### description structure

Cast the character — communication style only. Target ~300 chars.

You are a [ROLE] [working for / at] [COMPANY].
You are [2-3 personality adjectives]. [What drives your approach — 1 sentence].
You speak in a [TONE] way. You are [knowledge level] about [domain].

Example:
You are a parts and service specialist at ASV Connect.
You are warm, efficient, and direct. You understand that mechanics need accurate answers fast.
You speak in a clear, no-nonsense way. You know automotive parts and trade supply inside out.

Do NOT write: "You help customers find parts. When they ask about stock, check the catalog."
That is operational detail — it belongs in Job instructions.

### instructions structure

Standing orders every job follows. Max 1000 chars.

LOCALISATION:

- [Currency, date format, spelling, phone format]

ALWAYS:

- [Behavioral DOs]

NEVER:

- [Behavioral DON'Ts]

Scope boundaries (in-scope/out-of-scope) belong in Job instructions, not here.
Only universal rules that apply to ALL jobs go in AI Agent instructions.

Localisation examples — Australia:

- Currency: Australian Dollars (AUD / $, not USD)
- Dates: DD/MM/YYYY
- Spelling: Australian English (colour, authorise, centre, realise)
- Phone: 04XX XXX XXX (mobile), (0X) XXXX XXXX (landline)

### Speaking style fields

Do NOT replicate tone guidance in description or instructions — use platform fields:

| Field                        | Options                            | Effect                           |
| ---------------------------- | ---------------------------------- | -------------------------------- |
| `speakingStyle.formality`    | `formal` / `balanced` / `informal` | Register and language formality  |
| `speakingStyle.completeness` | `concise` / `balanced` / `verbose` | Response length and detail level |

### Generation principle

Elicit brand preferences in plain language, then translate into prompt text.
Do not use what the user said verbatim.

User says: "friendly and helpful, not too formal"
Generate: "You are warm, approachable, and genuinely invested in solving the customer's
problem. You speak in a conversational tone — like a knowledgeable friend, not a call centre script."

Always show generated description and instructions for user review before finalising.
