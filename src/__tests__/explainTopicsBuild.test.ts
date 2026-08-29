import { describe, it, expect, afterEach } from "@jest/globals";
import { execFileSync, spawnSync } from "child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(REPO_ROOT, "scripts", "build-explain-topics.mjs");

// Import the build script's exported validation helpers directly so we can
// unit-test them against fixture trees, rather than only exercising the
// CLI end-to-end against the real (already in-sync) docs/explain/resources/.
const buildScript: typeof import("../../scripts/build-explain-topics.mjs") =
  await import(SCRIPT);
const { parseFrontmatter, scanDir, flatten, buildTopLevelIndex, build } =
  buildScript;

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "explain-topics-test-"));
  tempDirs.push(dir);
  // Resolve symlinks (macOS's os.tmpdir() lives under /var, itself a symlink
  // to /private/var) so the path we hand to `node <script>` below matches the
  // canonical path Node computes for `import.meta.url` — the build script's
  // `main()` only runs when the two are equal (see build-explain-topics.mjs's
  // `if (import.meta.url === file://${process.argv[1]})` guard).
  return realpathSync(dir);
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("explain topics build sync-check (CLI)", () => {
  it("the committed src/tools/explainTopics.generated.ts matches docs/explain/resources/", () => {
    // Mirrors the source repo's `check-explain-topics` CI gate: regenerate the
    // module from docs/explain/resources/ and fail if it differs from what's
    // committed — a stale generated file (or an invalid source tree) exits
    // non-zero with a helpful message on stderr.
    expect(() => {
      execFileSync("node", [SCRIPT, "--check"], { cwd: REPO_ROOT });
    }).not.toThrow();
  });

  it("--check fails with a non-zero exit and a clear message when the generated file has drifted from docs/explain/resources/", () => {
    // Build an isolated copy of the repo layout the script needs (its own
    // location, docs/explain/resources/, and a *stale* generated file), so we
    // can prove --check actually detects drift instead of being a silent
    // no-op. node_modules is symlinked in so the script's `import prettier`
    // resolves without copying the whole dependency tree.
    const tmpRoot = makeTempDir();
    mkdirSync(join(tmpRoot, "scripts"), { recursive: true });
    mkdirSync(join(tmpRoot, "src", "tools"), { recursive: true });
    mkdirSync(join(tmpRoot, "docs", "explain"), { recursive: true });

    const tmpScript = join(tmpRoot, "scripts", "build-explain-topics.mjs");
    // Copy the real script's source verbatim so we're testing the actual
    // logic, not a reimplementation of it.
    writeFileSync(tmpScript, readFileSync(SCRIPT, "utf-8"));

    symlinkSync(join(REPO_ROOT, "node_modules"), join(tmpRoot, "node_modules"));

    // A minimal valid resources tree with one group and one leaf topic.
    const groupDir = join(tmpRoot, "docs", "explain", "resources", "group");
    mkdirSync(groupDir, { recursive: true });
    writeFileSync(
      join(groupDir, "index.md"),
      "---\ndescription: A group.\n---\nGroup primer.\n",
    );
    writeFileSync(
      join(groupDir, "leaf.md"),
      "---\ntopic: leaf-topic\ndescription: A leaf.\n---\nLeaf body.\n",
    );

    // A deliberately stale generated file — anything other than what build()
    // would actually produce for the tree above.
    const generatedPath = join(
      tmpRoot,
      "src",
      "tools",
      "explainTopics.generated.ts",
    );
    writeFileSync(
      generatedPath,
      "export const TOPICS: string[] = [];\nexport const TOPIC_INDEX = '';\nexport const CONTENT = {};\n",
    );

    const res = spawnSync("node", [tmpScript, "--check"], {
      cwd: tmpRoot,
      encoding: "utf-8",
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("is out of date");
  });
});

describe("build-explain-topics.mjs validation helpers (unit)", () => {
  describe("parseFrontmatter", () => {
    it("throws when there is no closing frontmatter delimiter", () => {
      expect(() =>
        parseFrontmatter("---\ndescription: x\nno closing fence", "f.md"),
      ).toThrow(/No frontmatter found/);
    });

    it("throws on a duplicate frontmatter key", () => {
      expect(() =>
        parseFrontmatter(
          "---\ndescription: one\ndescription: two\n---\nbody",
          "f.md",
        ),
      ).toThrow(/Duplicate frontmatter key/);
    });

    it("throws on a YAML block scalar value", () => {
      expect(() =>
        parseFrontmatter("---\ndescription: >\n  multiline\n---\nbody", "f.md"),
      ).toThrow(/block scalar/);
    });

    it("throws on a line with no colon", () => {
      expect(() =>
        parseFrontmatter("---\nnotakeyvalue\n---\nbody", "f.md"),
      ).toThrow(/invalid frontmatter line/);
    });

    it("parses a well-formed single-line frontmatter block", () => {
      const { metadata, body } = parseFrontmatter(
        "---\ntopic: t\ndescription: d\n---\nthe body\n",
        "f.md",
      );
      expect(metadata).toEqual({ topic: "t", description: "d" });
      expect(body.trim()).toBe("the body");
    });
  });

  describe("scanDir", () => {
    it("errors when resources/ root contains an index.md", () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, "index.md"), "---\ndescription: x\n---\nbody\n");
      const errors: string[] = [];
      scanDir(dir, "", errors);
      expect(
        errors.some((e) => e.includes("must not contain an index.md")),
      ).toBe(true);
    });

    it("errors when resources/ root contains a leaf topic file directly", () => {
      const dir = makeTempDir();
      writeFileSync(
        join(dir, "stray.md"),
        "---\ntopic: stray\ndescription: x\n---\nbody\n",
      );
      const errors: string[] = [];
      scanDir(dir, "", errors);
      expect(
        errors.some((e) => e.includes("must not contain topic files directly")),
      ).toBe(true);
    });

    it("errors when a group directory is missing index.md", () => {
      const dir = makeTempDir();
      const groupDir = join(dir, "group");
      mkdirSync(groupDir);
      writeFileSync(
        join(groupDir, "leaf.md"),
        "---\ntopic: leaf\ndescription: x\n---\nbody\n",
      );
      const errors: string[] = [];
      scanDir(dir, "", errors);
      expect(errors.some((e) => e.includes("is missing index.md"))).toBe(true);
    });

    it("errors when index.md declares a 'topic' key", () => {
      const dir = makeTempDir();
      const groupDir = join(dir, "group");
      mkdirSync(groupDir);
      writeFileSync(
        join(groupDir, "index.md"),
        "---\ntopic: group\ndescription: x\n---\nbody\n",
      );
      const errors: string[] = [];
      scanDir(dir, "", errors);
      expect(errors.some((e) => e.includes("must not declare 'topic'"))).toBe(
        true,
      );
    });

    it("errors when index.md is missing a description", () => {
      const dir = makeTempDir();
      const groupDir = join(dir, "group");
      mkdirSync(groupDir);
      writeFileSync(join(groupDir, "index.md"), "---\nfoo: bar\n---\nbody\n");
      const errors: string[] = [];
      scanDir(dir, "", errors);
      expect(errors.some((e) => e.includes("missing 'description'"))).toBe(
        true,
      );
    });

    it("errors when a leaf topic file declares a 'group' key", () => {
      const dir = makeTempDir();
      const groupDir = join(dir, "group");
      mkdirSync(groupDir);
      writeFileSync(
        join(groupDir, "index.md"),
        "---\ndescription: x\n---\nbody\n",
      );
      writeFileSync(
        join(groupDir, "leaf.md"),
        "---\ntopic: leaf\ngroup: forbidden\ndescription: x\n---\nbody\n",
      );
      const errors: string[] = [];
      scanDir(dir, "", errors);
      expect(errors.some((e) => e.includes("must not declare 'group'"))).toBe(
        true,
      );
    });

    it("errors when a leaf topic file is missing 'topic'", () => {
      const dir = makeTempDir();
      const groupDir = join(dir, "group");
      mkdirSync(groupDir);
      writeFileSync(
        join(groupDir, "index.md"),
        "---\ndescription: x\n---\nbody\n",
      );
      writeFileSync(
        join(groupDir, "leaf.md"),
        "---\ndescription: x\n---\nbody\n",
      );
      const errors: string[] = [];
      scanDir(dir, "", errors);
      expect(errors.some((e) => e.includes("missing 'topic'"))).toBe(true);
    });

    it("errors when a leaf topic file is missing 'description'", () => {
      const dir = makeTempDir();
      const groupDir = join(dir, "group");
      mkdirSync(groupDir);
      writeFileSync(
        join(groupDir, "index.md"),
        "---\ndescription: x\n---\nbody\n",
      );
      writeFileSync(join(groupDir, "leaf.md"), "---\ntopic: leaf\n---\nbody\n");
      const errors: string[] = [];
      scanDir(dir, "", errors);
      expect(errors.some((e) => e.includes("missing 'description'"))).toBe(
        true,
      );
    });

    it("accepts (does not error on) a leaf topic file with an empty body", () => {
      // Gap: only `topic`/`description` are validated as required — an empty
      // markdown body is currently allowed. This pins today's (permissive)
      // behavior; if body-emptiness validation is ever added, update this
      // test alongside it.
      const dir = makeTempDir();
      const groupDir = join(dir, "group");
      mkdirSync(groupDir);
      writeFileSync(
        join(groupDir, "index.md"),
        "---\ndescription: x\n---\nbody\n",
      );
      writeFileSync(
        join(groupDir, "leaf.md"),
        "---\ntopic: empty-body-leaf\ndescription: has a description\n---\n",
      );
      const errors: string[] = [];
      const root = scanDir(dir, "", errors);
      expect(errors).toEqual([]);
      const leaf = root.subgroups[0].leafTopics.find(
        (t: any) => t.key === "empty-body-leaf",
      );
      expect(leaf).toBeDefined();
      expect(leaf.body).toBe("");

      // And flatten() carries the empty body straight through, matching
      // handleExplain's behavior of returning `{ text: "" }` for such a topic.
      const flattened = flatten(root);
      const flatEntry = flattened.find(
        ([key]: any) => key === "empty-body-leaf",
      );
      expect(flatEntry).toBeDefined();
      expect(flatEntry![2]).toBe("");
    });
  });

  describe("build", () => {
    it("throws when a group directory is missing index.md", async () => {
      const dir = makeTempDir();
      const groupDir = join(dir, "group");
      mkdirSync(groupDir);
      writeFileSync(
        join(groupDir, "leaf.md"),
        "---\ntopic: leaf\ndescription: x\n---\nbody\n",
      );
      await expect(build(dir)).rejects.toThrow(/is missing index\.md/);
    });

    it("throws on a duplicate topic key declared across two different groups", async () => {
      const dir = makeTempDir();
      for (const groupName of ["group-a", "group-b"]) {
        const groupDir = join(dir, groupName);
        mkdirSync(groupDir);
        writeFileSync(
          join(groupDir, "index.md"),
          "---\ndescription: x\n---\nbody\n",
        );
        writeFileSync(
          join(groupDir, "leaf.md"),
          "---\ntopic: shared-key\ndescription: x\n---\nbody\n",
        );
      }
      await expect(build(dir)).rejects.toThrow(
        /Duplicate topic\/group key: 'shared-key'/,
      );
    });

    it("throws when the resources tree has no topics at all", async () => {
      const dir = makeTempDir();
      await expect(build(dir)).rejects.toThrow(/no topics found/);
    });

    it("succeeds and produces a top-level index for a valid minimal tree", async () => {
      const dir = makeTempDir();
      const groupDir = join(dir, "group");
      mkdirSync(groupDir);
      writeFileSync(
        join(groupDir, "index.md"),
        "---\ndescription: Group primer.\n---\nGroup body.\n",
      );
      writeFileSync(
        join(groupDir, "leaf.md"),
        "---\ntopic: leaf-topic\ndescription: A leaf.\n---\nLeaf body.\n",
      );
      const source = await build(dir);
      expect(source).toContain("leaf-topic");
      expect(source).toContain("TOPIC_INDEX");
    });
  });

  describe("buildTopLevelIndex", () => {
    it("lists every top-level subgroup with its description", () => {
      const root = {
        key: "",
        description: null,
        body: null,
        leafTopics: [],
        subgroups: [
          {
            key: "alpha",
            description: "Alpha group.",
            body: "",
            leafTopics: [],
            subgroups: [],
          },
          {
            key: "beta",
            description: "Beta group.",
            body: "",
            leafTopics: [],
            subgroups: [],
          },
        ],
      };
      const index = buildTopLevelIndex(root as any);
      expect(index).toContain("alpha");
      expect(index).toContain("Alpha group.");
      expect(index).toContain("beta");
      expect(index).toContain("Beta group.");
    });
  });
});
