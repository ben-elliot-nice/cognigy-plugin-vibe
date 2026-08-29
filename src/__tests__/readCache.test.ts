import { describe, it, expect } from "@jest/globals";
import { ReadCache } from "../cache/readCache.js";
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

function makeCache(ttlMs = 60_000) {
  const clock = new TestClock();
  const fs = new MemoryFs();
  const cache = new ReadCache("/cache", ttlMs, clock, fs);
  return { cache, clock, fs };
}

describe("ReadCache", () => {
  it("miss returns null / not fresh", () => {
    const { cache } = makeCache();
    const { data, fresh } = cache.get("flows", "123");
    expect(data).toBeNull();
    expect(fresh).toBe(false);
  });

  it("set then get within TTL is a fresh hit", () => {
    const { cache } = makeCache();
    cache.set("flows", "123", { _id: "123", name: "My Flow" });
    const { data, fresh } = cache.get<{ _id: string }>("flows", "123");
    expect(data?._id).toBe("123");
    expect(fresh).toBe(true);
  });

  it("expired entry is returned but reported stale", () => {
    const { cache, clock } = makeCache(1000);
    cache.set("flows", "abc", { _id: "abc" });
    clock.advance(1001);
    const { data, fresh } = cache.get("flows", "abc");
    expect(data).not.toBeNull();
    expect(fresh).toBe(false);
  });

  it("invalidate removes the entry", () => {
    const { cache } = makeCache();
    cache.set("flows", "123", { _id: "123" });
    cache.invalidate("flows", "123");
    const { data } = cache.get("flows", "123");
    expect(data).toBeNull();
  });

  it("invalidate on a missing entry does not throw", () => {
    const { cache } = makeCache();
    expect(() => cache.invalidate("flows", "nonexistent")).not.toThrow();
  });

  it("invalidateAll wipes every entry", () => {
    const { cache } = makeCache();
    cache.set("flows", "123", { _id: "123" });
    cache.set("aiagents", "agent-1", { _id: "agent-1" });
    cache.invalidateAll();
    expect(cache.get("flows", "123").data).toBeNull();
    expect(cache.get("aiagents", "agent-1").data).toBeNull();
  });

  it("corrupted cache file is treated as a miss, not a crash", () => {
    const { cache, fs } = makeCache();
    fs.mkdirSync("/cache/flows", { recursive: true });
    fs.writeFileSync("/cache/flows/bad.json", "not json");
    const { data, fresh } = cache.get("flows", "bad");
    expect(data).toBeNull();
    expect(fresh).toBe(false);
  });

  it("update overwrites the previous value", () => {
    const { cache } = makeCache();
    cache.set("flows", "123", { name: "old" });
    cache.set("flows", "123", { name: "new" });
    expect(cache.get<{ name: string }>("flows", "123").data?.name).toBe("new");
  });
});
