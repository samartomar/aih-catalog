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
// Project a committed 1.x release document into the release 1.6 shape: extended
// materials, the synthesised behaviour file and both identities. Fixture-only
// projection over real committed content; sizes stay absent (bytes are not read).
const FRAMEWORK_ID = "fixture-framework";
const projectRelease16 = (document) => {
  const doc = structuredClone(document);
  doc.schema = "urn:aihq:catalog:release:1.6.0";
  doc.framework = {
    id: FRAMEWORK_ID,
    name: "Fixture Framework",
    version: "1.0.0",
    description: "Authored golden framework for the release 1.6 contract fixtures.",
  };
  for (const source of doc.sources) source.license = "MIT";
  doc.items = doc.items.map((item) => {
    const executable = {};
    const content = item.materials.map((member) => {
      const relPath = member.id === "license" ? "LICENSE" : member.id === "skill" ? "SKILL.md" : member.id;
      executable[relPath] = "unknown";
      return {
        id: member.id, relPath, sourcePath: member.path, packagePath: member.path,
        sha256: member.sha256, byteLength: member.byteLength,
        executable: "unknown", sourceId: item.sourceIds[0], role: "content",
      };
    });
    const behaviourText = `${canonical({ kind: item.kind, payload: null, requirements: { inputs: {} }, dependencies: item.dependencies, executable })}\n`;
    const behaviour = {
      id: "behaviour", relPath: "aih-behaviour.json", sourcePath: null,
      packagePath: `release/items/${item.id}/aih-behaviour.json`,
      sha256: sha(Buffer.from(behaviourText)), byteLength: behaviourText.length,
      executable: false, sourceId: FRAMEWORK_ID, role: "behaviour",
    };
    const lines = (members) => members.map((m) => `${m.relPath}\t${m.sha256}\n`).sort();
    const materials = [...content, behaviour].sort((a, b) => (a.id < b.id ? -1 : 1));
    return {
      ...item, materials, requirements: { inputs: {} }, executable,
      contentSha256: sha(Buffer.from(lines(content).join(""))),
      behaviourSha256: sha(Buffer.from(lines(materials).join(""))),
    };
  });
  return doc;
};
for (let minor = 0; minor <= 6; minor++) {
  let document = structuredClone(minor === 0 ? matt : minor === 1 ? hooks : minor === 4 ? subset("release/release.json", ["mattpocock.grill-me", "aihq.client.claude"]) : minor === 6 ? matt : mixed);
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
  if (minor === 6) {
    document = projectRelease16(document);
    const inventory = createContentInventory(bytes(document), { expectedSha256: sha(bytes(document)) });
    assert(inventory.valid, JSON.stringify(inventory));
    assert.equal(inventory.inventory.schema, "urn:aihq:catalog:content-inventory:1.1.0");
    document = { ...document, baseline: {
      schema: "urn:aihq:catalog:scan-baseline:1.0.0",
      inventory: { path: "fixtures/bound-inventory-1.1.0.json", sha256: inventory.sha256, byteLength: inventory.byteLength },
      scanId: `scan:sha256:${"a".repeat(64)}`,
      artifact: { sha256: sha(Buffer.from("fixture evidence 1.6\n")), byteLength: 19, location: { kind: "package", path: "fixtures/baseline-evidence.txt" } },
      scope: { namespace: "package-relative", paths: ["release"], excludedPaths: [] },
    } };
    write("fixtures/bound-inventory-1.1.0.json", inventory.inventory);
    add("content-inventory-1.1.0", inventory.inventory.schema, inventory.inventory, "inventory", "Real Matt grill-me closure projected to release 1.6 before evidence; behaviour files and executable states included.");
    add("release-content-1.1.0", inventory.inventory.projection, inventory.inventory.release, "projection", "Real Matt grill-me release-content 1.1 projection with behaviour files and executable states.");
  }
  add(`release-1.${minor}.0`, document.schema, document, "release", minor === 6
    ? "Real Matt grill-me closure projected to release 1.6 with behaviour files, both identities and a test-only evidence binding."
    : minor === 5
    ? "Real Extensions grill-me/git-guard and Superpowers reviewed-tdd; test-only evidence binding."
    : minor === 0 || minor === 4 ? "Committed default release: Matt grill-me and its dependency closure; 1.4 also retains the real Claude client adapter."
    : minor === 1 ? "Committed protect-env hook release, unchanged."
    : "Committed Extensions grill-me/git-guard and Superpowers reviewed-tdd, with their declared dependency closure.");
}
for (const version of ["3.0.0", "3.1.0", "3.2.0"]) {
  const declaration = read("producer/extensions/declaration.json");
  const ids = new Set(extensions.items.map(i => i.id));
  declaration.items = declaration.items.filter(i => ids.has(i.id));
  declaration.schema = `urn:aihq:catalog:producer-declaration:${version}`;
  if (version === "3.2.0") {
    declaration.framework = {
      id: "extensions", name: "Extensions", version: "1.0.0",
      description: "Authored golden framework for the producer declaration 3.2 fixture.",
    };
  }
  add(`producer-declaration-${version}`, declaration.schema, declaration, "producer", version === "3.2.0"
    ? "Committed Extensions producer declaration with the release 1.6 framework identity; grill-me/git-guard and dependency closure."
    : "Committed Extensions producer declaration: grill-me/git-guard and dependency closure; Git sources are valid in both 3.x formats.");
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
  // Golden scenarios: whole merge behaviours over committed index documents. The
  // envelope carries the request, the per-source state and the authored expected
  // outcome; the public checker executes each scenario through readReleaseIndex.
  const IDX = "urn:aihq:catalog:release-index:1.0.0";
  const FAR = "2999-01-01T00:00:00Z";
  const AT = "2026-06-01T00:00:00Z";
  const indexDoc = (sourceId, version, entries) => ({
    schema: IDX, sourceId, version, issuedAt: "2026-01-01T00:00:00Z", expires: FAR, entries,
  });
  const sentry = (frameworkId, sha, sourceId, kind, status = "current") => ({
    frameworkId,
    name: `Framework ${frameworkId.slice("framework-".length)[0].toUpperCase()}${frameworkId.slice("framework-".length + 1)}`,
    version: "1.0.0",
    location: archive(frameworkId, sha),
    sha256: release(sha),
    schema: "urn:aihq:catalog:release:1.5.0",
    status,
    evidence: [],
    source: { id: sourceId, kind },
  });
  const expectEntry = (frameworkId, status, sourceId, kind) => ({
    frameworkId, version: "1.0.0", status, sources: [{ id: sourceId, kind }],
  });
  const addScenario = (name, envelope, provenance) => {
    const contract = IDX;
    const schemaExport = contractSupport.contracts.find((c) => c.id === contract)?.schemaExport;
    const path = `fixtures/release-index/${name}.json`;
    write(path, envelope);
    fixtures.push({
      name, contract, version: "1.0.0", export: `@aihq/catalog/${path}`, schemaExport,
      reader: "release-index-scenario", scenario: true, provenance,
      expected: { status: "accept" },
    });
  };
  const sourceReq = (sourceId, document, authorized, extra = {}) => ({
    sourceId, trust: "none", authorizedFrameworks: authorized,
    index: document, ...extra,
  });
  addScenario("merge-public-local", {
    scenario: "merge-public-local", evaluatedAt: AT,
    sources: [
      sourceReq("catalog-public", indexDoc("catalog-public", 3, [
        sentry("framework-alpha", "merge-a", "catalog-public", "public"),
        sentry("framework-beta", "merge-b", "catalog-public", "public", "retired"),
      ]), ["framework-alpha", "framework-beta", "framework-gamma"]),
      sourceReq("org-local", indexDoc("org-local", 2, [
        sentry("framework-gamma", "merge-g", "org-local", "local"),
      ]), ["framework-gamma"]),
    ],
    state: [
      { sourceId: "catalog-public", lastVersion: 0, lastVerifiedAt: null, lastIndexSha256: null },
      { sourceId: "org-local", lastVersion: 0, lastVerifiedAt: null, lastIndexSha256: null },
    ],
    expect: {
      valid: true,
      entries: [
        expectEntry("framework-alpha", "current", "catalog-public", "public"),
        expectEntry("framework-beta", "retired", "catalog-public", "public"),
        expectEntry("framework-gamma", "current", "org-local", "local"),
      ],
      sourceDiagnostics: [["unsigned"], ["unsigned"]],
      stateVersions: [3, 2],
    },
  }, "Unsigned public and local merge over committed index documents; retired stays listed.");
  addScenario("conflict-two-sources", {
    scenario: "conflict-two-sources", evaluatedAt: AT,
    sources: [
      sourceReq("catalog-public", indexDoc("catalog-public", 1, [
        sentry("framework-alpha", "conflict-a", "catalog-public", "public"),
      ]), ["framework-alpha", "framework-beta"]),
      sourceReq("org-mirror", indexDoc("org-mirror", 9, [
        sentry("framework-alpha", "conflict-b", "org-mirror", "organization"),
        sentry("framework-beta", "conflict-bb", "org-mirror", "organization"),
      ]), ["framework-alpha", "framework-beta"]),
    ],
    state: [
      { sourceId: "catalog-public", lastVersion: 0, lastVerifiedAt: null, lastIndexSha256: null },
      { sourceId: "org-mirror", lastVersion: 0, lastVerifiedAt: null, lastIndexSha256: null },
    ],
    expect: {
      valid: true,
      entries: [expectEntry("framework-beta", "current", "org-mirror", "organization")],
      sourceDiagnostics: [["unsigned", "conflict"], ["unsigned", "conflict"]],
      stateVersions: [1, 9],
    },
  }, "Two sources disagree on one release digest; the conflict is reported and neither entry is used.");
  addScenario("rollback-refused", {
    scenario: "rollback-refused", evaluatedAt: AT,
    sources: [sourceReq("catalog-public", indexDoc("catalog-public", 2, [
      sentry("framework-alpha", "rollback-a", "catalog-public", "public"),
    ]), ["framework-alpha"])],
    state: [{ sourceId: "catalog-public", lastVersion: 3, lastVerifiedAt: null, lastIndexSha256: release("accepted-v3") }],
    expect: {
      valid: true,
      entries: [],
      sourceDiagnostics: [["rollback-refused"]],
      stateVersions: [3],
    },
  }, "An index version below the recorded version is refused and the recorded state is kept.");
  addScenario("scope-unauthorized-framework", {
    scenario: "scope-unauthorized-framework", evaluatedAt: AT,
    sources: [sourceReq("catalog-public", indexDoc("catalog-public", 1, [
      sentry("framework-alpha", "scope-a", "catalog-public", "public"),
      sentry("framework-beta", "scope-b", "catalog-public", "public"),
    ]), ["framework-alpha"])],
    state: [{ sourceId: "catalog-public", lastVersion: 0, lastVerifiedAt: null, lastIndexSha256: null }],
    expect: {
      valid: true,
      entries: [expectEntry("framework-alpha", "current", "catalog-public", "public")],
      sourceDiagnostics: [["unsigned", "unauthorized-framework"]],
      stateVersions: [1],
    },
  }, "A framework outside the source authorization is ignored with unauthorized-framework.");
  addScenario("expired-index", {
    scenario: "expired-index", evaluatedAt: AT,
    sources: [sourceReq("catalog-public", {
      schema: IDX, sourceId: "catalog-public", version: 4, issuedAt: "2026-01-01T00:00:00Z",
      expires: "2026-01-15T00:00:00Z",
      entries: [sentry("framework-alpha", "expired-a", "catalog-public", "public")],
    }, ["framework-alpha"])],
    state: [{ sourceId: "catalog-public", lastVersion: 0, lastVerifiedAt: null, lastIndexSha256: null }],
    expect: {
      valid: true,
      entries: [],
      sourceDiagnostics: [["expired"]],
      stateVersions: [0],
    },
  }, "An expired index has its entries withheld and the state does not advance.");
  addScenario("tuf-selected-offline", {
    scenario: "tuf-selected-offline", evaluatedAt: AT,
    sources: [{
      sourceId: "catalog-public", trust: { tufRoot: "dGVzdC1yb290" },
      authorizedFrameworks: ["framework-alpha"],
      index: indexDoc("catalog-public", 1, [sentry("framework-alpha", "tuf-a", "catalog-public", "public")]),
    }],
    state: [{ sourceId: "catalog-public", lastVersion: 0, lastVerifiedAt: null, lastIndexSha256: null }],
    expect: {
      valid: true,
      entries: [],
      sourceDiagnostics: [["offline"]],
      stateVersions: [0],
    },
  }, "A caller-selected TUF source reports offline with verification unavailable and contributes no entries.");
  {
    const cached = indexDoc("catalog-public", 1, [sentry("framework-alpha", "cache-a", "catalog-public", "public")]);
    addScenario("offline-cache-reuse", {
      scenario: "offline-cache-reuse", evaluatedAt: AT,
      sources: [sourceReq("catalog-public", cached, ["framework-alpha"], { offline: true })],
      state: [{ sourceId: "catalog-public", lastVersion: 1, lastVerifiedAt: null, lastIndexSha256: sha(bytes(cached)) }],
      expect: {
        valid: true,
        entries: [expectEntry("framework-alpha", "current", "catalog-public", "public")],
        sourceDiagnostics: [["offline"]],
        stateVersions: [1],
      },
    }, "Offline reuse serves the unexpired recorded copy, says so, and never relabels it as verified.");
  }
}
write("fixtures/manifest.json", { schema: "urn:aihq:catalog:fixture-manifest:1.0.0", package: contractSupport.package, fixtures });
write("package-support.json", contractSupport);
write("package-support-1.1.json", contractSupport11);
