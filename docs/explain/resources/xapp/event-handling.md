---
topic: xapp-event-handling
description: non-blocking xApp pattern: flow structure, ephemeral data capture, SDK.submit vs webhook inject variants
---

## xapp-event-handling — Non-Blocking xApp with Async Event Loop

### What this pattern solves

An agent cannot pause mid-turn waiting for a user to act on a secondary screen — the session would time out. This pattern splits the interaction across two turns:

- **Turn N (delivery turn):** the tool branch pushes the xApp, calls aiAgentToolAnswer immediately, and returns control to the agent. The agent confirms and holds the conversation open naturally.
- **Turn N+M (event turn):** when the user submits the xApp (or an external system injects a result), a discriminating field arrives in input.data. An IF node at the very top of the flow intercepts it before the AI Agent Job runs. The flow handles the result and ends the turn without treating it as a user utterance.

**Channels:** Works on voice and digital. On voice, the xApp URL is typically delivered via SMS before aiAgentToolAnswer. On digital/chat, the xApp may be delivered inline — no SMS step required.

---

### Two variants — choose by what triggers the result

**Variant A — SDK.submit() (no external system)**
Use when the user's action IS the result: selection, option pick, address confirmation, simple form.
The xApp calls sdk.submit(data) on user action. Cognigy receives it as the next turn. input.data contains the submitted payload.
No session identity required in the xApp HTML.

**Variant B — Webhook inject (external system processes the action)**
Use when a 3rd party must process the action before the result is known: payment processors, document signing, external approvals.
The xApp POSTs to an external API. That API calls the Cognigy Sessions endpoint to inject the outcome. input.data contains the injected payload.
The xApp HTML must embed {{ci.URLToken}}, {{ci.userId}}, {{ci.sessionId}} at render time.

Why not SDK.submit() for Variant B: the user tapping "pay" is not payment succeeding. The payment processor's callback is the authoritative event.

---

### Flow structure (both variants)

```
Start
└── ifThenElse  ← checks EVERY turn for xApp submit / webhook inject
    ├── Then → [extract + normalise code node] → Say (optional ack) → Once → End
    └── Else → Once
                ├── OnFirstTime → [init nodes] → AI Agent Job
                └── Afterwards  → AI Agent Job
                                    └── [tool branch: xApp delivery chain]
```

The IF node sits between Start and Once. It runs on every turn. The AI Agent Job only runs from Afterwards — it never sees the submit/inject turn directly.

---

### Tool branch delivery sequence

#### 1. Say node (voice only — skip for digital)

Immediate audio feedback before the xApp fires.
"One moment — I'll send that to your phone."

#### 2. initAppSession

Generates input.apps.url (EPHEMERAL — only available this turn).
Configure: backgroundColor, logoUrl, pageTitle, appLoadingText.

#### 3. setHTMLAppState

Push HTML to the xApp session. waitForInput: false is mandatory — this is what makes the pattern non-blocking.
config: { mode: "full", waitForInput: false, closeOnSubmit: true, autoOpen: false }

#### 4. Code node — capture ephemeral data + set toolResponse

CRITICAL: input.apps.url and input.aiAgent.toolArgs.\* both expire at end of this turn.
This node must run immediately after setHTMLAppState.

// Persist xApp URL
context.shortTermMemory.xappUrl = input.apps.url;

// Persist whatever tool args the LLM collected
context.shortTermMemory.pendingField = input.aiAgent.toolArgs.your_field;

// Set spoken response for agent
context.toolResponse = {
success: true,
summary: "I've sent that to your screen — complete it when you're ready.",
data: { xappSent: true }
};

#### 5. SMS delivery (voice only)

Send context.shortTermMemory.xappUrl to the caller via SMS. Skip entirely for digital channels.

#### 6. aiAgentToolAnswer

{ "answer": "{{JSON.stringify(context.toolResponse)}}", "maxLoops": 4 }

Returns control to the agent with the tool result. Nothing is waiting for the xApp.
The agent speaks the summary and holds a normal conversation.

---

### xApp HTML — Variant A (SDK.submit)

SDK script path: use the relative path served by the xApp environment.

  <script src="/sdk/app-page-sdk.js"></script>
  <script>
    const sdk = new CognigyXAppSDK();
    function submitChoice(value) {
      sdk.submit({ selectedOption: value });
    }
  </script>
  <!-- Render options from injected context data -->
  <script>
    const OPTIONS = {{JSON.stringify(context.shortTermMemory.options)}};
    // render buttons calling submitChoice(...)
  </script>

When sdk.submit({selectedOption: "choice-value"}) fires, the full input.data structure is:
{
"\_cognigy": {
"\_app": {
"payload": { "selectedOption": "choice-value" },
"type": "submit"
}
}
}
Access the submitted values via: input.data.\_cognigy.\_app.payload.<field>

---

### xApp HTML — Variant B (Webhook inject)

SDK is not required for Variant B — the page never calls sdk.submit(), so omit the SDK script tag entirely.

You may use {{input.aiAgent.toolArgs.field}} directly in the HTML template passed to setHTMLAppState.
The node runs on the same tool execution turn, so toolArgs are still available when CognigyScript is
evaluated server-side. Use context if you need the value after this turn.

Example using toolArgs directly in HTML:
<span>{{input.aiAgent.toolArgs.guest_name}}</span>
<input value="{{input.aiAgent.toolArgs.room_type}}" />

  <script>
    const SESSION = {
      urlToken:  '{{ci.URLToken}}',
      userId:    '{{ci.userId}}',
      sessionId: '{{ci.sessionId}}'
    };
    async function fireWebhook(outcome) {
      await fetch('https://your-api.example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, ...SESSION })
      });
    }
  </script>

#### Multi-state async UI (recommended for Variant B)

Without state transitions the page appears frozen while the webhook fires. Use JS-driven state
visibility so the user sees a processing state before the outcome is known.

  <script>
    function showState(name) {
      ['form', 'processing', 'success', 'declined'].forEach(s => {
        document.getElementById('state-' + s).classList.toggle('hidden', s !== name);
      });
    }
    async function handleSubmit() {
      showState('processing');
      await fireWebhook('success');
      showState('success');
    }
  </script>
  <div id="state-form"><!-- form fields --></div>
  <div id="state-processing" class="hidden"><!-- spinner --></div>
  <div id="state-success" class="hidden"><!-- confirmation --></div>
  <div id="state-declined" class="hidden"><!-- retry prompt --></div>

States: form → processing (on submit) → success or declined (on webhook result).

External API then injects into Cognigy via the REST endpoint (same channel as talk_to_agent):
POST https://cognigy-endpoint-{env}.nicecxone.com/{urlToken}
{
"userId": "<userId from SESSION>",
"sessionId": "<sessionId from SESSION>",
"text": "",
"data": { "paymentResult": { "success": "true", "reference": "PAY-123" } }
}

IMPORTANT: The management API (/v2.0/projects/…/sessions/…) does NOT support injection on
AU1 — it returns 404. The correct injection path is the REST endpoint host shown above,
not the management API. The xApp HTML's SESSION object already contains the urlToken,
userId, and sessionId needed to construct this call.

Injected payload arrives as input.data.paymentResult (or whatever field you choose).

---

### IF node conditions

Choose a discriminating field that ONLY appears in submit/inject payloads, never in a regular turn.

Variant A (SDK.submit): input.data.\_cognigy.\_app.payload.<field> neq ""

Example: input.data.\_cognigy.\_app.payload.selectedOption neq ""

Variant B (webhook inject): input.data.paymentResult exists (or your chosen field)

### Then branch — extract and store for next turn

Variant A:
var payload = input.data.\_cognigy.\_app.payload;
context.shortTermMemory.selectedOption = payload.selectedOption;

Variant B (watch for string booleans — external APIs often return "true"/"false" not true/false):
var result = input.data.paymentResult;
context.shortTermMemory.paymentSuccess = result.success === 'true';

Write results to context.shortTermMemory (LLM-visible). The agent picks them up naturally on the next user utterance.

For immediate spoken acknowledgement, add a Say node in the Then branch before the flow ends.

### Else branch

Empty. Falls through to Once for normal turns. Do not add nodes here.

---

### Gotchas

**input.apps.url is one-turn only.** Miss it and the URL is gone — no recovery without re-running initAppSession (different URL).

**input.aiAgent.toolArgs.\* is one-turn only.** The LLM's collected parameters only exist on the tool execution turn. Persist to context in the code node immediately after setHTMLAppState.

**waitForInput: false must be set on setHTMLAppState.** If omitted or true, the flow blocks.

**The IF node's next pointer matters.** Both branches fall through to next. Ensure next points to Once, not null.

**Else branch is empty by design.** Normal turns are handled by Once → Afterwards. Do not add nodes to Else.

**Submit/inject turns must not reach the AI Agent Job.** The Then branch flows to Once → End. If a submit payload leaks into Afterwards, the agent interprets it as a user utterance.

**Variant B: string booleans.** External APIs commonly send "true"/"false" strings. Normalise explicitly: result.success === 'true', not result.success === true.

**Variant B: do not use SDK.submit() when a 3rd party processes the action.** User tap ≠ successful processing. Use webhook inject so the external system's outcome — not the user's gesture — is the authoritative event.
