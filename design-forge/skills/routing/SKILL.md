---
name: routing
description: Map intents to capabilities and define escalation routing (destination + post-trigger sequencing) for a Cognigy AI agent. Hard-depends on the capability inventory.
---

# Routing (layer 2)

## When to use this

Use this skill to map caller intents onto the discrete capabilities a
Cognigy AI agent can perform, and to define escalation routing: for each
escalation trigger already defined elsewhere, where it goes (destination
capability or human queue) and what happens immediately after the handoff
fires. Per `design-forge/reference/dependency-graph.md`, `routing` is a
**layer 2** domain with a **hard dep** on `capability_inventory` (the
graph's spine — self-served via recursive invocation if the artefact is
missing) and a **soft dep** on `behavioural_policy`'s escalation trigger
definitions (use-if-present).

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
  down. When this skill self-serves `capability_inventory`, it propagates
  this same resolved value unchanged — it is never re-derived or
  re-confirmed at the deeper recursion level.
- `mode` — `standalone` or `orchestrated`, always passed explicitly by the
  caller per naming-and-artefacts.md section 7. If not supplied, treat as
  missing required input and ask rather than guessing. This same `mode`
  value is propagated unchanged into a self-served `capability_inventory`
  invocation.
- Intent list — the caller-facing phrasings/intents this build needs to
  route (may overlap 1:1 with capability items, or may be a coarser or
  finer slice than the capability list). In `standalone` mode, ask for
  this if not already supplied; in `orchestrated` mode, rely on the
  orchestrator-supplied context.

## Hard dependency: `capability_inventory`

1. Check whether `{build_identifier}_capability_inventory.md` already
   exists. If it does, **read it in full instead of regenerating it** —
   per naming-and-artefacts.md section 5, an artefact that already exists
   on disk is always read, never regenerated.
2. If it does **not** exist, self-serve it: recursively invoke the
   `capability-inventory` skill, passing the same resolved
   `build_identifier` and `mode` unchanged, plus whatever use-case list is
   available to this run. Wait for it to produce
   `{build_identifier}_capability_inventory.md`, then read the result.
   Per naming-and-artefacts.md section 5's termination argument,
   self-serve recursion follows hard_deps only and `capability_inventory`
   is itself a root domain (no hard deps of its own), so this recursion is
   guaranteed to terminate in exactly one hop.
3. Every `id` this skill references in `intent_to_capability` or as an
   `escalation_routing` capability destination **must** be one of the
   `capabilities[].id` values found in that just-resolved (read or
   self-served) inventory — never an invented id.

## Soft dependency: `behavioural_policy` escalation triggers

- If `{build_identifier}_behavioural_policy.md` already exists, read its
  `## Escalation Triggers` section and use those trigger *definitions* as
  the fired-trigger side of `escalation_routing` entries — this skill adds
  the destination and post-trigger sequencing that behavioural_policy
  deliberately excludes.
- If it does not exist, **do not self-serve it** — it is soft, not hard.
  Proceed with whatever escalation triggers are otherwise evident from the
  intent list or caller-supplied context (e.g. an explicit "talk to a
  human" intent), noting in prose that no behavioural_policy artefact was
  found to ground fuller trigger definitions.

## Procedure

1. **Resolve `build_identifier` and the write path.** Per
   naming-and-artefacts.md sections 1 and 3, the artefact path is
   `{build_identifier}_routing.md` (fixed `doc_identifier`: `routing`). In
   `standalone` mode, confirm the identifier with the user before writing.

2. **Read the existing artefact if present.** If
   `{build_identifier}_routing.md` already exists, read it in full instead
   of regenerating it, and report its existing content back to the caller.

3. **Resolve the hard dependency** per the "Hard dependency:
   `capability_inventory`" section above — read if present, self-serve if
   absent. Do not proceed to step 5 without a concrete list of real
   capability ids in hand.

4. **Check the soft dependency** per the "Soft dependency:
   `behavioural_policy` escalation triggers" section above.

5. **Produce exactly the required artefact contract**, using the
   hybrid-markdown rule (naming-and-artefacts.md section 4). A single
   fenced YAML block with two top-level keys:

   - `intent_to_capability:` — a list; each entry maps one caller intent
     to one real `capability_inventory` item id:
     - `intent` — a short description of the caller-facing intent/phrasing.
     - `capability_id` — must exactly match a `capabilities[].id` value
       found in the just-resolved capability inventory.

   - `escalation_routing:` — a list; each entry describes one fired
     trigger's routing:
     - `trigger` — the escalation trigger definition (from
       `behavioural_policy` if it was found, otherwise from evident
       context — see the soft-dep note above).
     - `destination` — either a real `capability_id` from the resolved
       inventory, or a human queue name (e.g. `human_queue:tier1_support`)
       when the trigger routes to a live person rather than another
       capability. A capability destination MUST reference a real id;
       never invent one.
     - `post_trigger_sequence` — an ordered list of short steps describing
       what happens immediately after the handoff fires (e.g. what the
       agent says, what context is carried across, what happens if the
       destination is unavailable).

   Where a judgment call needs explaining (e.g. why an intent was mapped
   to a broader/narrower capability than a literal 1:1 match, or why a
   trigger routes to a human queue instead of a capability), add a short
   prose note near the YAML block rather than folding rationale into a
   YAML comment.

6. **Write the file** to `{build_identifier}_routing.md` (repo builds) or
   the caller-specified scratch path (smoke/test runs), then report back
   to the caller: whether `capability_inventory` was read as-found or
   self-served, whether `behavioural_policy` was found and used, the
   number of `intent_to_capability` entries and `escalation_routing`
   entries produced, and confirmation that every capability destination
   referenced across both sections is a real id from the resolved
   inventory.

## Tools

`Read`, `Write`, plus the ability to invoke the `capability-inventory`
skill (self-serve on its hard dependency only, per the "Hard dependency"
section above). This skill never invokes MCP/Cognigy tools directly — any
grounding against a live environment is the responsibility of the
capability inventory it consumes, not of routing itself.
