# Domain dependency graph

This file is the single source of truth for the design-forge domain dependency
graph. Every skill and agent in this plugin references this graph by name — no
skill, agent, or other doc restates or forks it. If the graph changes, it
changes here only, and every consumer picks up the change by reference.

## The graph

```yaml
domains:
  identity:              { layer: root,  hard_deps: [],                                  soft_deps: [] }
  capability_inventory:  { layer: root,  hard_deps: [],                                  soft_deps: [] }
  behavioural_policy:    { layer: 2,     hard_deps: [],  soft_deps: [identity, state_model] }   # hard on channel_choice (an input, not a domain); state_model soft-dep is a deliberate FORWARD edge (L2->L3) — see notes
  routing:               { layer: 2,     hard_deps: [capability_inventory],             soft_deps: [behavioural_policy] }
  state_model:           { layer: 3,     hard_deps: [capability_inventory, routing],    soft_deps: [] }
  presentation:          { layer: 4,     hard_deps: [capability_inventory, state_model], soft_deps: [integration] }   # + shared brand_research (visual)
  integration:           { layer: 4,     hard_deps: [capability_inventory, state_model], soft_deps: [presentation] }
  enforcement:           { layer: cross, hard_deps: [capability_inventory, state_model], soft_deps: [routing], conditional: true }
shared_artefacts: [brand_research, hand_off_contract, interview_scoping]  # broader "non-domain artefact" set — NOT the same as naming-and-artefacts.md section 6's narrower append-pattern category (see notes)
notes:
  - "shared_artefacts above is the broader non-domain-artefact list, not the append-pattern category. Only brand_research and hand_off_contract follow the shared-artefact append pattern described in naming-and-artefacts.md section 6 (first-consumer-produces, later consumers read-and-append). interview_scoping is a produce-once input artefact — an ordinary fixed doc_identifier read by consumers, not incrementally appended to by multiple domains."
  - "channel_choice and use_case_list are INPUTS (interview thin-slices), not domains — never self-served, asked from the user."
  - "brand_research is a shared upstream artefact (first-consumer-triggers), NOT a domain soft-dep."
  - "presentation<->integration is the ONE mutual edge; it is SOFT precisely so neither self-serves the other (termination)."
  - "self-serve recursion follows hard_deps ONLY."
  - "behavioural_policy's soft_dep on state_model is a deliberate FORWARD soft edge (layer 2 -> layer 3), the only soft edge in the graph that points to a LATER layer rather than an earlier/same one. It is inert during an orchestrated top-down pass (state_model doesn't exist yet when behavioural_policy runs first) and only becomes active in standalone/re-run scenarios where state_model already exists on disk — at which point behavioural_policy uses it opportunistically (use-if-present) to scope which data types it references, exactly as it does with its identity soft-dep. Not a DAG-validity concern: the hard-edge DAG check (Task 4 script) only walks hard_deps, so a forward soft edge cannot create a hard-edge cycle."
```

## Key structural implications

Capability Inventory is the spine of the graph: it is one of the two root
domains and the only domain every other layer (routing, state model,
presentation, integration, enforcement) hard-depends on directly. Nothing
downstream can self-serve without it already being resolved.

Identity sits at the opposite end — a near-leaf. It is a root domain in its
own right (no hard deps), but nothing else hard-depends on it; only
Behavioural Policy takes it as a soft dependency. Identity work can be done
in isolation without blocking or being blocked by the rest of the graph.

Because Identity and Capability Inventory are both roots with no hard deps
between them, the two may be run in parallel — there is no ordering
requirement forcing one before the other.

Enforcement and the Channel I/O contract (folded into Integration/Presentation
here) are conditional and scoped rather than universal: Enforcement only
activates when the demo's obligations call for it, and cross-cuts the graph
(`layer: cross`) rather than sitting in the root-to-leaf hard-dependency chain
that the rest of the domains follow.

The one mutual edge in the graph is Presentation <-> Integration, and it is
deliberately a soft dependency in both directions. Self-serve recursion
follows hard_deps only, so keeping this edge soft is what prevents an
infinite mutual self-serve loop between the two domains — this is the
graph's termination guarantee at its only cycle-shaped edge.
