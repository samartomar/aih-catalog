import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

// Packed Catalog reader -> configured selection -> packed Core public Prepare/Apply and CLI,
// for the owned Guide file family. The caller supplies a reviewed Core artifact
// that supports generic file custody; this check never chooses a registry version,
// imports a source checkout or publishes either package. The scenario itself lives in
// tools/guide-consumer-scenario.mjs and runs inside a disposable consumer.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [coreArtifact, catalogArtifact, previousCatalogArtifact, ...extra] = process.argv.slice(2);
assert(
  coreArtifact && extra.length === 0,
  "Usage: node tools/verify-guide-consumer.mjs <core-tarball> [<catalog-tarball>] [<previous-catalog-tarball>]",
);
const coreTarball = resolve(coreArtifact);
assert(existsSync(coreTarball), "The supplied Core artifact must exist.");
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
const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-guide-consumer-"));
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const coreSha256 = hash(coreTarball);
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"),
);
const home = join(fixture, "home");
mkdirSync(home);
environment.npm_config_cache = execFileSync(process.execPath, [npm, "config", "get", "cache"], {
  cwd: root,
  env: environment,
  encoding: "utf8",
}).trim();
environment.HOME = home;
environment.USERPROFILE = home;
const runNpm = (args, cwd) =>
  execFileSync(process.execPath, [npm, ...args], {
    cwd,
    env: environment,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });

try {
  let catalogTarball;
  if (catalogArtifact) {
    catalogTarball = resolve(catalogArtifact);
    assert(existsSync(catalogTarball), "The supplied Catalog artifact must exist.");
  } else {
    const [packed] = JSON.parse(
      runNpm(
        ["pack", "--ignore-scripts", "--offline", "--json", "--pack-destination", fixture],
        root,
      ),
    );
    assert(packed?.filename, "Packing must yield one exact Catalog artifact.");
    catalogTarball = join(fixture, packed.filename);
  }
  const catalogSha256 = hash(catalogTarball);
  const consumer = join(fixture, "consumer");
  seedConsumerLock(consumer, root);
  runNpm(
    [
      "install",
      "--prefix",
      consumer,
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      coreTarball,
      catalogTarball,
    ],
    fixture,
  );
  assert.equal(hash(coreTarball), coreSha256);
  assert.equal(hash(catalogTarball), catalogSha256);
  let previousRoot;
  let previousCatalogSha256;
  if (previousCatalogArtifact) {
    const previousTarball = resolve(previousCatalogArtifact);
    previousCatalogSha256 = hash(previousTarball);
    const previousConsumer = join(fixture, "previous-consumer");
    seedConsumerLock(previousConsumer, root);
    runNpm(
      [
        "install",
        "--prefix",
        previousConsumer,
        "--ignore-scripts",
        "--offline",
        "--no-audit",
        "--no-fund",
        previousTarball,
      ],
      fixture,
    );
    assert.equal(hash(previousTarball), previousCatalogSha256);
    previousRoot = join(previousConsumer, "node_modules", "@aihq", "catalog");
  }
  const scenario = join(consumer, "scenario.mjs");
  copyFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "guide-consumer-scenario.mjs"),
    scenario,
  );
  const result = JSON.parse(
    execFileSync(process.execPath, [scenario, ...(previousRoot ? [previousRoot] : [])], {
      cwd: consumer,
      env: environment,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 8 * 1024 * 1024,
    }),
  );
  console.log(
    JSON.stringify(
      {
        ...result,
        coreSha256,
        catalogSha256,
        ...(previousCatalogSha256 ? { previousCatalogSha256 } : {}),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  // mkdtemp supplied this exact task-owned root; no caller path is removed.
  assert(fixture.startsWith(join(tmpdir(), "aih-catalog-guide-consumer-")));
  rmSync(fixture, { recursive: true, force: true });
}
