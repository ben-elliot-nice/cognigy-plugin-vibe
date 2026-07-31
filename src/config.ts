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
 *
 * NiCE CXone hosts (e.g. https://cognigy-api-au1.nicecxone.com) already carry
 * the "api-" label and don't end in ".cognigy.ai", so the condition below
 * leaves them untouched (tolerated, not mangled) rather than double-prefixing
 * them or misidentifying them as a bare UI URL.
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
 * Match the "api-" hostname label regardless of any leading subdomain
 * prefix, so both plain Cognigy SaaS hosts and NiCE CXone hosts resolve:
 *   api-{env}.cognigy.ai            (prefix "")
 *   cognigy-api-{env}.nicecxone.com (prefix "cognigy-")
 * The lookbehind-free form below requires "api-" to sit at the start of the
 * hostname or immediately after a hyphen, so it won't misfire on unrelated
 * substrings like "myapi-foo.example.com".
 */
const API_HOSTNAME_LABEL = /^(.*-)?api-(.+)$/;

/**
 * Derive a sibling base URL from the API base URL by swapping the "api-"
 * hostname label for `targetLabel`, preserving any subdomain prefix before
 * it (e.g. the "cognigy-" in NiCE CXone hosts) *and* any explicit port
 * (e.g. ":8443" on a non-standard-port trial host).
 *
 * Examples:
 *   https://api-{env}.cognigy.ai            -> https://{targetLabel}-{env}.cognigy.ai
 *   https://cognigy-api-{env}.nicecxone.com -> https://cognigy-{targetLabel}-{env}.nicecxone.com
 *   https://api-{env}.cognigy.ai:8443       -> https://{targetLabel}-{env}.cognigy.ai:8443
 *
 * If the host carries no "api-" label at all (e.g. a bespoke on-prem host
 * that doesn't follow the convention), there is nothing to swap — the
 * sibling can't be derived, so we return the API URL unchanged and log a
 * warning rather than guess. Callers who hit this should set the relevant
 * COGNIGY_*_BASE_URL env var explicitly.
 */
function deriveSiblingBaseUrl(apiBaseUrl: string, targetLabel: string): string {
  try {
    const url = new URL(apiBaseUrl);
    const match = url.hostname.match(API_HOSTNAME_LABEL);
    if (match) {
      const prefix = match[1] ?? "";
      const port = url.port ? `:${url.port}` : "";
      return `${url.protocol}//${prefix}${targetLabel}-${match[2]}${port}`;
    }
    console.error(
      `[config] Could not derive ${targetLabel} URL from "${apiBaseUrl}": ` +
        `hostname has no "api-" label. Using the API URL unchanged — set ` +
        `the corresponding COGNIGY_*_BASE_URL env var explicitly if this is wrong.`,
    );
  } catch {
    // fall through
  }
  return apiBaseUrl.replace(/\/(.*-)?api-/, `/$1${targetLabel}-`);
}

/**
 * Derive the endpoint base URL from the API base URL.
 * Pattern: https://api-{env}.cognigy.ai -> https://endpoint-{env}.cognigy.ai
 * Also handles NiCE CXone hosts: https://cognigy-api-{env}.nicecxone.com ->
 * https://cognigy-endpoint-{env}.nicecxone.com
 */
function deriveEndpointBaseUrl(apiBaseUrl: string): string {
  return deriveSiblingBaseUrl(apiBaseUrl, "endpoint");
}

/**
 * Derive the static-files base URL from the API base URL.
 * Pattern: https://api-{env}.cognigy.ai -> https://static-{env}.cognigy.ai
 * Also handles NiCE CXone hosts: https://cognigy-api-{env}.nicecxone.com ->
 * https://cognigy-static-{env}.nicecxone.com
 */
function deriveStaticFilesBaseUrl(apiBaseUrl: string): string {
  return deriveSiblingBaseUrl(apiBaseUrl, "static");
}

/**
 * Derive the webchat demo base URL from the API base URL.
 * Pattern: https://api-{env}.cognigy.ai -> https://webchat-{env}.cognigy.ai
 * Also handles NiCE CXone hosts: https://cognigy-api-{env}.nicecxone.com ->
 * https://cognigy-webchat-{env}.nicecxone.com
 */
function deriveWebchatBaseUrl(apiBaseUrl: string): string {
  return deriveSiblingBaseUrl(apiBaseUrl, "webchat");
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
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
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

  if (!apiBaseUrl) {
    throw new Error(
      `COGNIGY_API_BASE_URL is not set. Provide it via the plugin install prompt, ` +
        `or run "npx -y -p @cognigy/plugin-engine cognigy-setup" to write ${USER_CONFIG_FILE}.`,
    );
  }

  if (!apiKey) {
    throw new Error(
      `COGNIGY_API_KEY is not set. Provide it via the plugin install prompt, ` +
        `or run "npx -y -p @cognigy/plugin-engine cognigy-setup" to write ${USER_CONFIG_FILE}.`,
    );
  }

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

  return {
    apiBaseUrl: normalizedApiBaseUrl,
    endpointBaseUrl,
    webchatBaseUrl,
    staticFilesBaseUrl,
    apiKey,
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
    rateLimit: {
      maxRequests: parseIntWithDefault(
        process.env.RATE_LIMIT_MAX_REQUESTS,
        100,
      ),
      windowMs: parseIntWithDefault(process.env.RATE_LIMIT_WINDOW_MS, 60000),
    },
  };
}
