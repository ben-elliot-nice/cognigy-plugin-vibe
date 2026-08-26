---
name: identity
description: Design a Cognigy AI agent's identity — name, tone dials, and the persona description/instructions fields — traceable to brand source material. A root domain.
---

# Identity (root domain)

## When to use this

Use this skill to define a Cognigy AI agent's identity: its name, its
conciseness/formality tone dials, and the prose `## Description` /
`## Instructions` fields that map 1:1 to the Cognigy persona field set. Per
`design-forge/reference/dependency-graph.md`, `identity` is a **root
domain** — it has no hard deps and no soft deps on any other domain. It is a
near-leaf: nothing hard-depends on it, and only Behavioural Policy takes it
as a soft dependency downstream. Identity work can be done in isolation,
and — because Identity and Capability Inventory are the graph's only two
roots with no edge between them — the two carry a standing license for
parallel dispatch.

Identity is not, however, fully input-free: it is a **soft/shared consumer**
of the `brand_research` shared artefact's voice/tone slice. Per
`design-forge/reference/naming-and-artefacts.md` section 6, `brand_research`
is one of the two shared artefacts (the other being `hand_off_contract`) —
it lives outside the domain-to-domain graph and is resolved by
**first-consumer-triggers-production**, not by hard-dep self-serve
recursion. Concretely: if the `## Voice & Tone` section of
`{build_identifier}_brand_research.md` is missing (or the file doesn't
exist), invoke `brand-research` with `requested_slice: voice_tone`,
propagating the same `build_identifier` and `mode` this skill was given, to
produce or extend that shared file. If the section already exists, read it
rather than re-triggering production. Do not treat this as a hard-dep
self-serve chain — it is the third-category shared-artefact trigger, not an
edge in the dependency graph.

## Inputs

- `build_identifier` — resolved and confirmed per
  `design-forge/reference/naming-and-artefacts.md` sections 1 and 3. In
  `standalone` mode, suggest a cwd-derived default and require the user to
  confirm it before writing anything. When self-served or dispatched by an
  orchestrator, accept the value exactly as passed down.
- `mode` — `standalone` or `orchestrated`, always passed explicitly by the
  caller per naming-and-artefacts.md section 7. If not supplied, treat as
  missing required input and ask rather than guessing.
- One-line purpose — a single sentence describing what the agent is for
  (e.g. "A support assistant for a fictional broadband ISP that can check
  outage status and raise a fault ticket."). In `standalone` mode, ask for
  this if not already supplied; do not invent it.
- `brand_source` (optional) — passed through to `brand-research` if that
  skill needs to be triggered (see above). If no brand source is available
  and the shared artefact doesn't exist yet, ask the user for a short brand
  voice statement rather than fabricating tone.

## Procedure

1. **Resolve `build_identifier` and the write path.** Per
   naming-and-artefacts.md sections 1 and 3, the artefact path is
   `{build_identifier}_identity.md` (fixed `doc_identifier`: `identity`, per
   section 2's fixed list). In `standalone` mode, confirm the identifier
   with the user before writing.

2. **Read the existing artefact if present.** If
   `{build_identifier}_identity.md` already exists, read it in full instead
   of regenerating it, and report its existing content back to the caller.

3. **Resolve the voice/tone shared artefact.** Check for
   `{build_identifier}_brand_research.md`:
   - If it exists and already contains a `## Voice & Tone` section, read
     that section and use it to ground the tone dials and prose below.
   - If it doesn't exist, or exists without that section, invoke
     `brand-research` with `requested_slice: voice_tone`, the same
     `build_identifier`, and the same `mode`, passing through any
     `brand_source` given. This is the shared-artefact trigger described
     above — not hard-dep recursion.

4. **Gather the one-line purpose** if not already supplied (ask in
   `standalone` mode; rely on orchestrator-supplied context in
   `orchestrated` mode).

5. **Produce exactly the required artefact contract**, using the
   hybrid-markdown rule (naming-and-artefacts.md section 4):
   - A fenced YAML block with:
     - `name` (string) — the agent's chosen name.
     - `conciseness` (`-1|0|+1`) — terse to expansive.
     - `formality` (`-1|0|+1`) — casual to formal.
     Dial values must be grounded in the voice/tone slice from step 3 and
     the one-line purpose from step 4 — do not default to `0` without
     reasoning from the input.
   - A `## Description` prose section — **hard-capped at 1000 characters**.
     Enforce this by counting the section body's character length before
     writing; if a draft exceeds 1000 characters, tighten it until it does
     not. Note the cap in the artefact itself (e.g. a trailing
     parenthetical) so downstream readers know it's a deliberate ceiling,
     not an accidental truncation.
   - A `## Instructions` prose section — **hard-capped at 1000 characters**,
     enforced and noted the same way as `## Description`.
   - Both prose sections and the dials map 1:1 to the Cognigy persona field
     set (`name`, tone dials, `description`, `instructions`).

6. **Write the file** to `{build_identifier}_identity.md` (repo builds) or
   the caller-specified scratch path (smoke/test runs), then report back to
   the caller: the resolved dial values, whether `brand-research` was
   triggered or an existing voice/tone slice was reused, and confirmation
   that both prose sections are within the 1000-character cap.

## Tools

`Read`, `Write` (plus the ability to invoke `brand-research` when the
voice/tone slice needs producing).
