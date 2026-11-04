#!/usr/bin/env node
/**
 * Packed public-consumer validation: packs this checkout with `npm pack`, installs the exact
 * tarball beside the vendored Scan tarball into a disposable consumer outside the repository,
 * and replays the fifteen acceptance journeys and the consumer regressions there, importing
 * only the package's public entry points.
 *
 *   npm run check:consumer                 replay and print the results (exit 1 on a failure)
 *   npm run check:consumer -- --write      also write validation/packed-consumer.json
 *   npm run check:consumer -- --network    also fetch the real upstream pins (scan-key checks)
 *   npm run check:consumer -- --keep       keep the disposable consumer and print its folder
 *
 * Inputs reach the consumer only through the package's own `fetchSource`, from this
 * repository's Git history at the packed commit. The journeys run under Node's permission
 * model: no child process, no worker, no network, and writes only inside the consumer's work
 * folder. `--write` refuses a dirty checkout, so the recorded commit is the packed source.
 *
 * Each row is `passed`, `failed` (exit 1), `open` (a recorded gap against the journey's
 * expected result, with its reason; it fails once it starts passing so the record is updated)
 * or `pending` (proof this replay cannot give, such as a real qualification). Each names its
 * basis: fixture, committed candidate data or real upstream bytes. None of them establishes
 * native client support, a real qualification or accepted production data.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Stops the run; inside the main block the disposable folder is still removed first. */
class Failure extends Error {}
function fail(message) {
  throw new Failure(message);
}
process.on("uncaughtException", (error) => {
  process.stderr.write(`check:consumer: ${error instanceof Failure ? error.message : error.stack}\n`);
  process.exit(2);
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
for (const arg of args)
  if (!["--write", "--network", "--keep"].includes(arg)) fail(`unknown option ${arg}`);
const RESULTS = "validation/packed-consumer.json";
const SCAN_TARBALL = "vendor/aihq-scan-0.1.0.tgz";

if (Number(process.versions.node.split(".")[0]) !== 26)
  fail(`Node 26 is required (running ${process.versions.node})`);

/** The local npm CLI next to this Node; never npx. */
function npmCli() {
  for (const candidate of [
    process.env.npm_execpath,
    resolve(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(process.execPath, "..", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ])
    if (
      candidate &&
      isAbsolute(candidate) &&
      basename(candidate) === "npm-cli.js" &&
      existsSync(candidate)
    )
      return candidate;
  fail("unable to resolve a local npm-cli.js");
}
const npm = npmCli();
/** npm and git see neither lifecycle-script opt-ins nor user Git configuration. */
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => key.toLowerCase() !== "npm_config_allow_scripts" && !key.startsWith("GIT_"),
  ),
);

function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: 600_000,
    env: options.env ?? env,
    cwd: options.cwd ?? root,
    input: options.input,
  });
  if (result.status !== 0)
    fail(
      `${basename(command)} ${argv.slice(0, 3).join(" ")} failed (${result.status ?? result.signal}):\n${result.stderr}${result.stdout.slice(-4000)}`,
    );
  return result.stdout;
}
const git = (...argv) => run("git", ["-c", "core.hooksPath=/dev/null", ...argv]).trim();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// The packed source.
const commit = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain").length > 0;
if (dirty && args.has("--write"))
  fail("the checkout has uncommitted changes; commit them before recording results");

const work = mkdtempSync(join(tmpdir(), "aih-catalog-consumer-"));
const keep = args.has("--keep");
try {
  run(process.execPath, [npm, "run", "build:dist", "--silent"]);
  const packDir = join(work, "pack");
  mkdirSync(packDir);
  const [packed] = JSON.parse(
    run(process.execPath, [
      npm,
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      packDir,
    ]),
  );
  const tarball = join(packDir, packed.filename);
  const tarballBytes = readFileSync(tarball);
  const integrity = `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`;
  if (integrity !== packed.integrity) fail("npm's reported integrity differs from the tarball");
  const scanBytes = readFileSync(join(root, SCAN_TARBALL));

  // A consumer outside the repository: its own package.json, a lock seeded with only the
  // exact runtime artifacts the tarballs declare (so the install works offline from npm's
  // cache), plus the JSON Schema validator a consumer would use for the published schemas.
  const consumer = join(work, "consumer");
  seedConsumer(consumer);
  cpSync(tarball, join(consumer, "aihq-catalog.tgz"));
  cpSync(join(root, SCAN_TARBALL), join(consumer, "aihq-scan.tgz"));
  run(
    process.execPath,
    [
      npm,
      "install",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      "./aihq-scan.tgz",
      "./aihq-catalog.tgz",
    ],
    { cwd: consumer },
  );
  const scenario = join(consumer, "scenario");
  cpSync(join(root, "tools", "consumer"), scenario, { recursive: true });

  // Phase 1 (may spawn git through the package's own fetchSource): acquire the inputs.
  const inputs = join(consumer, "inputs");
  const prepared = JSON.parse(
    run(process.execPath, [join(scenario, "prepare.mjs")], {
      cwd: consumer,
      input: JSON.stringify({
        repository: root,
        commit,
        inputs,
        network: args.has("--network"),
      }),
    }),
  );

  // Phase 2: the journeys, with nothing to execute and no network.
  const out = join(consumer, "work");
  mkdirSync(out);
  const confined = ["--permission", `--allow-fs-read=${consumer}`, `--allow-fs-write=${out}`];
  const journeys = JSON.parse(
    run(process.execPath, [...confined, join(scenario, "journeys.mjs")], {
      cwd: consumer,
      input: JSON.stringify({ inputs, work: out, prepared, network: args.has("--network") }),
    }),
  );
  const browser = JSON.parse(
    run(
      process.execPath,
      [
        "--experimental-vm-modules",
        "--no-warnings",
        // Catalog's browser entry points are also evaluated with eval and its kin turned off.
        "--disallow-code-generation-from-strings",
        ...confined,
        join(scenario, "browser.mjs"),
      ],
      { cwd: consumer },
    ),
  );

  const results = {
    candidate: {
      package: `${packed.name}@${packed.version}`,
      sourceCommit: commit,
      sourceClean: !dirty,
      file: packed.filename,
      sha256: sha256(tarballBytes),
      integrity,
      bytes: tarballBytes.length,
      entries: packed.entryCount,
    },
    scan: { package: "@aihq/scan@0.1.0", sha256: sha256(scanBytes) },
    runtime: { node: process.versions.node, npm: run(process.execPath, [npm, "--version"]).trim() },
    inputs: prepared.identity,
    network: args.has("--network"),
    basis: {
      fixture: "synthetic files written by the journey, or pinned upstream fixture bytes",
      "candidate-data":
        "committed data/ at the packed commit: unadmitted candidate data, not trusted production data",
      upstream: "real upstream bytes fetched at the recorded pins (--network only)",
    },
    limits: [
      "Fixture and candidate-data outcomes establish package behaviour only: no native client loaded any plan, no installer carried one out, and no qualification run took place here.",
    ],
    journeys: [...journeys.journeys, browser],
    regressions: journeys.regressions,
    missingProof: journeys.missingProof,
  };
  // Determinism across runs and machines: the same tarball and inputs give the same plans.
  if (existsSync(join(root, RESULTS))) {
    const recorded = JSON.parse(readFileSync(join(root, RESULTS), "utf8"));
    const comparable =
      recorded.candidate?.sha256 === results.candidate.sha256 &&
      JSON.stringify(recorded.inputs) === JSON.stringify(results.inputs);
    if (comparable) {
      const digests = (entries) =>
        Object.fromEntries(entries.filter((entry) => entry.plans).map((entry) => [entry.id, entry.plans]));
      const was = JSON.stringify(digests(recorded.journeys));
      const now = JSON.stringify(digests(results.journeys));
      const check = { name: "plan digests equal the recorded results", status: was === now ? "passed" : "failed" };
      if (check.status === "failed") check.detail = `recorded ${was}, now ${now}`;
      results.regressions.push({
        id: "replay",
        title: "A rerun of the recorded candidate gives byte-identical plans",
        basis: "candidate-data",
        outcome: check.status,
        checks: [check],
        pending: [],
      });
    }
  }
  // Open gaps and pending proof are reported, not failures; any failed check fails the run.
  const failed = [...results.journeys, ...results.regressions].filter(
    (entry) => entry.outcome === "failed",
  );
  printTable(results);
  if (args.has("--write")) {
    mkdirSync(join(root, dirname(RESULTS)), { recursive: true });
    writeFileSync(join(root, RESULTS), `${JSON.stringify(results, null, 2)}\n`);
    process.stdout.write(`wrote ${RESULTS}\n`);
  }
  if (keep) process.stdout.write(`consumer kept at ${consumer}\n`);
  process.exitCode = failed.length > 0 ? 1 : 0;
} finally {
  if (!keep) rmSync(work, { recursive: true, force: true });
}

function seedConsumer(consumer) {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  if (lock.lockfileVersion !== 3) fail("the consumer seed requires the committed v3 lock");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const scanManifest = JSON.parse(
    run("tar", ["-xOzf", join(root, SCAN_TARBALL), "package/package.json"]),
  );
  const wanted = [
    ...Object.keys(manifest.dependencies).filter((name) => name !== "@aihq/scan"),
    ...Object.keys(scanManifest.dependencies ?? {}),
    "ajv",
  ];
  const packages = {};
  const visit = (name) => {
    const key = `node_modules/${name}`;
    if (packages[key]) return;
    const entry = lock.packages[key];
    if (!entry?.resolved?.startsWith("https://")) fail(`no registry lock entry for ${name}`);
    const { dev: _dev, devOptional: _devOptional, ...kept } = entry;
    packages[key] = kept;
    for (const dependency of Object.keys(entry.dependencies ?? {})) visit(dependency);
  };
  for (const name of wanted) visit(name);
  const identity = { name: "aih-catalog-packed-consumer", version: "0.0.0" };
  const dependencies = { ajv: lock.packages["node_modules/ajv"].version };
  mkdirSync(consumer, { recursive: true });
  writeFileSync(
    join(consumer, "package.json"),
    `${JSON.stringify({ ...identity, private: true, type: "module", dependencies }, null, 2)}\n`,
  );
  packages[""] = { ...identity, dependencies };
  writeFileSync(
    join(consumer, "package-lock.json"),
    `${JSON.stringify({ ...identity, lockfileVersion: 3, requires: true, packages }, null, 2)}\n`,
  );
}

function printTable(results) {
  const { candidate } = results;
  const lines = [
    `${candidate.package} ${candidate.file} sha256 ${candidate.sha256}`,
    `source ${candidate.sourceCommit}${candidate.sourceClean ? "" : " (uncommitted changes)"}`,
    "",
  ];
  for (const entry of [...results.journeys, ...results.regressions]) {
    const failedChecks = entry.checks.filter((check) => check.status === "failed");
    lines.push(
      `${String(entry.id).padEnd(24)} ${entry.outcome.padEnd(8)} ${entry.basis.padEnd(15)} ${entry.title}`,
    );
    for (const check of failedChecks) lines.push(`    x ${check.name}: ${check.detail ?? ""}`);
    for (const check of entry.checks.filter((item) => item.status === "open"))
      lines.push(`    ! open: ${check.name}: ${check.reason}`);
    for (const pending of entry.pending ?? []) lines.push(`    ~ pending: ${pending}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}
