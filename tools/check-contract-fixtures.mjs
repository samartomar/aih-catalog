// Copy to an outside consumer containing the exact packed package before running.
// Imports use public exports only; material reads follow the public Node contract.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { contractSupport, contractSupport11 } from "@aihq/catalog/contracts";
import { readRelease, readContentInventory, readReleaseIndex } from "@aihq/catalog/reader";
import { checkProducerDeclaration } from "@aihq/catalog/producer";
import { readInstalledRelease, readRecipe } from "@aihq/catalog/node";
import manifest from "@aihq/catalog/fixtures/manifest.json" with { type: "json" };

const data = specifier => readFileSync(fileURLToPath(import.meta.resolve(specifier)));
const json = specifier => JSON.parse(data(specifier));
const canonical = value => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const encode = value => Buffer.from(`${canonical(value)}\n`);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const ajv = new Ajv2020({ strict: true });
const validateSupport = ajv.compile(json("@aihq/catalog/schemas/package-support/1.0.0.json"));
assert(validateSupport(contractSupport), JSON.stringify(validateSupport.errors));
assert.deepEqual(json("@aihq/catalog/package-support.json"), contractSupport);
const validateSupport11 = ajv.compile(json("@aihq/catalog/schemas/package-support/1.1.0.json"));
assert(validateSupport11(contractSupport11), JSON.stringify(validateSupport11.errors));
assert.deepEqual(json("@aihq/catalog/package-support-1.1.json"), contractSupport11);
assert.equal(validateSupport(contractSupport11), false, "1.0 must remain closed");
assert.equal(validateSupport11(contractSupport), false, "1.1 requires version and fixture declarations");
assert.deepEqual(contractSupport11.package, contractSupport.package);
assert.deepEqual(contractSupport11.entries, contractSupport.entries);
assert.deepEqual(contractSupport11.contracts.map(({ versions, fixtures, ...contract }) => contract), contractSupport.contracts);
for (const contract of contractSupport11.contracts) {
  assert.deepEqual(contract.versions, [contract.id.split(":").at(-1)]);
  assert.deepEqual(contract.fixtures, manifest.fixtures.filter(f => f.contract === contract.id && !f.scenario).map(f => ({
    export: f.export, expect: f.expected.status, ...(f.expected.code ? { code: f.expected.code } : {}),
  })));
  for (const fixture of contract.fixtures) data(fixture.export);
}
assert.deepEqual(manifest.package, contractSupport.package);
const declarations = new Map(contractSupport.contracts.map(c => [c.id, c]));
assert.equal(declarations.size, contractSupport.contracts.length, "Duplicate support entry");
const validators = new Map(contractSupport.contracts.map(c => {
  const schema = json(c.schemaExport);
  assert.equal(schema.$id, c.id);
  return [c.id, ajv.compile(schema)];
}));
for (const c of contractSupport.contracts) {
  assert(manifest.fixtures.some(f => f.contract === c.id && f.expected.status === "accept"), `No valid fixture: ${c.id}`);
  assert(manifest.fixtures.some(f => f.contract === c.id && f.expected.status === "refuse"), `No invalid fixture: ${c.id}`);
}
const seen = new Set();
const results = [];
for (const fixture of manifest.fixtures) {
  assert(!seen.has(fixture.export), `Repeated fixture: ${fixture.export}`); seen.add(fixture.export);
  assert.equal(fixture.version, fixture.contract.split(":").at(-1));
  assert.equal(fixture.schemaExport, declarations.get(fixture.contract)?.schemaExport);
  const bytes = data(fixture.export), document = JSON.parse(bytes);
  const valid = fixture.expected.status === "accept";
  if (fixture.reader === "release-index-scenario") {
    // Whole merge behaviours: the envelope carries the request, per-source state
    // and the authored expected outcome; execute through the public reader.
    const request = {
      evaluatedAt: document.evaluatedAt,
      sources: document.sources.map(source => ({
        sourceId: source.sourceId,
        trust: source.trust && typeof source.trust === "object"
          ? { tufRoot: new TextEncoder().encode(source.trust.tufRoot) } : source.trust,
        authorizedFrameworks: source.authorizedFrameworks,
        indexBytes: encode(source.index),
        ...(source.offline ? { offline: true } : {}),
      })),
      state: document.state,
    };
    const result = readReleaseIndex(request);
    assert.equal(result.valid, document.expect.valid, `${fixture.name}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.entries.map(entry => ({
      frameworkId: entry.frameworkId, version: entry.version, status: entry.status, sources: entry.sources,
    })), document.expect.entries, fixture.name);
    assert.deepEqual(result.sources.map(source => source.diagnostics.map(d => d.code)),
      document.expect.sourceDiagnostics, fixture.name);
    assert.deepEqual(result.sources.map(source => source.state.lastVersion),
      document.expect.stateVersions, fixture.name);
    results.push({ export: fixture.export, contract: fixture.contract, version: fixture.version, ...fixture.expected });
    continue;
  }
  const validate = validators.get(fixture.contract);
  assert.equal(validate(document), valid, `${fixture.name}: ${JSON.stringify(validate.errors)}`);
  let result;
  switch (fixture.reader) {
    case "release": result = readRelease(bytes, { expectedSha256: sha(bytes) }); break;
    case "inventory": result = readContentInventory(bytes, { expectedSha256: sha(bytes) }); break;
    case "release-index": {
      // The index reader merges sources; one authorized unsigned source exercises
      // schema and digest admission through the same public entry the host uses.
      result = readReleaseIndex({
        evaluatedAt: "2026-06-01T00:00:00Z",
        sources: [{
          sourceId: document.sourceId,
          trust: "none",
          authorizedFrameworks: [...new Set(document.entries.map(entry => entry.frameworkId))],
          indexBytes: bytes,
        }],
        state: [{ sourceId: document.sourceId, lastVersion: 0, lastVerifiedAt: null, lastIndexSha256: null }],
      });
      break;
    }
    case "projection": {
      const inventory = encode({ schema: "urn:aihq:catalog:content-inventory:1.0.0", projection: fixture.contract, release: document });
      result = readContentInventory(inventory, { expectedSha256: sha(inventory) }); break;
    }
    case "producer": result = checkProducerDeclaration(document); break;
    case "baseline": {
      const release = encode({ ...json(fixture.context), baseline: document });
      result = readRelease(release, { expectedSha256: sha(release) }); break;
    }
    case "recipe": {
      // The Node reader admits recipes with their advertised item and real material
      // closure. Update the descriptor hash so an invalid recipe reaches schema
      // admission instead of failing an earlier byte-integrity check.
      const release = json(fixture.context);
      const item = release.items.find(item => item.recipe.id === document.id);
      assert(item, `No context for ${fixture.name}`);
      item.recipe.sha256 = sha(bytes); item.recipe.byteLength = bytes.length;
      const installed = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
      const root = mkdtempSync(join(tmpdir(), "catalog-recipe-fixture-"));
      const put = (path, bytes) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };
      try {
        put("package.json", encode({ ...release.package, exports: { "./release.json": "./fixture-release.json" } }));
        put("fixture-release.json", encode(release));
        for (const candidate of release.items) for (const member of [candidate.recipe, ...candidate.materials]) {
          mkdirSync(dirname(join(root, member.path)), { recursive: true });
          copyFileSync(join(installed, member.path), join(root, member.path));
        }
        put(item.recipe.path, bytes);
        result = await readInstalledRelease({ root });
      } finally { rmSync(root, { recursive: true, force: true }); }
      // The standalone reader applies the same admission without an item.
      const standalone = readRecipe(bytes);
      assert.equal(standalone.valid, valid, `${fixture.name} standalone: ${JSON.stringify(standalone.diagnostics)}`);
      if (!valid) assert(standalone.diagnostics.some(d => d.code === fixture.expected.code), `${fixture.name}: wrong standalone refusal`);
      break;
    }
    default: throw new Error(`Unknown public reader ${fixture.reader}`);
  }
  const accepted = result.valid === true || result.status === "ok";
  assert.equal(accepted, valid, `${fixture.name}: ${JSON.stringify(result.diagnostics)}`);
  if (!valid) assert(result.diagnostics.some(d => d.code === fixture.expected.code), `${fixture.name}: wrong refusal ${JSON.stringify(result)}`);
  results.push({ export: fixture.export, contract: fixture.contract, version: fixture.version, ...fixture.expected });
}
process.stdout.write(JSON.stringify({ declarations: [contractSupport.schema, contractSupport11.schema], checked: results.length, results }));
