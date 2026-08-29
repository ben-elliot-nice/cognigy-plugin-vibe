# Structural floor

This file is the single source of truth for the structural floor: the
mechanical, LLM-executed, always-runs referential-integrity checklist that
the (deferred) orchestrator runs at every layer boundary and after every
resume-and-revise. Every skill and agent in this plugin references this
checklist by name — no skill, agent, or other doc restates or forks it. If
the checklist changes, it changes here only, and every consumer picks up the
change by reference.

The structural floor is **not** a judgment-call review. It does not ask
whether a routing decision is *good*, whether a behavioural policy is *well
written*, or whether a hand-off summary is *clear*. Every check below is a
reference-only lookup against the fenced YAML/JSON blocks of already-produced
artefacts: does the identifier on one side of a link resolve to a real entry
on the other side. Nothing here requires interpretation, so nothing here is
gated on model confidence or skipped as "probably fine" — it always runs,
and it runs identically every time.

## The five checks

1. Every `routing` destination resolves to a real `capability_inventory` item
   `id`.
2. Every `behavioural_policy` escalation trigger has a matching `routing`
   destination.
3. Every hand-off reference resolves to an entry in
   `{bid}_hand_off_contract.md`.
4. Every `state_model` field's readers/writers name a real capability or
   domain.
5. Every `enforcement` guard references a `capability_inventory` item whose
   `staging_confirmation` flag is set.

Each check is a straight lookup: take the identifier named on the referencing
side, and confirm it appears verbatim as a real entry on the referenced
side's fenced block. A miss on any check is a structural break — a rename or
drop somewhere upstream that the referencing artefact hasn't caught up
with — and is reported as a finding, not silently ignored or downgraded to
advisory.

## Operational rules

- **Re-run trigger:** the floor runs at every layer boundary **and
  immediately after every resume-and-revise**. A revision made under
  corrective pressure is exactly the moment a rename or drop is most likely
  to break a reference elsewhere in the graph — gating the floor to layer
  boundaries alone would leave a final-layer revision unchecked, since there
  is no boundary after the last layer to catch it.

- **Mutual-edge rule:** a revision touching `hand_off_contract` re-examines
  **both** halves — Presentation's NL summary and Integration's structured
  fields — not only the half owned by whichever finding triggered the
  revision. This is necessary because a semantic change that keeps
  identifiers stable would otherwise slip past an identifier-only floor: the
  five checks above resolve references by name, so a same-name edit that
  changes meaning on one side without updating the other side to match is
  invisible to the checks unless both halves are re-examined together.
