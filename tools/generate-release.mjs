import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { committedHookBaseline } from "./hook-git-baseline.mjs";
const hooks = await import(new URL("../dist/release/hook-content.js", import.meta.url).href)
  .catch((error) => {
    throw new Error(
      "generate-release: the built release module is missing; run npm run build:dist first",
      { cause: error },
    );
  });
// The authored project context has one renderer: the built, portable release module
// that the Node helper prepareProjectContext also uses (npm run build:dist first).
const renderer = await import(new URL("../dist/release/project-context.js", import.meta.url).href)
  .catch((error) => {
    throw new Error(
      "generate-release: the built release module is missing; run npm run build:dist first",
      { cause: error },
    );
  });

/**
 * Generates the carried Catalog release (`urn:aihq:catalog:release:1.0.0`): the
 * release document, Core recipes (`urn:aihq:core:recipe:1.0.0`) and the exact
 * upstream material bytes they deliver.
 *
 * Inputs are committed files only. Material bytes come from the pinned upstream
 * snapshot; their provenance (repository, revision, path and digests) is taken
 * from the donor's assessment-shaped closure/profile metadata and must agree
 * with those bytes. Reading the generated release never needs those assessment
 * files, qualification, Scan or Workbench. Nothing is fetched or executed.
 *
 *   node tools/generate-release.mjs [--check | --hooks-only] [catalog-root]
 *
 * The authored project context is rendered for the published default instruction
 * directory (`ai-coding`) by the built renderer in dist/release/project-context.js.
 *
 * This is the seed generator for the carried donor snapshot. Once a targeted candidate
 * (tools/prepare-candidate.mjs) has advanced release/ beyond that snapshot, `--check`
 * checks the authored context separately and defers upstream integrity to
 * tools/check-release.mjs; generation refuses instead of restoring the older snapshot.
 * --hooks-only regenerates just the authored 1.1 hook closure, with selector continuity
 * checked against the committed baseline, and never rewrites the 1.0 release.
 */
export const OUTPUT_ROOT = "release";
export const RELEASE_PATH = "release/release.json";
export const HOOK_RELEASE_PATH = "release/release-1.1.json";
const SNAPSHOT = "src/production/data/mattpocock.snapshot.json";
const ASSESSMENT = (entry) => `defaults/workbench/mattpocock/skill.mattpocock.${entry}/artifacts`;
const SOURCE_ID = "mattpocock-skills";
const REPOSITORY = "mattpocock/skills";
const LICENSE_PATH = "LICENSE";
const AGENT_DIRECTORY_INPUT = {
  type: "string",
  required: true,
  default: ".claude",
  minLength: 1,
  maxLength: 64,
  description: "Project directory that receives skills/<name>/ (Claude Code reads .claude).",
};

/** The carried items. `entry` names the donor assessment directory for provenance. */
const ITEMS = [
  {
    id: "mattpocock.grill-me",
    entry: "grill-me",
    label: "Grill me",
    requires: ["mattpocock.grilling"],
  },
  {
    id: "mattpocock.grilling",
    entry: "grilling",
    label: "Grilling",
    requires: [],
  },
];

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => {
  throw new Error(`generate-release: ${message}`);
};
export const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort(compare)
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const document = (value) => Buffer.from(`${canonical(value)}\n`, "utf8");
const readJson = (root, path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const bare = (digest, label) => {
  if (typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(digest)) fail(`${label}: digest`);
  return digest.slice("sha256:".length);
};

/** Provenance from the donor assessment closure/profile, cross-checked against the snapshot bytes. */
function provenance(root, snapshot, entry) {
  const closure = readJson(root, `${ASSESSMENT(entry)}/closure.json`);
  const profile = readJson(root, `${ASSESSMENT(entry)}/profile.json`);
  const source = profile.source;
  if (source?.type !== "github" || source.repository !== REPOSITORY) fail(`${entry}: profile source`);
  if (closure.sourceRevisionId !== source.commit || snapshot.upstream.pin !== source.commit) {
    fail(`${entry}: closure, profile and snapshot revisions differ`);
  }
  if (closure.scope?.kind !== "source-files" || !Array.isArray(closure.files)) fail(`${entry}: closure`);
  const declared = new Map(closure.files.map((file) => [file.path, bare(file.digest, `${entry} ${file.path}`)]));
  if (declared.size !== 2 || !declared.has(LICENSE_PATH) || !declared.has(source.path)) {
    fail(`${entry}: closure must be exactly the skill file and its license`);
  }
  const files = [...declared].map(([path, digest]) => {
    const record = snapshot.entries.find((candidate) => candidate.path === path);
    if (record === undefined) fail(`${entry}: snapshot lacks ${path}`);
    const bytes = Buffer.from(record.base64, "base64");
    if (sha256(bytes) !== digest || record.sha256 !== digest || record.sizeBytes !== bytes.length) {
      fail(`${entry}: ${path} bytes disagree with the assessment closure`);
    }
    return { path, bytes, sha256: digest };
  });
  const frontmatter = snapshot.entries.find((candidate) => candidate.path === source.path)?.frontmatter;
  const description = /^description: (.+)$/m.exec(frontmatter ?? "")?.[1];
  if (description === undefined) fail(`${entry}: snapshot frontmatter description`);
  return { revision: source.commit, skillPath: source.path, files, description };
}

const {
  CONTEXT_SOURCE,
  DEFAULT_INSTRUCTION_DIRECTORY,
  renderedItemSha256,
  renderContextFamily,
  reproducesAuthoredContext,
} = renderer;

/** The authored context family for the published default directory, its bytes registered through `put`. */
function contextFamily(put) {
  const family = renderContextFamily(DEFAULT_INSTRUCTION_DIRECTORY);
  for (const [path, bytes] of family.files) put(path, Buffer.from(bytes));
  return family.items;
}

/** The 1.1 release of authored client hook items, its bytes registered through `put`. */
function hookRelease(pkg, put) {
  const family = hooks.renderHookFamily();
  for (const [path, bytes] of family.files) put(path, Buffer.from(bytes));
  put(
    HOOK_RELEASE_PATH,
    document({
      schema: "urn:aihq:catalog:release:1.1.0",
      package: { name: pkg.name, version: pkg.version },
      sources: [hooks.HOOK_SOURCE],
      items: family.items,
    }),
  );
}

/** The authored 1.1 closure only; preserves the targeted upstream/context release. */
export function generateHookRelease(root) {
  const files = new Map();
  hookRelease(readJson(root, "package.json"), (path, bytes) => files.set(path, bytes));
  return files;
}

/** The hook release is authored and independent of the upstream pin; it must match its generator. */
function checkHookRelease(root) {
  const files = new Map();
  // Its embedded package identity is checked against package.json by npm run check:release.
  hookRelease(readJson(root, HOOK_RELEASE_PATH).package, (path, bytes) => files.set(path, bytes));
  for (const [path, bytes] of files) {
    let existing;
    try {
      existing = readFileSync(resolve(root, path));
    } catch {
      existing = undefined;
    }
    if (existing === undefined || !existing.equals(bytes)) fail(`${path} is stale; run npm run generate:release`);
  }
}

/** Authored content remains reproducible independently of the upstream pin. */
function checkContextContent(root) {
  const files = new Map();
  contextFamily((path, bytes) => files.set(path, bytes));
  const release = readJson(root, RELEASE_PATH);
  // The same reproduction check the Node helper applies to a source release, over
  // the committed records with the item hashes a reader would compute for them.
  const view = {
    items: (release.items ?? []).map((item) => ({ ...item, itemSha256: renderedItemSha256(item) })),
    sources: release.sources ?? [],
  };
  if (!reproducesAuthoredContext(view)) fail("authored context records or source are stale");
  for (const [path, bytes] of files) {
    if (!readFileSync(resolve(root, path)).equals(bytes)) fail(`${path} is stale`);
  }
}

const target = (name, file) => ({
  root: "project",
  segments: [{ input: "agentDirectory" }, { literal: "skills" }, { literal: name }, { literal: file }],
});

function recipeFor(item, origin, materials) {
  const deliver = [
    { material: "skill", file: "SKILL.md", purpose: `Write the pinned ${item.entry} SKILL.md` },
    { material: "license", file: "LICENSE", purpose: "Write the upstream MIT license notice beside the skill" },
  ];
  return {
    schema: "urn:aihq:core:recipe:1.0.0",
    id: item.id,
    description: `Install the ${item.entry} skill from ${REPOSITORY} at ${origin.revision} with its MIT license notice.`,
    inputs: { agentDirectory: AGENT_DIRECTORY_INPUT },
    materials: materials.map(({ id, sha256: hash, byteLength }) => ({ id, sha256: hash, byteLength })),
    targets: ["project"],
    prerequisites: [],
    operations: deliver.map((step) => ({
      id: `write-${step.material}`,
      purpose: step.purpose,
      kind: "file.write",
      scope: "project",
      target: target(item.entry, step.file),
      material: step.material,
      requires: [],
      checks: [`${step.material}-sha256`],
    })),
    checks: deliver.map((step) => ({
      id: `${step.material}-sha256`,
      purpose: `The installed ${step.file} has the pinned bytes`,
      kind: "file.sha256",
      target: target(item.entry, step.file),
      sha256: materials.find((member) => member.id === step.material).sha256,
    })),
  };
}

/** True when the committed release no longer comes solely from the donor snapshot pin. */
export function advancedBeyondSnapshot(root) {
  let release;
  try {
    release = readJson(root, RELEASE_PATH);
  } catch {
    return false;
  }
  const pin = readJson(root, SNAPSHOT).upstream?.pin;
  const revisions = new Set((release.sources ?? [])
    .filter((source) => source.origin?.kind === "git")
    .map((source) => source.origin.revision));
  return revisions.size !== 1 || !revisions.has(pin);
}

function assertSeedGenerationAllowed(root) {
  if (advancedBeyondSnapshot(root)) {
    fail(
      "the targeted release has advanced beyond the donor snapshot; this seed generator cannot replace it (use tools/prepare-candidate.mjs)",
    );
  }
}

/** Returns every output file (package-relative path → bytes), the release document last. */
export function generateRelease(root) {
  assertSeedGenerationAllowed(root);
  const pkg = readJson(root, "package.json");
  const snapshot = readJson(root, SNAPSHOT);
  const files = new Map();
  const put = (path, bytes) => {
    const prior = files.get(path);
    if (prior !== undefined && !prior.equals(bytes)) fail(`${path}: two different byte sequences`);
    files.set(path, bytes);
  };
  let revision;
  const mattpocockItems = ITEMS.map((item) => {
    const origin = provenance(root, snapshot, item.entry);
    revision ??= origin.revision;
    if (origin.revision !== revision) fail("items must share the pinned source revision");
    const base = `${OUTPUT_ROOT}/materials/github.com/${REPOSITORY}/${origin.revision}`;
    const materials = origin.files
      .map((file) => {
        const path = `${base}/${file.path}`;
        put(path, file.bytes);
        return {
          id: file.path === LICENSE_PATH ? "license" : "skill",
          path,
          sha256: file.sha256,
          byteLength: file.bytes.length,
        };
      })
      .sort((a, b) => compare(a.id, b.id));
    const recipePath = `${OUTPUT_ROOT}/recipes/${item.id}.json`;
    const recipeBytes = document(recipeFor(item, origin, materials));
    put(recipePath, recipeBytes);
    return {
      id: item.id,
      label: item.label,
      description: origin.description,
      kind: "skill",
      sourceIds: [SOURCE_ID],
      targets: [],
      scopes: ["project"],
      inputs: { agentDirectory: AGENT_DIRECTORY_INPUT },
      recipe: {
        id: item.id,
        schema: "urn:aihq:core:recipe:1.0.0",
        path: recipePath,
        sha256: sha256(recipeBytes),
        byteLength: recipeBytes.length,
      },
      materials,
      dependencies: {
        requires: item.requires.map((itemId) => ({ itemId })),
        optional: [],
        conflicts: [],
      },
      metadata: { upstream: { path: origin.skillPath, license: "MIT" } },
    };
  }).sort((a, b) => compare(a.id, b.id));
  const items = [
    ...mattpocockItems,
    ...contextFamily(put),
  ].sort((a, b) => compare(a.id, b.id));
  const release = {
    schema: "urn:aihq:catalog:release:1.0.0",
    package: { name: pkg.name, version: pkg.version },
    sources: [
      { id: CONTEXT_SOURCE.id, origin: { kind: CONTEXT_SOURCE.origin.kind } },
      {
        id: SOURCE_ID,
        origin: { kind: "git", repository: `https://github.com/${REPOSITORY}`, revision },
      },
    ],
    items,
  };
  put(RELEASE_PATH, document(release));
  hookRelease(pkg, put);
  return files;
}

function existingFiles(root) {
  const base = resolve(root, OUTPUT_ROOT);
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name))
        : [relative(root, join(dir, entry.name)).replaceAll("\\", "/")],
    );
  };
  return walk(base);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const check = args[0] === "--check";
    const hooksOnly = args[0] === "--hooks-only";
    if (check || hooksOnly) args.shift();
    if (args.length > 1 || args[0]?.startsWith("-")) {
      fail("usage: node tools/generate-release.mjs [--check | --hooks-only] [catalog-root]");
    }
    const root = resolve(args[0] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
    if (!check && !hooksOnly) assertSeedGenerationAllowed(root);
    const baseline = process.env.AIHQ_RELEASE_BASELINE ?? "HEAD";
    let gitRoot;
    try {
      gitRoot = resolve(execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      }).trim());
    } catch {
      gitRoot = undefined;
    }
    const sameRoot = gitRoot !== undefined &&
      (process.platform === "win32"
        ? realpathSync.native(gitRoot).toLowerCase() === realpathSync.native(root).toLowerCase()
        : realpathSync(gitRoot) === realpathSync(root));
    if (!sameRoot && (!check || process.env.AIHQ_RELEASE_BASELINE !== undefined)) {
      fail("selector continuity needs a Git root and a committed baseline");
    }
    const continuity = async (files) => {
      if (!sameRoot) {
        console.log("Detached fixture: checked generated content; selector continuity unavailable without a Git baseline.");
        return;
      }
      const { assertHookSelectorContinuity } = await import(new URL("../dist/producer/hook-release.js", import.meta.url).href);
      assertHookSelectorContinuity(committedHookBaseline(root, baseline), files);
    };
    if (check && advancedBeyondSnapshot(root)) {
      checkContextContent(root);
      checkHookRelease(root);
      const hookFiles = new Map();
      hookRelease(readJson(root, HOOK_RELEASE_PATH).package, (path, bytes) => hookFiles.set(path, bytes));
      await continuity(hookFiles);
      console.log("Checked authored context and release/release-1.1.json; upstream release advanced beyond the donor snapshot. Run npm run check:release.");
      process.exit(0);
    }
    const files = hooksOnly ? generateHookRelease(root) : generateRelease(root);
    // Compare with one immutable commit before checking or writing output. The working
    // tree cannot redefine its own baseline by deleting or regenerating release/.
    await continuity(files);
    const stale = hooksOnly ? [] : existingFiles(root).filter((path) => !files.has(path));
    if (check) {
      for (const [path, bytes] of files) {
        let existing;
        try {
          existing = readFileSync(resolve(root, path));
        } catch {
          existing = undefined;
        }
        if (existing === undefined || !existing.equals(bytes)) {
          fail(`${path} is stale; run npm run generate:release`);
        }
      }
      if (stale.length > 0) fail(`unexpected release files: ${stale.join(", ")}`);
    } else {
      for (const path of stale) rmSync(resolve(root, path));
      for (const [path, bytes] of files) {
        const output = resolve(root, path);
        mkdirSync(dirname(output), { recursive: true });
        const temporary = `${output}.tmp`;
        writeFileSync(temporary, bytes, { flag: "wx" });
        try {
          renameSync(temporary, output);
        } finally {
          rmSync(temporary, { force: true });
        }
      }
    }
    console.log(hooksOnly
      ? `Generated ${HOOK_RELEASE_PATH}: ${files.size - 1} hook recipe/material files; ${RELEASE_PATH} unchanged`
      : `${check ? "Checked" : "Generated"} ${RELEASE_PATH} and ${HOOK_RELEASE_PATH}: ${files.size - 2} recipe/material files`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
