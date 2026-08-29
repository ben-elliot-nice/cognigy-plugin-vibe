/**
 * Tests for corporate CA trust-store resolution (src/api/caBundle.ts).
 */
import { describe, it, expect, afterEach } from "@jest/globals";
import {
  resolveCaBundle,
  getCachedCaBundle,
  __resetCaBundleCacheForTests,
  CaBundleDeps,
} from "../api/caBundle.js";

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

  it("distinguishes 'exists but unreadable' from 'missing' and still falls through", () => {
    const deps = makeDeps({
      env: { NODE_EXTRA_CA_CERTS: "/fake/unreadable.pem" },
      // exists() reports the file is there (e.g. permissions error would
      // still let statSync succeed) but readFile() cannot read it.
      exists: (path) => path === "/fake/unreadable.pem",
      readFile: () => undefined,
    });

    const result = resolveCaBundle(deps);
    expect(result.source).toBe("node-default");
    expect(result.ca).toBeUndefined();
  });

  it("ignores a malformed combined-bundle file and falls through to the system-bundle probe", () => {
    const bundle = FAKE_CERT("system-root");
    const deps = makeDeps({
      exists: (path) =>
        path === "/tmp/combined-ca.pem" ||
        path === "/etc/ssl/certs/ca-certificates.crt",
      readFile: (path) => {
        if (path === "/tmp/combined-ca.pem") return "garbage, not a PEM cert";
        if (path === "/etc/ssl/certs/ca-certificates.crt") return bundle;
        return undefined;
      },
    });

    const result = resolveCaBundle(deps);
    expect(result.source).toBe("probe:system-bundle");
    expect(result.ca).toEqual([bundle]);
  });

  it("skips a malformed system-bundle path and keeps scanning later candidates", () => {
    const bundle = FAKE_CERT("later-system-root");
    const deps = makeDeps({
      exists: (path) =>
        path === "/etc/pki/tls/certs/ca-bundle.crt" ||
        path === "/etc/ssl/cert.pem",
      readFile: (path) => {
        // First candidate in SYSTEM_BUNDLE_PATHS exists but is malformed.
        if (path === "/etc/pki/tls/certs/ca-bundle.crt")
          return "not a real cert";
        if (path === "/etc/ssl/cert.pem") return bundle;
        return undefined;
      },
    });

    const result = resolveCaBundle(deps);
    expect(result.source).toBe("probe:system-bundle");
    expect(result.ca).toEqual([bundle]);
  });

  it("falls through to node-default when the macOS `security` export fails (returns undefined)", () => {
    const deps = makeDeps({
      platform: "darwin",
      execFindCertificate: () => undefined,
    });

    const result = resolveCaBundle(deps);
    expect(result.source).toBe("node-default");
    expect(result.ca).toBeUndefined();
  });

  it("falls through to node-default when the macOS `security` export returns non-PEM garbage", () => {
    const deps = makeDeps({
      platform: "darwin",
      execFindCertificate: () => "not a cert, just garbage output",
    });

    const result = resolveCaBundle(deps);
    expect(result.source).toBe("node-default");
    expect(result.ca).toBeUndefined();
  });

  it("prefers NODE_EXTRA_CA_CERTS over a valid SSL_CERT_FILE when both are set and valid", () => {
    const nodeExtra = FAKE_CERT("node-extra-root");
    const sslCertFile = FAKE_CERT("ssl-cert-file-root");
    const requestsCaBundle = FAKE_CERT("requests-ca-bundle-root");
    const deps = makeDeps({
      env: {
        NODE_EXTRA_CA_CERTS: "/fake/node-extra.pem",
        SSL_CERT_FILE: "/fake/ssl-cert-file.pem",
        REQUESTS_CA_BUNDLE: "/fake/requests-ca.pem",
      },
      exists: () => true,
      readFile: (path) => {
        if (path === "/fake/node-extra.pem") return nodeExtra;
        if (path === "/fake/ssl-cert-file.pem") return sslCertFile;
        if (path === "/fake/requests-ca.pem") return requestsCaBundle;
        return undefined;
      },
    });

    const result = resolveCaBundle(deps);
    expect(result.source).toBe("env:NODE_EXTRA_CA_CERTS");
    expect(result.ca).toEqual([nodeExtra]);
  });

  it("prefers a valid SSL_CERT_FILE over a valid REQUESTS_CA_BUNDLE when NODE_EXTRA_CA_CERTS is unset", () => {
    const sslCertFile = FAKE_CERT("ssl-cert-file-root");
    const requestsCaBundle = FAKE_CERT("requests-ca-bundle-root");
    const deps = makeDeps({
      env: {
        SSL_CERT_FILE: "/fake/ssl-cert-file.pem",
        REQUESTS_CA_BUNDLE: "/fake/requests-ca.pem",
      },
      exists: () => true,
      readFile: (path) => {
        if (path === "/fake/ssl-cert-file.pem") return sslCertFile;
        if (path === "/fake/requests-ca.pem") return requestsCaBundle;
        return undefined;
      },
    });

    const result = resolveCaBundle(deps);
    expect(result.source).toBe("env:SSL_CERT_FILE");
    expect(result.ca).toEqual([sslCertFile]);
  });
});

describe("getCachedCaBundle / __resetCaBundleCacheForTests", () => {
  afterEach(() => {
    __resetCaBundleCacheForTests();
  });

  it("caches the first result and does not re-resolve on subsequent calls", () => {
    const bundleA = FAKE_CERT("bundle-a");
    const depsA = makeDeps({
      env: { NODE_EXTRA_CA_CERTS: "/fake/a.pem" },
      exists: (path) => path === "/fake/a.pem",
      readFile: (path) => (path === "/fake/a.pem" ? bundleA : undefined),
    });
    const bundleB = FAKE_CERT("bundle-b");
    const depsB = makeDeps({
      env: { NODE_EXTRA_CA_CERTS: "/fake/b.pem" },
      exists: (path) => path === "/fake/b.pem",
      readFile: (path) => (path === "/fake/b.pem" ? bundleB : undefined),
    });

    const first = getCachedCaBundle(depsA);
    expect(first.ca).toEqual([bundleA]);

    // Even though depsB would resolve differently, the cached result wins.
    const second = getCachedCaBundle(depsB);
    expect(second).toBe(first);
    expect(second.ca).toEqual([bundleA]);
  });

  it("__resetCaBundleCacheForTests clears the cache so the next call re-resolves", () => {
    const bundleA = FAKE_CERT("bundle-a");
    const depsA = makeDeps({
      env: { NODE_EXTRA_CA_CERTS: "/fake/a.pem" },
      exists: (path) => path === "/fake/a.pem",
      readFile: (path) => (path === "/fake/a.pem" ? bundleA : undefined),
    });
    const bundleB = FAKE_CERT("bundle-b");
    const depsB = makeDeps({
      env: { NODE_EXTRA_CA_CERTS: "/fake/b.pem" },
      exists: (path) => path === "/fake/b.pem",
      readFile: (path) => (path === "/fake/b.pem" ? bundleB : undefined),
    });

    const first = getCachedCaBundle(depsA);
    expect(first.ca).toEqual([bundleA]);

    __resetCaBundleCacheForTests();

    const second = getCachedCaBundle(depsB);
    expect(second.ca).toEqual([bundleB]);
    expect(second).not.toBe(first);
  });
});
