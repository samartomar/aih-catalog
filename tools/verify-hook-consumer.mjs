import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

// Packed Catalog reader -> configured selection -> packed Core public Prepare/Apply and CLI,
// for the owned hook group in the 1.1 release. The caller supplies a reviewed Core artifact
// that supports recipe and execution-policy 1.1; this check never chooses a registry version,
// imports a source checkout or publishes either package. The scenario itself lives in
// tools/hook-consumer-scenario.mjs and runs inside a disposable consumer.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// With --legacy-core <core-tarball> (a Core without recipe 1.1) the same Catalog is also
// installed beside that Core to show it reports the hook item as unsupported and writes nothing.
const usage = "Usage: node tools/verify-hook-consumer.mjs <core-tarball> [<catalog-tarball>] " +
  "[--legacy-core <core-tarball>]";
const positional = [];
let legacyArtifact;
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === "--legacy-core") {
    assert(legacyArtifact === undefined && index + 1 < argv.length, usage);
    legacyArtifact = argv[++index];
  } else {
    assert(!argv[index].startsWith("-"), usage);
    positional.push(argv[index]);
  }
}
assert(positional.length >= 1 && positional.length <= 2, usage);
const [coreArtifact, catalogArtifact] = positional;
const coreTarball = resolve(coreArtifact);
assert(existsSync(coreTarball), "The supplied Core artifact must exist.");
const npm = [
  process.env.npm_execpath,
  resolve(process.execPath, "..", "node_modules/npm/bin/npm-cli.js"),
  resolve(process.execPath, "../..", "lib/node_modules/npm/bin/npm-cli.js"),
].find((candidate) => candidate && isAbsolute(candidate) &&
  basename(candidate) === "npm-cli.js" && existsSync(candidate));
assert(npm, "Use a Node distribution with adjacent npm, or invoke through npm.");
const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-hook-consumer-"));
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const coreSha256 = hash(coreTarball);
const environment = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"));
const home = join(fixture, "home");
mkdirSync(home);
environment.HOME = home;
environment.USERPROFILE = home;
const runNpm = (args, cwd) => execFileSync(process.execPath, [npm, ...args], {
  cwd, env: environment, encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
});

try {
  let catalogTarball;
  if (catalogArtifact) {
    catalogTarball = resolve(catalogArtifact);
    assert(existsSync(catalogTarball), "The supplied Catalog artifact must exist.");
  } else {
    const [packed] = JSON.parse(runNpm([
      "pack", "--ignore-scripts", "--offline", "--json", "--pack-destination", fixture,
    ], root));
    assert(packed?.filename, "Packing must yield one exact Catalog artifact.");
    catalogTarball = join(fixture, packed.filename);
  }
  const catalogSha256 = hash(catalogTarball);
  const consumer = join(fixture, "consumer");
  seedConsumerLock(consumer, root);
  runNpm([
    "install", "--prefix", consumer, "--ignore-scripts", "--offline",
    "--no-audit", "--no-fund", coreTarball, catalogTarball,
  ], fixture);
  assert.equal(hash(coreTarball), coreSha256);
  assert.equal(hash(catalogTarball), catalogSha256);
  const scenario = join(consumer, "scenario.mjs");
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "hook-consumer-scenario.mjs"), scenario);
  const result = JSON.parse(execFileSync(process.execPath, [scenario], {
    cwd: consumer, env: environment, encoding: "utf8", timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
  }));
  let legacy;
  if (legacyArtifact !== undefined) {
    const legacyTarball = resolve(legacyArtifact);
    assert(existsSync(legacyTarball), "The supplied legacy Core artifact must exist.");
    const legacyConsumer = join(fixture, "legacy-consumer");
    seedConsumerLock(legacyConsumer, root);
    runNpm([
      "install", "--prefix", legacyConsumer, "--ignore-scripts", "--offline",
      "--no-audit", "--no-fund", legacyTarball, catalogTarball,
    ], fixture);
    const legacyScenario = join(legacyConsumer, "scenario.mjs");
    copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "hook-legacy-core-scenario.mjs"), legacyScenario);
    legacy = { ...JSON.parse(execFileSync(process.execPath, [legacyScenario], {
      cwd: legacyConsumer, env: environment, encoding: "utf8", timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
    })), coreSha256: hash(legacyTarball) };
  }
  console.log(JSON.stringify({ ...result, coreSha256, catalogSha256, ...(legacy ? { legacy } : {}) }, null, 2));
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  // mkdtemp supplied this exact task-owned root; no caller path is removed.
  assert(fixture.startsWith(join(tmpdir(), "aih-catalog-hook-consumer-")));
  rmSync(fixture, { recursive: true, force: true });
}
