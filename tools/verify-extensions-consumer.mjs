// One outside packed public consumer; all writes are disposable and no hook is executed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const evidenceIndex = args.indexOf("--evidence");
const evidence = evidenceIndex < 0 ? undefined : resolve(args.splice(evidenceIndex, 2)[1]);
const withoutCore = args[0] === "--without-core";
if (withoutCore) args.shift();
assert(args.length <= (withoutCore ? 1 : 2) && (withoutCore || args[0]), "Usage: node tools/verify-extensions-consumer.mjs <core.tgz>|--without-core [catalog.tgz] [--evidence directory]");
const core = withoutCore ? undefined : resolve(args.shift());
const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-extensions-"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const npm = [process.env.npm_execpath, resolve(process.execPath, "..", "node_modules/npm/bin/npm-cli.js"), resolve(process.execPath, "../..", "lib/node_modules/npm/bin/npm-cli.js")].find(path => path && isAbsolute(path) && basename(path) === "npm-cli.js" && existsSync(path));
assert(npm, "Adjacent npm-cli.js is required");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"));
const runNpm = (args, cwd) => execFileSync(process.execPath, [npm, ...args], { cwd, env, encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
try {
  const archive = args[0] ? resolve(args[0]) : join(fixture, JSON.parse(runNpm(["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", fixture], root))[0].filename);
  const archiveSha256 = sha(readFileSync(archive));
  const coreSha256 = core ? sha(readFileSync(core)) : undefined;
  const consumer = join(fixture, "consumer");
  seedConsumerLock(consumer, root);
  runNpm(["install", "--prefix", consumer, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", archive, ...(core ? [core] : [])], fixture);
  writeFileSync(join(consumer, "consume.mjs"), String.raw`
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileProducerDeclaration, checkProducerDeclaration } from "@aihq/catalog/producer";
import { configureItem, readRelease, resolveSelections, validateSelectionSet } from "@aihq/catalog/reader";
import { readInstalledRelease, resolveRelease } from "@aihq/catalog/node";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const bytes = readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/release-extensions.json")));
const installed = await readInstalledRelease({ root, release: "./release-extensions.json" });
assert.equal(installed.valid, true, JSON.stringify(installed.diagnostics));
assert.equal(installed.release.sha256, sha(bytes));
const declaration = JSON.parse(readFileSync(join(root, "producer/extensions/declaration.json")));
const snapshot = JSON.parse(readFileSync(join(root, "producer/extensions/snapshot.json")));
const inventory = JSON.parse(readFileSync(join(root, "producer/extensions/inventory.json")));
assert.equal(checkProducerDeclaration(declaration).status, "ok");
const sourceFiles = snapshot.sources.map(source => ({ source: source.id, revision: source.revision, files: {
 ...Object.fromEntries(source.files.map(file => [file.path, new Uint8Array(Buffer.from(file.base64, "base64"))])),
 ...Object.fromEntries(Object.entries(snapshot.recipes[source.id]).map(([path, text]) => [path, new TextEncoder().encode(text)])),
}}));
const compiled = compileProducerDeclaration({ declaration, sourceFiles });
assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics));
assert.equal(compiled.value.releaseSha256, installed.release.sha256);
assert.equal(inventory.entries.length, 202);
for (const item of installed.release.items) {
 const configured = configureItem({ release: installed.release, itemId: item.id, configuration: item.id.startsWith("extensions.claude.hook.") ? { hookCommand: "node reviewed-project-hook.mjs" } : {}, materialSource: installed.source });
 assert.equal(configured.valid, true, JSON.stringify(configured.diagnostics));
}
const project = join(dirname(fileURLToPath(import.meta.url)), "project");
mkdirSync(project);
const neighbor = { matcher: "Bash", hooks: [{ type: "command", command: "echo untouched-neighbor" }] };
mkdirSync(join(project, ".claude"));
writeFileSync(join(project, ".claude/settings.json"), JSON.stringify({ hooks: { PreToolUse: [neighbor] }, permissions: { allow: ["Bash(ls)"] } }));
const command = name => 'node "' + join(project, ".aih-extensions/source/hooks/" + name + ".mjs") + '"';
const roots = ["extensions.command.webperf", "extensions.skill.idea-refine", "extensions.kiro.skill.security-and-hardening", "extensions.copilot.skill.security-and-hardening", ...["git-guard", "skill-guard", "lanes-card"].map(name => "extensions.claude.hook." + name)].map(itemId => ({ releaseSha256: installed.release.sha256, itemId, scope: "project", configuration: itemId.startsWith("extensions.claude.hook.") ? { hookCommand: command(itemId.split(".").at(-1)) } : {} }));
const releases = { [installed.release.sha256]: installed.release };
const resolved = resolveSelections({ releases, roots, skips: [] });
assert.equal(resolved.status, "ok", JSON.stringify(resolved.diagnostics));
const validated = validateSelectionSet({ releases, selections: resolved.value.selections });
assert.equal(validated.valid, true, JSON.stringify(validated.diagnostics));
for (const name of ["git-guard", "skill-guard", "lanes-card"]) {
 assert.equal(configureItem({ release: installed.release, itemId: "extensions.claude.hook." + name, configuration: {}, materialSource: installed.source }).valid, false);
}
const selections = resolved.value.selections.map(selection => {
 const configured = configureItem({ release: installed.release, itemId: selection.item.itemId, configuration: selection.configuration, materialSource: installed.source });
 assert.equal(configured.valid, true);
 return { ...configured.selection, id: selection.id, managementId: selection.id, scope: "project", requires: validated.requiresBySelectionId[selection.id] };
});
// The caller holds exact artifact integrity; archive acquisition performs no script execution.
const archiveBytes = readFileSync(process.argv[2]);
const archive = { url: "https://example.invalid/catalog-extensions.tgz", sha256: sha(archiveBytes), byteLength: archiveBytes.length };
const acquired = await resolveRelease({ archive, release: "./release-extensions.json" }, { fetch: async url => { assert.equal(String(url), archive.url); return new Response(archiveBytes); } });
assert.equal(acquired.valid, true, JSON.stringify(acquired.diagnostics));
assert.equal(acquired.release.sha256, installed.release.sha256);
// Compatible expansion is an extra declaration and recipe over the same real pinned bytes.
const expanded = structuredClone(declaration);
const original = expanded.items.find(item => item.id === "extensions.skill.security-and-hardening");
const extra = structuredClone(original);
extra.id = "extensions.extra.security-reference";
extra.label = "Additional independently selected security reference";
extra.recipePath = "catalog-recipes/extra-security-reference.json";
const extraRecipe = JSON.parse(snapshot.recipes.extensions[original.recipePath]);
extraRecipe.id = extra.id;
for (const step of [...extraRecipe.operations, ...extraRecipe.checks]) step.target.segments.unshift({ literal: "additional-reference" });
expanded.items.push(extra);
const extraSources = sourceFiles.map(source => source.source === "extensions" ? { ...source, files: { ...source.files, [extra.recipePath]: new TextEncoder().encode(JSON.stringify(extraRecipe)) } } : source);
const expansion = compileProducerDeclaration({ declaration: expanded, sourceFiles: extraSources });
assert.equal(expansion.status, "ok", JSON.stringify(expansion.diagnostics));
const extraRelease = readRelease(expansion.value.releaseBytes, { expectedSha256: expansion.value.releaseSha256 });
assert.equal(extraRelease.valid, true);
const extraResolution = resolveSelections({ releases: { [extraRelease.release.sha256]: extraRelease.release }, roots: [{ releaseSha256: extraRelease.release.sha256, itemId: extra.id, scope: "project", configuration: {} }], skips: [] });
assert.equal(extraResolution.status, "ok");
let core = { status: "not-run", reason: "No reviewed Core artifact supplied; packed public reader/compiler/resolver checks only." };
if (process.argv[3] === "core") {
 const { prepare, apply } = await import("@aihq/core");
 const controls = { logging: "off", materialRoots: installed.materialRoots };
 const policy = { schema: "urn:aihq:core:execution-policy:1.3.0", mode: "vibe", managedSelections: [{ id: "extensions-fixture", scope: "project", members: selections.map(selection => selection.id) }], selections };
 const prepared = await prepare({ useCase: "policy", policy, target: { project } }, controls);
 assert.equal(prepared.status, "ready", JSON.stringify(prepared.diagnostics));
 assert.deepEqual(JSON.parse(readFileSync(join(project, ".claude/settings.json"))).hooks.PreToolUse, [neighbor], "Prepare leaves neighboring settings intact");
 const applied = await apply(prepared.prepared, { approved: true, origin: "automation", reviewDigest: prepared.review.reviewDigest }, controls);
 assert.equal(applied.completion, "complete", JSON.stringify(applied.diagnostics));
 for (const operation of prepared.review.operations) if (operation.kind === "file.write" && operation.details.materialSha256) assert.equal(sha(readFileSync(operation.details.target)), operation.details.materialSha256);
 const settings = JSON.parse(readFileSync(join(project, ".claude/settings.json")));
 assert.deepEqual(settings.hooks.PreToolUse[0], neighbor);
 assert(settings.hooks.PreToolUse.some(group => group.hooks[0].command === command("git-guard")));
 assert(settings.hooks.PreToolUse.some(group => group.hooks[0].command === command("skill-guard")));
 assert(settings.hooks.SessionStart.some(group => group.hooks[0].command === command("lanes-card")));
 assert.deepEqual(settings.permissions, { allow: ["Bash(ls)"] });
 const empty = { ...policy, selections: [], managedSelections: [{ id: "extensions-fixture", scope: "project", members: [] }] };
 const removal = await prepare({ useCase: "policy", policy: empty, target: { project } }, controls);
 let removalResult;
 if (removal.status === "ready") {
  const removed = await apply(removal.prepared, { approved: true, origin: "automation", reviewDigest: removal.review.reviewDigest }, controls);
  assert.equal(removed.completion, "complete", JSON.stringify(removed.diagnostics));
  const after = JSON.parse(readFileSync(join(project, ".claude/settings.json")));
  assert.deepEqual(after.hooks.PreToolUse, [neighbor]);
  assert.deepEqual(after.permissions, { allow: ["Bash(ls)"] });
  removalResult = { status: "complete" };
 } else {
  assert(removal.diagnostics.some(diagnostic => diagnostic.reason === "managed-content-changed"), JSON.stringify(removal.diagnostics));
  removalResult = { status: "refused", diagnostics: removal.diagnostics, reason: "Reviewed Core artifact refuses clean multi-hook removal; custody preserved, no removal Apply attempted." };
 }
 core = { status: "applied", appliedChecks: applied.checks.length, removal: removalResult, neighboringSettings: "preserved", hookExecution: "not-run" };
}
const receipt = { installedReleaseSha256: installed.release.sha256, inventory: Object.fromEntries(snapshot.sources.map(source => [source.id, source.files.length])), items: installed.release.items.length, selected: resolved.value.selections.map(selection => selection.item.itemId), sourcePins: snapshot.sources.map(source => ({ source: source.id, revision: source.revision })), expansion: { itemId: extra.id, releaseSha256: expansion.value.releaseSha256 }, core, consumerSha256: sha(readFileSync(fileURLToPath(import.meta.url))) };
writeFileSync("receipt.json", JSON.stringify(receipt, null, 2) + "\n");
`);
  execFileSync(process.execPath, [join(consumer, "consume.mjs"), archive, ...(core ? ["core"] : [])], { cwd: consumer, env, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  const receipt = { archiveSha256, ...(core ? { coreSha256 } : {}), ...JSON.parse(readFileSync(join(consumer, "receipt.json"))) };
  assert.equal(sha(readFileSync(archive)), archiveSha256);
  if (core) assert.equal(sha(readFileSync(core)), coreSha256);
  if (evidence) {
    mkdirSync(evidence, { recursive: true }); cpSync(archive, join(evidence, basename(archive)));
    cpSync(consumer, join(evidence, "consumer"), { recursive: true });
    writeFileSync(join(evidence, "packed-extensions-consumer.json"), JSON.stringify(receipt, null, 2) + "\n");
  }
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  if (evidence) { mkdirSync(evidence, { recursive: true }); cpSync(fixture, join(evidence, "failed-fixture"), { recursive: true }); }
  throw error;
} finally { rmSync(fixture, { recursive: true, force: true }); }
