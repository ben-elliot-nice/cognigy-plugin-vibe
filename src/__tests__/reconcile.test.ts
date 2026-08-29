import { describe, it, expect } from "@jest/globals";
import {
  diffState,
  gatherState,
  planFixes,
  type SetupState,
} from "../install/reconcile.js";

const CLEAN: SetupState = {
  latestEngineVersion: "1.7.0",
  claudeCodeCliPresent: true,
  claudeCodePluginVersion: "1.7.0",
  desktopConfigPresent: true,
  desktopEngineVersion: "1.7.0",
  desktopLauncherPresent: true,
};

describe("gatherState", () => {
  it("passes facts through unchanged", () => {
    expect(gatherState(CLEAN)).toEqual(CLEAN);
  });
});

describe("diffState", () => {
  it("reports no drift when everything matches latest", () => {
    expect(diffState(CLEAN)).toEqual([]);
  });

  it("flags a stale Claude Code plugin version", () => {
    const state: SetupState = { ...CLEAN, claudeCodePluginVersion: "1.6.0" };
    expect(diffState(state)).toEqual([
      {
        surface: "claude_code_plugin",
        current: "1.6.0",
        expected: "1.7.0",
        kind: "drift",
      },
    ]);
  });

  it("does not flag Claude Code when its version can't be determined", () => {
    const state: SetupState = { ...CLEAN, claudeCodePluginVersion: null };
    expect(diffState(state)).toEqual([]);
  });

  it("does not flag Claude Code drift when the latest version is unknown", () => {
    const state: SetupState = {
      ...CLEAN,
      latestEngineVersion: null,
      claudeCodePluginVersion: "1.6.0",
    };
    expect(diffState(state)).toEqual([]);
  });

  it("ignores Desktop surfaces entirely when Desktop was never installed", () => {
    const state: SetupState = {
      ...CLEAN,
      desktopConfigPresent: false,
      desktopEngineVersion: null,
      desktopLauncherPresent: false,
    };
    expect(diffState(state)).toEqual([]);
  });

  it("flags a missing Desktop config entry when the launcher exists", () => {
    const state: SetupState = { ...CLEAN, desktopConfigPresent: false };
    expect(diffState(state)).toContainEqual({
      surface: "desktop_entry",
      current: null,
      expected: "present",
      kind: "missing",
    });
  });

  it("flags a missing Desktop launcher when the engine is installed", () => {
    const state: SetupState = { ...CLEAN, desktopLauncherPresent: false };
    expect(diffState(state)).toContainEqual({
      surface: "desktop_launcher",
      current: null,
      expected: "present",
      kind: "missing",
    });
  });

  it("flags a stale Desktop engine version", () => {
    const state: SetupState = { ...CLEAN, desktopEngineVersion: "1.5.0" };
    expect(diffState(state)).toContainEqual({
      surface: "desktop_engine",
      current: "1.5.0",
      expected: "1.7.0",
      kind: "drift",
    });
  });

  it("flags a missing Desktop engine when the config entry is wired", () => {
    const state: SetupState = {
      ...CLEAN,
      desktopEngineVersion: null,
      desktopLauncherPresent: false,
    };
    const issues = diffState(state);
    expect(issues).toContainEqual({
      surface: "desktop_engine",
      current: null,
      expected: "1.7.0",
      kind: "missing",
    });
    expect(issues).toContainEqual({
      surface: "desktop_launcher",
      current: null,
      expected: "present",
      kind: "missing",
    });
  });

  it("reports every drifted surface at once", () => {
    const state: SetupState = {
      latestEngineVersion: "2.0.0",
      claudeCodeCliPresent: true,
      claudeCodePluginVersion: "1.9.0",
      desktopConfigPresent: false,
      desktopEngineVersion: "1.9.0",
      desktopLauncherPresent: false,
    };
    const issues = diffState(state);
    expect(issues.map((i) => i.surface).sort()).toEqual([
      "claude_code_plugin",
      "desktop_engine",
      "desktop_entry",
      "desktop_launcher",
    ]);
  });
});

describe("planFixes", () => {
  it("maps each surface to a concrete, ordered fix description", () => {
    const issues = diffState({
      latestEngineVersion: "2.0.0",
      claudeCodeCliPresent: true,
      claudeCodePluginVersion: "1.9.0",
      desktopConfigPresent: false,
      desktopEngineVersion: "1.9.0",
      desktopLauncherPresent: false,
    });
    const fixes = planFixes(issues);
    expect(fixes.map((f) => f.surface)).toEqual(issues.map((i) => i.surface));
    const bySurface = Object.fromEntries(fixes.map((f) => [f.surface, f]));
    expect(bySurface.claude_code_plugin.description).toMatch(
      /claude plugin update/,
    );
    expect(bySurface.claude_code_plugin.needsCreds).toBe(false);
    expect(bySurface.desktop_engine.description).toMatch(/2\.0\.0/);
    expect(bySurface.desktop_engine.needsCreds).toBe(false);
    expect(bySurface.desktop_launcher.needsCreds).toBe(false);
    // Rebuilding a fully-missing Desktop entry needs the stored API key.
    expect(bySurface.desktop_entry.needsCreds).toBe(true);
  });

  it("returns an empty plan for no issues", () => {
    expect(planFixes([])).toEqual([]);
  });
});
