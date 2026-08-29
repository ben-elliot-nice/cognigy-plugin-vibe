---
name: capability-inventory
description: Enumerate the discrete capabilities a Cognigy AI agent can perform — trigger, data in/out, reversibility, staging flag, and per-item success + failure cases. The spine of the design graph.
---

# Capability Inventory (root domain / the spine)

## When to use this

Use this skill to enumerate the discrete capabilities a Cognigy AI agent can
perform — each capability's trigger condition, data in/out, reversibility,
staging-confirmation flag, and its per-item success and failure-edge cases.
Per `design-forge/reference/dependency-graph.md`, `capability_inventory` is a
**root domain** (no hard deps, no soft deps) and is the **spine of the whole
graph**: it is the only domain every other layer (routing, state model,
presentation, integration, enforcement) hard-depends on directly. Nothing
downstream can self-serve without this artefact already being resolved.
Because Identity and Capability Inventory are the graph's only two roots
with no edge between them, the two carry a standing license for parallel
dispatch (naming-and-artefacts.md section 8).

Do not restate the dependency graph's notes here beyond what's needed to
justify this skill's behaviour — see that file for the full graph and its
structural implications.

## Inputs

- `build_identifier` — resolved and confirmed per
  `design-forge/reference/naming-and-artefacts.md` sections 1 and 3. In
  `standalone` mode, suggest a cwd-derived default and require the user to
  confirm it before writing anything. When self-served or dispatched by an
  orchestrator, accept the value exactly as passed down.
- `mode` — `standalone` or `orchestrated`, always passed explicitly by the
  caller per naming-and-artefacts.md section 7. If not supplied, treat as
  missing required input and ask rather than guessing.
- **Use-case list** — a thin narrative slice: one line per discrete thing
  the agent should be able to do (e.g. "check outage status for the
  caller's address"; "raise a fault ticket and return a reference number").
  This is the primary input this skill converts into capability items. In
  `standalone` mode, ask for it if not already supplied — do not invent
  use cases. In `orchestrated` mode, rely on the orchestrator-supplied
  context.

## Procedure

1. **Resolve `build_identifier` and the write path.** Per
   naming-and-artefacts.md sections 1 and 3, the artefact path is
   `{build_identifier}_capability_inventory.md` (fixed `doc_identifier`:
   `capability_inventory`, per section 2's fixed list). In `standalone`
   mode, confirm the identifier with the user before writing.

2. **Read the existing artefact if present.** If
   `{build_identifier}_capability_inventory.md` already exists, read it in
   full instead of regenerating it, and report its existing content back to
   the caller. Because this domain has no hard or soft deps, there is no
   further upstream artefact to check or self-serve.

3. **Gather the use-case list** if not already supplied (ask in
   `standalone` mode; rely on orchestrator-supplied context in
   `orchestrated` mode). Each use case becomes (at minimum) one capability
   item — do not collapse two distinct use cases into a single item, and do
   not invent use cases beyond what was supplied.

4. **Decide, per use case, whether it models a genuinely pre-existing
   capability or shared infra** (e.g. this run is iterating on an existing
   Cognigy agent, or the capability must line up with a live flow/tool
   that already exists in the target environment). Only in that specific
   situation may this skill use its MCP/Cognigy tools (e.g. inspecting an
   existing agent's flows or tool definitions) to ground the item's
   `trigger_condition`, `data_in`, or `data_out` in what is actually
   deployed. For a net-new/greenfield capability being designed from
   scratch, do not invoke any MCP/Cognigy tool — derive the item entirely
   from the use-case narrative and standard judgment. See the Tools section
   below; this exceptional-use rule is the load-bearing constraint on this
   skill's tool access.

5. **Produce exactly the required artefact contract**, using the
   hybrid-markdown rule (naming-and-artefacts.md section 4):
   - A fenced YAML block with a top-level `capabilities:` list. Each list
     item is an object with **exactly eight** required keys:
     - `id` — a short snake_case identifier unique within this artefact.
     - `trigger_condition` — what the caller says/does that surfaces this
       capability.
     - `data_in` — what information the capability needs before it can run.
     - `data_out` — what information/result the capability returns.
     - `reversibility` — whether the capability's effect can be undone
       (e.g. `reversible`, `irreversible`, or a short qualifier of what
       reversal requires).
     - `staging_confirmation` — a **real boolean** (`true`/`false`), never a
       string. This is the flag Enforcement Tier-1 reads to decide whether
       the capability requires an explicit user confirmation step before
       it is enacted (e.g. `true` for anything irreversible or
       consequential; `false` for a pure read/lookup).
     - `success_case` — a short prose description of what a successful
       execution looks like.
     - `failure_edge_case` — a short prose description of at least one
       realistic failure or edge case and how it should be surfaced.
   - Do not add extra keys beyond these eight, and do not omit any of them
     — downstream domains (routing, state model, enforcement) parse this
     list mechanically and depend on the fixed key set.
   - Where a judgment call needs explaining (e.g. why a given capability was
     marked irreversible, or why staging confirmation was or wasn't set),
     add a short prose note near the YAML block rather than folding
     rationale into a YAML comment.

6. **Write the file** to `{build_identifier}_capability_inventory.md` (repo
   builds) or the caller-specified scratch path (smoke/test runs), then
   report back to the caller: the number of capability items produced,
   whether any item was grounded via an MCP/Cognigy tool lookup against a
   pre-existing agent (and why), and confirmation that every item carries
   all eight required keys with `staging_confirmation` as a real boolean.

## Tools

`Read`, `Write`, plus MCP/Cognigy tools (e.g. `list_resources`,
`get_resource`, and `manage_flow_nodes` for inspecting an existing agent's
flow/tool configuration against a live Cognigy environment) — **granted but
exceptional-use only**. These MCP/Cognigy tools are used **only** when this
invocation is modelling a genuine pre-existing capability or shared infra
(e.g. iterating on an existing agent, or a capability that must match a
flow/tool already deployed) — **never by default**. For an ordinary
greenfield capability inventory, this skill runs on `Read`/`Write` alone,
deriving every item from the supplied use-case list.
