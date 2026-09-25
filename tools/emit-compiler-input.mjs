#!/usr/bin/env node
// Offline `node tools/emit-compiler-input.mjs <ecc|superpowers|ponytail|anthropics-skills>
// --commit <40-hex> --output <new file> [--vendor-lock <file>] [--source-root <checkout>]` step.
// It runs after `tsc -p tsconfig.build.json` and writes the `--compiler-input` Core's T3
// (`prepare:packaged-workbench-source-data`) reads at a new pin, derived from the Catalog's own
// curation (src/production/workbench/compiler-input-v1.ts), never from the packaged source record
// T3 replaces. `--vendor-lock` names the assembled vetted lock for ecc and superpowers before runbook
// step 8.1 copies it into src/production/data; the vetted-pin checks apply to it unchanged.
// `--source-root` names a checkout of anthropics/skills holding the pin; only the pinned commit's
// objects are read. It never overwrites: the output must not exist.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage(message) {
  console.error(`emit-compiler-input: ${message}`);
  console.error(
    "usage: node tools/emit-compiler-input.mjs <ecc|superpowers|ponytail|anthropics-skills> --commit <40-hex> --output <new file> [--vendor-lock <file>] [--source-root <checkout>]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const [name, ...rest] = argv;
  const options = { name, commit: undefined, output: undefined, vendorLock: undefined, sourceRoot: undefined };
  if (name === undefined || name.startsWith("--")) usage("a subject name comes first");
  for (let index = 0; index < rest.length; index += 2) {
    const [flag, value] = [rest[index], rest[index + 1]];
    if (value === undefined || value.startsWith("--")) usage(`${flag} needs a value`);
    if (flag === "--commit" && options.commit === undefined) options.commit = value;
    else if (flag === "--output" && options.output === undefined) options.output = value;
    else if (flag === "--vendor-lock" && options.vendorLock === undefined)
      options.vendorLock = value;
    else if (flag === "--source-root" && options.sourceRoot === undefined)
      options.sourceRoot = value;
    else usage(`unexpected or repeated argument ${flag}`);
  }
  if (options.commit === undefined) usage("--commit is required");
  if (options.output === undefined) usage("--output is required");
  return options;
}

const options = parseArgs(process.argv.slice(2));
const { produceCompilerInputV1, serializeCompilerInputV1 } = await import(
  "../dist/production/workbench/compiler-input-v1.js"
);
const { baselineInventoryGitEnvV1 } = await import(
  "../dist/production/catalog/baseline-inventory-v1.js"
);

/** Only the local checkout: no network, no prompt, and no inherited GIT_* variable. */
function git(args) {
  return execFileSync("git", args, {
    env: baselineInventoryGitEnvV1(process.env),
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}
try {
  const vendorLock =
    options.vendorLock === undefined
      ? undefined
      : JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            readFileSync(resolve(options.vendorLock)),
          ),
        );
  const input = produceCompilerInputV1(root, options.name, options.commit, {
    ...(vendorLock === undefined ? {} : { vendorLock }),
    ...(options.sourceRoot === undefined ? {} : { checkout: resolve(options.sourceRoot), git }),
  });
  const text = serializeCompilerInputV1(input);
  writeFileSync(resolve(options.output), text, { encoding: "utf8", flag: "wx" });
  console.log(
    `emitted ${input.version} ${options.name}@${options.commit}: file sha256 ${createHash("sha256").update(text).digest("hex")}`,
  );
} catch (error) {
  console.error(`emit-compiler-input: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
