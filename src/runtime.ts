/**
 * Lazily-built runtime for the parts of the server that need Cognigy API
 * credentials (the API client, tool handlers, and the rate limiter).
 *
 * The MCP server boots successfully even when credentials are missing
 * (degraded-mode boot) so `ListTools` always works. `RuntimeManager.ensure()`
 * is called again on every tool call and re-reads config from scratch each
 * time it hasn't succeeded yet, so credentials written mid-session by
 * `cognigy-setup` (env var or the on-disk fallback file) take effect on the
 * very next tool call — no server restart required.
 */
import { Config, tryLoadConfig } from "./config.js";
import { CognigyApiClient } from "./api/client.js";
import { ToolHandlers } from "./tools/handlers.js";
import { RateLimiter } from "./utils/rateLimiter.js";

export interface Runtime {
  config: Config;
  apiClient: CognigyApiClient;
  toolHandlers: ToolHandlers;
  rateLimiter: RateLimiter;
}

export interface EnsureResult {
  /** Non-null once credentials are available. */
  runtime: Runtime | null;
  /** Env var names still missing; empty once `runtime` is non-null. */
  missing: string[];
}

export class RuntimeManager {
  private runtime: Runtime | null = null;

  /**
   * Returns the live runtime, building it the first time credentials become
   * available. Once built, the same runtime (and its api client/handlers) is
   * reused for the lifetime of the process — only the not-yet-configured
   * path re-reads config on every call.
   */
  ensure(): EnsureResult {
    if (this.runtime) {
      return { runtime: this.runtime, missing: [] };
    }

    const { config, missing } = tryLoadConfig();
    if (!config) {
      return { runtime: null, missing };
    }

    const apiClient = new CognigyApiClient({
      baseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
    });
    const toolHandlers = new ToolHandlers(
      apiClient,
      config.endpointBaseUrl,
      config.webchatBaseUrl,
      config.staticFilesBaseUrl,
    );
    const rateLimiter = new RateLimiter(config.rateLimit);

    this.runtime = { config, apiClient, toolHandlers, rateLimiter };
    return { runtime: this.runtime, missing: [] };
  }

  /** True once credentials have been found and the runtime built. */
  get isConfigured(): boolean {
    return this.runtime !== null;
  }

  /** Release resources (e.g. the rate limiter's cleanup interval) on shutdown. */
  destroy(): void {
    this.runtime?.rateLimiter.destroy();
  }
}
