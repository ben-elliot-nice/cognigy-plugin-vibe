---
topic: extension-map
description: complete type → extension lookup table
---

## extension-map — Node Type → Extension Reference

Every Cognigy node type belongs to an extension package. cognigy_create auto-injects
the extension field using two sources in priority order:

1. Static map (built-in types, always available)
2. Dynamic index built by sync_remote_state from installed project extensions

For custom extensions: run sync_remote_state once after installing or updating an
extension in the Cognigy UI. cognigy_create will then auto-inject the correct
extension for any node type that extension defines — no manual lookup needed.

### Voice Gateway nodes (extension: "@cognigy/voicegateway2")

setSessionConfig Voice Gateway session config (TTS, STT, barge-in, timeouts)
hangup End the call cleanly
sendMetadata Send metadata to the voice channel

### AI Agent nodes (extension: "@cognigy/basic-nodes")

aiAgentJob The AI Agent job node (persona + instructions)
aiAgentJobTool A tool branch under an aiAgentJob
aiAgentToolAnswer Surfaces tool result back to the LLM
See explain("agent-job-node") for the aiAgentJob node's full config schema and creation call.

### xApp nodes (extension: "@cognigy/basic-nodes")

initAppSession Generate xApp session URL (stored in input.apps.url)
setHTMLAppState Push HTML content to an active xApp session

### Basic nodes (extension: "@cognigy/basic-nodes")

say Speak text to the caller
code Run a JavaScript code node
wait Wait for user input (terminates turn)
once Execute children once, then bypass
goTo Jump to another flow
question Ask a question and capture input
httpRequest Make an outbound HTTP call
setContext Set context variables
if Conditional branch — create via cognigy_create (type string "if")
ifThenElse Conditional branch created via Cognigy UI or cognigy-plugin — both appear in real charts
lookup Pattern-match branch

### Custom extension nodes

Not listed here — discovered automatically at sync_remote_state time.
Use get_build_state(resource_type="extension_map") to inspect the live index.
If you pass extension explicitly, your value takes precedence over both maps.
404 "resource not found" at a valid chart/nodes URL usually means a missing or
wrong extension — run sync_remote_state then retry.
