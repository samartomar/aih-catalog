// Executed by the maintainer CLI in the explicitly selected installed public runtime.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createContentInventory, readRelease } from "@aihq/catalog/reader";
import { prepareReleaseBaseline, readInstalledRelease } from "@aihq/catalog/node";
import { readArtifact, readContentCoverage } from "@aihq/scan/read";
import { authenticateEvidence } from "@aihq/core";

let input = ""; for await (const chunk of process.stdin) input += chunk;
const { plan, packageRoot, verifyOnly } = JSON.parse(input), started = performance.now();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => assert.deepEqual(a, b);
const exportsById = { default: "./release.json", extensions: "./release-extensions.json", ecc: "./release-ecc.json", superpowers: "./release-superpowers.json", anthropic: "./release-anthropic.json" };
const historical = ["./release-1.1.json", "./release-native-fixture.json", "./release-native-bundles.json", "./release-guide.json"];
const closed = (value, required, optional = []) => {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert(required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key)), "Unknown or missing plan field");
};
closed(plan, ["version", "trust", "views"]); assert.equal(plan.version, 1);
assert(Array.isArray(plan.views)); same(plan.views.map(view => view.id).sort(), Object.keys(exportsById).sort());
closed(plan.trust, ["path", "sha256"]);
const regular = (path, maximum) => {
  assert(isAbsolute(path), "Plan input paths must be absolute");
  const target = resolve(path); let parent = dirname(target);
  while (true) { const stat = lstatSync(parent); assert(stat.isDirectory() && !stat.isSymbolicLink(), "Linked input directory refused"); const next = dirname(parent); if (next === parent) break; parent = next; }
  const stat = lstatSync(target); assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= maximum, "Unsafe or oversized input");
  const bytes = readFileSync(target); assert(bytes.length <= maximum); return bytes;
};
const pinned = (entry, maximum) => { const bytes = regular(entry.path, maximum); assert.equal(sha(bytes), entry.sha256, "Pinned input digest differs"); if (entry.byteLength !== undefined) assert.equal(bytes.length, entry.byteLength); return bytes; };
const trustBytes = pinned(plan.trust, 1024 * 1024), trust = JSON.parse(trustBytes);
const software = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const manifest = JSON.parse(regular(join(software, "package.json"), 1024 * 1024));
assert.equal(manifest.name, "@aihq/catalog");
const releaseExports = Object.entries(manifest.exports).filter(([, target]) => typeof target === "string" && target.startsWith("./release/"));
same(releaseExports.map(([key]) => key).sort(), [...Object.values(exportsById), ...historical].sort());
const files = new Map(), folded = new Map(); let total = 0;
const add = (path, bytes, mode = 0o644) => {
  assert(typeof path === "string" && !path.includes("\\") && !path.startsWith("/") && path.split("/").every(part => part && part !== "." && part !== ".." && !part.includes(":")), "Unsafe package path");
  assert(!folded.has(path.toLowerCase()) || folded.get(path.toLowerCase()) === path, "Case-aliased package paths");
  folded.set(path.toLowerCase(), path);
  if (files.has(path)) { same(files.get(path).bytes, bytes); return; }
  total += bytes.length; assert(total <= 256 * 1024 * 1024 && files.size < 20000, "Package preparation bound exceeded");
  files.set(path, { bytes, mode });
};
const softwareMembers = [];
const walkSoftware = (directory, prefix = "") => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!prefix && ["release", "node_modules"].includes(entry.name)) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name, absolute = join(directory, entry.name), stat = lstatSync(absolute);
    assert(!stat.isSymbolicLink(), "Linked software member refused");
    if (stat.isDirectory()) walkSoftware(absolute, path);
    else { const bytes = regular(absolute, 32 * 1024 * 1024); add(path, bytes, stat.mode & 0o777); softwareMembers.push({ path, sha256: sha(bytes), byteLength: bytes.length }); }
  }
};
walkSoftware(software);
const member = (root, descriptor) => {
  const bytes = regular(join(root, descriptor.path), 16 * 1024 * 1024);
  assert.equal(bytes.length, descriptor.byteLength); assert.equal(sha(bytes), descriptor.sha256, `Material differs: ${descriptor.path}`);
  add(descriptor.path, bytes, lstatSync(join(root, descriptor.path)).mode & 0o777);
};
for (const exported of historical) {
  const checked = await readInstalledRelease({ root: software, release: exported }); assert(checked.valid, JSON.stringify(checked));
  const path = manifest.exports[exported].slice(2); add(path, regular(join(software, path), 16 * 1024 * 1024));
  for (const item of checked.release.items) for (const descriptor of [item.recipe, ...item.materials].filter(Boolean)) member(software, descriptor);
  if (checked.release.baseline) {
    const baseline = checked.release.baseline; member(software, baseline.inventory);
    if (baseline.artifact.location.kind === "package") member(software, { ...baseline.artifact, path: baseline.artifact.location.path });
  }
}
const views = [];
for (const view of plan.views) {
  const viewStarted = performance.now();
  closed(view, ["id", "content", "materialRoot", "inventory", "artifact", "scanId", "scope"], ["expectedReleaseSha256"]);
  closed(view.content, ["path", "sha256"]); closed(view.inventory, ["path", "sha256"]); closed(view.artifact, ["path", "sha256", "byteLength"]);
  closed(view.scope, ["namespace", "paths", "excludedPaths"]); assert.equal(view.scope.namespace, "package-relative");
  const contentBytes = pinned(view.content, 16 * 1024 * 1024), inventoryBytes = pinned(view.inventory, 16 * 1024 * 1024), artifactBytes = pinned(view.artifact, 16 * 1024 * 1024);
  const content = readRelease(contentBytes, { expectedSha256: view.content.sha256 }); assert(content.valid, JSON.stringify(content));
  assert.equal(content.release.package.name, manifest.name); assert.equal(content.release.package.version, manifest.version);
  const inventory = createContentInventory(contentBytes, { expectedSha256: view.content.sha256 }); assert(inventory.valid); assert.equal(sha(inventoryBytes), inventory.sha256, "Frozen inventory differs from content");
  const read = await readArtifact(artifactBytes); assert.equal(read.status, "read", "Assessment must be readable"); assert.equal(read.scanId, view.scanId, "Selected Scan ID differs");
  same(read.report.selection, { paths: view.scope.paths, excludedPaths: view.scope.excludedPaths });
  const baseline = { schema: "urn:aihq:catalog:scan-baseline:1.0.0", inventory: { path: `release/baselines/${view.id}/content-inventory.json`, sha256: inventory.sha256, byteLength: inventory.byteLength },
    scanId: view.scanId, artifact: { sha256: sha(artifactBytes), byteLength: artifactBytes.length, location: { kind: "package", path: `release/baselines/${view.id}/artifact.json` } }, scope: view.scope };
  const qualified = await prepareReleaseBaseline({ contentBytes, expectedSha256: view.content.sha256, baseline, trust },
    { readArtifact, readContentCoverage, authenticateEvidence, acquireArtifact: async () => artifactBytes });
  assert(qualified.valid, JSON.stringify(qualified));
  if (view.expectedReleaseSha256 !== undefined) assert.equal(qualified.release.sha256, view.expectedReleaseSha256, "Qualified reuse changed release identity");
  for (const item of qualified.release.items) for (const descriptor of [item.recipe, ...item.materials].filter(Boolean)) member(view.materialRoot, descriptor);
  add(baseline.inventory.path, inventoryBytes); add(baseline.artifact.location.path, artifactBytes);
  add(manifest.exports[exportsById[view.id]].slice(2), Buffer.from(qualified.releaseBytes));
  views.push({ id: view.id, export: exportsById[view.id], contentSha256: view.content.sha256, releaseSha256: qualified.release.sha256,
    baseline, authentication: qualified.authentication, itemCoverage: qualified.itemCoverage,
    assessment: { createdAt: read.report.createdAt, completion: read.report.completion, requestedDetectors: read.report.requestedDetectors, results: read.report.results },
    sources: qualified.release.sources, durationMs: Math.round(performance.now() - viewStarted) });
}
const expectedFiles = [...files].map(([path, value]) => ({ path, sha256: sha(value.bytes), byteLength: value.bytes.length })).sort((a, b) => a.path < b.path ? -1 : 1);
if (!verifyOnly) {
  mkdirSync(packageRoot);
  for (const [path, value] of files) { const target = join(packageRoot, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value.bytes, { flag: "wx", mode: value.mode }); }
} else {
  const present = [], expected = new Map(expectedFiles.map(file => [file.path, file])), directories = new Set();
  for (const file of expectedFiles) { const parts = file.path.split("/"); for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join("/")); }
  const walk = (directory, prefix = "") => { for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name, target = join(directory, entry.name), stat = lstatSync(target); assert(!stat.isSymbolicLink());
    if (entry.isDirectory()) { assert(directories.has(path), "Unexpected package directory"); walk(target, path); }
    else { const descriptor = expected.get(path); assert(descriptor && present.length < expectedFiles.length, "Unexpected package member"); assert.equal(stat.size, descriptor.byteLength, "Package member size changed"); const bytes = regular(target, descriptor.byteLength); present.push({ path, sha256: sha(bytes), byteLength: bytes.length }); }
  } };
  walk(packageRoot); same(present.sort((a, b) => a.path < b.path ? -1 : 1), expectedFiles);
}
for (const [exported] of releaseExports) { const checked = await readInstalledRelease({ root: packageRoot, release: exported }); assert(checked.valid, `${exported}: ${JSON.stringify(checked)}`); }
console.log(JSON.stringify({ kind: "catalog-full-package-qualification", package: { name: manifest.name, version: manifest.version },
  views, unchangedExports: historical, softwareSha256: sha(Buffer.from(JSON.stringify(softwareMembers.sort((a,b) => a.path < b.path ? -1 : 1)))),
  packageTreeSha256: sha(Buffer.from(JSON.stringify(expectedFiles))), fileCount: expectedFiles.length, trustSha256: plan.trust.sha256,
  durationMs: Math.round(performance.now() - started), verifiedExisting: Boolean(verifyOnly), publication: false }));
