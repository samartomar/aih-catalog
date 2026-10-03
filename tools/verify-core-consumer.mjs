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
// An optional second argument names an exact, already packed Catalog artifact (for
// example a prepared candidate) to check instead of packing this checkout. With
// --instruction-directory <dir>, the consumer installs that Catalog unchanged and
// prepares the project context for <dir> through the public prepareProjectContext
// helper of @aihq/catalog/node, then runs the context scenario against the derived
// release. Nothing is regenerated or repacked.
const usage = "Usage: node tools/verify-core-consumer.mjs <core-tarball> " +
  "[<catalog-tarball>] [--instruction-directory <dir>]";
const positional = [];
let instructionDirectory;
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--instruction-directory") {
    assert(instructionDirectory === undefined && index + 1 < process.argv.length, usage);
    instructionDirectory = process.argv[++index];
  } else {
    assert(!argument.startsWith("-"), usage);
    positional.push(argument);
  }
}
const [coreArtifact, catalogArtifact] = positional;
assert(coreArtifact && positional.length <= 2, usage);
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
const EXPECTED_DIRECTORY = "AIHQ_CONSUMER_INSTRUCTION_DIRECTORY";
const environment = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts" && key !== EXPECTED_DIRECTORY));
const home = join(fixture, "home");
mkdirSync(home);
environment.HOME = home;
environment.USERPROFILE = home;
const runNpm = (args, cwd) => execFileSync(process.execPath, [npm, ...args], {
  cwd, env: environment, encoding: "utf8", timeout: 120_000,
  maxBuffer: 32 * 1024 * 1024,
});

try {
  let catalogTarball;
  if (catalogArtifact) {
    catalogTarball = resolve(catalogArtifact);
    assert(existsSync(catalogTarball), "The supplied Catalog artifact must exist.");
  } else {
    const [packed] = JSON.parse(runNpm([
      "pack", "--ignore-scripts", "--offline", "--json", "--pack-destination", fixture,
    ], root));
    assert(packed?.filename, "Packing must yield one exact Catalog artifact.");
    catalogTarball = join(fixture, packed.filename);
  }
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
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readRelease, listItems, getItem, configureItem, validateSelectionSet } from "@aihq/catalog/reader";
import { contractSupport } from "@aihq/catalog/contracts";
import { readInstalledRelease, resolveRelease } from "@aihq/catalog/node";
import { prepare, apply } from "@aihq/core";
const DEFAULT_DIR = "ai-coding";
const CONTEXT_SOURCE_ID = "aihq-project-context";
const bytes = readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/release.json")));
const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
const checked = await readRelease(bytes, { expectedSha256 });
assert.equal(checked.valid, true, JSON.stringify(checked.diagnostics));
assert(checked.release);
assert(contractSupport);
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const installed = await readInstalledRelease({ root });
assert.equal(installed.valid, true, JSON.stringify(installed.diagnostics));
// One bounded scenario derived from the release itself: the first item (preferring one with
// an explicit required closure) whose closure needs no configuration and holds no conflict.
// Valid unselected items that need configuration or conflict with each other do not block
// readiness; when nothing is selectable the check says so instead of claiming a pass.
const allItems = listItems(checked.release);
assert(allItems.length > 0, "The release must carry an item to select.");
const closureOf = id => {
  const order = [id];
  for (let index = 0; index < order.length; index += 1) {
    for (const ref of getItem(checked.release, order[index]).item.dependencies.requires) {
      if (ref.release !== undefined || !allItems.some(item => item.id === ref.itemId)) return undefined;
      if (!order.includes(ref.itemId)) order.push(ref.itemId);
    }
  }
  return order;
};
const viable = [];
const skipped = { configurationRequired: 0, conflicting: 0, unresolved: 0 };
for (const item of allItems) {
  const ids = closureOf(item.id);
  if (ids === undefined) { skipped.unresolved += 1; continue; }
  const attempts = ids.map(itemId => configureItem({ release: checked.release, itemId, configuration: {}, materialSource: installed.source }));
  const bad = attempts.flatMap(attempt => attempt.valid ? [] : attempt.diagnostics);
  if (bad.length > 0) {
    assert(bad.every(d => d.reason === "input-required"), JSON.stringify(bad));
    skipped.configurationRequired += 1;
    continue;
  }
  const trial = validateSelectionSet({ releases: { [expectedSha256]: checked.release }, selections: ids.map((itemId, index) => ({
    id: "t" + index, item: { releaseSha256: expectedSha256, itemId, itemSha256: getItem(checked.release, itemId).item.itemSha256 }, configuration: {} })) });
  if (!trial.valid) {
    assert(trial.diagnostics.every(d => d.reason === "conflict-selected"), JSON.stringify(trial.diagnostics));
    skipped.conflicting += 1;
    continue;
  }
  viable.push(ids);
}
const carriedIds = viable.find(ids => ids.length > 1) ?? viable[0];
if (carriedIds === undefined) {
  console.log(JSON.stringify({ status: "not-run", releaseSha256: expectedSha256, items: allItems.length, ...skipped,
    reason: "no item is selectable with defaults and a conflict-free required closure" }));
  process.exit(0);
}
for (const id of carriedIds) assert(allItems.some(item => item.id === id));
const selectionId = index => index === 0 ? "chosen-skill" : carriedIds.length === 2 ? "required-skill" : "required-skill-" + index;
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
  const choices = configured.map((item, index) => ({ id: selectionId(index),
    item: { releaseSha256: item.provenance.manifestSha256, itemId: item.provenance.itemId,
      itemSha256: item.provenance.itemSha256 }, configuration: {} }));
  const releases = { [expectedSha256]: release };
  if (carriedIds.length > 1) {
    const incomplete = validateSelectionSet({ releases, selections: choices.slice(0, 1) });
    assert.equal(incomplete.valid, false, "The caller must explicitly select the carried dependency.");
  }
  const set = validateSelectionSet({ releases, selections: choices });
  assert.equal(set.valid, true, JSON.stringify(set.diagnostics));
  assert.deepEqual(set.requiresBySelectionId, Object.fromEntries(carriedIds.map((id, index) => [selectionId(index),
    getItem(release, id).item.dependencies.requires.map(ref => selectionId(carriedIds.indexOf(ref.itemId)))])));
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
let defaultInputsChecked = 0;
const previousFetch = globalThis.fetch;
try {
  globalThis.fetch = fetchArchive;
  for (const [kind, chosen] of [["local", local], ["archive", remote]]) {
    const project = join(dirname(fileURLToPath(import.meta.url)), kind); mkdirSync(project);
    const controls = { logging: "off", ...(kind === "local" ? { materialRoots: installed.materialRoots } : {}) };
    const prepared = await prepare({ useCase: "policy", policy: chosen.policy, target: { project } }, controls);
    assert.equal(prepared.status, "ready", JSON.stringify(prepared.diagnostics));
    const inputs = Object.values(prepared.review.effectiveOptions.inputs);
    assert(inputs.every(input => input.origin === "default"), "Omitted inputs must retain their default origin.");
    defaultInputsChecked += inputs.length;
    for (const operation of prepared.review.operations) {
      if (typeof operation.details.target === "string")
        assert.equal(existsSync(operation.details.target), false, "Prepare must not write selected content.");
    }
    const applied = await apply(prepared.prepared, { approved: true, origin: "automation",
      reviewDigest: prepared.review.reviewDigest }, controls);
    assert.equal(applied.completion, "complete", JSON.stringify(applied.diagnostics));
    assert(applied.checks.every(check => check.status === "passed"));
    for (const operation of prepared.review.operations) {
      if (operation.kind === "file.write" && operation.details.materialSha256 !== undefined)
        assert.equal(sha(readFileSync(operation.details.target)), operation.details.materialSha256);
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
const member = local.configured.flatMap(item => item.selection.recipe.reference.materials)[0]
  ?? local.configured[0].selection.recipe.reference;
const materialPath = join(root, member.path);
const original = readFileSync(materialPath);
try {
  writeFileSync(materialPath, Buffer.from("changed selected material"));
  assert.equal((await readInstalledRelease({ root })).valid, false);
  const rejected = await apply(stale.prepared, { approved: true, origin: "automation",
    reviewDigest: stale.review.reviewDigest }, staleControls);
  assert.equal(rejected.completion, "rejected", JSON.stringify(rejected.diagnostics));
  for (const operation of stale.review.operations) {
    if (typeof operation.details.target === "string") assert.equal(existsSync(operation.details.target), false);
  }
} finally { writeFileSync(materialPath, original); }

// Shared project context through the generic Core lifecycle: explicit client
// deselection, shared entry-file retention, marker-precise removal and
// changed/unowned preservation. Delivery only — native loading is out of scope.
let contextLifecycle = { status: "not-run", reason: "the supplied release does not carry the context scenario" };
const requiredContextIds = ["aihq.project-context", "aihq.project-context-pointer.claude-md",
  "aihq.project-context-pointer.agents-md", "aihq.client.claude", "aihq.client.codex", "aihq.client.opencode"];
if (requiredContextIds.every(id => getItem(installed.release, id).found)) {
const here = dirname(fileURLToPath(import.meta.url));
// The context scenario runs against the installed release, or, when a project
// instruction directory is requested, against the derived release the public
// prepareProjectContext helper writes to caller-owned staging output. Skills and
// other items stay on the installed release; Core receives both material roots.
let contextRelease = installed.release;
let contextSource = installed.source;
let contextRoots = installed.materialRoots;
let contextRoot = root;
let derivation;
const requestedDirectory = process.env.${EXPECTED_DIRECTORY};
if (requestedDirectory !== undefined) {
  const { prepareProjectContext } = await import("@aihq/catalog/node");
  assert.equal(typeof prepareProjectContext, "function", "The packed Node entry exports prepareProjectContext.");
  const packageTree = () => {
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else files.push(relative(root, path).replaceAll("\\\\", "/") + ":" + sha(readFileSync(path)));
      }
    };
    walk(root);
    return files.sort();
  };
  const before = packageTree();
  const request = { release: installed.release, instructionDirectory: requestedDirectory,
    sourceMaterialRoots: installed.materialRoots };
  // A fresh caller-owned staging directory; the helper creates it under an existing parent.
  const staging = join(here, "context-staging");
  const derived = await prepareProjectContext({ ...request, outputDirectory: staging });
  assert.equal(derived.valid, true, JSON.stringify(derived.diagnostics));
  // Determinism: a second preparation yields the same release and bytes.
  const againStaging = join(here, "context-staging-again");
  const again = await prepareProjectContext({ ...request, outputDirectory: againStaging });
  assert.equal(again.valid, true, JSON.stringify(again.diagnostics));
  assert.equal(again.release.sha256, derived.release.sha256);
  const stagedTree = (dir) => [...derived.release.items.flatMap(item => [item.recipe.path,
    ...item.materials.map(member => member.path)]), "release/release.json"]
    .map(path => path + ":" + sha(readFileSync(join(dir, path)))).sort();
  assert.deepEqual(stagedTree(againStaging), stagedTree(staging));
  rmSync(againStaging, { recursive: true, force: true });
  assert.deepEqual(packageTree(), before, "Preparation leaves the installed package unchanged.");
  assert.equal(derived.provenance.kind, "derived");
  assert.match(derived.provenance.renderer, /^aihq-project-context-renderer@/u);
  assert.notEqual(derived.release.sha256, installed.release.sha256, "The derived release has its own identity.");
  assert.deepEqual(derived.release.metadata?.derived, { kind: "project-context",
    from: { package: { ...installed.release.package }, manifestSha256: installed.release.sha256 },
    renderer: derived.provenance.renderer, instructionDirectory: requestedDirectory });
  assert.equal(derived.source.kind, "local");
  assert.notEqual(derived.source.input, installed.source.input);
  const published = new Map(listItems(installed.release)
    .filter(item => item.sourceIds.includes(CONTEXT_SOURCE_ID)).map(item => [item.id, item.itemSha256]));
  assert.deepEqual(listItems(derived.release).map(item => item.id), [...published.keys()]);
  for (const item of listItems(derived.release)) {
    if (requestedDirectory === DEFAULT_DIR) assert.equal(item.itemSha256, published.get(item.id), item.id);
    else assert.notEqual(item.itemSha256, published.get(item.id), item.id);
  }
  contextRelease = derived.release;
  contextSource = derived.source;
  contextRoots = { ...installed.materialRoots, ...derived.materialRoots };
  contextRoot = derived.materialRoots[derived.source.input];
  derivation = { staging, installedReleaseSha256: installed.release.sha256,
    derivedReleaseSha256: derived.release.sha256, renderer: derived.provenance.renderer,
    deterministic: true, installedPackageUnchanged: true,
    contextItemIdentities: requestedDirectory === DEFAULT_DIR ? "published" : "derived" };
}
// The project instruction directory comes from the context release itself: the
// rule-router target of the shared context recipe.
const contextItem = getItem(contextRelease, "aihq.project-context").item;
const contextRecipe = JSON.parse(readFileSync(join(contextRoot, contextItem.recipe.path), "utf8"));
const routerTarget = contextRecipe.operations.find(op => op.id === "write-rule-router")?.target.segments
  .map(segment => segment.literal);
assert(routerTarget?.length > 1 && routerTarget.every(segment => typeof segment === "string") &&
  routerTarget.at(-1) === "RULE_ROUTER.md", JSON.stringify(routerTarget));
const DIR = routerTarget.slice(0, -1).join("/");
if (requestedDirectory !== undefined) {
  assert.equal(DIR, requestedDirectory, "The derived release uses the requested directory.");
  assert.equal(contextRelease.metadata.derived.instructionDirectory, DIR);
}
const customDirectory = DIR !== DEFAULT_DIR;
const familyItems = listItems(contextRelease).filter(item => item.sourceIds.includes(CONTEXT_SOURCE_ID));
const familyOf = (kind) => familyItems.filter(item => item.kind === kind);
const CLIENT_KEYS = familyOf("client-adapter").map(item => item.id.slice("aihq.client.".length));
// A requested directory may itself contain the default name. Remove only the
// complete requested reference before checking for a stale default reference.
const assertNoStaleDefault = (value, label) =>
  assert(!value.replaceAll(DIR, "<instruction-directory>").includes(DEFAULT_DIR), label);
if (customDirectory) {
  for (const item of familyItems) {
    const publishedItem = getItem(installed.release, item.id).item;
    const publishedRecipe = JSON.parse(readFileSync(join(root, publishedItem.recipe.path), "utf8"));
    const selectedRecipe = JSON.parse(readFileSync(join(contextRoot, item.recipe.path), "utf8"));
    const targets = recipe => recipe.operations.map(op => op.target.segments.map(segment => segment.literal).join("/"));
    assert.deepEqual(targets(selectedRecipe), targets(publishedRecipe).map(target =>
      target.startsWith(DEFAULT_DIR + "/") ? DIR + target.slice(DEFAULT_DIR.length) : target), item.id);
    for (const member of [item.recipe, ...item.materials]) {
      assertNoStaleDefault(member.path, member.path);
    }
    for (const material of item.materials)
      assertNoStaleDefault(readFileSync(join(contextRoot, material.path), "utf8"), material.path);
  }
}
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
  const configured = ids.map(itemId => configureItem({ release: contextRelease, itemId, configuration: {}, materialSource: contextSource }));
  for (const item of configured) assert.equal(item.valid, true, JSON.stringify(item.diagnostics));
  const selections = configured.map(item => ({ id: item.provenance.itemId,
    item: { releaseSha256: item.provenance.manifestSha256, itemId: item.provenance.itemId,
      itemSha256: item.provenance.itemSha256 }, configuration: {} }));
  const set = validateSelectionSet({ releases: { [contextRelease.sha256]: contextRelease }, selections });
  assert.equal(set.valid, true, JSON.stringify(set.diagnostics));
  return { schema: "urn:aihq:core:execution-policy:1.0.0", mode: "vibe",
    managedSelections: [{ id: "ai-context", scope: "project", members: ids }],
    selections: configured.map(item => ({ ...item.selection, id: item.provenance.itemId,
      managementId: item.provenance.itemId, scope: "project",
      requires: set.requiresBySelectionId[item.provenance.itemId] })) };
};
const contextControls = { logging: "off", materialRoots: contextRoots };
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
const contextProject = join(here, "context");
mkdirSync(contextProject);
mkdirSync(join(contextProject, DIR), { recursive: true });
const authorPath = join(contextProject, DIR, "PROJECT.md");
writeFileSync(authorPath, "# Project guidance\\nUse the repository's documented test command.\\n");
const userClaude = "# My own notes\\n\\nKeep this hand-written line.\\n";
writeFileSync(join(contextProject, "CLAUDE.md"), userClaude);

await prepareApply(contextPolicy(contextIds(clients)), contextProject);
const merged = read(join(contextProject, "CLAUDE.md"));
assert(merged.includes("Keep this hand-written line."), "User text outside the markers is preserved");
assert(merged.indexOf("Keep this hand-written line.") < merged.indexOf("<!-- BEGIN aihq:context:shared -->"));
assert(read(join(contextProject, "AGENTS.md")).includes("<!-- BEGIN aihq:context:shared -->"));
for (const name of ["claude", "codex", "opencode"])
  assert(existsSync(join(contextProject, DIR, "adapters", name + ".md")), name + " adapter note");
const router = getItem(contextRelease, "aihq.project-context").item.materials.find(m => m.id === "rule-router");
assert.equal(sha(readFileSync(join(contextProject, DIR + "/RULE_ROUTER.md"))), router.sha256);

// Authors edit their shared guidance once, outside Catalog's managed members.
const authorEdited = "# Project guidance\\nUse the focused package checks first.\\n";
writeFileSync(authorPath, authorEdited);
await prepareApply(contextPolicy(contextIds(clients)), contextProject);
assert.equal(read(authorPath), authorEdited, "Author edits survive a managed update");

// Deselect codex explicitly: its adapter note is pruned while the shared
// AGENTS.md entry stays for the remaining opencode selection.
await prepareApply(contextPolicy(contextIds(["aihq.client.claude", "aihq.client.opencode"])), contextProject);
assert.equal(existsSync(join(contextProject, DIR + "/adapters/codex.md")), false, "codex note pruned");
assert(existsSync(join(contextProject, DIR + "/adapters/opencode.md")), "opencode note retained");
assert(read(join(contextProject, "AGENTS.md")).includes("<!-- BEGIN aihq:context:shared -->"), "shared AGENTS.md block retained");
assert(read(join(contextProject, "CLAUDE.md")).includes("<!-- BEGIN aihq:context:shared -->"));
assert(existsSync(join(contextProject, DIR + "/RULE_ROUTER.md")), "shared context retained");

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
assert.equal(existsSync(join(contextProject, DIR + "/RULE_ROUTER.md")), false, "context files pruned");
assert.equal(existsSync(join(contextProject, DIR + "/adapters/claude.md")), false, "adapter notes pruned");
assert.equal(read(authorPath), authorEdited, "Author guidance survives full managed cleanup");

// A differing pre-existing unowned block is a conflict, never an implicit adoption.
const conflictProject = join(here, "conflict");
mkdirSync(conflictProject);
const expectedBlock = merged.slice(merged.indexOf("<!-- BEGIN aihq:context:shared -->"));
const edited = userClaude + "\\n" + expectedBlock.replace("## Working agreement", "## Edited by hand");
writeFileSync(join(conflictProject, "CLAUDE.md"), edited);
const conflict = await prepare({ useCase: "policy", policy: contextPolicy(contextIds(clients)),
  target: { project: conflictProject } }, contextControls);
assert.notEqual(conflict.status, "ready", "An edited managed block cannot prepare as ready");
assert(conflict.review.operations.some(op => op.effects === "conflict"), JSON.stringify(conflict.diagnostics));
assert.equal(read(join(conflictProject, "CLAUDE.md")), edited, "Edited content is preserved");

// A previously saved client dependency retains shared members even when neither
// the client nor its dependencies are reselected during another set's cleanup.
const savedProject = join(here, "saved-dependency");
mkdirSync(savedProject);
const sharedIds = contextIds(["aihq.client.codex", "aihq.client.opencode"]);
const sharedPolicy = contextPolicy(sharedIds);
const splitPolicy = { ...sharedPolicy, managedSelections: [
  { id: "codex-set", scope: "project", members: sharedIds.filter(id => id !== "aihq.client.opencode") },
  { id: "opencode-set", scope: "project", members: ["aihq.client.opencode"] },
] };
await prepareApply(splitPolicy, savedProject);
const savedAgents = read(join(savedProject, "AGENTS.md"));
const savedRouter = read(join(savedProject, DIR + "/RULE_ROUTER.md"));
const removeCodex = { ...emptyPolicy,
  managedSelections: [{ id: "codex-set", scope: "project", members: [] }] };
await prepareApply(removeCodex, savedProject);
assert.equal(existsSync(join(savedProject, DIR + "/adapters/codex.md")), false);
assert(existsSync(join(savedProject, DIR + "/adapters/opencode.md")));
assert.equal(read(join(savedProject, "AGENTS.md")), savedAgents);
assert.equal(read(join(savedProject, DIR + "/RULE_ROUTER.md")), savedRouter);
await prepareApply({ ...removeCodex, managedSelections: [
  ...removeCodex.managedSelections, { id: "opencode-set", scope: "project", members: [] },
] }, savedProject);
assert.equal(existsSync(join(savedProject, DIR + "/RULE_ROUTER.md")), false);
const savedAgentsPath = join(savedProject, "AGENTS.md");
assert(!existsSync(savedAgentsPath) || !read(savedAgentsPath).includes("aihq:context:shared"));

// Matching unowned blocks/files remain unowned and survive managed cleanup.
const unownedProject = join(here, "matching-unowned");
mkdirSync(join(unownedProject, DIR), { recursive: true });
writeFileSync(join(unownedProject, "AGENTS.md"), savedAgents);
writeFileSync(join(unownedProject, DIR + "/RULE_ROUTER.md"), savedRouter);
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
assert.equal(read(join(unownedProject, DIR + "/RULE_ROUTER.md")), savedRouter);

// Actual ownership precedes the edit: both update and cleanup expose conflicts
// for changed owned blocks/files and preserve the edited bytes.
for (const [name, member] of [["block", "AGENTS.md"], ["file", DIR + "/RULE_ROUTER.md"]]) {
  const driftProject = join(here, "owned-drift-" + name);
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

// The whole family: every delivered context, pointer and adapter file follows the
// release's directory; a custom directory leaves no stale default references.
// With a derived release the same policy also selects the installed release's
// required closure, validated together with both releases keyed by manifest SHA-256.
const familyProject = join(here, "full-family");
mkdirSync(familyProject);
const familyPolicy = contextPolicy(familyItems.map(item => item.id));
let installedAlongside = 0;
// An installed, configuration-free required closure outside the context family.
const installedIds = viable.find(ids => ids.every(id =>
  !getItem(installed.release, id).item.sourceIds.includes(CONTEXT_SOURCE_ID)));
if (derivation !== undefined && installedIds !== undefined) {
  const installedConfigured = installedIds.map(itemId => configureItem({ release: installed.release, itemId,
    configuration: {}, materialSource: installed.source }));
  for (const item of installedConfigured) assert.equal(item.valid, true, JSON.stringify(item.diagnostics));
  const selections = [...familyPolicy.selections, ...installedConfigured.map(item => ({ ...item.selection,
    id: item.provenance.itemId, managementId: item.provenance.itemId, scope: "project" }))];
  const set = validateSelectionSet({ releases: { [contextRelease.sha256]: contextRelease,
    [installed.release.sha256]: installed.release }, selections: selections.map((selection, index) => {
    const provenance = index < familyPolicy.selections.length
      ? { release: contextRelease, itemId: selection.id } : { release: installed.release, itemId: selection.id };
    return { id: selection.id, item: { releaseSha256: provenance.release.sha256, itemId: provenance.itemId,
      itemSha256: getItem(provenance.release, provenance.itemId).item.itemSha256 }, configuration: {} };
  }) });
  assert.equal(set.valid, true, JSON.stringify(set.diagnostics));
  familyPolicy.selections = selections.map(selection => ({ ...selection, requires: set.requiresBySelectionId[selection.id] }));
  familyPolicy.managedSelections = [{ id: "ai-context", scope: "project", members: selections.map(selection => selection.id) }];
  installedAlongside = installedConfigured.length;
}
const familyPrepared = await prepare({ useCase: "policy", policy: familyPolicy,
  target: { project: familyProject } }, contextControls);
assert.equal(familyPrepared.status, "ready", JSON.stringify(familyPrepared.diagnostics));
const familyApplied = await apply(familyPrepared.prepared, { approved: true, origin: "automation",
  reviewDigest: familyPrepared.review.reviewDigest }, contextControls);
assert.equal(familyApplied.completion, "complete", JSON.stringify(familyApplied.diagnostics));
assert(familyApplied.checks.every(check => check.status === "passed"));
// Core reports canonical targets; compare against the canonical project root.
const familyBase = realpathSync.native(familyProject);
const projectPath = (target) => relative(familyBase, target).replaceAll("\\\\", "/");
const delivered = [...new Set(familyPrepared.review.operations.map(op => op.details.target)
  .filter(target => typeof target === "string"))];
for (const target of delivered) assert(!projectPath(target).startsWith(".."), target);
// One delivered file per distinct operation target across the family recipes.
const familyTargets = new Set(familyItems.flatMap(item =>
  JSON.parse(readFileSync(join(contextRoot, item.recipe.path), "utf8")).operations
    .map(op => op.target.segments.map(segment => segment.literal).join("/"))));
const contextDelivered = delivered.filter(target => familyTargets.has(projectPath(target)));
assert.equal(familyTargets.size, contextItem.materials.length + familyOf("client-entry-pointer").length +
  CLIENT_KEYS.length, JSON.stringify([...familyTargets]));
assert.equal(contextDelivered.length, familyTargets.size, JSON.stringify(delivered));
if (installedAlongside > 0) {
  assert(delivered.length > contextDelivered.length, "Installed items are delivered beside the derived context.");
  for (const target of delivered.filter(target => !contextDelivered.includes(target))) assert(existsSync(target), target);
}
assert.equal(CLIENT_KEYS.length, 11, JSON.stringify(CLIENT_KEYS));
for (const name of CLIENT_KEYS)
  assert(existsSync(join(familyProject, DIR, "adapters", name + ".md")), name + " adapter note under " + DIR);
if (customDirectory) {
  for (const target of familyTargets) {
    if (!target.startsWith(DIR + "/")) continue;
    const staleTarget = DEFAULT_DIR + target.slice(DIR.length);
    if (familyTargets.has(staleTarget)) continue;
    assert.equal(existsSync(join(familyProject, staleTarget)), false, "No stale default target: " + staleTarget);
  }
  for (const target of contextDelivered) {
    assertNoStaleDefault(projectPath(target), projectPath(target));
    assertNoStaleDefault(read(target), projectPath(target) + " mentions the default directory");
  }
}
// Verify admission through Core's public boundary with a controlled GitHub
// organization-policy response. Identity follows the documented descriptor;
// no Core internals or public-review identity field are needed.
const canonicalJson = value => Array.isArray(value) ? "[" + value.map(canonicalJson).join(",") + "]"
  : value !== null && typeof value === "object" ? "{" + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}" : JSON.stringify(value);
const identityOf = item => "sha256:" + sha(canonicalJson({
  schema: "urn:aihq:core:recipe-identity:1.0.0", recipeSha256: item.recipe.sha256,
  materials: item.materials.map(({ id, sha256, byteLength }) => ({ id, sha256, byteLength }))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
}));
const selectedIdentity = identityOf(contextItem);
const publishedIdentity = identityOf(getItem(installed.release, contextItem.id).item);
assert.equal(selectedIdentity === publishedIdentity, !customDirectory);
const deniedIdentity = customDirectory ? publishedIdentity : "sha256:" + "0".repeat(64);
const enterprisePolicy = contextPolicy([contextItem.id]);
enterprisePolicy.mode = "enterprise";
enterprisePolicy.selections[0].organizationSelectionId = "project-context";
const commit = "a".repeat(40);
const organizationSource = { provider: "github", repository: { owner: "Example-Org", name: "Org-Policy" },
  path: "policy/org.json", revision: { kind: "commit", value: commit } };
const originalFetch = globalThis.fetch;
let enterpriseAdmission;
try {
  for (const [name, recipeIdentity] of [["admitted", selectedIdentity], ["denied", deniedIdentity]]) {
    const orgBytes = Buffer.from(JSON.stringify({ schema: "urn:aihq:core:organization-policy:1.0.0",
      id: "consumer-org-policy", selections: [{ selectionId: "project-context", recipeIdentity,
        scopes: ["project"], inputs: {} }] }));
    const blob = createHash("sha1").update(Buffer.concat([
      Buffer.from("blob " + orgBytes.length + String.fromCharCode(0)), orgBytes])).digest("hex");
    const base = "/repos/example-org/org-policy/git/";
    const tree1 = "1".padStart(40, "0");
    const tree2 = "2".padStart(40, "0");
    const routes = new Map([
      [base + "commits/" + commit, { sha: commit, tree: { sha: tree1 } }],
      [base + "trees/" + tree1, { sha: tree1, truncated: false,
        tree: [{ path: "policy", mode: "040000", type: "tree", sha: tree2 }] }],
      [base + "trees/" + tree2, { sha: tree2, truncated: false,
        tree: [{ path: "org.json", mode: "100644", type: "blob", sha: blob, size: orgBytes.length }] }],
      [base + "blobs/" + blob, { sha: blob, size: orgBytes.length, encoding: "base64", content: orgBytes.toString("base64") }],
    ]);
    let requests = 0;
    globalThis.fetch = async url => {
      const request = new URL(String(url));
      assert.equal(request.origin, "https://api.github.com");
      assert.equal(request.search, "");
      assert(routes.has(request.pathname), request.href);
      requests += 1;
      return new Response(JSON.stringify(routes.get(request.pathname)), { headers: { "content-type": "application/json" } });
    };
    const project = join(here, "enterprise-" + name);
    mkdirSync(project);
    const prepared = await prepare({ useCase: "policy", policy: enterprisePolicy,
      target: { project }, organizationSource }, contextControls);
    assert.equal(requests, 4, "The organization policy is read from the controlled fixture.");
    if (name === "admitted") {
      assert.equal(prepared.status, "ready", JSON.stringify(prepared.diagnostics));
      const applied = await apply(prepared.prepared, { approved: true, origin: "automation",
        reviewDigest: prepared.review.reviewDigest }, contextControls);
      assert.equal(applied.completion, "complete", JSON.stringify(applied.diagnostics));
      assert(applied.checks.every(check => check.status === "passed"));
      assert.equal(requests, 8, "Apply revalidates the organization policy.");
      assert.equal(sha(readFileSync(join(project, DIR, "RULE_ROUTER.md"))), router.sha256);
    } else {
      assert.equal(prepared.status, "blocked", JSON.stringify(prepared.diagnostics));
      assert.equal(prepared.prepared, undefined);
      assert(prepared.diagnostics.some(d => d.code === "AUTHORITY_DENIED" && d.reason === "recipe-identity"),
        JSON.stringify(prepared.diagnostics));
      assert.equal(existsSync(join(project, DIR, "RULE_ROUTER.md")), false);
    }
  }
  enterpriseAdmission = { status: "passed", selectedIdentity, deniedIdentity,
    deniedPublishedIdentity: customDirectory, applyCompleted: true };
} finally {
  globalThis.fetch = originalFetch;
}
if (derivation !== undefined) {
  // Staging lifetime: kept until prepare and apply complete. This check owns the
  // staging directory and removes it here itself; stagingRemoved records that this
  // script's own removal succeeded (the helper never deletes staging after success).
  const { staging, ...recorded } = derivation;
  rmSync(staging, { recursive: true, force: true });
  derivation = { ...recorded, stagingRemoved: !existsSync(staging),
    installedItemsAlongside: installedAlongside };
}

contextLifecycle = { status: "passed", instructionDirectory: DIR, familyFilesDelivered: contextDelivered.length,
    derivation, enterpriseAdmission,
    clientsSelected: clients.length, deselectionRetainedShared: true,
    pruneMarkerPrecise: true, unownedBlockConflict: true, savedDependencyRetention: true,
    matchingUnownedPreserved: true, ownedBlockAndFileDriftPreserved: true,
    authorGuidancePreserved: true };
}
console.log(JSON.stringify({ status: "passed", selected: carriedIds, skipped, releaseSha256: expectedSha256, publicImports: true,
  dependencyMapping: true, defaultOrigin: defaultInputsChecked > 0 ? "default" : "not-applicable",
  defaultInputsChecked, sameClosure: true, staleMaterialRejected: true, contextLifecycle, results }));
`);
  // Only the instruction-directory mode names a directory; the consume script then
  // prepares the derived release through the packed helper.
  const consumeEnvironment = instructionDirectory === undefined ? environment
    : { ...environment, [EXPECTED_DIRECTORY]: instructionDirectory };
  const result = JSON.parse(execFileSync(process.execPath, [join(consumer, "consume.mjs"), catalogTarball], {
    cwd: consumer, env: consumeEnvironment, encoding: "utf8", timeout: 300_000,
    maxBuffer: 8 * 1024 * 1024,
  }));
  console.log(JSON.stringify({ ...result, coreSha256, catalogSha256 }, null, 2));
  if (instructionDirectory !== undefined) {
    assert.equal(result.contextLifecycle?.status, "passed",
      "The instruction directory needs the context scenario to run.");
    assert.equal(result.contextLifecycle.derivation?.stagingRemoved, true);
  }
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  // mkdtemp supplies this exact task-owned root; no caller path is removed.
  assert(fixture.startsWith(join(tmpdir(), "aih-catalog-core-consumer-")));
  rmSync(fixture, { recursive: true, force: true });
}
