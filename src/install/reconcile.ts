/**
 * Installer lifecycle drift detection — pure functions only, no fs/process
 * access. Callers (src/setup.ts) gather the raw facts (via claudeCode.ts,
 * claudeDesktop.ts, userConfigFile.ts, npm) and pass them in; these functions
 * just reason about the resulting state. Kept separate from IO so drift
 * detection is exhaustively unit-testable without touching the real
 * filesystem, npm registry, or `claude` CLI.
 *
 * Mirrors the shape of the Python installer's reconcile.py (gather_state /
 * diff_state / apply_fixes), adapted to this repo's actual surfaces: the
 * `claude` plugin CLI (Claude Code) and the auto-updating Desktop launcher
 * (Claude Desktop chat connector) — there is no PyPI/uvx pin or layout-schema
 * migration here.
 */

/** Raw facts about the current install, gathered by the caller (impure). */
export interface SetupState {
  /** Latest engine version on npm, or null if the registry couldn't be reached. */
  latestEngineVersion: string | null;
  /** Whether the `claude` CLI was found on PATH. */
  claudeCodeCliPresent: boolean;
  /** Installed cognigy plugin version per `claude plugin list --json`, or null
   *  when the CLI is absent, the plugin isn't installed via the CLI, or the
   *  version couldn't be determined. */
  claudeCodePluginVersion: string | null;
  /** Whether claude_desktop_config.json currently has our `Cognigy` entry. */
  desktopConfigPresent: boolean;
  /** Version of the engine installed under ~/.cognigy-plugin/engine, or null
   *  if nothing is installed there. */
  desktopEngineVersion: string | null;
  /** Whether ~/.cognigy-plugin/desktop-launch.mjs exists. */
  desktopLauncherPresent: boolean;
}

/** Assemble a `SetupState` from gathered facts. Exists so callers have one
 *  clearly-named seam between IO (probing the system) and pure reasoning
 *  (diffState/planFixes) — currently a passthrough, but keeps the module's
 *  public shape stable if state gathering grows extra derived fields. */
export function gatherState(facts: SetupState): SetupState {
  return { ...facts };
}

export type DriftKind = "drift" | "missing";

export type DriftSurface =
  | "claude_code_plugin"
  | "desktop_entry"
  | "desktop_launcher"
  | "desktop_engine";

export interface DriftIssue {
  surface: DriftSurface;
  /** Current value (version string, etc.), or null when entirely absent. */
  current: string | null;
  /** What it should be. */
  expected: string;
  kind: DriftKind;
}

/**
 * Diff a gathered SetupState against what it should be, given the latest
 * published engine version. Desktop surfaces are only evaluated when there's
 * evidence Desktop was ever set up (a launcher, an engine install, or a
 * config entry) — otherwise "Desktop not installed" would falsely read as
 * drift for every Claude-Code-only user.
 */
export function diffState(state: SetupState): DriftIssue[] {
  const issues: DriftIssue[] = [];
  const latest = state.latestEngineVersion;

  if (state.claudeCodeCliPresent && latest) {
    if (state.claudeCodePluginVersion === null) {
      // Not installed via the CLI (or version unreadable) — nothing to
      // reconcile here; install/status text already covers the fallback path.
    } else if (state.claudeCodePluginVersion !== latest) {
      issues.push({
        surface: "claude_code_plugin",
        current: state.claudeCodePluginVersion,
        expected: latest,
        kind: "drift",
      });
    }
  }

  const desktopEverInstalled =
    state.desktopLauncherPresent ||
    state.desktopEngineVersion !== null ||
    state.desktopConfigPresent;

  if (desktopEverInstalled) {
    if (!state.desktopConfigPresent) {
      issues.push({
        surface: "desktop_entry",
        current: null,
        expected: "present",
        kind: "missing",
      });
    }
    if (!state.desktopLauncherPresent) {
      issues.push({
        surface: "desktop_launcher",
        current: null,
        expected: "present",
        kind: "missing",
      });
    }
    if (latest) {
      if (state.desktopEngineVersion === null) {
        issues.push({
          surface: "desktop_engine",
          current: null,
          expected: latest,
          kind: "missing",
        });
      } else if (state.desktopEngineVersion !== latest) {
        issues.push({
          surface: "desktop_engine",
          current: state.desktopEngineVersion,
          expected: latest,
          kind: "drift",
        });
      }
    }
  }

  return issues;
}

export interface FixAction {
  surface: DriftSurface;
  description: string;
  /** True when applying this fix needs API credentials we may not have on
   *  hand (e.g. rebuilding a fully-missing Desktop entry) — callers should
   *  skip it and point the user at a full re-install instead. */
  needsCreds: boolean;
}

/** Turn drift issues into a human-readable, ordered fix plan. Pure — callers
 *  execute each action against the real system (see src/setup.ts `--fix`). */
export function planFixes(issues: DriftIssue[]): FixAction[] {
  return issues.map((issue) => {
    switch (issue.surface) {
      case "claude_code_plugin":
        return {
          surface: issue.surface,
          description: `Claude Code plugin ${issue.current} -> ${issue.expected}: run 'claude plugin update cognigy@cognigy-plugin'`,
          needsCreds: false,
        };
      case "desktop_launcher":
        return {
          surface: issue.surface,
          description:
            "Rewrite the Desktop auto-update launcher (~/.cognigy-plugin/desktop-launch.mjs)",
          needsCreds: false,
        };
      case "desktop_engine":
        return {
          surface: issue.surface,
          description: `Install @cognigy/plugin-engine@${issue.expected} into the Desktop per-user prefix (was ${issue.current ?? "none"})`,
          needsCreds: false,
        };
      case "desktop_entry":
        return {
          surface: issue.surface,
          description:
            "Re-wire the 'Cognigy' connector into claude_desktop_config.json",
          needsCreds: true,
        };
    }
  });
}
