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
