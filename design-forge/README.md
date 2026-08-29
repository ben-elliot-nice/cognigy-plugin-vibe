# design-forge

Modular design-artefact authoring for Cognigy AI agents — one skill + one
agent per design domain, wired together by a single canonical dependency
graph instead of one monolithic design skill.

This plugin replaces the retired `plugin/skills/design-agent*` skill space
(persona / jobs / interfaces / contracts) with nine independently-invokable
domains, each producing exactly one well-scoped markdown artefact. See
`reference/dependency-graph.md`, `reference/naming-and-artefacts.md`, and
`reference/structural-floor.md` for the conventions every skill and agent in
this plugin references rather than restates.

## The pipeline

```
Roots (parallel-licensed, no edge between them):
  identity-agent              <- brand_research (voice/tone, shared)
  capability-inventory-agent  <- (nothing — the spine)

Layer 2:
  behavioural-policy-agent    <- channel_choice (input) ; soft: identity, state_model (forward edge)
  routing-agent                <- hard: capability_inventory ; soft: behavioural_policy

Layer 3:
  state-model-agent            <- hard: capability_inventory, routing

Layer 4 (sequential pair — never parallel):
  presentation-agent            <- hard: capability_inventory, state_model ; soft: integration, brand_research (visual)
  integration-agent             <- hard: capability_inventory, state_model ; soft: presentation

Cross-cutting, conditional:
  enforcement-agent             <- hard: capability_inventory, state_model ; soft: routing

Peer, not a pipeline stage:
  review-agent                  — read-only consistency check, no artefact
```

Every artefact this plugin writes follows `{build_identifier}_{doc_identifier}.md`
(`naming-and-artefacts.md` section 1) — e.g. `acme_support_bot_identity.md`.

## Invoking a single stage vs. a full build

There is currently no `design-forge:orchestrator` skill — the architecture
spec (see `docs/superpowers/specs/2026-07-16-design-forge-architecture-design.md`
in the source design history) treats the orchestrator as a distinct,
not-yet-built piece of work, and this repo's own
`migration-docs/ben-diff-notes.md` describes the same idea from the other
direction: *"you have a modular build/scope/spec pipeline — if I only need
something in a high level/layer I don't waste tokens ingesting irrelevant
stages."* Every domain agent already honours that idea on its own, with no
orchestrator required:

- **Standalone-first is the invariant contract.** Every domain agent is
  fully runnable with zero upstream artefacts present. If a **hard**
  dependency artefact is missing, the agent self-serves it — it invokes the
  upstream domain's own skill/agent directly (never re-implements that
  domain's reasoning inline), which may itself recurse further up the graph.
  A **soft** dependency is read if present and simply omitted if absent —
  never a trigger for recursion.
- **Ask for exactly one stage, get exactly that stage's dependency chain.**
  Dispatch `state-model-agent` on its own and it pulls in
  `capability-inventory-agent` and `routing-agent` automatically (in that
  order) if their artefacts don't already exist — you never manually
  pre-run the whole upstream chain by hand. Dispatch `identity-agent` alone
  for just a persona, and nothing downstream (routing, state model,
  enforcement, …) runs at all, because nothing hard-depends on Identity.
- **A "full build"** is simply dispatching the domains with no other
  consumer — typically `enforcement-agent`, `presentation-agent`, and
  `integration-agent` (the three domains nothing else in this plugin
  hard-depends on) — and letting self-serve recursion pull in everything
  upstream of them. `presentation-agent` and `integration-agent` are the one
  same-layer pair that must run sequentially rather than in parallel
  (`naming-and-artefacts.md` section 8), because whichever runs second needs
  to read-and-append onto the `hand_off_contract` shared artefact the first
  one wrote.
- **`mode` is always explicit.** Every domain skill/agent takes a `mode` of
  `standalone` or `orchestrated`, passed by whoever invokes it — never
  inferred from whether other artefacts happen to exist on disk. Invoking a
  domain agent directly (today's only path) is `standalone` mode: it
  suggests a cwd-derived `build_identifier` default and asks you to confirm
  it, and it gathers narrowly — only the inputs and dependencies needed for
  the one artefact it's producing.
- **Review is optional, opt-in, and separate from the pipeline.**
  `review-agent` is a peer, not a stage — dispatch it after a layer boundary
  (or whenever you want a second pass across the artefacts already on disk)
  to catch judgment-call contradictions the structural floor's mechanical
  reference checks can't. It never writes anything.

### Worked example

"I need a persona for a new support bot" → dispatch `identity-agent` only.
It self-serves nothing (root domain), asks for or reads the brand-research
voice/tone slice, and writes `{bid}_identity.md`. Nothing else runs.

"I need the tool/parameter design for what this agent can do" → dispatch
`capability-inventory-agent` only. Root domain, no self-serve, writes
`{bid}_capability_inventory.md`.

"I need the full compliance-enforcement layer" → dispatch
`enforcement-agent`. It self-serves `capability-inventory-agent`, which
self-serves nothing further, and `state-model-agent`, which in turn
self-serves `routing-agent` (and, transitively, `capability_inventory` again
— found already on disk from the first hop, so it's read, not regenerated).
One dispatch, four artefacts, in dependency order, with no orchestrator
involved.

## What moved from the old design-agent* skills

The retired `design-agent-persona` / `-jobs` / `-interfaces` / `-contracts`
skills held real Cognigy-specific design reasoning that design-forge doesn't
throw away — it re-homes it into the matching domain agent's notes, since
the domain skills themselves are deliberately abstract/artefact-shaped:

| Old skill | Concrete content | New home |
|---|---|---|
| `design-agent-persona` | name/tone/brand-voice grounding | `identity-agent` |
| `design-agent-persona` | LOCALISATION block, channel formatting, silent execution, auth persistence, universal Always/Never | `behavioural-policy-agent` |
| `design-agent-jobs` | tool/capability questions, irreversibility + staging | `capability-inventory-agent` |
| `design-agent-jobs` | routing intent map, concierge/specialist pattern | `routing-agent` |
| `design-agent-jobs` | context schema, `shortTermMemory`/`toolResponse` pattern | `state-model-agent` |
| `design-agent-interfaces` | xApp scenes, bidirectional webchat events | `presentation-agent` |
| `design-agent-interfaces` | handover package — ACD/routing fields | `integration-agent` |
| `design-agent-interfaces` | handover package — Agent Assist NL summary | `presentation-agent` (its half of `hand_off_contract`) |
| `design-agent-contracts` | guard sub-flow pattern, `Resolve Tool Action` wiring, obligation catalogue, structured refusal shape | `enforcement-agent` |

See each agent file for the specific migration notes and any judgment calls
made when a piece of old content didn't map 1:1 onto the new domain split
(most notably: identity vs. behavioural-policy, and the two Presentation/
Integration halves of the hand-off contract).
