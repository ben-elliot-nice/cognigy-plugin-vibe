---
description: AI Agent Job node configuration, persona authoring, tool design, turn structure, and multi-agent architecture patterns
---

## aiagent — AI Agent Overview

The `aiAgentJob` node is Cognigy's LLM-driven conversation loop: it holds the agent's persona
(description/instructions), routes to tools, and manages turn-by-turn state. This group covers
everything needed to configure, extend, and orchestrate one or more AI Agent Job nodes in a flow.

Reach for this group when authoring or debugging: agent persona/instructions text, tool
definitions and their granularity, turn-scoped state (Once/OnFirstTime/Afterwards), escalation to
a human, or a multi-agent (concierge + specialist) architecture.

Note: illustrative tool-call snippets in this group's topics (e.g. `cognigy_create`,
`cognigy_get`, `cognigy_update`) were ported from a sibling implementation's generic CRUD tool —
in this server the equivalent operation goes through `manage_flow_nodes` (node config),
`create_tool`/`update_tool` (tool nodes), or `update_ai_agent` (persona/job config); the field
shapes and gotchas described still apply.
