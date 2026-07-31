---
topic: agent-avatar-image
description: Custom avatar image on AI Agent — data URI pattern, imageOptimizedFormat, file spec
---

## agent-avatar-image — Setting a Custom AI Agent Avatar

### The image field

The `image` field on an AI Agent resource accepts two value shapes:

| Value                           | Meaning                                     |
| ------------------------------- | ------------------------------------------- |
| `"default-avatar:N"`            | Platform preset — N is 0-based (0, 1, 2, …) |
| `"data:image/png;base64,<b64>"` | Custom image as a data URI                  |

Always include `imageOptimizedFormat` in the update body alongside `image` — the platform sets this field regardless of which image type is used.

### File spec for a standout avatar

| Property            | Value                                                             |
| ------------------- | ----------------------------------------------------------------- |
| Width               | 136 px                                                            |
| Height              | 184 px                                                            |
| Background          | Transparent                                                       |
| Format              | PNG                                                               |
| Filename convention | Include `_optimized` in the filename (e.g. `quinn_optimized.png`) |

The portrait aspect ratio (136 × 184) fills the Cognigy avatar slot without cropping. A transparent background blends cleanly across UI themes.

### Pushing a custom avatar

There is no dedicated avatar-upload endpoint — it is a plain field update on the AI Agent
resource: `PATCH /v2.0/aiagents/{id}` with `image` set to the `data:image/png;base64,<b64>` data
URI (read the target PNG, exactly 136×184px, and base64-encode it) plus `imageOptimizedFormat:
true`.

Note: as of this writing `update_ai_agent` does not yet expose `image`/`imageOptimizedFormat` as
tool parameters — this documents the underlying REST capability so the tool can be extended to
support it; there is no other route to set a custom avatar through this server's tools today.

### Reverting to a platform preset

Same field, platform preset value: `{ "image": "default-avatar:0", "imageOptimizedFormat": true }`.
