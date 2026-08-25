/**
 * Tests for degraded-mode boot: RuntimeManager builds the API client/tool
 * handlers lazily, re-checking for credentials (env var or the on-disk
 * cognigy-setup fallback file) until they appear — so a mid-session
 * `cognigy-setup` run takes effect without restarting the MCP server.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

// Mock the on-disk fallback so tests never touch the real ~/.cognigy-plugin.
const readUserConfigFile = jest.fn<() => Record<string, string>>(() => ({}));
jest.unstable_mockModule("../userConfigFile.js", () => ({
  readUserConfigFile,
  writeUserConfigFile: jest.fn(),
  USER_CONFIG_FILE: "/fake/.cognigy-plugin/config.json",
  USER_CONFIG_DIR: "/fake/.cognigy-plugin",
}));

const { tryLoadConfig, buildSetupGuidance } = await import("../config.js");
const { RuntimeManager } = await import("../runtime.js");

describe("degraded-mode boot", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    delete process.env.COGNIGY_API_BASE_URL;
    delete process.env.COGNIGY_API_KEY;
    readUserConfigFile.mockReset();
    readUserConfigFile.mockReturnValue({});
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  describe("tryLoadConfig", () => {
    it("does not throw and reports missing vars when nothing is configured", () => {
      const { config, missing } = tryLoadConfig();
      expect(config).toBeNull();
      expect(missing).toEqual(
        expect.arrayContaining(["COGNIGY_API_BASE_URL", "COGNIGY_API_KEY"]),
      );
    });

    it("resolves once env vars are set", () => {
      process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
      process.env.COGNIGY_API_KEY = "test-key";
      const { config, missing } = tryLoadConfig();
      expect(missing).toEqual([]);
      expect(config?.apiBaseUrl).toBe("https://api-trial.cognigy.ai");
      expect(config?.apiKey).toBe("test-key");
    });

    it("reports only COGNIGY_API_KEY missing when the base URL is present", () => {
      process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
      delete process.env.COGNIGY_API_KEY;
      const { config, missing } = tryLoadConfig();
      expect(config).toBeNull();
      expect(missing).toEqual(["COGNIGY_API_KEY"]);
    });

    it("reports only COGNIGY_API_BASE_URL missing when the key is present", () => {
      delete process.env.COGNIGY_API_BASE_URL;
      process.env.COGNIGY_API_KEY = "test-key";
      const { config, missing } = tryLoadConfig();
      expect(config).toBeNull();
      expect(missing).toEqual(["COGNIGY_API_BASE_URL"]);
    });
  });

  describe("buildSetupGuidance", () => {
    it("mentions cognigy-setup and the env vars", () => {
      const message = buildSetupGuidance([
        "COGNIGY_API_BASE_URL",
        "COGNIGY_API_KEY",
      ]);
      expect(message).toMatch(/cognigy-setup/);
      expect(message).toMatch(/COGNIGY_API_BASE_URL/);
      expect(message).toMatch(/COGNIGY_API_KEY/);
    });

    it("mentions only the missing var when just COGNIGY_API_KEY is absent", () => {
      const message = buildSetupGuidance(["COGNIGY_API_KEY"]);
      expect(message).toMatch(/Missing: COGNIGY_API_KEY\./);
      expect(message).not.toMatch(
        /Missing: COGNIGY_API_KEY, COGNIGY_API_BASE_URL/,
      );
    });

    it("mentions only the missing var when just COGNIGY_API_BASE_URL is absent", () => {
      const message = buildSetupGuidance(["COGNIGY_API_BASE_URL"]);
      expect(message).toMatch(/Missing: COGNIGY_API_BASE_URL\./);
    });

    it("falls back to listing both vars when called with an empty missing array (defensive/unreachable-in-practice branch)", () => {
      const message = buildSetupGuidance([]);
      expect(message).toMatch(
        /Missing: COGNIGY_API_BASE_URL, COGNIGY_API_KEY\./,
      );
    });
  });

  describe("RuntimeManager", () => {
    it("boots without throwing and returns null runtime when unconfigured", () => {
      const manager = new RuntimeManager();
      const result = manager.ensure();
      expect(result.runtime).toBeNull();
      expect(result.missing.length).toBeGreaterThan(0);
      expect(manager.isConfigured).toBe(false);
    });

    it("builds a runtime once credentials become available via env vars, without recreating the process", () => {
      const manager = new RuntimeManager();

      // First call: no creds yet -> degraded.
      const first = manager.ensure();
      expect(first.runtime).toBeNull();

      // Simulate `cognigy-setup` running mid-session and exporting env vars
      // for the (still-running) MCP server process.
      process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
      process.env.COGNIGY_API_KEY = "test-key";

      // Second call, same manager instance, no restart: now resolves.
      const second = manager.ensure();
      expect(second.runtime).not.toBeNull();
      expect(second.runtime?.config.apiKey).toBe("test-key");
      expect(manager.isConfigured).toBe(true);

      manager.destroy();
    });

    it("picks up credentials written to the on-disk cognigy-setup fallback file mid-session", () => {
      const manager = new RuntimeManager();

      const first = manager.ensure();
      expect(first.runtime).toBeNull();

      // Simulate `cognigy-setup` writing the fallback file after boot.
      readUserConfigFile.mockReturnValue({
        COGNIGY_API_BASE_URL: "https://api-dev.cognigy.ai",
        COGNIGY_API_KEY: "file-key",
      });

      const second = manager.ensure();
      expect(second.runtime).not.toBeNull();
      expect(second.runtime?.config.apiKey).toBe("file-key");

      manager.destroy();
    });

    it("reuses the same runtime instance once configured (does not rebuild per call)", () => {
      process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
      process.env.COGNIGY_API_KEY = "test-key";

      const manager = new RuntimeManager();
      const first = manager.ensure().runtime;
      const second = manager.ensure().runtime;
      expect(first).toBe(second);

      manager.destroy();
    });

    it("reports only COGNIGY_API_KEY missing when only the base URL is set", () => {
      process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
      delete process.env.COGNIGY_API_KEY;

      const manager = new RuntimeManager();
      const result = manager.ensure();
      expect(result.runtime).toBeNull();
      expect(result.missing).toEqual(["COGNIGY_API_KEY"]);
      expect(manager.isConfigured).toBe(false);
    });

    it("reports only COGNIGY_API_BASE_URL missing when only the key is set", () => {
      delete process.env.COGNIGY_API_BASE_URL;
      process.env.COGNIGY_API_KEY = "test-key";

      const manager = new RuntimeManager();
      const result = manager.ensure();
      expect(result.runtime).toBeNull();
      expect(result.missing).toEqual(["COGNIGY_API_BASE_URL"]);
      expect(manager.isConfigured).toBe(false);
    });

    it("does not double-build the runtime when overlapping tool calls race the first successful configure", async () => {
      // Regression test for the "no race" invariant: ensure() is fully
      // synchronous (no await inside it), so even though several tool-call
      // handlers may call it "concurrently" (queued on the microtask queue),
      // Node's single-threaded event loop guarantees the first call's
      // synchronous `this.runtime = ...` assignment completes before the
      // next call's ensure() body starts running. If a future refactor made
      // ensure() async (e.g. to await a keychain read), this test would catch
      // the reintroduced race by observing more than one distinct runtime.
      process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
      process.env.COGNIGY_API_KEY = "test-key";

      const manager = new RuntimeManager();

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          Promise.resolve().then(() => manager.ensure()),
        ),
      );

      const runtimes = results.map((r) => r.runtime);
      expect(runtimes[0]).not.toBeNull();
      expect(runtimes.every((runtime) => runtime === runtimes[0])).toBe(true);
      // Same invariant holds for the resources the runtime owns.
      const rateLimiters = new Set(runtimes.map((r) => r!.rateLimiter));
      const apiClients = new Set(runtimes.map((r) => r!.apiClient));
      expect(rateLimiters.size).toBe(1);
      expect(apiClients.size).toBe(1);

      manager.destroy();
    });
  });
});
