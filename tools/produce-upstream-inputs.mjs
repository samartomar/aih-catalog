#!/usr/bin/env node
// Networked `npm run produce:<name> -- --commit <full sha>` step. It checks with
// the GitHub API that the upstream repository is still served as itself (not
// moved or transferred), fetches it at one full commit over HTTPS with redirects
// refused, runs the offline transforms from dist/production/produce, writes the
// true inputs under src/production/data and records the repository actually
// fetched, the commit and sha256s in upstream-inputs-v1.json. The offline build
// never runs this. `--check` compares instead of writing.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT = /^[a-f0-9]{40}$/u;

function usage(message) {
  console.error(`produce-upstream-inputs: ${message}`);
  console.error(
    "usage: node tools/produce-upstream-inputs.mjs <ecc|superpowers|mattpocock|ponytail> --commit <40-hex> [--check]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const [name, ...rest] = argv;
  const options = { name, commit: undefined, check: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--check") options.check = true;
    else if (arg === "--commit") {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) usage(`${arg} needs a value`);
      options.commit = value;
      index += 1;
    } else usage(`unexpected argument ${arg}`);
  }
  if (options.commit === undefined || !COMMIT.test(options.commit))
    usage("--commit must be a full 40-character lowercase commit sha");
  return options;
}

const options = parseArgs(process.argv.slice(2));
const { UPSTREAM_PRODUCERS_V1, produceUpstreamInputsV1, recordUpstreamInputsV1 } = await import(
  "../dist/production/produce/upstream-producers-v1.js"
);
const { fetchUpstreamTreeV1 } = await import("../dist/production/produce/upstream-fetch-v1.js");
const { catalogProductionRuntimeV1 } = await import("../dist/production/collation-v1.js");
if (!Object.hasOwn(UPSTREAM_PRODUCERS_V1, options.name ?? ""))
  usage(`unknown produce step ${String(options.name)}`);

function git(args) {
  return execFileSync("git", args, {
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** One GitHub API request that never follows a redirect: a moved repository must be seen as moved. */
async function http(url) {
  const response = await globalThis.fetch(url, {
    redirect: "manual",
    headers: { accept: "application/vnd.github+json", "user-agent": "aih-catalog-produce" },
  });
  return {
    status: response.status,
    location: response.headers.get("location") ?? undefined,
    body: await response.text(),
  };
}

const scratch = mkdtempSync(join(tmpdir(), "aih-produce-"));
try {
  const tree = await fetchUpstreamTreeV1({
    repository: UPSTREAM_PRODUCERS_V1[options.name],
    commit: options.commit,
    scratch,
    git,
    http,
  });
  console.log(
    `fetched ${tree.url} at ${tree.commit}: GitHub serves it as ${tree.servedAs}; HTTP redirects refused`,
  );
  const repository = tree.repository;
  const produced = produceUpstreamInputsV1(options.name, tree, root);
  const runtime = catalogProductionRuntimeV1();
  console.log(
    `produced under Node ${runtime.node}, ICU ${runtime.icu}, Unicode ${runtime.unicode}, CLDR ${runtime.cldr}`,
  );
  const manifestPath = resolve(root, "src", "production", "data", "upstream-inputs-v1.json");
  const manifest = recordUpstreamInputsV1(
    readFileSync(manifestPath, "utf8"),
    repository,
    tree.commit,
    produced,
    runtime,
  );
  const outputs = [
    ...produced.map((item) => [resolve(root, "src", "production", "data", item.file), item.bytes]),
    [manifestPath, manifest],
  ];
  let differ = 0;
  for (const [path, bytes] of outputs) {
    const relative = path.slice(root.length + 1).replaceAll("\\", "/");
    if (options.check) {
      const same = readFileSync(path, "utf8") === bytes;
      if (!same) differ += 1;
      console.log(`${same ? "MATCH " : "DIFFER"} ${relative}`);
    } else {
      writeFileSync(path, bytes, "utf8");
      console.log(`wrote ${relative}`);
    }
  }
  if (differ > 0) process.exitCode = 1;
  else if (!options.check)
    console.log("Run `npm run build:dist` to regenerate defaults/** from the new inputs.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
