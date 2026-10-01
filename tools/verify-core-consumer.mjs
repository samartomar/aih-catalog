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

// Shared project context through the generic Core lifecycle: explicit client
// deselection, shared entry-file retention, marker-precise removal and
// changed/unowned preservation. Delivery only — native loading is out of scope.
const CLIENT_POINTERS = {
  "aihq.client.claude": ["aihq.project-context-pointer.claude-md"],
  "aihq.client.codex": ["aihq.project-context-pointer.agents-md"],
  "aihq.client.opencode": ["aihq.project-context-pointer.agents-md"],
};
const contextIds = (clients) => {
  const pointers = new Set();
  for (const client of clients) for (const pointer of CLIENT_POINTERS[client]) pointers.add(pointer);
  return ["aihq.project-context", ...[...pointers].sort(), ...[...clients].sort()];
};
const contextPolicy = (ids) => {
  const configured = ids.map(itemId => configureItem({ release: installed.release, itemId, configuration: {}, materialSource: installed.source }));
  for (const item of configured) assert.equal(item.valid, true, JSON.stringify(item.diagnostics));
  const selections = configured.map(item => ({ id: item.provenance.itemId,
    item: { releaseSha256: item.provenance.manifestSha256, itemId: item.provenance.itemId,
      itemSha256: item.provenance.itemSha256 }, configuration: {} }));
  const set = validateSelectionSet({ releases: { [expectedSha256]: installed.release }, selections });
  assert.equal(set.valid, true, JSON.stringify(set.diagnostics));
  return { schema: "urn:aihq:core:execution-policy:1.0.0", mode: "vibe",
    managedSelections: [{ id: "ai-context", scope: "project", members: ids }],
    selections: configured.map(item => ({ ...item.selection, id: item.provenance.itemId,
      managementId: item.provenance.itemId, scope: "project",
      requires: set.requiresBySelectionId[item.provenance.itemId] })) };
};
const contextControls = { logging: "off", materialRoots: installed.materialRoots };
const prepareApply = async (policy, project) => {
  const prepared = await prepare({ useCase: "policy", policy, target: { project } }, contextControls);
  assert.equal(prepared.status, "ready", JSON.stringify(prepared.diagnostics));
  const applied = await apply(prepared.prepared, { approved: true, origin: "automation",
    reviewDigest: prepared.review.reviewDigest }, contextControls);
  assert.equal(applied.completion, "complete", JSON.stringify(applied.diagnostics));
  assert(applied.checks.every(check => check.status === "passed"));
  return applied;
};
const clients = ["aihq.client.claude", "aihq.client.codex", "aihq.client.opencode"];
const read = (path) => readFileSync(path, "utf8");
const contextProject = join(dirname(fileURLToPath(import.meta.url)), "context");
mkdirSync(contextProject);
const userClaude = "# My own notes\\n\\nKeep this hand-written line.\\n";
writeFileSync(join(contextProject, "CLAUDE.md"), userClaude);

await prepareApply(contextPolicy(contextIds(clients)), contextProject);
const merged = read(join(contextProject, "CLAUDE.md"));
assert(merged.includes("Keep this hand-written line."), "User text outside the markers is preserved");
assert(merged.indexOf("Keep this hand-written line.") < merged.indexOf("<!-- BEGIN aihq:context:shared -->"));
assert(read(join(contextProject, "AGENTS.md")).includes("<!-- BEGIN aihq:context:shared -->"));
for (const name of ["claude", "codex", "opencode"])
  assert(existsSync(join(contextProject, "ai-coding/adapters", name + ".md")), name + " adapter note");
const router = getItem(checked.release, "aihq.project-context").item.materials.find(m => m.id === "rule-router");
assert.equal(sha(readFileSync(join(contextProject, "ai-coding/RULE_ROUTER.md"))), router.sha256);

// Deselect codex explicitly: its adapter note is pruned while the shared
// AGENTS.md entry stays for the remaining opencode selection.
await prepareApply(contextPolicy(contextIds(["aihq.client.claude", "aihq.client.opencode"])), contextProject);
assert.equal(existsSync(join(contextProject, "ai-coding/adapters/codex.md")), false, "codex note pruned");
assert(existsSync(join(contextProject, "ai-coding/adapters/opencode.md")), "opencode note retained");
assert(read(join(contextProject, "AGENTS.md")).includes("<!-- BEGIN aihq:context:shared -->"), "shared AGENTS.md block retained");
assert(read(join(contextProject, "CLAUDE.md")).includes("<!-- BEGIN aihq:context:shared -->"));
assert(existsSync(join(contextProject, "ai-coding/RULE_ROUTER.md")), "shared context retained");

// Deselect the whole family through an explicitly empty managed set: owned
// members are removed marker-precisely; user text and custody survive.
const emptyPolicy = { schema: "urn:aihq:core:execution-policy:1.0.0", mode: "vibe", selections: [],
  managedSelections: [{ id: "ai-context", scope: "project", members: [] }] };
await prepareApply(emptyPolicy, contextProject);
const stripped = read(join(contextProject, "CLAUDE.md"));
assert(stripped.includes("Keep this hand-written line."), "Hand-written text survives full deselection");
assert(!stripped.includes("aihq:context:shared"), "The managed block is subtracted");
const agentsPath = join(contextProject, "AGENTS.md");
assert(!existsSync(agentsPath) || !read(agentsPath).includes("aihq:context:shared"), "AGENTS.md block removed");
assert.equal(existsSync(join(contextProject, "ai-coding/RULE_ROUTER.md")), false, "context files pruned");
assert.equal(existsSync(join(contextProject, "ai-coding/adapters/claude.md")), false, "adapter notes pruned");

// A differing pre-existing unowned block is a conflict, never an implicit adoption.
const conflictProject = join(dirname(fileURLToPath(import.meta.url)), "conflict");
mkdirSync(conflictProject);
const expectedBlock = merged.slice(merged.indexOf("<!-- BEGIN aihq:context:shared -->"));
const edited = userClaude + "\\n" + expectedBlock.replace("## Working agreement", "## Edited by hand");
writeFileSync(join(conflictProject, "CLAUDE.md"), edited);
const conflict = await prepare({ useCase: "policy", policy: contextPolicy(contextIds(clients)),
  target: { project: conflictProject } }, contextControls);
assert.notEqual(conflict.status, "ready", "An edited managed block cannot prepare as ready");
assert.equal(read(join(conflictProject, "CLAUDE.md")), edited, "Edited content is preserved");

// A previously saved client dependency retains shared members even when neither
// the client nor its dependencies are reselected during another set's cleanup.
const savedProject = join(dirname(fileURLToPath(import.meta.url)), "saved-dependency");
mkdirSync(savedProject);
const sharedIds = contextIds(["aihq.client.codex", "aihq.client.opencode"]);
const sharedPolicy = contextPolicy(sharedIds);
const splitPolicy = { ...sharedPolicy, managedSelections: [
  { id: "codex-set", scope: "project", members: sharedIds.filter(id => id !== "aihq.client.opencode") },
  { id: "opencode-set", scope: "project", members: ["aihq.client.opencode"] },
] };
await prepareApply(splitPolicy, savedProject);
const savedAgents = read(join(savedProject, "AGENTS.md"));
const savedRouter = read(join(savedProject, "ai-coding/RULE_ROUTER.md"));
const removeCodex = { ...emptyPolicy,
  managedSelections: [{ id: "codex-set", scope: "project", members: [] }] };
await prepareApply(removeCodex, savedProject);
assert.equal(existsSync(join(savedProject, "ai-coding/adapters/codex.md")), false);
assert(existsSync(join(savedProject, "ai-coding/adapters/opencode.md")));
assert.equal(read(join(savedProject, "AGENTS.md")), savedAgents);
assert.equal(read(join(savedProject, "ai-coding/RULE_ROUTER.md")), savedRouter);
await prepareApply({ ...removeCodex, managedSelections: [
  ...removeCodex.managedSelections, { id: "opencode-set", scope: "project", members: [] },
] }, savedProject);
assert.equal(existsSync(join(savedProject, "ai-coding/RULE_ROUTER.md")), false);
const savedAgentsPath = join(savedProject, "AGENTS.md");
assert(!existsSync(savedAgentsPath) || !read(savedAgentsPath).includes("aihq:context:shared"));

// Matching unowned blocks/files remain unowned and survive managed cleanup.
const unownedProject = join(dirname(fileURLToPath(import.meta.url)), "matching-unowned");
mkdirSync(join(unownedProject, "ai-coding"), { recursive: true });
writeFileSync(join(unownedProject, "AGENTS.md"), savedAgents);
writeFileSync(join(unownedProject, "ai-coding/RULE_ROUTER.md"), savedRouter);
const unownedReview = await prepare({ useCase: "policy", policy: sharedPolicy,
  target: { project: unownedProject } }, contextControls);
assert.equal(unownedReview.status, "ready", JSON.stringify(unownedReview.diagnostics));
for (const destination of ["AGENTS.md", "RULE_ROUTER.md"]) {
  const operation = unownedReview.review.operations.find(op => op.details.target.endsWith(destination));
  assert.equal(operation?.ownership, "unowned", JSON.stringify(operation));
  assert.equal(operation?.effects, "already-satisfied", JSON.stringify(operation));
}
await prepareApply(sharedPolicy, unownedProject);
await prepareApply(emptyPolicy, unownedProject);
assert.equal(read(join(unownedProject, "AGENTS.md")), savedAgents);
assert.equal(read(join(unownedProject, "ai-coding/RULE_ROUTER.md")), savedRouter);

// Actual ownership precedes the edit: both update and cleanup expose conflicts
// for changed owned blocks/files and preserve the edited bytes.
for (const [name, member] of [["block", "AGENTS.md"], ["file", "ai-coding/RULE_ROUTER.md"]]) {
  const driftProject = join(dirname(fileURLToPath(import.meta.url)), "owned-drift-" + name);
  mkdirSync(driftProject);
  await prepareApply(sharedPolicy, driftProject);
  const target = join(driftProject, member);
  const original = read(target);
  const changed = original.replace(name === "block" ? "## Working agreement" : "# AI Rule Router",
    "# User edited guidance");
  assert.notEqual(changed, original);
  writeFileSync(target, changed);
  for (const policy of [sharedPolicy, emptyPolicy]) {
    const review = await prepare({ useCase: "policy", policy, target: { project: driftProject } }, contextControls);
    assert.notEqual(review.status, "ready", JSON.stringify(review.diagnostics));
    assert(review.review.operations.some(op => op.effects === "conflict"), JSON.stringify(review.diagnostics));
    assert.equal(read(target), changed);
  }
}

console.log(JSON.stringify({ releaseSha256: expectedSha256, publicImports: true,
  dependencyMapping: true, defaultOrigin: "default", sameClosure: true, staleMaterialRejected: true,
  contextLifecycle: { clientsSelected: clients.length, deselectionRetainedShared: true,
    pruneMarkerPrecise: true, unownedBlockConflict: true, savedDependencyRetention: true,
    matchingUnownedPreserved: true, ownedBlockAndFileDriftPreserved: true }, results }));
`);
  const result = JSON.parse(execFileSync(process.execPath, [join(consumer, "consume.mjs"), catalogTarball], {
    cwd: consumer, env: environment, encoding: "utf8", timeout: 300_000,
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
