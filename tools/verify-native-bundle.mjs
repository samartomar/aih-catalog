import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

// Preparation proof for the Claude graph-fixture NativeVerificationBundle. It packs this
// checkout, installs the supplied Core artifact and the packed Catalog into a disposable
// consumer with lifecycle scripts disabled, validates the bundle with that Core's portable
// validators, checks every pinned member in the packed archive, and proves the recipe through
// Core Prepare, review and Apply into an empty disposable project. It never chooses a registry
// version, starts an AI client, calls verifyNativeClient or touches a real home or client
// configuration, and it publishes nothing. The scenario lives in tools/native-bundle-scenario.mjs.
//
//   node tools/verify-native-bundle.mjs <core-tarball> [--evidence <file>] [--scenario-node <node>]
//
// Core Prepare admits work only under Node 24.15 or newer 24.x. Packing and installing run under the
// Node that starts this tool; --scenario-node names the Node executable that runs the consumer scenario
// when the starting Node is outside that range. The record names the version the scenario ran under.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usage = "Usage: node tools/verify-native-bundle.mjs <core-tarball> [--evidence <file>] [--scenario-node <node>]";
const positional = [];
let evidencePath;
let scenarioNode = process.execPath;
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === "--evidence") {
    assert(evidencePath === undefined && index + 1 < argv.length, usage);
    evidencePath = resolve(argv[++index]);
  } else if (argv[index] === "--scenario-node") {
    assert(scenarioNode === process.execPath && index + 1 < argv.length, usage);
    scenarioNode = resolve(argv[++index]);
  } else {
    assert(!argv[index].startsWith("-"), usage);
    positional.push(argv[index]);
  }
}
assert.equal(positional.length, 1, usage);
const coreTarball = resolve(positional[0]);
assert(existsSync(coreTarball), "The supplied Core artifact must exist.");
assert(existsSync(scenarioNode), "The scenario Node executable must exist.");
const scenarioNodeVersion = execFileSync(scenarioNode, ["-v"], { encoding: "utf8", timeout: 20_000 }).trim();
const npm = [
  process.env.npm_execpath,
  resolve(process.execPath, "..", "node_modules/npm/bin/npm-cli.js"),
  resolve(process.execPath, "../..", "lib/node_modules/npm/bin/npm-cli.js"),
].find((candidate) => candidate && isAbsolute(candidate) &&
  basename(candidate) === "npm-cli.js" && existsSync(candidate));
assert(npm, "Use a Node distribution with adjacent npm, or invoke through npm.");
const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-native-bundle-"));
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const coreSha256 = hash(coreTarball);
const environment = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"));
const home = join(fixture, "home");
mkdirSync(home);
environment.HOME = home;
environment.USERPROFILE = home;
const runNpm = (args, cwd) => execFileSync(process.execPath, [npm, ...args], {
  cwd, env: environment, encoding: "utf8", timeout: 180_000, maxBuffer: 32 * 1024 * 1024,
});

try {
  const [packed] = JSON.parse(runNpm([
    "pack", "--ignore-scripts", "--offline", "--json", "--pack-destination", fixture,
  ], root));
  assert(packed?.filename, "Packing must yield one exact Catalog artifact.");
  const catalogTarball = join(fixture, packed.filename);
  const catalogSha256 = hash(catalogTarball);
  const consumer = join(fixture, "consumer");
  seedConsumerLock(consumer, root);
  runNpm([
    "install", "--prefix", consumer, "--ignore-scripts", "--offline",
    "--no-audit", "--no-fund", coreTarball, catalogTarball,
  ], fixture);
  assert.equal(hash(coreTarball), coreSha256, "The Core artifact must not change.");
  assert.equal(hash(catalogTarball), catalogSha256, "The Catalog artifact must not change.");
  const scenario = join(consumer, "scenario.mjs");
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "native-bundle-scenario.mjs"), scenario);
  const result = JSON.parse(execFileSync(scenarioNode, [scenario, catalogTarball, coreTarball], {
    cwd: consumer, env: environment, encoding: "utf8", timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
  }));
  assert.equal(result.core.sha256, coreSha256);
  assert.equal(result.catalog.sha256, catalogSha256);
  const record = {
    schema: "aihq-catalog-native-bundle-preparation",
    version: 1,
    issue: "https://github.com/samartomar/aih-catalog/issues/53",
    scope: "test-configuration",
    client: "claude",
    environment: { node: process.version, scenarioNode: scenarioNodeVersion, platform: process.platform, arch: process.arch },
    coreArtifact: result.core,
    catalogArtifact: result.catalog,
    join: result.join,
    derivation: result.derivation,
    checks: result.checks,
    nativeExecution: false,
    admittedCells: 0,
    notes: [
      "No AI client was started and verifyNativeClient was not called; this is recipe and bundle preparation only.",
      "policySha256, reviewSha256 and runResultSha256 describe one disposable run and change with each run; every other digest is fixed by the artifacts.",
      "A passing recipe proves the pinned output bytes only. It does not show a client loads the configuration, approves the project server or persists it.",
    ],
  };
  const text = `${JSON.stringify(record, null, 2)}\n`;
  assert(!/(?<![A-Za-z])[A-Za-z]:[\\/]|[\\/]Users[\\/]|[\\/]tmp[\\/]/.test(text), "The evidence must not contain a machine path.");
  if (evidencePath !== undefined) writeFileSync(evidencePath, text);
  process.stdout.write(text);
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  // mkdtemp supplied this exact task-owned root; no caller path is removed.
  assert(fixture.startsWith(join(tmpdir(), "aih-catalog-native-bundle-")));
  rmSync(fixture, { recursive: true, force: true });
}
