/**
 * Minimal filesystem surface the cache/state modules depend on. Node's `fs`
 * module satisfies this interface as-is, so production code passes it
 * directly; tests inject an in-memory fake so no real disk or timers are
 * touched (per project test conventions).
 */
export interface FsLike {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  readFileSync(path: string, encoding: "utf-8"): string;
  writeFileSync(path: string, data: string): void;
  rmSync(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): void;
}

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/**
 * Simple in-memory implementation of {@link FsLike}, used by tests so cache
 * and project-state behaviour can be verified without touching real disk.
 */
export class MemoryFs implements FsLike {
  private files = new Map<string, string>();
  private dirs = new Set<string>(["/"]);

  private normalize(path: string): string {
    return path.replace(/\/+/g, "/");
  }

  existsSync(path: string): boolean {
    const p = this.normalize(path);
    return this.files.has(p) || this.dirs.has(p);
  }

  mkdirSync(path: string): void {
    // Mirror `{ recursive: true }` semantics: register every ancestor
    // directory too, so an `existsSync`/`rmSync` on a parent (e.g. the cache
    // root) sees it as present even though only a leaf was ever "created".
    const normalized = this.normalize(path);
    const parts = normalized.split("/").filter(Boolean);
    let cur = normalized.startsWith("/") ? "" : "";
    for (const part of parts) {
      cur = `${cur}/${part}`;
      this.dirs.add(cur);
    }
    this.dirs.add(normalized);
  }

  readFileSync(path: string): string {
    const p = this.normalize(path);
    const content = this.files.get(p);
    if (content === undefined) {
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
    }
    return content;
  }

  writeFileSync(path: string, data: string): void {
    this.files.set(this.normalize(path), data);
  }

  rmSync(path: string, options?: { recursive?: boolean }): void {
    const p = this.normalize(path);
    this.files.delete(p);
    this.dirs.delete(p);
    if (options?.recursive) {
      const prefix = p.endsWith("/") ? p : `${p}/`;
      for (const key of [...this.files.keys()]) {
        if (key.startsWith(prefix)) this.files.delete(key);
      }
      for (const key of [...this.dirs.keys()]) {
        if (key.startsWith(prefix)) this.dirs.delete(key);
      }
    }
  }
}
