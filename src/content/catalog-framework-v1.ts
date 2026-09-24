import {
  type CatalogReadRefusedV1,
  isObject,
  readCanonicalDocument,
  refuse,
  refusedFrom,
  requireFormatAndVersion,
} from "./refusal-v1.js";

export const CATALOG_FRAMEWORK_DESCRIPTOR_FORMAT_V1 = "aih-catalog-framework-descriptor";
export const CATALOG_FRAMEWORK_DESCRIPTOR_VERSION_V1 = 1;
export const CATALOG_FRAMEWORK_DESCRIPTOR_MAX_BYTES_V1 = 16 * 1024 * 1024;
export const CATALOG_FRAMEWORK_ECC_SUBPATH_V1 = "./catalog-framework-ecc.json";
export const CATALOG_FRAMEWORK_SUPERPOWERS_SUBPATH_V1 = "./catalog-framework-superpowers.json";

export type CatalogFrameworkIdV1 = "ecc" | "superpowers";

export interface CatalogFrameworkDescriptorV1 {
  readonly format: typeof CATALOG_FRAMEWORK_DESCRIPTOR_FORMAT_V1;
  readonly version: typeof CATALOG_FRAMEWORK_DESCRIPTOR_VERSION_V1;
  readonly frameworkId: CatalogFrameworkIdV1;
  readonly sections: Readonly<Record<string, unknown>>;
}

export const CATALOG_FRAMEWORK_DESCRIPTOR_REFUSALS_V1 = [
  "malformed-request",
  "malformed-bytes",
  "oversize-bytes",
  "non-canonical-bytes",
  "digest-mismatch",
  "malformed-document",
  "unknown-format",
  "unknown-version",
  "framework-mismatch",
  "malformed-sections",
] as const;
export type CatalogFrameworkDescriptorRefusalV1 =
  (typeof CATALOG_FRAMEWORK_DESCRIPTOR_REFUSALS_V1)[number];

export type CatalogFrameworkDescriptorV1Result =
  | {
      readonly state: "read";
      readonly descriptor: CatalogFrameworkDescriptorV1;
      readonly digest: string;
    }
  | CatalogReadRefusedV1<CatalogFrameworkDescriptorRefusalV1>;

export interface ReadCatalogFrameworkDescriptorV1Request {
  readonly bytes: Uint8Array;
  readonly frameworkId: CatalogFrameworkIdV1;
  readonly expectedDigest?: string;
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

function readDescriptor(request: ReadCatalogFrameworkDescriptorV1Request): {
  readonly descriptor: CatalogFrameworkDescriptorV1;
  readonly digest: string;
} {
  if (
    !isObject(request) ||
    (request.frameworkId !== "ecc" && request.frameworkId !== "superpowers")
  ) {
    refuse("malformed-request");
  }
  const { value, digest } = readCanonicalDocument({
    bytes: request.bytes,
    maxBytes: CATALOG_FRAMEWORK_DESCRIPTOR_MAX_BYTES_V1,
    expectedDigest: request.expectedDigest,
    canonical: (document) => `${canonical(document)}\n`,
  });
  requireFormatAndVersion(
    value,
    CATALOG_FRAMEWORK_DESCRIPTOR_FORMAT_V1,
    CATALOG_FRAMEWORK_DESCRIPTOR_VERSION_V1,
  );
  if (value.frameworkId !== request.frameworkId) refuse("framework-mismatch");
  if (!isObject(value.sections) || Object.keys(value.sections).length === 0) {
    refuse("malformed-sections");
  }
  if (
    Object.keys(value).length !== 4 ||
    !["format", "version", "frameworkId", "sections"].every((key) => Object.hasOwn(value, key))
  ) {
    refuse("malformed-document");
  }
  return { descriptor: value as unknown as CatalogFrameworkDescriptorV1, digest };
}

export function readCatalogFrameworkDescriptorV1Result(
  request: ReadCatalogFrameworkDescriptorV1Request,
): CatalogFrameworkDescriptorV1Result {
  try {
    const read = readDescriptor(request);
    return Object.freeze({ state: "read" as const, ...read });
  } catch (error) {
    return refusedFrom<CatalogFrameworkDescriptorRefusalV1>(error);
  }
}

export function readCatalogFrameworkDescriptorV1(
  request: ReadCatalogFrameworkDescriptorV1Request,
): CatalogFrameworkDescriptorV1 | undefined {
  const result = readCatalogFrameworkDescriptorV1Result(request);
  return result.state === "read" ? result.descriptor : undefined;
}

export const CATALOG_FRAMEWORK_PLUGINS_FORMAT_V1 = "aih-catalog-framework-plugins";
export const CATALOG_FRAMEWORK_PLUGINS_VERSION_V1 = 1;
export const CATALOG_FRAMEWORK_PLUGINS_SUBPATH_V1 = "./catalog-framework-plugins.json";
export const CATALOG_FRAMEWORK_PLUGINS_MAX_BYTES_V1 = 64 * 1024;

export interface CatalogFrameworkPluginIdentityV1 {
  readonly frameworkId: CatalogFrameworkIdV1;
  readonly packageName: "@aihq/framework-ecc" | "@aihq/framework-superpowers";
  readonly version: string;
  readonly contractVersion: 1;
  readonly upstream: { readonly repository: string; readonly commit: string };
  readonly supportedCore: string;
  readonly supportedHosts: readonly string[];
  readonly status: "candidate";
}

export interface CatalogFrameworkPluginsV1 {
  readonly format: typeof CATALOG_FRAMEWORK_PLUGINS_FORMAT_V1;
  readonly version: typeof CATALOG_FRAMEWORK_PLUGINS_VERSION_V1;
  readonly entries: readonly CatalogFrameworkPluginIdentityV1[];
}

export type CatalogFrameworkPluginsV1Result =
  | { readonly state: "read"; readonly plugins: CatalogFrameworkPluginsV1; readonly digest: string }
  | CatalogReadRefusedV1<CatalogFrameworkDescriptorRefusalV1>;

function validPluginEntry(value: unknown, frameworkId: CatalogFrameworkIdV1): boolean {
  if (!isObject(value)) return false;
  const expectedPackage =
    frameworkId === "ecc" ? "@aihq/framework-ecc" : "@aihq/framework-superpowers";
  return (
    Object.keys(value).length === 8 &&
    value.frameworkId === frameworkId &&
    value.packageName === expectedPackage &&
    value.version === "0.1.0" &&
    value.contractVersion === 1 &&
    isObject(value.upstream) &&
    typeof value.upstream.repository === "string" &&
    typeof value.upstream.commit === "string" &&
    /^[0-9a-f]{40}$/.test(value.upstream.commit) &&
    value.supportedCore === ">=0.7.0 <0.8.0" &&
    Array.isArray(value.supportedHosts) &&
    value.supportedHosts.length > 0 &&
    value.supportedHosts.every((host) => typeof host === "string") &&
    value.status === "candidate"
  );
}

export function readCatalogFrameworkPluginsV1Result(request: {
  readonly bytes: Uint8Array;
  readonly expectedDigest?: string;
}): CatalogFrameworkPluginsV1Result {
  try {
    if (!isObject(request)) refuse("malformed-request");
    const { value, digest } = readCanonicalDocument({
      bytes: request.bytes,
      maxBytes: CATALOG_FRAMEWORK_PLUGINS_MAX_BYTES_V1,
      expectedDigest: request.expectedDigest,
      canonical: (document) => `${canonical(document)}\n`,
    });
    requireFormatAndVersion(
      value,
      CATALOG_FRAMEWORK_PLUGINS_FORMAT_V1,
      CATALOG_FRAMEWORK_PLUGINS_VERSION_V1,
    );
    if (
      Object.keys(value).length !== 3 ||
      !Array.isArray(value.entries) ||
      value.entries.length !== 2 ||
      !validPluginEntry(value.entries[0], "ecc") ||
      !validPluginEntry(value.entries[1], "superpowers")
    ) {
      refuse("malformed-document");
    }
    return Object.freeze({
      state: "read" as const,
      plugins: value as unknown as CatalogFrameworkPluginsV1,
      digest,
    });
  } catch (error) {
    return refusedFrom<CatalogFrameworkDescriptorRefusalV1>(error);
  }
}

export function readCatalogFrameworkPluginsV1(request: {
  readonly bytes: Uint8Array;
  readonly expectedDigest?: string;
}): CatalogFrameworkPluginsV1 | undefined {
  const result = readCatalogFrameworkPluginsV1Result(request);
  return result.state === "read" ? result.plugins : undefined;
}
