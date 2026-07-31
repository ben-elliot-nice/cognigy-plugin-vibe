---
description: Code node runtime objects, CognigyScript interpolation, async function execution, output formatting, and profile editing
---

## code — Code Node Overview

Code nodes run arbitrary JavaScript inside a flow turn, with access to Cognigy's runtime objects
(`input`, `context`, `profile`, `analyticsdata`) and `api.*` helper functions. This group covers the
execution model, the utility functions built on top of the raw API (`getVar`/`setVar`/`mergeVar`,
`getProfileVar`/`setProfileVar`/`mergeProfileVar`), CognigyScript interpolation contexts, and the
async/inject-back pattern for long-running Function calls.

Reach for this group when writing or debugging a code node: what's available on `input`/`context`,
how to persist profile writes, how `api.say()` output shapes work, or how async Functions inject
their result back into a session.

Note: illustrative tool-call snippets in this group's topics (e.g. `cognigy_create`) were
ported from a sibling implementation's generic CRUD tool — in this server the equivalent
operation goes through `manage_flow_nodes`; the runtime/API behavior described still applies.
