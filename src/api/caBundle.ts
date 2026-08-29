/**
 * Corporate TLS-inspecting proxy support ("truststore equivalent").
 *
 * cognigy-vibe (the Python sibling project) uses the `truststore` package to
 * inject the OS trust store into every TLS connection, so it "just works"
 * behind Fortinet/Zscaler/NICE SSL-inspecting proxies. Node has no built-in
 * equivalent, and the idiomatic Node fix (`win-ca` / `mac-ca`) would add a
 * runtime dependency to a project that deliberately keeps a 4-package
 * footprint. This module replicates the ergonomics without adding a
 * dependency:
 *
 *   1. Respect an explicit CA bundle if the user (or their shell profile)
 *      already sets NODE_EXTRA_CA_CERTS / SSL_CERT_FILE / REQUESTS_CA_BUNDLE.
 *      Node's own NODE_EXTRA_CA_CERTS handling only applies at process boot
 *      (before any module import), so a plugin launched via `npx` sees it too
 *      late for Node's native handling to kick in reliably — we load it into
 *      the axios agent explicitly instead.
 *   2. Otherwise probe a short list of well-known combined-bundle locations
 *      (e.g. the `/tmp/combined-ca.pem` some corporate shell profiles
 *      generate on every shell start) and known Linux system bundle paths.
 *   3. On macOS, best-effort export the login+System keychain roots via
 *      `security find-certificate -a -p` (a built-in macOS CLI, no new
 *      dependency) and cache the result in-process.
 *   4. If nothing is found, fall back to Node's default trust store
 *      (`tls.rootCertificates`) — behavior is unchanged from today.
 *
 * The whole thing is intentionally side-effect-light and pure with respect to
 * its dependencies (env + fs + exec are all passed in) so it is trivially
 * testable without touching the real filesystem or spawning a real process.
 */
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import * as tls from "tls";
import { logger } from "../utils/logger.js";

export type CaSource =
  | "env:NODE_EXTRA_CA_CERTS"
  | "env:SSL_CERT_FILE"
  | "env:REQUESTS_CA_BUNDLE"
  | "probe:combined-bundle"
  | "probe:system-bundle"
  | "macos-keychain"
  | "node-default";

export interface CaBundleResult {
  /** CA certificates to pass to `https.Agent({ ca })`, or undefined to use Node's built-in defaults. */
  ca: string[] | undefined;
  /** Where the CA material came from, for debug logging. */
  source: CaSource;
}

export interface CaBundleDeps {
  env: NodeJS.ProcessEnv;
  /** Reads a file as utf-8 text; throws (or returns undefined) if missing/unreadable. */
  readFile: (path: string) => string | undefined;
  /** Returns true if the path exists and is readable. */
  exists: (path: string) => boolean;
  /** Platform string, as in `process.platform`. */
  platform: NodeJS.Platform;
  /** Runs `security find-certificate -a -p` (or an injected fake) for macOS keychain export. */
  execFindCertificate: () => string | undefined;
}

// Common locations for a combined/corporate CA bundle. Order matters: the
// explicit env vars a user might set for exactly this purpose come first,
// then well-known system bundle paths on Linux.
const ENV_CANDIDATES: Array<{ key: string; source: CaSource }> = [
  { key: "NODE_EXTRA_CA_CERTS", source: "env:NODE_EXTRA_CA_CERTS" },
  { key: "SSL_CERT_FILE", source: "env:SSL_CERT_FILE" },
  { key: "REQUESTS_CA_BUNDLE", source: "env:REQUESTS_CA_BUNDLE" },
];

const COMBINED_BUNDLE_PATHS = ["/tmp/combined-ca.pem"];

const SYSTEM_BUNDLE_PATHS = [
  // Debian/Ubuntu
  "/etc/ssl/certs/ca-certificates.crt",
  // RHEL/CentOS/Fedora
  "/etc/pki/tls/certs/ca-bundle.crt",
  "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
  // Alpine
  "/etc/ssl/cert.pem",
];

/** Splits a PEM bundle file's contents into individual `-----BEGIN CERTIFICATE-----` blocks. */
function splitPemCertificates(pem: string): string[] {
  const matches = pem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
  );
  return matches ?? [];
}

export const defaultCaBundleDeps: CaBundleDeps = {
  env: process.env,
  readFile: (path: string) => {
    try {
      return readFileSync(path, "utf-8");
    } catch {
      return undefined;
    }
  },
  exists: (path: string) => {
    try {
      return existsSync(path);
    } catch {
      return false;
    }
  },
  platform: process.platform,
  execFindCertificate: () => {
    try {
      return execFileSync(
        "security",
        [
          "find-certificate",
          "-a",
          "-p",
          "/System/Library/Keychains/SystemRootCertificates.keychain",
        ],
        { encoding: "utf-8", timeout: 5000 },
      );
    } catch {
      return undefined;
    }
  },
};

let cachedResult: CaBundleResult | undefined;

/**
 * Resolves the CA bundle to use for outbound HTTPS requests, in the
 * preference order documented at the top of this file. Pure with respect to
 * its `deps` argument — pass a fake for tests.
 */
export function resolveCaBundle(
  deps: CaBundleDeps = defaultCaBundleDeps,
): CaBundleResult {
  for (const { key, source } of ENV_CANDIDATES) {
    const path = deps.env[key];
    if (!path) continue;
    const contents = deps.exists(path) ? deps.readFile(path) : undefined;
    if (contents) {
      const certs = splitPemCertificates(contents);
      if (certs.length > 0) {
        logger.debug(`CA trust: using ${source} (${path})`);
        return { ca: certs, source };
      }
    }
    logger.warn(
      `CA trust: ${key}=${path} is set but unreadable or empty, ignoring`,
    );
  }

  for (const path of COMBINED_BUNDLE_PATHS) {
    if (!deps.exists(path)) continue;
    const contents = deps.readFile(path);
    if (!contents) continue;
    const certs = splitPemCertificates(contents);
    if (certs.length > 0) {
      logger.debug(`CA trust: using probe:combined-bundle (${path})`);
      return { ca: certs, source: "probe:combined-bundle" };
    }
  }

  for (const path of SYSTEM_BUNDLE_PATHS) {
    if (!deps.exists(path)) continue;
    const contents = deps.readFile(path);
    if (!contents) continue;
    const certs = splitPemCertificates(contents);
    if (certs.length > 0) {
      logger.debug(`CA trust: using probe:system-bundle (${path})`);
      return { ca: certs, source: "probe:system-bundle" };
    }
  }

  if (deps.platform === "darwin") {
    const exported = deps.execFindCertificate();
    if (exported) {
      const certs = splitPemCertificates(exported);
      if (certs.length > 0) {
        logger.debug(
          `CA trust: using macos-keychain (${certs.length} certs exported via security(1))`,
        );
        // Combine with Node's own defaults: the keychain export is roots
        // only, and we don't want to drop Node's bundled intermediates.
        return {
          ca: [...tls.rootCertificates, ...certs],
          source: "macos-keychain",
        };
      }
    }
  }

  logger.debug("CA trust: no corporate CA bundle found, using Node defaults");
  return { ca: undefined, source: "node-default" };
}

/**
 * Cached variant of {@link resolveCaBundle} for use at client-construction
 * time — avoids re-reading files / re-shelling out to `security` on every
 * `CognigyApiClient` instantiation within a single process lifetime.
 */
export function getCachedCaBundle(
  deps: CaBundleDeps = defaultCaBundleDeps,
): CaBundleResult {
  if (!cachedResult) {
    cachedResult = resolveCaBundle(deps);
  }
  return cachedResult;
}

/** Test-only: clears the in-process cache. */
export function __resetCaBundleCacheForTests(): void {
  cachedResult = undefined;
}
