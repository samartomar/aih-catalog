#!/usr/bin/env node
// The closing default release (samartomar/aih-catalog#146): release 1.7.0 content for
// the unnamed default with no items, whose retired[] gives each of the frozen default's
// 46 items a durable reason and its successors. Matt's 27 copies name their Extensions
// items, matched by name and source path; the 18 client adapters and entry pointers
// have no successor, and their reason names Core's per-tool delivery; the project
// context is split into the three Project basics items. The successors are read from
// the committed Extensions and Project basics content, never restated here, and every
// match is checked against the frozen default before it is written.
// The frozen default `release.json` is read by its recorded digest and never written.
// The baseline binding is a separate preparation step (docs/SCAN-BASELINE.md): this
// script freezes the content inventory and binds nothing.
// Run `npm run build:dist` first. No acquisition, execution or Scan.
//
//   node tools/generate-default-closing-release.mjs [--check]
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FROZEN_DEFAULT_RELEASE_SHA256, preparedReleaseContent } from "../dist/release/contracts.js";
import { compileTransitionRelease } from "../dist/release/producer.js";
import { createContentInventory, readRelease, readReleaseContent } from "../dist/release/reader.js";
import { sha256Hex } from "../dist/release/sha256.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FRAMEWORK = "default";
export const CONTENT_PATH = "release/release-default.content.json";
export const INVENTORY_PATH = "release/baselines/default/content-inventory.json";
const CONTEXT_ID = "aihq.project-context";
/** The frozen kinds that are per-tool delivery: they retire with no Catalog successor. */
const PER_TOOL_KINDS = new Set(["client-adapter", "client-entry-pointer"]);
export const EXPECTED_COUNTS = Object.freeze({ matt: 27, perTool: 18, split: 1, total: 46 });

const readPrepared = (frameworkId) => {
  const entry = preparedReleaseContent.find((candidate) => candidate.frameworkId === frameworkId);
  assert(entry, `preparedReleaseContent lists no ${frameworkId}`);
  const bytes = readFileSync(resolve(root, entry.content));
  const read = readReleaseContent(bytes, { expectedSha256: sha256Hex(bytes) });
  assert(read.valid, `${entry.content} unreadable: ${JSON.stringify(read.diagnostics)}`);
  return read.release;
};

/** The survivors in `release` that supersede the frozen item `id` by `match`, sorted by id. */
const supersessionsOf = (release, id, match) =>
  release.items
    .flatMap((item) =>
      (item.supersedes ?? [])
        .filter((entry) => entry.releaseSha256 === FROZEN_DEFAULT_RELEASE_SHA256 && entry.itemId === id)
        .map((entry) => ({ item, entry })),
    )
    .filter(({ entry }) => entry.match === match)
    .sort((a, b) => (a.item.id < b.item.id ? -1 : 1));

/** One retirement per frozen item, each successor checked against the frozen default. */
export function closingRetirements({ frozen, extensions, projectBasics }) {
  const counts = { matt: 0, perTool: 0, split: 0 };
  const retired = frozen.items.map((old) => {
    if (old.kind === "skill") {
      // A Matt copy: exactly one Extensions survivor whose name and source path are this
      // copy's, superseding it by name and source path.
      const sourcePath = old.metadata?.upstream?.path;
      assert(typeof sourcePath === "string" && sourcePath.endsWith("/SKILL.md"), `${old.id}: no upstream SKILL.md path`);
      const name = sourcePath.split("/").at(-2);
      const found = supersessionsOf(extensions, old.id, "name+sourcePath");
      assert.equal(found.length, 1, `${old.id}: expected one Extensions successor by name and source path`);
      const [{ item, entry }] = found;
      assert.equal(entry.itemSha256, old.itemSha256, `${old.id}: the successor names another record`);
      assert.equal(entry.name, name, `${old.id}: the successor's supersession names ${entry.name}`);
      assert.equal(entry.sourcePath, sourcePath, `${old.id}: the successor's supersession names ${entry.sourcePath}`);
      assert.equal(item.name, name, `${old.id}: the successor is named ${item.name}`);
      assert(item.materials.some((member) => member.sourcePath === sourcePath), `${old.id}: the successor carries no ${sourcePath}`);
      counts.matt++;
      return {
        id: old.id,
        reason: `Matt Pocock's ${name} skill ships once, through AIH-Extensions: it is replaced by its Extensions item, matched by name and source path ${sourcePath}.`,
        replacedBy: [{ framework: extensions.framework.id, itemId: item.id }],
      };
    }
    if (PER_TOOL_KINDS.has(old.kind)) {
      // Per-tool delivery: no item in any release replaces it.
      for (const release of [extensions, projectBasics])
        assert(
          !release.items.some((item) => (item.supersedes ?? []).some((entry) => entry.itemId === old.id)),
          `${old.id}: per-tool delivery has no Catalog successor, but ${release.framework.id} supersedes it`,
        );
      counts.perTool++;
      const what = old.kind === "client-adapter" ? "client adapter" : "entry pointer";
      return {
        id: old.id,
        reason: `${old.label} was a per-tool ${what}. Per-tool delivery, where each kind of content goes in each tool and how it is converted, is now Core's, through its tool definitions; this item has no successor in Catalog.`,
        replacedBy: [],
      };
    }
    assert.equal(old.id, CONTEXT_ID, `${old.id}: a ${old.kind} with no closing disposition`);
    const split = supersessionsOf(projectBasics, old.id, "split");
    assert.equal(split.length, 3, `${old.id}: expected three Project basics items to split it`);
    for (const { entry } of split) assert.equal(entry.itemSha256, old.itemSha256, `${old.id}: a split names another record`);
    counts.split++;
    return {
      id: old.id,
      reason: `The shared project context is split into the three Project basics items: ${split.map(({ item }) => item.name.toLowerCase()).join(", ")}. Facts about a particular project and placing the shared block in each tool's entry files are Core's.`,
      replacedBy: split.map(({ item }) => ({ framework: projectBasics.framework.id, itemId: item.id })),
    };
  });
  assert.deepEqual({ ...counts, total: retired.length }, EXPECTED_COUNTS, "The closing default must give all 46 frozen items a disposition");
  return retired;
}

/** Builds the closing default content and its frozen content inventory. */
export function buildDefaultClosing() {
  const frozenBytes = readFileSync(resolve(root, "release/release.json"));
  const frozen = readRelease(frozenBytes, { expectedSha256: FROZEN_DEFAULT_RELEASE_SHA256 });
  assert(frozen.valid, `Frozen default unreadable: ${JSON.stringify(frozen.diagnostics)}`);
  const retired = closingRetirements({
    frozen: frozen.release,
    extensions: readPrepared("extensions"),
    projectBasics: readPrepared("project-basics"),
  });
  const compiled = compileTransitionRelease({
    releases: { [frozen.release.sha256]: frozen.release },
    // Every frozen item must be accounted for; the transition check fails a dropped one.
    earlier: [frozen.release.sha256],
    framework: {
      id: FRAMEWORK,
      name: "Default",
      version: "1.0.0",
      description: "The closing release of the unnamed default content. It carries no items; its retired list says what happened to each item of the frozen default release and names any successor.",
    },
    package: {
      name: frozen.release.package.name,
      version: JSON.parse(readFileSync(resolve(root, "package.json"))).version,
    },
    items: [],
    retired,
  });
  assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics));
  assert.equal(compiled.value.materials.length, 0);
  const inventory = createContentInventory(compiled.value.releaseBytes, { expectedSha256: compiled.value.releaseSha256 });
  assert(inventory.valid, JSON.stringify(inventory.diagnostics));
  const outputs = new Map([
    [CONTENT_PATH, compiled.value.releaseBytes],
    [INVENTORY_PATH, inventory.bytes],
  ]);
  return { release: compiled.value.release, releaseSha256: compiled.value.releaseSha256, inventorySha256: inventory.sha256, outputs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  assert(process.argv.length === (check ? 3 : 2), "Usage: node tools/generate-default-closing-release.mjs [--check]");
  const built = buildDefaultClosing();
  const stale = [];
  for (const [path, bytes] of built.outputs) {
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
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
  }
  if (stale.length > 0) {
    console.error(`Stale closing default output; run node tools/generate-default-closing-release.mjs:\n  ${stale.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log(`${check ? "Checked" : "Generated"} ${CONTENT_PATH} ${built.releaseSha256} (${built.release.items.length} items, ${built.release.retired?.length ?? 0} retired, inventory ${built.inventorySha256})`);
  }
}
