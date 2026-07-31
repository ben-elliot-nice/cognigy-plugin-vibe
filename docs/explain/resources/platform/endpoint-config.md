---
topic: endpoint-config
description: referenceId vs _id gotcha, urlToken caching, VoiceGateway webRTC endpoint, per-channel field differences
---

## endpoint-config — Creating and Referencing Endpoints

### Endpoint request shape varies by channel — do not assume one shape fits all

`POST /v2.0/endpoints` accepts a different body shape depending on `channel`.
The `rest` channel and `voiceGateway2` channel are **not** interchangeable —
sending the wrong shape to the wrong channel is rejected by the live API
(e.g. `voiceGateway2` rejects `flowReferenceId` outright: "Field
'flowReferenceId' is not allowed").

#### `rest` channel: `flowId` (hex) + `flowReferenceId` (UUID), both required

// Get the flow first:
flow = cognigy_get(resource_type="flows", resource_id=flowId)
// flow.\_id = "64a3f1c2..." ← hex, DO NOT use as flowReferenceId
// flow.referenceId = "550e8400-..." ← UUID, USE THIS

cognigy_create(resource_type="endpoints", body={
"name": "My REST Endpoint",
"channel": "rest",
"flowId": flow.\_id,
"flowReferenceId": flow.referenceId, ← required
"projectId": projectId,
})

#### `voiceGateway2` channel: single `flowId` field holding the UUID, no `flowReferenceId`

cognigy_create(resource_type="endpoints", body={
"projectId": projectId,
"entrypoint": projectId,
"name": "My VG Endpoint",
"channel": "voiceGateway2",
"localeId": locale.referenceId, ← project's locale referenceId (UUID)
"flowId": flow.referenceId, ← UUID here, NOT flow.\_id
"agentId": "",
"targetType": "flow",
"customIcon": "",
})

There is no `flowReferenceId` field for `voiceGateway2` — the single `flowId`
field carries the UUID that `rest` puts in `flowReferenceId`.

### urlToken caching

After endpoint creation, sync_remote_state caches the urlToken in state:
state.endpoints["My REST Endpoint"]["urlToken"] = "tok123"
This allows talk_to_agent to find the token without an API call.

### Endpoint URL format

{COGNIGY_ENDPOINT_BASE}/{urlToken}
where COGNIGY_ENDPOINT_BASE = COGNIGY_BASE_URL with cognigy-api- → cognigy-endpoint-

### AU1 domain derivation

cognigy-api-au1.nicecxone.com → cognigy-endpoint-au1.nicecxone.com

### VoiceGateway webRTC endpoint — full provisioning sequence

Creating a working webRTC demo widget for `voiceGateway2` is a 4-step
sequence, not a single create call:

1. `POST /v2.0/connections` — create a speech connection (e.g.
   `MicrosoftSpeechProvider`).
2. `PATCH /v2.0/projects/{projectId}/settings` — set
   `audioPreviewSettings.connections.<provider>.connectionId` to the
   connection's `referenceId` (not its `_id`). Without this step, the widget
   cannot be enabled — the API returns "Please configure or select a speech
   provider in your voice preview settings."
3. `POST /v2.0/endpoints` — create the endpoint (see the `voiceGateway2`
   shape above). `webrtcWidgetConfig` in this initial POST body is ignored —
   the widget is not enabled yet at this point.
4. `PATCH /v2.0/endpoints/{endpointId}` — a separate follow-up call with
   `createWebrtcClient: true` and the full `webrtcWidgetConfig` (theme,
   transcription, demoPage) actually enables the widget.

Demo URL format: `{COGNIGY_ENDPOINT_BASE}/demo/{URLToken}`

`provision_webrtc_endpoint` handles all 4 steps plus credential detection
and dummy-connection cleanup in one call — use it rather than composing the
steps manually via `cognigy_create`/`cognigy_update`.
