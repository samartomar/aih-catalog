import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function readInput(root: string, name: string): JsonRecord {
  return record(
    JSON.parse(readFileSync(resolve(root, "src", "production", "data", name), "utf8")),
    name,
  );
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const input = value as JsonRecord;
  return `{${Object.keys(input)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(input[key])}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

/**
 * Catalog owns baseline compilation. Bindings are deliberately not shipped:
 * Core derives them from its admitted catalog and sealed declarations.
 */
export function produceCatalogAuthoringBundleV1(root: string): JsonRecord {
  const document = structuredClone(readInput(root, "catalog-authoring-bundle-source-v1.json"));
  if (
    document.format !== "aih-catalog-authoring-bundle" ||
    document.version !== 1 ||
    !Array.isArray(document.sourceRecords)
  ) {
    throw new TypeError("authoring producer input has an unsupported identity");
  }
  const prepared = record(document.prepared, "authoring prepared payload");
  const production = record(document.production, "authoring production receipt");
  const output = record(production.output, "authoring production output");
  prepared.bindings = {};
  output.bindingsDigest = digest(prepared.bindings);
  output.sourceInputsDigest = digest(prepared.sourceInputs);
  output.preparedDigest = digest(prepared);
  return document;
}

function produceMaterial(root: string, name: string, format: string): JsonRecord {
  const document = structuredClone(readInput(root, name));
  if (document.format !== format || document.version !== 1) {
    throw new TypeError(`${name} has an unsupported identity`);
  }
  return document;
}

export function produceCatalogCoreQualificationV1(root: string): JsonRecord {
  return produceMaterial(
    root,
    "catalog-core-qualification-source-v1.json",
    "aih-catalog-core-qualification",
  );
}

export function produceCatalogScannerEvidenceV1(root: string): JsonRecord {
  return produceMaterial(
    root,
    "catalog-scanner-evidence-source-v1.json",
    "aih-catalog-scanner-evidence",
  );
}

export function produceCatalogPublicBaselineV1(root: string): JsonRecord {
  return produceMaterial(
    root,
    "catalog-public-baseline-source-v1.json",
    "aih-catalog-public-baseline",
  );
}
