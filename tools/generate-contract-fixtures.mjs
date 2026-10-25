// Deterministic projections of committed real content. No acquisition or execution.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { contractSupport, contractSupport11 } from "../dist/release/contracts.js";
import { createContentInventory } from "../dist/release/reader.js";

const root = resolve(import.meta.dirname, "..");
const read = path => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const canonical = value => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const bytes = value => Buffer.from(`${canonical(value)}\n`);
const sha = value => createHash("sha256").update(value).digest("hex");
const write = (path, value) => {
  const target = resolve(root, path), data = bytes(value);
  if (process.argv.includes("--check")) assert.deepEqual(readFileSync(target), data, `Stale ${path}`);
  else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, data); }
};
function subset(path, ids) {
  const release = read(path), selected = new Set(ids);
  for (const id of selected) {
    const item = release.items.find(item => item.id === id);
    assert(item, `Missing real item ${id}`);
    for (const refs of Object.values(item.dependencies))
      for (const ref of refs) if (!ref.release) selected.add(ref.itemId);
  }
  release.items = release.items.filter(item => selected.has(item.id));
  return release;
}
const matt = subset("release/release.json", ["mattpocock.grill-me"]);
const hooks = read("release/release-1.1.json");
const extensions = subset("release/release-extensions.json", ["extensions.claude.hook.git-guard", "extensions.matt.grill-me"]);
const superpowers = subset("release/release-superpowers.json", ["superpowers.template.reviewed-tdd"]);
const mixed = { ...extensions,
  sources: [...extensions.sources, ...superpowers.sources].sort((a,b) => a.id < b.id ? -1 : 1),
  items: [...extensions.items, ...superpowers.items].sort((a,b) => a.id < b.id ? -1 : 1),
};
const fixtures = [];
function add(name, contract, document, reader, provenance, context = undefined) {
  const version = contract.split(":").at(-1);
  const schemaExport = contractSupport.contracts.find(c => c.id === contract)?.schemaExport;
  assert(schemaExport, `Undeclared ${contract}`);
  for (const valid of [true, false]) {
    const value = structuredClone(document);
    // Unknown fields are forbidden by every current structural contract.
    if (!valid) value.fixtureUnknownField = true;
    const path = `fixtures/${name}-${valid ? "valid" : "invalid"}.json`;
    write(path, value);
    fixtures.push({ name: `${name}-${valid ? "valid" : "invalid"}`, contract, version,
      export: `@aihq/catalog/${path}`, schemaExport, reader, provenance,
      expected: valid ? { status: "accept" } : { status: "refuse", code: "INPUT_INVALID" },
      ...(context ? { context } : {}),
    });
  }
}
for (let minor = 0; minor <= 5; minor++) {
  let document = structuredClone(minor === 0 ? matt : minor === 1 ? hooks : minor === 4 ? subset("release/release.json", ["mattpocock.grill-me", "aihq.client.claude"]) : mixed);
  document.schema = `urn:aihq:catalog:release:1.${minor}.0`;
  if (minor === 5) {
    const inventory = createContentInventory(bytes(document), { expectedSha256: sha(bytes(document)) });
    assert(inventory.valid, JSON.stringify(inventory));
    document = { ...inventory.inventory.release, baseline: {
      schema: "urn:aihq:catalog:scan-baseline:1.0.0",
      inventory: { path: "fixtures/bound-inventory.json", sha256: inventory.sha256, byteLength: inventory.byteLength },
      scanId: `scan:sha256:${"a".repeat(64)}`,
      artifact: { sha256: sha(Buffer.from("fixture evidence\n")), byteLength: 17, location: { kind: "package", path: "fixtures/baseline-evidence.txt" } },
      scope: { namespace: "package-relative", paths: ["release"], excludedPaths: [] },
    } };
    write("fixtures/bound-inventory.json", inventory.inventory);
    add("content-inventory-1.0.0", inventory.inventory.schema, inventory.inventory, "inventory", "Real Extensions/Superpowers declarations projected before evidence.");
    add("release-content-1.0.0", inventory.inventory.projection, inventory.inventory.release, "projection", "Real Extensions/Superpowers release-content projection.");
    add("scan-baseline-1.0.0", document.baseline.schema, document.baseline, "baseline", "Test-only evidence binding over real content; no authentication or production assessment claim.", "@aihq/catalog/fixtures/release-1.5.0-valid.json");
  }
  add(`release-1.${minor}.0`, document.schema, document, "release", minor === 5
    ? "Real Extensions grill-me/git-guard and Superpowers reviewed-tdd; test-only evidence binding."
    : minor === 0 || minor === 4 ? "Committed default release: Matt grill-me and its dependency closure; 1.4 also retains the real Claude client adapter."
    : minor === 1 ? "Committed protect-env hook release, unchanged."
    : "Committed Extensions grill-me/git-guard and Superpowers reviewed-tdd, with their declared dependency closure.");
}
for (const version of ["3.0.0", "3.1.0"]) {
  const declaration = read("producer/extensions/declaration.json");
  const ids = new Set(extensions.items.map(i => i.id));
  declaration.items = declaration.items.filter(i => ids.has(i.id));
  declaration.schema = `urn:aihq:catalog:producer-declaration:${version}`;
  add(`producer-declaration-${version}`, declaration.schema, declaration, "producer", "Committed Extensions producer declaration: grill-me/git-guard and dependency closure; Git sources are valid in both 3.x formats.");
}
for (const [version, id, context] of [
  ["1.0.0", "mattpocock.grill-me", "release-1.0.0-valid"],
  ["1.1.0", "aihq.hook.claude.protect-env", "release-1.1.0-valid"],
  ["1.3.0", "extensions.claude.hook.git-guard", "release-1.2.0-valid"],
]) {
  const recipe = read(`release/recipes/${id}.json`);
  add(`core-recipe-${version}`, recipe.schema, recipe, "recipe", `Committed recipe for ${id}, byte content preserved in canonical JSON.`, `@aihq/catalog/fixtures/${context}.json`);
}
{
  // Authored golden index: current, retired and revoked entries over one public
  // source. Unsigned-first reading checks every release digest.
  const release = seed => sha(Buffer.from(`${seed}\n`));
  const archive = (slug, seed) => ({
    kind: "archive",
    url: `https://fixtures.aihq.example/releases/${slug}.json`,
    sha256: release(seed),
    byteLength: 17,
  });
  const entry = (frameworkId, version, status, location, extra = {}) => ({
    frameworkId,
    name: `Framework ${frameworkId.slice("framework-".length)[0].toUpperCase()}${frameworkId.slice("framework-".length + 1)}`,
    version,
    location,
    sha256: location.kind === "archive" ? location.sha256 : release(`${frameworkId}-local`),
    schema: "urn:aihq:catalog:release:1.5.0",
    status,
    evidence: [],
    ...extra,
    source: { id: "catalog-public", kind: "public" },
  });
  const alpha = entry("framework-alpha", "1.2.0", "current", archive("framework-alpha-1.2.0", "alpha-release"));
  const beta = entry("framework-beta", "2.0.0", "retired", { kind: "local", input: "catalog-mirror" },
    { reason: "Superseded by Framework Alpha 1.2.0." });
  const gammaEvidence = archive("framework-gamma-assessment", "gamma-evidence");
  const gamma = entry("framework-gamma", "0.9.0", "revoked",
    archive("framework-gamma-0.9.0", "gamma-release"),
    { reason: "Withdrawn by the publisher.", evidence: [gammaEvidence] });
  const releaseIndex = {
    schema: "urn:aihq:catalog:release-index:1.0.0",
    sourceId: "catalog-public",
    version: 3,
    issuedAt: "2026-01-01T00:00:00Z",
    expires: "2999-01-01T00:00:00Z",
    entries: [alpha, beta, gamma],
  };
  add("release-index-1.0.0", releaseIndex.schema, releaseIndex, "release-index",
    "Authored golden index over one public source: current, retired and revoked entries, a local location and one evidence location; unsigned-first reading with digests checked.");
}
write("fixtures/manifest.json", { schema: "urn:aihq:catalog:fixture-manifest:1.0.0", package: contractSupport.package, fixtures });
write("package-support.json", contractSupport);
write("package-support-1.1.json", contractSupport11);
