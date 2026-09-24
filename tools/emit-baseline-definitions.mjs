#!/usr/bin/env node
// Offline `node tools/emit-baseline-definitions.mjs <ecc|superpowers|mattpocock|ponytail>
// --commit <40-hex> --output <new file>` step. It runs after `npm run produce:<name>` and
// `tsc -p tsconfig.build.json`, reads only the produced upstream inputs under
// src/production/data (never vendor-lock-v1.json) and writes the definition Core's
// `baseline:request|consume-publications|assemble --definition` consumes. It never
// overwrites: the output must not exist.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage(message) {
  console.error(`emit-baseline-definitions: ${message}`);
  console.error(
    "usage: node tools/emit-baseline-definitions.mjs <ecc|superpowers|mattpocock|ponytail> --commit <40-hex> --output <new file>",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const [name, ...rest] = argv;
  const options = { name, commit: undefined, output: undefined };
  if (name === undefined || name.startsWith("--")) usage("a subject name comes first");
  for (let index = 0; index < rest.length; index += 2) {
    const [flag, value] = [rest[index], rest[index + 1]];
    if (value === undefined || value.startsWith("--")) usage(`${flag} needs a value`);
    if (flag === "--commit" && options.commit === undefined) options.commit = value;
    else if (flag === "--output" && options.output === undefined) options.output = value;
    else usage(`unexpected or repeated argument ${flag}`);
  }
  if (options.commit === undefined) usage("--commit is required");
  if (options.output === undefined) usage("--output is required");
  return options;
}

const options = parseArgs(process.argv.slice(2));
const { emitBaselineDefinitionV1 } = await import(
  "../dist/production/catalog/baseline-definitions-v1.js"
);
try {
  const definition = emitBaselineDefinitionV1(root, options.name, options.commit);
  writeFileSync(resolve(options.output), `${JSON.stringify(definition, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  console.log(`emitted ${options.name}@${options.commit} baseline definition`);
} catch (error) {
  console.error(`emit-baseline-definitions: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
