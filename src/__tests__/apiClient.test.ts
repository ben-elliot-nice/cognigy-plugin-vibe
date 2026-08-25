/**
 * Tests for CognigyApiClient retry behaviour: Retry-After handling and the
 * POST-on-5xx duplicate-resource guard (migration-docs item #11).
 *
 * Uses a real local HTTP server (no axios mocking library available) so the
 * retry interceptor exercises real axios error/response shapes.
 */
import { describe, it, expect, afterEach, jest } from "@jest/globals";
import http from "http";
import path from "path";
import type { AddressInfo } from "net";
import { CognigyApiClient } from "../api/client.js";

/**
 * Intercepts `setTimeout` calls made *by the retry interceptor in
 * `api/client.ts`* (identified via the call stack) and records the
 * requested delay, immediately scheduling the real callback with a 0ms
 * delay so the test doesn't actually wait. All other `setTimeout` calls
 * (notably axios/follow-redirects' own request-timeout timer, which also
 * uses 30000ms — the same magnitude as our Retry-After cap) pass through
 * untouched, so we don't accidentally fire a real request timeout early.
 * Lets us assert the *value* the retry interceptor computed (e.g. the
 * Retry-After cap, or the exponential backoff for a given retry count)
 * without slow/flaky real-time waits.
 */
function mockFastTimers(): { delays: number[]; restore: () => void } {
  const delays: number[] = [];
  const originalSetTimeout = global.setTimeout;
  const spy = jest.spyOn(global, "setTimeout").mockImplementation(((
    fn: (...args: unknown[]) => void,
    ms?: number,
  ) => {
    const stack = new Error().stack ?? "";
    if (stack.includes(`${path.sep}api${path.sep}client.`)) {
      delays.push(ms ?? 0);
      return originalSetTimeout(fn, 0);
    }
    return originalSetTimeout(fn, ms);
  }) as unknown as typeof global.setTimeout);
  return {
    delays,
    restore: () => spy.mockRestore(),
  };
}

type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestCount: number,
) => void;

function startServer(handler: Handler): Promise<{
  url: string;
  close: () => Promise<void>;
  requestCount: () => number;
}> {
  let count = 0;
  const server = http.createServer((req, res) => {
    count += 1;
    handler(req, res, count);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
        requestCount: () => count,
      });
    });
  });
}

describe("CognigyApiClient retry behaviour", () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeServer) {
      await closeServer();
      closeServer = undefined;
    }
  });

  it("honours a Retry-After header expressed in delta-seconds", async () => {
    const timestamps: number[] = [];
    const server = await startServer((req, res, count) => {
      timestamps.push(Date.now());
      if (count === 1) {
        res.writeHead(429, { "Retry-After": "1" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    closeServer = server.close;

    const client = new CognigyApiClient({
      baseUrl: server.url,
      apiKey: "test-key",
    });

    const result = await client.get("/thing");
    expect(result).toEqual({ ok: true });
    expect(server.requestCount()).toBe(2);
    // Second request should have been delayed by ~1s (the Retry-After value),
    // not the 500ms exponential-backoff default.
    const gap = timestamps[1] - timestamps[0];
    expect(gap).toBeGreaterThanOrEqual(900);
  }, 10000);

  it("honours a Retry-After header expressed as an HTTP-date", async () => {
    const timestamps: number[] = [];
    // toUTCString() truncates to whole seconds, so pad the delta enough that
    // the truncation can't eat the whole gap.
    const retryAt = new Date(Date.now() + 2500);
    const server = await startServer((req, res, count) => {
      timestamps.push(Date.now());
      if (count === 1) {
        res.writeHead(503, { "Retry-After": retryAt.toUTCString() });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    closeServer = server.close;

    const client = new CognigyApiClient({
      baseUrl: server.url,
      apiKey: "test-key",
    });

    // GET is idempotent, so a 503 is retried.
    const result = await client.get("/thing");
    expect(result).toEqual({ ok: true });
    expect(server.requestCount()).toBe(2);
    const gap = timestamps[1] - timestamps[0];
    expect(gap).toBeGreaterThanOrEqual(1400);
  }, 10000);

  it("does NOT retry a POST that fails with a 5xx (duplicate-create risk)", async () => {
    const server = await startServer((req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "boom" }));
    });
    closeServer = server.close;

    const client = new CognigyApiClient({
      baseUrl: server.url,
      apiKey: "test-key",
    });

    await expect(client.post("/things", { name: "x" })).rejects.toThrow();
    expect(server.requestCount()).toBe(1);
  });

  it("DOES retry a POST that fails with 429 (rejected before processing)", async () => {
    const server = await startServer((req, res, count) => {
      if (count === 1) {
        res.writeHead(429, { "Retry-After": "0" });
        res.end();
        return;
      }
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "new-thing" }));
    });
    closeServer = server.close;

    const client = new CognigyApiClient({
      baseUrl: server.url,
      apiKey: "test-key",
    });

    const result = await client.post("/things", { name: "x" });
    expect(result).toEqual({ id: "new-thing" });
    expect(server.requestCount()).toBe(2);
  });

  it("still retries GET on a 5xx using exponential backoff when no Retry-After is present", async () => {
    const server = await startServer((req, res, count) => {
      if (count < 3) {
        res.writeHead(502);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    closeServer = server.close;

    const client = new CognigyApiClient({
      baseUrl: server.url,
      apiKey: "test-key",
    });

    const result = await client.get("/thing");
    expect(result).toEqual({ ok: true });
    expect(server.requestCount()).toBe(3);
  }, 10000);

  it("clamps a Retry-After value above the 30s cap", async () => {
    const timers = mockFastTimers();
    try {
      const server = await startServer((req, res, count) => {
        if (count === 1) {
          // Far above MAX_RETRY_AFTER_MS (30_000ms).
          res.writeHead(429, { "Retry-After": "120" });
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      closeServer = server.close;

      const client = new CognigyApiClient({
        baseUrl: server.url,
        apiKey: "test-key",
      });

      const result = await client.get("/thing");
      expect(result).toEqual({ ok: true });
      expect(server.requestCount()).toBe(2);
      expect(timers.delays).toEqual([30000]);
    } finally {
      timers.restore();
    }
  }, 10000);

  it("falls back to exponential backoff when Retry-After is invalid/garbage", async () => {
    const timers = mockFastTimers();
    try {
      const server = await startServer((req, res, count) => {
        if (count === 1) {
          res.writeHead(503, { "Retry-After": "banana" });
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      closeServer = server.close;

      const client = new CognigyApiClient({
        baseUrl: server.url,
        apiKey: "test-key",
      });

      const result = await client.get("/thing");
      expect(result).toEqual({ ok: true });
      expect(server.requestCount()).toBe(2);
      // RETRY_BASE_MS * 2^(1-1) = 500ms, not NaN and not an immediate retry.
      expect(timers.delays).toEqual([500]);
    } finally {
      timers.restore();
    }
  }, 10000);

  it("clamps a negative Retry-After value to a non-negative delay", async () => {
    const timers = mockFastTimers();
    try {
      const server = await startServer((req, res, count) => {
        if (count === 1) {
          res.writeHead(429, { "Retry-After": "-5" });
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      closeServer = server.close;

      const client = new CognigyApiClient({
        baseUrl: server.url,
        apiKey: "test-key",
      });

      const result = await client.get("/thing");
      expect(result).toEqual({ ok: true });
      expect(server.requestCount()).toBe(2);
      expect(timers.delays).toEqual([0]);
      expect(timers.delays[0]).toBeGreaterThanOrEqual(0);
    } finally {
      timers.restore();
    }
  }, 10000);

  it("uses the correct exponential backoff for a retry that follows a Retry-After-honoured retry", async () => {
    const timers = mockFastTimers();
    try {
      const server = await startServer((req, res, count) => {
        if (count === 1) {
          // First failure: honour Retry-After (delay 0), bumping
          // _retryCount to 1.
          res.writeHead(429, { "Retry-After": "0" });
          res.end();
          return;
        }
        if (count === 2) {
          // Second failure: no Retry-After, so this should fall back to
          // exponential backoff based on the *true* retry count (2), i.e.
          // RETRY_BASE_MS * 2^(2-1) = 1000ms — not reset to 500ms.
          res.writeHead(503);
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      closeServer = server.close;

      const client = new CognigyApiClient({
        baseUrl: server.url,
        apiKey: "test-key",
      });

      const result = await client.get("/thing");
      expect(result).toEqual({ ok: true });
      expect(server.requestCount()).toBe(3);
      expect(timers.delays).toEqual([0, 1000]);
    } finally {
      timers.restore();
    }
  }, 10000);

  describe.each(["put", "patch", "delete"] as const)(
    "idempotent method retries",
    (method) => {
      it(`retries a ${method.toUpperCase()} that fails with a 5xx`, async () => {
        const server = await startServer((req, res, count) => {
          if (count === 1) {
            res.writeHead(503);
            res.end();
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
        closeServer = server.close;

        const client = new CognigyApiClient({
          baseUrl: server.url,
          apiKey: "test-key",
        });

        const result =
          method === "delete"
            ? await client.delete("/things/1")
            : await client[method]("/things/1", { name: "x" });
        expect(result).toEqual({ ok: true });
        expect(server.requestCount()).toBe(2);
      }, 10000);
    },
  );

  it("retries a GET on a network-level error (no response, e.g. connection reset)", async () => {
    const server = await startServer((req, res, count) => {
      if (count === 1) {
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    closeServer = server.close;

    const client = new CognigyApiClient({
      baseUrl: server.url,
      apiKey: "test-key",
    });

    const result = await client.get("/thing");
    expect(result).toEqual({ ok: true });
    expect(server.requestCount()).toBe(2);
  }, 10000);

  it("does NOT retry a POST on a network-level error (no response)", async () => {
    const server = await startServer((req, res) => {
      req.socket.destroy();
    });
    closeServer = server.close;

    const client = new CognigyApiClient({
      baseUrl: server.url,
      apiKey: "test-key",
    });

    await expect(client.post("/things", { name: "x" })).rejects.toThrow();
    expect(server.requestCount()).toBe(1);
  }, 10000);

  it("gives up after exactly MAX_RETRIES retries (4 total attempts) and rejects", async () => {
    const timers = mockFastTimers();
    try {
      const server = await startServer((req, res) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "always fails" }));
      });
      closeServer = server.close;

      const client = new CognigyApiClient({
        baseUrl: server.url,
        apiKey: "test-key",
      });

      await expect(client.get("/thing")).rejects.toThrow("always fails");
      // 1 initial attempt + 3 retries = 4 total requests.
      expect(server.requestCount()).toBe(4);
    } finally {
      timers.restore();
    }
  }, 10000);

  it("succeeds when the last allowed attempt (4th total request) succeeds", async () => {
    const timers = mockFastTimers();
    try {
      const server = await startServer((req, res, count) => {
        if (count < 4) {
          res.writeHead(500);
          res.end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      closeServer = server.close;

      const client = new CognigyApiClient({
        baseUrl: server.url,
        apiKey: "test-key",
      });

      const result = await client.get("/thing");
      expect(result).toEqual({ ok: true });
      expect(server.requestCount()).toBe(4);
    } finally {
      timers.restore();
    }
  }, 10000);
});
