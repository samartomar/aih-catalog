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
import {
  readContentInventory, readRelease, readReleaseContent, readReleaseIndex, readReleaseSets, resolveSelections,
} from "@aihq/catalog/reader";
import { checkProducerDeclaration, compileReleaseSets } from "@aihq/catalog/producer";
import { readInstalledRelease, readRecipe } from "@aihq/catalog/node";
import { checkExactSourceIdentity, readSourceDescription } from "@aihq/catalog/source";
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
  if (fixture.reader === "release-1-7-scenario") {
    checkRelease17Scenario(fixture.name, document);
    results.push({ export: fixture.export, contract: fixture.contract, version: fixture.version, ...fixture.expected });
    continue;
  }
  if (fixture.reader === "release-sets-scenario") {
    checkSetsScenario(fixture.name, document);
    results.push({ export: fixture.export, contract: fixture.contract, version: fixture.version, ...fixture.expected });
    continue;
  }
  if (fixture.reader === "source-description-scenario") {
    checkSourceDescriptionScenario(fixture.name, document);
    results.push({ export: fixture.export, contract: fixture.contract, version: fixture.version, ...fixture.expected });
    continue;
  }
  const validate = validators.get(fixture.contract);
  // A reader-validated invalid case passes its schema and is refused by the reader.
  assert.equal(validate(document), valid || fixture.validation === "reader", `${fixture.name}: ${JSON.stringify(validate.errors)}`);
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
      const inventorySchema = {
        "urn:aihq:catalog:release-content:1.1.0": "urn:aihq:catalog:content-inventory:1.1.0",
        "urn:aihq:catalog:release-content:1.2.0": "urn:aihq:catalog:content-inventory:1.2.0",
      }[fixture.contract] ?? "urn:aihq:catalog:content-inventory:1.0.0";
      const inventory = encode({ schema: inventorySchema, projection: fixture.contract, release: document });
      result = readContentInventory(inventory, { expectedSha256: sha(inventory) }); break;
    }
    case "producer": result = checkProducerDeclaration(document); break;
    case "source-description": result = readSourceDescription(bytes); break;
    case "release-sets": {
      result = readReleaseSets(bytes, { expectedSha256: sha(bytes), release: contentRelease(fixture.context) });
      if (!valid) assert.deepEqual(result.diagnostics.map(d => d.reason).sort(), [...fixture.expected.reasons].sort(), fixture.name);
      break;
    }
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
/** Reads a content-only context release through the public reader. */
function contentRelease(specifier) {
  const bytes = data(specifier);
  const read = readReleaseContent(bytes, { expectedSha256: sha(bytes) });
  assert(read.valid, `${specifier}: ${JSON.stringify(read.diagnostics)}`);
  return read.release;
}
/** Executes one release 1.7 scenario: deterministic hash vectors or a split supersession. */
function checkRelease17Scenario(name, envelope) {
  if (envelope.releases) {
    for (const vector of envelope.releases) {
      const release = contentRelease(vector.export);
      assert.equal(release.schema, vector.schema, name);
      assert.equal(release.sha256, vector.releaseSha256, name);
      assert.deepEqual(release.items.map(({ id, itemSha256, contentSha256, behaviourSha256 }) =>
        ({ id, itemSha256, contentSha256, behaviourSha256 })), vector.items, name);
    }
    assert.equal(sha(data(envelope.frozenDefault.export)), envelope.frozenDefault.releaseSha256, `${name}: frozen default`);
    const collapsed = contentRelease(envelope.releases.at(-1).export).items.find(item => item.id === envelope.declarationsOnly.itemId);
    assert.equal(collapsed.contentSha256, envelope.declarationsOnly.contentSha256, `${name}: declarations keep content identity`);
    assert.equal(collapsed.behaviourSha256, envelope.declarationsOnly.behaviourSha256, `${name}: declarations keep behaviour identity`);
    assert.notEqual(collapsed.itemSha256, envelope.declarationsOnly.itemSha256, `${name}: declarations move itemSha256`);
    return;
  }
  const release = contentRelease(envelope.release);
  const old = contentRelease(envelope.earlier.export).items.find(item => item.id === envelope.earlier.itemId);
  assert(old, `${name}: earlier item`);
  const survivors = release.items.filter(item => item.supersedes?.some(entry =>
    entry.match === "split" && entry.itemId === old.id && entry.itemSha256 === old.itemSha256));
  assert.deepEqual(survivors.map(item => item.id).sort(), [...envelope.survivors].sort(), name);
}
/** Executes one release sets scenario through the public build, reader and resolver. */
function checkSetsScenario(name, envelope) {
  if (envelope.cases) {
    const releases = envelope.releases.map(contentRelease);
    const bytes = encode(envelope.sets.document);
    const own = releases[envelope.releases.indexOf(envelope.sets.release)];
    const attached = readReleaseSets(bytes, { expectedSha256: sha(bytes), release: own });
    assert(attached.valid, `${name}: ${JSON.stringify(attached.diagnostics)}`);
    const supplied = Object.fromEntries(releases.map(r => r === own ? [r.sha256, attached.release] : [r.sha256, r]));
    for (const entry of envelope.cases) {
      const set = attached.release.sets.find(candidate => candidate.id === entry.request.setId);
      const result = resolveSelections({ releases: supplied, roots: [], skips: [], sets: [{
        release: { releaseSha256: own.sha256, scope: "project" }, setSha256: set.setSha256, ...entry.request,
      }] });
      assert.equal(result.status, entry.expect.status, `${name}/${entry.name}: ${JSON.stringify(result.diagnostics)}`);
      if (result.status !== "ok") {
        assert.deepEqual(result.diagnostics.map(d => d.reason), entry.expect.reasons, `${name}/${entry.name}`);
        continue;
      }
      assert.deepEqual(result.value.selections.map(s => s.item.itemId).sort(), entry.expect.selections, `${name}/${entry.name}`);
      for (const [itemId, origins] of Object.entries(entry.expect.origins))
        assert.deepEqual(result.value.selections.find(s => s.item.itemId === itemId)?.origins, origins, `${name}/${entry.name}/${itemId}`);
    }
    return;
  }
  if (envelope.build) {
    const result = compileReleaseSets({ release: contentRelease(envelope.build.release), sets: envelope.build.sets });
    assert.equal(result.status, envelope.expect.status, name);
    assert.deepEqual(result.diagnostics.map(d => d.reason), envelope.expect.reasons, name);
    return;
  }
  const digests = new Map();
  for (const vector of envelope.vectors) {
    const result = compileReleaseSets({ release: contentRelease(vector.release), sets: vector.sets });
    assert.equal(result.status, "ok", `${name}/${vector.name}: ${JSON.stringify(result.diagnostics)}`);
    const actual = result.value.document.sets.find(set => set.id === vector.setId).setSha256;
    assert.equal(actual, vector.setSha256, `${name}/${vector.name}`);
    digests.set(vector.name, actual);
  }
  for (const [a, b] of envelope.equal) assert.equal(digests.get(a), digests.get(b), `${name}: ${a} = ${b}`);
  for (const [a, b] of envelope.distinct) assert.notEqual(digests.get(a), digests.get(b), `${name}: ${a} != ${b}`);
  const { before, after, itemId } = envelope.behaviourOnly;
  const [old, changed] = [before, after].map(r => contentRelease(r).items.find(item => item.id === itemId));
  assert.equal(changed.contentSha256, old.contentSha256, `${name}: content unchanged`);
  assert.notEqual(changed.behaviourSha256, old.behaviourSha256, `${name}: behaviour changed`);
}
/** Executes source description and exact identity scenarios through the public source export. */
function checkSourceDescriptionScenario(name, envelope) {
  const run = (entry) => {
    const expectRefusal = entry.expect.status === "refuse";
    if (envelope.scenario === "locator-kinds") {
      // An organization list is the same descriptor, one read per entry; a list
      // entry carrying policy is refused like any unknown field, so a refusing
      // list is expected when at least one entry refuses with the named reason.
      const outcomes = (entry.list ?? [entry.document]).map((document) =>
        readSourceDescription(encode(document)),
      );
      if (expectRefusal) {
        assert(
          outcomes.some(
            (result) =>
              !result.valid &&
              result.diagnostics.some(
                (d) =>
                  d.code === entry.expect.code &&
                  (entry.expect.reason === undefined || d.reason === entry.expect.reason),
              ),
          ),
          `${name}/${entry.name}: no refusal matched ${JSON.stringify(entry.expect)} in ${JSON.stringify(outcomes)}`,
        );
        return;
      }
      for (const result of outcomes) {
        assert.equal(result.valid, true, `${name}/${entry.name}: ${JSON.stringify(result)}`);
        // Discovery data only: reading never yields an exact identity field.
        for (const exact of ["commit", "integrity", "captureSha256", "reachable"]) {
          assert(!JSON.stringify(result.description).includes(`"${exact}"`), `${name}/${entry.name}: ${exact} leaked into a description`);
        }
      }
      return;
    }
    const result = checkExactSourceIdentity(entry.identity);
    assert.equal(result.valid, !expectRefusal, `${name}/${entry.name}: ${JSON.stringify(result)}`);
    if (!result.valid) {
      assert(
        result.diagnostics.some(
          (d) =>
            d.code === entry.expect.code &&
            (entry.expect.reason === undefined || d.reason === entry.expect.reason),
        ),
        `${name}/${entry.name}: wrong refusal ${JSON.stringify(result)}`,
      );
    }
  };
  for (const entry of envelope.cases) run(entry);
}
// The standalone reader's own refusals, through the packed export.
const recipeText = text => readRecipe(new TextEncoder().encode(text)).diagnostics.map(d => [d.code, d.reason]);
assert.deepEqual(recipeText('{"schema":"urn:aihq:core:recipe:1.2.0"}'), [["SCHEMA_UNSUPPORTED", "recipe-schema-unsupported"]]);
assert.deepEqual(recipeText('{"schema":"constructor"}'), [["SCHEMA_UNSUPPORTED", "recipe-schema-unsupported"]]);
assert.deepEqual(recipeText('{"schema":"urn:aihq:core:recipe:1.0.0","id":"a","id":"b"}'), [["INPUT_INVALID", "recipe-unreadable"]]);
process.stdout.write(JSON.stringify({ declarations: [contractSupport.schema, contractSupport11.schema], checked: results.length, results }));
