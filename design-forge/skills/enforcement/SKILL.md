---
name: enforcement
description: "Design the deterministic compliance-enforcement layer for a Cognigy AI agent — guard sub-flows, obligation state schema, and structured refusals for capabilities that can't be left to model cooperation. Runs a two-tier gate; only produces an artefact when the litmus test says yes."
---

# Enforcement (cross-cutting, conditional)

## When to use this

Use this skill to design the deterministic compliance-enforcement layer for
a Cognigy AI agent — guard sub-flows, an obligation state schema, and
structured refusals for capabilities that cannot be left to model
cooperation alone. Per `design-forge/reference/dependency-graph.md`,
`enforcement` is a **cross-cutting, conditional** domain (`layer: cross`,
`conditional: true`) with two hard deps — `capability_inventory` (to read
each item's `staging_confirmation` flag) and `state_model` (to place any
guard state in a dedicated `guard-state` namespace), both self-served via
recursive invocation if missing — plus a soft dep on `routing` (use-if-present,
never self-served).

Do not restate the dependency graph's notes or the naming conventions here
beyond what's needed to justify this skill's behaviour — see
`design-forge/reference/dependency-graph.md` and
`design-forge/reference/naming-and-artefacts.md` for the full graph, the
self-serve rule, and the hybrid-markdown rule.

**Unlike every other domain skill in this plugin, this skill does not
always produce an artefact.** It is the one skill in the plugin that runs a
gate before deciding whether to write anything at all. Read the "Two-tier
gate" section below before touching the Procedure — the gate **is** the
procedure's load-bearing step, not a precondition checked elsewhere.

## Inputs

- `build_identifier` — resolved and confirmed per
  `design-forge/reference/naming-and-artefacts.md` sections 1 and 3. In
  `standalone` mode, suggest a cwd-derived default and require the user to
  confirm it before writing anything. When self-served or dispatched by an
  orchestrator, accept the value exactly as passed down. When this skill
  self-serves `capability_inventory` and/or `state_model`, it propagates
  this same resolved value unchanged.
- `mode` — `standalone` or `orchestrated`, always passed explicitly by the
  caller per naming-and-artefacts.md section 7. If not supplied, treat as
  missing required input and ask rather than guessing. This same `mode`
  value is propagated unchanged into any self-served sub-invocation.

## Hard dependencies: `capability_inventory` and `state_model`

Both are hard deps; resolve them **in dependency order** —
`capability_inventory` first, then `state_model` — because `state_model`
itself hard-depends on `capability_inventory` (and, via its own hard-dep
chain, on `routing`). Resolving in this order means this skill's own
self-serve of `capability_inventory` is never repeated when `state_model`
in turn resolves its own copy of the same hard dep
(naming-and-artefacts.md section 5's termination argument).

1. **`capability_inventory`.** Check whether
   `{build_identifier}_capability_inventory.md` already exists. If it does,
   read it in full instead of regenerating it. If it does not exist,
   self-serve it: recursively invoke the `capability-inventory` skill,
   passing the same resolved `build_identifier` and `mode` unchanged, plus
   whatever use-case list is available to this run. Wait for it to produce
   `{build_identifier}_capability_inventory.md`, then read the result. This
   is the artefact whose `staging_confirmation` field the Tier 1 gate below
   reads.
2. **`state_model`.** Check whether `{build_identifier}_state_model.md`
   already exists. If it does, read it in full instead of regenerating it.
   If it does not exist, self-serve it: recursively invoke the
   `state-model` skill, passing the same resolved `build_identifier` and
   `mode` unchanged. Per `state_model`'s own hard deps, it will in turn
   resolve `capability_inventory` (already ensured present by step 1, so it
   reads rather than regenerates) and `routing`. Wait for `state_model` to
   produce `{build_identifier}_state_model.md`, then read the result. This
   is the artefact that supplies the `guard-state` namespace any obligation
   field this skill defines must live under.

## Soft dependency: `routing`

If `{build_identifier}_routing.md` already exists, read it and factor its
`intent_to_capability` / `escalation_routing` entries into which guard
sub-flow intercepts a flagged capability before it reaches the reasoning
core. If it does not exist, proceed without it — never self-serve
`routing` from this skill. `routing` is use-if-present only, per the soft
edge recorded in the dependency graph.

## Two-tier gate (spec line 127) — the load-bearing step

This is a two-tier gate, not a single check. **Tier 1 is a mechanical field
read; Tier 2 is a judgment call this skill must make itself, in its own
reasoning, every time it runs** — it is never deferred to an external
process, a downstream domain, or a later human review pass.

### Tier 1 — structural pre-filter (no judgment)

Scan every item in the resolved `capability_inventory`'s `capabilities:`
list and check its `staging_confirmation` field.

- **If no item has `staging_confirmation: true`:** stop here. Do **not**
  produce `{build_identifier}_enforcement.md` or any other file. Instead,
  return an advisory to the caller consisting of exactly two parts:
  1. A recommendation that at least one capability in this build carry a
     `staging_confirmation: true` flag if any of its effects are
     irreversible or consequential — named specifically, referencing the
     capability `id`(s) that came closest (e.g. any `reversibility:
     irreversible` item that is currently unflagged).
  2. A single suggested `behavioural_policy` instruction line the caller
     can hand to that domain instead of a guard sub-flow — e.g. "Before
     performing `<capability_id>`, ask the caller to explicitly confirm
     before proceeding" — making clear this is a model-cooperation
     fallback, not a deterministic guard, precisely because Tier 1 found
     nothing to enforce mechanically.
  - Confirm explicitly in this advisory that no `{build_identifier}_enforcement.md`
    file exists on disk as a result of this run.
- **If at least one item has `staging_confirmation: true`:** proceed to
  Tier 2, scoped only to those flagged items. Unflagged items are out of
  scope for the rest of this run — this skill never produces enforcement
  content for a capability that Tier 1 did not flag.

### Tier 2 — litmus judgment (per flagged item)

For each item flagged by Tier 1, apply the regulator question directly:
**"if this capability's effect were later disputed, could we prove it
didn't happen without the required prior approval?"** This is a real
judgment call this skill must reason through explicitly, not a rubber
stamp on Tier 1's output:

- Consider the capability's `reversibility` and `data_out` fields from the
  capability inventory: an irreversible effect with no recorded proof of
  prior approval is exactly the shape of gap the litmus targets.
- Consider whether a deterministic guard (a guard sub-flow gating the
  capability call behind a checked obligation-state field) would actually
  change the answer to the regulator question — if a guard could not
  plausibly produce evidence a model-cooperation instruction couldn't
  already produce, the litmus answer is no for that item.
- **State the reasoning and the yes/no verdict explicitly in the skill's
  response to the caller**, per-flagged-item — this is what makes the
  judgment observable rather than assumed.
- If the verdict is **no** for every flagged item, stop here: no artefact,
  and report the reasoning plus a recommendation to reconsider whether that
  item's `staging_confirmation` flag was set appropriately upstream.
- If the verdict is **yes** for one or more flagged items, proceed to
  produce the artefact — scoped **only** to the items with a yes verdict.

## Procedure

1. **Resolve `build_identifier` and the write path.** Per
   naming-and-artefacts.md sections 1 and 3, the artefact path (if one ends
   up being written at all) is `{build_identifier}_enforcement.md` (fixed
   `doc_identifier`: `enforcement`). In `standalone` mode, confirm the
   identifier with the user before writing anything.
2. **Read the existing artefact if present.** If
   `{build_identifier}_enforcement.md` already exists, read it in full
   instead of regenerating it, and report its existing content back to the
   caller — including which capabilities it is scoped to.
3. **Resolve both hard dependencies** per the "Hard dependencies" section
   above, in order (`capability_inventory` then `state_model`), and read
   `routing` if present per the soft-dependency section.
4. **Run the two-tier gate** per the section above. Do not skip Tier 1 even
   if the caller seems to expect an artefact — the gate, including its
   possible no-artefact outcome, is this skill's contract. Do not skip
   Tier 2's explicit reasoning even when Tier 1 found exactly one flagged
   item — the litmus judgment is never assumed from the mere presence of
   the flag.
5. **If Tier 2 produced at least one yes-verdict item, produce exactly the
   required artefact contract**, using the hybrid-markdown rule
   (naming-and-artefacts.md section 4), scoped **only** to the yes-verdict
   capabilities — never to unflagged items or to flagged-but-no-verdict
   items. Every guard reference produced here is checked by
   `design-forge/reference/structural-floor.md`'s check #5, which confirms
   each `enforcement` guard's capability reference resolves to a
   `capability_inventory` item whose `staging_confirmation` flag is set:
   - `## Guard Sub-flows` — prose plus a fenced YAML list, one entry per
     in-scope capability: the capability `id` it gates, the point in the
     flow where it intercepts the capability call (informed by `routing`
     if present), and what condition it checks before allowing the call
     through.
   - `## Obligation State Schema` — a fenced YAML block defining the
     obligation field(s) this guard relies on. Every field name here lives
     in a `guard-state` namespace (e.g. `guard_state.<capability_id>_approved`)
     so it is visibly distinct from the ordinary fields `state_model`
     already defines, and each entry names the in-scope capability `id` it
     backs.
   - `## Structured Refusals` — prose plus a fenced YAML or JSON block, one
     entry per in-scope capability: the refusal message/structured payload
     returned when the guard blocks the call, scoped to that capability
     only (never a generic catch-all refusal covering capabilities outside
     this run's flagged-and-verdicted set).
6. **Write the file** (repo builds) or the caller-specified scratch path
   (smoke/test runs) only when step 5 applies. Report back to the caller in
   every case (artefact-produced or advisory-only): whether
   `capability_inventory` and `state_model` were each read as-found or
   self-served, whether `routing` was present and used, the Tier 1 result
   (flagged item ids or none), and the Tier 2 verdict and reasoning for
   every flagged item.

## Tools

`Read`, `Write`, plus the ability to invoke the `capability-inventory` and
`state-model` skills (self-serve on hard dependencies only, in that order,
per the "Hard dependencies" section above). This skill never self-serves
`routing` — it only reads `{build_identifier}_routing.md` if already
present, per the soft-dependency section above.
