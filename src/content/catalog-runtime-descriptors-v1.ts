import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CATALOG_CONTENT_INDEX_ROOT_URL,
  type CatalogContentV1,
  resolveCatalogContentPathV1,
} from "./catalog-content-v1.js";
import {
  type CatalogReadRefusedV1,
  isObject,
  readCanonicalDocument,
  refuse,
  refusedFrom,
  requireAscending,
  requireFormatAndVersion,
} from "./refusal-v1.js";

/**
 * Public, Catalog-owned distribution of framework runtime descriptors: the exact
 * sealed bytes Core's historical-runtime resolver reads for one framework source
 * revision, today the ECC `ecc-runtime-descriptor/v1` of the ECC revision this
 * Catalog indexes.
 *
 * A descriptor is runtime material. It is not presentation metadata, not an
 * assessment identity, not the source closure, not a scan record and not a
 * qualification: it is one opaque, Core-format document that carries its own
 * component, relation, adapter-compatibility and evidence-custody facts. Catalog
 * does not interpret, re-serialize, re-sign or re-date it. It checks only that
 * the bytes hash to their declared digest and length, parse as JSON, and declare
 * the format and source revision the sidecar names; Core keeps its own schema,
 * seal, custody and expiry checks.
 *
 * Each entry records its origin: the sealed Core packaged source-data record the
 * bytes were taken from, so the relocation is auditable against that record.
 *
 * Distribution is never organization admission, installation or effect
 * authority. This reader performs no network access, executes nothing and writes
 * nothing. `readCatalogRuntimeDescriptorsV1Result` names every refusal;
 * `readCatalogRuntimeDescriptorsV1` returns `undefined` for each of them.
 */

export const CATALOG_RUNTIME_DESCRIPTORS_FORMAT_V1 = "aih-catalog-runtime-descriptors";
export const CATALOG_RUNTIME_DESCRIPTORS_VERSION_V1 = 1;
/** Root-relative location of the sidecar inside the installed package. */
export const CATALOG_RUNTIME_DESCRIPTORS_ROOT_URL = "defaults/catalog-runtime-descriptors-v1.json";
/** Public subpath export carrying those bytes: `@aihq/catalog/catalog-runtime-descriptors.json`. */
export const CATALOG_RUNTIME_DESCRIPTORS_SUBPATH_V1 = "./catalog-runtime-descriptors.json";
export const CATALOG_RUNTIME_DESCRIPTORS_MAX_BYTES_V1 = 1024 * 1024;
/** Equal to Core's own ceiling for one runtime descriptor. */
export const CATALOG_RUNTIME_DESCRIPTOR_MAX_BYTES_V1 = 12 * 1024 * 1024;
export const CATALOG_RUNTIME_DESCRIPTORS_MAX_ENTRIES_V1 = 64;

/** The descriptor formats this version distributes, by framework. A closed set. */
const SUPPORTED: ReadonlyArray<readonly [framework: string, format: string]> = [
  ["ecc", "ecc-runtime-descriptor/v1"],
];

const SHA256_HEX = /^[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type CatalogRuntimeDescriptorFrameworkV1 = "ecc";
export type CatalogRuntimeDescriptorFormatV1 = "ecc-runtime-descriptor/v1";

/** Why a descriptor's bytes did not verify. A verdict about those bytes, not a refusal. */
export type CatalogRuntimeDescriptorUnverifiedReasonV1 =
  | "descriptor-absent"
  | "descriptor-unreadable"
  | "descriptor-size-mismatch"
  | "descriptor-digest-mismatch"
  | "descriptor-malformed"
  | "descriptor-identity-mismatch";

/** `path` is package-root-relative POSIX; `sha256` is bare 64-hex over the exact bytes. */
export type CatalogRuntimeDescriptorFileV1 =
  | {
      readonly state: "not-evaluated";
      readonly path: string;
      readonly sha256: string;
      readonly byteLength: number;
    }
  | {
      readonly state: "verified";
      readonly path: string;
      readonly sha256: string;
      readonly byteLength: number;
      /** The exact sealed bytes. Core parses and validates them; Catalog does not. */
      readonly bytes: Uint8Array;
    }
  | {
      readonly state: "unverified";
      readonly path: string;
      readonly sha256: string;
      readonly byteLength: number;
      readonly reason: CatalogRuntimeDescriptorUnverifiedReasonV1;
    };

export interface CatalogRuntimeDescriptorEntryV1 {
  readonly framework: CatalogRuntimeDescriptorFrameworkV1;
  /** The descriptor's own `version` literal, owned by Core. */
  readonly format: CatalogRuntimeDescriptorFormatV1;
  /** The framework source revision the descriptor describes; the index carries it. */
  readonly source: {
    readonly type: "github";
    readonly repository: string;
    readonly commit: string;
  };
  /** The sealed Core packaged source-data record (bare sha256) the bytes were taken from. */
  readonly origin: { readonly kind: "core-packaged-source-data"; readonly recordSha256: string };
  readonly descriptor: CatalogRuntimeDescriptorFileV1;
}

export interface CatalogRuntimeDescriptorsV1 {
  readonly format: typeof CATALOG_RUNTIME_DESCRIPTORS_FORMAT_V1;
  readonly version: typeof CATALOG_RUNTIME_DESCRIPTORS_VERSION_V1;
  /** `sha256:<64 hex>` over the exact sidecar bytes read. */
  readonly digest: string;
  /** Always `"not-authoritative"`. Never admission. */
  readonly organizationAdmission: "not-authoritative";
  /** The exact index these descriptors belong to. */
  readonly index: { readonly path: string; readonly sha256: string };
  readonly status: { readonly descriptors: "verified" | "unverified" | "not-evaluated" };
  readonly descriptors: readonly CatalogRuntimeDescriptorEntryV1[];
}

/** Caller-supplied byte access. Returning `undefined` means the descriptor is genuinely absent. */
export interface CatalogRuntimeDescriptorsV1Input {
  readonly root: string;
  /** Read, hash and identity-check every descriptor. Without it each is `not-evaluated`. */
  readonly verifyDescriptors?: boolean;
  readonly readFile?: (request: {
    readonly path: string;
    readonly sha256: string;
  }) => Uint8Array | undefined;
}

export interface ReadCatalogRuntimeDescriptorsV1Request {
  /** The exact sidecar bytes, normally read from the installed package root. */
  readonly bytes: Uint8Array;
  /** The index the descriptors must belong to, as returned by `readCatalogContentV1`. */
  readonly index: CatalogContentV1;
  /** Optional pin. A mismatch is a refusal, never a repair. */
  readonly expectedDigest?: string;
  readonly input?: CatalogRuntimeDescriptorsV1Input;
}

/** Every reason `readCatalogRuntimeDescriptorsV1Result` can refuse with. A closed set. */
export const CATALOG_RUNTIME_DESCRIPTORS_REFUSALS_V1 = [
  "malformed-request",
  "malformed-bytes",
  "oversize-bytes",
  "non-canonical-bytes",
  "digest-mismatch",
  "malformed-document",
  "unknown-format",
  "unknown-version",
  "index-mismatch",
  "malformed-entry",
  "unsupported-descriptor",
  "unsafe-path",
  "source-not-in-index",
  "duplicate-entry",
  "unordered-entries",
] as const;
export type CatalogRuntimeDescriptorsRefusalV1 =
  (typeof CATALOG_RUNTIME_DESCRIPTORS_REFUSALS_V1)[number];

/**
 * A structural refusal is about the sidecar. A sidecar that is read still carries
 * a per-descriptor byte verdict; that verdict is never a refusal.
 */
export type CatalogRuntimeDescriptorsV1Result =
  | { readonly state: "read"; readonly runtimeDescriptors: CatalogRuntimeDescriptorsV1 }
  | CatalogReadRefusedV1<CatalogRuntimeDescriptorsRefusalV1>;

const matches = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.test(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
};
const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Package-root-relative POSIX path: no absolute form, drive letter, backslash or traversal. */
function safeRelativePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) return undefined;
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) return undefined;
  if (/^[A-Za-z]:/.test(value)) return undefined;
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  return value;
}

function entry(raw: unknown, sources: ReadonlySet<string>): CatalogRuntimeDescriptorEntryV1 {
  if (
    !isObject(raw) ||
    !exactKeys(raw, ["descriptor", "format", "framework", "origin", "source"])
  ) {
    return refuse("malformed-entry");
  }
  const { framework, format, source, origin, descriptor } = raw;
  if (typeof framework !== "string" || typeof format !== "string") return refuse("malformed-entry");
  // Only a descriptor format this version knows is distributed; anything else fails closed.
  if (!SUPPORTED.some(([known, knownFormat]) => known === framework && knownFormat === format)) {
    return refuse("unsupported-descriptor");
  }
  if (
    !isObject(source) ||
    !exactKeys(source, ["commit", "repository", "type"]) ||
    source.type !== "github" ||
    !matches(source.repository, REPOSITORY) ||
    !matches(source.commit, GIT_COMMIT)
  ) {
    return refuse("malformed-entry");
  }
  if (
    !isObject(origin) ||
    !exactKeys(origin, ["kind", "recordSha256"]) ||
    origin.kind !== "core-packaged-source-data" ||
    !matches(origin.recordSha256, SHA256_HEX)
  ) {
    return refuse("malformed-entry");
  }
  if (!isObject(descriptor) || !exactKeys(descriptor, ["byteLength", "path", "sha256"])) {
    return refuse("malformed-entry");
  }
  if (typeof descriptor.path !== "string") return refuse("malformed-entry");
  const path = safeRelativePath(descriptor.path);
  if (path === undefined) return refuse("unsafe-path");
  const { byteLength } = descriptor;
  if (
    !matches(descriptor.sha256, SHA256_HEX) ||
    typeof byteLength !== "number" ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1 ||
    byteLength > CATALOG_RUNTIME_DESCRIPTOR_MAX_BYTES_V1
  ) {
    return refuse("malformed-entry");
  }
  // A descriptor for a revision this index does not carry describes content Catalog does not publish.
  if (!sources.has(`${source.repository}\u0000${source.commit}`)) {
    return refuse("source-not-in-index");
  }
  return Object.freeze({
    framework: framework as CatalogRuntimeDescriptorFrameworkV1,
    format: format as CatalogRuntimeDescriptorFormatV1,
    source: Object.freeze({
      type: "github" as const,
      repository: source.repository,
      commit: source.commit,
    }),
    origin: Object.freeze({
      kind: "core-packaged-source-data" as const,
      recordSha256: origin.recordSha256,
    }),
    descriptor: Object.freeze({
      state: "not-evaluated" as const,
      path,
      sha256: descriptor.sha256,
      byteLength,
    }),
  });
}

function verify(
  declared: CatalogRuntimeDescriptorEntryV1,
  reader: (request: { readonly path: string; readonly sha256: string }) => Uint8Array | undefined,
): CatalogRuntimeDescriptorFileV1 {
  const { path, sha256, byteLength } = declared.descriptor;
  const unverified = (reason: CatalogRuntimeDescriptorUnverifiedReasonV1) =>
    Object.freeze({ state: "unverified" as const, path, sha256, byteLength, reason });
  let bytes: Uint8Array | undefined;
  try {
    bytes = reader({ path, sha256 });
  } catch {
    return unverified("descriptor-unreadable");
  }
  if (bytes === undefined) return unverified("descriptor-absent");
  if (!(bytes instanceof Uint8Array)) return unverified("descriptor-unreadable");
  if (bytes.byteLength !== byteLength) return unverified("descriptor-size-mismatch");
  if (sha256Hex(bytes) !== sha256) return unverified("descriptor-digest-mismatch");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return unverified("descriptor-malformed");
  }
  if (!isObject(value)) return unverified("descriptor-malformed");
  const source = value.source;
  if (
    value.version !== declared.format ||
    !isObject(source) ||
    source.repository !== declared.source.repository ||
    source.commit !== declared.source.commit
  ) {
    return unverified("descriptor-identity-mismatch");
  }
  const copy = Uint8Array.from(bytes);
  return Object.freeze({
    state: "verified" as const,
    path,
    sha256,
    byteLength: copy.byteLength,
    bytes: copy,
  });
}

function defaultReader(
  root: string,
): (request: { readonly path: string; readonly sha256: string }) => Uint8Array | undefined {
  return ({ path }) => {
    const target = resolveCatalogContentPathV1(root, path);
    if (target === undefined) return undefined;
    try {
      return readFileSync(target);
    } catch {
      return undefined;
    }
  };
}

/**
 * Reads and validates the runtime-descriptor sidecar against the index it
 * belongs to, naming why it refuses: `unknown-format` and `unknown-version`
 * (each with the declared value in `observed`), malformed, oversize or
 * non-canonical bytes, a digest pin mismatch, a malformed document or entry, a
 * sidecar cut from another index (`index-mismatch`), a descriptor format this
 * version does not distribute (`unsupported-descriptor`), an unsafe path, a
 * source revision the index does not carry (`source-not-in-index`), or a
 * duplicate or out-of-order entry. With `input.verifyDescriptors` it also reads
 * each descriptor and states a byte verdict for it.
 */
export function readCatalogRuntimeDescriptorsV1Result(
  request: ReadCatalogRuntimeDescriptorsV1Request,
): CatalogRuntimeDescriptorsV1Result {
  try {
    return Object.freeze({
      state: "read" as const,
      runtimeDescriptors: readRuntimeDescriptors(request),
    });
  } catch (error) {
    return refusedFrom<CatalogRuntimeDescriptorsRefusalV1>(error);
  }
}

/**
 * Reads and validates the runtime-descriptor sidecar. Returns `undefined` for
 * every refusal; use `readCatalogRuntimeDescriptorsV1Result` to learn which.
 */
export function readCatalogRuntimeDescriptorsV1(
  request: ReadCatalogRuntimeDescriptorsV1Request,
): CatalogRuntimeDescriptorsV1 | undefined {
  const result = readCatalogRuntimeDescriptorsV1Result(request);
  return result.state === "read" ? result.runtimeDescriptors : undefined;
}

function readRuntimeDescriptors(
  request: ReadCatalogRuntimeDescriptorsV1Request,
): CatalogRuntimeDescriptorsV1 {
  if (!isObject(request)) return refuse("malformed-request");
  const { index, input } = request;
  if (
    !isObject(index) ||
    !Array.isArray(index.entries) ||
    typeof index.digest !== "string" ||
    !index.digest.startsWith("sha256:")
  ) {
    return refuse("malformed-request");
  }
  if (
    input !== undefined &&
    (!isObject(input) ||
      typeof input.root !== "string" ||
      (input.readFile !== undefined && typeof input.readFile !== "function"))
  ) {
    return refuse("malformed-request");
  }
  const { value, digest } = readCanonicalDocument({
    bytes: request.bytes,
    maxBytes: CATALOG_RUNTIME_DESCRIPTORS_MAX_BYTES_V1,
    expectedDigest: request.expectedDigest,
    // The generator emits sorted-key canonical JSON plus a newline.
    canonical: (parsed) => `${JSON.stringify(parsed)}\n`,
  });
  requireFormatAndVersion(
    value,
    CATALOG_RUNTIME_DESCRIPTORS_FORMAT_V1,
    CATALOG_RUNTIME_DESCRIPTORS_VERSION_V1,
  );
  if (!exactKeys(value, ["descriptors", "format", "index", "organizationAdmission", "version"])) {
    return refuse("malformed-document");
  }
  if (value.organizationAdmission !== "not-authoritative") return refuse("malformed-document");
  const boundIndex = value.index;
  if (
    !isObject(boundIndex) ||
    !exactKeys(boundIndex, ["path", "sha256"]) ||
    !matches(boundIndex.sha256, SHA256_HEX)
  ) {
    return refuse("malformed-document");
  }
  // The sidecar belongs to exactly the index it was cut from, and no other.
  if (boundIndex.path !== CATALOG_CONTENT_INDEX_ROOT_URL) return refuse("index-mismatch");
  if (`sha256:${boundIndex.sha256}` !== index.digest) return refuse("index-mismatch");
  const listed = value.descriptors;
  if (
    !Array.isArray(listed) ||
    listed.length === 0 ||
    listed.length > CATALOG_RUNTIME_DESCRIPTORS_MAX_ENTRIES_V1
  ) {
    return refuse("malformed-document");
  }

  const sources = new Set<string>();
  for (const item of index.entries) {
    const source = item.subject.source;
    if (source.type === "github" && source.repository && source.commit) {
      sources.add(`${source.repository}\u0000${source.commit}`);
    }
  }
  const entries: CatalogRuntimeDescriptorEntryV1[] = [];
  let previous: string | undefined;
  for (const raw of listed) {
    const parsed = entry(raw, sources);
    const key = `${parsed.framework}\u0000${parsed.source.repository}\u0000${parsed.source.commit}`;
    // The generator emits entries in code-unit order of framework, repository and commit.
    requireAscending(previous, key);
    previous = key;
    entries.push(parsed);
  }

  const evaluate = input?.verifyDescriptors === true;
  const reader = evaluate ? (input?.readFile ?? defaultReader(input?.root as string)) : undefined;
  const descriptors =
    reader === undefined
      ? entries
      : entries.map((item) => Object.freeze({ ...item, descriptor: verify(item, reader) }));
  const status = !evaluate
    ? "not-evaluated"
    : descriptors.every((item) => item.descriptor.state === "verified")
      ? "verified"
      : "unverified";

  return Object.freeze({
    format: CATALOG_RUNTIME_DESCRIPTORS_FORMAT_V1,
    version: CATALOG_RUNTIME_DESCRIPTORS_VERSION_V1,
    digest,
    organizationAdmission: "not-authoritative",
    index: Object.freeze({ path: boundIndex.path, sha256: boundIndex.sha256 }),
    status: Object.freeze({ descriptors: status }),
    descriptors: Object.freeze(descriptors),
  });
}
