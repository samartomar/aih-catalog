#!/usr/bin/env node
// Offline `node tools/derive-closure-mapping.mjs --publication <publication.json> --definition
// <definition.json> --output <new mapping.json>` step. It derives the ScannerConsumerMappingV1 that
// Scan's tools/emit-consumer-handoff.mjs projects a whole-repository publication with, for the
// closure-row mode of tools/generate-source-assessment-rows.mjs: every Scanner component that
// holds a file of a curated Catalog row closure (curatedClosuresV1) is mapped, and every other
// component is excluded with that reason. It never overwrites: the output must not exist.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { curatedClosuresV1, publicationNativeFilesV1 } from "./generate-source-assessment-rows.mjs";

const fail = (message) => {
  throw new TypeError(`closure-mapping:${message}`);
};
const codeUnitCompare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const holds = (component, path) =>
  component.paths.some((root) => path === root || path.startsWith(`${root}/`));

export function deriveClosureMappingV1(publication, definition) {
  const native = publicationNativeFilesV1(publication);
  const request = publication.request;
  if (request === null || typeof request !== "object" || !Array.isArray(request.components))
    fail("publication-request");
  const inventory = curatedClosuresV1(
    definition,
    request.source,
    [...native.keys()].sort(codeUnitCompare),
  );
  const closure = [...new Set(inventory.rows.flatMap((row) => row.files))].sort(codeUnitCompare);
  for (const path of closure)
    if (!request.components.some((component) => holds(component, path)))
      fail(`closure-file-outside-request ${path}`);
  const components = [];
  const exclusions = [];
  for (const component of request.components) {
    if (closure.some((path) => holds(component, path)))
      components.push({
        catalogAssetId: `${request.source.id}/${component.content}:${component.id.slice(component.id.indexOf(":") + 1)}`,
        scannerComponentId: component.id,
      });
    else
      exclusions.push({
        reason: "holds no file of a curated Catalog row closure",
        scannerComponentId: component.id,
      });
  }
  return {
    mapping: {
      protocol: "ScannerConsumerMappingV1",
      requestSha256: request.requestSha256,
      contentClass: "exact compiler/source-file closure for assessment only",
      components,
      exclusions,
    },
    rows: inventory.rows.map((row) => `${row.kind}:${row.name}`),
    excluded: inventory.excluded,
  };
}

function argumentsFrom(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const [key, value] = [argv[index], argv[index + 1]];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) fail("arguments");
    if (values.has(key.slice(2))) fail("duplicate-argument");
    values.set(key.slice(2), value);
  }
  const expected = ["publication", "definition", "output"];
  if (values.size !== expected.length || expected.some((name) => !values.has(name)))
    fail("arguments");
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const values = argumentsFrom(process.argv.slice(2));
    const readJson = (name) =>
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(resolve(values.get(name)))),
      );
    const derived = deriveClosureMappingV1(readJson("publication"), readJson("definition"));
    writeFileSync(resolve(values.get("output")), `${JSON.stringify(derived.mapping)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    process.stdout.write(
      `${JSON.stringify({
        mapped: derived.mapping.components.length,
        excludedScannerComponents: derived.mapping.exclusions.length,
        rows: derived.rows,
        excludedCurated: derived.excluded,
      })}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "closure-mapping:failed"}\n`);
    process.exitCode = 1;
  }
}
