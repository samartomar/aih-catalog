import {
  type CatalogReadRefusedV1,
  isObject,
  readCanonicalDocument,
  refuse,
  refusedFrom,
  requireFormatAndVersion,
} from "./refusal-v1.js";

export const CATALOG_AUTHORING_BUNDLE_FORMAT_V1 = "aih-catalog-authoring-bundle";
export const CATALOG_AUTHORING_BUNDLE_VERSION_V1 = 1;
export const CATALOG_AUTHORING_BUNDLE_SUBPATH_V1 = "./catalog-authoring-bundle.json";
export const CATALOG_AUTHORING_BUNDLE_MAX_BYTES_V1 = 24 * 1024 * 1024;

export interface CatalogAuthoringBundleV1 {
  readonly format: typeof CATALOG_AUTHORING_BUNDLE_FORMAT_V1;
  readonly version: typeof CATALOG_AUTHORING_BUNDLE_VERSION_V1;
  readonly prepared: {
    readonly catalog: Record<string, unknown>;
    readonly bundle: Record<string, unknown> & { readonly version: "authoring-catalog-bundle/v1" };
    readonly bindings: Record<string, unknown>;
    readonly sourceInputs: Record<string, unknown>;
  };
  readonly sourceRecords: readonly { readonly bytes: string; readonly sha256: string }[];
  readonly production: Record<string, unknown>;
}

export const CATALOG_AUTHORING_BUNDLE_REFUSALS_V1 = [
  "malformed-request",
  "malformed-bytes",
  "oversize-bytes",
  "non-canonical-bytes",
  "digest-mismatch",
  "malformed-document",
  "unknown-format",
  "unknown-version",
] as const;
export type CatalogAuthoringBundleRefusalV1 = (typeof CATALOG_AUTHORING_BUNDLE_REFUSALS_V1)[number];
export type CatalogAuthoringBundleV1Result =
  | {
      readonly state: "read";
      readonly authoring: CatalogAuthoringBundleV1;
      readonly digest: string;
    }
  | CatalogReadRefusedV1<CatalogAuthoringBundleRefusalV1>;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

function validPrepared(value: unknown): value is CatalogAuthoringBundleV1["prepared"] {
  if (!isObject(value) || Object.keys(value).length !== 4) return false;
  if (
    !isObject(value.catalog) ||
    !isObject(value.bundle) ||
    !isObject(value.bindings) ||
    !isObject(value.sourceInputs)
  )
    return false;
  return value.bundle.version === "authoring-catalog-bundle/v1";
}

function validSourceRecords(value: unknown): value is CatalogAuthoringBundleV1["sourceRecords"] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every(
      (item) =>
        isObject(item) &&
        Object.keys(item).length === 2 &&
        typeof item.bytes === "string" &&
        typeof item.sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(item.sha256),
    )
  );
}

export function readCatalogAuthoringBundleV1Result(request: {
  readonly bytes: Uint8Array;
  readonly expectedDigest?: string;
}): CatalogAuthoringBundleV1Result {
  try {
    if (!isObject(request)) refuse("malformed-request");
    const { value, digest } = readCanonicalDocument({
      bytes: request.bytes,
      maxBytes: CATALOG_AUTHORING_BUNDLE_MAX_BYTES_V1,
      expectedDigest: request.expectedDigest,
      canonical: (document) => `${canonical(document)}\n`,
    });
    requireFormatAndVersion(
      value,
      CATALOG_AUTHORING_BUNDLE_FORMAT_V1,
      CATALOG_AUTHORING_BUNDLE_VERSION_V1,
    );
    if (
      Object.keys(value).length !== 5 ||
      !validPrepared(value.prepared) ||
      !validSourceRecords(value.sourceRecords) ||
      !isObject(value.production)
    ) {
      refuse("malformed-document");
    }
    return Object.freeze({
      state: "read" as const,
      authoring: value as unknown as CatalogAuthoringBundleV1,
      digest,
    });
  } catch (error) {
    return refusedFrom<CatalogAuthoringBundleRefusalV1>(error);
  }
}

export function readCatalogAuthoringBundleV1(request: {
  readonly bytes: Uint8Array;
  readonly expectedDigest?: string;
}): CatalogAuthoringBundleV1 | undefined {
  const result = readCatalogAuthoringBundleV1Result(request);
  return result.state === "read" ? result.authoring : undefined;
}
