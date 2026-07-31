import { describe, it, expect, afterEach, jest } from "@jest/globals";
import { tools } from "../tools/definitions.js";
import {
  devTools,
  isDevModeEnabled,
  buildToolList,
} from "../tools/devTools.js";
import { ToolHandlers } from "../tools/handlers.js";
import { CognigyApiClient } from "../api/client.js";
import { RELOAD_EXIT_CODE } from "../dev/constants.js";

const ORIGINAL_ENV = process.env.COGNIGY_DEV;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.COGNIGY_DEV;
  } else {
    process.env.COGNIGY_DEV = ORIGINAL_ENV;
  }
});

describe("RELOAD_EXIT_CODE", () => {
  it("is the rc=42 sentinel", () => {
    expect(RELOAD_EXIT_CODE).toBe(42);
  });
});

describe("production tool list", () => {
  it("never contains reload_mcp regardless of env", () => {
    expect(tools.find((t) => t.name === "reload_mcp")).toBeUndefined();
  });
});

describe("isDevModeEnabled", () => {
  it("is false when COGNIGY_DEV is unset", () => {
    delete process.env.COGNIGY_DEV;
    expect(isDevModeEnabled()).toBe(false);
  });

  it("is false for any value other than the literal '1'", () => {
    process.env.COGNIGY_DEV = "true";
    expect(isDevModeEnabled()).toBe(false);
  });

  it("is true when COGNIGY_DEV=1", () => {
    process.env.COGNIGY_DEV = "1";
    expect(isDevModeEnabled()).toBe(true);
  });
});

describe("buildToolList", () => {
  it("returns exactly the production tools when dev mode is off", () => {
    delete process.env.COGNIGY_DEV;
    const list = buildToolList(tools);
    expect(list).toBe(tools);
    expect(list.find((t) => t.name === "reload_mcp")).toBeUndefined();
  });

  it("appends reload_mcp when COGNIGY_DEV=1", () => {
    process.env.COGNIGY_DEV = "1";
    const list = buildToolList(tools);
    expect(list.length).toBe(tools.length + devTools.length);
    expect(list.find((t) => t.name === "reload_mcp")).toBeDefined();
  });
});

describe("reload_mcp handler", () => {
  const api = {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    put: jest.fn(),
    uploadFile: jest.fn(),
  } as unknown as jest.Mocked<CognigyApiClient>;

  it("throws instead of exiting when COGNIGY_DEV is not set", async () => {
    delete process.env.COGNIGY_DEV;
    const h = new ToolHandlers(api, "", "", "");
    await expect(h.handleReloadMcp({})).rejects.toThrow(/dev-only/i);
  });

  it("schedules process.exit(RELOAD_EXIT_CODE) when COGNIGY_DEV=1", async () => {
    jest.useFakeTimers();
    process.env.COGNIGY_DEV = "1";
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    const h = new ToolHandlers(api, "", "", "");
    const result = await h.handleReloadMcp({});

    expect(exitSpy).not.toHaveBeenCalled(); // deferred via setTimeout
    jest.runAllTimers();
    expect(exitSpy).toHaveBeenCalledWith(RELOAD_EXIT_CODE);
    expect(result).toEqual(
      expect.objectContaining({ message: expect.any(String) }),
    );

    exitSpy.mockRestore();
    jest.useRealTimers();
  });
});
