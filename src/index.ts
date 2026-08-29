#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadServerMeta, buildSetupGuidance } from "./config.js";
import { tools } from "./tools/definitions.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { logger } from "./utils/logger.js";
import { RuntimeManager } from "./runtime.js";

async function main() {
  try {
    const meta = loadServerMeta();
    logger.setLevel(meta.logLevel);

    const runtimeManager = new RuntimeManager();
    const initial = runtimeManager.ensure();
    if (initial.runtime) {
      logger.info("Starting NiCE Cognigy Plugin", {
        name: meta.serverName,
        version: meta.serverVersion,
      });
    } else {
      // Degraded-mode boot: no credentials yet. The server still starts and
      // exposes the full tool list; each tool call re-checks for credentials
      // (env var or the on-disk cognigy-setup fallback file) so running
      // `cognigy-setup` mid-session takes effect immediately, no restart.
      logger.warn(
        "Starting NiCE Cognigy Plugin in degraded mode — no Cognigy credentials configured yet",
        {
          name: meta.serverName,
          version: meta.serverVersion,
          missing: initial.missing,
        },
      );
    }

    const server = new Server(
      { name: meta.serverName, version: meta.serverVersion },
      {
        capabilities: { tools: {} },
        instructions: SERVER_INSTRUCTIONS,
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      logger.info(`Tool call received: ${name}`);

      const { runtime, missing } = runtimeManager.ensure();
      if (!runtime) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "not_configured",
                message: buildSetupGuidance(missing),
              }),
            },
          ],
        };
      }

      const rateLimitKey = runtime.config.apiKey.substring(0, 10);
      if (!runtime.rateLimiter.check(rateLimitKey)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Rate limit exceeded" }),
            },
          ],
        };
      }

      try {
        const result = await runtime.toolHandlers.handleToolCall(
          name,
          args || {},
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (error: any) {
        logger.error("Tool execution error", {
          tool: name,
          error: error.message,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: error.message,
                status: error.status,
                code: error.code,
                traceId: error.traceId,
              }),
            },
          ],
          isError: true,
        };
      }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("NiCE Cognigy Plugin started successfully");

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      // `finally` so a failing close can never strand the process: the guard
      // above means a later signal won't retry, and this runs as an event
      // listener, where a rejection would otherwise be unhandled.
      try {
        logger.info("Shutting down NiCE Cognigy Plugin");
        runtimeManager.destroy();
        await server.close();
      } catch (error: any) {
        logger.error("Error during shutdown", { error: error?.message });
      } finally {
        process.exit(0);
      }
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    // StdioServerTransport never listens for stdin ending — if the parent
    // (Claude Code, or an `npx` wrapper) tears down the connection by closing
    // the pipes instead of sending a signal, nothing here would otherwise
    // notice. Without this, the RateLimiter's setInterval keeps the event
    // loop alive forever, turning every such disconnect into an orphaned,
    // memory-holding process. Treat stdin ending as a disconnect too.
    process.stdin.on("end", shutdown);
    process.stdin.on("close", shutdown);
  } catch (error: any) {
    logger.error("Failed to start MCP Server", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

main();
