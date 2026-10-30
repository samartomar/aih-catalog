// Executed by the maintainer CLI in the explicitly selected installed public runtime.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as catalogContracts from "@aihq/catalog/contracts";
import { createContentInventory, readRelease, readReleaseContent } from "@aihq/catalog/reader";
import { prepareReleaseBaseline, readInstalledRelease } from "@aihq/catalog/node";
import { readArtifact, readContentCoverage, readContentCoverageBatch } from "@aihq/scan/read";
import { authenticateEvidence } from "@aihq/core";

let input = ""; for await (const chunk of process.stdin) input += chunk;
const { plan, packageRoot, verifyOnly } = JSON.parse(input), started = performance.now();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => assert.deepEqual(a, b);
// Every declared release is classified here; an unclassified release refuses assembly.
// Qualified: an ordinary release whose baseline slot release/baselines/<id>/ is free, unless
// the accepted assembly contract names it unchanged. New release preparation requires a baseline.
// The authored executable-content companion is an ordinary release, with no prepared
// baseline slot. Its assessment qualifies the delivered bytes, never native readiness.
const exportsById = { anthropic: "./release-anthropic.json", "web-artifacts": "./release-web-artifacts.json",
  "executable-content": "./release-executable-content.json" };
// Carried byte for byte, never requalified: the frozen default, admitted by its recorded
// digest; earlier releases whose prepared release content holds their baseline slot; and
// the four documents the accepted assembly contract keeps unchanged.
const carried = ["./release.json", "./release-extensions.json", "./release-ecc.json", "./release-superpowers.json",
  "./release-1.1.json", "./release-native-fixture.json", "./release-native-bundles.json", "./release-guide.json"];
// Prepared content awaiting its baseline is carried unchanged; it is not a qualified view.
const prepared = catalogContracts.preparedReleaseContent ?? [];
const closed = (value, required, optional = []) => {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert(required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key)), "Unknown or missing plan field");
};
closed(plan, ["version", "trust", "views"]); assert.equal(plan.version, 1); assert(Array.isArray(plan.views));
assert(!plan.views.some(view => view?.id === "default"), "The frozen default is historical; it is carried byte for byte and cannot be qualified as a view");
for (const view of plan.views) {
  const waiting = prepared.find(entry => entry.frameworkId === view?.id);
  assert(!waiting, `Framework ${view?.id} has prepared release content awaiting its baseline at ${waiting?.inventory}; its earlier release is carried unchanged and cannot be qualified as a view`);
}
assert(!prepared.some(entry => Object.hasOwn(exportsById, entry.frameworkId)), "A qualified view's baseline slot is held by prepared release content");
same(plan.views.map(view => view.id).sort(), Object.keys(exportsById).sort());
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
const preparedTargets = new Set(prepared.flatMap(entry => [`./${entry.content}`, `./${entry.inventory}`]));
const releaseExports = Object.entries(manifest.exports).filter(([, target]) => typeof target === "string" && target.startsWith("./release/") && !preparedTargets.has(target));
// Every exported release is declared in the package's own release inventory; the
// qualified views are ordinary entries and every other entry is carried unchanged.
const declared = catalogContracts.releaseInventory.releases;
same(releaseExports.map(([key]) => key).sort(), declared.map(entry => entry.release).sort());
const classified = new Set([...Object.values(exportsById), ...carried]);
for (const entry of declared) assert(classified.has(entry.release), `Unclassified release export: ${entry.release}; classify it as a qualified view or a carried release before assembly`);
for (const exported of classified) assert(declared.some(entry => entry.release === exported), `Classified release is not declared: ${exported}`);
for (const exported of Object.values(exportsById)) assert(declared.some(entry => entry.release === exported && entry.historical !== true), `Qualified view must be an ordinary release: ${exported}`);
const historical = [...carried].sort();
const frozenReleases = declared.filter(entry => entry.historical === true);
assert(frozenReleases.length > 0 && frozenReleases.every(entry => carried.includes(entry.release) && /^[0-9a-f]{64}$/.test(entry.sha256)), "Frozen releases must be carried with recorded digests");
const files = new Map(), folded = new Map(); let total = 0;
const add = (path, bytes, mode = 0o644) => {
  assert(typeof path === "string" && !path.includes("\\") && !path.startsWith("/") && path.split("/").every(part => part && part !== "." && part !== ".." && !part.includes(":")), "Unsafe package path");
  assert(!folded.has(path.toLowerCase()) || folded.get(path.toLowerCase()) === path, "Case-aliased package paths");
  folded.set(path.toLowerCase(), path);
  // Bounded refusal: an assertion diff over large conflicting buffers is unbounded.
  if (files.has(path)) { assert(files.get(path).bytes.equals(bytes), `Conflicting package member bytes: ${path}`); return; }
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
// An item's members as the integrity check counts them: each transition recipe map entry
// (or its single recipe) and every material.
const itemMembers = item => [...(item.recipes ? Object.values(item.recipes) : [item.recipe]), ...item.materials].filter(Boolean);
const member = (root, descriptor) => {
  const bytes = regular(join(root, descriptor.path), 16 * 1024 * 1024);
  assert.equal(bytes.length, descriptor.byteLength); assert.equal(sha(bytes), descriptor.sha256, `Material differs: ${descriptor.path}`);
  add(descriptor.path, bytes, lstatSync(join(root, descriptor.path)).mode & 0o777);
};
for (const exported of historical) {
  const path = manifest.exports[exported].slice(2), bytes = regular(join(software, path), 16 * 1024 * 1024), recorded = frozenReleases.find(entry => entry.release === exported);
  if (recorded) assert.equal(sha(bytes), recorded.sha256, `Frozen release differs from its recorded digest: ${exported}`);
  const checked = await readInstalledRelease({ root: software, release: exported }); assert(checked.valid, JSON.stringify(checked));
  if (recorded) assert.equal(checked.provenance.manifestSha256, recorded.sha256, `Frozen release not admitted by its recorded digest: ${exported}`);
  add(path, bytes);
  for (const item of checked.release.items) for (const descriptor of itemMembers(item)) member(software, descriptor);
  if (checked.release.baseline) {
    const baseline = checked.release.baseline; member(software, baseline.inventory);
    if (baseline.artifact.location.kind === "package") member(software, { ...baseline.artifact, path: baseline.artifact.location.path });
  }
}
for (const entry of prepared) {
  const contentBytes = regular(join(software, entry.content), 16 * 1024 * 1024);
  const content = readReleaseContent(contentBytes, { expectedSha256: sha(contentBytes) }); assert(content.valid, JSON.stringify(content));
  const inventoryBytes = regular(join(software, entry.inventory), 16 * 1024 * 1024);
  const frozen = createContentInventory(contentBytes, { expectedSha256: sha(contentBytes) });
  assert(frozen.valid && sha(frozen.bytes) === sha(inventoryBytes), `Prepared content inventory differs: ${entry.inventory}`);
  add(entry.content, contentBytes); add(entry.inventory, inventoryBytes);
  for (const item of content.release.items) for (const descriptor of itemMembers(item)) member(software, { ...descriptor, path: descriptor.path ?? descriptor.packagePath });
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
    { readArtifact, readContentCoverage, readContentCoverageBatch, authenticateEvidence, acquireArtifact: async () => artifactBytes });
  assert(qualified.valid, JSON.stringify(qualified));
  if (view.expectedReleaseSha256 !== undefined) assert.equal(qualified.release.sha256, view.expectedReleaseSha256, "Qualified reuse changed release identity");
  for (const item of qualified.release.items) for (const descriptor of itemMembers(item)) member(view.materialRoot, descriptor);
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
  walk(packageRoot); present.sort((a, b) => a.path < b.path ? -1 : 1);
  // Bounded: name the first changed member instead of diffing the whole tree.
  assert.equal(present.length, expectedFiles.length, "Package member missing");
  const changed = present.find((file, index) => file.path !== expectedFiles[index].path || file.sha256 !== expectedFiles[index].sha256);
  assert(!changed, `Package member changed: ${changed?.path}`);
}
for (const [exported] of releaseExports) { const checked = await readInstalledRelease({ root: packageRoot, release: exported }); assert(checked.valid, `${exported}: ${JSON.stringify(checked)}`); }
for (const entry of frozenReleases) { const bytes = regular(join(packageRoot, manifest.exports[entry.release].slice(2)), 16 * 1024 * 1024); assert.equal(sha(bytes), entry.sha256, `Assembled frozen release differs: ${entry.release}`); }
console.log(JSON.stringify({ kind: "catalog-full-package-qualification", package: { name: manifest.name, version: manifest.version },
  views, unchangedExports: historical, frozenExports: frozenReleases.map(entry => ({ export: entry.release, sha256: entry.sha256 })), softwareSha256: sha(Buffer.from(JSON.stringify(softwareMembers.sort((a,b) => a.path < b.path ? -1 : 1)))),
  packageTreeSha256: sha(Buffer.from(JSON.stringify(expectedFiles))), fileCount: expectedFiles.length, trustSha256: plan.trust.sha256,
  durationMs: Math.round(performance.now() - started), verifiedExisting: Boolean(verifyOnly), publication: false }));
