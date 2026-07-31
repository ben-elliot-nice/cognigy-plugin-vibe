---
name: presentation
description: Design what a human perceives outside the core loop — visual moments, notifications, UI triggers — and the return-event contract, plus Presentation's half of any live-agent hand-off.
---

# Presentation (layer 4)

## When to use this

Use this skill to design everything a human perceives outside the core
conversational loop of a Cognigy AI agent: visual moments (cards, carousels,
xApp scenes), notifications/UI triggers, and the return-event contract that
tells the reasoning core what came back from a UI interaction. Per
`design-forge/reference/dependency-graph.md`, `presentation` is a **layer 4**
domain with two hard deps — `capability_inventory` and `state_model` (both
self-served via recursive invocation if missing) — plus a soft dep on
`integration`, and a shared-artefact relationship with `brand_research`'s
visual slice.

Do not restate the dependency graph's notes or the naming conventions here
beyond what's needed to justify this skill's behaviour — see
`design-forge/reference/dependency-graph.md` and
`design-forge/reference/naming-and-artefacts.md` for the full graph, the
self-serve rule, the shared-artefact append pattern, and the hand-off
ordering note.

**This skill's soft edge to `integration` is the graph's one
termination-critical edge.** Presentation <-> Integration is the graph's
only mutual edge, and it is deliberately soft in both directions so neither
domain can self-serve the other — a hard edge here would create an
unterminating mutual recursion. Accordingly: **this skill never invokes or
self-serves `integration` under any circumstance.** Its only interaction
with Integration's territory is use-if-present reads and append-only writes
against the shared `hand_off_contract` artefact (see below) — never a
recursive invocation of the `integration` skill itself.

## Inputs

- `build_identifier` — resolved and confirmed per
  `design-forge/reference/naming-and-artefacts.md` sections 1 and 3. In
  `standalone` mode, suggest a cwd-derived default and require the user to
  confirm it before writing anything. When self-served or dispatched by an
  orchestrator, accept the value exactly as passed down. When this skill
  self-serves `capability_inventory` and/or `state_model`, or triggers
  `brand-research`, it propagates this same resolved value unchanged.
- `mode` — `standalone` or `orchestrated`, always passed explicitly by the
  caller per naming-and-artefacts.md section 7. If not supplied, treat as
  missing required input and ask rather than guessing. This same `mode`
  value is propagated unchanged into any self-served or triggered
  sub-invocation.
- `channel_choice` (input, not a domain) — the channel(s) the agent runs on
  (e.g. `voice`/VoiceGateway, webchat). Needed to decide which visual
  moments and notifications are even reachable (a voice-only build has no
  card surface). Ask for this in `standalone` mode if not already supplied;
  never invent it.
- `brand_source` (optional) — passed through to `brand-research` if the
  visual slice needs producing (see below).

## Hard dependencies: `capability_inventory` and `state_model`

Both are hard deps; resolve them **in dependency order** —
`capability_inventory` first, then `state_model` — because `state_model`
itself hard-depends on `capability_inventory` (naming-and-artefacts.md
section 5's termination argument: self-serve recursion follows hard_deps
only, and the graph is a DAG, so resolving in this order never re-triggers
work already done).

1. **`capability_inventory`.** Check whether
   `{build_identifier}_capability_inventory.md` already exists. If it does,
   read it in full instead of regenerating it. If it does not exist,
   self-serve it: recursively invoke the `capability-inventory` skill,
   passing the same resolved `build_identifier` and `mode` unchanged, plus
   whatever use-case list is available to this run. Wait for it to produce
   `{build_identifier}_capability_inventory.md`, then read the result.
   `capability_inventory` is a root domain (no hard deps of its own), so
   this hop terminates immediately.
2. **`state_model`.** Check whether `{build_identifier}_state_model.md`
   already exists. If it does, read it in full instead of regenerating it.
   If it does not exist, self-serve it: recursively invoke the
   `state-model` skill, passing the same resolved `build_identifier` and
   `mode` unchanged. Per `state_model`'s own hard dependencies
   (`capability_inventory` and `routing`), it will in turn check for
   `{build_identifier}_capability_inventory.md` — which this run has
   already ensured exists (step 1) — and self-serve `routing` if needed.
   Wait for `state_model` to produce `{build_identifier}_state_model.md`,
   then read the result.
3. Any capability or state-field reference this skill makes when designing
   the return-event contract **must** be either a real `capabilities[].id`
   value found in the resolved capability inventory, or a real `fields[].name`
   value found in the resolved state model — never an invented id or name.

## Soft/shared dependency: `brand_research` visual slice

`presentation` is a **soft/shared consumer** of the `brand_research` shared
artefact's visual slice. Per naming-and-artefacts.md section 6,
`brand_research` is a shared artefact resolved by
**first-consumer-triggers-production**, not by hard-dep self-serve
recursion — the same shared-artefact trigger pattern the `identity` skill
uses for the voice/tone slice.

Check for `{build_identifier}_brand_research.md`:

- If it exists and already contains a `## Visual Identity` section, read
  that section and use its `colors`/`imagery`/`styling` to ground the
  visual moments below.
- If it doesn't exist, or exists without that section, invoke
  `brand-research` with `requested_slice: visual_identity`, the same
  `build_identifier`, and the same `mode`, passing through any
  `brand_source` given. This produces or extends the shared file with only
  the visual slice — never touching a `## Voice & Tone` or
  `## Compliance / Locale` section a prior consumer may have already
  written.
- If no visual grounding is available even after triggering
  `brand-research` (e.g. no brand source at all), proceed with generic,
  channel-appropriate visual moments and note the absence rather than
  fabricating colors/imagery.

## Soft/mutual dependency: `integration` via shared `hand_off_contract`

`presentation` and `integration` share a **mutual soft edge** — the one
cycle-shaped edge in the whole graph — routed entirely through the shared
`hand_off_contract` artefact, not through direct skill invocation. Per
naming-and-artefacts.md section 8, whichever of the two runs second in a
given build must read-and-append onto what the first one wrote; this
ordering is the orchestrator's responsibility to enforce, not this skill's,
but this skill must behave correctly regardless of which order it actually
runs in:

1. **Decide whether a live-agent hand-off is even in scope** for this
   build, based on the resolved capability inventory, state model, and any
   escalation/routing behaviour implied by them (e.g. an escalation
   capability, a "transfer to human agent" use case, a state field tracking
   failed self-service attempts). If no hand-off is plausible for this
   build, skip the rest of this section entirely — do not create
   `{build_identifier}_hand_off_contract.md` speculatively.
2. **If a hand-off is in scope**, check whether
   `{build_identifier}_hand_off_contract.md` already exists:
   - If it exists (Integration went first), read it in full. If it already
     contains Presentation's half, do not regenerate or overwrite it —
     report that it's already present. If it contains only Integration's
     half, **append** Presentation's half — a `## Presentation Hand-off
     Summary` prose section giving a natural-language summary of the
     hand-off event from the presentation side (e.g. what the user sees
     and is told at the moment of hand-off, any UI trigger fired). Never
     touch or overwrite Integration's existing section.
   - If it doesn't exist at all, create it containing only Presentation's
     half (the same `## Presentation Hand-off Summary` section) — leaving
     Integration's half for Integration to append later, whenever it runs.
3. **Under no circumstance does this skill invoke, self-serve, or otherwise
   trigger the `integration` skill itself** — not even indirectly by
   "helping it along." Its only footprint on `integration`'s territory is
   the read-if-present / append-only interaction with the shared
   `hand_off_contract` file described above. This is the specific behaviour
   that keeps the graph's one mutual edge from becoming an infinite
   mutual-recursion loop.

## Procedure

1. **Resolve `build_identifier` and the write path.** Per
   naming-and-artefacts.md sections 1 and 3, the artefact path is
   `{build_identifier}_presentation.md` (fixed `doc_identifier`:
   `presentation`, per section 2's fixed list). In `standalone` mode,
   confirm the identifier with the user before writing.

2. **Read the existing artefact if present.** If
   `{build_identifier}_presentation.md` already exists, read it in full
   instead of regenerating it, and report its existing content back to the
   caller.

3. **Resolve both hard dependencies** per the "Hard dependencies" section
   above, in order (`capability_inventory` then `state_model`). Do not
   proceed to step 5 without a concrete list of real capability ids and a
   resolved state model in hand.

4. **Resolve the visual shared-artefact slice** per the "Soft/shared
   dependency" section above.

5. **Produce exactly the required artefact contract**, using the
   hybrid-markdown rule (naming-and-artefacts.md section 4):
   - `## Visual Moments` — prose and/or a fenced YAML list describing each
     visual moment (e.g. an outage-status card, a ticket-reference
     confirmation), grounded in `channel_choice` and the resolved visual
     identity slice where available. Only include moments the channel can
     actually render.
   - `## Notifications / UI Triggers` — prose and/or a fenced list
     describing what fires a notification or UI trigger, and under what
     condition (grounded in capability/state-model events, e.g. a
     capability completing, a state field crossing a threshold).
   - `## Return-Event Contract` — a fenced YAML block describing what data
     comes back from a UI interaction into the reasoning core (e.g. a card
     button press, a form submission) and which state field or capability
     it maps to. Every mapped id/name must be real, per the "Hard
     dependencies" section's rule above.

6. **Resolve the `integration` mutual-soft/hand-off relationship** per the
   "Soft/mutual dependency" section above — decide in/out of scope, then
   read-and-append or create-fresh as appropriate. Never self-serve
   `integration`.

7. **Write the presentation artefact** to
   `{build_identifier}_presentation.md` (repo builds) or the
   caller-specified scratch path (smoke/test runs), and — if a hand-off was
   judged in scope — write or append to
   `{build_identifier}_hand_off_contract.md` per step 6. Then,
   **conversationally, in your response to the caller** (not as a section
   in the artefact file), report: whether `capability_inventory` and
   `state_model` were each read as-found or self-served; whether the
   visual slice was read as-found or triggered via `brand-research`;
   whether a hand-off was judged in/out of scope and, if in scope,
   whether Presentation's half was newly created or appended onto an
   existing Integration-authored file; and explicit confirmation that
   `integration` itself was never invoked or self-served. Do not add this
   as a section in the presentation artefact file — report it in your
   response to the caller instead.

## Tools

`Read`, `Write`, plus the ability to invoke the `capability-inventory` and
`state-model` skills (self-serve on hard dependencies only, in that order)
and the `brand-research` skill (shared-artefact trigger for the visual
slice only). This skill never invokes the `integration` skill, and never
invokes MCP/Cognigy tools directly — any grounding against a live
environment is the responsibility of the capability inventory it consumes.
