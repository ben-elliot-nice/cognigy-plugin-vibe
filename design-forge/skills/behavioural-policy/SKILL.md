---
name: behavioural-policy
description: Define the always-on behavioural rules for a Cognigy AI agent — style conventions, the channel I/O contract, and escalation trigger definitions — kept as separate sub-concerns.
---

# Behavioural Policy (layer 2)

## When to use this

Use this skill to define the always-on behavioural rules a Cognigy AI agent
follows regardless of which capability or route is active: its style
conventions, its per-channel input/output contract, and the definitions of
what situations trigger an escalation. Per
`design-forge/reference/dependency-graph.md`, `behavioural_policy` is a
**layer 2** domain with **no hard domain deps** (`hard_deps: []` in the
graph) — its one hard requirement is on `channel_choice`, which the graph
notes explicitly is an **input** (an interview thin-slice), not a domain:
never self-served via recursive skill invocation, always asked from the user
if not already supplied. Its soft deps are `identity` (use-if-present, for
tone alignment) and `state_model` (use-if-present, to scope which data-type
output rules are actually relevant).

Do not restate the dependency graph's notes or the naming conventions here
beyond what's needed to justify this skill's behaviour — see
`design-forge/reference/dependency-graph.md` and
`design-forge/reference/naming-and-artefacts.md` for the full graph, the
self-serve rule, and the hybrid-markdown rule.

## Inputs

- `build_identifier` — resolved and confirmed per
  naming-and-artefacts.md sections 1 and 3. In `standalone` mode, suggest a
  cwd-derived default and require the user to confirm it before writing
  anything. When self-served or dispatched by an orchestrator, accept the
  value exactly as passed down.
- `mode` — `standalone` or `orchestrated`, always passed explicitly by the
  caller per naming-and-artefacts.md section 7. If not supplied, treat as
  missing required input and ask rather than guessing.
- `channel_choice` — **hard-required input**, e.g. `voice (VoiceGateway)`,
  `webchat`, `WhatsApp`. This is not a domain artefact and is never
  self-served: if it has not already been supplied by the caller or an
  earlier interview step, ask the user for it directly before proceeding.
  Do not guess a channel or default to one silently.

## Soft dependencies

- `identity` (`{build_identifier}_identity.md`) — if this artefact already
  exists, read it and align the Style Conventions section's tone/voice
  guidance with it. If it does not exist, proceed without it — do not
  self-serve `identity` (it is soft, not hard) and do not block waiting for
  it.
- `state_model` (`{build_identifier}_state_model.md`) — if this artefact
  already exists, read it and use its declared data types to scope which
  Channel I/O output-transform rules are actually relevant (e.g. only
  include a currency-formatting rule if a currency-typed field is actually
  present in the state model). If it does not exist, proceed on the
  use-case/capability context available and cover the data types that are
  evidently in play (e.g. dates, reference numbers) without inventing state
  the run hasn't established.

An artefact that already exists on disk is always read, never regenerated,
per naming-and-artefacts.md section 5 — this applies to `identity` and
`state_model` here exactly as it would to a hard dep.

## Procedure

1. **Resolve `build_identifier` and the write path.** Per
   naming-and-artefacts.md sections 1 and 3, the artefact path is
   `{build_identifier}_behavioural_policy.md` (fixed `doc_identifier`:
   `behavioural_policy`). In `standalone` mode, confirm the identifier with
   the user before writing.

2. **Read the existing artefact if present.** If
   `{build_identifier}_behavioural_policy.md` already exists, read it in
   full instead of regenerating it, and report its existing content back to
   the caller.

3. **Resolve `channel_choice`.** If not already supplied by the caller, ask
   the user for it directly — this is a hard-required input, not a domain,
   so it is never satisfied by self-serving another skill. Do not proceed to
   step 5 without a concrete channel.

4. **Check soft deps.** Read `{build_identifier}_identity.md` if it exists
   (align tone/voice); read `{build_identifier}_state_model.md` if it exists
   (scope output-transform rules to the data types actually declared there).
   Neither is self-served if absent — proceed without blocking.

5. **Produce exactly the required artefact contract**, using the
   hybrid-markdown rule (naming-and-artefacts.md section 4). The three
   sub-concerns below **must stay separately headed** — do not merge them or
   fold one into another, even when content is short:

   - `## Style Conventions` — prose. The agent's voice, tone, formality
     level, and any brand-driven language rules (e.g. jargon avoidance,
     regional spelling/units). If `identity` was read, state explicitly how
     this section aligns with it; if not, derive tone from whatever brand
     source the caller supplied.

   - `## Channel I/O Contract` — for the resolved `channel_choice`, define:
     - an **input transform**: how to normalise known distortions in what
       the agent receives on this channel before treating it as clean data
       (e.g. reconstructing a spoken-out email address or postcode on a
       voice channel; handling pasted rich text on webchat).
     - an **output transform**: rules for what the agent emits on this
       channel to keep it safe/consumable (e.g. spelling out dates and
       currency amounts for TTS on voice, avoiding markdown that a voice
       channel can't render, enforcing an utterance length limit; by
       contrast, a text channel may permit markdown and longer structured
       replies).
     Fence this as a structured YAML block (channel name, `input_transform`
     list, `output_transform` list) with any necessary rationale in prose
     immediately around it — per the hybrid-markdown rule, don't force the
     rationale into YAML comments.

   - `## Escalation Triggers` — trigger **definitions only**: the
     conditions under which the agent must hand off or escalate (e.g.
     caller explicitly requests a human, repeated failed authentication,
     capability marked `staging_confirmation: true` being declined twice,
     detected distress). Do **not** include routing logic or escalation
     **destinations** here (which queue, which flow, which live-agent
     transfer target) — that is a different domain's responsibility (routing
     / integration). This section defines *what* triggers an escalation, not
     *where* it goes.

6. **Write the file** to `{build_identifier}_behavioural_policy.md` (repo
   builds) or the caller-specified scratch path (smoke/test runs), then
   report back to the caller: the resolved `channel_choice`, whether
   `identity` and/or `state_model` were found and used, and confirmation
   that all three sections (Style Conventions, Channel I/O Contract,
   Escalation Triggers) are present, separately headed, and that Escalation
   Triggers contains no routing/destination content.

## Tools

`Read`, `Write`. This skill never invokes MCP/Cognigy tools — it derives
its output entirely from the resolved `channel_choice`, the caller-supplied
brand/behavioural context, and whichever soft-dep artefacts already exist on
disk.
