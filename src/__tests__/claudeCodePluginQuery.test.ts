import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const spawnSync = jest.fn();

jest.unstable_mockModule("child_process", () => ({ spawnSync }));

const { queryClaudeCodePlugin, buildPluginListArgs } = await import(
  "../install/claudeCode.js"
);

beforeEach(() => {
  spawnSync.mockReset();
});

describe("buildPluginListArgs", () => {
  it("builds the JSON plugin-list args", () => {
    expect(buildPluginListArgs()).toEqual(["plugin", "list", "--json"]);
  });
});

describe("queryClaudeCodePlugin", () => {
  it("returns null when the CLI path is absent", () => {
    expect(queryClaudeCodePlugin(null)).toBeNull();
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("returns null when the command fails", () => {
    spawnSync.mockReturnValue({ status: 1, stdout: "" });
    expect(queryClaudeCodePlugin("/usr/bin/claude")).toBeNull();
  });

  it("returns null when stdout isn't valid JSON", () => {
    spawnSync.mockReturnValue({ status: 0, stdout: "not json" });
    expect(queryClaudeCodePlugin("/usr/bin/claude")).toBeNull();
  });

  it("returns null when the cognigy plugin isn't in the list", () => {
    spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify([{ id: "other@marketplace", version: "1.0.0" }]),
    });
    expect(queryClaudeCodePlugin("/usr/bin/claude")).toBeNull();
  });

  it("returns the version/scope when found", () => {
    spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify([
        { id: "cognigy@cognigy-plugin", version: "1.7.0", scope: "user" },
      ]),
    });
    expect(queryClaudeCodePlugin("/usr/bin/claude")).toEqual({
      version: "1.7.0",
      scope: "user",
    });
  });
});
