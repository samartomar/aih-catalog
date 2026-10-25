import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

// Run Core's public checkContracts between the packed Catalog and a reviewed Core artifact,
// loading every fixture through the producing package's exports inside an outside consumer.
assert(
  process.argv.length === 3 || process.argv.length === 4,
  "Usage: node tools/verify-contract-checks.mjs <core-tarball> [catalog-tarball]",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreTarball = resolve(process.argv[2]);
assert(existsSync(coreTarball), "The supplied Core artifact must exist.");
const suppliedCatalog = process.argv[3] && resolve(process.argv[3]);
assert(!suppliedCatalog || existsSync(suppliedCatalog), "The supplied Catalog artifact must exist.");
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const npm = [
  process.env.npm_execpath,
  resolve(process.execPath, "..", "node_modules/npm/bin/npm-cli.js"),
  resolve(process.execPath, "../..", "lib/node_modules/npm/bin/npm-cli.js"),
].find(
  (candidate) =>
    candidate &&
    isAbsolute(candidate) &&
    basename(candidate) === "npm-cli.js" &&
    existsSync(candidate),
);
assert(npm, "Use a Node distribution with adjacent npm, or invoke through npm.");
const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-contract-checks-"));
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"),
);
const runNpm = (args, cwd) =>
  execFileSync(process.execPath, [npm, ...args], {
    cwd,
    env: environment,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
try {
  // The offline install needs Core's dependencies from the caller's npm cache.
  environment.npm_config_cache ??= runNpm(["config", "get", "cache"], fixture).trim();
  const catalogTarball =
    suppliedCatalog ??
    join(
      fixture,
      JSON.parse(
        runNpm(["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", fixture], root),
      )[0].filename,
    );
  const coreSha256 = hash(coreTarball);
  const catalogSha256 = hash(catalogTarball);
  const consumer = join(fixture, "consumer");
  seedConsumerLock(consumer, root);
  runNpm(
    ["install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund", catalogTarball, coreTarball],
    consumer,
  );
  assert.equal(hash(coreTarball), coreSha256, "The installed Core artifact must retain its digest.");
  assert.equal(hash(catalogTarball), catalogSha256, "The installed Catalog artifact must retain its digest.");
  writeFileSync(
    join(consumer, "check.mjs"),
    String.raw`
import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { checkContracts, contractSupport as coreSupport, validateRecipe } from "@aihq/core/contracts";
import { contractSupport, contractSupport11 } from "@aihq/catalog/contracts";
import { readRecipe } from "@aihq/catalog/node";
import { checkProducerDeclaration } from "@aihq/catalog/producer";

const decode = (bytes) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
const verdict = (accepted, diagnostics) =>
  accepted ? { accepted: true } : { accepted: false, code: diagnostics[0]?.code };
// Each accepting package reads with its own public reader.
const readers = {
  "@aihq/catalog": (id) =>
    id.startsWith("urn:aihq:core:recipe:")
      ? (bytes) => { const r = readRecipe(bytes); return verdict(r.valid, r.diagnostics); }
      : id.startsWith("urn:aihq:catalog:producer-declaration:")
        ? (bytes) => { const r = checkProducerDeclaration(JSON.parse(decode(bytes))); return verdict(r.status === "ok", r.diagnostics); }
        : undefined,
  // Core exports no byte reader for recipes; its validator takes the parsed value.
  "@aihq/core": (id) =>
    id.startsWith("urn:aihq:core:recipe:")
      ? (bytes) => { const r = validateRecipe(JSON.parse(decode(bytes))); return verdict(r.valid, r.diagnostics); }
      : undefined,
};
const loadFixture = (packageName, specifier) => {
  if (!specifier.startsWith(packageName + "/")) return "unavailable";
  try {
    // A package need not export its package.json; the install layout names its root.
    const packageRoot = realpathSync(join(import.meta.dirname, "node_modules", ...packageName.split("/")));
    const path = realpathSync(fileURLToPath(import.meta.resolve(specifier)));
    const inside = relative(packageRoot, path);
    if (!inside || inside.startsWith("..") || isAbsolute(inside)) return "unavailable";
    return new Uint8Array(readFileSync(path));
  } catch {
    return "unavailable";
  }
};
// One engine call per accepting package, keeping only that package's rows.
const run = async (declarations) => {
  const rows = [];
  for (const reader of declarations) {
    const name = reader.package.name;
    const bound = Object.fromEntries(reader.contracts.map(({ id }) => [id, readers[name]?.(id)]).filter(([, r]) => r));
    const result = await checkContracts({ declarations, readers: bound, loadFixture });
    assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
    rows.push(...result.checks.filter((check) => check.readerPackage === name));
  }
  return rows;
};

const current = await run([coreSupport, contractSupport11]);
assert(current.length > 0, "No cross-package rows were derived.");
for (const row of current) assert.equal(row.status, "passed", JSON.stringify(row));
const fromCatalog = current.filter((row) => row.fixturePackage === "@aihq/catalog");
const byCatalog = current.filter((row) => row.readerPackage === "@aihq/catalog");
assert(fromCatalog.length > 0 && byCatalog.length > 0, "Both directions must be exercised.");
// Every Catalog fixture for a contract Core accepts was loaded and read by Core.
const coreAccepts = new Set(coreSupport.contracts.filter((c) => c.role !== "produces").map((c) => c.id));
const expectedLoads = contractSupport11.contracts
  .filter((c) => coreAccepts.has(c.id))
  .flatMap((c) => c.fixtures.map((f) => f.export));
assert.deepEqual(fromCatalog.map((row) => row.fixtureExport).sort(), [...expectedLoads].sort());

// Every fixture the 1.1 declaration references loads through the package's exports.
const referenced = contractSupport11.contracts.flatMap((c) => c.fixtures.map((f) => f.export));
for (const specifier of referenced) {
  assert(ArrayBuffer.isView(loadFixture("@aihq/catalog", specifier)), "Unavailable fixture: " + specifier);
}

// A support 1.0 consumer still validates; it publishes no fixtures, which Core reports precisely.
const legacy = await run([coreSupport, contractSupport]);
const legacyFromCatalog = legacy.filter((row) => row.fixturePackage === "@aihq/catalog");
assert(legacyFromCatalog.length > 0);
for (const row of legacyFromCatalog) {
  assert.deepEqual([row.status, row.reason], ["unavailable", "fixtures-missing"], JSON.stringify(row));
}

process.stdout.write(JSON.stringify({
  declarations: [coreSupport.schema, contractSupport11.schema],
  packages: [coreSupport.package, contractSupport11.package],
  rows: current.length,
  passed: current.filter((row) => row.status === "passed").length,
  readByCatalog: byCatalog.map((row) => row.fixtureExport).sort(),
  readByCore: fromCatalog.map((row) => row.fixtureExport).sort(),
  referencedFixturesLoaded: referenced.length,
  legacyFixturesMissing: legacyFromCatalog.length,
}) + "\n");
`,
  );
  const output = execFileSync(process.execPath, [join(consumer, "check.mjs")], {
    cwd: consumer,
    env: environment,
    encoding: "utf8",
    timeout: 120_000,
  });
  const result = JSON.parse(output);
  process.stdout.write(
    `${JSON.stringify({ core: { sha256: coreSha256 }, catalog: { sha256: catalogSha256 }, ...result }, null, 2)}\n`,
  );
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
