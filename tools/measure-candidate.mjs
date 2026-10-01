#!/usr/bin/env node
// Measures detected-delta-to-content-ready elapsed time for one candidate under one
// stated cache condition, with the real clock. It wraps tools/prepare-candidate.mjs:
//
//   cold-install    a new workspace holding exactly the bytes of one clean commit
//                   (never the live working tree), `npm ci --ignore-scripts`, the build,
//                   then preparation with an empty source-object cache
//   retained-cache  the workspace of an earlier cold run, kept as it was (dependencies,
//                   build and the fetched-commit cache): it is checked against the cold
//                   run's recorded snapshot first and refused if anything differs
//
//   node tools/measure-candidate.mjs --condition cold-install --commit <40-hex> --workspace <new dir> [...]
//   node tools/measure-candidate.mjs --condition retained-cache --commit <40-hex> --workspace <same dir> [...]
//
// Only the options listed under `--` below may follow `--`; the measurement owns
// everything else (root, output, cache, condition, pin, detection time, apply).
// This records one local execution on this runner; it is not a benchmark claim, and the
// machine's npm package cache is not cleared. It starts no service and publishes nothing.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT = /^[a-f0-9]{40}$/u;
const USAGE = `usage: node tools/measure-candidate.mjs --condition cold-install|retained-cache --commit <40-hex>
  --workspace <dir> [--out <dir>] [--cache-dir <dir>] [--detected-at <ISO time>] [--source-root <git root>]
  [-- --core-artifact <tgz> | --source-git-dir <dir> --allow-unverified-origin | --declaration <file>
      | --source <id> | --advance-provenance | --simulate-delay <phase>=<ms>]`;
const usage = (message) => {
  console.error(`measure-candidate: ${message}\n${USAGE}`);
  process.exit(2);
};

const OWN = new Set(["--condition", "--commit", "--workspace", "--out", "--cache-dir", "--detected-at", "--source-root"]);
const PASS_VALUE = new Set(["--core-artifact", "--source-git-dir", "--declaration", "--source", "--simulate-delay"]);
const PASS_FLAG = new Set(["--allow-unverified-origin", "--advance-provenance"]);

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const own = split === -1 ? argv : argv.slice(0, split);
const passthrough = split === -1 ? [] : argv.slice(split + 1);
const options = {};
for (let index = 0; index < own.length; index += 2) {
  const flag = own[index];
  const value = own[index + 1];
  if (!OWN.has(flag)) usage(`unexpected argument ${flag}`);
  if (value === undefined || value.startsWith("--")) usage(`${flag} needs a value`);
  if (Object.hasOwn(options, flag.slice(2))) usage(`${flag} was given more than once`);
  options[flag.slice(2)] = value;
}
const passArgs = [];
const seenPass = new Set();
for (let index = 0; index < passthrough.length; index += 1) {
  const flag = passthrough[index];
  if (PASS_FLAG.has(flag)) {
    passArgs.push(flag);
  } else if (PASS_VALUE.has(flag)) {
    const value = passthrough[index + 1];
    if (value === undefined || value.startsWith("--")) usage(`${flag} needs a value`);
    if (flag !== "--simulate-delay" && seenPass.has(flag)) usage(`${flag} was given more than once`);
    seenPass.add(flag);
    passArgs.push(flag, value);
    index += 1;
  } else {
    usage(`${flag} cannot be passed through: the measurement owns the root, output, cache, condition, pin, detection time and apply`);
  }
}
if (!["cold-install", "retained-cache"].includes(options.condition ?? "")) usage("--condition is required");
if (!COMMIT.test(options.commit ?? "")) usage("--commit must be an explicit full 40-character lowercase commit");
if (!options.workspace) usage("--workspace is required");
const cold = options.condition === "cold-install";
const workspace = resolve(options.workspace);
const out = resolve(options.out ?? join(dirname(workspace), `${basename(workspace)}-${options.condition}`));
const cacheDir = resolve(options["cache-dir"] ?? join(dirname(workspace), `${basename(workspace)}-source-cache`));
const sourceRoot = resolve(options["source-root"] ?? root);

const producer = (file) => import(`${new URL(`../dist/producer/${file}`, import.meta.url)}`);
const [timing, packaging, snapshots, { ProducerRefusal }] = await Promise.all([
  producer("timing.js"),
  producer("package.js"),
  producer("snapshot.js"),
  producer("errors.js"),
]).catch((error) => {
  console.error(`measure-candidate: build the package first (npm run build:dist): ${error.message}`);
  process.exit(2);
});
const { PhaseRecorder, realClock, runnerInfo, summarize } = timing;
const { npmCliPath, npmVersion } = packaging;

const detectedAt = options["detected-at"] ? new Date(options["detected-at"]) : undefined;
if (detectedAt && (Number.isNaN(detectedAt.getTime()) || detectedAt > new Date())) {
  usage("--detected-at must be a past ISO time");
}
const guard = (action) => {
  try {
    return action();
  } catch (error) {
    if (error instanceof ProducerRefusal) usage(error.message);
    throw error;
  }
};

// Validate everything that could make the numbers meaningless before the clock starts.
let committed;
let snapshot;
if (cold) {
  if (existsSync(workspace) && readdirSync(workspace).length > 0) usage("a cold-install run needs a workspace directory that is new or empty");
  if (existsSync(cacheDir)) usage("a cold-install run needs an empty source-object cache: remove it or choose another --cache-dir");
  guard(() => snapshots.assertCleanTracked(sourceRoot));
  committed = guard(() => snapshots.readCommittedFiles(sourceRoot));
  snapshot = snapshots.snapshotOf(committed);
} else {
  if (!existsSync(workspace)) usage("a retained-cache run needs the workspace of an earlier cold-install run");
  snapshot = guard(() => snapshots.readSnapshot(workspace));
  const problems = guard(() => snapshots.verifyWorkspace(workspace, snapshot));
  if (problems.length > 0) {
    usage(`the workspace no longer matches its cold-install snapshot (${snapshot.commit}); run a new cold-install measurement:\n  ${problems.slice(0, 20).join("\n  ")}`);
  }
}

const recorder = new PhaseRecorder(realClock);
const startedAt = realClock.wall();
const startedMono = realClock.now();
const run = (command, args, cwd) => {
  // npm refuses an inherited allow-scripts setting in project installs; scripts stay disabled by flag.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"));
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).slice(0, 400)}`);
  return result.stdout;
};
const npm = (...args) => run(process.execPath, [npmCliPath(), ...args], workspace);

let outcome = "ready";
let refusal;
let child;
try {
  if (cold) {
    await recorder.phase("checkout", () => snapshots.writeCommittedFiles(workspace, committed.files));
    await recorder.phase("install-dependencies", () => npm("ci", "--ignore-scripts", "--no-audit", "--no-fund"));
    await recorder.phase("build", () => npm("run", "build:dist"));
    snapshot = snapshots.withBuild(snapshot, workspace);
    snapshots.writeSnapshot(workspace, snapshot);
  } else {
    recorder.skip("checkout", "retained workspace, verified against its cold-install snapshot");
    recorder.skip("install-dependencies", "retained node_modules, verified against the cold run");
    recorder.skip("build", "retained build output, verified against the cold run");
  }

  const prepareOut = join(out, "prepare");
  const args = [
    join(workspace, "tools", "prepare-candidate.mjs"),
    "--commit", options.commit,
    "--out", prepareOut,
    "--cache-dir", cacheDir,
    "--condition", options.condition,
    ...passArgs,
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
  // The measured code is the recorded commit; the workspace is clean by construction.
  candidate: {
    commit: snapshot.commit,
    dirty: false,
    ...(child?.candidate?.artifactSha256 ? { artifactSha256: child.candidate.artifactSha256, artifactBytes: child.candidate.artifactBytes } : {}),
  },
  package: child?.package ?? { name: "unknown", version: "unknown" },
  workload: child?.workload ?? {},
  runner: runnerInfo(npmId),
  cache: {
    condition: options.condition,
    dependencies: cold
      ? "installed fresh in this run (`npm ci --ignore-scripts`); the machine's npm package cache was not cleared"
      : "retained from the cold-install run and re-verified against its snapshot before this run",
    sourceObjects: child?.cache?.sourceObjects ?? "not-used",
  },
});
mkdirSync(out, { recursive: true });
const target = join(out, "measurement-summary.json");
writeFileSync(
  target,
  `${JSON.stringify(
    {
      ...summary,
      measurement: {
        tool: "tools/measure-candidate.mjs",
        condition: options.condition,
        note: "One local execution on this runner; not a benchmark claim.",
        snapshot: {
          commit: snapshot.commit,
          tree: snapshot.tree,
          snapshotSha256: snapshot.snapshotSha256,
          manifestSha256: snapshot.manifestSha256,
          lockSha256: snapshot.lockSha256,
          distSha256: snapshot.dist?.sha256,
          installedDependenciesSha256: snapshot.installedSha256,
        },
        originVerified: child?.workload?.originVerified ?? null,
        passedThrough: passArgs,
      },
    },
    null,
    2,
  )}\n`,
);
for (const phase of summary.phases) {
  console.log(`${phase.status.padEnd(7)} ${phase.name.padEnd(22)} ${(phase.durationMs / 1000).toFixed(2).padStart(8)}s${phase.simulatedDelayMs ? "  SIMULATED" : ""}`);
}
console.log(`${summary.outcome.toUpperCase()} (${options.condition}): ${summary.clock.elapsedSeconds}s elapsed against ${summary.clock.ceilingSeconds}s${summary.clock.withinCeiling ? "" : " — CEILING MISSED"}`);
if (summary.refusal) console.error(`${summary.refusal.reason}: ${summary.refusal.message}`);
console.log(`summary: ${target}`);
process.exitCode = summary.outcome === "ready" ? 0 : 1;
