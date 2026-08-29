# Final Review Report — cognigy-vibe Parity PRs (#1–#16)

---

## PART A — Validation outcomes

Verdict legend: **merge-as-is** / **merge-with-changes** / **needs-rework**. Only findings where the skeptic disagreed, corrected, or added something material are listed; everything else survived adversarial re-validation as originally stated.

### PR 1 — fix(config): derive URLs for NiCE CXone hosts — **merge-with-changes**

- **Corrected:** the prior "redundant rename + tests" framing was wrong. The headline CXone regex bug _is_ already fixed on main (#12/31ac010) and the PR body is stale — but the diff also fixes a **real live port-dropping bug** (`deriveHostBaseUrl` returns `protocol//hostname`, silently losing `:8443` from derived endpoint/webchat/static URLs).
- **New (skeptic strengthened):** the rewritten parse-failure fallback regresses 31ac010's host-scoping — worse than the validator claimed: even a _parseable_ URL like `https://example.com/api-docs` gets its path rewritten to `/endpoint-docs`, directly contradicting the warning text "Using the API URL unchanged". Must restore host-scoped replace.
- Required before merge: rewrite description (port fix + tests, ref #12), restore host-scoped fallback, optionally dedupe the 3x-per-boot warning.

### PR 2 — feat(api): corporate CA trust autodetection — **needs-rework**

- All prior findings confirmed, plus the review found the defect that kills the PR's purpose: **the macOS keychain branch is dead code** — `/etc/ssl/cert.pem` exists on every Mac (Apple public roots, zero NICE certs) and the system-bundle probe runs first, so on the team's actual platform autodetection resolves to a corporate-CA-free bundle _while replacing_ Node's default trust store. Even if reached, the keychain branch queries the wrong keychain (SystemRootCertificates instead of `/Library/Keychains/System.keychain` where NICE/Fortinet CAs live — verified live on this machine).
- Also confirmed: env/probe paths **replace** rather than augment trust (regression vs Node's native `NODE_EXTRA_CA_CERTS` semantics — corp-CA-only PEM breaks all public TLS off-VPN), and the auto-trusted world-writable `/tmp/combined-ca.pem` probe is a minor security exposure.
- Fix set: query System.keychain, reorder/gate the darwin branch, merge with `tls.rootCertificates` on every path, reconsider the /tmp probe. Until then the PR only helps users who were already fine.

### PR 3 — docs(skills): verification gate + submit-issue — **merge-with-changes**

- **Refuted (favorably):** the prior "unverified resourceType strings" concern resolves clean — every enum value is valid. But the check exposed a real bug the prior review missed: gate steps 1/4 call `get_resource` with `resourceId` where the schema requires `id` (Zod failure on first use), step 4 needs `raw: true` (filtered agent projection has no `jobConfig`), and step 3's example omits the required `message`.
- Three one-line doc fixes before merge; target repo and all tool names verified real.

### PR 4 — feat(server): degraded-mode boot — **merge-as-is**

- All prior findings confirmed; tests are unusually thorough (real handler exercised, mid-session pickup, sync-race).
- **New:** the guidance string "No restart is needed after running cognigy-setup" overpromises for the **primary Claude Code install path** — the `claude` CLI route stores the key in the OS keychain and never writes `~/.cognigy-plugin/config.json`, which `tryLoadConfig()` cannot read (setup.ts's own success message says "Just restart Claude Code"). Follow-up: soften the wording or have the cli path also write the fallback file. Not a blocker.

### PR 5 — fix(api): Retry-After + no POST retry — **merge-as-is**

- Everything confirmed by executing the suite in an isolated copy (16/16 tests — the prior "12" was an undercount; typecheck clean). PATCH-as-idempotent verified safe across **all** call sites (skeptic found 4 more the validator missed; all still fixed-payload).
- Only cosmetic corrections (pre-PR backoff was already exponential, not fixed 500ms). Strictly safer than main.

### PR 6 — feat(flow): write conflict detection — **needs-rework**

- **Blocker confirmed:** the branch commits `node_modules` as a mode-120000 symlink to `/Users/Ben.Elliot/...` — dangling on every other machine/CI. Strip before anything else.
- **Refuted:** the prior "scope creep" finding was wrong — code / setHTMLAppState / aiAgentJobTool is a 1:1 map to vibe's three push tools (parity, not creep).
- **New (skeptic strengthened):** the `update_tool` bypass is worse than claimed — `update_tool` also patches child **code** nodes unchecked, so even the flagship field has a bypass; mixing `update_tool` and `manage_flow_nodes update` on one node produces false-positive conflicts. Also: busy-spin lock loop (100% CPU up to 2s), stale lock-file docstring, unbounded snapshot store, create-path snapshots record the locally-transformed config (server normalization could false-positive).

### PR 7 — feat(tools): describe_resource_schema — **merge-with-changes**

- **Refuted:** the claimed $ref/allOf test coverage does not exist — zero tests exercise `resolveSchemaRef`/`withResolvedSchema`/the composition "note" path, which are exactly the paths most likely to break against the real ~8MB spec. "Replacing nodeRegistry" also overstated — the registry still gates creates; this complements it.
- Endpoints themselves are corroborated (daily production use in vibe), but the TS port's response-shape handling is live-unverified — the author flagged this honestly.
- Required: live smoke test both endpoints, add $ref/allOf tests, refresh stale PR body (17→18, not 16→17). Minor: PUT missing from `availableMethods`, `nodeType`+`operation` silently drops `operation`, no instructions.ts/skill discoverability.

### PR 8 — feat(design-forge): skill scaffolding — **merge-with-changes**

- All findings confirmed. Material additions: **31 repo-root-relative reference-doc citations** (never `${CLAUDE_PLUGIN_ROOT}`) won't resolve from a user-project cwd once installed; design-forge is **Claude Code marketplace-only** (copy-assets/installers never ship it to Desktop/Antigravity); it sits **outside the one-version regime** (sync-plugin-version ignores it — though marketplace auto-update still delivers content); `npm run plugin:dev` doesn't serve it.
- Load in a real Claude Code install still unverified (checkbox unchecked). PR body's "16-tool surface" is stale (17).

### PR 9 — feat(assets): avatar PNG + knowledge upload — **merge-with-changes** (close to as-is)

- **Changed:** the prior blocking concern (avatar PATCH field contract unverified) is largely defused — PR 13's vibe-derived `agent-avatar-image.md` documents the identical endpoint/fields/dims, so the residual risk is small.
- New minor findings all confirmed: `tags` silently dropped on url/text sources; no revert-to-preset avatar route; unknown extensions upload as octet-stream instead of failing fast (inconsistent with the PR's own avatar philosophy); `~` expansion is HOME-only (Windows).

### PR 10 — feat(installer): status --fix / update --check / uninstall — **merge-with-changes**

- **Changed from merge-as-is:** drift detection covers only **2 of the 5 surfaces** main's installer manages — `status`/`update --check` can print "No drift detected." / "Everything is up to date." while Antigravity/Codex/Gemini installs are stale (softened slightly: the version listing above still shows them; the false negative is in the drift verdict lines).
- Title overreach confirmed: `uninstall` gained only an `export` keyword — pre-existing behavior, now tested.
- No Windows `.ps1` (arsalan item #6 names it explicitly). Core implementation (pure reconcile.ts, per-fix isolation, creds-gated Desktop rebuild) is clean and well-tested.

### PR 11 — feat(flow): write normalisation — **merge-as-is**

- Everything confirmed: pure module, aiAgentJob untouched, `ensureToolAnswer` post-merge non-clobbering, idempotency tested, all enum values plural-safe.
- Minor new: two different "canonical" tool-answer defaults now coexist (`context.toolResponse` vs create path's `input.result` at handlers.ts:3084) — align in a follow-up. Note: the create path lives in `create_tool`, not "manage_agent_flow" (which doesn't exist).

### PR 12 — feat(cache): persistent read cache + name→ID — **merge-with-changes**

- Confirmed: `COGNIGY_CACHE_ENABLED` is **documented nowhere user-facing** — the parity feature is dead-on-merge without a README/instructions mention. The rename staleness gap is real but narrow.
- **New (skeptic strengthened):** the name→id map has **no TTL and never self-heals during active use** (touchInteraction resets the 4h idle clock on every call, so an active session never resyncs; ProjectState never re-reads the file); multi-process `.state.json` is last-writer-wins (forgets can be resurrected); the ben-diff "show flow chart" case is **not** cached (no /chart reads cached); `bindProject()` is dead code and scoping is per-host not per-project (cross-project name collisions possible).
- One test-evidence overstatement: cacheInvalidation.test.ts covers 2 of 3 create_source types; the file-upload branch's invalidation is untested (code exists).

### PR 13 — feat(tools): explain reference tool — **merge-with-changes**

- Mechanism (build/validate/CI-sync) fully confirmed and solid. Miscount confirmed (18th tool, not 17th; CLAUDE.md stale post-merge).
- **Material confirmed finding:** ported leaf content instructs calls to **nonexistent tools** (~230 refs: `cognigy_create` x90, `push_agent_tool` x32, `resolve_resource` x10, etc.); the mapping disclaimer lives only in group index primers, which a direct leaf lookup (`explain {topic:"agent-job-node"}` or `tool-selection`) never surfaces — the tool can actively induce the fail/retry loops it exists to prevent. Inject the mapping note into leaf responses or rewrite the worst offenders before/with merge.

### PR 14 — feat(dev): hot reload — **merge-with-changes**

- **Changed from merge-as-is:** confirmed **crash-during-restart hang** — a respawned child that fails to boot (the canonical case: you saved broken code, then called `reload_mcp`) is silently swallowed (`restarting` never cleared → no respawn, no exit, supervisor hangs with no child). This is the most likely real-world failure mode and is untested.
- Also: server never advertises `tools.listChanged` in initialize (spec-strict clients may ignore the refresh notification); not integrated with `npm run plugin:dev`; `COGNIGY_DEV=1` on an unsupervised server is a foot-gun (reload just kills the server). Everything else (production invisibility, injection-seam tests, documented line-loss limitation) confirmed.

### PR 15 — feat(design-forge): agent definitions — **merge-with-changes** (jointly with #8)

- Confirmed: stacked on #8 (body's "Stacked on #14" is a typo); dangling `docs/superpowers/...` spec reference; "retired plugin/skills/design-agent\*" describes skills that **never existed in this repo** (they're cognigy-vibe assets — reword).
- **Material risk confirmed:** `tools:` frontmatter uses **bare MCP tool names** (`list_resources, ...`) while Claude Code exposes plugin MCP tools as `mcp__<server>__<tool>` — and design-forge ships no MCP server of its own — so the allowlist may silently deny the exact exceptional-use access it grants. Live-check with `/agents` or drop the scoping (existing agents are unscoped).

### PR 16 — feat(flow): push node content from a local file path — **merge-as-is**

- **The only skeptic refutation in the whole set:** the claimed create-path behavior change (`config: {}` no longer sending a config key) **does not exist** — main's POST guard already omitted empty configs; the internal value changed with zero observable difference.
- Corrections absorbed: 4 call sites (not 3); only ENOENT gets a distinct message (EACCES/EISDIR share the generic wrapper); 45 new tests, not 22 (undercount). Skeptic caveat worth noting: filePath reads bypass the client's per-file Read permission gate once the tool is allowed — a prompt-granularity regression, not a new capability.
- Remaining fix is cosmetic: unenforced extension claims in definitions.ts/SKILL.md. Conflict detection is correctly deferred to #6.

**Cross-cutting correction (applies to guides in PRs 1, 7, 10, 13):** the installer invocation is `npx -y -p @cognigy/plugin-engine@latest cognigy-setup`. The bare form `npx @cognigy/plugin-engine@latest cognigy-setup` **fails** ("could not determine executable to run") because the package ships two bins, neither named after the package. All commands below use the correct form.

---

## PART B — How we use these PRs like cognigy-vibe

### 1. Editing code / HTML / tool-parameter nodes (file push + conflict guard)

**PRs: 16 (push), 6 (conflict detection)** — together they are vibe's `push_code_node` / `push_html_node` / `push_agent_tool`.

**Vibe today:** you keep the artifact as a local file, edit it with native Write/Edit/LSP, and push by path; the push diffs the remote against what you last pushed and blocks with a unified diff if a human or another agent changed it, with a force override. Biggest observed token-saver in the team's daily use.

**Here (after both merge; #6 needs its symlink stripped first):**

- Create a code node from a file:
  `manage_flow_nodes { operation: "create", flowId, parentNodeId: <toolNodeId>, mode: "appendChild", nodeType: "code", label: "Compute", filePath: "/Users/you/proj/flow/compute.js" }`
  (filePath **or** `config.code`, never both — other config keys may accompany filePath.)
- Iterate: `Edit` the local file, then
  `manage_flow_nodes { operation: "update", flowId, nodeId, filePath: "/Users/you/proj/flow/compute.js" }`
  After the push the handler reads the node back and returns a `_hints.warning` if it failed to transpile.
- xApp HTML: same param with `nodeType: "showXAppHtml"` on create, or update of an existing `setHTMLAppState` node (→ `config.html`).
- Tool parameter schemas: `create_tool { aiAgentId, toolType: "tool", name, config: { toolId, description }, parametersFilePath: "/abs/path/search-params.json" }` (or `update_tool` with `toolNodeId`); invalid/non-object JSON is rejected before any API write; `useParameters` set automatically.
- Paths must be absolute; every read failure aborts before any POST/PATCH.
- Conflict guard (#6): baselines record automatically on create/update; a blocked update returns `{ conflict: true, nodeId, field, diff, message }` + `_hints`. Resolve by folding the remote diff in, or re-issue with `forceWrite: true`. **Corrected per skeptic:** concurrent sessions on the _same machine_ share the snapshot store, so another local session's push does **not** block — blocks fire only for cross-machine/other-user edits or pushes via a bypassing path.

**Parity gaps (honest):**

- **Push-only** — no pull/seed direction; to start maintaining an existing node locally you must `manage_flow_nodes { operation: "get" }` and write `config.code` to disk yourself.
- **`update_tool` bypasses the conflict guard entirely** (including child code nodes it patches) while definitions.ts recommends it for tool nodes — mixing paths causes both silent clobbers and spurious conflicts needing `forceWrite`. Vibe had one write path and no such hole.
- No baseline for nodes never pushed from this machine (first update unchecked — same as vibe's local snapshots); diff truncated at 50 lines; documented `.js/.ts/.html/.json` extension rules aren't enforced.

### 2. Learning the platform — progressive docs (explain)

**PR: 13.**

**Vibe today:** `explain()` no-arg → index; `explain(group)` → primer; `explain(topic)` → full bite-sized reference. Ranked gap #1 because it reaches skill-less clients (Codex, Desktop).

**Here:** tool `explain` (read-only, one optional param):

- `explain {}` → "# Cognigy Plugin Reference Library" index of 6 groups (aiagent, code, nodes, platform, voice, xapp)
- `explain { "topic": "nodes" }` → primer + topics table
- `explain { "topic": "node-wiring" }` (43 leaf keys; case-sensitive exact match; note xapp leaves are `xapp-delivery`/`xapp-event-handling`, not the filenames)
- Unknown/misspelled topic returns the index for self-correction.
- Authoring loop: edit `docs/explain/resources/<group>/<topic>.md` (topic:/description: frontmatter), `npm run build:explain`, commit both; `npm run check:explain` / plain `npm test` / CI fail on drift.

**Parity gaps:** no skills↔explain sync (two separate guidance corpora, dual-maintenance); **~230 leaf snippets still name vibe's tools** (`cognigy_create`, `push_agent_tool`, …) that don't exist here — until the leaf-level mapping note lands, treat leaf tool snippets as _concepts_, translating to `manage_flow_nodes` / `create_tool` / `list_resources`; some topics honestly document raw-REST-only capabilities (avatar revert, connections); output is JSON-wrapped, not raw markdown; 49 keys vs vibe's 51 (3 vibe-specific topics deferred).

### 3. Learning the platform — live schema introspection

**PR: 7** — vibe's `describe_resource_schema`, the "introspect before guessing" habit.

**Here:** before an unfamiliar write:

- `describe_resource_schema { resourceType: "lexicons", operation: "create" }` → `{ path: "/v2.0/lexicons", method: "post", fields: [...] }`; singular/alias forms normalize (`agent` → aiagents PATCH, `knowledge-store` → knowledgestores).
- Node configs incl. 3rd-party extensions the registry doesn't know: `describe_resource_schema { resourceType: "node", nodeType: "say", flowId: "<any 24-hex flowId>" }` (omit `operation`; descriptor catalog is project-wide; note passing both nodeType and operation silently ignores operation).
- `verbose: true` for `raw_schema`/`raw_fields`; unknown values return `known_resource_types`/`known_node_types` (after a substring best-guess with a warning).
- 24h in-memory cache — repeat lookups skip the ~8MB spec fetch.

**Parity gaps:** cache is per-process (vibe's is on-disk persistent — that half is PR 12's territory but PR 12 doesn't cache the spec); vibe pairs introspection with normalization (here PR 11 covers a subset); endpoints live-unverified in this TS port; no skill/instructions nudge toward the tool.

### 4. Forgiving writes (normalisation)

**PR: 11** — vibe's `flow/{id}` → `flows/{id}`, `config.text` → `config.say.text` invisible plumbing.

**Here (transparent, nothing to configure):** `list_resources { resourceType: "flows" }`, `get_resource { resourceType: "FLOW", id }`, `delete_resource { resourceType: "tools", id, aiAgentId }` all resolve; bare `config: { text: "Hello" }` on a say node lifts to the full `config.say` envelope on create and update; an empty aiAgentToolAnswer config gets the canonical answer injected on update (note: explicit `answer: ""` counts as present and is preserved). Genuinely unknown values still fail Zod with the normal error. **Corrected nuance:** aliasing only resolves into that tool's own enum — `get_resource { resourceType: "tools" }` still fails ('tool' isn't in the get enum).

**Gaps:** only the three resource tools + manage_flow_nodes get forgiveness (vibe corrected at the API-path level, catching any endpoint mistake); injected answer expression differs from the create path's default — pending alignment.

### 5. Fast reads (persistent cache + name→ID)

**PR: 12.**

**Vibe today:** always-on, invisible — repeat reads and name lookups within a session cost nothing; 5-min TTL, 4h idle resync.

**Here (opt-in — the big difference):**

1. `export COGNIGY_CACHE_ENABLED=true` in the environment the MCP server inherits (or `"env": {"COGNIGY_CACHE_ENABLED": "true"}` in the server config). **Env var only** — no installer flag, no config.json key.
2. Restart the session. Then: `get_resource` for agent/flow/endpoint/project/llm_model/knowledge_store/extension/function is cache-first for 5 min (conversation/session_state/`raw: true` always live); `list_resources` for agent/flow remembers name→id; **all 8** agent→flow resolution sites reuse the mapping (update_ai_agent, create_tool, update_tool, delete_resource agent cascade, talk_to_agent endpoint auto-resolution when given `aiAgentId` without `endpointUrl` — there is no "tool mode" — audit_voice_agent, and list/delete_resource for `resourceType: "tool"`).
3. Force live: `raw: true`, or `rm -rf ~/.cognigy-plugin/cache/state/<your-api-host>` (deleting state forces a full resync incl. the running process's in-memory name map). Idle >4h auto-wipes everything.

**Parity gaps:** off-by-default behind an env var **documented nowhere** — until that lands, a migrating teammate gets zero caching; "show flow chart" reads (named in ben-diff-notes) are **not** cached; name→id map never expires during active use, so a teammate's in-UI rename can be masked indefinitely (read cache self-heals in 5 min, the map doesn't); scoped per API host not per project (name collisions across projects possible); concurrent servers can clobber each other's state file; no clear-cache tool or hit/miss visibility.

### 6. First-run / install lifecycle

**PRs: 4 (degraded boot), 10 (status/update/uninstall), 1 (CXone hosts).**

**Vibe today:** the server boots credential-less and the next tool call after configuring just works; the installer is a lifecycle manager (`status --fix`, `update --check`, `uninstall`, Windows `.ps1`); CXone tenant URLs derive automatically.

**Here:**

- **Degraded boot (PR 4):** install without credentials, server boots (stderr: "Starting NiCE Cognigy Plugin in degraded mode"), all 17 tools list, any call returns `{ error: "not_configured" }` naming exactly which of COGNIGY_API_BASE_URL / COGNIGY_API_KEY is missing. **Corrected mid-session pickup recipe:** hand-write `~/.cognigy-plugin/config.json` (JSON with those two keys) or have launched the server with the env vars — then retry the same call in the same session (e.g. `list_resources { resourceType: "project" }` — singular). You **cannot** export env vars into an already-running server from another shell, and if `cognigy-setup` takes its primary path (claude CLI present → keychain) the file is never written and a restart/`/reload-plugins` _is_ needed despite the guidance text.
- **Lifecycle (PR 10):**
  - `npx -y -p @cognigy/plugin-engine@latest cognigy-setup status` — per-surface versions + drift list with exact fixes
  - `... cognigy-setup status --fix` — applies each fix independently (stale plugin → `claude plugin update`; missing launcher/engine rewritten/reinstalled; Desktop entry rebuilt from stored 0600 creds, or a re-run prompt if no key stored)
  - `... cognigy-setup update --check` — dry-run "update available (1.6.0 → 1.7.0)" / "Everything is up to date."
  - `... cognigy-setup uninstall` (`--yes` non-interactive, `--purge` deletes ~/.cognigy-plugin, `--client claude-code|claude-desktop|codex|gemini|antigravity`)
- **CXone (PR 1 + merged #12):** point setup at `https://cognigy-api-au1.nicecxone.com` and `talk_to_agent`, `create_ai_agent`, `manage_webchat`, `manage_voice_gateway` automatically use the derived endpoint/webchat/static hosts (ports now preserved); `COGNIGY_ENDPOINT_BASE_URL` etc. override non-conventional hosts.

**Parity gaps:** drift detection covers only Claude Code + Desktop — a stale Antigravity/Codex/Gemini install still gets "No drift detected." (versions are visible in the listing above, but not flagged); no Windows `.ps1`; no marketplace-pin check; vibe fails loudly on unrecognizable hosts, this plugin only stderr-warns and proceeds; fixing a _wrong_ (vs missing) key mid-session still needs a restart; no in-conversation configure tool.

### 7. Resilience (retries / TLS)

**PRs: 5 (merge-ready), 2 (not ready).**

- **Retry semantics (PR 5), transparent under all 17 tools:** 429s wait the server's `Retry-After` (capped 30s, visible in stderr as `honoredRetryAfter: true`); 5xx/network retries are gated to GET/PUT/DELETE/PATCH; a POST create that hits a 5xx **fails fast instead of risking a duplicate** — recovery pattern: LIST first to check whether the create landed, then re-issue only if absent. POST 429s still retry (safe). Gap vs vibe: no per-call opt-in, so safe POST-shaped reads lose 5xx retry; no `_hints` teaching the recovery pattern.
- **Corporate TLS (PR 2): do not rely on it yet.** On a Mac behind NICE inspection the autodetection currently resolves to an Apple-roots-only bundle and replaces Node's trust store. **Keep using the team's shell-profile setup** (`NODE_EXTRA_CA_CERTS=/tmp/combined-ca.pem` etc.) — the env-var path wins and works. The zero-setup vibe/`truststore` experience arrives only after the rework (System.keychain query, branch ordering, augment-not-replace).

### 8. Dev iteration (hot reload)

**PR: 14** — vibe's `orchestrator.py` + `reload_mcp` rc=42 loop.

**Here:** in the repo, point a **project-scope** MCP entry at the supervisor (project scope matters — the child spawn resolves `tsx/esm` from the supervisor's cwd):
`claude mcp add cognigy-dev --env COGNIGY_API_BASE_URL=... --env COGNIGY_API_KEY=... -- npx tsx /Users/Ben.Elliot/repos/cognigy-plugin-vibe/src/dev/supervisor.ts`
The supervisor spawns the server with `COGNIGY_DEV=1`, adding an 18th tool `reload_mcp` (params `{}`). Edit src/, save, call `reload_mcp` — server exits 42 after 250ms, supervisor respawns from disk, replays your initialize handshake, emits `tools/list_changed`; the session keeps its connection.

**Parity gaps / warnings:** **if your saved edit doesn't compile, the reload hangs the supervisor** (crash swallowed during the restart window — dead-air session, restart the client) — the confirmed hole in the crash-propagation guarantee; `listChanged` isn't advertised in the initialize capabilities (fine in Claude Code, not guaranteed elsewhere); **not integrated with `npm run plugin:dev`** (skills+tools dev sessions still launch src/index.ts directly — no hot reload without re-pointing); never set `COGNIGY_DEV=1` on a plain server (calling reload just kills it); documented shared-with-vibe limitation: a partial JSON-RPC line at the instant of teardown can be lost.

### 9. Design-forge build pipeline

**PRs: 8 (skills + reference docs), 15 (agents), 3 (verification gate). Accept/reject 8+15 together.**

**Vibe today:** `/build-orchestrator` — the 1854-line mega-skill: interview → brand research → scope → design → build → a 13-assertion + 3-turn-smoke-test verification gate. The team lives in it daily but judged it too large; design-forge is their in-progress modular replacement (unmerged even in vibe).

**Here:**

- Install: today only from a checkout of the PR branch — `claude plugin marketplace add .` then `/plugin install design-forge@cognigy-plugin` (in addition to the cognigy plugin; credentials needed only for capability-inventory's exceptional MCP path).
- **Single-artefact ask (the headline parity case):** dispatch `identity-agent` ("design a persona for <bot>") → runs the `design-forge:identity` skill, confirms a `build_identifier`, self-serves only missing hard deps, writes `{build_identifier}_identity.md`. Nothing downstream runs. Tool-definition asks map to `integration-agent`/`routing-agent`, which self-serve `capability-inventory` first — exactly ben's examples.
- Mid-pipeline: `state-model-agent` alone self-serves capability-inventory then routing automatically.
- **Full build (no orchestrator):** hand-sequence per `design-forge/reference/dependency-graph.md` — roots (capability-inventory + identity, parallelizable) → behavioural-policy (needs your `channel_choice`) + routing → state-model → presentation and integration **sequentially in either order** (never parallel; the second appends to the shared `{bid}_hand_off_contract.md`) → enforcement (conditional). **Corrected per skeptic:** pass `mode=standalone` (orchestrated mode is reserved for the not-yet-existing orchestrator), and run the reference/structural-floor.md 5-check at every layer boundary **and after every resume-and-revise**.
- `review-agent` (Read-only) gives an artefact-consistency report.
- **Verification gate (PR 3):** activates automatically inside the _existing_ `cognigy-agent-builder` agent (the cognigy plugin, not design-forge): Phase A structural checks — `list_resources { resourceType: "flow", projectId }`, `manage_flow_nodes { operation: "render", flowId }`, endpoint/llm_model lists, and (**corrected**) `get_resource { resourceType: "agent", id: aiAgentId, raw: true }` — then Phase B: three `talk_to_agent { endpointUrl, message, sessionId: "smoke-<ts>" }` turns; red loops back to the failing build step.

**Parity gaps (the big ones):**

- **No orchestrator and no ported /build-orchestrator** — this repo currently has _no_ one-command e2e build experience at all, which is worse than vibe today; design-forge covers design artefacts only, and building/validating on the platform still goes through cognigy-agent-builder separately.
- Claude Code only (installers/copy-assets never ship design-forge to Desktop/Antigravity); reference-doc paths may not resolve from an installed plugin (repo-root-relative, no `${CLAUDE_PLUGIN_ROOT}`); agents' bare MCP tool names may not match Claude Code's `mcp__`-prefixed naming (live-check pending); the gate is 5 assertions vs vibe's 13 and is subagent-internal — no standalone `/verify` against an agent you built earlier; gate steps error as-written until the `resourceId`→`id` / `raw:true` doc fixes land.

### 10. Assets (avatar + knowledge files) and issue reporting

**PRs: 9, 3.**

- **Avatar (vibe's `push_agent_avatar`):** resize a PNG to exactly 136x184 locally, then `update_ai_agent { aiAgentId, avatarImagePath: "/abs/path/quinn.png" }` — local signature/dims validation (clear error, no API call on failure), PATCHes the agent, and correctly re-PATCHes the job node's `config.aiAgent` so the flow-editor preview survives. Gap: no revert-to-preset route once a custom avatar is set.
- **Knowledge file (vibe's `push_knowledge_source_file`):** `manage_knowledge { operation: "create_source", knowledgeStoreId, type: "file", filePath: "/abs/path/report.pdf", tags: ["demo"] }` — real multipart with per-file Content-Type (pdf/txt/text/ctxt/docx/pptx) and comma-joined tags; ingestion is async (`_hints.warning`; verify with `list_chunks`). Gaps: unknown extensions upload as octet-stream rather than failing fast; `tags` on url/text sources are silently ignored — only attach tags with `type: "file"`.
- **`/submit-issue` (vibe parity item):** when a plugin tool/skill misbehaves, `/submit-issue` synthesizes `[<component>] <failure>` + templated body, captures the plugin version, and runs `gh issue create --repo ben-elliot-nice/cognigy-plugin-vibe --label bug --label claude-submission ...` (creating the label if missing; paste-yourself URL fallback if `gh` is absent). Requires `gh` authed; drops vibe's dev/main milestone convention (intentional — single-branch semantic-release here).

---

### Bottom line

- **Merge now:** #5, #11, #16, #4 (guidance-string follow-up).
- **Merge after small fixes:** #3 (three one-word doc fixes), #9, #7 (live smoke + $ref tests), #13 (leaf-level tool-name mapping), #12 (document the env var + rename-forget), #10 (surface-coverage caveat), #14 (restart-window hang), #1 (description + host-scoped fallback), #8+#15 jointly (path anchoring, load verification, tools: naming check).
- **Rework:** #6 (strip the node_modules symlink; then close the update_tool bypass), #2 (keychain target, branch ordering, augment-not-replace — until then keep the shell-profile env vars).
- **Biggest honest parity shortfalls even after all merges:** no e2e build orchestrator (design-forge is the future direction, not today's `/build-orchestrator`), caching off-by-default and undocumented, file push has no pull direction and a conflict-guard bypass via `update_tool`, and zero-setup corporate TLS is not yet real.
