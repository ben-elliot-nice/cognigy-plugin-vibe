import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

// Mock the on-disk fallback so tests never touch the real ~/.cognigy-plugin.
// Default: empty (behaves as if no fallback file exists).
const readUserConfigFile = jest.fn<() => Record<string, string>>(() => ({}));
jest.unstable_mockModule("../userConfigFile.js", () => ({
  readUserConfigFile,
  writeUserConfigFile: jest.fn(),
  USER_CONFIG_FILE: "/fake/.cognigy-plugin/config.json",
  USER_CONFIG_DIR: "/fake/.cognigy-plugin",
}));

const { loadConfig } = await import("../config.js");

describe("loadConfig", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    readUserConfigFile.mockReset();
    readUserConfigFile.mockReturnValue({});
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("throws when COGNIGY_API_BASE_URL is missing", () => {
    delete process.env.COGNIGY_API_BASE_URL;
    process.env.COGNIGY_API_KEY = "test-key";
    expect(() => loadConfig()).toThrow(/COGNIGY_API_BASE_URL is not set/);
  });

  it("throws when COGNIGY_API_KEY is missing", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    delete process.env.COGNIGY_API_KEY;
    expect(() => loadConfig()).toThrow(/COGNIGY_API_KEY is not set/);
  });

  it("normalizes bare UI URL to API URL", () => {
    process.env.COGNIGY_API_BASE_URL = "https://dev.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    const config = loadConfig();
    expect(config.apiBaseUrl).toBe("https://api-dev.cognigy.ai");
  });

  it("keeps already-correct API URL unchanged", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    const config = loadConfig();
    expect(config.apiBaseUrl).toBe("https://api-trial.cognigy.ai");
  });

  it("strips trailing slashes from API URL", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai///";
    process.env.COGNIGY_API_KEY = "test-key";
    const config = loadConfig();
    expect(config.apiBaseUrl).toBe("https://api-trial.cognigy.ai");
  });

  it("derives endpoint URL from API URL", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    const config = loadConfig();
    expect(config.endpointBaseUrl).toBe("https://endpoint-trial.cognigy.ai");
  });

  it("derives webchat URL from API URL", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    const config = loadConfig();
    expect(config.webchatBaseUrl).toBe("https://webchat-trial.cognigy.ai");
  });

  it("uses explicit COGNIGY_ENDPOINT_BASE_URL if provided", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    process.env.COGNIGY_ENDPOINT_BASE_URL =
      "https://custom-endpoint.example.com";
    const config = loadConfig();
    expect(config.endpointBaseUrl).toBe("https://custom-endpoint.example.com");
  });

  it("uses explicit COGNIGY_WEBCHAT_BASE_URL if provided", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    process.env.COGNIGY_WEBCHAT_BASE_URL = "https://custom-webchat.example.com";
    const config = loadConfig();
    expect(config.webchatBaseUrl).toBe("https://custom-webchat.example.com");
  });

  it("defaults serverName to cognigy-api-mcp", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    delete process.env.MCP_SERVER_NAME;
    const config = loadConfig();
    expect(config.serverName).toBe("cognigy-api-mcp");
  });

  it("uses custom MCP_SERVER_NAME if provided", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    process.env.MCP_SERVER_NAME = "my-custom-server";
    const config = loadConfig();
    expect(config.serverName).toBe("my-custom-server");
  });

  it("defaults logLevel to info", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    delete process.env.LOG_LEVEL;
    const config = loadConfig();
    expect(config.logLevel).toBe("info");
  });

  it.each(["debug", "warn", "error"] as const)(
    "accepts valid log level: %s",
    (level) => {
      process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
      process.env.COGNIGY_API_KEY = "test-key";
      process.env.LOG_LEVEL = level;
      const config = loadConfig();
      expect(config.logLevel).toBe(level);
    },
  );

  it("falls back to info for invalid LOG_LEVEL", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    process.env.LOG_LEVEL = "verbose";
    const config = loadConfig();
    expect(config.logLevel).toBe("info");
  });

  it("parses RATE_LIMIT_MAX_REQUESTS correctly", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    process.env.RATE_LIMIT_MAX_REQUESTS = "50";
    const config = loadConfig();
    expect(config.rateLimit.maxRequests).toBe(50);
  });

  it("defaults rate limit values when env vars not set", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    delete process.env.RATE_LIMIT_MAX_REQUESTS;
    delete process.env.RATE_LIMIT_WINDOW_MS;
    const config = loadConfig();
    expect(config.rateLimit.maxRequests).toBe(100);
    expect(config.rateLimit.windowMs).toBe(60000);
  });

  it("falls back to defaults for non-numeric rate limit values", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    process.env.RATE_LIMIT_MAX_REQUESTS = "not-a-number";
    process.env.RATE_LIMIT_WINDOW_MS = "abc";
    const config = loadConfig();
    expect(config.rateLimit.maxRequests).toBe(100);
    expect(config.rateLimit.windowMs).toBe(60000);
  });

  it("derives static files URL from API URL", () => {
    process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
    process.env.COGNIGY_API_KEY = "test-key";
    const config = loadConfig();
    expect(config.staticFilesBaseUrl).toBe("https://static-trial.cognigy.ai");
  });

  describe("NiCE CXone hosts (cognigy-api-{env}.nicecxone.com)", () => {
    it("keeps the API URL unchanged (already has the api- label)", () => {
      process.env.COGNIGY_API_BASE_URL =
        "https://cognigy-api-au1.nicecxone.com";
      process.env.COGNIGY_API_KEY = "test-key";
      const config = loadConfig();
      expect(config.apiBaseUrl).toBe("https://cognigy-api-au1.nicecxone.com");
    });

    it("derives the endpoint URL, preserving the cognigy- prefix", () => {
      process.env.COGNIGY_API_BASE_URL =
        "https://cognigy-api-au1.nicecxone.com";
      process.env.COGNIGY_API_KEY = "test-key";
      const config = loadConfig();
      expect(config.endpointBaseUrl).toBe(
        "https://cognigy-endpoint-au1.nicecxone.com",
      );
    });

    it("derives the webchat URL, preserving the cognigy- prefix", () => {
      process.env.COGNIGY_API_BASE_URL =
        "https://cognigy-api-au1.nicecxone.com";
      process.env.COGNIGY_API_KEY = "test-key";
      const config = loadConfig();
      expect(config.webchatBaseUrl).toBe(
        "https://cognigy-webchat-au1.nicecxone.com",
      );
    });

    it("derives the static files URL, preserving the cognigy- prefix", () => {
      process.env.COGNIGY_API_BASE_URL =
        "https://cognigy-api-au1.nicecxone.com";
      process.env.COGNIGY_API_KEY = "test-key";
      const config = loadConfig();
      expect(config.staticFilesBaseUrl).toBe(
        "https://cognigy-static-au1.nicecxone.com",
      );
    });

    it("regression: the OLD ^api-(.+)$ hostname match would silently pass the API host through unchanged", () => {
      // This reproduces the pre-fix regex (src/config.ts:65-68 before the fix)
      // to prove why the bug was silent rather than throwing: the char before
      // "api-" in "cognigy-api-au1.nicecxone.com" is "-", not start-of-host,
      // so `^api-(.+)$` never matches and the function fell through to
      // returning the *API* host as the "derived" endpoint host.
      const oldDerive = (apiBaseUrl: string): string => {
        const url = new URL(apiBaseUrl);
        const match = url.hostname.match(/^api-(.+)$/);
        if (match) {
          return `${url.protocol}//endpoint-${match[1]}`;
        }
        return apiBaseUrl.replace(/\/api-/, "/endpoint-");
      };
      const wronglyUnchanged = oldDerive(
        "https://cognigy-api-au1.nicecxone.com",
      );
      expect(wronglyUnchanged).toBe("https://cognigy-api-au1.nicecxone.com");

      // The fixed implementation must NOT reproduce this passthrough.
      process.env.COGNIGY_API_BASE_URL =
        "https://cognigy-api-au1.nicecxone.com";
      process.env.COGNIGY_API_KEY = "test-key";
      const config = loadConfig();
      expect(config.endpointBaseUrl).not.toBe(config.apiBaseUrl);
      expect(config.endpointBaseUrl).toBe(
        "https://cognigy-endpoint-au1.nicecxone.com",
      );
    });
  });

  describe("explicit ports are preserved across derivation", () => {
    it("preserves the port when deriving the endpoint URL (.cognigy.ai)", () => {
      process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai:8443";
      process.env.COGNIGY_API_KEY = "test-key";
      const config = loadConfig();
      expect(config.endpointBaseUrl).toBe(
        "https://endpoint-trial.cognigy.ai:8443",
      );
    });

    it("preserves the port when deriving the webchat and static URLs (.cognigy.ai)", () => {
      process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai:8443";
      process.env.COGNIGY_API_KEY = "test-key";
      const config = loadConfig();
      expect(config.webchatBaseUrl).toBe(
        "https://webchat-trial.cognigy.ai:8443",
      );
      expect(config.staticFilesBaseUrl).toBe(
        "https://static-trial.cognigy.ai:8443",
      );
    });

    it("preserves the port when deriving the endpoint URL (CXone host)", () => {
      process.env.COGNIGY_API_BASE_URL =
        "https://cognigy-api-au1.nicecxone.com:9443";
      process.env.COGNIGY_API_KEY = "test-key";
      const config = loadConfig();
      expect(config.endpointBaseUrl).toBe(
        "https://cognigy-endpoint-au1.nicecxone.com:9443",
      );
    });
  });

  describe("COGNIGY_STATIC_FILES_BASE_URL override", () => {
    it("uses the explicit override if provided instead of deriving", () => {
      process.env.COGNIGY_API_BASE_URL = "https://api-trial.cognigy.ai";
      process.env.COGNIGY_API_KEY = "test-key";
      process.env.COGNIGY_STATIC_FILES_BASE_URL =
        "https://custom-static.example.com";
      const config = loadConfig();
      expect(config.staticFilesBaseUrl).toBe(
        "https://custom-static.example.com",
      );
    });
  });

  describe("hosts with no 'api-' label at all", () => {
    it("documents current behaviour: derived URLs pass through unchanged", () => {
      // No "cognigy-" CXone prefix, no "api-" label, and not *.cognigy.ai
      // (so normalizeApiBaseUrl doesn't touch it either). There is no label
      // to swap, so deriveSiblingBaseUrl can't compute a sibling host and
      // intentionally falls back to returning the API URL unchanged
      // (logging a warning) rather than guessing. This is asserted
      // explicitly here so a future change can't silently alter it.
      process.env.COGNIGY_API_BASE_URL = "https://trial.nicecxone.com";
      process.env.COGNIGY_API_KEY = "test-key";
      const config = loadConfig();
      expect(config.apiBaseUrl).toBe("https://trial.nicecxone.com");
      expect(config.endpointBaseUrl).toBe(config.apiBaseUrl);
      expect(config.webchatBaseUrl).toBe(config.apiBaseUrl);
      expect(config.staticFilesBaseUrl).toBe(config.apiBaseUrl);
    });
  });

  describe("garbage / non-URL input", () => {
    it("passes a non-URL string through unchanged in all base-URL fields", () => {
      process.env.COGNIGY_API_BASE_URL = "not-a-real-url";
      process.env.COGNIGY_API_KEY = "test-key";
      const config = loadConfig();
      expect(config.apiBaseUrl).toBe("not-a-real-url");
      expect(config.endpointBaseUrl).toBe("not-a-real-url");
      expect(config.webchatBaseUrl).toBe("not-a-real-url");
      expect(config.staticFilesBaseUrl).toBe("not-a-real-url");
    });

    it("passes a bare hostname with no scheme through unchanged", () => {
      process.env.COGNIGY_API_BASE_URL = "trial.cognigy.ai";
      process.env.COGNIGY_API_KEY = "test-key";
      const config = loadConfig();
      expect(config.apiBaseUrl).toBe("trial.cognigy.ai");
      expect(config.endpointBaseUrl).toBe("trial.cognigy.ai");
    });
  });

  describe("uppercase hosts", () => {
    // Note: the API host itself already starts with "api-" here, so
    // normalizeApiBaseUrl's mutating branch never runs and the raw casing
    // of apiBaseUrl is passed through unchanged (a separate, pre-existing
    // quirk not covered by this PR). What we're pinning down is that
    // deriveSiblingBaseUrl's derived hostnames come out lowercased, because
    // the WHATWG `URL` parser lowercases `.hostname` regardless of input
    // case — this is relied upon implicitly and worth a regression test.
    it("derives a lowercase endpoint URL for an uppercase .cognigy.ai host", () => {
      process.env.COGNIGY_API_BASE_URL = "https://API-TRIAL.COGNIGY.AI";
      process.env.COGNIGY_API_KEY = "test-key";
      const config = loadConfig();
      expect(config.endpointBaseUrl).toBe("https://endpoint-trial.cognigy.ai");
    });

    it("derives a lowercase endpoint URL for an uppercase CXone host", () => {
      process.env.COGNIGY_API_BASE_URL =
        "https://COGNIGY-API-AU1.NICECXONE.COM";
      process.env.COGNIGY_API_KEY = "test-key";
      const config = loadConfig();
      expect(config.endpointBaseUrl).toBe(
        "https://cognigy-endpoint-au1.nicecxone.com",
      );
    });
  });

  describe("trailing slashes on CXone hosts", () => {
    it("strips trailing slashes from a CXone API URL", () => {
      process.env.COGNIGY_API_BASE_URL =
        "https://cognigy-api-eu2.nicecxone.com///";
      process.env.COGNIGY_API_KEY = "test-key";
      const config = loadConfig();
      expect(config.apiBaseUrl).toBe("https://cognigy-api-eu2.nicecxone.com");
      expect(config.endpointBaseUrl).toBe(
        "https://cognigy-endpoint-eu2.nicecxone.com",
      );
    });
  });

  describe("additional CXone regions", () => {
    it.each(["eu1", "use1"])(
      "derives sibling URLs for the %s region",
      (region) => {
        process.env.COGNIGY_API_BASE_URL = `https://cognigy-api-${region}.nicecxone.com`;
        process.env.COGNIGY_API_KEY = "test-key";
        const config = loadConfig();
        expect(config.endpointBaseUrl).toBe(
          `https://cognigy-endpoint-${region}.nicecxone.com`,
        );
        expect(config.webchatBaseUrl).toBe(
          `https://cognigy-webchat-${region}.nicecxone.com`,
        );
        expect(config.staticFilesBaseUrl).toBe(
          `https://cognigy-static-${region}.nicecxone.com`,
        );
      },
    );
  });

  describe("on-disk fallback (setup CLI)", () => {
    it("does not read the fallback file when both env vars are set", () => {
      process.env.COGNIGY_API_BASE_URL = "https://api-dev.cognigy.ai";
      process.env.COGNIGY_API_KEY = "env-key";
      loadConfig();
      expect(readUserConfigFile).not.toHaveBeenCalled();
    });

    it("sources both values from the file when env vars are absent", () => {
      delete process.env.COGNIGY_API_BASE_URL;
      delete process.env.COGNIGY_API_KEY;
      readUserConfigFile.mockReturnValue({
        COGNIGY_API_BASE_URL: "https://api-trial.cognigy.ai",
        COGNIGY_API_KEY: "file-key",
      });
      const config = loadConfig();
      expect(config.apiBaseUrl).toBe("https://api-trial.cognigy.ai");
      expect(config.apiKey).toBe("file-key");
    });

    it("lets an env var take precedence over the file per-field", () => {
      delete process.env.COGNIGY_API_BASE_URL;
      process.env.COGNIGY_API_KEY = "env-key";
      readUserConfigFile.mockReturnValue({
        COGNIGY_API_BASE_URL: "https://api-trial.cognigy.ai",
        COGNIGY_API_KEY: "file-key",
      });
      const config = loadConfig();
      expect(config.apiBaseUrl).toBe("https://api-trial.cognigy.ai"); // from file
      expect(config.apiKey).toBe("env-key"); // env wins
    });

    it("points users at the setup command when nothing is configured", () => {
      delete process.env.COGNIGY_API_BASE_URL;
      delete process.env.COGNIGY_API_KEY;
      expect(() => loadConfig()).toThrow(/setup/);
    });
  });
});
