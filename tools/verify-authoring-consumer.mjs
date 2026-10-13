// One packed, outside, headless consumer. No Core source, execution or registry publication.
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
assert(args.length <= 1, "Usage: node tools/verify-authoring-consumer.mjs [catalog.tgz] [--evidence directory]");
const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-authoring-"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const canonical = value => value === null || typeof value !== "object" ? JSON.stringify(value) :
  Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const npm = [process.env.npm_execpath, resolve(process.execPath, "..", "node_modules/npm/bin/npm-cli.js"), resolve(process.execPath, "../..", "lib/node_modules/npm/bin/npm-cli.js")]
  .find(candidate => candidate && isAbsolute(candidate) && basename(candidate) === "npm-cli.js" && existsSync(candidate));
assert(npm, "An adjacent npm-cli.js is required.");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"));
const runNpm = (args, cwd) => execFileSync(process.execPath, [npm, ...args], { cwd, env, encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
try {
  const archive = args[0] ? resolve(args[0]) : join(fixture, JSON.parse(runNpm(["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", fixture], root))[0].filename);
  const archiveSha256 = sha(readFileSync(archive));
  const consumer = join(fixture, "consumer");
  seedConsumerLock(consumer, root);
  runNpm(["install", "--prefix", consumer, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", archive], fixture);
  const installed = join(consumer, "node_modules/@aihq/catalog");
  const installedReleaseBytes = readFileSync(join(installed, "release/release.json"));
  const maintained = JSON.parse(installedReleaseBytes);
  const maintainedSha256 = sha(installedReleaseBytes);
  const sourceReleaseBytes = readFileSync(join(root, "release/release.json"));
  assert.equal(maintainedSha256, sha(sourceReleaseBytes));
  const upstream = maintained.items.find(item => item.id === "mattpocock.grill-with-docs");
  assert(upstream, "The maintained example requires grill-with-docs.");
  const inputs = join(consumer, "inputs");
  mkdirSync(inputs);
  cpSync(join(installed, "producer/templates/public"), join(inputs, "notes"), { recursive: true });
  const declarationPath = join(inputs, "notes/declaration.json");
  const declaration = JSON.parse(readFileSync(declarationPath, "utf8"));
  declaration.items[0].requires = [{ release: { source: { kind: "local", input: "maintained" }, manifest: { path: "release/release.json", sha256: maintainedSha256, byteLength: installedReleaseBytes.length } }, itemId: upstream.id, itemSha256: sha(canonical(upstream)) }];
  writeFileSync(declarationPath, JSON.stringify(declaration));
  cpSync(join(inputs, "notes"), join(inputs, "expansion"), { recursive: true });
  const expansion = structuredClone(declaration);
  expansion.package.name = "second-independent-catalog";
  expansion.sources[0].id = "second";
  expansion.sources[0].repository = "example/second-notes";
  expansion.items[0].id = "consumer-proof.second-note";
  expansion.items[0].source = "second";
  expansion.items[0].requires = [];
  writeFileSync(join(inputs, "expansion/declaration.json"), JSON.stringify(expansion));
  const expandedRecipe = JSON.parse(readFileSync(join(inputs, "expansion/recipe.json"), "utf8"));
  expandedRecipe.id = expansion.items[0].id;
  for (const step of [...expandedRecipe.operations, ...expandedRecipe.checks]) step.target.segments[0].literal = `second-${step.target.segments[0].literal}`;
  writeFileSync(join(inputs, "expansion/recipe.json"), JSON.stringify(expandedRecipe));
  writeFileSync(join(inputs, "cases.json"), JSON.stringify([
    { directories: ["notes"], expected: ["consumer-proof.review-note", "mattpocock.domain-modeling", "mattpocock.grill-with-docs", "mattpocock.grilling"] },
    { directories: ["notes", "expansion"], expected: ["consumer-proof.review-note", "consumer-proof.second-note", "mattpocock.domain-modeling", "mattpocock.grill-with-docs", "mattpocock.grilling"] },
  ]));
  const script = String.raw`
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkProducerDeclaration, compileProducerDeclaration, PRODUCER_DECLARATION_SCHEMA_ID } from "@aihq/catalog/producer";
import { configureItem, readRelease, resolveSelections, validateSelectionSet } from "@aihq/catalog/reader";
import { contractSupport } from "@aihq/catalog/contracts";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const schema = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/schemas/producer-declaration/3.0.0.json")), "utf8"));
assert.equal(schema.$id, PRODUCER_DECLARATION_SCHEMA_ID);
assert(contractSupport.entries.some(entry => entry.export === "@aihq/catalog/producer"));
const bytes = readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/release.json")));
const maintained = readRelease(bytes, { expectedSha256: sha(bytes) });
assert.equal(maintained.valid, true);
const cases = JSON.parse(readFileSync("inputs/cases.json", "utf8"));
let iteratorCalls = 0;
class NonPlainRoots extends Array { [Symbol.iterator]() { iteratorCalls++; return super[Symbol.iterator](); } }
assert.equal(resolveSelections({ releases: {}, roots: new NonPlainRoots(), skips: [] }).status, "refused");
assert.equal(iteratorCalls, 0);
const receipt = { package: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, installedReleaseSha256: maintained.release.sha256, cases: [], refusals: [] };
for (const scenario of cases) {
  const releases = { [maintained.release.sha256]: maintained.release };
  const roots = [];
  const inventories = [];
  for (const directory of scenario.directories) {
    const declarationBytes = readFileSync(join("inputs", directory, "declaration.json"));
    const declaration = JSON.parse(declarationBytes);
    assert.equal(checkProducerDeclaration(declaration).status, "ok");
    const files = Object.fromEntries(readdirSync(join("inputs", directory)).filter(path => path !== "declaration.json").map(path => [path, new Uint8Array(readFileSync(join("inputs", directory, path)))]));
    const sourceFiles = declaration.sources.map(source => ({ source: source.id, revision: "a".repeat(40), files }));
    const compiled = compileProducerDeclaration({ declaration, sourceFiles });
    assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics));
    const read = readRelease(compiled.value.releaseBytes, { expectedSha256: compiled.value.releaseSha256 });
    assert.equal(read.valid, true);
    releases[read.release.sha256] = read.release;
    roots.push(...declaration.items.map(item => ({ releaseSha256: read.release.sha256, itemId: item.id, scope: "project", configuration: {} })));
    inventories.push({ declarationSha256: sha(declarationBytes), releaseSha256: read.release.sha256, materialCount: compiled.value.materials.length });
    assert.equal(compileProducerDeclaration({ declaration, sourceFiles: [] }).status, "refused");
    assert.equal(checkProducerDeclaration({ ...declaration, schema: "unsupported" }).status, "refused");
    assert.equal(checkProducerDeclaration({ ...declaration, items: [{ ...declaration.items[0], requires: ["guessed-prose"] }] }).status, "refused");
    const badRecipe = JSON.parse(new TextDecoder().decode(files[declaration.items[0].recipePath]));
    badRecipe.schema = "urn:aihq:core:recipe:99.0.0";
    const invalidRecipe = compileProducerDeclaration({ declaration, sourceFiles: sourceFiles.map(snapshot => ({ ...snapshot, files: { ...snapshot.files, [declaration.items[0].recipePath]: new TextEncoder().encode(JSON.stringify(badRecipe)) } })) });
    assert.equal(invalidRecipe.status, "refused");
    assert.equal(invalidRecipe.diagnostics[0].details.owner, "catalog");
    assert(invalidRecipe.diagnostics[0].details.diagnostics.some(d => d.reason === "recipe-schema-mismatch" && d.blocking === true));
  }
  const resolved = resolveSelections({ releases, roots, skips: [] });
  assert.equal(resolved.status, "ok", JSON.stringify(resolved.diagnostics));
  assert.deepEqual(resolved.value.selections.map(selection => selection.item.itemId).sort(), scenario.expected);
  assert.equal(validateSelectionSet({ releases, selections: resolved.value.selections }).valid, true);
  for (const selection of resolved.value.selections) {
    const configured = configureItem({ release: releases[selection.item.releaseSha256], itemId: selection.item.itemId, configuration: selection.configuration, materialSource: { kind: "local", input: "content" } });
    assert.equal(configured.valid, true, JSON.stringify(configured.diagnostics));
  }
  const target = { releaseSha256: maintained.release.sha256, itemId: "mattpocock.domain-modeling", scope: "project" };
  const impact = resolveSelections({ releases, roots, skips: [], remove: [target] });
  assert.equal(impact.status, "ok");
  assert(impact.value.removalImpact[0].affectedRoots.length > 0);
  const skipped = resolveSelections({ releases, roots, skips: [target], remove: [target] });
  assert.equal(skipped.status, "refused");
  assert(skipped.diagnostics.some(d => d.code === "REQUIRED_ITEM_SKIPPED"));
  assert.equal("value" in skipped, false);
  const forged = Object.fromEntries(Object.entries(releases).map(([digest, release]) => [digest, JSON.parse(JSON.stringify(release))]));
  assert.equal(resolveSelections({ releases: forged, roots, skips: [] }).status, "refused");
  receipt.cases.push({ inventories, selectionCount: resolved.value.selections.length, inclusionCount: resolved.value.inclusions.length, removalImpact: impact.value.removalImpact });
}
receipt.refusals = ["unsupported-version", "missing-source-bytes", "prose-relationship", "required-skip", "forged-reader-handle", "non-plain-array", "recipe-diagnostic-details"];
receipt.consumerSha256 = sha(readFileSync(fileURLToPath(import.meta.url)));
writeFileSync("receipt.json", JSON.stringify(receipt, null, 2) + "\n");
`;
  writeFileSync(join(consumer, "consume.mjs"), script);
  execFileSync(process.execPath, [join(consumer, "consume.mjs")], { cwd: consumer, env, encoding: "utf8", timeout: 60_000 });
  const receipt = { archiveSha256, sourceReleaseSha256: sha(sourceReleaseBytes), ...JSON.parse(readFileSync(join(consumer, "receipt.json"), "utf8")) };
  assert.equal(sha(readFileSync(archive)), archiveSha256);
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    cpSync(archive, join(evidence, basename(archive)));
    cpSync(consumer, join(evidence, "consumer"), { recursive: true });
    writeFileSync(join(evidence, "packed-consumer.json"), JSON.stringify(receipt, null, 2) + "\n");
  }
  console.log(JSON.stringify(receipt, null, 2));
} finally { rmSync(fixture, { recursive: true, force: true }); }
