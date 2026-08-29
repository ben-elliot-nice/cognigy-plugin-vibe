---
name: state-model
description: "Define what data a Cognigy AI agent persists — per field: readers, writers, lifetime, and how it surfaces back to the reasoning core. Hard-depends on capability inventory and routing."
---

# State Model (layer 3)

## When to use this

Use this skill to define what data a Cognigy AI agent persists across a
conversation (or across sessions): for each field, who reads it, who writes
it, how long it lives, and how it surfaces back to the reasoning core (the
model that decides what to say/do next). Per
`design-forge/reference/dependency-graph.md`, `state_model` is a **layer 3**
domain with **two hard deps**: `capability_inventory` and `routing` (both
self-served via recursive invocation if their artefacts are missing) and
**no soft deps**.

Do not restate the dependency graph's notes or the naming conventions here
beyond what's needed to justify this skill's behaviour — see
`design-forge/reference/dependency-graph.md` and
`design-forge/reference/naming-and-artefacts.md` for the full graph, the
self-serve rule, and the hybrid-markdown rule.

## Inputs

- `build_identifier` — resolved and confirmed per naming-and-artefacts.md
  sections 1 and 3. In `standalone` mode, suggest a cwd-derived default and
  require the user to confirm it before writing anything. When self-served
  or dispatched by an orchestrator, accept the value exactly as passed
  down. When this skill self-serves `capability_inventory` and/or
  `routing`, it propagates this same resolved value unchanged — it is
  never re-derived or re-confirmed at a deeper recursion level.
- `mode` — `standalone` or `orchestrated`, always passed explicitly by the
  caller per naming-and-artefacts.md section 7. If not supplied, treat as
  missing required input and ask rather than guessing. This same `mode`
  value is propagated unchanged into any self-served `capability_inventory`
  or `routing` invocation.

## Hard dependencies: `capability_inventory` and `routing`

Both are hard deps; resolve them **in dependency order** —
`capability_inventory` first, then `routing` — because `routing` itself
hard-depends on `capability_inventory` (naming-and-artefacts.md section 5's
termination argument: self-serve recursion follows hard_deps only, and the
graph is a DAG, so resolving in this order never re-triggers work already
done).

1. **`capability_inventory`.** Check whether
   `{build_identifier}_capability_inventory.md` already exists. If it does,
   read it in full instead of regenerating it. If it does not exist,
   self-serve it: recursively invoke the `capability-inventory` skill,
   passing the same resolved `build_identifier` and `mode` unchanged, plus
   whatever use-case list is available to this run. Wait for it to produce
   `{build_identifier}_capability_inventory.md`, then read the result.
   `capability_inventory` is a root domain (no hard deps of its own), so
   this hop terminates immediately.
2. **`routing`.** Check whether `{build_identifier}_routing.md` already
   exists. If it does, read it in full instead of regenerating it. If it
   does not exist, self-serve it: recursively invoke the `routing` skill,
   passing the same resolved `build_identifier` and `mode` unchanged. Per
   `routing`'s own hard dependency, it will in turn check for
   `{build_identifier}_capability_inventory.md` — which this run has
   already ensured exists (step 1) — so `routing`'s self-serve invocation
   reads it rather than re-triggering `capability_inventory` again. Wait
   for `routing` to produce `{build_identifier}_routing.md`, then read the
   result.
3. Every `id` this skill references as a `fields[].readers` or
   `fields[].writers` entry **must** be either a real `capabilities[].id`
   value found in the resolved capability inventory, or a real domain name
   from `design-forge/reference/dependency-graph.md`'s `domains:` list
   (e.g. `routing`, `presentation`, `integration`) when the reader/writer
   is a downstream domain rather than a single capability — never an
   invented id or name.

## Procedure

1. **Resolve `build_identifier` and the write path.** Per
   naming-and-artefacts.md sections 1 and 3, the artefact path is
   `{build_identifier}_state_model.md` (fixed `doc_identifier`:
   `state_model`). In `standalone` mode, confirm the identifier with the
   user before writing.

2. **Read the existing artefact if present.** If
   `{build_identifier}_state_model.md` already exists, read it in full
   instead of regenerating it, and report its existing content back to the
   caller.

3. **Resolve both hard dependencies** per the "Hard dependencies" section
   above, in order (`capability_inventory` then `routing`). Do not proceed
   to step 4 without a concrete list of real capability ids and a resolved
   routing artefact in hand.

4. **Derive the field list.** For each piece of data implied by the
   resolved capability inventory's `data_in`/`data_out` values and the
   resolved routing artefact's `intent_to_capability` /
   `escalation_routing` entries (e.g. an identifier collected once and
   needed by a later capability, a result carried across a handoff, a
   running count that governs an escalation trigger), decide whether it
   needs to persist at all — not every piece of data passed within a single
   capability call becomes a state field.

5. **Produce exactly the required artefact contract**, using the
   hybrid-markdown rule (naming-and-artefacts.md section 4). A single
   fenced YAML block with one top-level key, `fields:` — a list; each
   entry is an object with **exactly six** required keys:

   - `name` — a short snake_case field name unique within this artefact.
   - `persists` — a **real boolean** (`true`/`false`), never a string:
     `true` if the field survives beyond the single turn/capability call
     that produced it, `false` if it is transient/turn-scoped but still
     worth naming (e.g. because multiple readers touch it within a turn).
   - `readers` — a list of real ids/names that read this field: each
     entry must be either a `capabilities[].id` from the resolved
     capability inventory, or a real domain name from the dependency
     graph's `domains:` list.
   - `writers` — a list of real ids/names that write this field, under
     the same rule as `readers`.
   - `lifetime` — a short prose or fixed-vocabulary description of how
     long the field lives (e.g. `turn`, `session`, `cross_session`, or a
     short qualifier of what ends its lifetime, such as "cleared on
     handoff to a human queue").
   - `surfacing` — how this field's value returns to the reasoning core
     (e.g. injected into the next LLM turn's context, read back via a
     specific tool/capability call, surfaced only in a system prompt
     slice) — this is what distinguishes a merely-stored field from one
     the reasoning core can actually act on.

   Do not add extra keys beyond these six, and do not omit any of them —
   downstream domains (presentation, integration, enforcement) parse this
   list mechanically and depend on the fixed key set. Where a judgment
   call needs explaining (e.g. why a field was marked `persists: false`
   despite being read by more than one capability, or why a reader/writer
   is a domain name rather than a capability id), add a short prose note
   near the YAML block rather than folding rationale into a YAML comment.

6. **Write the file** to `{build_identifier}_state_model.md` (repo builds)
   or the caller-specified scratch path (smoke/test runs), then report
   back to the caller: whether `capability_inventory` and `routing` were
   each read as-found or self-served, the number of `fields` entries
   produced, and confirmation that every field carries all six required
   keys with `persists` as a real boolean and every `readers`/`writers`
   entry verified against a real capability id or real domain name.

## Tools

`Read`, `Write`, plus the ability to invoke the `capability-inventory` and
`routing` skills (self-serve on hard dependencies only, in that order, per
the "Hard dependencies" section above). This skill never invokes
MCP/Cognigy tools directly — any grounding against a live environment is
the responsibility of the capability inventory it consumes, not of state
model itself.
