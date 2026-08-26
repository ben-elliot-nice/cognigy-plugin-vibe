/**
 * DEV-ONLY tool surface. Never shipped to production users of `cognigy-mcp`.
 *
 * `reload_mcp` is only registered when the server is booted with COGNIGY_DEV=1
 * (set automatically by the dev supervisor, src/dev/supervisor.ts). Calling it
 * asks the current process to exit with RELOAD_EXIT_CODE (42); the supervisor
 * treats that exit code as a request to rebuild + respawn the server in place
 * and tells the connected MCP client to refresh its tool list — letting a
 * developer editing source see the change take effect without restarting the
 * client itself.
 */
import type { ToolDefinition } from "./definitions.js";

export const devTools: ToolDefinition[] = [
  {
    name: "reload_mcp",
    description:
      "DEV ONLY. Reload the MCP server from local source after editing it. " +
      "Exits the current process with the reload sentinel; the dev supervisor " +
      "(src/dev/supervisor.ts) rebuilds/respawns the server from disk and the " +
      "client's tool list is refreshed automatically. Only available when the " +
      "server is running under the dev supervisor with COGNIGY_DEV=1 — has no " +
      "effect and is not registered otherwise.",
    annotations: {
      title: "Reload MCP Server (dev)",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

/** True when the server should expose/allow dev-only tooling like `reload_mcp`. */
export function isDevModeEnabled(): boolean {
  return process.env.COGNIGY_DEV === "1";
}

/**
 * Builds the tool list the server advertises via `tools/list`: the production
 * tool set, plus `devTools` when dev mode is enabled. Production behavior
 * (COGNIGY_DEV unset) is unchanged — this returns `baseTools` as-is.
 */
export function buildToolList(baseTools: ToolDefinition[]): ToolDefinition[] {
  return isDevModeEnabled() ? [...baseTools, ...devTools] : baseTools;
}
