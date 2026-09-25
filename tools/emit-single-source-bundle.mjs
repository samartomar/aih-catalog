#!/usr/bin/env node
// Offline `node tools/emit-single-source-bundle.mjs
// <ecc|superpowers|mattpocock|ponytail|anthropics-skills> --commit <40-hex> --output <new file>
// [--new-pin] [--vendor-lock <file>] [--compiler-input <file> --compiler-input-sha256 <hex>]` step. It runs after
// `tsc -p tsconfig.build.json` and emits the sealed single-source AuthoringCatalogBundleV1 that
// Core's definition route reads as `--source-bundle`, from the Catalog's production inputs through
// the full authoring bundle's own stages (src/production/workbench/single-source-bundle-v1.ts).
// `--vendor-lock` names the assembled vetted lock for ecc and superpowers before runbook step
// 8.1 copies it into src/production/data; the vetted-pin checks apply to it unchanged.
// `--new-pin` builds the source at a pin no packaged source record carries yet (the bundle T3
// reads before it produces that record): the same stages, with no packaged record and no
// collection evidence overlaid. anthropics-skills is emitted only this way, from the T3 compiler
// input tools/emit-compiler-input.mjs wrote, named with its SHA-256. It never overwrites: the
// output must not exist.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage(message) {
  console.error(`emit-single-source-bundle: ${message}`);
  console.error(
    "usage: node tools/emit-single-source-bundle.mjs <ecc|superpowers|mattpocock|ponytail|anthropics-skills> --commit <40-hex> --output <new file> [--new-pin] [--vendor-lock <file>] [--compiler-input <file> --compiler-input-sha256 <hex>]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const [name, ...rest] = argv;
  const options = {
    name,
    commit: undefined,
    output: undefined,
    vendorLock: undefined,
    newPin: false,
    compilerInput: undefined,
    compilerInputSha256: undefined,
  };
  if (name === undefined || name.startsWith("--")) usage("a subject name comes first");
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    if (flag === "--new-pin" && !options.newPin) {
      options.newPin = true;
      index -= 1;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) usage(`${flag} needs a value`);
    if (flag === "--commit" && options.commit === undefined) options.commit = value;
    else if (flag === "--output" && options.output === undefined) options.output = value;
    else if (flag === "--vendor-lock" && options.vendorLock === undefined)
      options.vendorLock = value;
    else if (flag === "--compiler-input" && options.compilerInput === undefined)
      options.compilerInput = value;
    else if (flag === "--compiler-input-sha256" && options.compilerInputSha256 === undefined)
      options.compilerInputSha256 = value;
    else usage(`unexpected or repeated argument ${flag}`);
  }
  if (options.commit === undefined) usage("--commit is required");
  if (options.output === undefined) usage("--output is required");
  if ((options.compilerInput === undefined) !== (options.compilerInputSha256 === undefined))
    usage("--compiler-input and --compiler-input-sha256 go together");
  return options;
}

const options = parseArgs(process.argv.slice(2));
const { produceSingleSourceAuthoringBundleV1, serializeSingleSourceBundleV1 } = await import(
  "../dist/production/workbench/single-source-bundle-v1.js"
);
const { readNamedCompilerInputV1 } = await import("../dist/production/candidate-inputs-v1.js");
try {
  const vendorLock =
    options.vendorLock === undefined
      ? undefined
      : JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            readFileSync(resolve(options.vendorLock)),
          ),
        );
  const compilerInput =
    options.compilerInput === undefined
      ? undefined
      : readNamedCompilerInputV1(
          resolve(options.compilerInput),
          options.compilerInputSha256,
          "compiler input",
        ).value;
  const bundle = produceSingleSourceAuthoringBundleV1(root, options.name, options.commit, {
    ...(vendorLock === undefined ? {} : { vendorLock }),
    ...(options.newPin ? { newPin: true } : {}),
    ...(compilerInput === undefined ? {} : { compilerInput }),
  });
  const text = serializeSingleSourceBundleV1(bundle);
  writeFileSync(resolve(options.output), text, { encoding: "utf8", flag: "wx" });
  console.log(
    `emitted source:${options.name}@${options.commit}${options.newPin ? " (new-pin route)" : ""}: ${Object.keys(bundle.assets).length} assets, bundleDigest ${bundle.provenance.bundleDigest}, file sha256 ${createHash("sha256").update(text).digest("hex")}`,
  );
} catch (error) {
  console.error(`emit-single-source-bundle: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
