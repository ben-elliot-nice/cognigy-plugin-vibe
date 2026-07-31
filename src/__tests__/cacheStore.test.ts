import { describe, it, expect, jest } from "@jest/globals";
import { CacheStore, projectKeyFromApiBaseUrl } from "../cache/cacheStore.js";
import { MemoryFs, type Clock } from "../cache/fsLike.js";

class TestClock implements Clock {
  private t = 0;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

function makeStore(overrides: { ttlMs?: number; resyncMs?: number } = {}) {
  const clock = new TestClock();
  const fs = new MemoryFs();
  const store = new CacheStore({
    baseDir: "/store",
    projectKey: "proj-1",
    ttlMs: overrides.ttlMs ?? 5 * 60_000,
    resyncMs: overrides.resyncMs ?? 4 * 3_600_000,
    clock,
    fs,
  });
  return { store, clock, fs };
}

describe("CacheStore.getOrFetch", () => {
  it("a hit within TTL avoids calling fetch", async () => {
    const { store } = makeStore();
    const fetchFn = jest.fn(async () => ({ _id: "f1", name: "Flow One" }));

    const first = await store.getOrFetch("flow", "f1", fetchFn);
    const second = await store.getOrFetch("flow", "f1", fetchFn);

    expect(first).toEqual({ _id: "f1", name: "Flow One" });
    expect(second).toEqual({ _id: "f1", name: "Flow One" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("an expired TTL triggers a refetch", async () => {
    const { store, clock } = makeStore({ ttlMs: 1000 });
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockResolvedValueOnce({ v: 2 });

    const first = await store.getOrFetch("flow", "f1", fetchFn as any);
    clock.advance(1001);
    const second = await store.getOrFetch("flow", "f1", fetchFn as any);

    expect(first).toEqual({ v: 1 });
    expect(second).toEqual({ v: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("invalidate forces the next read to refetch", async () => {
    const { store } = makeStore();
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({ v: "before-write" })
      .mockResolvedValueOnce({ v: "after-write" });

    const before = await store.getOrFetch("agent", "a1", fetchFn as any);
    store.invalidate("agent", "a1");
    const after = await store.getOrFetch("agent", "a1", fetchFn as any);

    expect(before).toEqual({ v: "before-write" });
    expect(after).toEqual({ v: "after-write" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("a session idle beyond the resync threshold wipes the cache even within TTL", async () => {
    const { store, clock } = makeStore({
      ttlMs: 60 * 60_000,
      resyncMs: 4 * 3_600_000,
    });
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({ v: "stale-candidate" })
      .mockResolvedValueOnce({ v: "resynced" });

    const first = await store.getOrFetch("flow", "f1", fetchFn as any);
    clock.advance(4 * 3_600_000 + 1); // idle > 4h, still within the 1h TTL
    const second = await store.getOrFetch("flow", "f1", fetchFn as any);

    expect(first).toEqual({ v: "stale-candidate" });
    expect(second).toEqual({ v: "resynced" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("CacheStore name->id resolution", () => {
  it("resolves a previously remembered id with no fetch involved", () => {
    const { store } = makeStore();
    expect(store.resolveId("flow", "My Flow")).toBeUndefined();
    store.rememberId("flow", "My Flow", "flow-abc");
    expect(store.resolveId("flow", "My Flow")).toBe("flow-abc");
  });

  it("forgetId removes a stale mapping", () => {
    const { store } = makeStore();
    store.rememberId("agentFlow", "agent-1", "flow-1");
    store.forgetId("agentFlow", "agent-1");
    expect(store.resolveId("agentFlow", "agent-1")).toBeUndefined();
  });
});

describe("projectKeyFromApiBaseUrl", () => {
  it("produces a filesystem-safe, stable key per host", () => {
    expect(projectKeyFromApiBaseUrl("https://api-trial.cognigy.ai")).toBe(
      "api-trial.cognigy.ai",
    );
    expect(projectKeyFromApiBaseUrl("https://api-trial.cognigy.ai/")).toBe(
      projectKeyFromApiBaseUrl("https://api-trial.cognigy.ai"),
    );
  });

  it("different hosts produce different keys", () => {
    expect(projectKeyFromApiBaseUrl("https://api-eu.cognigy.ai")).not.toBe(
      projectKeyFromApiBaseUrl("https://api-us.cognigy.ai"),
    );
  });
});
