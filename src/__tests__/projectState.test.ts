import { describe, it, expect } from "@jest/globals";
import { ProjectState } from "../cache/projectState.js";
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

describe("ProjectState", () => {
  it("creates its config dir scoped by project key", () => {
    const fs = new MemoryFs();
    const state = new ProjectState(
      "/base",
      "proj-123",
      4 * 3_600_000,
      new TestClock(),
      fs,
    );
    expect(state.configDir).toBe("/base/proj-123");
    expect(fs.existsSync("/base/proj-123")).toBe(true);
  });

  it("uses .unscoped when no project key is given", () => {
    const fs = new MemoryFs();
    const state = new ProjectState(
      "/base",
      undefined,
      4 * 3_600_000,
      new TestClock(),
      fs,
    );
    expect(state.configDir).toBe("/base/.unscoped");
  });

  it("get/set round-trips through nested paths and auto-saves", () => {
    const fs = new MemoryFs();
    const clock = new TestClock();
    const s1 = new ProjectState("/base", "proj-123", 4 * 3_600_000, clock, fs);
    s1.set(["flows", "My Flow", "id"], "flow-xyz");

    const s2 = new ProjectState("/base", "proj-123", 4 * 3_600_000, clock, fs);
    expect(s2.get(["flows", "My Flow", "id"])).toBe("flow-xyz");
  });

  it("seed values are available but runtime overrides seed", () => {
    const fs = new MemoryFs();
    fs.mkdirSync("/base/proj-123", { recursive: true });
    fs.writeFileSync(
      "/base/proj-123/.state-seed.json",
      JSON.stringify({ x: "seed", flows: { Main: { id: "seed-id" } } }),
    );
    fs.writeFileSync(
      "/base/proj-123/.state.json",
      JSON.stringify({ x: "runtime" }),
    );

    const state = new ProjectState(
      "/base",
      "proj-123",
      4 * 3_600_000,
      new TestClock(),
      fs,
    );
    expect(state.get(["x"])).toBe("runtime");
    expect(state.get(["flows", "Main", "id"])).toBe("seed-id");
  });

  it("resolveId/rememberId provide name->id resolution", () => {
    const fs = new MemoryFs();
    const state = new ProjectState(
      "/base",
      "proj-123",
      4 * 3_600_000,
      new TestClock(),
      fs,
    );
    expect(state.resolveId("flows", "My Flow")).toBeUndefined();
    state.rememberId("flows", "My Flow", "flow-1");
    expect(state.resolveId("flows", "My Flow")).toBe("flow-1");
  });

  it("needsResync is true before any interaction is recorded", () => {
    const fs = new MemoryFs();
    const state = new ProjectState(
      "/base",
      "proj-123",
      4 * 3_600_000,
      new TestClock(),
      fs,
    );
    expect(state.needsResync()).toBe(true);
  });

  it("needsResync is false right after touchInteraction", () => {
    const fs = new MemoryFs();
    const state = new ProjectState(
      "/base",
      "proj-123",
      4 * 3_600_000,
      new TestClock(),
      fs,
    );
    state.touchInteraction();
    expect(state.needsResync()).toBe(false);
  });

  it("needsResync becomes true once the idle gap exceeds resyncMs (~4h)", () => {
    const fs = new MemoryFs();
    const clock = new TestClock();
    const resyncMs = 4 * 3_600_000;
    const state = new ProjectState("/base", "proj-123", resyncMs, clock, fs);
    state.touchInteraction();
    clock.advance(resyncMs - 1);
    expect(state.needsResync()).toBe(false);
    clock.advance(2);
    expect(state.needsResync()).toBe(true);
  });

  it("corrupt state file does not throw and behaves like empty state", () => {
    const fs = new MemoryFs();
    fs.mkdirSync("/base/proj-123", { recursive: true });
    fs.writeFileSync("/base/proj-123/.state.json", "not json");
    const state = new ProjectState(
      "/base",
      "proj-123",
      4 * 3_600_000,
      new TestClock(),
      fs,
    );
    expect(state.get(["anything"])).toBeUndefined();
  });

  it("corrupt interaction timestamp forces a resync rather than throwing", () => {
    const fs = new MemoryFs();
    const state = new ProjectState(
      "/base",
      "proj-123",
      4 * 3_600_000,
      new TestClock(),
      fs,
    );
    fs.mkdirSync("/base/proj-123", { recursive: true });
    fs.writeFileSync("/base/proj-123/last-interaction", "not-a-number");
    expect(state.needsResync()).toBe(true);
  });

  it("bindProject re-scopes state and does not leak data across projects", () => {
    const fs = new MemoryFs();
    const state = new ProjectState(
      "/base",
      undefined,
      4 * 3_600_000,
      new TestClock(),
      fs,
    );
    state.set(["flows", "Old"], { id: "old-id" });

    state.bindProject("proj-456");

    expect(state.projectId).toBe("proj-456");
    expect(state.configDir).toBe("/base/proj-456");
    expect(state.get(["flows", "Old"])).toBeUndefined();
  });

  it("bindProject loads existing on-disk state for the new project", () => {
    const fs = new MemoryFs();
    fs.mkdirSync("/base/proj-789", { recursive: true });
    fs.writeFileSync(
      "/base/proj-789/.state.json",
      JSON.stringify({ flows: { Main: { id: "existing-id" } } }),
    );
    const state = new ProjectState(
      "/base",
      undefined,
      4 * 3_600_000,
      new TestClock(),
      fs,
    );
    state.bindProject("proj-789");
    expect(state.get(["flows", "Main", "id"])).toBe("existing-id");
  });

  it("bindProject with the same project key is a no-op", () => {
    const fs = new MemoryFs();
    const state = new ProjectState(
      "/base",
      "proj-123",
      4 * 3_600_000,
      new TestClock(),
      fs,
    );
    state.set(["flows", "Canary"], { id: "canary" });
    state.bindProject("proj-123");
    expect(state.get(["flows", "Canary", "id"])).toBe("canary");
  });

  it("asDict returns a deep copy that mutation cannot affect", () => {
    const fs = new MemoryFs();
    const state = new ProjectState(
      "/base",
      "proj-123",
      4 * 3_600_000,
      new TestClock(),
      fs,
    );
    state.set(["flows", "Main"], { id: "flow-1" });
    const dict = state.asDict() as any;
    dict.flows.Main.id = "mutated";
    expect(state.get(["flows", "Main", "id"])).toBe("flow-1");
  });
});
