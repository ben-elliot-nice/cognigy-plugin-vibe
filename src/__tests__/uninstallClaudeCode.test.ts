import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// Full-module mock of child_process so uninstallClaudeCode's spawnSync calls
// (detectClaudePath's `which`/`where`, plugin uninstall, marketplace remove)
// are driven without touching the real `claude` CLI or PATH.
const spawnSync = jest.fn();
jest.unstable_mockModule("child_process", () => ({
  spawnSync,
}));

const { uninstallClaudeCode } = await import("../install/claudeCode.js");

function res(overrides: Partial<{ status: number; stdout: string }> = {}) {
  return { status: 0, stdout: "", stderr: "", error: undefined, ...overrides };
}

describe("uninstallClaudeCode", () => {
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;

  beforeEach(() => {
    spawnSync.mockReset();
    stderrSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("falls back to manual commands when the CLI is absent", () => {
    // detectClaudePath's `which`/`where` call fails to resolve claude.
    spawnSync.mockReturnValue(res({ status: 1 }));
    const result = uninstallClaudeCode();
    expect(result).toEqual({
      method: "fallback",
      commands: [
        "/plugin uninstall cognigy@cognigy-plugin",
        "/plugin marketplace remove cognigy-plugin",
      ],
    });
    // Only the detection probe ran — no uninstall/marketplace-remove calls.
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it("reports removedPlugin/removedMarketplace true when both CLI steps succeed", () => {
    spawnSync
      .mockReturnValueOnce(res({ status: 0, stdout: "/usr/bin/claude\n" })) // detect
      .mockReturnValueOnce(res({ status: 0 })) // plugin uninstall
      .mockReturnValueOnce(res({ status: 0 })); // marketplace remove

    const result = uninstallClaudeCode();
    expect(result).toEqual({
      method: "cli",
      removedPlugin: true,
      removedMarketplace: true,
    });
  });

  it("continues to marketplace-remove and reports removedPlugin:false when plugin uninstall exits non-zero", () => {
    spawnSync
      .mockReturnValueOnce(res({ status: 0, stdout: "/usr/bin/claude\n" })) // detect
      .mockReturnValueOnce(res({ status: 1 })) // plugin uninstall fails (not installed)
      .mockReturnValueOnce(res({ status: 0 })); // marketplace remove still runs

    const result = uninstallClaudeCode();
    expect(result.removedPlugin).toBe(false);
    expect(result.removedMarketplace).toBe(true);
    // Warns to stderr but doesn't throw.
    expect(stderrSpy).toHaveBeenCalled();
    // Both CLI steps ran despite the first failing.
    expect(spawnSync).toHaveBeenCalledTimes(3);
  });

  it("reports removedMarketplace:false independently when only that step fails", () => {
    spawnSync
      .mockReturnValueOnce(res({ status: 0, stdout: "/usr/bin/claude\n" })) // detect
      .mockReturnValueOnce(res({ status: 0 })) // plugin uninstall succeeds
      .mockReturnValueOnce(res({ status: 1 })); // marketplace remove fails

    const result = uninstallClaudeCode();
    expect(result.removedPlugin).toBe(true);
    expect(result.removedMarketplace).toBe(false);
  });
});
