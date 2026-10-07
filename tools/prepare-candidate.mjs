#!/usr/bin/env node
// Prepares a content candidate from an explicitly pinned upstream commit:
//
//   node tools/prepare-candidate.mjs --commit <40-hex> [--apply] [options]
//
// It fetches the pinned commit (GitHub identity checked, redirects refused),
// produces only the items the delta affects, checks the complete result, packs and
// verifies the real artifact, writes a review page and a timing summary, and with
// --apply atomically replaces release/. It never waits for or requires Scan, a Core
// lock or an administrator lifecycle check, allocates no version and publishes
// nothing. Run `npm run build:dist` first.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT = /^[a-f0-9]{40}$/u;
const USAGE = `usage: node tools/prepare-candidate.mjs --commit <40-hex> [--source <id>] [--apply]
  [--advance-provenance] [--declaration <file>] [--root <package-root>] [--out <dir>]
  [--cache-dir <dir>] [--core-artifact <core.tgz>] [--detected-at <ISO time>]
  [--condition cold-install|retained-cache] [--dependencies <text>]
  [--simulate-delay <phase>=<ms>]... [--source-git-dir <dir> --allow-unverified-origin]`;

function usage(message) {
  console.error(`prepare-candidate: ${message}`);
  console.error(USAGE);
  process.exit(2);
}

const VALUE_FLAGS = new Set([
  "--commit", "--source", "--declaration", "--root", "--out", "--cache-dir", "--core-artifact",
  "--detected-at", "--condition", "--dependencies", "--simulate-delay", "--source-git-dir",
]);
const BOOLEAN_FLAGS = new Set(["--apply", "--advance-provenance", "--allow-unverified-origin"]);

function parseArgs(argv) {
  const options = { simulate: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (BOOLEAN_FLAGS.has(arg)) {
      options[arg.slice(2)] = true;
    } else if (VALUE_FLAGS.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) usage(`${arg} needs a value`);
      index += 1;
      if (arg !== "--simulate-delay" && Object.hasOwn(options, arg.slice(2))) {
        usage(`${arg} was given more than once`);
      }
      if (arg === "--simulate-delay") {
        const match = /^([a-z-]+)=(\d{1,9})$/u.exec(value);
        if (!match) usage("--simulate-delay needs <phase>=<milliseconds>");
        options.simulate[match[1]] = Number(match[2]);
      } else {
        options[arg.slice(2)] = value;
      }
    } else {
      usage(`unexpected argument ${arg}`);
    }
  }
  if (!options.commit || !COMMIT.test(options.commit)) {
    usage("--commit must be an explicit full 40-character lowercase commit");
  }
  if (options.condition && !["cold-install", "retained-cache"].includes(options.condition)) {
    usage("--condition must be cold-install or retained-cache");
  }
  if (options["source-git-dir"] && !options["allow-unverified-origin"]) {
    usage("--source-git-dir has no verified origin; add --allow-unverified-origin to use it (it can never --apply)");
  }
  if (options["source-git-dir"] && options.apply) {
    usage("a candidate from --source-git-dir cannot be applied");
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const sourceRoot = resolve(options.root ?? root);
const producer = (file) => import(`${new URL(`../dist/producer/${file}`, import.meta.url)}`);
const [
  { parseDeclaration },
  { fetchSourceTree },
  { readCommitTree },
  { prepareCandidate },
  { ProducerRefusal },
  { defaultCacheDir },
  { assertFreshOutput },
] = await Promise.all([
    producer("declaration.js"),
    producer("fetch.js"),
    producer("git-tree.js"),
    producer("prepare.js"),
    producer("errors.js"),
    producer("cache.js"),
    producer("paths.js"),
  ]).catch((error) => {
    console.error(`prepare-candidate: build the package first (npm run build:dist): ${error.message}`);
    process.exit(2);
  });

// Replacement refs are never honored: bytes under a pinned commit are that commit's own.
const git = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1" },
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

/** One GitHub API request that never follows a redirect: a moved repository must be seen as moved. */
async function http(url) {
  const response = await globalThis.fetch(url, {
    redirect: "manual",
    headers: { accept: "application/vnd.github+json", "user-agent": "aih-catalog-prepare" },
    signal: AbortSignal.timeout(30_000),
  });
  return {
    status: response.status,
    location: response.headers.get("location") ?? undefined,
    body: await response.text(),
  };
}

try {
  const declaration = parseDeclaration(
    readFileSync(resolve(options.declaration ?? join(sourceRoot, "producer", "declaration.json"))),
  );
  const candidates = options.source
    ? declaration.sources.filter((source) => source.id === options.source)
    : declaration.sources;
  if (candidates.length !== 1) {
    usage("name exactly one declared source with --source <id> (" + declaration.sources.map((s) => s.id).join(", ") + ")");
  }
  const { repository } = candidates[0];

  const out = resolve(options.out ?? mkdtempSync(join(tmpdir(), "aih-catalog-candidate-")));
  try {
    assertFreshOutput({ sourceRoot, outDir: out });
  } catch (error) {
    if (error instanceof ProducerRefusal) usage(`--out is not usable: ${error.message}`);
    throw error;
  }
  const cacheDir = resolve(
    options["cache-dir"] ??
      defaultCacheDir({ env: process.env, platform: process.platform, home: homedir() }),
  );

  let candidateGit = { dirty: false };
  try {
    const commit = git(["rev-parse", "HEAD"], sourceRoot).toString("utf8").trim();
    const dirty = git(["status", "--porcelain"], sourceRoot).toString("utf8").trim() !== "";
    candidateGit = { commit, dirty };
  } catch {
    // Not a git worktree: the summary simply omits the candidate commit.
  }

  const acquire = async (context) => {
    if (options["source-git-dir"]) {
      const gitDir = resolve(options["source-git-dir"]);
      const tree = readCommitTree({
        repository,
        commit: options.commit,
        run: (...args) => git(["-C", gitDir, "--no-replace-objects", ...args]),
      });
      context.detail("local git directory; origin NOT verified");
      return { ...tree, originVerified: false };
    }
    const tree = await fetchSourceTree({
      declaration,
      repository,
      commit: options.commit,
      cacheDir,
      git: (args) => git(args),
      http,
      retry: {
        attempts: 3,
        delayMs: 2_000,
        sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
        onRetry: ({ attempt, error }) => console.error(`retry ${attempt}: ${error}`),
      },
    });
    return { ...tree, originVerified: true };
  };

  const handoff = options["core-artifact"]
    ? async (artifact) => {
        try {
          const output = execFileSync(
            process.execPath,
            [
              join(root, "tools", "verify-core-consumer.mjs"),
              resolve(options["core-artifact"]),
              artifact.tarball,
            ],
            { encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
          );
          const result = JSON.parse(output);
          if (result.status === "not-run") {
            return { ok: true, status: "not-run", detail: `NOT RUN: ${result.reason} (${result.items} items, ${result.configurationRequired} need configuration, ${result.conflicting} conflict)` };
          }
          return {
            ok: result.status === "passed" && result.staleMaterialRejected === true && result.dependencyMapping === true,
            status: "passed",
            detail: `selected ${(result.selected ?? []).join(" + ")}`,
          };
        } catch (error) {
          return { ok: false, detail: String(error.stderr ?? error.message).slice(0, 500) };
        }
      }
    : undefined;

  const result = await prepareCandidate({
    sourceRoot,
    declaration,
    commit: options.commit,
    acquire,
    outDir: out,
    ...(options.apply ? { apply: true } : {}),
    ...(options["advance-provenance"] ? { advanceProvenance: true } : {}),
    ...(handoff ? { handoff } : {}),
    ...(options["detected-at"] ? { detectedAt: new Date(options["detected-at"]) } : {}),
    ...(options.condition ? { condition: options.condition } : {}),
    ...(options.dependencies ? { dependencies: options.dependencies } : {}),
    simulate: options.simulate,
    git: candidateGit,
  });

  const { summary } = result;
  for (const phase of summary.phases) {
    console.log(
      `${phase.status.padEnd(7)} ${phase.name.padEnd(20)} ${(phase.durationMs / 1000).toFixed(2).padStart(8)}s${
        phase.detail ? `  ${phase.detail}` : ""
      }`,
    );
  }
  console.log(
    `${summary.outcome.toUpperCase()}: ${summary.clock.elapsedSeconds}s elapsed against ${summary.clock.ceilingSeconds}s` +
      (summary.clock.withinCeiling ? "" : " — CEILING MISSED"),
  );
  if (summary.refusal) console.error(`refused: ${summary.refusal.message}`);
  console.log(`report, review page, artifact and timing summary: ${out}`);
  if (result.reportError) {
    console.error(`release/ WAS replaced, but the final report could not be written: ${result.reportError}`);
    process.exitCode = 1;
  }
  if (result.installed) console.log("release/ was replaced; review the diff and commit it.");
  else if (summary.outcome === "ready") console.log("dry run: release/ is unchanged; re-run with --apply to install it.");
  if (!result.reportError) process.exitCode = summary.outcome === "ready" ? 0 : 1;
} catch (error) {
  if (error instanceof ProducerRefusal) {
    console.error(`prepare-candidate refused: ${error.message}`);
    process.exitCode = 1;
  } else {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
