/**
 * Write-conflict detection for node-config writes (code node, aiAgentJobTool
 * config, xApp/HTML node). Prevents the plugin from silently clobbering
 * edits made in the Cognigy UI (or by another agent) between this tool's
 * two most recent writes to the same node/field.
 *
 * Pattern:
 *   1. On write #1, there is no stored snapshot — the write proceeds, and
 *      the pushed content is snapshotted.
 *   2. On write #2 (and beyond), the caller first fetches the *current
 *      remote* content and compares it against the stored snapshot (i.e.
 *      "what we last pushed"). If they match, nobody touched it in the UI
 *      meanwhile — proceed, and refresh the snapshot with the new content.
 *   3. If they differ, someone edited the node since our last push — block
 *      the write and return a diff, unless the caller explicitly forces it.
 *
 * Pure, dependency-free functions (hashing via Node's built-in `crypto`, a
 * hand-rolled unified line diff) plus a small JSON-file-backed store. The
 * store's file path is injectable so tests never touch a real machine's
 * `~/.cognigy-plugin` directory.
 */
import { createHash } from "crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

export const DEFAULT_SNAPSHOT_STORE_PATH = join(
  homedir(),
  ".cognigy-plugin",
  "write-snapshots.json",
);

export interface SnapshotEntry {
  /** sha256 of `content`, stored alongside for quick equality checks. */
  hash: string;
  /** The exact content last pushed by this tool. */
  content: string;
  updatedAt: string;
}

/** sha256 hex digest of a string — used to compare content cheaply. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Build the snapshot key for a given flow/node/field. */
export function snapshotKey(
  flowId: string,
  nodeId: string,
  field: string,
): string {
  return `${flowId}:${nodeId}:${field}`;
}

/**
 * Every key lives in one shared JSON file (rather than the reference
 * implementation's one-file-per-node layout). That's a deliberate
 * simplification for a single MCP server process, but it does mean a naive
 * read-modify-write could lose an update if two writes to *different* keys
 * race: within one Node process, synchronous fs calls with no `await` inside
 * `set()` already make each read-modify-write atomic with respect to other
 * JS running in that process, but a user can have more than one MCP server
 * process alive at once (e.g. two concurrent Claude Code sessions), and
 * across processes that guarantee doesn't hold. `set()` therefore wraps its
 * read-modify-write in a lock file (atomic `open(..., "wx")`), so a second
 * process's write waits for the first to finish instead of clobbering it.
 * Missing/malformed store files are treated as empty rather than throwing,
 * since a corrupt cache must never block a real write — but the loss of
 * protection is logged to stderr so it isn't silent.
 */
export class SnapshotStore {
  constructor(
    private readonly filePath: string = DEFAULT_SNAPSHOT_STORE_PATH,
    /** Stale-lock steal timeout; injectable so tests don't wait 2s. */
    private readonly lockTimeoutMs: number = 2000,
  ) {}

  private readAll(): Record<string, SnapshotEntry> {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, SnapshotEntry>;
      }
    } catch (err: any) {
      // Missing file is normal (nothing snapshotted yet). A malformed file
      // (parse error, or valid-but-wrong-shape JSON) is not — behave as if
      // nothing was ever snapshotted, but say so, since every previously
      // tracked node silently loses conflict protection at once.
      if (err?.code !== "ENOENT") {
        console.error(
          `[cognigy-plugin] write-conflict snapshot store at ${this.filePath} is unreadable/corrupt ` +
            `(${err?.message ?? err}); treating it as empty. Conflict detection for previously-tracked ` +
            "nodes is reset until their next write.",
        );
      }
    }
    return {};
  }

  private writeAll(data: Record<string, SnapshotEntry>): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), {
      mode: 0o600,
      encoding: "utf-8",
    });
    renameSync(tmp, this.filePath);
  }

  /**
   * Cross-process advisory lock around a read-modify-write, using an
   * atomically-created lock directory as the mutex (`mkdirSync` either
   * succeeds exclusively or throws `EEXIST`). Steals stale locks left by a
   * crashed process after `timeoutMs` rather than deadlocking forever.
   */
  private withLock<T>(fn: () => T): T {
    const lockPath = `${this.filePath}.lock`;
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const start = Date.now();
    for (;;) {
      try {
        const fd = openSync(lockPath, "wx");
        closeSync(fd);
        break;
      } catch (err: any) {
        if (err?.code !== "EEXIST") throw err;
        if (Date.now() - start > this.lockTimeoutMs) {
          // Stale lock (owning process crashed/was killed) — steal it
          // rather than block forever.
          try {
            unlinkSync(lockPath);
          } catch {
            // Another process already cleaned it up — loop and retry.
          }
          continue;
        }
        // Synchronous API precludes an async sleep; spin briefly. Store
        // writes are rare (one per node create/update) and fast, so the
        // contention window is short.
      }
    }
    try {
      return fn();
    } finally {
      try {
        unlinkSync(lockPath);
      } catch {
        // Already removed (e.g. stolen by a timed-out waiter) — fine.
      }
    }
  }

  get(key: string): SnapshotEntry | undefined {
    return this.readAll()[key];
  }

  set(key: string, content: string): void {
    this.withLock(() => {
      const data = this.readAll();
      data[key] = {
        hash: hashContent(content),
        content,
        updatedAt: new Date().toISOString(),
      };
      this.writeAll(data);
    });
  }

  /** Only used by tests that want to assert on the on-disk file directly. */
  exists(): boolean {
    return existsSync(this.filePath);
  }
}

const MAX_DIFF_LINES = 50;

/**
 * Compact unified-style line diff between `oldContent` (what we last pushed)
 * and `newContent` (what's live on the remote now). Uses an LCS-based line
 * alignment (fine for the code/tool/HTML file sizes this plugin pushes) and
 * truncates to MAX_DIFF_LINES like the diff, prioritising a clear, actionable
 * message over exhaustive output.
 */
export function unifiedDiff(
  oldContent: string,
  newContent: string,
  opts: { fromLabel?: string; toLabel?: string; context?: number } = {},
): string {
  const fromLabel = opts.fromLabel ?? "last-pushed";
  const toLabel = opts.toLabel ?? "remote-current";
  const context = opts.context ?? 3;

  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const ops = diffOps(oldLines, newLines);
  const hunks = buildHunks(ops, context);

  if (hunks.length === 0) return "";

  const out: string[] = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  for (const hunk of hunks) {
    out.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    );
    out.push(...hunk.body);
  }

  if (out.length > MAX_DIFF_LINES) {
    const truncated = out.slice(0, MAX_DIFF_LINES);
    truncated.push(`... (${out.length - MAX_DIFF_LINES} more lines not shown)`);
    return truncated.join("\n");
  }
  return out.join("\n");
}

type DiffOp =
  | { type: "equal"; oldLine: string; newLine: string }
  | { type: "remove"; oldLine: string }
  | { type: "add"; newLine: string };

/** LCS-based line diff, backtracked into a flat op sequence. */
function diffOps(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length;
  const m = newLines.length;

  // Guard against pathological O(n*m) memory on huge files — fall back to a
  // coarse "everything changed" diff rather than allocating a huge table.
  if (n * m > 4_000_000) {
    const ops: DiffOp[] = [];
    for (const l of oldLines) ops.push({ type: "remove", oldLine: l });
    for (const l of newLines) ops.push({ type: "add", newLine: l });
    return ops;
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: "equal", oldLine: oldLines[i], newLine: newLines[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "remove", oldLine: oldLines[i] });
      i++;
    } else {
      ops.push({ type: "add", newLine: newLines[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "remove", oldLine: oldLines[i++] });
  while (j < m) ops.push({ type: "add", newLine: newLines[j++] });
  return ops;
}

interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  body: string[];
}

/** Group diff ops into unified-diff hunks with N lines of context. */
function buildHunks(ops: DiffOp[], context: number): Hunk[] {
  const changeIndexes: number[] = [];
  ops.forEach((op, idx) => {
    if (op.type !== "equal") changeIndexes.push(idx);
  });
  if (changeIndexes.length === 0) return [];

  // Merge nearby changes (within 2*context of each other) into one hunk.
  const ranges: Array<[number, number]> = [];
  let rangeStart = changeIndexes[0];
  let rangeEnd = changeIndexes[0];
  for (let k = 1; k < changeIndexes.length; k++) {
    if (changeIndexes[k] - rangeEnd <= context * 2) {
      rangeEnd = changeIndexes[k];
    } else {
      ranges.push([rangeStart, rangeEnd]);
      rangeStart = changeIndexes[k];
      rangeEnd = changeIndexes[k];
    }
  }
  ranges.push([rangeStart, rangeEnd]);

  const hunks: Hunk[] = [];
  for (const [start, end] of ranges) {
    const from = Math.max(0, start - context);
    const to = Math.min(ops.length - 1, end + context);
    const slice = ops.slice(from, to + 1);

    let oldStart = 0;
    let newStart = 0;
    for (let k = 0; k < from; k++) {
      if (ops[k].type !== "add") oldStart++;
      if (ops[k].type !== "remove") newStart++;
    }

    let oldCount = 0;
    let newCount = 0;
    const body: string[] = [];
    for (const op of slice) {
      if (op.type === "equal") {
        body.push(` ${op.oldLine}`);
        oldCount++;
        newCount++;
      } else if (op.type === "remove") {
        body.push(`-${op.oldLine}`);
        oldCount++;
      } else {
        body.push(`+${op.newLine}`);
        newCount++;
      }
    }
    hunks.push({
      oldStart: oldStart + 1,
      oldLines: oldCount,
      newStart: newStart + 1,
      newLines: newCount,
      body,
    });
  }
  return hunks;
}

export interface WriteConflictResult {
  blocked: boolean;
  diff?: string;
  message?: string;
}

/**
 * Decide whether a write should be blocked. `remoteContent` is what's live
 * on the server right now; the stored snapshot is what this tool last
 * pushed. No snapshot means this is the first push for this key — always
 * proceeds. `force: true` always proceeds (but the caller is responsible
 * for updating the snapshot afterwards either way).
 */
export function checkWriteConflict(
  store: SnapshotStore,
  key: string,
  remoteContent: string,
  opts: { force?: boolean } = {},
): WriteConflictResult {
  const snapshot = store.get(key);
  if (!snapshot) return { blocked: false };
  if (snapshot.content === remoteContent) return { blocked: false };
  if (opts.force) {
    return {
      blocked: false,
      message:
        "Remote content differs from the last snapshot pushed by this tool, but the write was forced.",
    };
  }
  return {
    blocked: true,
    message:
      "This node was edited in the Cognigy UI (or by another agent) since the last push from this tool. " +
      "Review the diff and either incorporate the remote changes or retry with forceWrite: true to overwrite.",
    diff: unifiedDiff(snapshot.content, remoteContent),
  };
}

/** Record what was just successfully pushed, so the next write can detect drift. */
export function recordSnapshot(
  store: SnapshotStore,
  key: string,
  content: string,
): void {
  store.set(key, content);
}
