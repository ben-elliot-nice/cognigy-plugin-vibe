/**
 * Configuration for NiCE Cognigy Plugin
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readUserConfigFile, USER_CONFIG_FILE } from "./userConfigFile.js";

export interface Config {
  apiBaseUrl: string;
  endpointBaseUrl: string;
  webchatBaseUrl: string;
  staticFilesBaseUrl: string;
  apiKey: string;
  serverName: string;
  serverVersion: string;
  logLevel: "debug" | "info" | "warn" | "error";
  rateLimit: {
    maxRequests: number;
    windowMs: number;
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function getPackageVersion(): string {
  try {
    const packageJsonPath = join(__dirname, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      version?: string;
    };
    return packageJson.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const PACKAGE_VERSION = getPackageVersion();

/**
 * Normalise the API base URL so it always points to the API host.
 * Users may supply the bare UI URL (e.g. https://dev.cognigy.ai) instead of the
 * API URL (https://api-dev.cognigy.ai).  We detect this and prepend "api-".
 */
function normalizeApiBaseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (
      !url.hostname.startsWith("api-") &&
      url.hostname.endsWith(".cognigy.ai")
    ) {
      url.hostname = `api-${url.hostname}`;
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    // fall through
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Derive the endpoint base URL from the API base URL.
 * Pattern: https://api-{env}.cognigy.ai -> https://endpoint-{env}.cognigy.ai
 */
function deriveEndpointBaseUrl(apiBaseUrl: string): string {
  try {
    const url = new URL(apiBaseUrl);
    const match = url.hostname.match(/^api-(.+)$/);
    if (match) {
      return `${url.protocol}//endpoint-${match[1]}`;
    }
  } catch {
    // fall through
  }
  return apiBaseUrl.replace(/\/api-/, "/endpoint-");
}

/**
 * Derive the static-files base URL from the API base URL.
 * Pattern: https://api-{env}.cognigy.ai -> https://static-{env}.cognigy.ai
 */
function deriveStaticFilesBaseUrl(apiBaseUrl: string): string {
  try {
    const url = new URL(apiBaseUrl);
    const match = url.hostname.match(/^api-(.+)$/);
    if (match) {
      return `${url.protocol}//static-${match[1]}`;
    }
  } catch {
    // fall through
  }
  return apiBaseUrl.replace(/\/api-/, "/static-");
}

/**
 * Derive the webchat demo base URL from the API base URL.
 * Pattern: https://api-{env}.cognigy.ai -> https://webchat-{env}.cognigy.ai
 */
function deriveWebchatBaseUrl(apiBaseUrl: string): string {
  try {
    const url = new URL(apiBaseUrl);
    const match = url.hostname.match(/^api-(.+)$/);
    if (match) {
      return `${url.protocol}//webchat-${match[1]}`;
    }
  } catch {
    // fall through
  }
  return apiBaseUrl.replace(/\/api-/, "/webchat-");
}

const VALID_LOG_LEVELS = new Set<string>(["debug", "info", "warn", "error"]);

function parseIntWithDefault(
  envVar: string | undefined,
  defaultValue: number,
): number {
  if (!envVar) return defaultValue;
  const parsed = parseInt(envVar, 10);
  if (Number.isNaN(parsed)) {
    console.error(
      `[config] Invalid integer "${envVar}", using default ${defaultValue}`,
    );
    return defaultValue;
  }
  return parsed;
}

/**
 * Server metadata that never requires API credentials — safe to compute
 * during a degraded (no-credentials) boot so the server name/version/log
 * level are still correct even before `COGNIGY_API_BASE_URL`/`COGNIGY_API_KEY`
 * are configured.
 */
export interface ServerMeta {
  serverName: string;
  serverVersion: string;
  logLevel: Config["logLevel"];
}

export function loadServerMeta(): ServerMeta {
  return {
    serverName: process.env.MCP_SERVER_NAME || "cognigy-api-mcp",
    serverVersion: process.env.MCP_SERVER_VERSION || PACKAGE_VERSION,
    logLevel: (() => {
      const raw = process.env.LOG_LEVEL || "info";
      if (!VALID_LOG_LEVELS.has(raw)) {
        console.error(
          `[config] Invalid LOG_LEVEL "${raw}", falling back to "info"`,
        );
        return "info" as Config["logLevel"];
      }
      return raw as Config["logLevel"];
    })(),
  };
}

function buildConfig(apiBaseUrl: string, apiKey: string): Config {
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);

  const endpointBaseUrl =
    process.env.COGNIGY_ENDPOINT_BASE_URL ||
    deriveEndpointBaseUrl(normalizedApiBaseUrl);

  const webchatBaseUrl =
    process.env.COGNIGY_WEBCHAT_BASE_URL ||
    deriveWebchatBaseUrl(normalizedApiBaseUrl);

  const staticFilesBaseUrl =
    process.env.COGNIGY_STATIC_FILES_BASE_URL ||
    deriveStaticFilesBaseUrl(normalizedApiBaseUrl);

  const meta = loadServerMeta();

  return {
    apiBaseUrl: normalizedApiBaseUrl,
    endpointBaseUrl,
    webchatBaseUrl,
    staticFilesBaseUrl,
    apiKey,
    serverName: meta.serverName,
    serverVersion: meta.serverVersion,
    logLevel: meta.logLevel,
    rateLimit: {
      maxRequests: parseIntWithDefault(
        process.env.RATE_LIMIT_MAX_REQUESTS,
        100,
      ),
      windowMs: parseIntWithDefault(process.env.RATE_LIMIT_WINDOW_MS, 60000),
    },
  };
}

export interface TryLoadConfigResult {
  /** Fully-resolved config, or `null` when credentials are missing. */
  config: Config | null;
  /** Env var names that are still unset (checked against both env and the
   * on-disk `cognigy-setup` fallback file). Empty when `config` is non-null. */
  missing: string[];
}

/**
 * Non-throwing config load. Re-reads environment variables and the on-disk
 * `cognigy-setup` fallback file (see `userConfigFile.ts`) on every call, so
 * callers that poll this (e.g. a degraded-mode MCP server re-checking before
 * each tool call) pick up credentials written by a `cognigy-setup` run that
 * happened *after* the server booted — no restart required.
 */
export function tryLoadConfig(): TryLoadConfigResult {
  // Environment variables win (terminal install stores them via userConfig /
  // keychain). Only when one is missing do we consult the on-disk fallback
  // written by the `cognigy-setup` CLI — this is the path GUI users take
  // when their installer never prompted for credentials.
  const fileConfig =
    process.env.COGNIGY_API_BASE_URL && process.env.COGNIGY_API_KEY
      ? {}
      : readUserConfigFile();

  const apiBaseUrl =
    process.env.COGNIGY_API_BASE_URL || fileConfig.COGNIGY_API_BASE_URL;
  const apiKey = process.env.COGNIGY_API_KEY || fileConfig.COGNIGY_API_KEY;

  const missing: string[] = [];
  if (!apiBaseUrl) missing.push("COGNIGY_API_BASE_URL");
  if (!apiKey) missing.push("COGNIGY_API_KEY");

  if (missing.length > 0) {
    return { config: null, missing };
  }

  return { config: buildConfig(apiBaseUrl!, apiKey!), missing: [] };
}

/**
 * Human-readable, actionable guidance for a tool call made while the server
 * is running in degraded mode (no credentials configured yet). Returned to
 * the LLM/user instead of a hard error/crash.
 */
export function buildSetupGuidance(missing: string[]): string {
  const missingList =
    missing.length > 0
      ? missing.join(", ")
      : "COGNIGY_API_BASE_URL, COGNIGY_API_KEY";
  return [
    "Cognigy API credentials are not configured yet, so this tool cannot run.",
    `Missing: ${missingList}.`,
    "",
    "To fix this, either:",
    "  1. Run: npx -y -p @cognigy/plugin-engine cognigy-setup",
    `     (writes credentials to ${USER_CONFIG_FILE})`,
    "  2. Set the COGNIGY_API_BASE_URL and COGNIGY_API_KEY environment variables",
    "     for this MCP server process.",
    "",
    "No restart is needed after running cognigy-setup — the next tool call will",
    "pick up the new credentials automatically.",
  ].join("\n");
}

/**
 * Load configuration from environment variables. Throws when credentials are
 * missing — use `tryLoadConfig()` for a non-throwing variant (e.g. to boot in
 * degraded mode without credentials).
 */
export function loadConfig(): Config {
  const { config, missing } = tryLoadConfig();

  if (!config) {
    if (missing.includes("COGNIGY_API_BASE_URL")) {
      throw new Error(
        `COGNIGY_API_BASE_URL is not set. Provide it via the plugin install prompt, ` +
          `or run "npx -y -p @cognigy/plugin-engine cognigy-setup" to write ${USER_CONFIG_FILE}.`,
      );
    }
    throw new Error(
      `COGNIGY_API_KEY is not set. Provide it via the plugin install prompt, ` +
        `or run "npx -y -p @cognigy/plugin-engine cognigy-setup" to write ${USER_CONFIG_FILE}.`,
    );
  }

  return config;
}
