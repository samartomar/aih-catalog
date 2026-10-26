// Copied into an outside consumer; only public package interfaces are imported.
// The closing default release: release 1.7.0 content with no items whose retired[]
// gives each of the frozen default's 46 items a reason and its successors, read from
// the same installed package that still exports the frozen default under its original
// path and bytes. No Core, no execution, no Scan.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FROZEN_DEFAULT_RELEASE_SHA256,
  preparedReleaseContent,
  releaseInventory,
} from "@aihq/catalog/contracts";
import { readInstalledPreparedContent, readInstalledRelease } from "@aihq/catalog/node";
import { checkReleaseTransition, compareRestructuring } from "@aihq/catalog/producer";
import { createContentInventory, readRelease, readReleaseContent } from "@aihq/catalog/reader";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const exported = (name) => readFileSync(fileURLToPath(import.meta.resolve(`@aihq/catalog/${name}`)));
const json = (name) => JSON.parse(exported(name).toString("utf8"));
const results = [];
const case_ = async (name, fn) => {
  try {
    await fn();
    results.push({ name, status: "pass" });
  } catch (error) {
    results.push({ name, status: "fail", error: String(error?.stack ?? error) });
  }
};

const CONTENT = "release-default.content.json";
const INVENTORY = "release/baselines/default/content-inventory.json";
const contentBytes = exported(CONTENT);
const read = readReleaseContent(contentBytes, { expectedSha256: sha256(contentBytes) });
assert.equal(read.valid, true, JSON.stringify(read.diagnostics));
const closing = read.release;
const frozenBytes = exported("release.json");
const frozen = readRelease(frozenBytes, { expectedSha256: FROZEN_DEFAULT_RELEASE_SHA256 });
assert.equal(frozen.valid, true, JSON.stringify(frozen.diagnostics));
const content = (name) => {
  const bytes = exported(name);
  const result = readReleaseContent(bytes, { expectedSha256: sha256(bytes) });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  return result.release;
};
const extensions = content("release-extensions.content.json");
const projectBasics = content("release-project-basics.content.json");
const retired = new Map((closing.retired ?? []).map((entry) => [entry.id, entry]));
const frozenOfKind = (...kinds) => frozen.release.items.filter((item) => kinds.includes(item.kind));

await case_("the frozen default stays exported under its original path and bytes, admitted by its historical digest", async () => {
  assert.equal(sha256(frozenBytes), FROZEN_DEFAULT_RELEASE_SHA256);
  assert.equal(frozen.release.schema, "urn:aihq:catalog:release:1.4.0");
  assert.equal(frozen.release.items.length, 46);
  const entry = releaseInventory.releases.find((release) => release.release === "./release.json");
  assert.equal(entry.export, "@aihq/catalog/release.json");
  assert.equal(entry.historical, true);
  assert.equal(entry.sha256, FROZEN_DEFAULT_RELEASE_SHA256);
  assert.equal(releaseInventory.defaultRelease, "./release.json");
  // Read through the Node adapter from the very package that carries the closing release.
  const installed = await readInstalledRelease({ root, release: "./release.json" });
  assert.equal(installed.valid, true, JSON.stringify(installed.diagnostics));
  assert.equal(installed.provenance.manifestPath, "release/release.json");
  assert.equal(installed.provenance.manifestSha256, FROZEN_DEFAULT_RELEASE_SHA256);
  assert.deepEqual(installed.release.items.map((item) => item.id), frozen.release.items.map((item) => item.id));
});

await case_("a closing default release 1.7.0 with no items", () => {
  assert.equal(closing.schema, "urn:aihq:catalog:release:1.7.0");
  assert.equal(closing.framework.id, "default");
  assert.ok(closing.framework.name.length > 0 && closing.framework.description.length > 0);
  assert.equal(closing.package.name, "@aihq/catalog");
  assert.deepEqual(closing.items, []);
  assert.deepEqual(closing.sources, []);
  assert.equal(closing.sets, undefined);
});

await case_("exactly 46 retirements, one per frozen item, each with a reason", () => {
  assert.equal(closing.retired.length, 46);
  assert.deepEqual([...retired.keys()].sort(), frozen.release.items.map((item) => item.id).sort());
  for (const entry of closing.retired) assert.ok(entry.reason.trim().length > 0, entry.id);
});

await case_("the 27 Matt copies name their Extensions replacements, matched by name and source path", () => {
  const copies = frozenOfKind("skill");
  assert.equal(copies.length, 27);
  for (const copy of copies) {
    const sourcePath = copy.metadata.upstream.path;
    const name = sourcePath.split("/").at(-2);
    const entry = retired.get(copy.id);
    assert.equal(entry.replacedBy.length, 1, copy.id);
    const [ref] = entry.replacedBy;
    assert.equal(ref.framework, "extensions", copy.id);
    // The successor ships in this same package and supersedes this copy by name and source path.
    const survivor = extensions.items.find((item) => item.id === ref.itemId);
    assert.ok(survivor, `${copy.id}: ${ref.itemId} is not in the Extensions content`);
    assert.equal(survivor.name, name, copy.id);
    assert.ok(survivor.materials.some((member) => member.sourcePath === sourcePath), copy.id);
    const supersession = survivor.supersedes.find((s) => s.itemId === copy.id);
    assert.equal(supersession.match, "name+sourcePath", copy.id);
    assert.equal(supersession.releaseSha256, FROZEN_DEFAULT_RELEASE_SHA256, copy.id);
    assert.equal(supersession.itemSha256, copy.itemSha256, copy.id);
    assert.equal(supersession.sourcePath, sourcePath, copy.id);
    assert.match(entry.reason, /AIH-Extensions/, copy.id);
    assert.ok(entry.reason.includes(sourcePath), copy.id);
  }
});

await case_("the 18 adapters and pointers have no successor and each reason names Core's per-tool delivery", () => {
  const perTool = frozenOfKind("client-adapter", "client-entry-pointer");
  assert.equal(perTool.length, 18);
  for (const old of perTool) {
    const entry = retired.get(old.id);
    assert.deepEqual(entry.replacedBy, [], old.id);
    assert.match(entry.reason, /Per-tool delivery/, old.id);
    assert.match(entry.reason, /Core's/, old.id);
    assert.ok(entry.reason.startsWith(old.label), old.id);
  }
});

await case_("the project context names the three Project basics items, which supersede it by split", () => {
  const [context] = frozenOfKind("project-context");
  assert.equal(context.id, "aihq.project-context");
  const entry = retired.get(context.id);
  const want = ["project-basics.router", "project-basics.shared-block", "project-basics.working-rules"];
  assert.deepEqual(entry.replacedBy, want.map((itemId) => ({ framework: "project-basics", itemId })));
  for (const itemId of want) {
    const survivor = projectBasics.items.find((item) => item.id === itemId);
    const split = survivor.supersedes.find((s) => s.itemId === context.id);
    assert.equal(split.match, "split", itemId);
    assert.equal(split.releaseSha256, FROZEN_DEFAULT_RELEASE_SHA256, itemId);
    assert.equal(split.itemSha256, context.itemSha256, itemId);
  }
});

await case_("the transition check accounts for every frozen item", () => {
  const checked = checkReleaseTransition({
    releases: { [frozen.release.sha256]: frozen.release },
    earlier: [frozen.release.sha256],
    release: closing,
  });
  assert.equal(checked.status, "ok", JSON.stringify(checked.diagnostics));
  assert.equal(checked.value.accounted, 46);
});

await case_("the scripted comparison against the amended expected projection passes", () => {
  const result = compareRestructuring({ release: closing, expectation: json("restructuring/expected-1.7.0.json") });
  assert.equal(result.status, "pass", JSON.stringify(result.rows.filter((row) => row.status === "fail")));
  assert.deepEqual(result.counts.framework, { pass: 1, fail: 0 });
  assert.deepEqual(result.counts.retired, { pass: 46, fail: 0 });
  assert.deepEqual(result.counts["unexpected-item"], { pass: 0, fail: 0 });
});

await case_("the shipped content inventory is the frozen inventory of this content", () => {
  const inventory = createContentInventory(contentBytes, { expectedSha256: sha256(contentBytes) });
  assert.equal(inventory.valid, true, JSON.stringify(inventory.diagnostics));
  assert.deepEqual(Buffer.from(inventory.bytes), exported(INVENTORY));
});

await case_("the closing content is prepared, unbound and unauthenticated, and has no release entry", async () => {
  const unbound = readRelease(contentBytes, { expectedSha256: sha256(contentBytes) });
  assert.equal(unbound.valid, false);
  assert.ok(unbound.diagnostics.some((entry) => entry.reason === "baseline-invalid"));
  assert.ok(!releaseInventory.releases.some((entry) => entry.release.includes("default")));
  const [listed] = preparedReleaseContent.filter((entry) => entry.frameworkId === "default");
  assert.equal(listed.export, `@aihq/catalog/${CONTENT}`);
  assert.equal(listed.inventory, INVENTORY);
  assert.equal(listed.schema, closing.schema);
  const installed = await readInstalledPreparedContent({ root, frameworkId: "default" });
  assert.equal(installed.valid, true, JSON.stringify(installed.diagnostics));
  assert.deepEqual(installed.status, { kind: "prepared-content", baseline: "unbound", authenticated: false, productionRelease: false });
  assert.equal(installed.release.baseline, undefined);
  assert.equal(installed.provenance.contentSha256, sha256(contentBytes));
  assert.equal(installed.release.retired.length, 46);
});

process.stdout.write(JSON.stringify({ results }));
