import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// Full-module mocks for every impure dependency `runStatus`/`runUpdate` touch,
// so the integration test drives the real subcommand wiring in setup.ts
// without hitting the filesystem, npm registry, or the `claude` CLI.
const detectClaudePath = jest.fn<() => string | null>(() => null);
const queryClaudeCodePlugin = jest.fn<
  () => { version: string | null; scope: string | null } | null
>(() => null);
const updateClaudeCode = jest.fn(() => ({ method: "cli" as const }));
const uninstallClaudeCode = jest.fn(() => ({
  method: "cli" as const,
  removedPlugin: true,
  removedMarketplace: true,
}));

const desktopHasCognigyEntry = jest.fn<() => boolean>(() => false);
const installedDesktopEngineVersion = jest.fn<() => string | null>(() => null);
const installClaudeDesktop = jest.fn();
const installDesktopEngine = jest.fn();
const uninstallClaudeDesktop = jest.fn(() => ({
  configPath: "/home/.config/claude_desktop_config.json",
  removedEntry: true,
  removedEngine: false,
}));
const purgeUserHome = jest.fn(() => false);

const antigravityHasPlugin = jest.fn<() => boolean>(() => false);
const installedPluginVersion = jest.fn<() => string | null>(() => null);
const uninstallAntigravity = jest.fn(() => ({
  removedPlugin: false,
  removedLegacyServer: false,
}));
const updateAntigravity = jest.fn(() => ({ skills: [], agents: [] }));

const codexHasCognigyPlugin = jest.fn<() => boolean>(() => false);
const uninstallCodex = jest.fn(() => ({ method: "fallback" as const }));
const updateCodex = jest.fn(() => ({ method: "fallback" as const }));

const installedGeminiExtensionVersion = jest.fn<() => string | null>(
  () => null,
);
const uninstallGemini = jest.fn(() => ({ method: "fallback" as const }));
const updateGemini = jest.fn(() => ({ method: "fallback" as const }));

const writeDesktopLauncher = jest.fn(() => "/home/.cognigy-plugin/launch.mjs");

const readUserConfigFile = jest.fn(() => ({}) as Record<string, string>);

const runNpm = jest.fn(() => ({ status: 0, stdout: "1.7.0\n" }));

// `ask()` in setup.ts creates a fresh readline interface per call; queue up
// canned answers so prompt-driven tests (runUninstall) can script responses.
const answerQueue: string[] = [];
const rlQuestion = jest.fn((_q: string, cb: (answer: string) => void): void => {
  cb(answerQueue.shift() ?? "");
});
jest.unstable_mockModule("readline", () => ({
  createInterface: () => ({
    question: rlQuestion,
    close: jest.fn(),
  }),
}));

jest.unstable_mockModule("../install/claudeCode.js", () => ({
  detectClaudePath,
  queryClaudeCodePlugin,
  updateClaudeCode,
  installClaudeCode: jest.fn(),
  uninstallClaudeCode,
  autoUpdateHint: () => "hint",
}));
jest.unstable_mockModule("../install/claudeDesktop.js", () => ({
  desktopHasCognigyEntry,
  installedDesktopEngineVersion,
  installClaudeDesktop,
  installDesktopEngine,
  resolveDesktopConfigPath: () => "/home/.config/claude_desktop_config.json",
  uninstallClaudeDesktop,
  purgeUserHome,
}));
jest.unstable_mockModule("../install/desktopLauncher.js", () => ({
  USER_HOME_DIR: "/home/.cognigy-plugin",
  DESKTOP_LAUNCHER_FILE: "/home/.cognigy-plugin/desktop-launch.mjs",
  writeDesktopLauncher,
}));
jest.unstable_mockModule("../install/antigravity.js", () => ({
  antigravityHasPlugin,
  detectAntigravity: jest.fn(() => null),
  installAntigravity: jest.fn(),
  installedPluginVersion,
  uninstallAntigravity,
  updateAntigravity,
}));
jest.unstable_mockModule("../install/cliRunner.js", () => ({
  detectOnPath: jest.fn(() => null),
  runCliTool: jest.fn(),
  runCliToolCapture: jest.fn(),
}));
jest.unstable_mockModule("../install/codex.js", () => ({
  codexGuiSteps: jest.fn(() => []),
  codexHasCognigyPlugin,
  installCodex: jest.fn(),
  uninstallCodex,
  updateCodex,
}));
jest.unstable_mockModule("../install/gemini.js", () => ({
  installGemini: jest.fn(),
  installedGeminiExtensionVersion,
  uninstallGemini,
  updateGemini,
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

const { runStatus, runUpdate, runUninstall } = await import("../setup.js");

/** Temporarily force `process.stdin.isTTY` for a test. */
function withTTY<T>(tty: boolean, fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    value: tty,
    configurable: true,
  });
  try {
    return fn();
  } finally {
    if (original) Object.defineProperty(process.stdin, "isTTY", original);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
  }
}

async function captureStdoutAsync(
  fn: () => Promise<void>,
): Promise<{ out: string; err: string }> {
  let out = "";
  let err = "";
  const outSpy = jest
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
  const errSpy = jest
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: unknown) => {
      err += String(chunk);
      return true;
    });
  try {
    await fn();
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
  return { out, err };
}

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
  uninstallClaudeCode.mockReset().mockReturnValue({
    method: "cli",
    removedPlugin: true,
    removedMarketplace: true,
  });
  desktopHasCognigyEntry.mockReset().mockReturnValue(false);
  installedDesktopEngineVersion.mockReset().mockReturnValue(null);
  installClaudeDesktop.mockReset();
  installDesktopEngine.mockReset();
  uninstallClaudeDesktop.mockReset().mockReturnValue({
    configPath: "/home/.config/claude_desktop_config.json",
    removedEntry: true,
    removedEngine: false,
  });
  purgeUserHome.mockReset().mockReturnValue(false);
  antigravityHasPlugin.mockReset().mockReturnValue(false);
  installedPluginVersion.mockReset().mockReturnValue(null);
  uninstallAntigravity.mockReset().mockReturnValue({
    removedPlugin: false,
    removedLegacyServer: false,
  });
  updateAntigravity.mockReset().mockReturnValue({ skills: [], agents: [] });
  codexHasCognigyPlugin.mockReset().mockReturnValue(false);
  uninstallCodex.mockReset().mockReturnValue({ method: "fallback" });
  updateCodex.mockReset().mockReturnValue({ method: "fallback" });
  installedGeminiExtensionVersion.mockReset().mockReturnValue(null);
  uninstallGemini.mockReset().mockReturnValue({ method: "fallback" });
  updateGemini.mockReset().mockReturnValue({ method: "fallback" });
  writeDesktopLauncher.mockReset().mockReturnValue("/x/launch.mjs");
  readUserConfigFile.mockReset().mockReturnValue({});
  runNpm.mockReset().mockReturnValue({ status: 0, stdout: "1.7.0\n" });
  existsPaths.clear();
  answerQueue.length = 0;
  rlQuestion.mockClear();
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

  it("reports 'unknown (offline?)' for the latest engine when npm is unreachable", () => {
    runNpm.mockReturnValue({ status: 1, stdout: "" });
    const out = captureStdout(() => runStatus([]));
    expect(out).toContain("unknown (offline?)");
  });

  it("does not flag Claude Code drift when npm is unreachable (latest unknown)", () => {
    runNpm.mockReturnValue({ status: 1, stdout: "" });
    detectClaudePath.mockReturnValue("/usr/bin/claude");
    queryClaudeCodePlugin.mockReturnValue({ version: "1.6.0", scope: "user" });
    const out = captureStdout(() => runStatus([]));
    expect(out).toContain("No drift detected.");
  });

  it("--fix reports a per-action failure and keeps fixing the rest", () => {
    detectClaudePath.mockReturnValue("/usr/bin/claude");
    queryClaudeCodePlugin.mockReturnValue({ version: "1.6.0", scope: "user" });
    desktopHasCognigyEntry.mockReturnValue(true);
    installedDesktopEngineVersion.mockReturnValue("1.5.0");
    existsPaths.clear(); // launcher also missing
    updateClaudeCode.mockImplementation(() => {
      throw new Error("plugin update failed");
    });

    const out = captureStdout(() => runStatus(["--fix"]));

    expect(out).toContain("✗");
    expect(out).toContain("plugin update failed");
    // The other drifted surfaces still got fixed despite the failure above.
    expect(writeDesktopLauncher).toHaveBeenCalledTimes(1);
    expect(installDesktopEngine).toHaveBeenCalledWith("1.7.0");
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

  it("reports it could not reach npm when the registry is unreachable", () => {
    runNpm.mockReturnValue({ status: 1, stdout: "" });
    const out = captureStdout(() => runUpdate(["--check"]));
    expect(out).toContain("Could not reach npm");
    expect(updateClaudeCode).not.toHaveBeenCalled();
  });

  it("reports a Desktop engine update available", () => {
    installedDesktopEngineVersion.mockReturnValue("1.5.0");
    const out = captureStdout(() => runUpdate(["--check"]));
    expect(out).toContain("Claude Desktop engine: update available");
    expect(out).toContain("1.5.0");
    expect(out).toContain("1.7.0");
  });

  it("reports the Desktop engine up to date", () => {
    installedDesktopEngineVersion.mockReturnValue("1.7.0");
    const out = captureStdout(() => runUpdate(["--check"]));
    expect(out).toContain("Claude Desktop engine: up to date (1.7.0)");
  });
});

describe("runUninstall", () => {
  let exitSpy: jest.SpiedFunction<typeof process.exit>;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("refuses non-interactively without --yes: exits 1, removes nothing", async () => {
    await expect(
      withTTY(false, () => captureStdoutAsync(() => runUninstall([]))),
    ).rejects.toThrow("process.exit:1");
    expect(uninstallClaudeCode).not.toHaveBeenCalled();
    expect(uninstallClaudeDesktop).not.toHaveBeenCalled();
  });

  it("TTY prompt, answers 'n': aborts, removes nothing", async () => {
    answerQueue.push("n");
    const { out } = await withTTY(true, () =>
      captureStdoutAsync(() => runUninstall([])),
    );
    expect(out).toContain("Aborted.");
    expect(uninstallClaudeCode).not.toHaveBeenCalled();
    expect(uninstallClaudeDesktop).not.toHaveBeenCalled();
  });

  it("TTY prompt, answers 'y': removes both surfaces", async () => {
    answerQueue.push("y");
    await withTTY(true, () => captureStdoutAsync(() => runUninstall([])));
    expect(uninstallClaudeCode).toHaveBeenCalledTimes(1);
    expect(uninstallClaudeDesktop).toHaveBeenCalledTimes(1);
  });

  it("--yes skips the prompt entirely", async () => {
    await captureStdoutAsync(() => runUninstall(["--yes"]));
    expect(rlQuestion).not.toHaveBeenCalled();
    expect(uninstallClaudeCode).toHaveBeenCalledTimes(1);
    expect(uninstallClaudeDesktop).toHaveBeenCalledTimes(1);
  });

  it("-y is accepted as shorthand for --yes", async () => {
    await captureStdoutAsync(() => runUninstall(["-y"]));
    expect(uninstallClaudeCode).toHaveBeenCalledTimes(1);
  });

  it("--purge removes ~/.cognigy-plugin via purgeUserHome (shared, not per-client)", async () => {
    purgeUserHome.mockReturnValue(true);
    const { out } = await captureStdoutAsync(() =>
      runUninstall(["--yes", "--purge"]),
    );
    expect(uninstallClaudeDesktop).toHaveBeenCalledWith(
      "/home/.config/claude_desktop_config.json",
      false,
    );
    expect(purgeUserHome).toHaveBeenCalledTimes(1);
    expect(out).toContain("Removed ~/.cognigy-plugin");
  });

  it("without --purge, purgeUserHome is never called", async () => {
    await captureStdoutAsync(() => runUninstall(["--yes"]));
    expect(uninstallClaudeDesktop).toHaveBeenCalledWith(
      "/home/.config/claude_desktop_config.json",
      false,
    );
    expect(purgeUserHome).not.toHaveBeenCalled();
  });

  it("reports 'nothing to remove' when the CLI removed nothing", async () => {
    uninstallClaudeCode.mockReturnValue({
      method: "cli",
      removedPlugin: false,
      removedMarketplace: false,
    });
    const { out } = await captureStdoutAsync(() => runUninstall(["--yes"]));
    expect(out).toContain("nothing to remove");
  });

  it("reports 'no connector found' when Desktop had no entry", async () => {
    uninstallClaudeDesktop.mockReturnValue({
      configPath: "/home/.config/claude_desktop_config.json",
      removedEntry: false,
      removedEngine: false,
    });
    const { out } = await captureStdoutAsync(() => runUninstall(["--yes"]));
    expect(out).toContain("no connector found");
  });

  it("falls back to manual commands when the claude CLI is absent", async () => {
    uninstallClaudeCode.mockReturnValue({
      method: "fallback",
      commands: ["/plugin uninstall cognigy@cognigy-plugin"],
    });
    const { out } = await captureStdoutAsync(() => runUninstall(["--yes"]));
    expect(out).toContain("'claude' CLI not found");
    expect(out).toContain("/plugin uninstall cognigy@cognigy-plugin");
  });
});
