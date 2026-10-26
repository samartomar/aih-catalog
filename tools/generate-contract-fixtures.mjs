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
const FIXTURE_FRAMEWORK = {
  id: "fixture-framework",
  name: "Fixture Framework",
  version: "1.0.0",
  description: "Authored golden framework for the release 1.6 contract fixtures.",
};
const projectRelease16 = (document, framework = FIXTURE_FRAMEWORK) => {
  const FRAMEWORK_ID = framework.id;
  const doc = structuredClone(document);
  doc.schema = "urn:aihq:catalog:release:1.6.0";
  doc.framework = { ...framework };
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
{
  // Release sets 1.0 over real content projected to release 1.6. The context
  // releases are content-only (no evidence binding) and are read with
  // readReleaseContent. Digests are computed here from the published formula,
  // independently of the package's build.
  const SETS = "urn:aihq:catalog:release-sets:1.0.0";
  const UNDIGESTED = new Set(["id", "name", "description", "cost", "stability", "setSha256", "members"]);
  const bytewise = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
  const framework = (id, name) => ({ id, name, version: "1.0.0",
    description: `${name} content projected to release 1.6 for the release sets fixtures.` });
  const superpowersRelease = projectRelease16(subset("release/release-superpowers.json",
    ["superpowers.skill.test-driven-development", "superpowers.claude.hook.session-start"]), framework("superpowers", "Superpowers"));
  const variantSource = subset("release/release-superpowers.json",
    ["superpowers.skill.test-driven-development", "superpowers.claude.hook.session-start"]);
  // Behaviour-only change: one added optional dependency, no content byte changed.
  variantSource.items.find(item => item.id === "superpowers.skill.test-driven-development")
    .dependencies.optional.push({ itemId: "superpowers.claude.hook.session-start" });
  const variantRelease = projectRelease16(variantSource, framework("superpowers", "Superpowers"));
  const extensionsRelease = projectRelease16(subset("release/release-extensions.json",
    ["extensions.skill.security-and-hardening"]), framework("extensions", "Extensions"));
  const eccSource = read("release/release-ecc.json");
  const rules = language => eccSource.items.filter(item => item.id.startsWith(`ecc.rule.${language}.`)).map(item => item.id);
  const eccRelease = projectRelease16(subset("release/release-ecc.json",
    [...rules("common"), ...rules("typescript"), ...rules("python")]), framework("ecc", "ECC"));
  const context = (name, document) => {
    const path = `fixtures/release-sets/${name}-release-1.6.0.json`;
    write(path, document);
    return `@aihq/catalog/${path}`;
  };
  const contexts = {
    superpowers: context("superpowers", superpowersRelease),
    variant: context("superpowers-behaviour-variant", variantRelease),
    extensions: context("extensions", extensionsRelease),
    ecc: context("ecc", eccRelease),
  };
  const itemOf = (release, itemId) => release.items.find(item => item.id === itemId);
  const pin = (release, itemId) => ({ framework: release.framework.id, itemId,
    releaseVersion: release.framework.version, contentSha256: itemOf(release, itemId).contentSha256,
    behaviourSha256: itemOf(release, itemId).behaviourSha256 });
  // Builds set documents: fills same-release reference digests in declared order.
  const buildSets = (release, declarations) => {
    const built = new Map();
    const fill = refs => refs?.map(ref => ref.framework === release.framework.id ? { ...ref, setSha256: built.get(ref.setId) } : ref);
    const sets = declarations.map(declaration => {
      const set = structuredClone(declaration);
      for (const field of ["includes", "requires", "optional"]) if (set[field]) set[field] = fill(set[field]);
      for (const option of set.options ?? []) {
        if (option.always) option.always = fill(option.always);
        for (const choice of option.choices) choice.sets = fill(choice.sets);
      }
      const lines = set.members.map(({ item, optional, defaultOn }) => {
        const own = item.framework === release.framework.id;
        const identity = own ? itemOf(release, item.itemId) : item;
        return `${item.framework}\t${item.itemId}\t${identity.contentSha256}\t${identity.behaviourSha256}\t${optional}\t${defaultOn}\n`;
      }).sort(bytewise).join("");
      const rest = Object.fromEntries(Object.entries(set).filter(([key]) => !UNDIGESTED.has(key)));
      set.setSha256 = sha(Buffer.from(lines + canonical(rest)));
      built.set(set.id, set.setSha256);
      return set;
    });
    return { schema: SETS, release: { framework: release.framework.id, releaseVersion: release.framework.version }, sets };
  };
  const template = itemOf(read("release/release-superpowers.json"), "superpowers.template.reviewed-tdd");
  const reviewedTdd = (overrides = {}) => ({
    id: "reviewed-tdd",
    name: "Reviewed TDD",
    description: template.description,
    members: [
      { item: { framework: "superpowers", itemId: "superpowers.skill.test-driven-development" }, optional: false, defaultOn: true },
      { item: { framework: "superpowers", itemId: "superpowers.claude.hook.session-start" }, optional: true, defaultOn: false },
      { item: pin(extensionsRelease, "extensions.skill.security-and-hardening"), optional: false, defaultOn: true },
    ],
    offer: "pre-ticked",
    ...overrides,
  });
  const valid = buildSets(superpowersRelease, [reviewedTdd()]);
  const invalid = structuredClone(valid);
  invalid.sets[0].members[1] = { ...invalid.sets[0].members[1], optional: false, defaultOn: true };
  invalid.sets[0].members[2] = { ...invalid.sets[0].members[2],
    item: { framework: "extensions", itemId: "extensions.skill.security-and-hardening" } };
  const schemaExport = contractSupport.contracts.find(c => c.id === SETS)?.schemaExport;
  assert(schemaExport, `Undeclared ${SETS}`);
  for (const [document, ok] of [[valid, true], [invalid, false]]) {
    const path = `fixtures/release-sets-1.0.0-${ok ? "valid" : "invalid"}.json`;
    write(path, document);
    fixtures.push({ name: `release-sets-1.0.0-${ok ? "valid" : "invalid"}`, contract: SETS, version: "1.0.0",
      export: `@aihq/catalog/${path}`, schemaExport, reader: "release-sets", context: contexts.superpowers,
      provenance: ok
        ? "Superpowers reviewed-tdd as a set over real content: required TDD skill, optional session hook off by default, and Extensions security-and-hardening pinned by release version and both identities."
        : "The same set with its hook member required and the Extensions member unpinned. Schema-valid; the reader refuses both.",
      expected: ok ? { status: "accept" } : { status: "refuse", code: "INPUT_INVALID", reasons: ["hook-member-required", "member-unpinned"] },
      ...(ok ? {} : { validation: "reader" }),
    });
  }
  const scenario = (name, envelope, provenance) => {
    const path = `fixtures/release-sets/${name}.json`;
    write(path, { scenario: name, ...envelope });
    fixtures.push({ name, contract: SETS, version: "1.0.0", export: `@aihq/catalog/${path}`, schemaExport,
      reader: "release-sets-scenario", scenario: true, provenance, expected: { status: "accept" } });
  };
  // ECC-style profile: modules are sets, the profile picks languages; common rules always apply.
  const ref = setId => ({ framework: "ecc", setId });
  const eccSets = buildSets(eccRelease, [
    { id: "rules-common", name: "Common rules", description: "ECC rules/common.", offer: "pre-ticked",
      members: rules("common").map(itemId => ({ item: { framework: "ecc", itemId }, optional: false, defaultOn: true })) },
    { id: "rules-typescript", name: "TypeScript rules", description: "ECC rules/typescript.", offer: "listed",
      members: rules("typescript").map(itemId => ({ item: { framework: "ecc", itemId }, optional: false, defaultOn: true })) },
    { id: "rules-python", name: "Python rules", description: "ECC rules/python.", offer: "listed",
      members: rules("python").map(itemId => ({ item: { framework: "ecc", itemId }, optional: false, defaultOn: true })) },
    { id: "developer", name: "Developer profile", description: "ECC-style profile with a language choice.", offer: "pre-ticked",
      members: [], options: [{ id: "languages", name: "Languages and frameworks", always: [ref("rules-common")],
        choices: [{ id: "typescript", name: "TypeScript", sets: [ref("rules-typescript")] },
          { id: "python", name: "Python", sets: [ref("rules-python")] }] }] },
  ]);
  const developer = eccSets.sets.find(set => set.id === "developer");
  const inSet = options => ({ reasonIncluded: "in-set",
    set: { framework: "ecc", setId: "developer", setSha256: developer.setSha256 }, ...(options ? { options } : {}) });
  const closure = ids => [...new Set([...ids, ...ids.flatMap(id => itemOf(eccRelease, id).dependencies.requires.map(r => r.itemId))])].sort();
  scenario("ecc-typescript-choice", {
    releases: [contexts.ecc],
    sets: { release: contexts.ecc, document: eccSets },
    cases: [
      { name: "no-choice", request: { setId: "developer" },
        expect: { status: "ok", selections: closure(rules("common")),
          origins: { "ecc.rule.common.testing": [inSet()] } } },
      { name: "typescript", request: { setId: "developer", options: { languages: ["typescript"] } },
        expect: { status: "ok", selections: closure([...rules("common"), ...rules("typescript")]),
          origins: { "ecc.rule.common.testing": [inSet()],
            "ecc.rule.typescript.testing": [inSet({ languages: ["typescript"] })] } } },
      { name: "unknown-choice", request: { setId: "developer", options: { languages: ["rust"] } },
        expect: { status: "refused", reasons: ["set-option-unknown"] } },
    ],
  }, "ECC-style profile over real ECC rules: with no choice only rules/common applies; choosing TypeScript adds its rules with the option origin.");
  scenario("set-cycle", {
    build: { release: contexts.superpowers, sets: [
      { id: "a", name: "A", description: "Includes b.", offer: "listed", members: [], includes: [{ framework: "superpowers", setId: "b" }] },
      { id: "b", name: "B", description: "Requires a.", offer: "listed", members: [], requires: [{ framework: "superpowers", setId: "a" }] },
    ] },
    expect: { status: "refused", reasons: ["set-cycle"] },
  }, "Two sets that reference each other fail the build.");
  const outer = hookOn => buildSets(superpowersRelease, [
    reviewedTdd({ members: reviewedTdd().members.map((m, i) => i === 1 ? { ...m, defaultOn: hookOn } : m) }),
    { id: "starter", name: "Starter", description: "Includes reviewed-tdd.", offer: "listed", members: [],
      includes: [{ framework: "superpowers", setId: "reviewed-tdd" }] },
  ]);
  const vector = (name, release, document, setId) => ({ name, release, sets: document.sets.map(({ setSha256, ...set }) => {
    // Declarations carry no digests: same-release references are filled by the build.
    for (const field of ["includes", "requires", "optional"]) if (set[field]) set[field] = set[field].map(({ setSha256: _, ...r }) => r);
    return set;
  }), setId, setSha256: document.sets.find(set => set.id === setId).setSha256 });
  const pinChanged = reviewedTdd();
  pinChanged.members[2] = { ...pinChanged.members[2], item: { ...pinChanged.members[2].item, behaviourSha256: sha(Buffer.from("changed behaviour\n")) } };
  const vectors = [
    vector("reviewed-tdd", contexts.superpowers, valid, "reviewed-tdd"),
    vector("reviewed-tdd-display-only", contexts.superpowers,
      buildSets(superpowersRelease, [reviewedTdd({ name: "Renamed", description: "Reworded.", cost: { bytes: 1, chars: 1 }, stability: "deprecated" })]), "reviewed-tdd"),
    vector("reviewed-tdd-behaviour-only", contexts.variant, buildSets(variantRelease, [reviewedTdd()]), "reviewed-tdd"),
    vector("reviewed-tdd-cross-pin-changed", contexts.superpowers, buildSets(superpowersRelease, [pinChanged]), "reviewed-tdd"),
    vector("starter", contexts.superpowers, outer(false), "starter"),
    vector("starter-nested-changed", contexts.superpowers, outer(true), "starter"),
  ];
  const digest = name => vectors.find(v => v.name === name).setSha256;
  assert.equal(digest("reviewed-tdd-display-only"), digest("reviewed-tdd"));
  for (const changed of ["reviewed-tdd-behaviour-only", "reviewed-tdd-cross-pin-changed"]) assert.notEqual(digest(changed), digest("reviewed-tdd"));
  assert.notEqual(digest("starter-nested-changed"), digest("starter"));
  scenario("digest-vectors", {
    vectors,
    equal: [["reviewed-tdd", "reviewed-tdd-display-only"]],
    distinct: [["reviewed-tdd", "reviewed-tdd-behaviour-only"], ["reviewed-tdd", "reviewed-tdd-cross-pin-changed"], ["starter", "starter-nested-changed"]],
    behaviourOnly: { before: contexts.superpowers, after: contexts.variant, itemId: "superpowers.skill.test-driven-development" },
  }, "Deterministic set digests: display-only fields are outside; a behaviour-only member change, a changed cross-framework pin and a nested set change each change the digest.");
}
{
  // Source description 1.0: discovery data only. The base pair exercises one
  // authored golden description; every locator kind and every exact identity kind
  // is covered by the scenarios, executed through the public readers.
  const SD = "urn:aihq:catalog:source-description:1.0.0";
  const COMMIT = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
  const SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  // base64 of 64 zero bytes: one complete sha512 digest.
  const INTEGRITY = `sha512-${"A".repeat(86)}==`;
  const base = {
    schema: SD,
    id: "org-example",
    label: "Example organization MCP servers",
    publisher: "example-org",
    locator: { kind: "git", repository: "https://github.com/example/mcp-servers", ref: "main" },
  };
  add("source-description-1.0.0", SD, base, "source-description",
    "Authored golden source description: an organization's git source found at a mutable ref; discovery data only, never an exact identity.");
  const schemaExport = contractSupport.contracts.find((c) => c.id === SD)?.schemaExport;
  assert(schemaExport, `Undeclared ${SD}`);
  const sdScenario = (name, envelope, provenance) => {
    const path = `fixtures/source-description/${name}.json`;
    write(path, { scenario: name, ...envelope });
    fixtures.push({ name, contract: SD, version: "1.0.0", export: `@aihq/catalog/${path}`, schemaExport,
      reader: "source-description-scenario", scenario: true, provenance, expected: { status: "accept" } });
  };
  const accept = { status: "accept" };
  const refuse = (code, reason) => ({ status: "refuse", code, reason });
  const description = (id, label, locator, extra = {}) => ({ schema: SD, id, label, ...extra, locator });
  sdScenario("locator-kinds", {
    cases: [
      { name: "git-ref", document: base, expect: accept },
      { name: "git-default", document: description("src-git", "Git source", { kind: "git", repository: "https://github.com/example/skills" }), expect: accept },
      { name: "npm-exact-spec", document: description("src-npm", "npm source", { kind: "npm", package: "example-skill", versionSpec: "1.2.3" }), expect: accept },
      { name: "npm-mutable-spec", document: description("src-npm-latest", "npm source at latest", { kind: "npm", package: "example-skill", versionSpec: "latest" }), expect: accept },
      { name: "npm-no-spec", document: description("src-npm-bare", "npm source unversioned", { kind: "npm", package: "@scope/tool" }), expect: accept },
      { name: "local", document: description("src-local", "Local folder", { kind: "local", label: "my-agent-skills" }), expect: accept },
      {
        name: "organization-list",
        list: [
          description("org-list-git", "Organization git source", { kind: "git", repository: "https://github.com/example/org-skills", ref: "main" }, { publisher: "example-org" }),
          description("org-list-npm", "Organization npm source", { kind: "npm", package: "example-org-package" }, { publisher: "example-org" }),
        ],
        expect: accept,
      },
      { name: "git-http", document: description("src-http", "Plain http source", { kind: "git", repository: "http://github.com/example/mcp" }), expect: refuse("INPUT_INVALID", "repository-not-https") },
      { name: "git-ssh", document: description("src-ssh", "Ssh source", { kind: "git", repository: "git@github.com:example/mcp.git" }), expect: refuse("INPUT_INVALID", "repository-not-https") },
      { name: "git-malformed-port", document: description("src-port", "Malformed port source", { kind: "git", repository: "https://example.com:99999/repo" }), expect: refuse("INPUT_INVALID", "repository-not-https") },
      { name: "git-surrounding-whitespace", document: description("src-ws", "Whitespace-padded source", { kind: "git", repository: " https://example.com/repo" }), expect: refuse("INPUT_INVALID", "repository-not-https") },
      { name: "locator-kind-unknown", document: description("src-hg", "Mercurial source", { kind: "hg", repository: "https://example.com/src" }), expect: refuse("INPUT_INVALID", "invalid-locator-kind") },
      { name: "unknown-field", document: { ...description("src-extra", "Source with policy", { kind: "local", label: "folder" }), policy: "pre-ticked" }, expect: refuse("INPUT_INVALID", "unknown-field") },
      {
        name: "organization-list-with-policy",
        list: [description("org-list-policy", "Organization source", { kind: "local", label: "folder" }), { ...description("org-list-policy-2", "Organization source with policy", { kind: "local", label: "folder" }), policy: "members-only" }],
        expect: refuse("INPUT_INVALID", "unknown-field"),
      },
    ],
  }, "Every locator kind accepted as discovery data, including mutable specs; non-https git repositories, unknown kinds and unknown fields — including a would-be policy on an organization list — refused precisely.");
  sdScenario("exact-identity-kinds", {
    cases: [
      { name: "git-reachable", identity: { kind: "git", repository: "https://github.com/example/mcp", commit: COMMIT, reachable: true }, expect: accept },
      { name: "git-unreachable", identity: { kind: "git", repository: "https://github.com/example/mcp", commit: COMMIT, reachable: false }, expect: accept },
      { name: "git-unchecked", identity: { kind: "git", repository: "https://github.com/example/mcp", commit: COMMIT, reachable: "unchecked" }, expect: accept },
      { name: "npm", identity: { kind: "npm", package: "@scope/tool", version: "1.2.3", integrity: INTEGRITY }, expect: accept },
      { name: "local", identity: { kind: "local", captureSha256: SHA }, expect: accept },
      { name: "git-mutable-commit", identity: { kind: "git", repository: "https://github.com/example/mcp", commit: "main", reachable: true }, expect: refuse("INPUT_INVALID", "invalid-commit") },
      { name: "npm-range", identity: { kind: "npm", package: "tool", version: "^1.2.3", integrity: INTEGRITY }, expect: refuse("INPUT_INVALID", "version-not-exact") },
      { name: "npm-tag", identity: { kind: "npm", package: "tool", version: "latest", integrity: INTEGRITY }, expect: refuse("INPUT_INVALID", "version-not-exact") },
      { name: "npm-missing-integrity", identity: { kind: "npm", package: "tool", version: "1.2.3" }, expect: refuse("INPUT_INVALID", "missing-field") },
      { name: "npm-weak-integrity", identity: { kind: "npm", package: "tool", version: "1.2.3", integrity: "md5-dGVzdA==" }, expect: refuse("INPUT_INVALID", "invalid-integrity") },
      { name: "npm-short-integrity", identity: { kind: "npm", package: "tool", version: "1.2.3", integrity: "sha512-a" }, expect: refuse("INPUT_INVALID", "invalid-integrity") },
      { name: "git-not-https", identity: { kind: "git", repository: "git@github.com:example/mcp.git", commit: COMMIT, reachable: true }, expect: refuse("INPUT_INVALID", "repository-not-https") },
      { name: "git-malformed-port", identity: { kind: "git", repository: "https://example.com:99999/repo", commit: COMMIT, reachable: true }, expect: refuse("INPUT_INVALID", "repository-not-https") },
      { name: "git-surrounding-whitespace", identity: { kind: "git", repository: " https://example.com/repo", commit: COMMIT, reachable: true }, expect: refuse("INPUT_INVALID", "repository-not-https") },
      { name: "kind-unknown", identity: { kind: "archive", sha256: SHA }, expect: refuse("INPUT_INVALID", "invalid-kind") },
      { name: "unknown-field", identity: { kind: "local", captureSha256: SHA, policy: "members-only" }, expect: refuse("INPUT_INVALID", "unknown-field") },
      { name: "local-bad-sha", identity: { kind: "local", captureSha256: "nope" }, expect: refuse("INPUT_INVALID", "invalid-sha256") },
      { name: "description-is-not-identity", identity: { kind: "git", repository: "https://github.com/example/mcp", ref: COMMIT }, expect: refuse("INPUT_INVALID", "missing-field") },
    ],
  }, "Every exact identity kind accepted with its exactness; mutable references, ranges and tags, non-https repositories, unknown kinds and unknown fields refused precisely; a source description is never an exact identity.");
  // Release 1.7 over real content: the three per-tool copies of Matt's grill-me and
  // grilling in the committed Extensions release, projected to release 1.6 with
  // source-relative paths, then collapsed by the public transition build into one
  // tool-neutral item each. The frozen default's grill-me is superseded by name and
  // source path; a split spreads the default's project context over three survivors.
  const bytewise = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
  const { compileTransitionRelease } = await import("../dist/release/producer.js");
  const { readRelease, readReleaseContent } = await import("../dist/release/reader.js");
  const REVISION = /^[0-9a-f]{40}$/;
  const sourcePathOf = (path) => {
    const parts = path.split("/").slice(2);
    const revision = parts.findIndex((part) => REVISION.test(part));
    return revision >= 0 ? parts.slice(revision + 1).join("/") : parts.slice(2).join("/");
  };
  const sourceIdOf = (release, path) => {
    const parts = path.split("/").slice(2);
    const repository = `https://${parts.slice(0, 3).join("/")}`;
    return release.sources.find((source) => source.origin.repository === repository)?.id;
  };
  const project16 = (release, framework, ids, shape) => {
    const doc = { schema: "urn:aihq:catalog:release:1.6.0", package: release.package, framework,
      sources: release.sources.map((source) => ({ ...source, license: "MIT" })), items: [] };
    for (const id of ids) {
      const item = structuredClone(release.items.find((candidate) => candidate.id === id));
      assert(item, `Missing real item ${id}`);
      const { payload, root, kind, source, selectedBy, sourceIds } = shape(item);
      const executable = {};
      const content = item.materials.map((member) => {
        const sourcePath = sourcePathOf(member.path);
        const relPath = root && sourcePath.startsWith(`${root}/`) ? sourcePath.slice(root.length + 1) : sourcePath.split("/").at(-1);
        executable[relPath] = "unknown";
        return { id: member.id, relPath, sourcePath, packagePath: member.path, sha256: member.sha256,
          byteLength: member.byteLength, executable: "unknown",
          sourceId: sourceIdOf(release, member.path) ?? item.sourceIds[0], role: "content" };
      });
      const sortedExecutable = Object.fromEntries(Object.entries(executable).sort(([a], [b]) => (a < b ? -1 : 1)));
      const behaviourText = `${canonical({ kind: kind ?? item.kind, payload: payload ?? null, requirements: { inputs: {} },
        dependencies: { requires: item.dependencies.requires ?? [], optional: item.dependencies.optional ?? [], conflicts: item.dependencies.conflicts ?? [] },
        executable: sortedExecutable })}\n`;
      const behaviour = { id: "behaviour", relPath: "aih-behaviour.json", sourcePath: null,
        packagePath: `release/items/${item.id}/aih-behaviour.json`, sha256: sha(Buffer.from(behaviourText)),
        byteLength: Buffer.byteLength(behaviourText), executable: false, sourceId: framework.id, role: "behaviour" };
      const lines = (members) => members.map((m) => `${m.relPath}\t${m.sha256}\n`).sort(bytewise);
      const materials = [...content, behaviour].sort((a, b) => (a.id < b.id ? -1 : 1));
      const { metadata: _metadata, ...rest } = item;
      // Per-tool copies share one name, which 1.6 allows only on one item: copies carry labels.
      doc.items.push({ ...rest, ...(kind ? { kind } : {}), ...(sourceIds ? { sourceIds } : {}), materials, source, ...(selectedBy ? { selectedBy } : {}),
        ...(payload ? { payload } : {}), requirements: { inputs: {} }, executable: sortedExecutable,
        contentSha256: sha(Buffer.from(lines(content).join(""))),
        behaviourSha256: sha(Buffer.from(lines(materials).join(""))) });
    }
    doc.items.sort((a, b) => (a.id < b.id ? -1 : 1));
    return doc;
  };
  const MATT = "https://github.com/mattpocock/skills";
  const EXT = "https://github.com/samartomar/aih-extensions";
  const extensionsSource = read("release/release-extensions.json");
  const tools = [["", "claude-code"], ["kiro.", "kiro-ide"], ["copilot.", "copilot-vscode"]];
  const skills = ["grill-me", "grilling"];
  const copies16 = project16(extensionsSource,
    { id: "extensions", name: "Extensions", version: "1.0.0", description: "Golden Extensions copies in release 1.6: one copy per tool." },
    ["extensions.notices", ...skills.flatMap((skill) => tools.map(([tool]) => `extensions.${tool}matt.${skill}`))],
    (item) => item.kind === "skill"
      ? { root: sourcePathOf(item.materials.find((m) => m.path.endsWith("/SKILL.md")).path).replace(/\/SKILL\.md$/, ""),
          payload: { dirName: item.label, invocation: "model-allowed", invocationBasis: "default" },
          source: MATT, selectedBy: EXT }
      : { source: EXT });
  const read16 = (document) => {
    const result = readReleaseContent(bytes(document), { expectedSha256: sha(bytes(document)) });
    assert(result.valid, JSON.stringify(result.diagnostics));
    return result.release;
  };
  const copiesRelease = read16(copies16);
  const frozenBytes = readFileSync(resolve(root, "release/release.json"));
  const frozen = readRelease(frozenBytes, { expectedSha256: sha(frozenBytes) });
  assert(frozen.valid, JSON.stringify(frozen.diagnostics));
  const frozenItem = (id) => frozen.release.items.find((item) => item.id === id);
  const transition = (overrides = {}) => compileTransitionRelease({
    releases: { [copiesRelease.sha256]: copiesRelease, [frozen.release.sha256]: frozen.release },
    earlier: [copiesRelease.sha256],
    framework: { id: "extensions", name: "Extensions", version: "1.1.0", description: "Golden Extensions release 1.7: one tool-neutral item per piece of content." },
    package: copiesRelease.package,
    items: [
      ...skills.map((skill) => ({
        id: `extensions.matt.${skill}`, kind: "skill", role: "choosable", name: skill, nameBasis: "authored", descriptionBasis: "authored",
        copies: tools.map(([tool, clientId]) => ({ releaseSha256: copiesRelease.sha256, itemId: `extensions.${tool}matt.${skill}`, clientId })),
        hints: { tools: ["claude-code", "copilot-vscode", "kiro-ide"] },
        supersedes: [{ match: "name+sourcePath", releaseSha256: frozen.release.sha256, itemId: `mattpocock.${skill}`,
          itemSha256: frozenItem(`mattpocock.${skill}`).itemSha256, name: skill,
          sourcePath: `skills/productivity/${skill}/SKILL.md` }],
        ...overrides[skill],
      })),
      { id: "extensions.notices", kind: "document", purpose: "notice", role: "supporting", name: "Extensions notices", nameBasis: "publisher",
        copies: [{ releaseSha256: copiesRelease.sha256, itemId: "extensions.notices" }] },
    ],
    sets: [{ id: "productivity", name: "Productivity", description: "Matt's productivity skills.", offer: "pre-ticked",
      members: skills.map((skill) => ({ item: { framework: "extensions", itemId: `extensions.matt.${skill}` }, optional: false, defaultOn: true })),
      firstRun: { framework: "extensions", itemId: "extensions.matt.grill-me" } }],
  });
  const compiled = transition();
  assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics));
  const release17 = compiled.value.release;
  assert.equal(release17.items.filter((item) => item.name === "grill-me").length, 1);
  // The 1.7.0 golden fixture: the compiled content plus a test-only evidence binding.
  const content17 = JSON.parse(Buffer.from(compiled.value.releaseBytes).toString("utf8"));
  const inventory17 = createContentInventory(compiled.value.releaseBytes, { expectedSha256: compiled.value.releaseSha256 });
  assert(inventory17.valid, JSON.stringify(inventory17));
  assert.equal(inventory17.inventory.schema, "urn:aihq:catalog:content-inventory:1.2.0");
  const document17 = { ...content17, baseline: {
    schema: "urn:aihq:catalog:scan-baseline:1.0.0",
    inventory: { path: "fixtures/bound-inventory-1.2.0.json", sha256: inventory17.sha256, byteLength: inventory17.byteLength },
    scanId: `scan:sha256:${"a".repeat(64)}`,
    artifact: { sha256: sha(Buffer.from("fixture evidence 1.7\n")), byteLength: 20, location: { kind: "package", path: "fixtures/baseline-evidence.txt" } },
    scope: { namespace: "package-relative", paths: ["release"], excludedPaths: [] },
  } };
  write("fixtures/bound-inventory-1.2.0.json", inventory17.inventory);
  add("content-inventory-1.2.0", inventory17.inventory.schema, inventory17.inventory, "inventory", "Real Extensions grill-me/grilling copies collapsed to release 1.7 before evidence; behaviour files, transition recipes and supersession included.");
  add("release-content-1.2.0", inventory17.inventory.projection, inventory17.inventory.release, "projection", "Real Extensions release 1.7 content projection: one item per content, recipe map, sets and retirement.");
  add("release-1.7.0", document17.schema, document17, "release", "Real Extensions grill-me and grilling: three per-tool copies each collapse to one tool-neutral item with a recipe per client, supersede the frozen default's copies by name and source path, and carry a test-only evidence binding.");
  // Release 1.6 and 1.7 documents of one framework coexisting, with hash vectors.
  const copiesPath = "fixtures/release-1-7/extensions-copies-release-1.6.0.json";
  write(copiesPath, copies16);
  const releasePath = "fixtures/release-1-7/extensions-release-1.7.0.json";
  write(releasePath, content17);
  // Declarations only: hints, fallback and variantOf move itemSha256, never the identities.
  const declared = transition({ "grill-me": { hints: { tools: ["claude-code"] }, variantOf: { itemId: "extensions.matt.grilling" } } });
  assert.equal(declared.status, "ok", JSON.stringify(declared.diagnostics));
  const vectorOf = (path, release) => ({ export: `@aihq/catalog/${path}`, schema: release.schema, releaseSha256: release.sha256,
    items: release.items.map((item) => ({ id: item.id, itemSha256: item.itemSha256, contentSha256: item.contentSha256, behaviourSha256: item.behaviourSha256 })) });
  const grill = (release) => release.items.find((item) => item.id === "extensions.matt.grill-me");
  assert.equal(grill(declared.value.release).contentSha256, grill(release17).contentSha256);
  assert.equal(grill(declared.value.release).behaviourSha256, grill(release17).behaviourSha256);
  assert.notEqual(grill(declared.value.release).itemSha256, grill(release17).itemSha256);
  const fixture17 = (name, envelope, provenance) => {
    const path = `fixtures/release-1-7/${name}.json`;
    write(path, { scenario: name, ...envelope });
    fixtures.push({ name, contract: "urn:aihq:catalog:release:1.7.0", version: "1.7.0", export: `@aihq/catalog/${path}`,
      schemaExport: "@aihq/catalog/schemas/release/1.7.0.json", reader: "release-1-7-scenario", scenario: true,
      provenance, expected: { status: "accept" } });
  };
  fixture17("hash-vectors", {
    releases: [vectorOf(copiesPath, copiesRelease), vectorOf(releasePath, release17)],
    frozenDefault: { export: "@aihq/catalog/release.json", releaseSha256: frozen.release.sha256 },
    declarationsOnly: { itemId: "extensions.matt.grill-me", changed: { hints: { tools: ["claude-code"] }, variantOf: { itemId: "extensions.matt.grilling" } },
      itemSha256: grill(declared.value.release).itemSha256, contentSha256: grill(release17).contentSha256, behaviourSha256: grill(release17).behaviourSha256 },
  }, "Release 1.6 copies and their release 1.7 collapse coexisting in one package, with deterministic digests; declarations move only itemSha256.");
  // A split: the frozen default's project context spread over three survivors.
  const basicsSource = read("release/release.json");
  const contextItem = basicsSource.items.find((item) => item.id === "aihq.project-context");
  const parts = [["fixture-basics.router", "document", "rule-router", { files: ["rule-router"] }],
    ["fixture-basics.working-rules", "rule", "behavior-core", { applyTo: ["**"], applyToBasis: "publisher", placement: "project-folder" }],
    ["fixture-basics.shared-block", "rule", "shared-block", { applyTo: ["**"], applyToBasis: "publisher", placement: "entry-block" }]];
  const basicsInput = { ...basicsSource, sources: basicsSource.sources.filter((source) => contextItem.sourceIds.includes(source.id)),
    items: parts.map(([id, kind, member]) => ({ ...contextItem, id, kind, label: id.split(".")[1],
      materials: contextItem.materials.filter((m) => m.id === member), dependencies: { requires: [], optional: [], conflicts: [] } })) };
  const basics16 = project16(basicsInput,
    { id: "fixture-basics", name: "Fixture basics", version: "1.0.0", description: "Golden split fixture over the frozen default's project context." },
    parts.map(([id]) => id),
    (item) => ({ payload: parts.find(([id]) => id === item.id)[3], source: "https://github.com/samartomar/aih-catalog" }));
  for (const source of basics16.sources) source.license = "Apache-2.0";
  const basicsRelease = read16(basics16);
  const split = compileTransitionRelease({
    releases: { [basicsRelease.sha256]: basicsRelease, [frozen.release.sha256]: frozen.release },
    earlier: [basicsRelease.sha256],
    framework: { id: "fixture-basics", name: "Fixture basics", version: "1.1.0", description: "Golden split fixture: one earlier item spread over three survivors." },
    package: basicsRelease.package,
    items: parts.map(([id, kind]) => ({ id, kind, role: "choosable", name: id.split(".")[1], nameBasis: "publisher", ...(kind === "document" ? { purpose: "guide" } : {}),
      copies: [{ releaseSha256: basicsRelease.sha256, itemId: id }],
      supersedes: [{ match: "split", releaseSha256: frozen.release.sha256, itemId: "aihq.project-context", itemSha256: frozenItem("aihq.project-context").itemSha256 }] })),
  });
  assert.equal(split.status, "ok", JSON.stringify(split.diagnostics));
  const splitPath = "fixtures/release-1-7/split-supersession-release-1.7.0.json";
  write(splitPath, JSON.parse(Buffer.from(split.value.releaseBytes).toString("utf8")));
  fixture17("split-supersession", {
    release: `@aihq/catalog/${splitPath}`, earlier: { export: "@aihq/catalog/release.json", itemId: "aihq.project-context" },
    survivors: parts.map(([id]) => id),
  }, "The frozen default's project context spread over three survivors by split supersession.");
  // Project basics: the prepared release 1.7.0 content, unchanged, with a test-only
  // evidence binding over its shipped content inventory. Not an assessment.
  const basicsContentPath = "release/release-project-basics.content.json";
  const basicsInventoryPath = "release/baselines/project-basics/content-inventory.json";
  const basicsContent = readFileSync(resolve(root, basicsContentPath));
  const basicsInventory = readFileSync(resolve(root, basicsInventoryPath));
  const basicsFrozen = createContentInventory(basicsContent, { expectedSha256: sha(basicsContent) });
  assert(basicsFrozen.valid && Buffer.from(basicsFrozen.bytes).equals(basicsInventory), "Stale Project basics inventory; run node tools/generate-project-basics-release.mjs");
  const basicsPath = "fixtures/release-1-7/project-basics-release-1.7.0.json";
  write(basicsPath, { ...JSON.parse(basicsContent.toString("utf8")), baseline: {
    schema: "urn:aihq:catalog:scan-baseline:1.0.0",
    inventory: { path: basicsInventoryPath, sha256: sha(basicsInventory), byteLength: basicsInventory.byteLength },
    scanId: `scan:sha256:${"a".repeat(64)}`,
    artifact: { sha256: sha(Buffer.from("fixture evidence 1.7\n")), byteLength: 20, location: { kind: "package", path: "fixtures/baseline-evidence.txt" } },
    scope: { namespace: "package-relative", paths: ["release"], excludedPaths: [] },
  } });
  fixtures.push({ name: "project-basics-release-1.7.0", contract: "urn:aihq:catalog:release:1.7.0", version: "1.7.0",
    export: `@aihq/catalog/${basicsPath}`, schemaExport: "@aihq/catalog/schemas/release/1.7.0.json", reader: "release",
    provenance: "The Project basics release 1.7.0 content exactly as shipped (router guide, working rules, shared block), with a test-only evidence binding over its shipped content inventory; it claims no authenticated assessment.",
    expected: { status: "accept" } });
}
write("fixtures/manifest.json", { schema: "urn:aihq:catalog:fixture-manifest:1.0.0", package: contractSupport.package, fixtures });
write("package-support.json", contractSupport);
write("package-support-1.1.json", contractSupport11);
