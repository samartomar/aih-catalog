#!/usr/bin/env node
// Offline `node tools/derive-closure-mapping.mjs --publication <publication.json> --definition
// <definition.json> --output <new mapping.json>` step. It derives the ScannerConsumerMappingV1 that
// Scan's tools/emit-consumer-handoff.mjs projects a whole-repository publication with, for the
// closure-row mode of tools/generate-source-assessment-rows.mjs: every Scanner component that
// holds a file of a curated Catalog row closure (curatedClosuresV1) is mapped, and every other
// component is excluded with that reason. It never overwrites: the output must not exist.
//
// A publication set (D49: one request set over one source, published as several publications)
// is named as repeated `--publication <p> --output <mapping>` pairs: the curated closure must
// lie in the union of the members' requests, and each member gets its own mapping.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPublicationSetV1,
  curatedClosuresV1,
  publicationNativeFilesV1,
} from "./generate-source-assessment-rows.mjs";

const fail = (message) => {
  throw new TypeError(`closure-mapping:${message}`);
};
const codeUnitCompare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const holds = (component, path) =>
  component.paths.some((root) => path === root || path.startsWith(`${root}/`));

export function deriveClosureMappingV1(publication, definition) {
  const { mappings, rows, excluded } = deriveClosureMappingSetV1([publication], definition);
  return { mapping: mappings[0], rows, excluded };
}

/**
 * The mappings of a publication set, one per member in the given order. The set must be one
 * request set over one source (assertPublicationSetV1); every member's native annex is verified
 * and the curated closure must lie in the union of the members' requests.
 */
export function deriveClosureMappingSetV1(publications, definition) {
  if (!Array.isArray(publications) || publications.length === 0) fail("publication-set");
  if (publications.length > 1) assertPublicationSetV1(publications);
  const natives = publications.map((publication) => publicationNativeFilesV1(publication));
  const requests = publications.map((publication) => {
    const request = publication.request;
    if (request === null || typeof request !== "object" || !Array.isArray(request.components))
      fail("publication-request");
    return request;
  });
  const inventory = curatedClosuresV1(
    definition,
    requests[0].source,
    [...natives[0].keys()].sort(codeUnitCompare),
  );
  const closure = [...new Set(inventory.rows.flatMap((row) => row.files))].sort(codeUnitCompare);
  for (const path of closure)
    if (
      !requests.some((request) => request.components.some((component) => holds(component, path)))
    )
      fail(`closure-file-outside-request ${path}`);
  const mappings = requests.map((request) => {
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
      protocol: "ScannerConsumerMappingV1",
      requestSha256: request.requestSha256,
      contentClass: "exact compiler/source-file closure for assessment only",
      components,
      exclusions,
    };
  });
  return {
    mappings,
    rows: inventory.rows.map((row) => `${row.kind}:${row.name}`),
    excluded: inventory.excluded,
  };
}

function argumentsFrom(argv) {
  const values = new Map();
  const pairs = { publication: [], output: [] };
  for (let index = 0; index < argv.length; index += 2) {
    const [key, value] = [argv[index], argv[index + 1]];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) fail("arguments");
    const name = key.slice(2);
    if (Object.hasOwn(pairs, name)) {
      pairs[name].push(resolve(value));
      values.set(name, value);
      continue;
    }
    if (values.has(name)) fail("duplicate-argument");
    values.set(name, value);
  }
  const expected = ["publication", "definition", "output"];
  if (
    values.size !== expected.length ||
    expected.some((name) => !values.has(name)) ||
    pairs.publication.length !== pairs.output.length ||
    new Set(pairs.output).size !== pairs.output.length
  )
    fail("arguments");
  return { definition: resolve(values.get("definition")), ...pairs };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const values = argumentsFrom(process.argv.slice(2));
    const readJson = (path) =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)));
    for (const output of values.output) if (existsSync(output)) fail("output-exists");
    const derived = deriveClosureMappingSetV1(
      values.publication.map(readJson),
      readJson(values.definition),
    );
    derived.mappings.forEach((mapping, index) =>
      writeFileSync(values.output[index], `${JSON.stringify(mapping)}\n`, {
        encoding: "utf8",
        flag: "wx",
      }),
    );
    const counts = (mapping) => ({
      mapped: mapping.components.length,
      excludedScannerComponents: mapping.exclusions.length,
    });
    process.stdout.write(
      `${JSON.stringify({
        ...(derived.mappings.length === 1
          ? counts(derived.mappings[0])
          : { members: derived.mappings.map(counts) }),
        rows: derived.rows,
        excludedCurated: derived.excluded,
      })}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "closure-mapping:failed"}\n`);
    process.exitCode = 1;
  }
}
