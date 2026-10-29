#!/usr/bin/env node
// The Project basics framework: the frozen default's project context split into a
// router document and two rules, prepared as release 1.7.0 content. The texts come
// from the authored renderer's folder-neutral variant: they name their neighbours
// by their place in the folder a project chooses, never a folder name, and promise
// no tool-specific notes. Any placeholder outside the closed list fails the build.
// Per-project facts, the folder a project chooses and drift are the installer's,
// not this release's; the release 1.x recipes take that folder as an input.
// The baseline binding is a separate preparation step (docs/SCAN-BASELINE.md):
// this script freezes the content inventory it must capture and binds nothing.
// Run `npm run build:dist` first. No acquisition, execution or Scan.
//
//   node tools/generate-project-basics-release.mjs [--check]
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  projectBasicsRouterDoc,
  projectBasicsSharedBlock,
  projectBasicsWorkingRulesDoc,
} from "../dist/release/context-content.js";
import { FROZEN_DEFAULT_RELEASE_SHA256 } from "../dist/release/contracts.js";
import { computeBehaviourIdentity } from "../dist/release/document.js";
import { canonicalJson } from "../dist/release/json.js";
import { compileTransitionRelease } from "../dist/release/producer.js";
import { createContentInventory, readRelease, readReleaseContent } from "../dist/release/reader.js";
import { sha256Hex } from "../dist/release/sha256.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const encoder = new TextEncoder();
const bytesOf = (value) => encoder.encode(`${canonicalJson(value)}\n`);
const FRAMEWORK = "project-basics";
export const CONTENT_PATH = "release/release-project-basics.content.json";
export const INVENTORY_PATH = "release/baselines/project-basics/content-inventory.json";
const SOURCE = { id: FRAMEWORK, origin: { kind: "authored" }, license: "Apache-2.0" };
const REPOSITORY = "https://github.com/samartomar/aih-catalog";
const CONTEXT_ID = "aihq.project-context";

/** The closed placeholder list; any other `{…}` in an item's text fails the build. */
const PLACEHOLDER = /^\{(projectDir|homeDir|itemDir|pluginRoot)\}$/;
export function placeholderProblems(text) {
  return [...text.matchAll(/\{[^{}]*\}/g)]
    .map((match) => match[0])
    .filter((token) => !PLACEHOLDER.test(token));
}

/**
 * Folder-neutral text: the project names its folder, so no item text may name a
 * folder or promise the per-tool adapter notes this release does not deliver.
 */
const FOLDER_REFERENCE = /ai-coding|adapters\//g;
export function folderProblems(text) {
  return [...new Set([...text.matchAll(FOLDER_REFERENCE)].map((match) => match[0]))];
}

/**
 * The three items: id, kind, the frozen context material each splits, its
 * item-relative path, folder-neutral renderer and typed payload. A document's placement is
 * declared to the transition build, as release 1.6 documents cannot carry it.
 */
export const ITEMS = [
  {
    id: "project-basics.router",
    kind: "document",
    purpose: "guide",
    placement: "project-folder",
    material: "rule-router",
    relPath: "RULE_ROUTER.md",
    render: projectBasicsRouterDoc,
    name: "Rule router",
    description: "The routing guide: what to read first and which rules a task needs.",
    payload: { files: ["rule-router"] },
    // The router routes to the working rules.
    requires: ["project-basics.working-rules"],
  },
  {
    id: "project-basics.shared-block",
    kind: "rule",
    placement: "entry-block",
    material: "shared-block",
    relPath: "shared-block.md",
    render: projectBasicsSharedBlock,
    name: "Shared block",
    description: "The shared essentials, placed as a marked block in each tool's entry files.",
    payload: { applyTo: ["**"], applyToBasis: "publisher", placement: "entry-block" },
    // The block points to the router first and to the full working rules.
    requires: ["project-basics.router", "project-basics.working-rules"],
  },
  {
    id: "project-basics.working-rules",
    kind: "rule",
    placement: "project-folder",
    material: "behavior-core",
    relPath: "rules/agent-behavior-core.md",
    render: projectBasicsWorkingRulesDoc,
    name: "Working rules",
    description: "The full working discipline the router and the shared block point to.",
    payload: { applyTo: ["**"], applyToBasis: "publisher", placement: "project-folder" },
    requires: [],
  },
];
const materialPath = (relPath) => `release/materials/${FRAMEWORK}/${relPath}`;
/** The release 1.x recipe input naming the project's folder, as Core recipes define inputs. */
const FOLDER_INPUT = {
  projectFolder: {
    type: "string",
    required: true,
    default: "ai-coding",
    minLength: 1,
    maxLength: 64,
    description: "Project folder, one name at the project root, that receives the Project basics files.",
  },
};
const recipePath = (id) => `release/recipes/${id}.json`;

/** Builds every output member from the frozen default and the authored renderer. */
export function buildProjectBasics({ texts } = {}) {
  const frozenBytes = readFileSync(resolve(root, "release/release.json"));
  const frozen = readRelease(frozenBytes, { expectedSha256: FROZEN_DEFAULT_RELEASE_SHA256 });
  assert(frozen.valid, `Frozen default unreadable: ${JSON.stringify(frozen.diagnostics)}`);
  const context = frozen.release.items.find((item) => item.id === CONTEXT_ID);
  assert(context, `The frozen default carries no ${CONTEXT_ID}`);
  const frozenRecipe = JSON.parse(readFileSync(resolve(root, context.recipe.path), "utf8"));
  const outputs = new Map();
  const items16 = ITEMS.map((spec) => {
    const text = texts?.[spec.id] ?? spec.render();
    const problems = placeholderProblems(text);
    if (problems.length > 0)
      throw new Error(`${spec.id}: unknown placeholder ${problems.join(", ")}; the closed list is {projectDir}, {homeDir}, {itemDir} and {pluginRoot}`);
    const named = folderProblems(text);
    if (named.length > 0)
      throw new Error(`${spec.id}: names ${named.join(", ")}; Project basics text is folder-neutral`);
    const bytes = encoder.encode(text);
    assert(context.materials.some((member) => member.id === spec.material), `${spec.id}: no frozen ${spec.material} to split`);
    outputs.set(materialPath(spec.relPath), { bytes, mode: 0o644 });
    // The frozen recipe split by material, writing this item's bytes into the folder
    // the project names rather than a fixed one: one operation and its check per item.
    const target = {
      root: "project",
      segments: [{ input: "projectFolder" }, ...spec.relPath.split("/").map((literal) => ({ literal }))],
    };
    const frozenOperation = frozenRecipe.operations.find((entry) => entry.material === spec.material);
    const purpose = `Write the pinned ${spec.relPath} into the project folder`;
    const recipe = {
      ...frozenRecipe,
      id: spec.id,
      description: `Deliver the Project basics ${spec.name.toLowerCase()} into the project folder.`,
      inputs: FOLDER_INPUT,
      materials: [{ id: spec.material, sha256: sha256Hex(bytes), byteLength: bytes.byteLength }],
      operations: [{ ...frozenOperation, purpose, target }],
      checks: [{ id: `${spec.material}-sha256`, kind: "file.sha256", purpose: `The installed ${spec.relPath} has the pinned bytes`, sha256: sha256Hex(bytes), target }],
    };
    const recipeBytes = bytesOf(recipe);
    outputs.set(recipePath(spec.id), { bytes: recipeBytes });
    const content = {
      id: spec.material,
      relPath: spec.relPath,
      sourcePath: spec.relPath,
      packagePath: materialPath(spec.relPath),
      sha256: sha256Hex(bytes),
      byteLength: bytes.byteLength,
      executable: false,
      sourceId: SOURCE.id,
      role: "content",
    };
    const item = {
      id: spec.id,
      label: spec.name,
      description: spec.description,
      kind: spec.kind,
      name: spec.name,
      nameBasis: "publisher",
      descriptionBasis: "publisher",
      source: REPOSITORY,
      sourceIds: [SOURCE.id],
      targets: context.targets,
      scopes: context.scopes,
      inputs: FOLDER_INPUT,
      recipe: { id: spec.id, schema: frozenRecipe.schema, path: recipePath(spec.id), sha256: sha256Hex(recipeBytes), byteLength: recipeBytes.byteLength },
      dependencies: { requires: spec.requires.map((itemId) => ({ itemId })), optional: [], conflicts: [] },
      payload: spec.payload,
      requirements: { inputs: {} },
      executable: { [spec.relPath]: false },
      materials: [content, { id: "behaviour", relPath: "aih-behaviour.json", role: "behaviour", sha256: "" }],
    };
    const identity = computeBehaviourIdentity(item);
    item.materials[1] = {
      id: "behaviour",
      relPath: "aih-behaviour.json",
      sourcePath: null,
      packagePath: `release/items/${spec.id}/aih-behaviour.json`,
      sha256: sha256Hex(identity.behaviourBytes),
      byteLength: identity.behaviourBytes.byteLength,
      executable: false,
      sourceId: FRAMEWORK,
      role: "behaviour",
    };
    item.materials.sort((a, b) => (a.id < b.id ? -1 : 1));
    item.contentSha256 = identity.contentSha256;
    item.behaviourSha256 = computeBehaviourIdentity(item).behaviourSha256;
    return item;
  });
  // The items as one release 1.6 per-tool-neutral input; never shipped.
  const framework = {
    id: FRAMEWORK,
    name: "Project basics",
    version: "1.0.0",
    description: "Shared project guidance for AI tools: a router document, the working rules and a shared block placed as a marked block in entry files. Facts about a particular project are not part of this release.",
  };
  const package_ = { name: frozen.release.package.name, version: JSON.parse(readFileSync(resolve(root, "package.json"))).version };
  const input = { schema: "urn:aihq:catalog:release:1.6.0", package: package_, framework, sources: [SOURCE], items: items16 };
  const inputBytes = bytesOf(input);
  const input16 = readReleaseContent(inputBytes, { expectedSha256: sha256Hex(inputBytes) });
  assert(input16.valid, `Release 1.6 input refused: ${JSON.stringify(input16.diagnostics)}`);
  const compiled = compileTransitionRelease({
    releases: { [input16.release.sha256]: input16.release, [frozen.release.sha256]: frozen.release },
    earlier: [],
    framework,
    package: package_,
    items: ITEMS.map((spec) => ({
      id: spec.id,
      kind: spec.kind,
      role: "choosable",
      ...(spec.purpose ? { purpose: spec.purpose } : {}),
      placement: spec.placement,
      copies: [{ releaseSha256: input16.release.sha256, itemId: spec.id }],
      supersedes: [{ match: "split", releaseSha256: frozen.release.sha256, itemId: CONTEXT_ID, itemSha256: context.itemSha256 }],
    })),
    readMaterial: (packagePath) => outputs.get(packagePath)?.bytes ?? assert.fail(`No rendered member ${packagePath}`),
  });
  assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics));
  for (const file of compiled.value.materials) outputs.set(file.path, { bytes: file.bytes });
  outputs.set(CONTENT_PATH, { bytes: compiled.value.releaseBytes });
  const inventory = createContentInventory(compiled.value.releaseBytes, { expectedSha256: compiled.value.releaseSha256 });
  assert(inventory.valid, JSON.stringify(inventory.diagnostics));
  outputs.set(INVENTORY_PATH, { bytes: inventory.bytes });
  return { release: compiled.value.release, releaseSha256: compiled.value.releaseSha256, inventorySha256: inventory.sha256, outputs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const built = buildProjectBasics();
  const stale = [];
  for (const [path, { bytes, mode }] of built.outputs) {
    const target = resolve(root, path);
    if (check) {
      let current;
      try {
        current = readFileSync(target);
      } catch {
        stale.push(`${path} (missing)`);
        continue;
      }
      if (!Buffer.from(bytes).equals(current)) stale.push(path);
      // Rendered text is declared non-executable; the committed regular-file mode must agree.
      else if (mode !== undefined && (statSync(target).mode & 0o111) !== 0) stale.push(`${path} (mode)`);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      if (mode !== undefined) chmodSync(target, mode);
    }
  }
  if (stale.length > 0) {
    console.error(`Stale Project basics output; run node tools/generate-project-basics-release.mjs:\n  ${stale.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log(`${check ? "Checked" : "Generated"} Project basics release 1.7.0 content ${built.releaseSha256} (${built.release.items.length} items, ${built.outputs.size} members, inventory ${built.inventorySha256})`);
  }
}
