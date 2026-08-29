---
topic: xapp-delivery
description: session init, postMessage bridge, SDK.submit, dual xApp moments
---

## xapp-delivery — xApp Patterns

### Where to write HTML source before `push_html_node`

Same convention as code nodes (see explain("code-node-patterns")) — write the HTML/JS source to a file in the project directory (e.g. `xapp/<moment-name>.html`), not a scratchpad or temp directory. Keeps xApp source discoverable and editable across sessions instead of regenerated from scratch each time.

### Session init

initAppSession node generates input.apps.url (EPHEMERAL — only available this turn).
Immediately after: Code node reads and persists it:
context.xappSessionUrl = input.apps.url;

### Sending the xApp URL

SMS via CXone:
const smsBody = `Click here: ${context.xappSessionUrl}`;
// Use CXone SMS API via httpRequest node

### Passing context to the xApp page

Embed CognigyScript in iframe src URL params:
https://my-app.com/page?name={{context.shortTermMemory.customerName}}&token={{context.xappSessionUrl}}

### Page submits back to Cognigy

Option A (webchat): window.parent.postMessage({type: 'cognigy-submit', payload: {...}}, '\*')
Option B (SDK): SDK.submit({...})
PostMessage bridge in iframe:
window.addEventListener('message', (e) => {
if (e.data?.type === 'cognigy-submit') SDK.submit(e.data.payload);
});

### Reading submission in flow

SDK path: input.data.\_cognigy.\_app.payload
Webchat: input.data (direct)

### Session guard pattern

xApp session URL must be persisted in context — input.apps.url is ephemeral.
if (!context.xappSessionUrl) {
// session was lost — reinitiate
}

### api.setAppState() limitation + conditional push pattern

api.setAppState() in code nodes CANNOT push HTML content or external URLs.
Use the setHTMLAppState node instead (type: "setHTMLAppState", extension: "@cognigy/basic-nodes").
For a voice (non-xApp) WebRTC session, see `explain("voice-gateway")`'s
`sendMetadata` section — the VG-native equivalent for pushing structured data
without an xApp iframe.
Pattern for conditional xApp push from code:

1. Code node: context.xappTrigger = true;
2. ifThenElse: condition = context.xappTrigger === true
3. setHTMLAppState node (in true branch)
4. Code node: context.xappTrigger = false;

### Dual xApp moments

Some flows need TWO distinct xApp interactions (form then status update).
Each is a separate initAppSession cycle. Store URLs separately:
context.xappSessionUrl // first moment
context.xappDocUploadUrl // second moment
This pattern is NOT in the Cognigy documentation — it is discovered during build.
