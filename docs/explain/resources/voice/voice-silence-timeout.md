---
topic: voice-silence-timeout
description: Voice Gateway silence detection — three modes, noUserInput intent wiring, reprompt-then-escalate counter
---

## voice-silence-timeout — User Input Timeout Handling

**Voice flows only.** Chat channels have no native user input timeout — `Wait for Input` pauses indefinitely.

### Configuration

Set on the **Voice Gateway Parameter Details** node or via **Set Session Config**:

| Field                      | Default    | Purpose                          |
| -------------------------- | ---------- | -------------------------------- |
| `userNoInputTimeoutEnable` | `true`     | Enable/disable silence detection |
| `userNoInputMode`          | `"event"`  | `event`, `speech`, or `play`     |
| `userNoInputTimeout`       | `10000` ms | Silence window before triggering |
| `userNoInputRetries`       | `5`        | Max triggers before call ends    |
| `userNoInputSpeech`        | —          | TTS text (mode: `speech` only)   |
| `userNoInputUrl`           | —          | Audio URL (mode: `play` only)    |

### Mode Comparison

| Mode     | Flow re-enters?                       | Who handles reprompt?          |
| -------- | ------------------------------------- | ------------------------------ |
| `event`  | Yes — via `noUserInput` system intent | Your flow logic                |
| `speech` | No                                    | Voice Gateway plays TTS        |
| `play`   | No                                    | Voice Gateway plays audio file |

Use `event` when the reprompt should vary by context (e.g. different question on each retry).
Use `speech`/`play` for a fixed global reprompt.

### Flow Handling (event mode)

Silence fires a `USER_INPUT_TIMEOUT` event that re-enters the flow via the `noUserInput` system intent.
Discriminating field: `input.data.event === "USER_INPUT_TIMEOUT"`

Wire an Intent node or Default Reply to the `noUserInput` system intent to intercept these turns.

### Reprompt-Then-Escalate Pattern

Use a counter in `context` to track retries and branch after reaching the limit:

```javascript
async function main() {
  const count = (await getVar("context.noInputCount", false)) || 0;
  await setVar("context.noInputCount", count + 1);
}
```

- IF context.noInputCount < 2 → reprompt (Say node repeating the question)
- IF context.noInputCount >= 2 → handover or end call

Reset `context.noInputCount` to 0 in a code node that runs when a real user utterance arrives,
so retries don't carry over between different question steps.

### Deprecation Note

The generic Voice node was deprecated in Cognigy 4.96.0 and scheduled for removal in Q2 2026.
Configure silence timeout via Voice Gateway Parameter Details or Set Session Config instead.
