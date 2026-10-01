import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

// The caller supplies a reviewed Core artifact. This check never chooses a
// registry version, imports a source checkout or publishes either package.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [coreArtifact] = process.argv.slice(2);
assert(coreArtifact, "Usage: node tools/verify-core-consumer.mjs <core-tarball>");
const coreTarball = resolve(coreArtifact);
assert(existsSync(coreTarball), "The supplied Core artifact must exist.");
const npm = [
  process.env.npm_execpath,
  resolve(process.execPath, "..", "node_modules/npm/bin/npm-cli.js"),
  resolve(process.execPath, "../..", "lib/node_modules/npm/bin/npm-cli.js"),
].find((candidate) => candidate && isAbsolute(candidate) &&
  basename(candidate) === "npm-cli.js" && existsSync(candidate));
assert(npm, "Use a Node distribution with adjacent npm, or invoke through npm.");
const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-core-consumer-"));
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const coreSha256 = hash(coreTarball);
const environment = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"));
const home = join(fixture, "home");
mkdirSync(home);
environment.HOME = home;
environment.USERPROFILE = home;
const runNpm = (args, cwd) => execFileSync(process.execPath, [npm, ...args], {
  cwd, env: environment, encoding: "utf8", timeout: 120_000,
  maxBuffer: 32 * 1024 * 1024,
});
try {
  const [packed] = JSON.parse(runNpm([
    "pack", "--ignore-scripts", "--offline", "--json", "--pack-destination", fixture,
  ], root));
  assert(packed?.filename, "Packing must yield one exact Catalog artifact.");
  const catalogTarball = join(fixture, packed.filename);
  const catalogSha256 = hash(catalogTarball);
  const consumer = join(fixture, "consumer");
  seedConsumerLock(consumer, root);
  runNpm([
    "install", "--prefix", consumer, "--ignore-scripts", "--offline",
    "--no-audit", "--no-fund", coreTarball, catalogTarball,
  ], fixture);
  assert.equal(hash(coreTarball), coreSha256);
  assert.equal(hash(catalogTarball), catalogSha256);
  writeFileSync(join(consumer, "consume.mjs"), `
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readRelease, listItems, getItem, configureItem, validateSelectionSet } from "@aihq/catalog/reader";
import { contractSupport } from "@aihq/catalog/contracts";
import { readInstalledRelease, resolveRelease } from "@aihq/catalog/node";
import { prepare, apply } from "@aihq/core";
const bytes = readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/release.json")));
const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
const checked = await readRelease(bytes, { expectedSha256 });
assert.equal(checked.valid, true, JSON.stringify(checked.diagnostics));
assert(checked.release);
assert(contractSupport);
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const installed = await readInstalledRelease({ root });
assert.equal(installed.valid, true, JSON.stringify(installed.diagnostics));
const carriedIds = ["mattpocock.grill-me", "mattpocock.grilling"];
for (const id of carriedIds) assert(listItems(checked.release).some(item => item.id === id));
assert.equal(getItem(checked.release, "missing-item").found, false);
const archiveBytes = readFileSync(process.argv[2]);
const archive = { url: "https://example.invalid/catalog-fixture.tgz",
  sha256: createHash("sha256").update(archiveBytes).digest("hex"), byteLength: archiveBytes.length };
const fetchArchive = async (url) => {
  assert.equal(String(url), archive.url, "The fixture must never acquire another URL.");
  return new Response(archiveBytes, { headers: { "content-length": String(archiveBytes.length) } });
};
const acquired = await resolveRelease({ archive }, { fetch: fetchArchive });
assert.equal(acquired.valid, true, JSON.stringify(acquired.diagnostics));
assert.deepEqual(listItems(acquired.release), listItems(checked.release));

function select(release, materialSource) {
  const configured = carriedIds.map(itemId => configureItem({ release, itemId, configuration: {}, materialSource }));
  for (const item of configured) {
    assert.equal(item.valid, true, JSON.stringify(item.diagnostics));
    assert.deepEqual(item.selection.configuration, {}, "The authored policy must preserve omitted defaults.");
  }
  const choices = configured.map((item, index) => ({ id: index === 0 ? "chosen-skill" : "required-skill",
    item: { releaseSha256: item.provenance.manifestSha256, itemId: item.provenance.itemId,
      itemSha256: item.provenance.itemSha256 }, configuration: {} }));
  const releases = { [expectedSha256]: release };
  const incomplete = validateSelectionSet({ releases, selections: choices.slice(0, 1) });
  assert.equal(incomplete.valid, false, "The caller must explicitly select the carried dependency.");
  const set = validateSelectionSet({ releases, selections: choices });
  assert.equal(set.valid, true, JSON.stringify(set.diagnostics));
  assert.deepEqual(set.requiresBySelectionId, { "chosen-skill": ["required-skill"], "required-skill": [] });
  const policy = { schema: "urn:aihq:core:execution-policy:1.0.0", mode: "vibe",
    selections: configured.map((item, index) => ({ ...item.selection, id: choices[index].id,
      managementId: choices[index].id, scope: "project", requires: set.requiresBySelectionId[choices[index].id] })) };
  return { configured, policy };
}
const local = select(installed.release, installed.source);
const remote = select(acquired.release, acquired.source);
const identities = (configured) => configured.map(({ selection }) => ({
  recipeSha256: selection.recipe.reference.sha256,
  byteLength: selection.recipe.reference.byteLength,
  materials: selection.recipe.reference.materials.map(({ id, sha256, byteLength }) => ({ id, sha256, byteLength })),
}));
assert.deepEqual(identities(local.configured), identities(remote.configured));
for (const item of remote.configured) {
  assert(item.selection.recipe.reference.path.startsWith("package/"));
  for (const material of item.selection.recipe.reference.materials) assert(material.path.startsWith("package/"));
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const results = [];
const previousFetch = globalThis.fetch;
try {
  globalThis.fetch = fetchArchive;
  for (const [kind, chosen] of [["local", local], ["archive", remote]]) {
    const project = join(dirname(fileURLToPath(import.meta.url)), kind); mkdirSync(project);
    const controls = { logging: "off", ...(kind === "local" ? { materialRoots: installed.materialRoots } : {}) };
    const prepared = await prepare({ useCase: "policy", policy: chosen.policy, target: { project } }, controls);
    assert.equal(prepared.status, "ready", JSON.stringify(prepared.diagnostics));
    assert.equal(prepared.review.effectiveOptions.inputs["chosen-skill/agentDirectory"].origin, "default");
    assert.equal(existsSync(join(project, ".claude")), false, "Prepare must not write selected content.");
    const applied = await apply(prepared.prepared, { approved: true, origin: "automation",
      reviewDigest: prepared.review.reviewDigest }, controls);
    assert.equal(applied.completion, "complete", JSON.stringify(applied.diagnostics));
    assert(applied.checks.length > 0);
    assert(applied.checks.every(check => check.status === "passed"));
    for (const name of ["grill-me", "grilling"]) {
      const item = getItem(checked.release, "mattpocock." + name).item;
      const skill = item.materials.find(material => material.path.endsWith("/SKILL.md"));
      assert(skill);
      assert.equal(sha(readFileSync(join(project, ".claude/skills", name, "SKILL.md"))), skill.sha256);
    }
    results.push({ kind, completion: applied.completion, checks: applied.checks.length });
  }
} finally { globalThis.fetch = previousFetch; }

// A changed installed member invalidates the review even though the prepared
// snapshot retained the originally observed bytes.
const staleProject = join(dirname(fileURLToPath(import.meta.url)), "stale"); mkdirSync(staleProject);
const staleControls = { logging: "off", materialRoots: installed.materialRoots };
const stale = await prepare({ useCase: "policy", policy: local.policy, target: { project: staleProject } }, staleControls);
assert.equal(stale.status, "ready", JSON.stringify(stale.diagnostics));
const member = local.configured[0].selection.recipe.reference.materials[0];
const materialPath = join(root, member.path);
const original = readFileSync(materialPath);
try {
  writeFileSync(materialPath, Buffer.from("changed selected material"));
  assert.equal((await readInstalledRelease({ root })).valid, false);
  const rejected = await apply(stale.prepared, { approved: true, origin: "automation",
    reviewDigest: stale.review.reviewDigest }, staleControls);
  assert.equal(rejected.completion, "rejected", JSON.stringify(rejected.diagnostics));
  assert.equal(existsSync(join(staleProject, ".claude")), false);
} finally { writeFileSync(materialPath, original); }
console.log(JSON.stringify({ releaseSha256: expectedSha256, publicImports: true,
  dependencyMapping: true, defaultOrigin: "default", sameClosure: true, staleMaterialRejected: true, results }));
`);
  const result = JSON.parse(execFileSync(process.execPath, [join(consumer, "consume.mjs"), catalogTarball], {
    cwd: consumer, env: environment, encoding: "utf8", timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  }));
  console.log(JSON.stringify({ ...result, coreSha256, catalogSha256 }, null, 2));
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  // mkdtemp supplies this exact task-owned root; no caller path is removed.
  assert(fixture.startsWith(join(tmpdir(), "aih-catalog-core-consumer-")));
  rmSync(fixture, { recursive: true, force: true });
}
