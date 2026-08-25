#!/usr/bin/env node
// Build the `explain` tool's reference library from a directory tree of markdown
// resource files under docs/explain/resources/.
//
// docs/explain/resources/ is a literal hierarchy: every directory at any depth
// (except the resources/ root itself) must contain exactly one index.md, the
// primer for that directory. Leaf topic files declare `topic:`/`description:`
// frontmatter; their group is derived from their parent directory, never
// hand-written.
//
// Generates: src/tools/explainTopics.generated.ts
//
// Usage:
//   node scripts/build-explain-topics.mjs          # write the generated file
//   node scripts/build-explain-topics.mjs --check  # fail (exit 1) if the
//                                                   # committed file is stale
//                                                   # or the source tree has
//                                                   # validation errors

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..");
export const RESOURCES = join(REPO_ROOT, "docs", "explain", "resources");
export const GENERATED_TS = join(
  REPO_ROOT,
  "src",
  "tools",
  "explainTopics.generated.ts",
);

const BLOCK_SCALAR_VALUES = new Set([">", "|", ">-", ">+", "|-", "|+"]);

/**
 * Parse simple single-line YAML frontmatter (`---\nkey: value\n---\nbody`).
 * Throws on malformed frontmatter (no closing `---`), a key declared twice,
 * or a YAML block scalar (`>`/`|`) — this parser only supports single-line
 * `key: value` pairs.
 */
export function parseFrontmatter(content, path) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    throw new Error(`No frontmatter found in ${path}`);
  }
  const fmText = match[1];
  const body = content.slice(match[0].length);
  const metadata = {};
  for (const rawLine of fmText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const colonIndex = rawLine.indexOf(":");
    if (colonIndex === -1) {
      throw new Error(
        `${path}: invalid frontmatter line ${JSON.stringify(rawLine)} — only single-line ` +
          "'key: value' pairs are supported (YAML block scalars '>'/'|' are not)",
      );
    }
    const key = rawLine.slice(0, colonIndex).trim();
    const value = rawLine.slice(colonIndex + 1).trim();
    if (BLOCK_SCALAR_VALUES.has(value)) {
      throw new Error(
        `${path}: frontmatter key '${key}' uses a YAML block scalar ('${value}') — ` +
          "not supported by this simple parser; use a single-line value instead",
      );
    }
    if (key in metadata) {
      throw new Error(`Duplicate frontmatter key '${key}' in ${path}`);
    }
    metadata[key] = value;
  }
  return { metadata, body };
}

/**
 * Recursively scan `dirPath` into a GroupIndex tree, collecting validation
 * errors into `errors` instead of throwing (so one bad file doesn't abort the
 * whole scan).
 */
export function scanDir(dirPath, rel, errors) {
  let entryNames;
  try {
    entryNames = readdirSync(dirPath).sort();
  } catch (e) {
    errors.push(`${dirPath}: cannot list directory (${e.message})`);
    return {
      key: rel,
      description: null,
      body: null,
      leafTopics: [],
      subgroups: [],
    };
  }

  const entries = entryNames.map((name) => join(dirPath, name));
  const mdFiles = [];
  const subdirs = [];
  for (const entry of entries) {
    let st;
    try {
      st = statSync(entry);
    } catch (e) {
      errors.push(
        `${entry}: cannot classify as file or directory (${e.message})`,
      );
      continue;
    }
    if (st.isFile() && entry.endsWith(".md")) mdFiles.push(entry);
    else if (st.isDirectory()) subdirs.push(entry);
  }

  const indexCandidates = mdFiles.filter((p) => p.endsWith("/index.md"));
  const leafFiles = mdFiles.filter((p) => !p.endsWith("/index.md"));

  let description = null;
  let body = null;

  if (rel === "") {
    if (indexCandidates.length > 0) {
      errors.push(
        "resources/ root must not contain an index.md — the root index is generated, not authored",
      );
    }
    if (leafFiles.length > 0) {
      const names = leafFiles.map((p) => p.split("/").pop()).join(", ");
      errors.push(
        `resources/ root must not contain topic files directly (${names}) — move them into a group directory`,
      );
    }
  } else if (indexCandidates.length === 0) {
    errors.push(
      `${rel}/ is missing index.md — every group directory needs exactly one`,
    );
  } else if (indexCandidates.length > 1) {
    errors.push(`${rel}/ has more than one index.md`);
  } else {
    const indexPath = indexCandidates[0];
    try {
      const content = readFileSync(indexPath, "utf-8");
      const { metadata, body: rawBody } = parseFrontmatter(content, indexPath);
      if ("topic" in metadata) {
        errors.push(
          `${indexPath}: index.md must not declare 'topic' — its key is derived from its directory path`,
        );
      }
      description = (metadata.description || "").trim();
      if (!description) {
        errors.push(`${indexPath}: missing 'description' in frontmatter`);
      }
      body = rawBody.trim();
    } catch (e) {
      errors.push(e.message);
    }
  }

  const leafTopics = [];
  for (const mdFile of leafFiles) {
    let content;
    try {
      content = readFileSync(mdFile, "utf-8");
    } catch (e) {
      errors.push(`${mdFile}: cannot read file (${e.message})`);
      continue;
    }
    let parsed;
    try {
      parsed = parseFrontmatter(content, mdFile);
    } catch (e) {
      errors.push(e.message);
      continue;
    }
    const { metadata, body: rawBody } = parsed;
    if ("group" in metadata) {
      errors.push(
        `${mdFile}: leaf topic files must not declare 'group' — it is derived from directory nesting`,
      );
    }
    const topic = (metadata.topic || "").trim();
    const topicDescription = (metadata.description || "").trim();
    if (!topic) {
      errors.push(`${mdFile}: missing 'topic' in frontmatter`);
      continue;
    }
    if (!topicDescription) {
      errors.push(`${mdFile}: missing 'description' in frontmatter`);
      continue;
    }
    leafTopics.push({
      key: topic,
      description: topicDescription,
      body: rawBody.trim(),
      path: relative(RESOURCES, mdFile),
    });
  }
  leafTopics.sort((a, b) => a.key.localeCompare(b.key));

  const subgroups = [];
  for (const subdir of subdirs) {
    const childRel = rel
      ? `${rel}/${subdir.split("/").pop()}`
      : subdir.split("/").pop();
    subgroups.push(scanDir(subdir, childRel, errors));
  }
  subgroups.sort((a, b) => a.key.localeCompare(b.key));

  return { key: rel, description, body, leafTopics, subgroups };
}

function renderTable(rows) {
  const lines = ["| Topic | Description |", "| --- | --- |"];
  for (const [key, desc] of rows) {
    const safeDesc = desc.replace(/\|/g, "\\|");
    lines.push(`| \`${key}\` | ${safeDesc} |`);
  }
  return lines.join("\n");
}

/** Auto-generated "Topics in this group" listing for one group's own body. */
function buildChildrenSection(group) {
  const children = [
    ...group.leafTopics.map((t) => [t.key, t.description]),
    ...group.subgroups.map((g) => [g.key, g.description || ""]),
  ];
  if (children.length === 0) return "";
  children.sort((a, b) => a[0].localeCompare(b[0]));
  return ["### Topics in this group", "", renderTable(children)].join("\n");
}

/** Flatten the tree into (key, description, fullBody) entries. Excludes the virtual root. */
export function flatten(group) {
  const out = [];
  if (group.key) {
    const childrenSection = buildChildrenSection(group);
    let fullBody = group.body || "";
    if (childrenSection) {
      fullBody = fullBody
        ? `${fullBody}\n\n${childrenSection}`
        : childrenSection;
    }
    out.push([group.key, group.description || "", fullBody.trim()]);
  }
  for (const topic of group.leafTopics) {
    out.push([topic.key, topic.description, topic.body]);
  }
  for (const sub of group.subgroups) {
    out.push(...flatten(sub));
  }
  return out;
}

/** Groups-only top-level index for explain()'s no-arg response. */
export function buildTopLevelIndex(root) {
  const rows = root.subgroups.map((g) => [g.key, g.description || ""]);
  return ["Topics and what they cover:", "", renderTable(rows)].join("\n");
}

function generateModule(entries, root) {
  const topics = entries.map(([key]) => key);
  const topicIndex = `\n${buildTopLevelIndex(root)}\n`;
  const contentEntries = entries
    .map(
      ([key, , body]) => `  ${JSON.stringify(key)}: ${JSON.stringify(body)},`,
    )
    .join("\n");
  return `// AUTO-GENERATED by scripts/build-explain-topics.mjs — do not edit directly.
// Source: docs/explain/resources/
// Regenerate with: npm run build:explain

export const TOPICS: string[] = ${JSON.stringify(topics)};

export const TOPIC_INDEX: string = ${JSON.stringify(topicIndex)};

export const CONTENT: Record<string, string> = {
${contentEntries}
};
`;
}

/**
 * Scan docs/explain/resources/ (or `resourcesDir`, if provided — used by
 * tests to exercise validation-error paths against fixture trees without
 * touching the real docs/explain/resources/), validate it, and return the
 * generated module source (already formatted with the project's Prettier
 * config, so the committed output never drifts from `npx prettier --write`).
 * Throws with all collected errors joined if the tree is invalid.
 */
export async function build(resourcesDir = RESOURCES) {
  const errors = [];
  const root = scanDir(resourcesDir, "", errors);
  const entries = flatten(root);

  // Groups/subgroups get path-derived keys (e.g. "aiagent/tools"), but leaf
  // topic keys (their `topic:` frontmatter value) share one flat global
  // namespace by design — two leaf topics in different groups cannot use the
  // same `topic:` value.
  const seen = new Set();
  const reported = new Set();
  for (const [key] of entries) {
    if (seen.has(key) && !reported.has(key)) {
      errors.push(`Duplicate topic/group key: '${key}'`);
      reported.add(key);
    }
    seen.add(key);
  }

  if (errors.length > 0) {
    throw new Error(errors.map((e) => `ERROR: ${e}`).join("\n"));
  }
  if (entries.length === 0) {
    throw new Error("ERROR: no topics found");
  }

  const raw = generateModule(entries, root);
  return prettier.format(raw, { filepath: GENERATED_TS });
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  let source;
  try {
    source = await build();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  if (checkOnly) {
    let existing = "";
    try {
      existing = readFileSync(GENERATED_TS, "utf-8");
    } catch {
      // file doesn't exist yet — falls through to the mismatch report below
    }
    if (existing !== source) {
      console.error(
        `${GENERATED_TS} is out of date with docs/explain/resources/.\n` +
          "Run `npm run build:explain` and commit the result.",
      );
      process.exit(1);
    }
    console.log("explain topics are in sync.");
    return;
  }

  writeFileSync(GENERATED_TS, source, "utf-8");
  console.log(`Generated: ${GENERATED_TS}`);
}

// Only run main() when executed directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
