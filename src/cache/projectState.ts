/**
 * Persistent, per-project state store. Port of the reference Python
 * implementation's `state.py` `ProjectState`, adapted to TS:
 *
 * - State lives at `<baseDir>/<projectKey|.unscoped>/.state.json`, merged on
 *   top of an optional `.state-seed.json` (seed = defaults, runtime = wins).
 * - `get`/`set` address the nested JSON tree by an array of keys (the JS
 *   equivalent of the Python `*keys` variadic). `set` auto-saves.
 * - `needsResync()` / `touchInteraction()` track a `last-interaction`
 *   timestamp file; if the gap since the last touch exceeds `resyncMs`
 *   (~4h by default), the caller should treat cached data as untrustworthy.
 * - `bindProject()` re-scopes an already-constructed instance to a different
 *   project without losing the "safe to call mid-session" property the
 *   Python version guarantees (no data bleed between projects).
 */
import { join } from "path";
import * as nodeFs from "fs";
import { type Clock, type FsLike, systemClock } from "./fsLike.js";

type JsonObject = Record<string, unknown>;

function deepGet(obj: JsonObject, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as JsonObject)[key];
  }
  return cur;
}

function deepSet(
  obj: JsonObject,
  path: readonly string[],
  value: unknown,
): void {
  let cur: JsonObject = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const next = cur[key];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      cur[key] = {};
    }
    cur = cur[key] as JsonObject;
  }
  cur[path[path.length - 1]] = value;
}

function deepMerge(base: JsonObject, override: JsonObject): JsonObject {
  const result: JsonObject = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const baseVal = result[k];
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      baseVal &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal)
    ) {
      result[k] = deepMerge(baseVal as JsonObject, v as JsonObject);
    } else {
      result[k] = v;
    }
  }
  return result;
}

const UNSCOPED_DIR = ".unscoped";

export class ProjectState {
  private state: JsonObject = {};
  private projectKey: string | undefined;
  private configDirPath = "";
  private statePath = "";
  private seedPath = "";
  private interactionPath = "";

  constructor(
    private readonly baseDir: string,
    projectKey: string | undefined,
    private readonly resyncMs: number = 4 * 60 * 60 * 1000,
    private readonly clock: Clock = systemClock,
    private readonly fs: FsLike = nodeFs,
  ) {
    this.bind(projectKey);
  }

  private bind(projectKey: string | undefined): void {
    this.projectKey = projectKey;
    this.configDirPath = join(this.baseDir, projectKey || UNSCOPED_DIR);
    this.fs.mkdirSync(this.configDirPath, { recursive: true });
    this.statePath = join(this.configDirPath, ".state.json");
    this.seedPath = join(this.configDirPath, ".state-seed.json");
    this.interactionPath = join(this.configDirPath, "last-interaction");
    this.state = {};
    this.load();
  }

  /** Re-scope this instance to a different project. Safe mid-session. */
  bindProject(projectKey: string): void {
    if (this.projectKey === projectKey) return;
    this.bind(projectKey);
  }

  get projectId(): string | undefined {
    return this.projectKey;
  }

  get configDir(): string {
    return this.configDirPath;
  }

  private readJson(path: string): JsonObject | undefined {
    if (!this.fs.existsSync(path)) return undefined;
    try {
      const parsed: unknown = JSON.parse(this.fs.readFileSync(path, "utf-8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as JsonObject)
        : undefined;
    } catch {
      return undefined;
    }
  }

  private load(): void {
    const seed = this.readJson(this.seedPath) ?? {};
    const runtime = this.readJson(this.statePath) ?? {};
    this.state = deepMerge(seed, runtime);
  }

  save(): void {
    this.fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  get(path: readonly string[]): unknown {
    return deepGet(this.state, path);
  }

  set(path: readonly string[], value: unknown): void {
    deepSet(this.state, path, value);
    this.save();
  }

  /** Name -> id convenience built on get/set, e.g. resolveId(["flows"], "My Flow"). */
  resolveId(namespace: string, name: string): string | undefined {
    const value = this.get([namespace, name, "id"]);
    return typeof value === "string" ? value : undefined;
  }

  rememberId(namespace: string, name: string, id: string): void {
    this.set([namespace, name, "id"], id);
  }

  needsResync(): boolean {
    if (!this.fs.existsSync(this.interactionPath)) return true;
    try {
      const last = parseFloat(
        this.fs.readFileSync(this.interactionPath, "utf-8"),
      );
      if (Number.isNaN(last)) return true;
      return this.clock.now() - last > this.resyncMs;
    } catch {
      return true;
    }
  }

  touchInteraction(): void {
    this.fs.writeFileSync(this.interactionPath, String(this.clock.now()));
  }

  asDict(): JsonObject {
    return JSON.parse(JSON.stringify(this.state)) as JsonObject;
  }
}
