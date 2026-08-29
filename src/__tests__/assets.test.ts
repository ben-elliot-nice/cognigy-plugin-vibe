import { describe, it, expect } from "@jest/globals";
import {
  validatePngDimensions,
  guessKnowledgeContentType,
  buildKnowledgeUploadForm,
} from "../tools/assets.js";

/**
 * Build a minimal (not-fully-valid, but header-correct) PNG buffer: the
 * 8-byte signature + a 4-byte IHDR chunk-length + "IHDR" type + width/height
 * as big-endian uint32s. The validator only reads bytes 0-23, so nothing
 * beyond that is required for these tests.
 */
function makePngBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  buf.writeUInt32BE(13, 8); // IHDR chunk length (unused by validator)
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

describe("validatePngDimensions", () => {
  it("accepts a 136x184 PNG", () => {
    const result = validatePngDimensions(makePngBuffer(136, 184));
    expect(result.ok).toBe(true);
    expect(result.width).toBe(136);
    expect(result.height).toBe(184);
    expect(result.error).toBeUndefined();
  });

  it("rejects the wrong dimensions", () => {
    const result = validatePngDimensions(makePngBuffer(200, 200));
    expect(result.ok).toBe(false);
    expect(result.width).toBe(200);
    expect(result.height).toBe(200);
    expect(result.error).toMatch(/200x200/);
  });

  it("gives a resize hint when the aspect ratio already matches", () => {
    // 68x92 is exactly half of 136x184 — same ratio, wrong absolute size.
    const result = validatePngDimensions(makePngBuffer(68, 92));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/correct aspect ratio/i);
  });

  it("rejects a non-PNG file (wrong magic bytes)", () => {
    const notPng = Buffer.concat([
      Buffer.from("this is not a png file at all!!"),
      Buffer.alloc(10),
    ]);
    const result = validatePngDimensions(notPng);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a PNG/i);
  });

  it("rejects a PNG-signed buffer missing the IHDR chunk", () => {
    const buf = Buffer.alloc(24);
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    buf.write("JUNK", 12, "ascii");
    const result = validatePngDimensions(buf);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/IHDR/);
  });

  it("rejects a too-small buffer", () => {
    const result = validatePngDimensions(Buffer.alloc(10));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too small/i);
  });

  it.each([
    [135, 184],
    [137, 184],
    [136, 183],
    [136, 185],
  ])("rejects off-by-one dimensions %dx%d", (width, height) => {
    const result = validatePngDimensions(makePngBuffer(width, height));
    expect(result.ok).toBe(false);
    expect(result.width).toBe(width);
    expect(result.height).toBe(height);
  });

  it("rejects a corrupt-but-signed IHDR with 0x0 dimensions", () => {
    const result = validatePngDimensions(makePngBuffer(0, 0));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/0x0/);
  });

  it("rejects a corrupt-but-signed IHDR with huge dimensions", () => {
    const result = validatePngDimensions(makePngBuffer(0xffffffff, 0xffffffff));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/4294967295x4294967295/);
  });

  it("rejects a buffer that is exactly 23 bytes (one short of the minimum)", () => {
    const result = validatePngDimensions(Buffer.alloc(23));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too small/i);
  });

  it("accepts the exact 24-byte boundary when it encodes valid dimensions", () => {
    // makePngBuffer already allocates exactly 24 bytes — confirm the boundary
    // itself (not just "bigger than 24") is handled correctly.
    const buf = makePngBuffer(136, 184);
    expect(buf.length).toBe(24);
    const result = validatePngDimensions(buf);
    expect(result.ok).toBe(true);
  });
});

describe("guessKnowledgeContentType", () => {
  it("maps known extensions", () => {
    expect(guessKnowledgeContentType("report.pdf")).toBe("application/pdf");
    expect(guessKnowledgeContentType("notes.txt")).toBe("text/plain");
    expect(guessKnowledgeContentType("chunks.ctxt")).toBe("text/plain");
  });

  it("returns null for unknown or missing extensions", () => {
    expect(guessKnowledgeContentType("mystery.xyz")).toBeNull();
    expect(guessKnowledgeContentType("noextension")).toBeNull();
  });

  it("is case-insensitive for uppercase extensions", () => {
    expect(guessKnowledgeContentType("REPORT.PDF")).toBe("application/pdf");
    expect(guessKnowledgeContentType("Notes.TXT")).toBe("text/plain");
    expect(guessKnowledgeContentType("Deck.PPTX")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  });
});

describe("buildKnowledgeUploadForm", () => {
  it("builds a real multipart/form-data payload with field, filename, and content-type", () => {
    const fileBuffer = Buffer.from("hello world");
    const form = buildKnowledgeUploadForm({
      fileBuffer,
      fileName: "report.pdf",
      contentType: "application/pdf",
    });

    const headers = form.getHeaders();
    expect(headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);

    const body = form.getBuffer().toString("utf-8");
    expect(body).toContain('name="file"');
    expect(body).toContain('filename="report.pdf"');
    expect(body).toContain("Content-Type: application/pdf");
    expect(body).toContain("hello world");
  });

  it("includes a comma-joined tags field when tags are provided", () => {
    const form = buildKnowledgeUploadForm({
      fileBuffer: Buffer.from("data"),
      fileName: "notes.txt",
      contentType: "text/plain",
      tags: ["demo", "release-notes"],
    });

    const body = form.getBuffer().toString("utf-8");
    expect(body).toContain('name="tags"');
    expect(body).toContain("demo,release-notes");
  });

  it("omits the tags part when no tags are given", () => {
    const form = buildKnowledgeUploadForm({
      fileBuffer: Buffer.from("data"),
      fileName: "notes.txt",
      contentType: "text/plain",
    });

    const body = form.getBuffer().toString("utf-8");
    expect(body).not.toContain('name="tags"');
  });
});
