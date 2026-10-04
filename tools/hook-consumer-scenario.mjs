// Runs inside a disposable consumer that installed the exact packed Catalog and Core artifacts
// (see tools/verify-hook-consumer.mjs). It imports only public package entries.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contractSupport } from "@aihq/catalog/contracts";
import { readInstalledRelease } from "@aihq/catalog/node";
import { configureItem, getItem, readRelease, validateSelectionSet } from "@aihq/catalog/reader";
import { apply, prepare } from "@aihq/core";

const ITEM = "aihq.hook.claude.protect-env";
const GROUP = "protect-env";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const here = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "aih-hook-scenario-"));
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));

// Release 1.1 is read only through its own explicit export; the default stays 1.0.
const defaultRead = await readInstalledRelease({ root });
assert.equal(defaultRead.valid, true, JSON.stringify(defaultRead.diagnostics));
assert.equal(getItem(defaultRead.release, ITEM).found, false, "release.json never carries the hook item");
const installed = await readInstalledRelease({ root, release: "./release-1.1.json" });
assert.equal(installed.valid, true, JSON.stringify(installed.diagnostics));
assert.equal(installed.release.schema, "urn:aihq:catalog:release:1.1.0");
const bytes = readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/release-1.1.json")));
const read = readRelease(bytes, { expectedSha256: sha(bytes) });
assert.equal(read.valid, true, JSON.stringify(read.diagnostics));
assert.equal(read.release.sha256, installed.release.sha256);
for (const id of ["urn:aihq:catalog:release:1.1.0", "urn:aihq:core:recipe:1.1.0"]) {
  assert(contractSupport.contracts.some((contract) => contract.id === id), id);
}

const configured = configureItem({
  release: installed.release, itemId: ITEM, configuration: {}, materialSource: installed.source,
});
assert.equal(configured.valid, true, JSON.stringify(configured.diagnostics));
const set = validateSelectionSet({
  releases: { [installed.release.sha256]: installed.release },
  selections: [{
    id: ITEM,
    item: { releaseSha256: configured.provenance.manifestSha256, itemId: ITEM, itemSha256: configured.provenance.itemSha256 },
    configuration: {},
  }],
});
assert.equal(set.valid, true, JSON.stringify(set.diagnostics));

const installedRecipe = JSON.parse(readFileSync(join(root, configured.selection.recipe.reference.path), "utf8"));
const hookOperation = installedRecipe.operations.find((operation) => operation.kind === "hook.group");
const COMMAND = hookOperation.selector.value;
const MATCHER = hookOperation.group.literal.matcher;

/** A second recipe revision of the same item: same group ID and selector, new group content. */
const secondRoot = join(scratch, "catalog-v2");
cpSync(join(root, "release"), join(secondRoot, "release"), { recursive: true });
cpSync(join(root, "package.json"), join(secondRoot, "package.json"));
const secondRecipePath = join(secondRoot, configured.selection.recipe.reference.path);
const second = JSON.parse(readFileSync(secondRecipePath, "utf8"));
second.operations.find((operation) => operation.kind === "hook.group").group.literal.matcher =
  `${MATCHER}|NotebookEdit`;
const secondBytes = Buffer.from(`${canonical(second)}\n`);
writeFileSync(secondRecipePath, secondBytes);
const secondManifestPath = join(secondRoot, "release", "release-1.1.json");
const secondManifest = JSON.parse(readFileSync(secondManifestPath, "utf8"));
const secondItem = secondManifest.items.find((item) => item.id === ITEM);
secondItem.recipe.sha256 = sha(secondBytes);
secondItem.recipe.byteLength = secondBytes.length;
writeFileSync(secondManifestPath, `${canonical(secondManifest)}\n`);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

const secondInstalled = await readInstalledRelease({ root: secondRoot, release: "./release-1.1.json",
  sourceInput: "catalog-v2" });
assert.equal(secondInstalled.valid, true, JSON.stringify(secondInstalled.diagnostics));
const secondConfigured = configureItem({ release: secondInstalled.release, itemId: ITEM,
  configuration: {}, materialSource: secondInstalled.source });
assert.equal(secondConfigured.valid, true, JSON.stringify(secondConfigured.diagnostics));
const secondSet = validateSelectionSet({
  releases: { [secondInstalled.release.sha256]: secondInstalled.release },
  selections: [{ id: ITEM, item: { releaseSha256: secondConfigured.provenance.manifestSha256,
    itemId: ITEM, itemSha256: secondConfigured.provenance.itemSha256 }, configuration: {} }],
});
assert.equal(secondSet.valid, true, JSON.stringify(secondSet.diagnostics));
const controls = { logging: "off", materialRoots: { ...installed.materialRoots, ...secondInstalled.materialRoots } };
const versionData = (number) => number === 1
  ? { configured, set } : { configured: secondConfigured, set: secondSet };
/** The 1.1 policy: members are managed together so an empty set removes the item's content. */
const policy = (members, revision = 1, schema = "urn:aihq:core:execution-policy:1.1.0") => ({
  schema, mode: "vibe",
  managedSelections: [{ id: "hooks", scope: "project", members }],
  selections: members.map((id) => ({ ...versionData(revision).configured.selection,
    id, managementId: id, scope: "project",
    requires: versionData(revision).set.requiresBySelectionId[id] })),
});
const hookOf = (prepared) => prepared.review.operations.find((operation) => operation.kind === "hook.group");
const settingsOf = (project) => join(project, ".claude", "settings.json");
const readSettings = (project) => JSON.parse(readFileSync(settingsOf(project), "utf8"));
const scriptOf = (project) => join(project, ".claude", "hooks", "aihq-protect-env.mjs");
const neighbor = { matcher: "Bash", hooks: [{ type: "command", command: "./neighbor-guard.sh" }] };
const owned = (matcher) => ({ matcher, hooks: [{ type: "command", command: COMMAND }] });
function project(name, settingsText) {
  const dir = join(scratch, name);
  mkdirSync(dir);
  if (settingsText !== undefined) {
    mkdirSync(join(dir, ".claude"));
    writeFileSync(settingsOf(dir), settingsText);
  }
  return dir;
}
const NEIGHBOR_SETTINGS = `${JSON.stringify({
  hooks: { PreToolUse: [neighbor] }, permissions: { allow: ["Bash(ls)"] },
}, null, 2)}\n`;
async function prepareReady(policyDocument, dir) {
  const prepared = await prepare({ useCase: "policy", policy: policyDocument, target: { project: dir } }, controls);
  assert.equal(prepared.status, "ready", JSON.stringify(prepared.diagnostics));
  return prepared;
}
async function applyReady(prepared) {
  const applied = await apply(prepared.prepared, { approved: true, origin: "automation",
    reviewDigest: prepared.review.reviewDigest }, controls);
  assert.equal(applied.completion, "complete", JSON.stringify(applied.diagnostics));
  assert(applied.checks.every((check) => check.status === "passed"));
  return applied;
}

// Add: one bounded group appended beside a pre-existing user group; nothing is written by Prepare.
const dir = project("lifecycle", NEIGHBOR_SETTINGS);
const addPrepared = await prepareReady(policy([ITEM]), dir);
assert.equal(readFileSync(settingsOf(dir), "utf8"), NEIGHBOR_SETTINGS, "Prepare must not write settings.");
assert.equal(existsSync(scriptOf(dir)), false, "Prepare must not write the wrapper.");
const add = hookOf(addPrepared);
assert.equal(add.effects, "replace-file", JSON.stringify(add));
assert.deepEqual(add.details.hookGroup, {
  container: ["hooks", "PreToolUse"], groupId: GROUP,
  selector: { path: ["hooks", 0, "command"], valueSha256: sha(Buffer.from(COMMAND)) },
  action: "set", matchedIndex: null, memberBeforeSha256: null,
  memberAfterSha256: add.details.hookGroup.memberAfterSha256,
  targetBeforeSha256: add.details.hookGroup.targetBeforeSha256, desiredGroup: owned(MATCHER),
});
await applyReady(addPrepared);
let settings = readSettings(dir);
assert.deepEqual(settings.hooks.PreToolUse, [neighbor, owned(MATCHER)]);
assert.deepEqual(settings.permissions, { allow: ["Bash(ls)"] });
assert.equal(sha(readFileSync(scriptOf(dir))),
  configured.selection.recipe.reference.materials.find((m) => m.id === "script").sha256);

// A neighbor inserts a group before ours and edits its own: the owned index moves, the group does not.
const moved = readFileSync(settingsOf(dir), "utf8")
  .replace('"PreToolUse": [', '"PreToolUse": [\n      {"matcher":"Edit","hooks":[{"type":"command","command":"./later.sh"}]},')
  .replace("./neighbor-guard.sh", "./neighbor-guard-v2.sh");
writeFileSync(settingsOf(dir), moved);
const later = { matcher: "Edit", hooks: [{ type: "command", command: "./later.sh" }] };
const neighborV2 = { ...neighbor, hooks: [{ type: "command", command: "./neighbor-guard-v2.sh" }] };

// Update: the same item and group ID with new group content replaces it in place.
const updatePrepared = await prepareReady(policy([ITEM], 2), dir);
const update = hookOf(updatePrepared);
assert.equal(update.effects, "replace-file", JSON.stringify(update));
assert.equal(update.details.hookGroup.matchedIndex, 2);
assert.notEqual(update.details.hookGroup.memberBeforeSha256, update.details.hookGroup.memberAfterSha256);
assert.deepEqual(update.details.hookGroup.desiredGroup, owned(`${MATCHER}|NotebookEdit`));
await applyReady(updatePrepared);
settings = readSettings(dir);
assert.deepEqual(settings.hooks.PreToolUse, [later, neighborV2, owned(`${MATCHER}|NotebookEdit`)]);

// Remove: only the owned group and its wrapper go; both neighbors stay in order.
const removePrepared = await prepareReady(policy([]), dir);
const removal = hookOf(removePrepared);
assert.equal(removal.details.hookGroup.action, "remove", JSON.stringify(removal));
assert.equal(removal.details.hookGroup.desiredGroup, null);
await applyReady(removePrepared);
settings = readSettings(dir);
assert.deepEqual(settings.hooks.PreToolUse, [later, neighborV2]);
assert.deepEqual(settings.permissions, { allow: ["Bash(ls)"] });
assert.equal(existsSync(scriptOf(dir)), false, "The owned wrapper is removed with the group.");

// An identical unowned group is a conflict, never silent adoption; nothing is written.
const unowned = `${JSON.stringify({ hooks: { PreToolUse: [owned(MATCHER)] } }, null, 2)}\n`;
const clash = project("unowned-selector", unowned);
const clashed = await prepare({ useCase: "policy", policy: policy([ITEM]), target: { project: clash } }, controls);
assert.notEqual(clashed.status, "ready");
assert(clashed.review.operations.some((operation) => operation.effects === "conflict"), JSON.stringify(clashed.diagnostics));
assert.equal(readFileSync(settingsOf(clash), "utf8"), unowned);

// A neighbor edit after Prepare invalidates the review; Apply writes nothing.
const stale = project("stale", NEIGHBOR_SETTINGS);
const stalePrepared = await prepareReady(policy([ITEM]), stale);
const edited = NEIGHBOR_SETTINGS.replace("Bash(ls)", "Bash(pwd)");
writeFileSync(settingsOf(stale), edited);
const rejected = await apply(stalePrepared.prepared, { approved: true, origin: "automation",
  reviewDigest: stalePrepared.review.reviewDigest }, controls);
assert.notEqual(rejected.completion, "complete", JSON.stringify(rejected.diagnostics));
assert.equal(readFileSync(settingsOf(stale), "utf8"), edited);
assert.equal(existsSync(scriptOf(stale)), false);

// A 1.0 policy cannot carry the 1.1 recipe: unsupported, before any write.
const old = project("policy-1-0", NEIGHBOR_SETTINGS);
const oldPrepared = await prepare({ useCase: "policy",
  policy: policy([ITEM], 1, "urn:aihq:core:execution-policy:1.0.0"), target: { project: old } }, controls);
assert.notEqual(oldPrepared.status, "ready", "A 1.0 policy must not prepare a 1.1 recipe.");
assert.equal(readFileSync(settingsOf(old), "utf8"), NEIGHBOR_SETTINGS);
assert.equal(existsSync(scriptOf(old)), false);

// The packed CLI follows the same contract: add, then remove, with the neighbor untouched.
const cliRoot = project("cli", NEIGHBOR_SETTINGS);
const cliHome = join(scratch, "cli-home");
mkdirSync(cliHome);
const cliPolicy = (members) => {
  const path = join(scratch, `cli-policy-${members.length}.json`);
  writeFileSync(path, JSON.stringify(policy(members)));
  return path;
};
const aih = join(here, "node_modules", "@aihq", "core", "dist", "core", "cli.js");
const cli = (args) => JSON.parse(execFileSync(process.execPath, [aih, ...args, "--json", "--no-log"], {
  env: { ...process.env, HOME: cliHome, USERPROFILE: cliHome }, encoding: "utf8",
}));
const common = ["--project", cliRoot, "--material-root", `catalog=${installed.materialRoots.catalog}`];
const dry = cli(["policy", cliPolicy([ITEM]), ...common]);
assert.equal(readFileSync(settingsOf(cliRoot), "utf8"), NEIGHBOR_SETTINGS, "The CLI previews without writing.");
assert(JSON.stringify(dry).includes("hook.group"), "The CLI review shows the hook group operation.");
cli(["policy", cliPolicy([ITEM]), ...common, "--apply", "--yes"]);
assert.deepEqual(readSettings(cliRoot).hooks.PreToolUse, [neighbor, owned(MATCHER)]);
cli(["policy", cliPolicy([]), ...common, "--apply", "--yes"]);
assert.deepEqual(readSettings(cliRoot).hooks.PreToolUse, [neighbor]);

console.log(JSON.stringify({
  status: "passed", releaseSha256: installed.release.sha256, item: ITEM,
  addUpdateRemoveWithNeighbors: true, indexMovedOwnedUpdated: true, unownedSelectorConflict: true,
  neighborEditAfterPrepareRejected: true, policy10Refused: true, cli: "add-remove",
}));
