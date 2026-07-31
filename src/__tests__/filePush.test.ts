import { describe, it, expect } from "@jest/globals";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveContent } from "../tools/filePush.js";

describe("resolveContent", () => {
  let dir: string;

  function makeTmpDir() {
    dir = mkdtempSync(join(tmpdir(), "file-push-test-"));
    return dir;
  }

  it("returns inline content unchanged when only inline is given", async () => {
    const result = await resolveContent({
      inline: "console.log(1);",
      kind: "text",
    });
    expect(result).toEqual({ content: "console.log(1);" });
  });

  it("returns nothing when neither inline nor filePath is given", async () => {
    const result = await resolveContent({ kind: "text" });
    expect(result).toEqual({});
  });

  it("errors when both inline and filePath are provided", async () => {
    const result = await resolveContent({
      inline: "x",
      filePath: "/tmp/whatever.js",
      kind: "text",
    });
    expect(result.error).toMatch(/exactly one/i);
    expect(result.content).toBeUndefined();
  });

  it("reads text content from a real local file", async () => {
    const d = makeTmpDir();
    const file = join(d, "node.js");
    writeFileSync(file, "input.result = 42;", "utf-8");

    const result = await resolveContent({ filePath: file, kind: "text" });
    expect(result.error).toBeUndefined();
    expect(result.content).toBe("input.result = 42;");

    rmSync(d, { recursive: true, force: true });
  });

  it("returns a clear error when the file does not exist", async () => {
    const result = await resolveContent({
      filePath: "/no/such/path/does-not-exist.js",
      kind: "text",
    });
    expect(result.error).toMatch(/File not found/);
    expect(result.content).toBeUndefined();
  });

  it("parses and validates JSON content from a file", async () => {
    const d = makeTmpDir();
    const file = join(d, "params.json");
    writeFileSync(
      file,
      '{"type":"object","properties":{"q":{"type":"string"}}}',
      "utf-8",
    );

    const result = await resolveContent({ filePath: file, kind: "json" });
    expect(result.error).toBeUndefined();
    expect(result.parsed).toEqual({
      type: "object",
      properties: { q: { type: "string" } },
    });
    expect(result.content).toBe(
      '{"type":"object","properties":{"q":{"type":"string"}}}',
    );

    rmSync(d, { recursive: true, force: true });
  });

  it("errors on invalid JSON content from a file", async () => {
    const d = makeTmpDir();
    const file = join(d, "bad.json");
    writeFileSync(file, "{not valid json", "utf-8");

    const result = await resolveContent({ filePath: file, kind: "json" });
    expect(result.error).toMatch(/Invalid JSON/);
    expect(result.content).toBeUndefined();

    rmSync(d, { recursive: true, force: true });
  });

  it("uses an injected readFile function instead of touching disk", async () => {
    const readFile = async (p: string) => `content-of:${p}`;
    const result = await resolveContent({
      filePath: "/virtual/path.js",
      kind: "text",
      readFile,
    });
    expect(result.content).toBe("content-of:/virtual/path.js");
  });

  it("surfaces a non-ENOENT read error with a clear message", async () => {
    const readFile = async () => {
      const err: any = new Error("permission denied");
      err.code = "EACCES";
      throw err;
    };
    const result = await resolveContent({
      filePath: "/some/path.js",
      kind: "text",
      readFile,
    });
    expect(result.error).toMatch(/Failed to read/);
    expect(result.error).toMatch(/permission denied/);
  });
});
