import { readFileSync } from "node:fs";
import { readCoreProductDeclarationsV1 } from "./catalog/core-product-declarations-v1.js";
import { productionDataPathV1 } from "./catalog/upstream-inputs-v1.js";
import { sha256HexV1 } from "./strict-json-v1.js";
import {
  exactKeys,
  type JsonRecord,
  list,
  literal,
  record,
  SHA256_HEX,
  text,
} from "./validate-v1.js";
import { parsePackagedScannerCollectionEvidenceV1 } from "./workbench/packaged-evidence-v1.js";
import { parsePackagedSourceRecordsV1 } from "./workbench/packaged-source-overlay-v1.js";

/**
 * Generates the Core companion documents from their true inputs. The inputs
 * are sealed evidence produced by the signed Catalog qualification and Scanner
 * custody pipelines; this module validates and wraps them, it never re-derives
 * a signature or a scan.
 */
export const CORE_QUALIFICATION_DATA_FILE_V1 = "core-qualification-data-v1.json";

function readData(root: string, file: string): unknown {
  return JSON.parse(readFileSync(productionDataPathV1(root, file), "utf8"));
}

const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/**
 * Reads Core 80120883's catalog qualification data (format version 2): every
 * artifact is addressed by the sha256 of its bytes and every record names only
 * artifacts the data carries.
 */
export function parseCoreQualificationDataV1(value: unknown): JsonRecord & { version: 2 } {
  const label = "core qualification data";
  const input = exactKeys(
    record(value, label),
    ["version", "artifacts", "bindings", "projections", "records"],
    label,
  );
  literal(input.version, 2, `${label} version`);
  const artifacts = record(input.artifacts, `${label} artifacts`);
  if (Object.keys(artifacts).length === 0) throw new TypeError(`${label} carries no artifacts`);
  for (const [address, encoded] of Object.entries(artifacts)) {
    text(address, `${label} artifact address`, SHA256_HEX);
    const bytes = text(encoded, `${label} artifact ${address}`, CANONICAL_BASE64);
    if (sha256HexV1(Buffer.from(bytes, "base64")) !== address)
      throw new TypeError(`${label} artifact does not match its content address ${address}`);
  }
  const artifact = (value: unknown, where: string): void => {
    const address = text(value, `${label} ${where}`, SHA256_HEX);
    if (!Object.hasOwn(artifacts, address))
      throw new TypeError(`${label} ${where} names absent artifact ${address}`);
  };
  const records = list(input.records, `${label} records`, 1);
  records.forEach((item, index) => {
    const where = `record ${String(index)}`;
    const entry = exactKeys(
      record(item, `${label} ${where}`),
      ["closures", "member", "publisher", "receipt", "receiptSet", "receiptSetPublisher"],
      `${label} ${where}`,
    );
    for (const key of ["member", "receipt", "receiptSet"]) artifact(entry[key], `${where} ${key}`);
    for (const [name, address] of Object.entries(record(entry.closures, `${label} ${where}`)))
      artifact(address, `${where} closure ${name}`);
    record(entry.publisher, `${label} ${where} publisher`);
    record(entry.receiptSetPublisher, `${label} ${where} receipt set publisher`);
  });
  const bindings = list(input.bindings, `${label} bindings`);
  if (bindings.length !== records.length)
    throw new TypeError(
      `${label} has ${String(bindings.length)} bindings for ${String(records.length)} records`,
    );
  bindings.forEach((item, index) => {
    record(item, `${label} binding ${String(index)}`);
  });
  list(input.projections, `${label} projections`, 1).forEach((item, index) => {
    record(item, `${label} projection ${String(index)}`);
  });
  return input as JsonRecord & { version: 2 };
}

export function produceCatalogCoreQualificationV1(root: string): JsonRecord {
  return {
    format: "aih-catalog-core-qualification",
    version: 1,
    records: parseCoreQualificationDataV1(readData(root, CORE_QUALIFICATION_DATA_FILE_V1)),
  };
}

/**
 * The Scanner evidence companion: the sealed collection evidence as published,
 * with each packaged source record's proof of custody in record order.
 */
export function catalogScannerEvidenceV1(
  packagedSourceData: unknown,
  collectionEvidence: unknown,
  governedTargets: readonly string[],
): { format: string; version: 1; records: unknown[]; sourceProofs: JsonRecord[] } {
  parsePackagedScannerCollectionEvidenceV1(collectionEvidence);
  const { records } = parsePackagedSourceRecordsV1(packagedSourceData, governedTargets);
  return {
    format: "aih-catalog-scanner-evidence",
    version: 1,
    records: structuredClone(collectionEvidence) as unknown[],
    sourceProofs: records.map(({ record: item }) => ({
      publicationBlobs: item.publicationBlobs,
      scannerProof: item.scannerProof,
      source: item.source,
    })),
  };
}

export function produceCatalogScannerEvidenceV1(root: string): JsonRecord {
  const governedTargets = readCoreProductDeclarationsV1(root)
    .hosts.filter((host) => host.policyTarget === true)
    .map((host) => String(host.id));
  return catalogScannerEvidenceV1(
    readData(root, "packaged-source-data-v1.json"),
    readData(root, "packaged-collection-evidence-v1.json"),
    governedTargets,
  );
}

/** The Catalog publishes no public baseline yet, so the document carries `baseline: null`. */
export function produceCatalogPublicBaselineV1(_root: string): JsonRecord {
  return { format: "aih-catalog-public-baseline", version: 1, baseline: null };
}
