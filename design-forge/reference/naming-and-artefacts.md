# Naming & shared-artefact conventions

This file is the single source of truth for filenames, the fixed
`doc_identifier` list, the `build_identifier` resolution rule, the
hybrid-markdown rule, the self-serve rule, the shared-artefact append
pattern, the `mode` parameter, and the hand-off ordering note. Every skill in
this plugin references these conventions by name — no skill restates or
forks them. If a convention changes, it changes here only, and every
consumer picks up the change by reference. Tasks 7-15 (the domain skills)
all cite this file.

## 1. Filename schema

Every artefact this plugin writes follows one schema:

```
{build_identifier}_{doc_identifier}.md
```

Both `build_identifier` and `doc_identifier` are snake_case, and the joined
filename is snake_case throughout — no camelCase, no spaces, no hyphens.

Example: `acme_support_bot_identity.md`

## 2. `doc_identifier` fixed list

There are exactly 11 valid `doc_identifier` values. This list is fixed —
skills do not invent new identifiers, and every artefact a skill produces
uses one of these values verbatim:

- `identity`
- `behavioural_policy`
- `capability_inventory`
- `routing`
- `state_model`
- `presentation`
- `integration`
- `enforcement`
- `brand_research`
- `hand_off_contract`
- `interview_scoping`

## 3. `build_identifier` resolution rule

`build_identifier` is resolved **once**, at the top of a run — either given
explicitly by the caller or confirmed with the user — and then propagated
unchanged into every recursive self-serve invocation triggered by hard
dependencies. It is never re-derived, re-guessed, or re-confirmed at a
deeper recursion level: the value a domain skill receives when it self-serves
a hard dependency is exactly the value resolved at the top of the run, with
no per-level substitution.

In `standalone` mode (see section 7), a skill invoked directly (not via the
orchestrator) suggests a cwd-derived default for `build_identifier` and
requires the user to confirm it before proceeding — it does not silently
assume the default is correct.

## 4. Hybrid-markdown rule

Artefacts are hybrid markdown: prose where judgment calls need explaining
(rationale, trade-offs, caveats), and fenced YAML or JSON blocks where the
content is tabular or structural (lists, schemas, key-value data intended for
another skill or the deferred orchestrator to parse). Neither register
replaces the other — a domain skill should not force a judgment call into a
YAML comment, and it should not prose-describe a table that a downstream
consumer needs to parse mechanically.

## 5. Self-serve rule

A domain skill self-serves — recursively invokes another domain skill — only
for **hard** dependencies that are missing. Soft dependencies are
use-if-present: if the artefact already exists, read it and factor it in; if
it doesn't, proceed without triggering its production. An artefact that
already exists on disk is always read, never regenerated, regardless of
whether the dependency is hard or soft.

**Termination argument:** the domain graph (see `dependency-graph.md`) is a
DAG on hard edges only. Because self-serve recursion follows hard_deps
exclusively, and hard_deps form a DAG (no cycles), recursive self-serve is
guaranteed to terminate — there is no path back to a domain already in
progress. The one edge in the graph that is mutual (Presentation <->
Integration) is deliberately soft in both directions specifically so it
cannot be walked by self-serve recursion; a hard edge there would create a
cycle and break termination.

## 6. Shared-artefact append pattern

`brand_research` and `hand_off_contract` are shared artefacts: unlike a
domain's own output, they are not owned end-to-end by a single skill.
Instead they are persisted and incrementally appended to by whichever skills
touch them over the course of a run:

- The **first** skill that needs the artefact and finds it absent produces
  it — writing only the slice it needs.
- Ownership at that point belongs to whoever touched it first, until the
  **next** consumer needs it.
- A **second** (or later) consumer reads the existing artefact and appends
  only its own additional slice. It never re-produces or overwrites the
  slice a prior consumer already wrote.

This append discipline is what lets multiple domain skills share one
artefact file safely without clobbering each other's contribution.

**Brand Research is a third category, not a domain soft-dep.** It is not
listed as a `soft_dep` on any domain in the dependency graph — it is a shared
upstream artefact, resolved by first-consumer-triggers-production and then
read by everyone downstream. This resolves the apparent tension between
`brand_research` being needed by both Presentation and Integration and it
not appearing as an edge in the domain graph: it lives outside the
domain-to-domain dependency graph entirely, in the same shared-artefact
category as `hand_off_contract` — the only two artefacts in this category.
`interview_scoping` is not part of this category: it is an ordinary fixed
`doc_identifier` (an input-gathering artefact, produced once and read, not
incrementally appended to by multiple domains).

## 7. `mode` parameter

Every domain skill accepts a `mode` parameter with two values:

- `standalone` — the skill was invoked directly, outside an orchestrated
  run. It gathers narrowly: only the inputs and dependencies needed for the
  one module it's producing, one module at a time.
- `orchestrated` — the skill was invoked by the deferred orchestrator as
  part of a broader run. The orchestrator has already done broad upfront
  gathering, so the skill can rely on that context rather than re-asking.

`mode` is always passed explicitly by the caller — a domain skill never
infers it from context (e.g. from whether other artefacts happen to exist
on disk). If `mode` is not supplied, the skill should treat this as missing
required input rather than guessing.

## 8. Hand-off ordering note

Presentation and Integration are the one pair of domains sharing a layer
(layer 4) that must be dispatched **sequentially**, never in parallel — this
follows directly from their mutual soft edge and their shared use of
`hand_off_contract`: whichever runs second needs to read-and-append onto
what the first one wrote, which is only safe if the first has already
completed. The two root domains (Identity, Capability Inventory) are the
only pair in the graph with a standing license for parallel dispatch, since
neither hard- or soft-depends on the other.

This ordering is enforced by the deferred orchestrator, not by the domain
skills themselves — it is recorded here so each skill is aware of the
constraint it operates under, even though enacting the constraint is the
orchestrator's responsibility.
