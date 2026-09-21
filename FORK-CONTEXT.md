# Fork Context — DO NOT INCLUDE IN UPSTREAM PRs

This file tracks state, decisions, and gotchas specific to running this repo as
**our team's fork** (`ben-elliot-nice/cognigy-plugin-vibe`) of the official
Cognigy Claude Code plugin (`Cognigy/cognigy-plugin`). It exists at the repo
root, outside `docs/` (upstream's own docs tree), specifically so it's obvious
to leave out of any branch or PR intended for upstream. When preparing an
upstream contribution, never include changes to this file.

## Background

- Directed to stop maintaining our own standalone plugin
  (`ben-elliot-nice/cognigy-vibe`) and merge into the official one via this
  fork + upstream PRs.
- Intention: run the fork mostly independently for our own team, contribute
  back upstream only what's genuinely useful to everyone (not ANZ/sales
  specific).
- Team moved from a sales-facing function to an engineering one. Old
  sales-lens content (skills, the `explain` lookup tool) from the original
  plugin doesn't fit engineering work and is being sorted/retired (see
  Tracker board below).

## Remotes

- `origin` — `git@github.com:ben-elliot-nice/cognigy-plugin-vibe.git` (this fork)
- `upstream` — `git@github.com:Cognigy/cognigy-plugin.git`

Repo also has significant pre-existing local/origin branch clutter (many
`worktree-agent-*`, `covfix-*`, `feat/*` mirroring upstream names, etc.) —
left untouched/uninvestigated per Ben's explicit direction (2026-09-21). Don't
assume these represent live work without checking with Ben first.

## Local dev loop (`npm run plugin:dev`)

- `npm ci && npm run build` verified working.
- `npm run plugin:dev` generates `.dev-plugin/` (gitignored) and registers a
  `cognigy-dev` marketplace (directory source, absolute path to this repo) —
  runs `src/**` live via `tsx`, no build needed to iterate.
- **Plugin enablement must be per-project, never in user-space
  `~/.claude/settings.json`.** Enable via the target repo's
  `.claude/settings.local.json` (gitignored, personal):
  ```json
  { "enabledPlugins": { "cognigy@cognigy-dev": true } }
  ```
  This lets the same local dev build run against any other project directory
  by adding the same entry there — no need to re-run `plugin:dev` per project.

## Credential wiring gotcha (discovered 2026-09-21)

- After enabling `cognigy@cognigy-dev` and reloading, the `platform` MCP
  server initially refused to spawn: _"Plugin option 'cognigy_api_key' isn't
  set. Open /plugin manage to configure it..."_ — this is Claude Code's own
  pre-spawn gate on required `userConfig` fields, not an error from our
  engine code.
- Fix that worked: `/plugin configure cognigy@cognigy-dev` (not `/plugin
manage` alone — that didn't visibly do anything for us) to set
  `cognigy_api_base_url` + `cognigy_api_key`, then `/reload-plugins`. The
  server then showed as "still connecting" for a bit before fully attaching
  — worth waiting/retrying `ToolSearch`/`/reload-plugins` rather than assuming
  failure immediately.
- Independently, `~/.cognigy-plugin/config.json` (`COGNIGY_API_BASE_URL` /
  `COGNIGY_API_KEY` keys) is the documented fallback `loadConfig()` reads
  when env vars are absent — see `src/userConfigFile.ts` and the
  `add-client-platform` skill's credentials rule. We wrote this as a
  parallel safety net; unclear if it was actually load-bearing here or if
  `/plugin configure` alone did it. Worth clarifying next time this comes up.
- **Incident:** a real Cognigy API key was pasted into a chat transcript
  during this troubleshooting (the `!` shell-escape prefix does NOT keep
  command output/arguments out of the assistant's context — only use it for
  commands, never for ones containing secrets as literal arguments).
  Recommended rotating that key in Cognigy.AI → User Menu → My Profile → API
  Keys.
- Confirmed working end-to-end: `list_resources { resourceType: 'project' }`
  returned real data (65 projects) from a live Cognigy instance
  (`cognigy-api-au1.nicecxone.com`).

## Tracker board (replaces GitHub Issues, which the org restricts on this fork)

- **[Cognigy Plugin Fork Tracker](https://github.com/users/ben-elliot-nice/projects/3)**
  — GitHub Projects v2, created under Ben's personal account (`@me`), not the
  org, so it isn't subject to the org's Issues-on-forks restriction.
- `Track` field: `Fork-only` / `Upstream candidate` / `Triage`. Group/filter
  the board view by this field.
- Scaffolded via `scaffold-fork-tracker.sh` (saved to `~/scratch/`, not
  committed to this repo — it's a personal one-off setup script, re-run
  logic isn't idempotent against an existing board of the same name).
  Needed `gh auth refresh -h github.com -s project` first (interactive
  browser flow — the plain `gh auth refresh -s project` fails
  non-interactively with "--hostname required").
- 8 items seeded 2026-09-21: plugin/marketplace identity rename, engineering
  skill authoring, standardising the team's dev workflow, repointing
  `submit-issue`, the explain-corpus sort, a second look at
  `design-agent-contracts`/`design-agent-interfaces` for generalizable
  patterns, an `instructions.ts` audit, and a tier-3 lookup-tool proposal.
  Grew to 30 items same day once the explain-corpus sort landed (see below).
- Default table view (`View 1`) is set to show only **Title, Status, Track**
  — every other field (Assignees, Labels, Linked PRs, Milestone, Repository,
  Reviewers, Parent issue, Sub-issues progress, Created/Updated/Closed) is
  hidden via `updateProjectV2View`'s `configuration.visibleFieldIds` (not
  exposed by any `gh project` subcommand — had to hit the GraphQL mutation
  directly; view id `PVTV_lAHOBkukW84BkJ0HzgLvEt8`).

## Contributor skills read in full (2026-09-21)

Both read before any code changes, per project convention:

- **`add-tool`** — few tools, many operations (~16 tools / ~115 endpoints).
  Skills come first: figure out the workflow before touching tool code.
  Strict file chain: `definitions.ts` → `schemas/tools.ts` (Zod,
  discriminated unions for multi-op) → `handlers.ts` (`handle<PascalCase>`)
  → tests → `prettier`. Templates bundled under the skill dir.
- **`add-client-platform`** — check manifest-fallback discovery before
  writing anything new. Five archetypes (repo-marketplace, direct config
  merge, packaged extension [removed], stage-and-register,
  credentials-only) — copy the closest reference. Hard rule directly
  relevant to the credential gotcha above: `${user_config.*}` interpolation
  is a **Claude Code–only** feature; any other client must ship no `env`
  block and rely on the `~/.cognigy-plugin/config.json` fallback instead.
  Also: never hand-bump versions, spawn client CLIs only via
  `cliRunner.ts`, purge is global, and update behaviour must be proven
  against source/docs, not assumed.

## Plugin/marketplace identity

- **Not yet renamed.** `plugin/.claude-plugin/plugin.json` `name` is still
  `"cognigy"`, identical to upstream, and `repository` still points at
  `Cognigy/cognigy-plugin`. This is fine for solo `npm run plugin:dev`
  testing (separate `cognigy-dev` marketplace) but MUST be resolved before
  team-wide rollout, or anyone with the official plugin installed collides
  with ours on MCP tool namespace. Logged on the tracker board as a
  Fork-only item. **Ask Ben before making this change** (explicit
  instruction: never rename plugin identity or open a PR without checking
  in first).

## Skill migration map (`cognigy-vibe` → upstream) — not yet executed

- `voice-go-live-checklist` — already upstream, roughly 1:1.
- `explain` — superseded; sort **done** 2026-09-21 via the four-bucket method
  (see "Explain-corpus sort — status" below for the full outcome and what's
  still open).
- `init-cognigy-vibe` — superseded by the `cognigy-setup` installer CLI.
- `build-orchestrator`, `scope-demo`, `design-agent*`, `build-config` —
  sales/demo-scaffolding, no upstream equivalent. Decide per-skill: rewrite
  for engineering delivery, or drop.
- `submit-issue` — needs repointing at the tracker board above instead of
  GitHub Issues (tracked).

## Explain-corpus sort — status (done 2026-09-21)

**The sort itself is complete and logged.** Source corpus was 51 topic files
under
`~/.claude/plugins/marketplaces/cognigy-vibe/plugin/skills/explain/resources/`
(v1.7.4 cache copy — identical to `~/scratch/cognigy-plugin-comparison/cognigy-vibe`;
note the path in the original session brief,
`cognigy-vibe/plugin/skills/explain/resources/` relative to `~/repos/`, does
**not** exist — that repo isn't cloned at `~/repos/cognigy-vibe`, use one of
the two paths above instead).

Ran as a background fork (`Agent` tool, `subagent_type: "fork"`) rather than
inline, given the volume. Headline finding: **~24 of 51 topics were flatly
obsolete** — written against the old Python engine's generic
`cognigy_create`/`cognigy_get`/`resolve_resource` API, which has no
equivalent in this TypeScript engine. Many of the old corpus's hard-won
gotchas turned out to already be solved _in code_, not docs (e.g. placeholder-tool
cleanup, partial-field-update semantics, httpRequest wrapper-shape warnings).

Outcome, all logged to the tracker board same day:

- **Bucket 1** (mechanically enforceable) — 2 found, both already
  implemented. No board item needed.
- **Bucket 2** (`instructions.ts` candidate) — 1 found and logged:
  _"Add cognigyScript undefined-key-omission gotcha to instructions.ts"_
  (Upstream candidate). Strongest single finding — an undefined value in an
  object-typed config field silently **omits the key** rather than writing
  an empty string; severe, cross-cutting, undocumented anywhere.
- **Bucket 3** (merge into upstream skill) — 16 actionable gaps logged as
  individual Upstream-candidate items (one per topic, per Ben's choice over
  one-per-file/consolidated). Standout: the Once/OnFirstTime turn-structure
  pattern has **zero coverage** in `flow-nodes/SKILL.md` despite being
  arguably the single most load-bearing structural convention in any
  Cognigy flow. Also notable: a Voice Gateway gotcha where
  `ttsVendor`/`sttVendor` silently fall back to `"custom"` if not
  exact-lowercase.
- **Bucket 4** (tier-3 lookup-tool candidate) — 1 found: the
  `outbound-trigger.md` CXone `Accept-Encoding: identity` gotcha (omitting
  it makes Node 18's undici silently corrupt gzip responses). Folded into
  the existing _"Propose a scoped tier-3 lookup tool"_ item's body as its
  first concrete example, rather than a separate item.
- **4 capability gaps flagged** (not a docs question — missing product
  surface) — logged as new Triage items: no `update_ai_agent` avatar field,
  no Cognigy Functions invoke tool, no session context-inject tool, and
  `sendMetadata`/`hangup` node types missing from `nodeRegistry.ts`. Each
  needs a build-or-not decision before it's clearly fork-only or
  upstream-worthy.
- Full per-topic detail (every one of the 51 files, its bucket, and
  reasoning) only exists in that fork's completion report inside this
  conversation transcript — **not persisted anywhere else**. If the
  reasoning behind a specific board item needs re-deriving, re-run the sort
  rather than assuming this file has more detail than the bullet points
  above.

## Pick up here — next steps (as of 2026-09-21)

Board is at 30 items, `Track` field grouping recommended, default view
narrowed to Title/Status/Track only (see Tracker board section above). None
of the 21 items produced by the sort have been _acted on_ yet — only
logged. Suggested order, discussed with Ben but not finally committed:

1. **`Upstream candidate`** (17 items) — mostly independent, small,
   self-contained skill edits. Good for chipping away individually or
   batching a few per PR. Remember: cut each PR branch from `upstream/main`,
   never from `main` (see "Fork workflow" in `.claude/CLAUDE.md`).
2. **`Triage`** (6 items) — 4 new capability gaps from the sort, plus the
   pre-existing `design-agent-contracts`/`design-agent-interfaces` recheck,
   plus Ben's feature-flag request (see below). Each needs a scope decision
   before it moves to Fork-only or Upstream candidate.
3. **`Fork-only`** (4 items) — plugin identity rename needs Ben's sign-off
   explicitly before acting; the rest are mechanical/writing tasks.

**Feature-flag request (new, logged 2026-09-21, Triage):** Ben wants a way
to disable individual bundled plugin capabilities per-install — the
concrete example given was turning off the official `docs` MCP server.
Logged as _"Add a feature-flag mechanism to disable individual plugin
capabilities"_, with a pointer to the existing
`COGNIGY_DISABLE_AUDIT_ATTRIBUTION` env-var opt-out pattern in
`src/config.ts` as a possible shape to extend rather than inventing a new
mechanism. Not designed or scoped yet — needs a decision on config surface
(env var vs. `~/.cognigy-plugin/config.json` vs. `userConfig`) and which
capabilities should be flaggable.
