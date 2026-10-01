import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adapterNote,
  BLOCK_ID,
  CLIENTS,
  CONTEXT_DIR,
  END_MARKER,
  mergedPointerContent,
  ownedPointerDocument,
  POINTERS,
  behaviorCoreDoc,
  ruleRouterDoc,
  sharedBlockBody,
  START_MARKER,
} from "./context-content.mjs";

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
 *   node tools/generate-release.mjs [--check] [catalog-root]
 *
 * This is the seed generator for the carried donor snapshot. Once a targeted candidate
 * (tools/prepare-candidate.mjs) has advanced release/ beyond that snapshot, `--check`
 * checks the authored context separately and defers upstream integrity to
 * tools/check-release.mjs instead of restoring the older upstream snapshot.
 */
export const OUTPUT_ROOT = "release";
export const RELEASE_PATH = "release/release.json";
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

const CONTEXT_SOURCE_ID = "aihq-project-context";
const CONTEXT_ITEM_ID = "aihq.project-context";
const CONTEXT_MATERIALS = `${OUTPUT_ROOT}/materials/aihq/project-context`;
const DONOR_PROVENANCE = {
  repository: "https://github.com/samartomar/ai-harness",
  revision: "f5d5f84b9006b628778983dab56dd92dc8888156",
};

const literalTarget = (segments) => ({
  root: "project",
  segments: segments.map((segment) => ({ literal: segment })),
});

function registerContextRecipe(put, itemId, bytes) {
  const path = `${OUTPUT_ROOT}/recipes/${itemId}.json`;
  put(path, bytes);
  return {
    id: itemId,
    schema: "urn:aihq:core:recipe:1.0.0",
    path,
    sha256: sha256(bytes),
    byteLength: bytes.length,
  };
}

/**
 * The shared project-context item and its family: one file.write per pinned
 * context document, each with a file.sha256 check. Returns the item record and
 * registers its recipe/material bytes through `put`.
 */
function contextItem(put) {
  const documents = [
    { id: "rule-router", target: [CONTEXT_DIR, "RULE_ROUTER.md"], text: ruleRouterDoc() },
    {
      id: "shared-block",
      target: [CONTEXT_DIR, "adapters", "_shared-canonical-block.md"],
      text: sharedBlockBody(),
    },
    {
      id: "behavior-core",
      target: [CONTEXT_DIR, "rules", "agent-behavior-core.md"],
      text: behaviorCoreDoc(),
    },
  ];
  const materials = documents
    .map((doc) => {
      const bytes = Buffer.from(doc.text, "utf8");
      const path = `${CONTEXT_MATERIALS}/${doc.target.join("/")}`;
      put(path, bytes);
      return { id: doc.id, path, sha256: sha256(bytes), byteLength: bytes.length, target: doc.target };
    })
    .sort((a, b) => compare(a.id, b.id));
  const recipeBytes = document({
    schema: "urn:aihq:core:recipe:1.0.0",
    id: CONTEXT_ITEM_ID,
    description: `Deliver the shared project AI context under ${CONTEXT_DIR}/ (router, shared block source, behavior core).`,
    inputs: {},
    materials: materials.map(({ id, sha256: hash, byteLength }) => ({ id, sha256: hash, byteLength })),
    targets: ["project"],
    prerequisites: [],
    operations: materials.map((member) => ({
      id: `write-${member.id}`,
      purpose: `Write the pinned ${member.target.join("/")}`,
      kind: "file.write",
      scope: "project",
      target: literalTarget(member.target),
      material: member.id,
      requires: [],
      checks: [`${member.id}-sha256`],
    })),
    checks: materials.map((member) => ({
      id: `${member.id}-sha256`,
      purpose: `The installed ${member.target.join("/")} has the pinned bytes`,
      kind: "file.sha256",
      target: literalTarget(member.target),
      sha256: member.sha256,
    })),
  });
  const recipeReference = registerContextRecipe(put, CONTEXT_ITEM_ID, recipeBytes);
  return {
    id: CONTEXT_ITEM_ID,
    label: "Shared project AI context",
    description: `Project-owned AI context (router, shared canonical block, behavior core) under ${CONTEXT_DIR}/.`,
    kind: "project-context",
    sourceIds: [CONTEXT_SOURCE_ID],
    targets: [],
    scopes: ["project"],
    inputs: {},
    recipe: recipeReference,
    materials: materials.map(({ id, path, sha256: hash, byteLength }) => ({
      id,
      path,
      sha256: hash,
      byteLength,
    })),
    dependencies: { requires: [], optional: [], conflicts: [] },
    metadata: { adaptedFrom: DONOR_PROVENANCE },
  };
}

/**
 * One explicit owner per native client entry file. Merged entries use text.block
 * (user text outside the markers survives, and no whole-file check is claimed);
 * wholly canon-owned entry files use file.write with a pinned byte check.
 */
function pointerItems(put) {
  return POINTERS.map((pointer) => {
    const itemId = `aihq.project-context-pointer.${pointer.key}`;
    const common = {
      schema: "urn:aihq:core:recipe:1.0.0",
      id: itemId,
      inputs: {},
      targets: ["project"],
      prerequisites: [],
    };
    let materials = [];
    let recipe;
    if (pointer.delivery === "merge") {
      recipe = {
        ...common,
        description: `Merge the shared AI context block into ${pointer.path.join("/")}, preserving text outside the markers.`,
        materials: [],
        operations: [
          {
            id: "merge-context-block",
            purpose: `Add or refresh the shared context block in ${pointer.path.join("/")}`,
            kind: "text.block",
            scope: "project",
            target: literalTarget(pointer.path),
            blockId: BLOCK_ID,
            startMarker: START_MARKER,
            endMarker: END_MARKER,
            action: "set",
            content: { literal: mergedPointerContent(pointer.key) },
            requires: [],
            checks: [],
          },
        ],
        checks: [],
      };
    } else {
      const bytes = Buffer.from(ownedPointerDocument(pointer.key), "utf8");
      const path = `${CONTEXT_MATERIALS}/pointers/${pointer.path.join("/")}`;
      put(path, bytes);
      materials = [{ id: "pointer", path, sha256: sha256(bytes), byteLength: bytes.length }];
      recipe = {
        ...common,
        description: `Deliver the canon-owned ${pointer.path.join("/")} entry file with its activation frontmatter.`,
        materials: materials.map(({ id, sha256: hash, byteLength }) => ({
          id,
          sha256: hash,
          byteLength,
        })),
        operations: [
          {
            id: "write-pointer",
            purpose: `Write the pinned ${pointer.path.join("/")}`,
            kind: "file.write",
            scope: "project",
            target: literalTarget(pointer.path),
            material: "pointer",
            requires: [],
            checks: ["pointer-sha256"],
          },
        ],
        checks: [
          {
            id: "pointer-sha256",
            purpose: `The installed ${pointer.path.join("/")} has the pinned bytes`,
            kind: "file.sha256",
            target: literalTarget(pointer.path),
            sha256: materials[0].sha256,
          },
        ],
      };
    }
    const recipeBytes = document(recipe);
    const recipeReference = registerContextRecipe(put, itemId, recipeBytes);
    return {
      id: itemId,
      label: pointer.label,
      description: recipe.description,
      kind: "client-entry-pointer",
      sourceIds: [CONTEXT_SOURCE_ID],
      targets: [],
      scopes: ["project"],
      inputs: {},
      recipe: recipeReference,
      materials,
      dependencies: { requires: [{ itemId: CONTEXT_ITEM_ID }], optional: [], conflicts: [] },
      metadata: { adaptedFrom: DONOR_PROVENANCE },
    };
  });
}

/** The per-client selection surface: the adapter note plus explicit pointer dependencies. */
function clientItems(put) {
  return CLIENTS.map((client) => {
    const itemId = `aihq.client.${client.id}`;
    const target = [CONTEXT_DIR, "adapters", `${client.id}.md`];
    const bytes = Buffer.from(adapterNote(client), "utf8");
    const path = `${CONTEXT_MATERIALS}/${target.join("/")}`;
    put(path, bytes);
    const materials = [{ id: "adapter-note", path, sha256: sha256(bytes), byteLength: bytes.length }];
    const recipeBytes = document({
      schema: "urn:aihq:core:recipe:1.0.0",
      id: itemId,
      description: `Deliver the ${client.label} adapter note under ${CONTEXT_DIR}/adapters/.`,
      inputs: {},
      materials: materials.map(({ id, sha256: hash, byteLength }) => ({
        id,
        sha256: hash,
        byteLength,
      })),
      targets: ["project"],
      prerequisites: [],
      operations: [
        {
          id: "write-adapter-note",
          purpose: `Write the pinned ${target.join("/")}`,
          kind: "file.write",
          scope: "project",
          target: literalTarget(target),
          material: "adapter-note",
          requires: [],
          checks: ["adapter-note-sha256"],
        },
      ],
      checks: [
        {
          id: "adapter-note-sha256",
          purpose: `The installed ${target.join("/")} has the pinned bytes`,
          kind: "file.sha256",
          target: literalTarget(target),
          sha256: materials[0].sha256,
        },
      ],
    });
    const recipeReference = registerContextRecipe(put, itemId, recipeBytes);
    return {
      id: itemId,
      label: `${client.label} context wiring`,
      description: `${client.label} adapter note and its native entry pointer(s): ${client.pointers.join(", ")}.`,
      kind: "client-adapter",
      sourceIds: [CONTEXT_SOURCE_ID],
      targets: [],
      scopes: ["project"],
      inputs: {},
      recipe: recipeReference,
      materials,
      dependencies: {
        requires: client.pointers.map((key) => ({ itemId: `aihq.project-context-pointer.${key}` })),
        optional: [],
        conflicts: [],
      },
      metadata: { adaptedFrom: DONOR_PROVENANCE },
    };
  });
}

function contextFamily(put) {
  return [contextItem(put), ...pointerItems(put), ...clientItems(put)]
    .sort((a, b) => compare(a.id, b.id));
}

/** Authored content remains reproducible independently of the upstream pin. */
function checkContextContent(root) {
  const files = new Map();
  const expected = contextFamily((path, bytes) => files.set(path, bytes));
  const release = readJson(root, RELEASE_PATH);
  const actual = (release.items ?? [])
    .filter((item) => item.sourceIds?.includes(CONTEXT_SOURCE_ID))
    .sort((a, b) => compare(a.id, b.id));
  if (canonical(actual) !== canonical(expected)) fail("authored context records are stale");
  const source = (release.sources ?? []).find((item) => item.id === CONTEXT_SOURCE_ID);
  if (canonical(source) !== canonical({ id: CONTEXT_SOURCE_ID, origin: { kind: "authored" } })) {
    fail("authored context source is stale");
  }
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

/** Returns every output file (package-relative path → bytes), the release document last. */
export function generateRelease(root) {
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
      { id: CONTEXT_SOURCE_ID, origin: { kind: "authored" } },
      {
        id: SOURCE_ID,
        origin: { kind: "git", repository: `https://github.com/${REPOSITORY}`, revision },
      },
    ],
    items,
  };
  put(RELEASE_PATH, document(release));
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
    if (check) args.shift();
    if (args.length > 1 || args[0]?.startsWith("-")) {
      fail("usage: node tools/generate-release.mjs [--check] [catalog-root]");
    }
    const root = resolve(args[0] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
    if (check && advancedBeyondSnapshot(root)) {
      checkContextContent(root);
      console.log("Checked authored context; upstream release advanced beyond the donor snapshot. Run npm run check:release.");
      process.exit(0);
    }
    const files = generateRelease(root);
    const stale = existingFiles(root).filter((path) => !files.has(path));
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
    console.log(`${check ? "Checked" : "Generated"} ${RELEASE_PATH}: ${files.size - 1} recipe/material files`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
