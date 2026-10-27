// Resolve the final installed candidate's own ordinary public entries.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as catalogContracts from "@aihq/catalog/contracts";
import { createContentInventory, readReleaseContent } from "@aihq/catalog/reader";
import { readInstalledRelease, acquireBaselineArtifact } from "@aihq/catalog/node";
let input = ""; for await (const chunk of process.stdin) input += chunk;
const expected = JSON.parse(input), root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const manifest = JSON.parse(readFileSync(join(root, "package.json")));
for (const view of expected.views) {
  const checked = await readInstalledRelease({ root, release: view.export }); assert(checked.valid, JSON.stringify(checked));
  assert.equal(checked.release.sha256, view.releaseSha256); assert.deepEqual(checked.release.baseline, view.baseline);
  const bytes = readFileSync(join(root, manifest.exports[view.export]));
  const inventory = createContentInventory(bytes, { expectedSha256: view.releaseSha256 }); assert(inventory.valid);
  assert.deepEqual(Buffer.from(inventory.bytes), readFileSync(join(root, view.baseline.inventory.path)));
  const artifact = await acquireBaselineArtifact(view.baseline.artifact, { packageRoot: root });
  assert.equal(createHash("sha256").update(artifact).digest("hex"), view.baseline.artifact.sha256);
}
for (const exported of expected.unchangedExports) assert((await readInstalledRelease({ root, release: exported })).valid);
// Frozen releases keep their recorded bytes and are admitted by that digest.
const frozenExports = catalogContracts.releaseInventory.releases.filter(entry => entry.historical === true).map(entry => ({ export: entry.release, sha256: entry.sha256 }));
assert.deepEqual(frozenExports, expected.frozenExports);
for (const entry of frozenExports) {
  assert(expected.unchangedExports.includes(entry.export) && !expected.views.some(view => view.export === entry.export), `Frozen release must be carried unchanged: ${entry.export}`);
  const checked = await readInstalledRelease({ root, release: entry.export }); assert(checked.valid, JSON.stringify(checked));
  assert.equal(createHash("sha256").update(readFileSync(join(root, manifest.exports[entry.export]))).digest("hex"), entry.sha256);
  assert.equal(checked.provenance.manifestSha256, entry.sha256);
}
// Prepared content awaiting its baseline: carried, read by the content reader, inventory exact.
const preparedContent = [];
for (const entry of catalogContracts.preparedReleaseContent ?? []) {
  const bytes = readFileSync(join(root, entry.content)), sha256 = createHash("sha256").update(bytes).digest("hex");
  const content = readReleaseContent(bytes, { expectedSha256: sha256 }); assert(content.valid, JSON.stringify(content));
  const inventory = createContentInventory(bytes, { expectedSha256: sha256 }); assert(inventory.valid);
  assert.deepEqual(Buffer.from(inventory.bytes), readFileSync(join(root, entry.inventory)));
  preparedContent.push({ frameworkId: entry.frameworkId, sha256, inventorySha256: inventory.sha256 });
}
// Count the installed package's own declared releases; every one is qualified or carried.
const declared = catalogContracts.releaseInventory.releases.map(entry => entry.release).sort();
assert.deepEqual([...expected.views.map(view => view.export), ...expected.unchangedExports].sort(), declared);
console.log(JSON.stringify({ releaseExports: declared.length, qualifiedViews: expected.views.length, frozenExports, preparedContent, inventoryAndArtifactBytes: "exact", ownInstalledPublicReader: true }));
