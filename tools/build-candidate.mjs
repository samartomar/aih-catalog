import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { candidateMarkersV1 } from "./check-not-candidate.mjs";

/**
 * npm run build:candidate -- --candidate <candidate-inputs.json>
 *
 * Builds a candidate @aihq/catalog package root in dist-candidate/ for Core's
 * internal preparation tools (--candidate-catalog), at a clean, recorded
 * commit. The code is compiled into a private staging directory and the
 * generation runs in candidate mode (src/production/candidate-inputs-v1.ts);
 * defaults/ and dist/ are never written. Pack it with
 * `npm pack --pack-destination <dir>` run inside dist-candidate/.
 */
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fail = (message) => {
  console.error(`build:candidate: ${message}`);
  process.exit(1);
};

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--candidate" || args[1].length === 0)
  fail("usage: npm run build:candidate -- --candidate <candidate-inputs.json>");
const inputsPath = resolve(process.env.INIT_CWD ?? process.cwd(), args[1]);

const markers = candidateMarkersV1(root);
if (markers.length > 0) fail(`${root} is a candidate root (${markers.join(", ")})`);

const git = (...command) => {
  const result = spawnSync("git", ["-C", root, ...command], { encoding: "utf8" });
  if (result.status !== 0) fail(`git ${command.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
};
const catalogCommit = git("rev-parse", "HEAD").trim();
const dirty = git("status", "--porcelain", "--untracked-files=all").trim();
if (dirty !== "")
  fail(`the checkout has uncommitted changes; a candidate is built only at a recorded commit:\n${dirty}`);

const staging = mkdtempSync(join(tmpdir(), "aih-catalog-candidate-build-"));
try {
  const tsc = createRequire(join(root, "package.json")).resolve("typescript/bin/tsc");
  const compiled = spawnSync(
    process.execPath,
    [tsc, "-p", "tsconfig.build.json", "--outDir", join(staging, "dist")],
    { cwd: root, stdio: "inherit" },
  );
  if (compiled.status !== 0) fail("tsc failed");
  const cli = join(staging, "dist", "cli.js");
  if (!readFileSync(cli, "utf8").startsWith("#!/usr/bin/env node\n")) fail("cli-shebang-missing");

  const { generateCatalogCandidateV1 } = await import(
    pathToFileURL(join(staging, "dist", "production", "candidate-build-v1.js")).href
  );
  const built = generateCatalogCandidateV1(root, inputsPath, catalogCommit);

  // The package files: dist without dist/production/** except source-data-v1.* (package.json#files).
  cpSync(join(staging, "dist"), join(built.outRoot, "dist"), {
    recursive: true,
    filter: (source) => {
      const path = relative(join(staging, "dist"), source).split(sep).join("/");
      if (path !== "production" && !path.startsWith("production/")) return true;
      return path === "production" || /^production\/source-data-v1\.[^/]+$/u.test(path);
    },
  });
  if (process.platform !== "win32") chmodSync(join(built.outRoot, "dist", "cli.js"), 0o755);

  console.log(`candidate @aihq/catalog root: ${built.outRoot}`);
  console.log(`catalogCommit: ${catalogCommit}`);
  console.log(`inputsSha256: ${built.candidate.inputsSha256}`);
  for (const [id, entry] of Object.entries(built.candidate.frameworks))
    console.log(
      `framework ${id}: ${entry.kind === "compiler-input" ? `compiler input ${entry.path} sha256 ${entry.sha256}` : "omitted"}`,
    );
  console.log(`omittedSections:\n  ${built.omittedSections.join("\n  ")}`);
  console.log(`next: cd ${built.outRoot} && npm pack --pack-destination <dir>`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
