/**
 * Tests for corporate CA trust-store resolution (src/api/caBundle.ts).
 */
import { describe, it, expect } from "@jest/globals";
import { resolveCaBundle, CaBundleDeps } from "../api/caBundle.js";

const FAKE_CERT = (label: string) =>
  `-----BEGIN CERTIFICATE-----\n${label}\n-----END CERTIFICATE-----`;

function makeDeps(overrides: Partial<CaBundleDeps> = {}): CaBundleDeps {
  return {
    env: {},
    readFile: () => undefined,
    exists: () => false,
    platform: "linux",
    execFindCertificate: () => undefined,
    ...overrides,
  };
}

describe("resolveCaBundle", () => {
  it("falls back to Node defaults when nothing is configured or found", () => {
    const result = resolveCaBundle(makeDeps());
    expect(result.ca).toBeUndefined();
    expect(result.source).toBe("node-default");
  });

  it("uses NODE_EXTRA_CA_CERTS when set and readable", () => {
    const bundle = FAKE_CERT("corp-root");
    const deps = makeDeps({
      env: { NODE_EXTRA_CA_CERTS: "/fake/corp-ca.pem" },
      exists: (path) => path === "/fake/corp-ca.pem",
      readFile: (path) => (path === "/fake/corp-ca.pem" ? bundle : undefined),
    });

    const result = resolveCaBundle(deps);
    expect(result.source).toBe("env:NODE_EXTRA_CA_CERTS");
    expect(result.ca).toEqual([bundle]);
  });

  it("falls back through SSL_CERT_FILE then REQUESTS_CA_BUNDLE in order", () => {
    const bundle = FAKE_CERT("via-requests-ca-bundle");
    const deps = makeDeps({
      env: {
        // SSL_CERT_FILE points somewhere unreadable; REQUESTS_CA_BUNDLE should win.
        SSL_CERT_FILE: "/fake/missing.pem",
        REQUESTS_CA_BUNDLE: "/fake/requests-ca.pem",
      },
      exists: (path) => path === "/fake/requests-ca.pem",
      readFile: (path) =>
        path === "/fake/requests-ca.pem" ? bundle : undefined,
    });

    const result = resolveCaBundle(deps);
    expect(result.source).toBe("env:REQUESTS_CA_BUNDLE");
    expect(result.ca).toEqual([bundle]);
  });

  it("uses the combined-bundle probe path (e.g. /tmp/combined-ca.pem) when present", () => {
    const bundle = FAKE_CERT("combined-bundle-root");
    const deps = makeDeps({
      exists: (path) => path === "/tmp/combined-ca.pem",
      readFile: (path) =>
        path === "/tmp/combined-ca.pem" ? bundle : undefined,
    });

    const result = resolveCaBundle(deps);
    expect(result.source).toBe("probe:combined-bundle");
    expect(result.ca).toEqual([bundle]);
  });

  it("uses a known Linux system bundle path when present", () => {
    const bundle = FAKE_CERT("debian-root") + FAKE_CERT("debian-root-2");
    const deps = makeDeps({
      exists: (path) => path === "/etc/ssl/certs/ca-certificates.crt",
      readFile: (path) =>
        path === "/etc/ssl/certs/ca-certificates.crt" ? bundle : undefined,
    });

    const result = resolveCaBundle(deps);
    expect(result.source).toBe("probe:system-bundle");
    expect(result.ca?.length).toBe(2);
  });

  it("exports the macOS keychain via `security find-certificate` when on darwin and nothing else found", () => {
    const bundle = FAKE_CERT("macos-root");
    const deps = makeDeps({
      platform: "darwin",
      execFindCertificate: () => bundle,
    });

    const result = resolveCaBundle(deps);
    expect(result.source).toBe("macos-keychain");
    // Combined with Node's own root store, not replacing it.
    expect(result.ca?.includes(bundle)).toBe(true);
    expect(result.ca!.length).toBeGreaterThan(1);
  });

  it("does not shell out to `security` on non-macOS platforms", () => {
    let called = false;
    const deps = makeDeps({
      platform: "linux",
      execFindCertificate: () => {
        called = true;
        return FAKE_CERT("should-not-be-used");
      },
    });

    resolveCaBundle(deps);
    expect(called).toBe(false);
  });

  it("ignores an env var pointing at a missing/unreadable file and falls through", () => {
    const deps = makeDeps({
      env: { NODE_EXTRA_CA_CERTS: "/does/not/exist.pem" },
      exists: () => false,
    });

    const result = resolveCaBundle(deps);
    expect(result.source).toBe("node-default");
    expect(result.ca).toBeUndefined();
  });

  it("ignores a file with no valid PEM certificate blocks", () => {
    const deps = makeDeps({
      env: { NODE_EXTRA_CA_CERTS: "/fake/empty.pem" },
      exists: (path) => path === "/fake/empty.pem",
      readFile: (path) =>
        path === "/fake/empty.pem" ? "not a real cert" : undefined,
    });

    const result = resolveCaBundle(deps);
    expect(result.source).toBe("node-default");
  });
});
