---
topic: session-injection
description: context/state inject for in-session testing
---

## session-injection — Injecting State for Testing

### Inject context variables

cognigy_invoke(resource_type="sessions", resource_id=<sessionId>,
operation="inject-context",
body={"context": {"authVerified": True, "customerName": "Alice"}})

### Inject flow state (navigate to a flow)

cognigy_invoke(resource_type="sessions", resource_id=<sessionId>,
operation="inject-state",
body={"state": "FlowName"})

### Reset context

cognigy_invoke(resource_type="sessions", resource_id=<sessionId>,
operation="reset-context", body={})

### Reset state (return to start)

cognigy_invoke(resource_type="sessions", resource_id=<sessionId>,
operation="reset-state", body={})

### Session ID

sessionId = the userId value passed to talk_to_agent.
New userId → fresh session. Same userId → continue existing session.

### Testing workflow

1. talk_to_agent(message="...", user_id="test-1", session_id="test-1")
2. Inject context to simulate a specific state
3. talk_to_agent(message="...", user_id="test-1", session_id="test-1") // continues
4. Verify response matches expected behaviour
