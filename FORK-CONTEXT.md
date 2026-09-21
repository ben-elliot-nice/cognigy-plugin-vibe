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
- `explain` — superseded; sort in progress via the four-bucket method (see
  tracker board "Sort and retire the vibe explain corpus").
- `init-cognigy-vibe` — superseded by the `cognigy-setup` installer CLI.
- `build-orchestrator`, `scope-demo`, `design-agent*`, `build-config` —
  sales/demo-scaffolding, no upstream equivalent. Decide per-skill: rewrite
  for engineering delivery, or drop.
- `submit-issue` — needs repointing at the tracker board above instead of
  GitHub Issues (tracked).

## Next planned step (not started as of this writing)

Step 6 of the original session plan: go through
`cognigy-vibe/plugin/skills/explain/resources/` topic by topic (grouped by
aiagent/code/nodes/platform/voice/xapp), classify each into one of the four
buckets (mechanically enforceable → Zod constraint; severe+cross-cutting →
`src/instructions.ts`; workflow-scoped → merge into matching upstream skill;
genuine leftover → tier-3 lookup-tool candidate), and log outcomes to the
tracker board as we go, not batched to the end.
