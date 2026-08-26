import { describe, it, expect, jest } from "@jest/globals";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import type { ChildProcess } from "child_process";
import { Supervisor } from "../dev/supervisor.js";
import { RELOAD_EXIT_CODE } from "../dev/constants.js";

/** Minimal fake child process: real PassThrough stdio + an EventEmitter for lifecycle events. */
function makeFakeChild() {
  const child = new EventEmitter() as unknown as ChildProcess & {
    stdout: PassThrough;
    stdin: PassThrough & { destroy: jest.Mock };
    kill: jest.Mock;
  };
  child.stdout = new PassThrough();
  const stdin = new PassThrough();
  (stdin as any).destroy = jest.fn();
  child.stdin = stdin as any;
  child.kill = jest.fn();
  return child;
}

function writeLine(stream: PassThrough, obj: unknown): void {
  stream.write(JSON.stringify(obj) + "\n");
}

describe("dev supervisor", () => {
  it("respawns the child when it exits with RELOAD_EXIT_CODE (42)", () => {
    const children = [makeFakeChild(), makeFakeChild()];
    let spawnCalls = 0;
    const spawnChild = jest.fn(() => {
      const child = children[spawnCalls];
      spawnCalls += 1;
      return child;
    });
    const exit = jest.fn();
    const clientStdin = new PassThrough();
    const clientStdout = new PassThrough();

    const supervisor = new Supervisor({
      spawnChild: spawnChild as any,
      stdin: clientStdin,
      stdout: clientStdout,
      exit: exit as any,
    });
    supervisor.start();

    expect(spawnChild).toHaveBeenCalledTimes(1);

    children[0].emit("exit", RELOAD_EXIT_CODE);

    expect(spawnChild).toHaveBeenCalledTimes(2);
    expect(exit).not.toHaveBeenCalled();
  });

  it("does NOT respawn and exits when the child exits with code 0", () => {
    const children = [makeFakeChild()];
    const spawnChild = jest.fn(() => children[0]);
    const exit = jest.fn();
    const clientStdin = new PassThrough();
    const clientStdout = new PassThrough();

    const supervisor = new Supervisor({
      spawnChild: spawnChild as any,
      stdin: clientStdin,
      stdout: clientStdout,
      exit: exit as any,
    });
    supervisor.start();

    expect(spawnChild).toHaveBeenCalledTimes(1);

    children[0].emit("exit", 0);

    expect(spawnChild).toHaveBeenCalledTimes(1); // no respawn
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("does NOT respawn and propagates a crash exit code (e.g. 1)", () => {
    const children = [makeFakeChild()];
    const spawnChild = jest.fn(() => children[0]);
    const exit = jest.fn();
    const clientStdin = new PassThrough();
    const clientStdout = new PassThrough();

    const supervisor = new Supervisor({
      spawnChild: spawnChild as any,
      stdin: clientStdin,
      stdout: clientStdout,
      exit: exit as any,
    });
    supervisor.start();

    children[0].emit("exit", 1);

    expect(spawnChild).toHaveBeenCalledTimes(1); // no respawn
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("treats a null exit code (signal-killed child, e.g. SIGKILL/OOM) as exit(1) via the `code ?? 1` fallback", () => {
    const children = [makeFakeChild()];
    const spawnChild = jest.fn(() => children[0]);
    const exit = jest.fn();
    const clientStdin = new PassThrough();
    const clientStdout = new PassThrough();

    const supervisor = new Supervisor({
      spawnChild: spawnChild as any,
      stdin: clientStdin,
      stdout: clientStdout,
      exit: exit as any,
    });
    supervisor.start();

    children[0].emit("exit", null);

    expect(spawnChild).toHaveBeenCalledTimes(1); // no respawn
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("characterization: a partial (non-newline-terminated) line lost when the child's stdout pipe is torn down abruptly (signal-killed child)", (done) => {
    const child = makeFakeChild();
    const spawnChild = jest.fn(() => child);
    const exit = jest.fn();
    const clientStdin = new PassThrough();
    const clientStdout = new PassThrough();
    const received: string[] = [];

    const supervisor = new Supervisor({
      spawnChild: spawnChild as any,
      stdin: clientStdin,
      stdout: clientStdout,
      exit: exit as any,
    });
    supervisor.start();

    clientStdout.on("data", (chunk: Buffer) => {
      received.push(chunk.toString());
    });

    // Write a JSON-RPC line with no trailing newline, then tear the pipe down
    // abruptly (as with a signal-killed/OOM child, where the fd closes
    // without a clean EOF) and emit exit. This is the documented KNOWN
    // LIMITATION in supervisor.ts: readline only emits "line" on a newline
    // boundary, so a dangling fragment written right as the child dies can
    // be lost. (A clean `stream.end()` — normal process exit closing its
    // stdout fd — actually still flushes the trailing partial line via
    // readline's internal buffer; it's the abrupt-teardown path that loses
    // it, which this test pins down.)
    child.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: 99, result: { ok: true } }),
    );
    child.stdout.destroy();
    child.emit("exit", 0);

    setImmediate(() => {
      expect(received.join("")).not.toContain('"id":99');
      expect(exit).toHaveBeenCalledWith(0);
      done();
    });
  });

  it("double-reload race: a second rc=42 exit while restarting doesn't double-respawn or corrupt the pipe", (done) => {
    const children = [makeFakeChild(), makeFakeChild(), makeFakeChild()];
    let spawnCalls = 0;
    const spawnChild = jest.fn(() => children[spawnCalls++]);
    const exit = jest.fn();
    const clientStdin = new PassThrough();
    const clientStdout = new PassThrough();

    const supervisor = new Supervisor({
      spawnChild: spawnChild as any,
      stdin: clientStdin,
      stdout: clientStdout,
      exit: exit as any,
    });
    supervisor.start();

    expect(spawnChild).toHaveBeenCalledTimes(1);

    // First reload trigger.
    children[0].emit("exit", RELOAD_EXIT_CODE);
    expect(spawnChild).toHaveBeenCalledTimes(2);

    // Second reload trigger fires in quick succession, before the first
    // restart's handshake replay has completed (no initParams recorded yet,
    // so finishRestart() runs synchronously and `restarting` is already back
    // to false) — re-entering doRestart() should still just spawn once more
    // and not throw or leave the pipe in a broken state.
    children[1].emit("exit", RELOAD_EXIT_CODE);

    setImmediate(() => {
      expect(spawnChild).toHaveBeenCalledTimes(3);
      expect(exit).not.toHaveBeenCalled();

      // The pipe still works after the double-reload: the latest child's
      // stdout is forwarded to the client normally. (Ignore any
      // notifications/tools/list_changed lines emitted by the restarts
      // themselves — wait specifically for our result payload.)
      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        if (text.includes('"result"')) {
          clientStdout.off("data", onData);
          done();
        }
      };
      clientStdout.on("data", onData);
      writeLine(children[2].stdout, {
        jsonrpc: "2.0",
        id: 1,
        result: { ok: true },
      });
    });
  });

  it("forwards child stdout lines to the client stdout during normal operation", (done) => {
    const child = makeFakeChild();
    const spawnChild = jest.fn(() => child);
    const clientStdin = new PassThrough();
    const clientStdout = new PassThrough();

    const supervisor = new Supervisor({
      spawnChild: spawnChild as any,
      stdin: clientStdin,
      stdout: clientStdout,
      exit: jest.fn() as any,
    });
    supervisor.start();

    clientStdout.once("data", (chunk: Buffer) => {
      expect(chunk.toString()).toContain('"result"');
      done();
    });

    writeLine(child.stdout, { jsonrpc: "2.0", id: 1, result: { ok: true } });
  });

  it("replays the initialize handshake to the new child and notifies tools/list_changed on restart", (done) => {
    const children = [makeFakeChild(), makeFakeChild()];
    let spawnCalls = 0;
    const spawnChild = jest.fn(() => children[spawnCalls++]);
    const clientStdin = new PassThrough();
    const clientStdout = new PassThrough();

    const supervisor = new Supervisor({
      spawnChild: spawnChild as any,
      stdin: clientStdin,
      stdout: clientStdout,
      exit: jest.fn() as any,
    });
    supervisor.start();

    // Client sends the original initialize request through the supervisor.
    writeLine(clientStdin, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    });

    const newChildWrites: string[] = [];
    setImmediate(() => {
      children[1].stdin.on("data", (chunk: Buffer) => {
        newChildWrites.push(chunk.toString());
      });

      clientStdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        if (text.includes("notifications/tools/list_changed")) {
          expect(
            newChildWrites.some((w) => w.includes("__supervisor_reinit__")),
          ).toBe(true);
          expect(
            newChildWrites.some((w) => w.includes("notifications/initialized")),
          ).toBe(true);
          done();
        }
      });

      // Trigger a reload: child exits 42, supervisor spawns children[1] and
      // replays the handshake, waiting for a response carrying the reinit id.
      children[0].emit("exit", RELOAD_EXIT_CODE);
      setImmediate(() => {
        writeLine(children[1].stdout, {
          jsonrpc: "2.0",
          id: "__supervisor_reinit__",
          result: {},
        });
      });
    });
  });
});
