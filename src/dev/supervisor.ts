#!/usr/bin/env node
/**
 * DEV-ONLY hot-reload supervisor. Never used in production — `cognigy-mcp`
 * (dist/index.js) does not go through this file at all.
 *
 * What it does: spawns the real MCP server (src/index.ts, via tsx) as a child
 * process with COGNIGY_DEV=1, and transparently pipes newline-delimited
 * JSON-RPC between the MCP client (this process's stdin/stdout) and the
 * child's stdin/stdout. When the child calls the `reload_mcp` dev tool it
 * exits with RELOAD_EXIT_CODE (42); on seeing that exit code the supervisor
 * respawns a fresh child — which re-reads current source from disk, so
 * edited code takes effect — replays the MCP `initialize` handshake the
 * client originally sent (so the new child's server-side session state is
 * primed), and tells the client its tool list may have changed via
 * `notifications/tools/list_changed`.
 *
 * If the child exits for any other reason (crash, normal shutdown), the
 * supervisor exits with the same code instead of respawning, so a real crash
 * still surfaces to the developer/client rather than looping silently.
 *
 * Usage (dev only, not wired into any production script):
 *   npx tsx src/dev/supervisor.ts
 * Point your MCP client's server command at this file instead of
 * `dist/index.js` / `cognigy-mcp` while iterating on server source.
 *
 * KNOWN LIMITATION: forwarding is line-based (JSON-RPC over stdio is
 * newline-delimited, matching the MCP stdio transport), so a child that
 * writes a partial line right as it exits could lose that fragment. This
 * mirrors the line-buffered approach of the ported Python orchestrator and
 * is considered acceptable for a dev-only tool.
 */
import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import { RELOAD_EXIT_CODE } from "./constants.js";

const SERVER_ENTRY = fileURLToPath(new URL("../index.ts", import.meta.url));
const REINIT_REQUEST_ID = "__supervisor_reinit__";

function log(msg: string): void {
  process.stderr.write(`[supervisor] ${msg}\n`);
}

export interface SupervisorDeps {
  spawnChild: (env: NodeJS.ProcessEnv) => ChildProcess;
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  exit: (code: number) => void;
}

export function defaultSpawnChild(env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx/esm", SERVER_ENTRY], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...env, COGNIGY_DEV: "1" },
  });
}

export class Supervisor {
  private readonly deps: SupervisorDeps;
  private child: ChildProcess | null = null;
  private initParams: unknown = null;
  private swallowingHandshake = false;
  private restarting = false;

  constructor(deps: Partial<SupervisorDeps> = {}) {
    this.deps = {
      spawnChild: deps.spawnChild ?? defaultSpawnChild,
      stdin: deps.stdin ?? process.stdin,
      stdout: deps.stdout ?? process.stdout,
      exit: deps.exit ?? ((code: number) => process.exit(code)),
    };
  }

  start(): void {
    this.child = this.spawnAndWire();
    this.pipeClientStdin();
  }

  private spawnAndWire(): ChildProcess {
    const proc = this.deps.spawnChild(process.env);
    log(`spawned child pid=${proc.pid}`);

    const rl = createInterface({ input: proc.stdout! });
    rl.on("line", (line) => this.onChildLine(line));

    proc.on("exit", (code) => {
      log(`child pid=${proc.pid} exited code=${code}`);
      if (code === RELOAD_EXIT_CODE) {
        this.restarting = true;
        this.doRestart();
      } else if (!this.restarting) {
        this.deps.exit(code ?? 1);
      }
    });

    return proc;
  }

  private onChildLine(line: string): void {
    if (!line.trim()) return;

    if (this.swallowingHandshake) {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return; // swallow non-JSON noise during replay too
      }
      if (msg && msg.id === REINIT_REQUEST_ID) {
        this.swallowingHandshake = false;
        this.finishRestart();
      }
      return;
    }

    this.deps.stdout.write(line + "\n");
  }

  private pipeClientStdin(): void {
    const rl = createInterface({ input: this.deps.stdin });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line);
        if (msg && msg.method === "initialize") {
          this.initParams = msg.params;
        }
      } catch {
        // Not JSON — still forward the raw line below.
      }
      this.child?.stdin?.write(line + "\n");
    });
    rl.on("close", () => {
      log("client stdin closed — shutting down");
      this.child?.kill();
      this.deps.exit(0);
    });
  }

  private doRestart(): void {
    log("restarting inner server (rc=42 received)");
    this.child?.stdin?.destroy();
    this.child = this.spawnAndWire();

    if (this.initParams != null) {
      this.swallowingHandshake = true;
      const req =
        JSON.stringify({
          jsonrpc: "2.0",
          id: REINIT_REQUEST_ID,
          method: "initialize",
          params: this.initParams,
        }) + "\n";
      this.child.stdin?.write(req);
    } else {
      this.finishRestart();
    }
  }

  private finishRestart(): void {
    this.child?.stdin?.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
    this.deps.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
      }) + "\n",
    );
    this.restarting = false;
    log("restart complete");
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  new Supervisor().start();
}
