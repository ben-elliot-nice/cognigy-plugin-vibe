import { describe, it, expect } from "@jest/globals";
import { execFileSync } from "child_process";
import { join } from "path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(REPO_ROOT, "scripts", "build-explain-topics.mjs");

describe("explain topics build sync-check", () => {
  it("the committed src/tools/explainTopics.generated.ts matches docs/explain/resources/", () => {
    // Mirrors the source repo's `check-explain-topics` CI gate: regenerate the
    // module from docs/explain/resources/ and fail if it differs from what's
    // committed — a stale generated file (or an invalid source tree) exits
    // non-zero with a helpful message on stderr.
    expect(() => {
      execFileSync("node", [SCRIPT, "--check"], { cwd: REPO_ROOT });
    }).not.toThrow();
  });
});
