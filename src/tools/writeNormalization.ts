/**
 * Write-path normalisation for near-correct model calls (migration item #10).
 *
 * Pure functions only — no API calls, no side effects. Handlers call these at
 * the top of a write path, before the request goes to the Cognigy API, so a
 * model that is *almost* right (a bare `config.text`, an empty tool-answer
 * config, `flow` instead of `flows`) succeeds instead of failing into a
 * retry loop.
 *
 * Ported from the Python reference implementation
 * (cognigy_mcp/tools/flow_ops.py: _normalise_say_config, _normalise_answer_config,
 * _normalise_rtype, _inject_extension) and adapted to this repo's node-config
 * shapes (see transformConfigForApi in handlers.ts) and singular-canonical
 * resourceType enums (see src/schemas/tools.ts).
 *
 * IMPORTANT: none of these touch `aiAgentJob` node config — the aiAgentJob
 * `preview` gotcha (never hand-craft it; always re-send `config.aiAgent` on
 * any aiAgentJob config PATCH) is handled entirely in handlers.ts and must
 * stay that way.
 */

/**
 * Lift a bare `config.text` on a say node into the full `config.say.text`
 * envelope. No-op if `config.say` is already an object, or if there is no
 * `text` key to lift. Matches the shape `buildSayObject` produces in
 * handlers.ts, so downstream calls to `transformConfigForApi` are idempotent
 * against an already-normalised config.
 */
export function normalizeSayConfig(
  config: Record<string, any> | undefined | null,
): Record<string, any> | undefined | null {
  if (!config || typeof config !== "object") return config;
  if (config.say && typeof config.say === "object") return config;
  if (config.text === undefined) return config;

  const text = Array.isArray(config.text) ? config.text : [String(config.text)];
  const { text: _text, ...rest } = config;

  return {
    ...rest,
    say: {
      type: "text",
      text,
      data: "",
      linear: false,
      loop: false,
      _cognigy: {},
    },
  };
}

/** Canonical answer expression injected when an aiAgentToolAnswer config is empty. */
export const CANONICAL_TOOL_ANSWER = "{{JSON.stringify(context.toolResponse)}}";

/**
 * Inject the canonical `answer` field on an aiAgentToolAnswer node when it is
 * absent. A silently-empty config returns nothing to the LLM, which reads as
 * a dead tool call rather than a validation error — so this fills the gap
 * rather than rejecting the write. No-op if `answer` is already present.
 */
export function ensureToolAnswer(
  config: Record<string, any> | undefined | null,
): Record<string, any> {
  const cfg = config && typeof config === "object" ? config : {};
  if (cfg.answer !== undefined) return cfg;
  return { answer: CANONICAL_TOOL_ANSWER, ...cfg };
}

/**
 * Normalise a resource-type argument that is off by singular/plural against
 * the schema's accepted enum values (e.g. "flow" vs "flows"). Case-insensitive.
 * Returns the input unchanged if no match is found, so schema validation still
 * produces a useful error for genuinely wrong resource names.
 */
export function normalizeResourceType(
  resourceType: string,
  allowed: readonly string[],
): string {
  if (allowed.includes(resourceType)) return resourceType;

  const lower = resourceType.toLowerCase();
  const exact = allowed.find((a) => a.toLowerCase() === lower);
  if (exact) return exact;

  if (lower.endsWith("s")) {
    const singular = lower.slice(0, -1);
    const match = allowed.find((a) => a.toLowerCase() === singular);
    if (match) return match;
  } else {
    const plural = `${lower}s`;
    const match = allowed.find((a) => a.toLowerCase() === plural);
    if (match) return match;
  }

  return resourceType;
}

/**
 * Shallow-copies `args` with `resourceType` normalised against `allowed`
 * (see `normalizeResourceType`). Safe to call unconditionally before a Zod
 * `.parse()` — it only rewrites the field when a singular/plural match is
 * found, otherwise `args` is returned untouched.
 */
export function normalizeResourceTypeArg<T extends { resourceType?: unknown }>(
  args: T,
  allowed: readonly string[],
): T {
  if (!args || typeof args.resourceType !== "string") return args;
  const normalized = normalizeResourceType(args.resourceType, allowed);
  if (normalized === args.resourceType) return args;
  return { ...args, resourceType: normalized };
}

/**
 * Static node-type → extension map (mirrors the Python `_NODE_EXTENSION_MAP`).
 * Used only as a defensive fallback — every node type reachable through
 * `manage_flow_nodes` already carries its extension from `nodeRegistry.ts`.
 */
const NODE_EXTENSION_MAP: Record<string, string> = {
  setSessionConfig: "@cognigy/voicegateway2",
  hangup: "@cognigy/voicegateway2",
  sendMetadata: "@cognigy/voicegateway2",
  aiAgentJob: "@cognigy/basic-nodes",
  aiAgentJobTool: "@cognigy/basic-nodes",
  aiAgentJobMCPTool: "@cognigy/basic-nodes",
  aiAgentToolAnswer: "@cognigy/basic-nodes",
  initAppSession: "@cognigy/basic-nodes",
  setHTMLAppState: "@cognigy/basic-nodes",
  setAdaptiveCardAppState: "@cognigy/basic-nodes",
  setAppState: "@cognigy/basic-nodes",
  getAppSessionPin: "@cognigy/basic-nodes",
  say: "@cognigy/basic-nodes",
  question: "@cognigy/basic-nodes",
  code: "@cognigy/basic-nodes",
  sleep: "@cognigy/basic-nodes",
  goTo: "@cognigy/basic-nodes",
  httpRequest: "@cognigy/basic-nodes",
  addToContext: "@cognigy/basic-nodes",
  if: "@cognigy/basic-nodes",
  switch: "@cognigy/basic-nodes",
};

/** Look up the extension a known node type ships from, if any. */
export function inferExtensionForNodeType(
  nodeType: string,
): string | undefined {
  return NODE_EXTENSION_MAP[nodeType];
}

/**
 * Auto-inject the correct `extension` for a node-create body when it is
 * missing but the node `type` is known. No-op when `extension` is already
 * set or `type` is absent/unknown.
 */
export function ensureExtension<
  T extends { type?: string; extension?: string },
>(body: T): T {
  if (body.extension || !body.type) return body;
  const ext = inferExtensionForNodeType(body.type);
  return ext ? { ...body, extension: ext } : body;
}
