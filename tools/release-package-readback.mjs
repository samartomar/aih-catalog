// Resolve the final installed candidate's own ordinary public entries.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContentInventory } from "@aihq/catalog/reader";
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
console.log(JSON.stringify({ releaseExports: expected.views.length + expected.unchangedExports.length, qualifiedViews: expected.views.length, inventoryAndArtifactBytes: "exact", ownInstalledPublicReader: true }));
