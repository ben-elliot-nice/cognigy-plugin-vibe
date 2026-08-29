---
topic: connections
description: create/update body shape for the connections resource type — provider credentials referenced by endpoints/extensions
---

## connections — Creating and Updating Connections

### What a Connection is

A project-level (or agent-level) credential/config object that other resources
(endpoints, extensions) reference by ID. Distinct from an "endpoint" — a
connection holds a provider credential; an endpoint is a channel binding.

### Verified create body shape

This shape is drawn from working production code (a Microsoft Azure Speech connection
provisioned ahead of a VoiceGateway webRTC endpoint) via `POST /v2.0/connections`:

{
"name": "My Speech Connection",
"extension": "@cognigy/audio-preview-provider",
"type": "MicrosoftSpeechProvider",
"resourceLevel": "project",
"projectId": "<projectId>",
"fields": {"apiKey": "<key>", "region": "australiaeast"},
}

Required fields confirmed by this working example: `name`, `extension`, `type`,
`resourceLevel`, `projectId`, `fields` (a nested object whose keys depend on
`type` — for `MicrosoftSpeechProvider` it's `apiKey` + `region`).

### Other connection `type`/`extension` pairs

Only the `MicrosoftSpeechProvider` / `@cognigy/audio-preview-provider` pair has
been verified. For any other provider (e.g. a different LLM or speech vendor),
the `type` string and the shape of `fields` are unverified — read back an
existing working connection of the type you need (`GET /v2.0/connections/{id}`)
rather than guessing it.

Note: `connections` is not currently one of the `resourceType` values `list_resources` /
`get_resource` / `delete_resource` support in this server — it is reached only indirectly today
(e.g. through `manage_voice_gateway`/`setup_llm` provisioning flows). This topic documents the
underlying REST shape for reference and for extending those tools.

### Cross-reference

See `explain("endpoint-config")` for how a connection interacts with endpoint
provisioning (the speech connection is a prerequisite for VoiceGateway webRTC
endpoints).
