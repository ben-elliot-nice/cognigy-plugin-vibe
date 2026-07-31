/**
 * File-path push helper.
 *
 * Lets a caller push large, frequently-edited content (code-node scripts,
 * agent-tool parameter JSON Schemas, xApp HTML) by reference to a local file
 * instead of inlining the full content as a tool parameter on every call.
 * The model can maintain the file with native write/edit tooling (plus local
 * linting/LSP) and only tell the MCP a path to push — the MCP never has to
 * regenerate (or re-emit) the whole content just to change a few lines.
 *
 * IMPORTANT — local-only: this only works because this MCP server runs
 * locally over stdio (npx) for Claude Code, so it has the same filesystem
 * view as the caller. It is opt-in per call via `filePath`; the inline
 * content parameter keeps working unchanged and is the only option on a
 * remote/server-hosted MCP deployment (e.g. Claude Desktop's connector),
 * where the server has no visibility into the caller's local filesystem and
 * a `filePath` will simply fail to read.
 */

import { readFile as fsReadFile } from "node:fs/promises";

export type PushContentKind = "text" | "json";

export interface ResolveContentOptions {
  /** Inline content passed directly as a tool parameter (e.g. config.code). */
  inline?: string;
  /** Absolute path to a local file to read instead of inline content. */
  filePath?: string;
  /** "json" additionally parses the content and validates it is valid JSON. */
  kind: PushContentKind;
  /** Injectable for tests; defaults to fs/promises readFile (utf-8). */
  readFile?: (path: string) => Promise<string>;
}

export interface ResolveContentResult {
  /** Resolved content — a raw string for "text", the raw JSON text for "json". */
  content?: string;
  /** Parsed JSON value — only set when kind is "json" and content was resolved. */
  parsed?: unknown;
  /** Set (and content/parsed left undefined) when resolution failed. */
  error?: string;
}

/**
 * Resolve content from either an inline string or a local file path — never
 * both. Callers should invoke this whenever a tool exposes a `filePath`
 * ergonomic alongside an inline content field, and treat a returned `error`
 * as a validation failure (surface it to the caller, do not push).
 */
export async function resolveContent(
  options: ResolveContentOptions,
): Promise<ResolveContentResult> {
  const { inline, filePath, kind } = options;

  if (inline !== undefined && filePath !== undefined) {
    return {
      error: "Provide exactly one of inline content or filePath — not both.",
    };
  }

  if (filePath === undefined) {
    if (inline === undefined) return {};
    if (kind === "json") {
      try {
        return { content: inline, parsed: JSON.parse(inline) };
      } catch (err: any) {
        return { error: `Invalid JSON: ${err?.message ?? String(err)}` };
      }
    }
    return { content: inline };
  }

  const readFileImpl =
    options.readFile ?? ((p: string) => fsReadFile(p, "utf-8"));

  let raw: string;
  try {
    raw = await readFileImpl(filePath);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { error: `File not found: ${filePath}` };
    }
    return {
      error: `Failed to read ${filePath}: ${err?.message ?? String(err)}`,
    };
  }

  if (kind === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      return {
        error: `Invalid JSON in ${filePath}: ${err?.message ?? String(err)}`,
      };
    }
    return { content: raw, parsed };
  }

  return { content: raw };
}
