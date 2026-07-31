---
name: brand-research
description: Produce or incrementally extend the shared brand-research artefact (voice/tone, compliance/locale, visual identity) for a Cognigy agent design. Triggered by the first consumer that needs a slice; appends missing slices rather than re-researching.
---

# Brand Research (shared producer)

## When to use this

Use this skill whenever a consuming domain skill (today: Identity or
Presentation) needs a brand-research slice and the shared artefact either
does not yet exist, or exists but is missing the specific slice that
consumer needs. Per `design-forge/reference/dependency-graph.md`,
`brand_research` is not a domain and does not appear as an edge in the
domain graph — it is one of the two `shared_artefacts` (the other being
`hand_off_contract`), resolved by **first-consumer-triggers-production**
rather than by hard/soft dependency. This skill has no hard deps and no
soft deps of its own (upstream-most): it does not read any other domain
artefact before running.

Do not restate the dependency graph's notes here beyond what's needed to
justify this skill's behaviour — see that file for the full graph and its
structural implications.

## Inputs

- `build_identifier` — resolved and confirmed per
  `design-forge/reference/naming-and-artefacts.md` section 3. In
  `standalone` mode, suggest a cwd-derived default and require the user to
  confirm it before writing anything. When self-served by a consumer (e.g.
  Identity or Presentation resolving a hard/soft dependency chain), accept
  the `build_identifier` exactly as passed down — never re-derive or
  re-confirm it at this level.
- `mode` — `standalone` or `orchestrated`, always passed explicitly by the
  caller per naming-and-artefacts.md section 7. If not supplied, treat as
  missing required input and ask rather than guessing.
- `requested_slice` — one of `voice_tone`, `compliance_locale`,
  `visual_identity`. Identifies which section this invocation is
  responsible for producing.
- `brand_source` (optional) — a URL, brand doc, or free-text description
  (e.g. a short brand-voice statement) to research from. If given a URL and
  `WebFetch`/`WebSearch` access, use it. If no source is available, work
  from whatever free-text input the caller supplied and do not fabricate
  specifics (e.g. never invent hex codes or imagery descriptions with no
  basis in the input).

## Procedure

1. **Resolve `build_identifier` and the write path.** Per
   `design-forge/reference/naming-and-artefacts.md` sections 1 and 3, the
   artefact path is `{build_identifier}_brand_research.md` (the fixed
   `doc_identifier` for this skill is `brand_research`, per section 2's
   fixed list). In `standalone` mode, confirm the identifier with the user
   before writing.

2. **Read the existing artefact if present.** If
   `{build_identifier}_brand_research.md` already exists, read it in full
   first. Per the shared-artefact append pattern (naming-and-artefacts.md
   section 6):
   - If the section for `requested_slice` already exists in the file, do
     not regenerate or overwrite it — report to the caller that the slice
     is already present and return the existing content.
   - If the section is missing, append only that new section to the
     existing file. Never rewrite or touch sections owned by a prior
     consumer.
   - If the file does not exist at all, create it containing only the
     requested slice's section.

3. **Produce exactly the requested slice**, using the hybrid-markdown rule
   (naming-and-artefacts.md section 4 — prose for judgment calls, fenced
   YAML for structural/tabular data):
   - `requested_slice: voice_tone` → write a `## Voice & Tone` section in
     prose, describing tone, register, and any phrases/words to use or
     avoid, grounded in `brand_source`.
   - `requested_slice: compliance_locale` → write a `## Compliance /
     Locale` section (prose or bullets) covering locale conventions
     (spelling, units, disclaimers) and any compliance framing implied by
     the brand source.
   - `requested_slice: visual_identity` → write a `## Visual Identity`
     section as a fenced YAML block with `colors` (hex values), `imagery`,
     and `styling` keys.
   - Do not produce any section beyond the one requested in this
     invocation — a later consumer requesting a different slice will
     append it in a separate invocation, per the append pattern.
   - Never fabricate data for a slice not requested or not supported by
     the input (e.g. do not invent `## Visual Identity` hex codes when the
     brand source only described tone).

4. **Write the file** to `{build_identifier}_brand_research.md` (repo
   builds) or the caller-specified scratch path (smoke/test runs), then
   report back to the caller which section was added or which section
   already existed.

## Tools

`Read`, `Write`, `WebFetch`, `WebSearch`.
