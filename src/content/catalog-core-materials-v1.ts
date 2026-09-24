import {
  type CatalogReadRefusedV1,
  isObject,
  readCanonicalDocument,
  refuse,
  refusedFrom,
  requireFormatAndVersion,
} from "./refusal-v1.js";

export const CATALOG_CORE_QUALIFICATION_SUBPATH_V1 = "./catalog-core-qualification.json";
export const CATALOG_SCANNER_EVIDENCE_SUBPATH_V1 = "./catalog-scanner-evidence.json";
export const CATALOG_PUBLIC_BASELINE_SUBPATH_V1 = "./catalog-public-baseline.json";
export const CATALOG_CORE_MATERIAL_MAX_BYTES_V1 = 16 * 1024 * 1024;

export type CatalogCoreMaterialRefusalV1 =
  | "malformed-request"
  | "malformed-bytes"
  | "oversize-bytes"
  | "non-canonical-bytes"
  | "digest-mismatch"
  | "malformed-document"
  | "unknown-format"
  | "unknown-version";

export type CatalogCoreMaterialV1Result<T> =
  | { readonly state: "read"; readonly material: T; readonly digest: string }
  | CatalogReadRefusedV1<CatalogCoreMaterialRefusalV1>;

export interface CatalogCoreQualificationV1 {
  readonly format: "aih-catalog-core-qualification";
  readonly version: 1;
  readonly records: Readonly<Record<string, unknown>>;
}
export interface CatalogScannerEvidenceV1 {
  readonly format: "aih-catalog-scanner-evidence";
  readonly version: 1;
  readonly records: readonly unknown[];
  readonly sourceProofs: readonly unknown[];
}
export interface CatalogPublicBaselineV1 {
  readonly format: "aih-catalog-public-baseline";
  readonly version: 1;
  readonly baseline: unknown | null;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

function read<T>(
  request: { readonly bytes: Uint8Array; readonly expectedDigest?: string },
  format: string,
  valid: (value: Record<string, unknown>) => boolean,
): CatalogCoreMaterialV1Result<T> {
  try {
    if (!isObject(request)) refuse("malformed-request");
    const { value, digest } = readCanonicalDocument({
      bytes: request.bytes,
      maxBytes: CATALOG_CORE_MATERIAL_MAX_BYTES_V1,
      expectedDigest: request.expectedDigest,
      canonical: (document) => `${canonical(document)}\n`,
    });
    requireFormatAndVersion(value, format, 1);
    if (!valid(value)) refuse("malformed-document");
    return Object.freeze({ state: "read" as const, material: value as unknown as T, digest });
  } catch (error) {
    return refusedFrom<CatalogCoreMaterialRefusalV1>(error);
  }
}

export const readCatalogCoreQualificationV1Result = (request: {
  readonly bytes: Uint8Array;
  readonly expectedDigest?: string;
}): CatalogCoreMaterialV1Result<CatalogCoreQualificationV1> =>
  read(
    request,
    "aih-catalog-core-qualification",
    (value) => isObject(value.records) && Object.keys(value).length === 3,
  );

export const readCatalogScannerEvidenceV1Result = (request: {
  readonly bytes: Uint8Array;
  readonly expectedDigest?: string;
}): CatalogCoreMaterialV1Result<CatalogScannerEvidenceV1> =>
  read(
    request,
    "aih-catalog-scanner-evidence",
    (value) =>
      Array.isArray(value.records) &&
      Array.isArray(value.sourceProofs) &&
      Object.keys(value).length === 4,
  );

export const readCatalogPublicBaselineV1Result = (request: {
  readonly bytes: Uint8Array;
  readonly expectedDigest?: string;
}): CatalogCoreMaterialV1Result<CatalogPublicBaselineV1> =>
  read(
    request,
    "aih-catalog-public-baseline",
    (value) => Object.hasOwn(value, "baseline") && Object.keys(value).length === 3,
  );
