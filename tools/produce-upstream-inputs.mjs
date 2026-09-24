#!/usr/bin/env node
// Networked `npm run produce:<name> -- --commit <full sha>` step. It fetches one
// upstream repository at one full commit, runs the offline transforms from
// dist/production/produce, writes the true inputs under src/production/data and
// records repository, commit and sha256s in upstream-inputs-v1.json. The offline
// build never runs this. `--repo <checkout>` reads a local clone that already
// holds the commit; `--check` compares instead of writing.
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
    "usage: node tools/produce-upstream-inputs.mjs <ecc|superpowers|mattpocock|ponytail> --commit <40-hex> [--repo <checkout>] [--check]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const [name, ...rest] = argv;
  const options = { name, commit: undefined, repo: undefined, check: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--check") options.check = true;
    else if (arg === "--commit" || arg === "--repo") {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) usage(`${arg} needs a value`);
      options[arg.slice(2)] = value;
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
if (!Object.hasOwn(UPSTREAM_PRODUCERS_V1, options.name ?? ""))
  usage(`unknown produce step ${String(options.name)}`);
const repository = UPSTREAM_PRODUCERS_V1[options.name];

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const scratch = options.repo === undefined ? mkdtempSync(join(tmpdir(), "aih-produce-")) : undefined;
try {
  const checkout = options.repo === undefined ? scratch : resolve(options.repo);
  if (scratch !== undefined) {
    git(scratch, ["init", "-q"]);
    git(scratch, [
      "fetch",
      "-q",
      "--depth",
      "1",
      "--no-tags",
      `https://github.com/${repository}.git`,
      options.commit,
    ]);
  }
  const type = git(checkout, ["cat-file", "-t", options.commit]).toString("utf8").trim();
  if (type !== "commit") throw new Error(`${options.commit} is not a commit in ${repository}`);
  const blobs = new Map();
  for (const line of git(checkout, ["ls-tree", "-r", "-z", "--full-tree", options.commit])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)) {
    const match = /^(\d{6}) (\w+) [a-f0-9]+\t(.+)$/su.exec(line);
    if (match === null) throw new Error(`unreadable tree entry ${line}`);
    if (match[2] === "blob") blobs.set(match[3], match[1]);
  }
  const tree = {
    repository,
    commit: options.commit,
    paths: [...blobs.keys()],
    read(path) {
      const mode = blobs.get(path);
      if (mode !== "100644" && mode !== "100755")
        throw new Error(`upstream file ${path} is not a regular file`);
      return git(checkout, ["cat-file", "blob", `${options.commit}:${path}`]);
    },
  };
  const produced = produceUpstreamInputsV1(options.name, tree, root);
  const manifestPath = resolve(root, "src", "production", "data", "upstream-inputs-v1.json");
  const manifest = recordUpstreamInputsV1(
    readFileSync(manifestPath, "utf8"),
    repository,
    options.commit,
    produced,
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
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
}
