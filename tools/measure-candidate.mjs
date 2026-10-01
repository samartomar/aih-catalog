#!/usr/bin/env node
// Measures detected-delta-to-content-ready elapsed time for one candidate under one
// stated cache condition, with the real clock. It wraps tools/prepare-candidate.mjs:
//
//   cold-install    a fresh workspace: checkout, `npm ci --ignore-scripts`, build,
//                   then preparation with an empty source-object cache
//   retained-cache  an existing workspace from a cold run (dependencies, build and the
//                   fetched-commit cache kept), then preparation again
//
//   node tools/measure-candidate.mjs --condition cold-install --commit <40-hex> --workspace <new dir> [...]
//   node tools/measure-candidate.mjs --condition retained-cache --commit <40-hex> --workspace <same dir> [...]
//
// Everything after `--` is passed to prepare-candidate (for example --core-artifact,
// --source-git-dir with --allow-unverified-origin, --simulate-delay). It records
// measurements; it never invents a benchmark. The npm package cache of the machine is
// not cleared, and the summary says so. It starts no service and publishes nothing.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT = /^[a-f0-9]{40}$/u;
const USAGE = `usage: node tools/measure-candidate.mjs --condition cold-install|retained-cache --commit <40-hex>
  --workspace <dir> [--out <dir>] [--cache-dir <dir>] [--detected-at <ISO time>] [-- <prepare-candidate options>]`;
const usage = (message) => {
  console.error(`measure-candidate: ${message}\n${USAGE}`);
  process.exit(2);
};

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const own = split === -1 ? argv : argv.slice(0, split);
const passthrough = split === -1 ? [] : argv.slice(split + 1);
const options = {};
for (let index = 0; index < own.length; index += 2) {
  const flag = own[index];
  const value = own[index + 1];
  if (!["--condition", "--commit", "--workspace", "--out", "--cache-dir", "--detected-at"].includes(flag)) {
    usage(`unexpected argument ${flag}`);
  }
  if (value === undefined || value.startsWith("--")) usage(`${flag} needs a value`);
  options[flag.slice(2)] = value;
}
if (!["cold-install", "retained-cache"].includes(options.condition ?? "")) usage("--condition is required");
if (!COMMIT.test(options.commit ?? "")) usage("--commit must be an explicit full 40-character lowercase commit");
if (!options.workspace) usage("--workspace is required");
const workspace = resolve(options.workspace);
const out = resolve(options.out ?? join(workspace, "..", `${options.condition}-measurement`));
const cacheDir = resolve(options["cache-dir"] ?? join(workspace, "..", "source-object-cache"));
const cold = options.condition === "cold-install";
if (cold && existsSync(workspace)) usage("a cold-install run needs a workspace directory that does not exist yet");
if (!cold && !existsSync(join(workspace, "node_modules", "typescript"))) {
  usage("a retained-cache run needs the workspace of an earlier cold-install run");
}
if (cold && existsSync(cacheDir)) usage("a cold-install run needs an empty source-object cache: remove or choose another --cache-dir");

const timing = await import(`${new URL("../dist/producer/timing.js", import.meta.url)}`);
const { PhaseRecorder, realClock, runnerInfo, summarize } = timing;
const { npmVersion } = await import(`${new URL("../dist/producer/package.js", import.meta.url)}`);

const recorder = new PhaseRecorder(realClock);
const startedAt = realClock.wall();
const startedMono = realClock.now();
const detectedAt = options["detected-at"] ? new Date(options["detected-at"]) : undefined;
if (detectedAt && (Number.isNaN(detectedAt.getTime()) || detectedAt > startedAt)) usage("--detected-at must be a past ISO time");

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).slice(0, 400)}`);
  return result.stdout;
};
const npmCli = [process.env.npm_execpath, join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")].find(
  (candidate) => candidate && existsSync(candidate),
);
if (!npmCli) usage("run this with a Node distribution that has its npm beside it");
const npm = (...args) => run(process.execPath, [npmCli, ...args], workspace);

let candidateCommit;
let dirty = false;
try {
  candidateCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim() !== "";
} catch {
  // not a git worktree
}

let outcome = "ready";
let refusal;
let child;
try {
  if (cold) {
    await recorder.phase("checkout", () => {
      const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
        cwd: root,
        maxBuffer: 64 * 1024 * 1024,
      })
        .toString("utf8")
        .split("\0")
        .filter(Boolean);
      for (const file of files) {
        const target = join(workspace, file);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(root, file), target);
      }
    });
    await recorder.phase("install-dependencies", () => npm("ci", "--ignore-scripts", "--no-audit", "--no-fund"));
    await recorder.phase("build", () => npm("run", "build:dist"));
  } else {
    recorder.skip("checkout", "retained workspace");
    recorder.skip("install-dependencies", "retained node_modules");
    recorder.skip("build", "retained build output");
  }

  const prepareOut = join(out, "prepare");
  const args = [
    join(workspace, "tools", "prepare-candidate.mjs"),
    "--commit", options.commit,
    "--out", prepareOut,
    "--cache-dir", cacheDir,
    "--condition", options.condition,
    ...passthrough,
  ];
  const result = spawnSync(process.execPath, args, { cwd: workspace, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  process.stderr.write(result.stderr ?? "");
  const summaryPath = join(prepareOut, "timing-summary.json");
  if (!existsSync(summaryPath)) throw new Error(`preparation wrote no timing summary (exit ${result.status}): ${(result.stderr ?? "").slice(0, 300)}`);
  child = JSON.parse(readFileSync(summaryPath, "utf8"));
  for (const phase of child.phases) recorder.phases.push(phase);
  outcome = child.outcome;
  refusal = child.refusal;
} catch (error) {
  outcome = "failed";
  refusal = { reason: "measurement-error", message: String(error.message ?? error).slice(0, 500) };
}

const endedMono = realClock.now();
const endedAt = realClock.wall();
let npmId = "unknown";
try {
  npmId = npmVersion();
} catch {
  npmId = "unavailable";
}
const summary = summarize({
  recorder,
  startedAt,
  startedMono,
  endedAt,
  endedMono,
  ...(detectedAt ? { detectedAt } : {}),
  outcome,
  ...(refusal ? { refusal } : {}),
  candidate: { ...(candidateCommit ? { commit: candidateCommit } : {}), dirty, ...(child?.candidate?.artifactSha256 ? { artifactSha256: child.candidate.artifactSha256, artifactBytes: child.candidate.artifactBytes } : {}) },
  package: child?.package ?? { name: "unknown", version: "unknown" },
  workload: child?.workload ?? {},
  runner: runnerInfo(npmId),
  cache: {
    condition: options.condition,
    dependencies: cold
      ? "installed fresh in this run (`npm ci --ignore-scripts`); the machine's npm package cache was not cleared"
      : "retained from an earlier cold-install run (node_modules and build output reused)",
    sourceObjects: child?.cache?.sourceObjects ?? "not-used",
  },
});
mkdirSync(out, { recursive: true });
const target = join(out, "measurement-summary.json");
writeFileSync(target, `${JSON.stringify({ ...summary, measurement: { tool: "tools/measure-candidate.mjs", condition: options.condition, note: "Measured with the real clock on this runner; not a benchmark claim." } }, null, 2)}\n`);
for (const phase of summary.phases) {
  console.log(`${phase.status.padEnd(7)} ${phase.name.padEnd(22)} ${(phase.durationMs / 1000).toFixed(2).padStart(8)}s${phase.simulatedDelayMs ? "  SIMULATED" : ""}`);
}
console.log(`${summary.outcome.toUpperCase()} (${options.condition}): ${summary.clock.elapsedSeconds}s elapsed against ${summary.clock.ceilingSeconds}s${summary.clock.withinCeiling ? "" : " — CEILING MISSED"}`);
console.log(`summary: ${target}`);
process.exitCode = summary.outcome === "ready" ? 0 : 1;
