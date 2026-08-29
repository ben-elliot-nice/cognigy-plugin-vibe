/**
 * Pure, unit-testable helpers for asset handling: AI Agent avatar image
 * validation and Knowledge Source multipart upload form construction.
 *
 * No API client / network code lives here — handlers.ts wires these into the
 * actual HTTP calls (see CognigyApiClient.postForm in src/api/client.ts).
 */
import FormData from "form-data";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** Required AI Agent avatar dimensions, per the Cognigy UI's avatar spec. */
export const REQUIRED_AVATAR_WIDTH = 136;
export const REQUIRED_AVATAR_HEIGHT = 184;

export interface PngDimensionsResult {
  ok: boolean;
  width?: number;
  height?: number;
  error?: string;
}

/**
 * Validate that `buffer` is a real PNG file and that it matches the exact
 * 136x184px AI Agent avatar dimensions — BEFORE any upload is attempted.
 *
 * Parses the PNG signature + IHDR chunk with Node builtins only (no image
 * dependency): width/height are big-endian uint32 at bytes 16-23, right
 * after the 8-byte signature and the 4-byte IHDR chunk length + 4-byte
 * "IHDR" type (bytes 8-11 and 12-15 respectively).
 */
export function validatePngDimensions(buffer: Buffer): PngDimensionsResult {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
    return { ok: false, error: "File is too small to be a valid PNG" };
  }

  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { ok: false, error: "File is not a PNG (wrong magic bytes)" };
  }

  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    return { ok: false, error: "File is not a valid PNG (missing IHDR chunk)" };
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);

  if (width !== REQUIRED_AVATAR_WIDTH || height !== REQUIRED_AVATAR_HEIGHT) {
    const ratio = height ? width / height : 0;
    const targetRatio = REQUIRED_AVATAR_WIDTH / REQUIRED_AVATAR_HEIGHT;
    const sameRatio = height > 0 && Math.abs(ratio - targetRatio) <= 0.01;
    const error = sameRatio
      ? `Image is ${width}x${height}px with the correct aspect ratio — resize to ${REQUIRED_AVATAR_WIDTH}x${REQUIRED_AVATAR_HEIGHT}px and re-run.`
      : `Image is ${width}x${height}px. Expected exactly ${REQUIRED_AVATAR_WIDTH}x${REQUIRED_AVATAR_HEIGHT}px.`;
    return { ok: false, width, height, error };
  }

  return { ok: true, width, height };
}

/** Content-type map for supported Knowledge Source file uploads. */
const KNOWLEDGE_SOURCE_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  text: "text/plain",
  ctxt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** Best-effort content-type for a Knowledge Source file, by extension. `null` if unknown. */
export function guessKnowledgeContentType(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return KNOWLEDGE_SOURCE_CONTENT_TYPES[ext] ?? null;
}

export interface BuildKnowledgeUploadFormParams {
  fileBuffer: Buffer;
  fileName: string;
  contentType?: string | null;
  /** Optional tags applied to the created Knowledge Source; joined with commas (API convention). */
  tags?: string[];
}

/**
 * Build a real multipart/form-data payload for the Knowledge Source upload
 * endpoint (`POST /v2.0/knowledgestores/{id}/sources/upload`). This exists
 * because that endpoint requires an actual file part — a JSON-only invoke
 * path cannot carry binary file content.
 */
export function buildKnowledgeUploadForm(
  params: BuildKnowledgeUploadFormParams,
): FormData {
  const form = new FormData();
  form.append("file", params.fileBuffer, {
    filename: params.fileName,
    contentType: params.contentType ?? undefined,
  });
  if (params.tags && params.tags.length > 0) {
    form.append("tags", params.tags.join(","));
  }
  return form;
}
