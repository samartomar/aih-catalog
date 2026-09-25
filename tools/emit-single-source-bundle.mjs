#!/usr/bin/env node
// Offline `node tools/emit-single-source-bundle.mjs <ecc|superpowers|mattpocock|ponytail>
// --commit <40-hex> --output <new file> [--vendor-lock <file>]` step. It runs after
// `tsc -p tsconfig.build.json` and emits the sealed single-source AuthoringCatalogBundleV1 that
// Core's definition route reads as `--source-bundle`, from the Catalog's production inputs through
// the full authoring bundle's own stages (src/production/workbench/single-source-bundle-v1.ts).
// `--vendor-lock` names the assembled vetted lock for ecc and superpowers before runbook step
// 8.1 copies it into src/production/data; the vetted-pin checks apply to it unchanged. It never
// overwrites: the output must not exist.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage(message) {
  console.error(`emit-single-source-bundle: ${message}`);
  console.error(
    "usage: node tools/emit-single-source-bundle.mjs <ecc|superpowers|mattpocock|ponytail> --commit <40-hex> --output <new file> [--vendor-lock <file>]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const [name, ...rest] = argv;
  const options = { name, commit: undefined, output: undefined, vendorLock: undefined };
  if (name === undefined || name.startsWith("--")) usage("a subject name comes first");
  for (let index = 0; index < rest.length; index += 2) {
    const [flag, value] = [rest[index], rest[index + 1]];
    if (value === undefined || value.startsWith("--")) usage(`${flag} needs a value`);
    if (flag === "--commit" && options.commit === undefined) options.commit = value;
    else if (flag === "--output" && options.output === undefined) options.output = value;
    else if (flag === "--vendor-lock" && options.vendorLock === undefined)
      options.vendorLock = value;
    else usage(`unexpected or repeated argument ${flag}`);
  }
  if (options.commit === undefined) usage("--commit is required");
  if (options.output === undefined) usage("--output is required");
  return options;
}

const options = parseArgs(process.argv.slice(2));
const { produceSingleSourceAuthoringBundleV1, serializeSingleSourceBundleV1 } = await import(
  "../dist/production/workbench/single-source-bundle-v1.js"
);
try {
  const vendorLock =
    options.vendorLock === undefined
      ? undefined
      : JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            readFileSync(resolve(options.vendorLock)),
          ),
        );
  const bundle = produceSingleSourceAuthoringBundleV1(
    root,
    options.name,
    options.commit,
    vendorLock === undefined ? {} : { vendorLock },
  );
  const text = serializeSingleSourceBundleV1(bundle);
  writeFileSync(resolve(options.output), text, { encoding: "utf8", flag: "wx" });
  console.log(
    `emitted source:${options.name}@${options.commit}: ${Object.keys(bundle.assets).length} assets, bundleDigest ${bundle.provenance.bundleDigest}, file sha256 ${createHash("sha256").update(text).digest("hex")}`,
  );
} catch (error) {
  console.error(`emit-single-source-bundle: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
