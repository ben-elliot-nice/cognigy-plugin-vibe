---
topic: cognigyScript
description: interpolation contexts, what works where
---

## cognigyScript — CognigyScript Interpolation

### Syntax

{{context.namespace.field}}
{{input.data.fieldName}}
{{profile.firstName}}

### Condition fields vs text fields

Two different syntaxes depending on the field type:

| Field type            | Syntax                       | Example                           |
| --------------------- | ---------------------------- | --------------------------------- |
| Text / message fields | `{{expression}}`             | `Hello {{context.customer.name}}` |
| Condition fields      | Bare expression — no `{{ }}` | `context.isVIP === true`          |

Using `{{expr}}` in a condition field causes it to evaluate as a non-empty string,
which is always truthy — the branch always takes the same path regardless of the
actual value.

**Condition fields** (use bare expression):

- `ifThenElse` / `if` node `condition`
- Tool `condition` field in `.tool.json` — see explain("tool-conditions") for full semantics

**Text fields** (use `{{expression}}`):

- `say` node text
- AI Agent `instructions` / `jobInstructions` fields
- `setHTMLAppState` HTML content

### Confirmed working contexts

- Say node text field
- AI Agent Job instruction fields
- setHTMLAppState node HTML content
- Endpoint URL parameters (iframe src attribute values)
- Node labels (cosmetic only)

### NOT available

- Inside code node JavaScript bodies (use context.\* variables directly in JS)
- Inside JSON string values in httpRequest payloadJSON (unconfirmed, test carefully)

### payloadJSON in httpRequest

CognigyScript interpolation in payloadJSON is UNCONFIRMED.
Safe approach: use a Code node to build the payload object and store in context,
then reference it from the httpRequest via the context variable.

### Undefined values silently drop the object key, not just render empty

When a CognigyScript expression inside an object-typed config field (e.g. a
`sendMetadata` node's key/value map) resolves to `undefined`, Cognigy's
interpolation engine OMITS that key from the serialized object entirely —
it does not send the key with an empty string value. (Verified: observed
via live SIP INFO payload inspection in a Netwealth demo build session,
2026-07-13 — see issue #216.)

// config: { "sendMetadata": { "account_type": "{{context.onboarding.accountType}}" } }
// If context.onboarding.accountType is undefined at send time:
// WRONG assumption: { "account_type": "" } ← key present, empty
// ACTUAL behavior: {} ← key is GONE

This breaks any downstream consumer that pattern-matches on key presence
(e.g. frontend field-matching expecting `account_type` to always exist).

**Fix:** guard every value in an object-typed config field so it can never
resolve to `undefined` — check for `undefined` explicitly in the source
context value, not in the interpolation expression itself. Do NOT use
`someValue || ''` — that also coerces legitimate falsy values (`0`, `false`)
to `''`, reintroducing a different flavor of this same bug for any field
that can legitimately hold `0`/`false`:
// In the code node that sets context.onboarding.accountType:
context.onboarding.accountType = someValue === undefined ? '' : someValue;

This is a general constraint on ALL object-typed config fields (not just
`sendMetadata`) — see explain("node-config-update") for the related PATCH
full-replace gotchas on the same fields.

### Common pattern: build in code, reference in node

// Code node:
context.smsPayload = {
to: context.shortTermMemory.mobile,
body: `Your code is ${context.otpCode}`
};
// httpRequest node config: use {{context.smsPayload}} if payloadJSON works,
// or pipe through code node instead.
