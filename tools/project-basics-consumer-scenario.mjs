// Copied into an outside consumer; only public package interfaces are imported.
// Project basics: the prepared release 1.7.0 content of its three items, their
// captured materials and behaviour files, the split of the frozen default's project
// context, the frozen content inventory, evidence descriptors, the restructuring
// comparison and the golden fixture. No Core, no execution, no Scan.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  contractSupport11,
  FROZEN_DEFAULT_RELEASE_SHA256,
  preparedReleaseContent,
  releaseInventory,
} from "@aihq/catalog/contracts";
import { compareRestructuring } from "@aihq/catalog/producer";
import {
  createContentInventory,
  itemEvidenceDescriptor,
  readRelease,
  readReleaseContent,
} from "@aihq/catalog/reader";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const exported = (name) => readFileSync(fileURLToPath(import.meta.resolve(`@aihq/catalog/${name}`)));
const json = (name) => JSON.parse(exported(name).toString("utf8"));
const member = (path) => readFileSync(join(root, path));
const results = [];
const case_ = async (name, fn) => {
  try {
    await fn();
    results.push({ name, status: "pass" });
  } catch (error) {
    results.push({ name, status: "fail", error: String(error?.stack ?? error) });
  }
};

const CONTENT = "release-project-basics.content.json";
const INVENTORY = "release/baselines/project-basics/content-inventory.json";
const contentBytes = exported(CONTENT);
const read = readReleaseContent(contentBytes, { expectedSha256: sha256(contentBytes) });
assert.equal(read.valid, true, JSON.stringify(read.diagnostics));
const release = read.release;
const frozenBytes = exported("release.json");
const frozen = readRelease(frozenBytes, { expectedSha256: sha256(frozenBytes) });
assert.equal(frozen.valid, true, JSON.stringify(frozen.diagnostics));
const context = frozen.release.items.find((item) => item.id === "aihq.project-context");
const frozenMember = (id) => context.materials.find((entry) => entry.id === id);
// Item, kind, payload and the frozen material it captures, from the ticket's acceptance.
const EXPECTED = [
  { id: "project-basics.router", kind: "document", purpose: "guide", placement: "project-folder", material: "rule-router",
    requires: ["project-basics.working-rules"] },
  { id: "project-basics.shared-block", kind: "rule", placement: "entry-block", material: "shared-block",
    requires: ["project-basics.router", "project-basics.working-rules"] },
  { id: "project-basics.working-rules", kind: "rule", placement: "project-folder", material: "behavior-core", requires: [] },
];
const item = (id) => release.items.find((entry) => entry.id === id);

await case_("a separate release 1.7.0 with a published framework identity", () => {
  assert.equal(release.schema, "urn:aihq:catalog:release:1.7.0");
  assert.equal(release.framework.id, "project-basics");
  assert.equal(release.framework.name, "Project basics");
  assert.match(release.framework.version, /^\d+\.\d+\.\d+$/);
  assert.ok(release.framework.description.length > 0);
  assert.deepEqual(Object.keys(release.framework).sort(), ["description", "id", "name", "version"]);
  assert.equal(release.package.name, "@aihq/catalog");
});

await case_("exactly three items: a guide router and two rules with their placements", () => {
  assert.deepEqual(release.items.map((entry) => entry.id), EXPECTED.map((entry) => entry.id));
  for (const want of EXPECTED) {
    const got = item(want.id);
    assert.equal(got.kind, want.kind, want.id);
    assert.equal(got.payload.placement, want.placement, want.id);
    assert.equal(got.payload.purpose, want.purpose, want.id);
    // The texts route to each other: same-release requirements, never a cross-release pin.
    assert.deepEqual(got.dependencies.requires.map((ref) => ref.itemId), want.requires, want.id);
  }
});

await case_("pointer and context text are captured content materials with exact bytes", () => {
  for (const want of EXPECTED) {
    const got = item(want.id);
    const content = got.materials.filter((entry) => entry.role === "content");
    assert.equal(content.length, 1, want.id);
    const [material] = content;
    const bytes = member(material.packagePath);
    assert.equal(sha256(bytes), material.sha256, want.id);
    assert.equal(bytes.byteLength, material.byteLength, want.id);
    assert.equal(material.executable, false, want.id);
    assert.equal(got.executable[material.relPath], false, want.id);
    // The accepted text: byte-identical to the frozen default's project context.
    assert.equal(material.sha256, frozenMember(want.material).sha256, want.id);
    assert.equal(
      got.contentSha256,
      sha256(Buffer.from(`${material.relPath}\t${material.sha256}\n`)),
      want.id,
    );
    const behaviour = got.materials.find((entry) => entry.role === "behaviour");
    assert.equal(behaviour.relPath, "aih-behaviour.json");
    assert.equal(sha256(member(behaviour.packagePath)), behaviour.sha256, want.id);
    const declared = JSON.parse(member(behaviour.packagePath).toString("utf8"));
    assert.deepEqual(declared.payload, got.payload, want.id);
    assert.equal(declared.kind, got.kind, want.id);
  }
});

await case_("the release carries no per-project facts, inputs or unknown placeholders", () => {
  for (const want of EXPECTED) {
    const got = item(want.id);
    // The release 1.x recipe is the frozen context recipe split by material: it
    // delivers this item's own bytes only, with no inputs and no tool map.
    assert.equal(got.recipes, undefined, want.id);
    const recipe = JSON.parse(member(got.recipe.path).toString("utf8"));
    assert.equal(sha256(member(got.recipe.path)), got.recipe.sha256, want.id);
    assert.deepEqual(recipe.inputs, {}, want.id);
    assert.deepEqual(recipe.operations.map((operation) => operation.material), [want.material], want.id);
    assert.deepEqual(got.inputs, {}, want.id);
    assert.deepEqual(got.requirements, { inputs: {} }, want.id);
    for (const material of got.materials.filter((entry) => entry.role === "content")) {
      for (const match of member(material.packagePath).toString("utf8").matchAll(/\{[^{}]*\}/g))
        assert.match(match[0], /^\{(projectDir|homeDir|itemDir|pluginRoot)\}$/, want.id);
    }
  }
});

await case_("the frozen default's project context is split over the three items", () => {
  for (const want of EXPECTED) {
    const split = (item(want.id).supersedes ?? []).filter((entry) => entry.itemId === "aihq.project-context");
    assert.equal(split.length, 1, want.id);
    assert.equal(split[0].match, "split");
    assert.equal(split[0].releaseSha256, FROZEN_DEFAULT_RELEASE_SHA256);
    assert.equal(split[0].itemSha256, context.itemSha256);
  }
});

await case_("the shipped content inventory is the frozen inventory of this content", () => {
  const inventory = createContentInventory(contentBytes, { expectedSha256: sha256(contentBytes) });
  assert.equal(inventory.valid, true, JSON.stringify(inventory.diagnostics));
  assert.equal(inventory.inventory.schema, "urn:aihq:catalog:content-inventory:1.2.0");
  assert.deepEqual(Buffer.from(inventory.bytes), exported(INVENTORY));
});

await case_("every item maps to a Scan item descriptor over its package members", () => {
  for (const want of EXPECTED) {
    const descriptor = itemEvidenceDescriptor(release, { itemId: want.id });
    assert.equal(descriptor.valid, true, JSON.stringify(descriptor.diagnostics));
    const got = item(want.id);
    assert.equal(descriptor.descriptor.frameworkId, "project-basics");
    assert.equal(descriptor.descriptor.contentSha256, got.contentSha256);
    assert.equal(descriptor.descriptor.behaviourSha256, got.behaviourSha256);
    assert.deepEqual(
      descriptor.descriptor.materials.map((entry) => [entry.path, entry.role]).sort(),
      got.materials.map((entry) => [entry.packagePath, entry.role]).sort(),
    );
  }
});

await case_("the restructuring comparison passes, including the split", () => {
  const result = compareRestructuring({ release, expectation: json("restructuring/expected-1.7.0.json") });
  assert.equal(result.status, "pass", JSON.stringify(result.rows.filter((row) => row.status === "fail")));
  assert.deepEqual(result.counts.item, { pass: 3, fail: 0 });
  assert.deepEqual(result.counts.hash, { pass: 3, fail: 0 });
  assert.deepEqual(result.counts.supersession, { pass: 3, fail: 0 });
});

await case_("a golden release fixture is exported, listed and read", () => {
  const exportName = "@aihq/catalog/fixtures/release-1-7/project-basics-release-1.7.0.json";
  const contract = contractSupport11.contracts.find((entry) => entry.id === "urn:aihq:catalog:release:1.7.0");
  assert.ok(contract.fixtures.some((entry) => entry.export === exportName && entry.expect === "accept"));
  assert.ok(json("fixtures/manifest.json").fixtures.some((entry) => entry.export === exportName));
  const bytes = exported("fixtures/release-1-7/project-basics-release-1.7.0.json");
  const fixture = readRelease(bytes, { expectedSha256: sha256(bytes) });
  assert.equal(fixture.valid, true, JSON.stringify(fixture.diagnostics));
  const { baseline, ...rest } = JSON.parse(bytes.toString("utf8"));
  assert.ok(baseline);
  assert.deepEqual(rest, JSON.parse(contentBytes.toString("utf8")));
});

await case_("the content is not yet a qualified release: no baseline is bound or listed", () => {
  const unbound = readRelease(contentBytes, { expectedSha256: sha256(contentBytes) });
  assert.equal(unbound.valid, false);
  assert.ok(unbound.diagnostics.some((entry) => entry.reason === "baseline-invalid"));
  assert.ok(!releaseInventory.releases.some((entry) => entry.release.includes("project-basics")));
  const [prepared] = preparedReleaseContent.filter((entry) => entry.frameworkId === "project-basics");
  assert.equal(prepared.export, `@aihq/catalog/${CONTENT}`);
  assert.equal(prepared.inventory, INVENTORY);
  assert.equal(prepared.schema, release.schema);
});

process.stdout.write(JSON.stringify({ results }));
