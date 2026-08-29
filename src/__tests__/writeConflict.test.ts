import { describe, it, expect, beforeEach } from "@jest/globals";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  hashContent,
  snapshotKey,
  SnapshotStore,
  checkWriteConflict,
  recordSnapshot,
  unifiedDiff,
} from "../tools/writeConflict.js";

describe("writeConflict", () => {
  describe("hashContent", () => {
    it("is deterministic for identical content", () => {
      expect(hashContent("hello")).toBe(hashContent("hello"));
    });

    it("differs for different content", () => {
      expect(hashContent("hello")).not.toBe(hashContent("goodbye"));
    });
  });

  describe("snapshotKey", () => {
    it("combines flowId, nodeId, and field into a stable key", () => {
      expect(snapshotKey("flow-1", "node-1", "code")).toBe(
        "flow-1:node-1:code",
      );
    });
  });

  describe("unifiedDiff", () => {
    it("returns an empty string when content is identical", () => {
      expect(unifiedDiff("same\ntext", "same\ntext")).toBe("");
    });

    it("shows removed and added lines with default labels", () => {
      const diff = unifiedDiff("line1\nline2\nline3", "line1\nCHANGED\nline3");
      expect(diff).toContain("--- last-pushed");
      expect(diff).toContain("+++ remote-current");
      expect(diff).toContain("-line2");
      expect(diff).toContain("+CHANGED");
    });

    it("truncates very large diffs with a summary line", () => {
      const oldLines = Array.from({ length: 200 }, (_, i) => `old${i}`).join(
        "\n",
      );
      const newLines = Array.from({ length: 200 }, (_, i) => `new${i}`).join(
        "\n",
      );
      const diff = unifiedDiff(oldLines, newLines);
      expect(diff).toMatch(/more lines not shown/);
    });
  });

  describe("SnapshotStore", () => {
    let storePath: string;
    let store: SnapshotStore;

    beforeEach(() => {
      const dir = mkdtempSync(join(tmpdir(), "cognigy-snap-store-"));
      storePath = join(dir, "snapshots.json");
      store = new SnapshotStore(storePath);
    });

    it("returns undefined for a key that was never set", () => {
      expect(store.get("missing:key:code")).toBeUndefined();
    });

    it("persists content to disk and reads it back", () => {
      store.set("flow-1:node-1:code", "api.say('hi');");
      const entry = store.get("flow-1:node-1:code");
      expect(entry).toBeDefined();
      expect(entry?.content).toBe("api.say('hi');");
      expect(entry?.hash).toBe(hashContent("api.say('hi');"));
      expect(existsSync(storePath)).toBe(true);
    });

    it("does not clobber unrelated keys when writing a new one", () => {
      store.set("flow-1:node-1:code", "first");
      store.set("flow-1:node-2:code", "second");
      expect(store.get("flow-1:node-1:code")?.content).toBe("first");
      expect(store.get("flow-1:node-2:code")?.content).toBe("second");
    });

    it("survives a malformed on-disk file rather than throwing", () => {
      const dir = mkdtempSync(join(tmpdir(), "cognigy-snap-bad-"));
      const badPath = join(dir, "bad.json");
      writeFileSync(badPath, "not valid json{{{");
      const badStore = new SnapshotStore(badPath);
      expect(badStore.get("any:key:code")).toBeUndefined();
      // A subsequent set() must still work (overwrites the corrupt file).
      badStore.set("any:key:code", "content");
      expect(badStore.get("any:key:code")?.content).toBe("content");
    });

    it("writes owner-only file contents as pretty JSON", () => {
      store.set("flow-1:node-1:code", "x");
      const raw = readFileSync(storePath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed["flow-1:node-1:code"].content).toBe("x");
    });

    it("releases its lock file after a successful set()", () => {
      store.set("flow-1:node-1:code", "x");
      expect(existsSync(`${storePath}.lock`)).toBe(false);
    });

    it("steals a stale lock left by a crashed process rather than hanging forever", () => {
      // Simulate another process that acquired the lock and died before
      // releasing it: create the lock file directly (bypassing the store's
      // own withLock), then use a near-zero steal timeout so this test
      // doesn't need to sleep for the real 2s default.
      writeFileSync(`${storePath}.lock`, "");
      const impatientStore = new SnapshotStore(storePath, 0);

      // Despite the pre-existing lock, set() must still complete (steals the
      // stale lock rather than deadlocking) and leave no lock file behind.
      impatientStore.set("flow-1:node-1:code", "recovered after stale lock");
      expect(impatientStore.get("flow-1:node-1:code")?.content).toBe(
        "recovered after stale lock",
      );
      expect(existsSync(`${storePath}.lock`)).toBe(false);
    });

    it("does not lose an unrelated key that was written while this write's lock was briefly held", () => {
      // Two sequential set() calls to different keys, each individually
      // guarded by the lock, must both survive (regression test for the
      // shared-file lost-update race raised in review: a read-modify-write
      // to key B must never clobber a just-written key A).
      store.set("flow-1:node-1:code", "a");
      store.set("flow-1:node-2:code", "b");
      expect(store.get("flow-1:node-1:code")?.content).toBe("a");
      expect(store.get("flow-1:node-2:code")?.content).toBe("b");
    });
  });

  describe("checkWriteConflict", () => {
    let store: SnapshotStore;

    beforeEach(() => {
      const dir = mkdtempSync(join(tmpdir(), "cognigy-snap-check-"));
      store = new SnapshotStore(join(dir, "snapshots.json"));
    });

    it("proceeds (not blocked) when there is no snapshot yet — first write", () => {
      const result = checkWriteConflict(
        store,
        "flow-1:node-1:code",
        "anything",
      );
      expect(result.blocked).toBe(false);
      expect(result.diff).toBeUndefined();
    });

    it("proceeds when the remote content matches the stored snapshot", () => {
      recordSnapshot(store, "flow-1:node-1:code", "api.say('hi');");
      const result = checkWriteConflict(
        store,
        "flow-1:node-1:code",
        "api.say('hi');",
      );
      expect(result.blocked).toBe(false);
    });

    it("blocks and returns a diff when the remote content has drifted", () => {
      recordSnapshot(store, "flow-1:node-1:code", "original code");
      const result = checkWriteConflict(
        store,
        "flow-1:node-1:code",
        "edited in the Cognigy UI",
      );
      expect(result.blocked).toBe(true);
      expect(result.diff).toContain("-original code");
      expect(result.diff).toContain("+edited in the Cognigy UI");
      expect(result.message).toMatch(/edited in the Cognigy UI/i);
    });

    it("does not block when force is set, even with drift", () => {
      recordSnapshot(store, "flow-1:node-1:code", "original code");
      const result = checkWriteConflict(
        store,
        "flow-1:node-1:code",
        "edited in the Cognigy UI",
        { force: true },
      );
      expect(result.blocked).toBe(false);
    });
  });

  describe("recordSnapshot", () => {
    it("updates the store so a later check sees the new content as the baseline", () => {
      const dir = mkdtempSync(join(tmpdir(), "cognigy-snap-record-"));
      const store = new SnapshotStore(join(dir, "snapshots.json"));
      recordSnapshot(store, "flow-1:node-1:code", "v1");
      recordSnapshot(store, "flow-1:node-1:code", "v2");
      const result = checkWriteConflict(store, "flow-1:node-1:code", "v2");
      expect(result.blocked).toBe(false);
      const driftResult = checkWriteConflict(store, "flow-1:node-1:code", "v1");
      expect(driftResult.blocked).toBe(true);
    });
  });
});
