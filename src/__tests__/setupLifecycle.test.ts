import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// Full-module mocks for every impure dependency `runStatus`/`runUpdate` touch,
// so the integration test drives the real subcommand wiring in setup.ts
// without hitting the filesystem, npm registry, or the `claude` CLI.
const detectClaudePath = jest.fn<() => string | null>(() => null);
const queryClaudeCodePlugin = jest.fn<
  () => { version: string | null; scope: string | null } | null
>(() => null);
const updateClaudeCode = jest.fn(() => ({ method: "cli" as const }));

const desktopHasCognigyEntry = jest.fn<() => boolean>(() => false);
const installedDesktopEngineVersion = jest.fn<() => string | null>(() => null);
const installClaudeDesktop = jest.fn();
const installDesktopEngine = jest.fn();

const writeDesktopLauncher = jest.fn(() => "/home/.cognigy-plugin/launch.mjs");

const readUserConfigFile = jest.fn(() => ({}) as Record<string, string>);

const runNpm = jest.fn(() => ({ status: 0, stdout: "1.7.0\n" }));

jest.unstable_mockModule("../install/claudeCode.js", () => ({
  detectClaudePath,
  queryClaudeCodePlugin,
  updateClaudeCode,
  installClaudeCode: jest.fn(),
  uninstallClaudeCode: jest.fn(),
  autoUpdateHint: () => "hint",
}));
jest.unstable_mockModule("../install/claudeDesktop.js", () => ({
  desktopHasCognigyEntry,
  installedDesktopEngineVersion,
  installClaudeDesktop,
  installDesktopEngine,
  resolveDesktopConfigPath: () => "/home/.config/claude_desktop_config.json",
  uninstallClaudeDesktop: jest.fn(),
}));
jest.unstable_mockModule("../install/desktopLauncher.js", () => ({
  DESKTOP_LAUNCHER_FILE: "/home/.cognigy-plugin/desktop-launch.mjs",
  writeDesktopLauncher,
}));
jest.unstable_mockModule("../userConfigFile.js", () => ({
  readUserConfigFile,
  writeUserConfigFile: jest.fn(),
}));
jest.unstable_mockModule("../install/npmRunner.js", () => ({
  runNpm,
}));
// existsSync is used directly for the launcher-file check; fake it via a
// path-keyed table so DESKTOP_LAUNCHER_FILE presence is independently
// controllable per test.
const existsPaths = new Set<string>();
jest.unstable_mockModule("fs", () => ({
  existsSync: (p: string) => existsPaths.has(p),
  realpathSync: (p: string) => p,
}));

const { runStatus, runUpdate } = await import("../setup.js");

function captureStdout(fn: () => void): string {
  let out = "";
  const spy = jest
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return out;
}

beforeEach(() => {
  detectClaudePath.mockReset().mockReturnValue(null);
  queryClaudeCodePlugin.mockReset().mockReturnValue(null);
  updateClaudeCode.mockReset().mockReturnValue({ method: "cli" });
  desktopHasCognigyEntry.mockReset().mockReturnValue(false);
  installedDesktopEngineVersion.mockReset().mockReturnValue(null);
  installClaudeDesktop.mockReset();
  installDesktopEngine.mockReset();
  writeDesktopLauncher.mockReset().mockReturnValue("/x/launch.mjs");
  readUserConfigFile.mockReset().mockReturnValue({});
  runNpm.mockReset().mockReturnValue({ status: 0, stdout: "1.7.0\n" });
  existsPaths.clear();
});

describe("runStatus", () => {
  it("reports no drift when Claude Code is absent and Desktop was never installed", () => {
    const out = captureStdout(() => runStatus([]));
    expect(out).toContain("No drift detected.");
  });

  it("detects and reports a stale Claude Code plugin without --fix", () => {
    detectClaudePath.mockReturnValue("/usr/bin/claude");
    queryClaudeCodePlugin.mockReturnValue({ version: "1.6.0", scope: "user" });
    const out = captureStdout(() => runStatus([]));
    expect(out).toContain("Drift detected");
    expect(out).toContain("Claude Code plugin version");
    expect(out).toContain("status --fix");
    expect(updateClaudeCode).not.toHaveBeenCalled();
  });

  it("applies fixes with --fix: updates the stale Claude Code plugin", () => {
    detectClaudePath.mockReturnValue("/usr/bin/claude");
    queryClaudeCodePlugin.mockReturnValue({ version: "1.6.0", scope: "user" });
    const out = captureStdout(() => runStatus(["--fix"]));
    expect(updateClaudeCode).toHaveBeenCalledTimes(1);
    expect(out).toContain("updated");
  });

  it("applies fixes with --fix: rewrites a missing Desktop launcher and updates a stale engine", () => {
    desktopHasCognigyEntry.mockReturnValue(true);
    installedDesktopEngineVersion.mockReturnValue("1.5.0");
    existsPaths.clear(); // launcher file absent

    captureStdout(() => runStatus(["--fix"]));

    expect(writeDesktopLauncher).toHaveBeenCalledTimes(1);
    expect(installDesktopEngine).toHaveBeenCalledWith("1.7.0");
  });

  it("skips rebuilding a fully-missing Desktop entry without stored creds", () => {
    // Evidence of a prior Desktop install (engine present) but no config entry.
    installedDesktopEngineVersion.mockReturnValue("1.7.0");
    existsPaths.add("/home/.cognigy-plugin/desktop-launch.mjs");
    readUserConfigFile.mockReturnValue({});

    const out = captureStdout(() => runStatus(["--fix"]));

    expect(installClaudeDesktop).not.toHaveBeenCalled();
    expect(out).toContain("re-run");
  });

  it("rebuilds a missing Desktop entry from stored credentials", () => {
    installedDesktopEngineVersion.mockReturnValue("1.7.0");
    existsPaths.add("/home/.cognigy-plugin/desktop-launch.mjs");
    readUserConfigFile.mockReturnValue({
      COGNIGY_API_BASE_URL: "https://api-trial.cognigy.ai",
      COGNIGY_API_KEY: "secret",
    });

    captureStdout(() => runStatus(["--fix"]));

    expect(installClaudeDesktop).toHaveBeenCalledWith({
      COGNIGY_API_BASE_URL: "https://api-trial.cognigy.ai",
      COGNIGY_API_KEY: "secret",
    });
  });
});

describe("runUpdate --check", () => {
  it("reports up to date without calling updateClaudeCode", () => {
    detectClaudePath.mockReturnValue("/usr/bin/claude");
    queryClaudeCodePlugin.mockReturnValue({ version: "1.7.0", scope: "user" });
    const out = captureStdout(() => runUpdate(["--check"]));
    expect(out).toContain("up to date");
    expect(updateClaudeCode).not.toHaveBeenCalled();
  });

  it("reports an available update without applying it", () => {
    detectClaudePath.mockReturnValue("/usr/bin/claude");
    queryClaudeCodePlugin.mockReturnValue({ version: "1.6.0", scope: "user" });
    const out = captureStdout(() => runUpdate(["--check"]));
    expect(out).toContain("update available");
    expect(out).toContain("1.6.0");
    expect(out).toContain("1.7.0");
    expect(updateClaudeCode).not.toHaveBeenCalled();
  });

  it("still applies the update when --check is absent", () => {
    detectClaudePath.mockReturnValue("/usr/bin/claude");
    captureStdout(() => runUpdate([]));
    expect(updateClaudeCode).toHaveBeenCalledTimes(1);
  });
});
