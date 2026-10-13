// Copied into an outside consumer; only public package interfaces are imported.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkProducerDeclaration, compileProducerDeclaration } from "@aihq/catalog/producer";
import { configureItem, readRelease, resolveSelections, validateSelectionSet } from "@aihq/catalog/reader";
import { readInstalledRelease, resolveRelease } from "@aihq/catalog/node";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const releaseBytes = readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/release-superpowers.json")));
const installed = await readInstalledRelease({ root, release: "./release-superpowers.json" });
assert.equal(installed.valid, true, JSON.stringify(installed.diagnostics));
assert.equal(installed.release.sha256, sha(releaseBytes));
const extensions = await readInstalledRelease({ root, release: "./release-extensions.json" });
assert.equal(extensions.valid, true, JSON.stringify(extensions.diagnostics));
const declaration = JSON.parse(readFileSync(join(root, "producer/superpowers/declaration.json")));
const snapshot = JSON.parse(readFileSync(join(root, "producer/superpowers/snapshot.json")));
const inventory = JSON.parse(readFileSync(join(root, "producer/superpowers/inventory.json")));
assert.equal(checkProducerDeclaration(declaration).status, "ok");
assert.equal(inventory.entries.length, 231);
assert.equal(inventory.donor.assets.length, 16);
assert.equal(inventory.gitTree, "3c7f2d3ef243f88d3394158983e6845e313c438b");
const sourceFiles = snapshot.sources.map(source => ({source: source.id, revision: source.revision, files: {
  ...Object.fromEntries(source.files.map(file => [file.path, new Uint8Array(Buffer.from(file.base64, "base64"))])),
  ...Object.fromEntries(Object.entries(snapshot.recipes[source.id]).map(([path, text]) => [path, new TextEncoder().encode(text)])),
}}));
const compiled = compileProducerDeclaration({declaration, sourceFiles});
assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics));
assert.equal(compiled.value.releaseSha256, installed.release.sha256);
for (const file of compiled.value.materials) assert.equal(sha(readFileSync(join(root, file.path))), file.sha256);
const project = join(dirname(fileURLToPath(import.meta.url)), "project");
mkdirSync(project);
const command = `CLAUDE_PLUGIN_ROOT='${project.replaceAll("'", "'\\''")}/.superpowers-source' bash '${project.replaceAll("'", "'\\''")}/.superpowers-source/hooks/run-hook.cmd' session-start`;
const configuration = id => id === "superpowers.claude.hook.session-start" ? {hookCommand: command} : {};
// All items configure, but no automatic hook command is invented.
for (const item of installed.release.items) {
  const configured = configureItem({release: installed.release, itemId: item.id, configuration: configuration(item.id), materialSource: installed.source});
  assert.equal(configured.valid, true, `${item.id}: ${JSON.stringify(configured.diagnostics)}`);
}
assert.equal(configureItem({release: installed.release, itemId: "superpowers.claude.hook.session-start", configuration: {}, materialSource: installed.source}).valid, false);
const releases = {[installed.release.sha256]: installed.release, [extensions.release.sha256]: extensions.release};
const roots = ["superpowers.template.reviewed-tdd", "superpowers.kiro.skill.test-driven-development", "superpowers.copilot.skill.test-driven-development"].map(itemId => ({releaseSha256: installed.release.sha256, itemId, scope: "project", configuration: {}}));
const hookRef = {releaseSha256: installed.release.sha256, itemId: "superpowers.claude.hook.session-start", scope: "project"};
const resolved = resolveSelections({releases, roots, skips: [hookRef]});
assert.equal(resolved.status, "ok", JSON.stringify(resolved.diagnostics));
const mixedSelections = resolved.value.selections.map(selection => selection.item.itemId);
assert(mixedSelections.includes("extensions.skill.security-and-hardening"));
assert(mixedSelections.includes("superpowers.skill.test-driven-development"));
assert(mixedSelections.includes("superpowers.notices"));
assert(!mixedSelections.includes(hookRef.itemId));
assert(resolved.value.optional.some(entry => entry.to.itemId === hookRef.itemId && entry.skipped));
const required = {releaseSha256: installed.release.sha256, itemId: "superpowers.skill.test-driven-development", scope: "project"};
const refused = resolveSelections({releases, roots, skips: [required]});
assert.equal(refused.status, "refused");
assert(refused.diagnostics.some(diagnostic => diagnostic.code === "REQUIRED_ITEM_SKIPPED"));
const removal = resolveSelections({releases, roots, skips: [], remove: [required]});
assert.equal(removal.status, "ok");
assert(removal.value.removalImpact.some(impact => impact.affectedRoots.some(root => root.itemId === "superpowers.template.reviewed-tdd")));
const optedIn = resolveSelections({releases, roots: [...roots, {...hookRef, configuration: configuration(hookRef.itemId)}], skips: []});
assert.equal(optedIn.status, "ok", JSON.stringify(optedIn.diagnostics));
const validated = validateSelectionSet({releases, selections: optedIn.value.selections});
assert.equal(validated.valid, true, JSON.stringify(validated.diagnostics));
const selections = optedIn.value.selections.map(selection => {
  const configured = configureItem({release: releases[selection.item.releaseSha256], itemId: selection.item.itemId, configuration: selection.configuration, materialSource: installed.source});
  assert.equal(configured.valid, true);
  return {...configured.selection, id: selection.id, managementId: selection.id, scope: "project", requires: validated.requiresBySelectionId[selection.id]};
});
// The installed public release must include each maintained unconditional Finish step.
const workflowClosures = [];
for (const prefix of ["superpowers.skill", "superpowers.kiro.skill", "superpowers.copilot.skill"]) {
  for (const workflow of ["executing-plans", "subagent-driven-development"]) {
    const root = {releaseSha256: installed.release.sha256, itemId: `${prefix}.${workflow}`, scope: "project", configuration: {}};
    const finishing = {releaseSha256: installed.release.sha256, itemId: `${prefix}.finishing-a-development-branch`, scope: "project"};
    const closure = resolveSelections({releases, roots: [root], skips: []});
    assert.equal(closure.status, "ok", JSON.stringify(closure.diagnostics));
    const ids = closure.value.selections.map(selection => selection.item.itemId);
    assert(ids.includes(finishing.itemId));
    const skipped = resolveSelections({releases, roots: [root], skips: [finishing]});
    assert.equal(skipped.status, "refused");
    assert(skipped.diagnostics.some(diagnostic => diagnostic.code === "REQUIRED_ITEM_SKIPPED"));
    workflowClosures.push({root: root.itemId, requiredFinishing: finishing.itemId, selections: ids});
  }
}
const archiveBytes = readFileSync(process.argv[2]);
const archive = {url: "https://example.invalid/catalog-superpowers.tgz", sha256: sha(archiveBytes), byteLength: archiveBytes.length};
const acquired = await resolveRelease({archive, release: "./release-superpowers.json"}, {fetch: async url => { assert.equal(String(url), archive.url); return new Response(archiveBytes); }});
assert.equal(acquired.valid, true, JSON.stringify(acquired.diagnostics));
assert.equal(acquired.release.sha256, installed.release.sha256);
// One extra projection of real source, with unchanged producer/reader/consumer code.
const expanded = structuredClone(declaration);
const original = expanded.items.find(item => item.id === "superpowers.skill.test-driven-development");
const extra = structuredClone(original);
extra.id = "superpowers.extra.tdd-reference"; extra.label = "Additional real TDD reference";
extra.recipePath = "catalog-recipes/extra-tdd-reference.json";
const recipe = JSON.parse(snapshot.recipes.superpowers[original.recipePath]);
recipe.id = extra.id;
for (const step of [...recipe.operations, ...recipe.checks]) step.target.segments.unshift({literal: "additional-reference"});
expanded.items.push(extra);
const expansion = compileProducerDeclaration({declaration: expanded, sourceFiles: sourceFiles.map(source => ({...source, files: {...source.files, [extra.recipePath]: new TextEncoder().encode(JSON.stringify(recipe))}}))});
assert.equal(expansion.status, "ok", JSON.stringify(expansion.diagnostics));
const checked = readRelease(expansion.value.releaseBytes, {expectedSha256: expansion.value.releaseSha256});
assert.equal(checked.valid, true);
assert.equal(resolveSelections({releases: {[checked.release.sha256]: checked.release}, roots: [{releaseSha256: checked.release.sha256, itemId: extra.id, scope: "project", configuration: {}}], skips: []}).status, "ok");
mkdirSync(join(project, ".claude"));
const neighbor = {matcher: "startup", hooks: [{type: "command", command: "existing-neighbor-hook"}]};
writeFileSync(join(project, ".claude/settings.json"), JSON.stringify({hooks: {SessionStart: [neighbor]}, unrelated: true}));
let core = {status: "not-run", reason: "No Core artifact supplied; public declaration/reader/resolver/configuration only."};
if (process.argv[3] === "core") {
  const {prepare, apply} = await import("@aihq/core");
  const controls = {logging: "off", materialRoots: installed.materialRoots};
  const policy = {schema: "urn:aihq:core:execution-policy:1.3.0", mode: "vibe", managedSelections: [{id: "superpowers-fixture", scope: "project", members: selections.map(selection => selection.id)}], selections};
  const prepared = await prepare({useCase: "policy", policy, target: {project}}, controls);
  assert.equal(prepared.status, "ready", JSON.stringify(prepared.diagnostics));
  assert.deepEqual(JSON.parse(readFileSync(join(project, ".claude/settings.json"))).hooks.SessionStart, [neighbor]);
  const applied = await apply(prepared.prepared, {approved: true, origin: "automation", reviewDigest: prepared.review.reviewDigest}, controls);
  assert.equal(applied.completion, "complete", JSON.stringify(applied.diagnostics));
  const settings = JSON.parse(readFileSync(join(project, ".claude/settings.json")));
  assert.deepEqual(settings.hooks.SessionStart[0], neighbor);
  assert.equal(settings.unrelated, true);
  assert(settings.hooks.SessionStart.some(group => group.matcher === "startup|clear|compact" && group.hooks[0].command === command && group.hooks[0].shell === "bash" && group.hooks[0].async === false));
  const tdd = sourceFiles[0].files["skills/test-driven-development/SKILL.md"];
  for (const path of [".claude/skills/test-driven-development/SKILL.md", ".kiro/skills/test-driven-development/SKILL.md", ".github/skills/test-driven-development/SKILL.md"]) assert.equal(sha(readFileSync(join(project, path))), sha(tdd));
  for (const operation of prepared.review.operations) if (operation.kind === "file.write" && operation.details.materialSha256) assert.equal(sha(readFileSync(operation.details.target)), operation.details.materialSha256);
  core = {status: "complete", prepared: prepared.status, applied: applied.completion, operations: prepared.review.operations.length, nativeExecution: "not-run"};
}
const member = installed.release.items.find(item => item.id === original.id).materials.find(member => member.path.endsWith("SKILL.md"));
const originalBytes = readFileSync(join(root, member.path));
try {writeFileSync(join(root, member.path), "changed selected material"); assert.equal((await readInstalledRelease({root, release: "./release-superpowers.json"})).valid, false);}
finally {writeFileSync(join(root, member.path), originalBytes);}
const receipt = {package: installed.release.package, releaseSha256: installed.release.sha256, extensionsReleaseSha256: extensions.release.sha256, declarationSha256: sha(readFileSync(join(root, "producer/superpowers/declaration.json"))), snapshotSha256: sha(readFileSync(join(root, "producer/superpowers/snapshot.json"))), inventorySha256: sha(readFileSync(join(root, "producer/superpowers/inventory.json"))), source: {repository: inventory.repository, revision: inventory.revision, gitTree: inventory.gitTree}, inventory: {files: inventory.entries.length, donorAssets: inventory.donor.assets.length}, items: installed.release.items.length, mixedSelections, workflowClosures, expansion: {itemId: extra.id, releaseSha256: expansion.value.releaseSha256}, core, consumerSha256: sha(readFileSync(fileURLToPath(import.meta.url)))};
writeFileSync("receipt.json", JSON.stringify(receipt, null, 2)+"\n");
