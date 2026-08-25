/**
 * Facade combining `ReadCache` (per-resource TTL cache) and `ProjectState`
 * (persistent name->id map + idle tracking) into the single object
 * `ToolHandlers` reaches for on the read path (migration-docs item #4:
 * "Persistent project state and read cache").
 *
 * Design:
 * - Cache-first reads: `getOrFetch(type, id, fetch)` returns the cached value
 *   if it's within `ttlMs` (~5 min), otherwise calls `fetch`, stores the
 *   result, and returns it.
 * - Idle resync: every `getOrFetch` first checks `ProjectState.needsResync()`
 *   (last activity > ~4h ago) and wipes the whole cache before proceeding —
 *   long-idle sessions never trust stale platform state.
 * - Invalidate-on-write: handlers call `invalidate(type, id)` after any
 *   create/update/delete so a mutation is never masked by a stale cache
 *   entry. This is the safety property that makes the cache OK to leave on
 *   by default: a cache hit can only ever reflect data at least as new as
 *   the last write this process made.
 * - Name->id resolution: `resolveId`/`rememberId` wrap `ProjectState` so
 *   handlers can look up e.g. a flow id by name without a list call, and
 *   record the mapping the first time a name is seen.
 *
 * Everything here is a thin, pure wrapper — no I/O of its own beyond what
 * `ReadCache`/`ProjectState` already do, and both take injected fs/clock so
 * this whole module is unit-testable without real disk or timers.
 */
import { join } from "path";
import * as nodeFs from "fs";
import { type Clock, type FsLike, systemClock } from "./fsLike.js";
import { ReadCache } from "./readCache.js";
import { ProjectState, UNSCOPED_DIR } from "./projectState.js";

export interface CacheStoreOptions {
  /** Root directory this store's cache + state files live under. */
  baseDir: string;
  /** Scopes state (and, indirectly, cache-invalidation semantics) to one project/org so multiple Cognigy projects sharing a machine don't collide. */
  projectKey?: string;
  /** Read-cache freshness window. Defaults to 5 minutes, matching the reference implementation. */
  ttlMs?: number;
  /** Idle-resync threshold. Defaults to 4 hours. */
  resyncMs?: number;
  clock?: Clock;
  fs?: FsLike;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RESYNC_MS = 4 * 60 * 60 * 1000;

export class CacheStore {
  readonly cache: ReadCache;
  readonly state: ProjectState;

  constructor(opts: CacheStoreOptions) {
    const clock = opts.clock ?? systemClock;
    const fs = opts.fs ?? nodeFs;
    this.cache = new ReadCache(
      // Scoped per project/org the same way `ProjectState` is below — an
      // unscoped `entries` dir would let two different Cognigy projects on
      // one machine share (and idle-resync-wipe) each other's read cache.
      join(opts.baseDir, "entries", opts.projectKey || UNSCOPED_DIR),
      opts.ttlMs ?? DEFAULT_TTL_MS,
      clock,
      fs,
    );
    this.state = new ProjectState(
      join(opts.baseDir, "state"),
      opts.projectKey,
      opts.resyncMs ?? DEFAULT_RESYNC_MS,
      clock,
      fs,
    );
  }

  /**
   * Cache-first read. Resyncs (wipes the cache) first if the project has
   * been idle past the resync threshold, so a hit can never survive an idle
   * gap unnoticed. On a fresh hit, returns the cached value with no fetch.
   * Otherwise calls `fetch`, caches, and returns the result.
   */
  async getOrFetch<T>(
    resourceType: string,
    resourceId: string,
    fetch: () => Promise<T>,
  ): Promise<T> {
    if (this.state.needsResync()) {
      this.cache.invalidateAll();
      // The name->id map is just as capable of pointing at a deleted/renamed
      // resource as the read cache is — an idle gap must invalidate both.
      this.state.clearAllNameMappings();
    }
    this.state.touchInteraction();

    const { data, fresh } = this.cache.get<T>(resourceType, resourceId);
    if (fresh && data !== null) {
      return data;
    }
    const fetched = await fetch();
    this.cache.set(resourceType, resourceId, fetched);
    return fetched;
  }

  /** Call after any create/update/delete affecting this resource so a stale entry is never served again. */
  invalidate(resourceType: string, resourceId: string): void {
    this.cache.invalidate(resourceType, resourceId);
  }

  resolveId(namespace: string, name: string): string | undefined {
    return this.state.resolveId(namespace, name);
  }

  rememberId(namespace: string, name: string, id: string): void {
    this.state.rememberId(namespace, name, id);
  }

  /** Drop a stale name->id mapping, e.g. after the underlying resource is deleted. */
  forgetId(namespace: string, name: string): void {
    this.state.set([namespace, name], undefined);
  }

  /**
   * Drop every name->id mapping in `namespace` that resolves to `id`. Use
   * this when the caller knows the deleted/renamed resource's id but not
   * (or not only) the name it was remembered under — e.g. deleting a flow
   * directly should also forget any `agentFlow` mapping that pointed at it.
   */
  forgetIdByValue(namespace: string, id: string): void {
    this.state.forgetByResolvedId(namespace, id);
  }
}

/**
 * Derive a filesystem-safe project key from the Cognigy API base URL, so
 * different Cognigy projects/orgs on the same machine get separate cache
 * directories instead of colliding. Not a hash — kept human-readable for
 * anyone poking around `~/.cognigy-plugin/cache`.
 */
export function projectKeyFromApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/[^a-zA-Z0-9.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}
