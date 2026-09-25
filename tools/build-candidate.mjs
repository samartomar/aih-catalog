import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildCandidateFromCommitV1 } from "./candidate-snapshot.mjs";

/**
 * npm run build:candidate -- --candidate <candidate-inputs.json>
 *
 * Builds a candidate @aihq/catalog package root in dist-candidate/ for Core's
 * internal preparation tools (--candidate-catalog), at a clean, recorded
 * commit. Compilation and generation run over a private snapshot of that
 * commit, never over the live checkout (tools/candidate-snapshot.mjs), and the
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

/** Compile and generate over the snapshot only; its root is the only tree read. */
async function buildInSnapshot({ root: snapshot, catalogCommit }) {
  // typescript's exports map hides bin/; its main entry is lib/typescript.js.
  const tsc = join(
    dirname(dirname(createRequire(join(snapshot, "package.json")).resolve("typescript"))),
    "bin",
    "tsc",
  );
  const compiled = spawnSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], {
    cwd: snapshot,
    stdio: "inherit",
  });
  if (compiled.status !== 0) throw new Error("tsc failed");
  const dist = join(snapshot, "dist");
  if (!readFileSync(join(dist, "cli.js"), "utf8").startsWith("#!/usr/bin/env node\n"))
    throw new Error("cli-shebang-missing");

  const { generateCatalogCandidateV1 } = await import(
    pathToFileURL(join(dist, "production", "candidate-build-v1.js")).href
  );
  const built = generateCatalogCandidateV1(snapshot, inputsPath, catalogCommit);

  // The package files: dist without dist/production/** except source-data-v1.* (package.json#files).
  cpSync(dist, join(built.outRoot, "dist"), {
    recursive: true,
    filter: (source) => {
      const path = relative(dist, source).split(sep).join("/");
      if (path !== "production" && !path.startsWith("production/")) return true;
      return path === "production" || /^production\/source-data-v1\.[^/]+$/u.test(path);
    },
  });
  if (process.platform !== "win32") chmodSync(join(built.outRoot, "dist", "cli.js"), 0o755);
  return built;
}

try {
  const {
    catalogCommit,
    outRoot,
    result: built,
    modesVerified,
  } = await buildCandidateFromCommitV1(root, buildInSnapshot);
  console.log(`candidate @aihq/catalog root: ${outRoot}`);
  console.log(`catalogCommit: ${catalogCommit}`);
  if (!modesVerified)
    console.log("modes not verified on win32: the published package's modes come from npm pack");
  console.log(`inputsSha256: ${built.candidate.inputsSha256}`);
  for (const [id, entry] of Object.entries(built.candidate.frameworks))
    console.log(
      `framework ${id}: ${entry.kind === "compiler-input" ? `compiler input ${entry.path} sha256 ${entry.sha256}` : "omitted"}`,
    );
  for (const [id, entry] of Object.entries(built.candidate.collections ?? {}))
    console.log(
      `collection ${id}@${entry.commit}: compiler input ${entry.path} sha256 ${entry.sha256}`,
    );
  console.log(`omittedSections:\n  ${built.omittedSections.join("\n  ")}`);
  console.log(`next: cd ${outRoot} && npm pack --pack-destination <dir>`);
} catch (error) {
  console.error(`build:candidate: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
