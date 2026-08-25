---
topic: voice-gateway
description: VG endpoint routing, Set Session Config, SIP headers, DTMF
---

## voice-gateway — Voice Channel Patterns

### VG Entrypoint + Channel Settings — required pairing

VG Entrypoint and Channel Settings are paired in the Cognigy UI.
Channel Settings holds the TTS/STT config and instructions (NOT the VG Entrypoint).
Both must exist.

### Set Session Config node

- Required for all voice flows (TTS engine, STT engine, barge-in, silence timeout)
- Place in OnFirstTime branch (not main chain — avoid re-init every turn)
- Copy-paste identical across demos: create once, copy to other flows

#### Config shape — ONE flat object, no per-vendor nesting

`setSessionConfig.config` is a single flat object (~76 keys) — **identical shape for
every vendor**. Confirmed by pulling live nodes from a real flow with one exemplar
node per vendor (Microsoft, AWS, Google, Nuance, ElevenLabs, Deepgram, Deepgram+Flux,
Speechmatics) — every node has the same key set. There is no `synthesizer` /
`recognizer` / `bargeIn` nested shape — if you see that nested shape documented
anywhere, it's wrong; the real API is flat.

Fields that matter for TTS/STT vendor selection:

```
ttsVendor: "<lowercase vendor slug>"
ttsModel: "<vendor-specific model id, or empty string>"
ttsVoice: "<vendor-specific voice id/name>"
ttsLanguage: "<language code, vendor-specific format>"
ttsLabel: "<Cognigy connection label>"
sttVendor: "<lowercase vendor slug>"
sttLanguage: "<language code, vendor-specific format>"
sttModel: "<vendor-specific model id, or empty string>"
sttLabel: "<Cognigy connection label>"
```

#### Vendor slugs — lowercase, exact match required

`ttsVendor` and `sttVendor` must be one of these **exact lowercase** values —
Cognigy's own schema (`IAiAgent_2_0.properties.voiceConfigs.properties.ttsVendor`
enum) confirms: `aws`, `deepgram`, `elevenlabs`, `google`, `microsoft`, `nuance`,
`default`, `custom`, `none`. Live-observed STT-only vendors add `deepgramflux` and
`speechmatics` (not TTS-capable, so absent from that enum).

**This is the source of the "Set Session Config always shows custom" bug.** The
Cognigy UI displays vendor names with proper-case display text (e.g. "ElevenLabs",
"Microsoft") — but the API field needs the lowercase slug (`elevenlabs`,
`microsoft`). Any value that doesn't exactly match the enum — including a
capitalization mismatch — falls back to `"custom"` (a real, explicit enum value,
not an error). **Never copy the vendor name as displayed in the Cognigy UI
verbatim — always normalize to the lowercase slug above before writing
`ttsVendor`/`sttVendor`.**

### VG endpoint creation — automatable via `manage_voice_gateway`

Creating a VoiceGateway webRTC endpoint and binding it to a flow is fully
API-automatable. `manage_voice_gateway` handles the Microsoft Azure Speech
Services connection prerequisite, the project's `audioPreviewSettings` wiring,
locale lookup, endpoint creation (`channel: "voiceGateway2"`, flow binding via
`flowId` holding the flow's UUID `referenceId`), and a follow-up call to
enable the webRTC widget — in one call. See `explain("endpoint-config")` for
the full per-channel field shapes and the exact call sequence.

The webRTC demo URL is `{COGNIGY_ENDPOINT_BASE}/demo/{URLToken}`.

### DTMF input

Comes in via: input.data.dtmf (string, e.g. "1" or "2")
Use an ifThenElse or lookup node to branch on DTMF value.

### ANI (caller ID) from voice / SIP header paths

input.data.payload.from // ANI — caller's phone number (SIP format: "+61412345678")
input.data.payload.to // DNIS — dialled number
input.data.payload.callerEmail // email from SIP header (if CXone passes it)
input.data.payload.headers // full SIP headers object

### REST vs Voice streaming differences

REST endpoint with outputImmediately:true:

- Terminates connection on tool_calls before all output is delivered
- Single-pass response recommended
  Voice pipeline:
- Synchronous — all tool handling completes before response delivered to caller
- Two-pass confirmation pattern works correctly on voice

### sendMetadata — pushing structured data to a WebRTC client

`sendMetadata` (extension `@cognigy/voicegateway2`, see `explain("extension-map")`)
sends a JSON payload to the voice channel — the native VG alternative to
xApp's `setHTMLAppState` (see `explain("xapp-delivery")`) when the client is a
WebRTC voice session rather than an xApp iframe session.

**Constraint: flat object only, no nesting.** The payload must be a single-level
object — e.g. `{"event": "call_transferred", "step": "confirm"}` is valid;
`{"event": {"type": "call_transferred"}}` (a nested value) is not. This was
discovered empirically against a real build, not documented anywhere in the
Cognigy platform docs — flatten any structured state before sending it.

cognigy_create(body={
"type": "sendMetadata",
"mode": "append",
"target": "<previousNodeId>",
"flowId": "<flowId>",
"config": {"metadata": {"event": "call_transferred", "step": "confirm"}}
})

The exact `config` key holding the payload (`metadata` above) has not been
verified against a live Cognigy environment in this codebase — cross-check
against an existing working `sendMetadata` node via
`cognigy_get(resource_type="node", resource_id=..., flow_id=...)` if you have
one, before relying on this key name.
