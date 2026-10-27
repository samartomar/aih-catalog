// Copied into an outside installed consumer by verify-ecc-consumer.mjs.
// All product operations below use package public exports only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileProducerDeclaration, checkProducerDeclaration } from "@aihq/catalog/producer";
import { configureItem, readRelease, resolveSelections, validateSelectionSet } from "@aihq/catalog/reader";
import { readInstalledRelease, resolveRelease } from "@aihq/catalog/node";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const releaseBytes = readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/release-ecc.json")));
const installed = await readInstalledRelease({ root, release: "./release-ecc.json" });
assert.equal(installed.valid, true, JSON.stringify(installed.diagnostics));
assert.equal(installed.release.sha256, sha(releaseBytes));
const extension = await readInstalledRelease({ root, release: "./release-extensions.json" });
assert.equal(extension.valid, true, JSON.stringify(extension.diagnostics));
const declaration = JSON.parse(readFileSync(join(root, "producer/ecc/declaration.json")));
const snapshot = JSON.parse(readFileSync(join(root, "producer/ecc/snapshot.json")));
const inventory = JSON.parse(readFileSync(join(root, "producer/ecc/inventory.json")));
assert.equal(checkProducerDeclaration(declaration).status, "ok");
const sourceFiles = snapshot.sources.map(source => ({ source: source.id, revision: source.revision, files: {
  ...Object.fromEntries(source.files.map(file => [file.path, new Uint8Array(Buffer.from(file.base64, "base64"))])),
  ...Object.fromEntries(Object.entries(snapshot.recipes[source.id]).map(([path, text]) => [path, new TextEncoder().encode(text)])),
}}));
const compiled = compileProducerDeclaration({ declaration, sourceFiles });
assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics));
assert.equal(compiled.value.releaseSha256, installed.release.sha256);
for (const file of compiled.value.materials) assert.equal(sha(readFileSync(join(root, file.path))), file.sha256);
assert.equal(inventory.entries.length, 3538);
assert.equal(inventory.donor.assets.length, 442);
assert.equal(inventory.gitTree, "9d448bb479cc1af55c488357556ac24d8cd932d2");
for (const item of installed.release.items) {
  const configuration = item.inputs.npmCli ? { npmCli: "/fixture/npm12/npm-cli.js", npmCache: "/fixture/npm-cache" } : {};
  const configured = configureItem({ release: installed.release, itemId: item.id, configuration, materialSource: installed.source });
  assert.equal(configured.valid, true, `${item.id}: ${JSON.stringify(configured.diagnostics)}`);
}
const releases = { [installed.release.sha256]: installed.release, [extension.release.sha256]: extension.release };
const roots = ["ecc.template.api-review", "ecc.claude.mcp.memory", ...(process.argv[3] === "core" ? [] : ["ecc.claude.mcp.evalview"]), "ecc.copilot.skill.api-design", "ecc.kiro.skill.api-design"].map(itemId => ({ releaseSha256: installed.release.sha256, itemId, scope: "project", configuration: itemId === "ecc.claude.mcp.memory" ? { npmCli: process.argv[4] ?? "/fixture/npm12/npm-cli.js", npmCache: process.argv[5] ?? "/fixture/npm-cache", acquisitionMode: "--offline" } : {} }));
const skipped = { releaseSha256: installed.release.sha256, itemId: "ecc.agent.code-reviewer", scope: "project" };
const resolved = resolveSelections({ releases, roots, skips: [skipped] });
assert.equal(resolved.status, "ok", JSON.stringify(resolved.diagnostics));
const mixedSelections = resolved.value.selections.map(selection => selection.item.itemId);
assert(mixedSelections.includes("extensions.skill.security-and-hardening"));
assert(mixedSelections.includes("ecc.skill.api-design"));
assert(mixedSelections.includes("ecc.notices"));
assert(!mixedSelections.includes("ecc.agent.code-reviewer"));
assert(resolved.value.optional.some(entry => entry.to.itemId === "ecc.agent.code-reviewer" && entry.skipped));
const required = { releaseSha256: installed.release.sha256, itemId: "ecc.skill.api-design", scope: "project" };
assert.equal(resolveSelections({ releases, roots, skips: [required] }).status, "refused");
const removal = resolveSelections({ releases, roots, skips: [], remove: [required] });
assert.equal(removal.status, "ok");
assert(removal.value.removalImpact.some(impact => impact.affectedRoots.some(root => root.itemId === "ecc.template.api-review")));
const validated = validateSelectionSet({ releases, selections: resolved.value.selections });
assert.equal(validated.valid, true, JSON.stringify(validated.diagnostics));
const selections = resolved.value.selections.map(selection => {
  const configured = configureItem({ release: releases[selection.item.releaseSha256], itemId: selection.item.itemId, configuration: selection.configuration, materialSource: installed.source });
  assert.equal(configured.valid, true);
  return { ...configured.selection, id: selection.id, managementId: selection.id, scope: "project", requires: validated.requiresBySelectionId[selection.id] };
});
const memory = JSON.parse(snapshot.recipes.ecc[declaration.items.find(item => item.id === "ecc.claude.mcp.memory").recipePath]);
assert.deepEqual(memory.prerequisites, [{ kind: "executable", name: "node" }]);
assert.equal(memory.operations.find(op => op.kind === "config.entries").entries[0].value.literal.command, "node");
assert.equal(memory.operations.find(op => op.id === "acquire-server").kind, "process.run");
const github = inventory.itemFacts["ecc.claude.mcp.github"];
assert.deepEqual(github.requiredHostEnvironment, []);
assert.equal(github.offeredServer.url, "https://api.githubcopilot.com/mcp/readonly");
assert.equal(inventory.itemFacts["ecc.claude.mcp.github-local"].offeredServer.env.GITHUB_PERSONAL_ACCESS_TOKEN, "${GITHUB_PERSONAL_ACCESS_TOKEN}");
const archiveBytes = readFileSync(process.argv[2]);
const archive = { url: "https://example.invalid/catalog-ecc.tgz", sha256: sha(archiveBytes), byteLength: archiveBytes.length };
const acquired = await resolveRelease({ archive, release: "./release-ecc.json" }, { fetch: async url => { assert.equal(String(url), archive.url); return new Response(archiveBytes); } });
assert.equal(acquired.valid, true, JSON.stringify(acquired.diagnostics));
assert.equal(acquired.release.sha256, installed.release.sha256);
// Expansion projects one additional real item without changing generic contracts.
const expanded = structuredClone(declaration);
const original = expanded.items.find(item => item.id === "ecc.skill.api-design");
const extra = structuredClone(original);
extra.id = "ecc.extra.api-reference";
extra.label = "Additional selected API design reference";
extra.recipePath = "catalog-recipes/extra-api-reference.json";
const recipe = JSON.parse(snapshot.recipes.ecc[original.recipePath]);
recipe.id = extra.id;
for (const step of [...recipe.operations, ...recipe.checks]) step.target.segments.unshift({ literal: "additional-reference" });
expanded.items.push(extra);
const extraSources = sourceFiles.map(source => ({ ...source, files: { ...source.files, [extra.recipePath]: new TextEncoder().encode(JSON.stringify(recipe)) } }));
const expansion = compileProducerDeclaration({ declaration: expanded, sourceFiles: extraSources });
assert.equal(expansion.status, "ok", JSON.stringify(expansion.diagnostics));
const checkedExpansion = readRelease(expansion.value.releaseBytes, { expectedSha256: expansion.value.releaseSha256 });
assert.equal(checkedExpansion.valid, true);
assert.equal(resolveSelections({ releases: { [checkedExpansion.release.sha256]: checkedExpansion.release }, roots: [{ releaseSha256: checkedExpansion.release.sha256, itemId: extra.id, scope: "project", configuration: {} }], skips: [] }).status, "ok");
const project = join(dirname(fileURLToPath(import.meta.url)), "project");
mkdirSync(project);
const neighbor = { command: "already-present", args: ["untouched"] };
writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { neighbor }, unrelated: true }));
let core = { status: "not-run", reason: "No Core artifact supplied; public declaration/reader/resolver/configuration only." };
if (process.argv[3] === "core") {
  const { prepare, apply } = await import("@aihq/core");
  const controls = { logging: "off", materialRoots: installed.materialRoots };
  const policy = { schema: "urn:aihq:core:execution-policy:1.3.0", mode: "vibe", managedSelections: [{ id: "ecc-fixture", scope: "project", members: selections.map(selection => selection.id) }], selections };
  const prepared = await prepare({ useCase: "policy", policy, target: { project } }, controls);
  assert.equal(prepared.status, "ready", JSON.stringify(prepared.diagnostics));
  assert.deepEqual(JSON.parse(readFileSync(join(project, ".mcp.json"))).mcpServers, { neighbor });
  const unapproved = await apply(prepared.prepared, { approved: false, origin: "automation", reviewDigest: prepared.review.reviewDigest }, controls);
  assert(unapproved.diagnostics.some(diagnostic => diagnostic.code === "APPROVAL_REQUIRED"));
  assert.deepEqual(JSON.parse(readFileSync(join(project, ".mcp.json"))).mcpServers, { neighbor });
  assert(!existsSync(join(project, ".aihq/ecc/source/ecc.claude.mcp.memory/runtime")));
  const applied = await apply(prepared.prepared, { approved: true, origin: "automation", reviewDigest: prepared.review.reviewDigest }, controls);
  assert.equal(applied.completion, "complete", JSON.stringify(applied.diagnostics));
  const settings = JSON.parse(readFileSync(join(project, ".mcp.json")));
  assert.deepEqual(settings.mcpServers.neighbor, neighbor);
  assert.equal(settings.unrelated, true);
  assert.equal(settings.mcpServers.memory.command, "node");
  assert.equal(settings.mcpServers.memory.env.MEMORY_FILE_PATH, "${MEMORY_FILE_PATH}");
  const installedMemory = JSON.parse(readFileSync(join(project, ".aihq/ecc/source/ecc.claude.mcp.memory/runtime/node_modules/@modelcontextprotocol/server-memory/package.json")));
  assert.equal(installedMemory.version, "2.0.0");
  for (const path of [".claude/skills/api-design/SKILL.md", ".github/skills/api-design/SKILL.md", ".kiro/skills/api-design/SKILL.md"]) assert(readFileSync(join(project, path)).length > 100);
  for (const operation of prepared.review.operations) if (operation.kind === "file.write" && operation.details.materialSha256) assert.equal(sha(readFileSync(operation.details.target)), operation.details.materialSha256);
  core = { status: "complete", prepared: prepared.status, applied: applied.completion, operations: prepared.review.operations.length, nativeExecution: "not-run" };
}
const member = installed.release.items.find(item => item.id === "ecc.skill.api-design").materials.find(member => member.path.endsWith("SKILL.md"));
const originalBytes = readFileSync(join(root, member.path));
try {
  writeFileSync(join(root, member.path), "changed selected material");
  assert.equal((await readInstalledRelease({ root, release: "./release-ecc.json" })).valid, false);
} finally { writeFileSync(join(root, member.path), originalBytes); }
const receipt = { package: installed.release.package, releaseSha256: installed.release.sha256, extensionsReleaseSha256: extension.release.sha256, source: { repository: inventory.repository, revision: inventory.revision, gitTree: inventory.gitTree }, inventory: { files: inventory.entries.length, donorAssets: inventory.donor.assets.length }, items: installed.release.items.length, mixedSelections, expansion: { itemId: extra.id, releaseSha256: expansion.value.releaseSha256 }, core, consumerSha256: sha(readFileSync(fileURLToPath(import.meta.url))) };
writeFileSync("receipt.json", JSON.stringify(receipt, null, 2) + "\n");
