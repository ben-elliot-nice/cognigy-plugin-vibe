/**
 * Persistent, per-resource read cache. Port of the reference Python
 * implementation's `cache.py`: each `(resourceType, resourceId)` pair is
 * stored as its own JSON file under `<cacheDir>/<resourceType>/<id>.json`,
 * stamped with the write time so callers can decide freshness against a TTL.
 *
 * Deliberately dumb — no TTL enforcement here beyond reporting `fresh`; the
 * decision to reuse a stale value belongs to the caller (see
 * `CacheStore.getOrFetch` in `cacheStore.ts`).
 */
import { join } from "path";
import * as nodeFs from "fs";
import { type Clock, type FsLike, systemClock } from "./fsLike.js";

interface CacheEntry<T> {
  cachedAt: number;
  data: T;
}

export class ReadCache {
  constructor(
    private readonly cacheDir: string,
    private readonly ttlMs: number = 5 * 60 * 1000,
    private readonly clock: Clock = systemClock,
    private readonly fs: FsLike = nodeFs,
  ) {}

  private resourcePath(resourceType: string, resourceId: string): string {
    return join(this.cacheDir, resourceType, `${resourceId}.json`);
  }

  /**
   * Returns the cached value (if any) and whether it's still within TTL.
   * `data` is non-null whenever we found *something* on disk, even if it's
   * stale — callers may still want a stale value as a fallback.
   */
  get<T = unknown>(
    resourceType: string,
    resourceId: string,
  ): { data: T | null; fresh: boolean } {
    const path = this.resourcePath(resourceType, resourceId);
    if (!this.fs.existsSync(path)) return { data: null, fresh: false };
    try {
      const entry = JSON.parse(this.fs.readFileSync(path, "utf-8")) as Partial<
        CacheEntry<T>
      >;
      if (
        typeof entry.cachedAt !== "number" ||
        !("data" in entry) ||
        entry.data === undefined
      ) {
        return { data: null, fresh: false };
      }
      const fresh = this.clock.now() - entry.cachedAt < this.ttlMs;
      return { data: entry.data, fresh };
    } catch {
      return { data: null, fresh: false };
    }
  }

  set<T = unknown>(resourceType: string, resourceId: string, data: T): void {
    const path = this.resourcePath(resourceType, resourceId);
    this.fs.mkdirSync(join(this.cacheDir, resourceType), { recursive: true });
    const payload: CacheEntry<T> = { cachedAt: this.clock.now(), data };
    this.fs.writeFileSync(path, JSON.stringify(payload));
  }

  invalidate(resourceType: string, resourceId: string): void {
    const path = this.resourcePath(resourceType, resourceId);
    if (this.fs.existsSync(path)) {
      this.fs.rmSync(path, { force: true });
    }
  }

  /** Wipes every cached entry — used on idle-resync. */
  invalidateAll(): void {
    if (this.fs.existsSync(this.cacheDir)) {
      this.fs.rmSync(this.cacheDir, { recursive: true, force: true });
    }
  }
}
