---
name: integration
description: Design a Cognigy AI agent's data exchange with other systems — backend writes, dashboard/ticketing updates — and Integration's structured half of any live-agent hand-off.
---

# Integration (layer 4)

## When to use this

Use this skill to design everything a Cognigy AI agent writes or pushes
out to systems other than the reasoning core and the human it's talking
to: backend writes (e.g. a CRM update, a fault-ticket creation call), and
dashboard/ticketing updates that surface build state to a human operator
or support tool. Per `design-forge/reference/dependency-graph.md`,
`integration` is a **layer 4** domain with two hard deps —
`capability_inventory` and `state_model` (both self-served via recursive
invocation if missing) — plus a soft dep on `presentation`.

Do not restate the dependency graph's notes or the naming conventions here
beyond what's needed to justify this skill's behaviour — see
`design-forge/reference/dependency-graph.md` and
`design-forge/reference/naming-and-artefacts.md` for the full graph, the
self-serve rule, the shared-artefact append pattern, and the hand-off
ordering note.

**This skill's soft edge to `presentation` is the graph's one
termination-critical edge.** Presentation <-> Integration is the graph's
only mutual edge, and it is deliberately soft in both directions so
neither domain can self-serve the other — a hard edge here would create
an unterminating mutual recursion. Accordingly: **this skill never
invokes or self-serves `presentation` under any circumstance.** Its only
interaction with Presentation's territory is use-if-present reads and
append-only writes against the shared `hand_off_contract` artefact (see
below) — never a recursive invocation of the `presentation` skill itself.

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
itself hard-depends on `capability_inventory` (naming-and-artefacts.md
section 5's termination argument: self-serve recursion follows hard_deps
only, and the graph is a DAG, so resolving in this order never re-triggers
work already done).

1. **`capability_inventory`.** Check whether
   `{build_identifier}_capability_inventory.md` already exists. If it
   does, read it in full instead of regenerating it. If it does not
   exist, self-serve it: recursively invoke the `capability-inventory`
   skill, passing the same resolved `build_identifier` and `mode`
   unchanged, plus whatever use-case list is available to this run. Wait
   for it to produce `{build_identifier}_capability_inventory.md`, then
   read the result. `capability_inventory` is a root domain (no hard deps
   of its own), so this hop terminates immediately.
2. **`state_model`.** Check whether `{build_identifier}_state_model.md`
   already exists. If it does, read it in full instead of regenerating
   it. If it does not exist, self-serve it: recursively invoke the
   `state-model` skill, passing the same resolved `build_identifier` and
   `mode` unchanged. Per `state_model`'s own hard dependencies
   (`capability_inventory` and `routing`), it will in turn check for
   `{build_identifier}_capability_inventory.md` — which this run has
   already ensured exists (step 1) — and self-serve `routing` if needed.
   Wait for `state_model` to produce `{build_identifier}_state_model.md`,
   then read the result.
3. Any capability or state-field reference this skill makes when
   designing backend writes or dashboard/ticketing updates **must** be
   either a real `capabilities[].id` value found in the resolved
   capability inventory, or a real `fields[].name` value found in the
   resolved state model — never an invented id or name.

## Soft/mutual dependency: `presentation` via shared `hand_off_contract`

`integration` and `presentation` share a **mutual soft edge** — the one
cycle-shaped edge in the whole graph — routed entirely through the shared
`hand_off_contract` artefact, not through direct skill invocation. Per
naming-and-artefacts.md section 8, whichever of the two runs second in a
given build must read-and-append onto what the first one wrote; this
ordering is the orchestrator's responsibility to enforce, not this
skill's, but this skill must behave correctly regardless of which order
it actually runs in:

1. **Decide whether a live-agent hand-off is even in scope** for this
   build, based on the resolved capability inventory, state model, and
   any escalation/routing behaviour implied by them (e.g. an escalation
   capability, a "transfer to human agent" use case, a state field
   tracking failed self-service attempts). If no hand-off is plausible
   for this build, skip the rest of this section entirely — do not create
   `{build_identifier}_hand_off_contract.md` speculatively.
2. **If a hand-off is in scope**, check whether
   `{build_identifier}_hand_off_contract.md` already exists:
   - If it exists (Presentation went first), read it in full. If it
     already contains Integration's half, do not regenerate or overwrite
     it — report that it's already present. If it contains only
     Presentation's half, **append** Integration's half — a `##
     Integration Hand-off Fields` section, the **structured field set**
     (fenced YAML/JSON), not prose: the backend write(s) fired at the
     moment of hand-off and the dashboard/ticketing fields populated for
     the receiving human agent (e.g. ticket id, prior-state summary
     fields, escalation reason code), each grounded in real
     capability/state-field ids. Never touch or overwrite Presentation's
     existing `## Presentation Hand-off Summary` section.
   - If it doesn't exist at all, create it containing only Integration's
     half (the same `## Integration Hand-off Fields` structured section)
     — leaving Presentation's half for Presentation to append later,
     whenever it runs.
3. **Under no circumstance does this skill invoke, self-serve, or
   otherwise trigger the `presentation` skill itself** — not even
   indirectly by "helping it along." Its only footprint on
   `presentation`'s territory is the read-if-present / append-only
   interaction with the shared `hand_off_contract` file described above.
   This is the specific behaviour that keeps the graph's one mutual edge
   from becoming an infinite mutual-recursion loop.

## Procedure

1. **Resolve `build_identifier` and the write path.** Per
   naming-and-artefacts.md sections 1 and 3, the artefact path is
   `{build_identifier}_integration.md` (fixed `doc_identifier`:
   `integration`, per section 2's fixed list). In `standalone` mode,
   confirm the identifier with the user before writing.

2. **Read the existing artefact if present.** If
   `{build_identifier}_integration.md` already exists, read it in full
   instead of regenerating it, and report its existing content back to
   the caller.

3. **Resolve both hard dependencies** per the "Hard dependencies" section
   above, in order (`capability_inventory` then `state_model`). Do not
   proceed to step 4 without a concrete list of real capability ids and a
   resolved state model in hand.

4. **Produce exactly the required artefact contract**, using the
   hybrid-markdown rule (naming-and-artefacts.md section 4):
   - `## Backend Writes` — prose and/or a fenced YAML block describing
     each write this build makes to an external system (e.g. a CRM
     update, a fault-ticket creation call), grounded in the resolved
     capability inventory (which capability triggers the write) and state
     model (which field(s) the write reads from or updates). Every
     mapped id/name must be real, per the "Hard dependencies" section's
     rule above.
   - `## Dashboard / Ticketing Updates` — prose and/or a fenced list
     describing what surfaces to a human operator or ticketing/dashboard
     tool, and under what condition (e.g. a ticket reference posted back,
     a dashboard counter incremented on capability completion).

5. **Resolve the `presentation` mutual-soft/hand-off relationship** per
   the "Soft/mutual dependency" section above — decide in/out of scope,
   then read-and-append or create-fresh as appropriate. Never self-serve
   `presentation`.

6. **Write the integration artefact** to
   `{build_identifier}_integration.md` (repo builds) or the
   caller-specified scratch path (smoke/test runs), and — if a hand-off
   was judged in scope — write or append to
   `{build_identifier}_hand_off_contract.md` per step 5. The integration
   artefact file itself must contain only the two sections defined in
   step 4 (`## Backend Writes` and `## Dashboard / Ticketing Updates`) —
   nothing else. Then, **conversationally, in your response to the
   caller** (not as a section in the artefact file), report the hand-off
   resolution status: whether `capability_inventory` and `state_model`
   were each read as-found or self-served; whether a hand-off was judged
   in/out of scope and, if in scope, whether Integration's half was newly
   created or appended onto an existing Presentation-authored file; and
   explicit confirmation that `presentation` itself was never invoked or
   self-served. Do not add this as a section in the integration artefact
   file — report it in your response to the caller instead.

## Tools

`Read`, `Write`, plus the ability to invoke the `capability-inventory` and
`state-model` skills (self-serve on hard dependencies only, in that
order). This skill never invokes the `presentation` skill, and never
invokes MCP/Cognigy tools directly — any grounding against a live
environment is the responsibility of the capability inventory it
consumes.
