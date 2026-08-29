/**
 * Exercises the real `CallToolRequestSchema` handler registered by
 * `src/index.ts` — not just the unit-level `RuntimeManager`/`buildSetupGuidance`
 * pieces it's built from. Mocks the MCP SDK's `Server`/`StdioServerTransport`
 * so importing `../index.js` (which calls `main()` at module load time) never
 * touches stdio, and captures the handler passed to
 * `server.setRequestHandler(CallToolRequestSchema, handler)` so we can invoke
 * it directly, exactly as the SDK would on an incoming tool call.
 */
import { describe, it, expect, jest } from "@jest/globals";

// No credentials configured for the whole module's lifetime -> the server
// boots in degraded mode (as asserted by runtime.test.ts already), and every
// tool call should hit the "not configured" branch in src/index.ts:58-70.
delete process.env.COGNIGY_API_BASE_URL;
delete process.env.COGNIGY_API_KEY;

// Never touch the real on-disk cognigy-setup fallback file.
jest.unstable_mockModule("../userConfigFile.js", () => ({
  readUserConfigFile: jest.fn<() => Record<string, string>>(() => ({})),
  writeUserConfigFile: jest.fn(),
  USER_CONFIG_FILE: "/fake/.cognigy-plugin/config.json",
  USER_CONFIG_DIR: "/fake/.cognigy-plugin",
}));

// Capture whatever handler src/index.ts registers for each request schema,
// without actually starting a stdio transport.
const handlers = new Map<unknown, (request: unknown) => Promise<unknown>>();

class FakeServer {
  setRequestHandler(
    schema: unknown,
    handler: (request: unknown) => Promise<unknown>,
  ) {
    handlers.set(schema, handler);
  }
  connect(_transport: unknown) {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

jest.unstable_mockModule("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: FakeServer,
}));

jest.unstable_mockModule("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {},
}));

// Keep process.exit/SIGINT wiring inert during the test run.
const exitSpy = jest
  .spyOn(process, "exit")
  .mockImplementation((() => undefined) as never);

const { CallToolRequestSchema } = await import(
  "@modelcontextprotocol/sdk/types.js"
);

// Importing src/index.ts runs `main()` at the bottom of the module (top-level
// `main();`), which registers the handlers on our FakeServer synchronously
// before the awaited `server.connect()` — but main() itself is async, so we
// must let the microtask queue drain before the handler map is populated.
await import("../index.js");
await new Promise((resolve) => setImmediate(resolve));

describe("CallToolRequestSchema handler (degraded mode, no credentials)", () => {
  it("registered a handler for CallToolRequestSchema", () => {
    expect(handlers.has(CallToolRequestSchema)).toBe(true);
  });

  it("returns not_configured setup guidance instead of crashing or throwing", async () => {
    const handler = handlers.get(CallToolRequestSchema)!;
    const response: any = await handler({
      params: { name: "list_resources", arguments: {} },
    });

    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe("text");

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.error).toBe("not_configured");
    expect(parsed.message).toMatch(/cognigy-setup/);
    expect(parsed.message).toMatch(/COGNIGY_API_BASE_URL/);
    expect(parsed.message).toMatch(/COGNIGY_API_KEY/);
  });

  it("does NOT set isError on the not-configured response (matches existing rate-limit-response convention, but note for MCP clients that gate only on isError)", async () => {
    const handler = handlers.get(CallToolRequestSchema)!;
    const response: any = await handler({
      params: { name: "list_resources", arguments: {} },
    });

    expect(response.isError).toBeUndefined();
  });

  it("never called process.exit", () => {
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
