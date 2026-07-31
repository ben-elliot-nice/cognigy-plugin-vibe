/**
 * Tests for CognigyApiClient retry behaviour: Retry-After handling and the
 * POST-on-5xx duplicate-resource guard (migration-docs item #11).
 *
 * Uses a real local HTTP server (no axios mocking library available) so the
 * retry interceptor exercises real axios error/response shapes.
 */
import { describe, it, expect, afterEach } from "@jest/globals";
import http from "http";
import type { AddressInfo } from "net";
import { CognigyApiClient } from "../api/client.js";

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
});
