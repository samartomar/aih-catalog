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
