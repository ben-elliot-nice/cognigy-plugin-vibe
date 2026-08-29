---
topic: node-types
description: quick reference for all node type strings
---

## node-types — Quick Reference

This is an alias for flow-chart-reading + extension-map combined.

### Verified type strings (exact, case-sensitive)

say Speak text (config schema: explain("say-node"))
code JavaScript execution
wait Await user input
once First-turn gate (auto-creates onFirstExecution + afterwards children)
goTo Flow jump (requires flow referenceId UUID — NOT hex \_id)
question Question + input capture
httpRequest Outbound HTTP
setContext Set context variables
if Conditional (NOT "ifThenElse") — create via cognigy_create
ifThenElse Conditional created via Cognigy UI or cognigy-plugin — both exist in real charts
lookup Pattern-match branch
setSessionConfig Voice Gateway config (extension: @cognigy/voicegateway2)
hangup End call (extension: @cognigy/voicegateway2)
initAppSession xApp session init (extension: @cognigy/basic-nodes)
setHTMLAppState xApp HTML push (extension: @cognigy/basic-nodes)
aiAgentJob AI Agent job (extension: @cognigy/basic-nodes)
aiAgentJobTool AI Agent tool branch (extension: @cognigy/basic-nodes)
aiAgentToolAnswer Tool result surface (extension: @cognigy/basic-nodes)
See explain("agent-job-node") for the aiAgentJob creation sequence and config schema.

For extension details: explain("extension-map")
For chart reading and hierarchy: explain("flow-chart-reading")
For building tool branches: explain("agent-tool-branch")
