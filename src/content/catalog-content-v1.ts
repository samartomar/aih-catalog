import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
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
 * Public, Catalog-owned reading of the published Strict Catalog content index.
 *
 * This module is the only supported way for another package or the UI to obtain
 * Catalog item, source, revision, artifact and published-evidence identity. It:
 *
 * - reads the exact canonical index bytes and never reformats them;
 * - reports the index digest that a consumer may hand to Core as a provenance pin;
 * - preserves each entry's exact item/source/revision/content identity verbatim;
 * - verifies artifact and evidence bytes against their declared sha256 on request;
 * - fails closed on unknown format or version, malformed, non-canonical or
 *   oversize bytes, or an evidence record not bound to its subject: the
 *   `…Result` function names the reason, and the original function returns
 *   `undefined`.
 *
 * Catalog content presence is never organization admission, qualification,
 * installation or effect authority. This reader performs no network access,
 * executes nothing, and writes nothing.
 */

export const CATALOG_CONTENT_FORMAT_V1 = "aih-catalog-index";
export const CATALOG_CONTENT_VERSION_V1 = 1;
/** Root-relative location of the index inside the installed package. */
export const CATALOG_CONTENT_INDEX_ROOT_URL = "defaults/catalog-index-v1.json";
/** Public subpath export carrying those bytes: `@aihq/catalog/catalog-index.json`. */
export const CATALOG_CONTENT_INDEX_SUBPATH_V1 = "./catalog-index.json";
export const CATALOG_CONTENT_MAX_BYTES_V1 = 64 * 1024 * 1024;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const PREFIXED_SHA256 = /^sha256:[0-9a-f]{64}$/;
const ARTIFACT_NAMES = ["closure", "profile", "prose", "recipe"] as const;
const SUBJECT_KINDS = ["tool", "skill", "agent", "mcp", "package", "profile"] as const;

export type CatalogArtifactNameV1 = (typeof ARTIFACT_NAMES)[number];
export type CatalogSubjectKindV1 = (typeof SUBJECT_KINDS)[number];
export type CatalogEvidenceKindV1 = "report" | "finding" | "gap" | "right";

export interface CatalogContentStatusV1 {
  readonly structure: "valid" | "invalid";
  readonly artifacts: "verified" | "unverified" | "not-evaluated";
}

/** A declared content address. `path` is package-root-relative POSIX; `sha256` is bare 64-hex. */
export interface CatalogDescriptorV1 {
  readonly path: string;
  readonly sha256: string;
}

export type CatalogArtifactV1 =
  | { readonly state: "not-evaluated"; readonly path: string; readonly sha256: string }
  | {
      readonly state: "verified";
      readonly path: string;
      readonly sha256: string;
      readonly bytes: Uint8Array;
      readonly byteLength: number;
    }
  | {
      readonly state: "unverified";
      readonly path: string;
      readonly sha256: string;
      readonly reason: string;
    };

/** Published evidence identity as declared by the index, before any byte check. */
export interface CatalogEvidenceV1 {
  readonly path: string;
  readonly sha256: string;
  readonly subjectDigest: string;
  readonly format: string;
  readonly kind: string;
  readonly id: string;
  readonly attestor: string;
  /**
   * The evidence envelope's own free-text summary, verbatim: at most 4096
   * characters, no control characters other than a line feed. Prose, never a
   * structured verdict or severity.
   */
  readonly summary: string;
}

export interface CatalogQualificationV1 {
  readonly report: CatalogEvidenceV1;
  readonly findings: readonly CatalogEvidenceV1[];
  readonly gaps: readonly CatalogEvidenceV1[];
  readonly rights: readonly CatalogEvidenceV1[];
}

export interface CatalogPlatformV1 {
  readonly os: string;
  readonly architecture: string;
}

/**
 * Exact item identity. `subject` is carried verbatim in Core's
 * `GovernanceDecisionSubjectV2` shape: Catalog never recomputes these digests here.
 */
export interface CatalogEntryV1 {
  readonly entryId: string;
  readonly subject: {
    readonly id: string;
    readonly kind: CatalogSubjectKindV1;
    readonly source: Readonly<Record<string, string>>;
    readonly sourceDigest: string;
    readonly subjectDigest: string;
  };
  readonly seed: CatalogDescriptorV1;
  readonly capabilities: {
    readonly commands: readonly string[];
    readonly egress: readonly string[];
    readonly hooks: readonly string[];
    readonly mcpTools: readonly string[];
    readonly permissions: readonly string[];
  };
  readonly platforms: readonly CatalogPlatformV1[];
  readonly artifacts: Readonly<Record<CatalogArtifactNameV1, CatalogArtifactV1 | undefined>>;
  readonly qualification: CatalogQualificationV1;
}

export interface CatalogContentV1 {
  readonly format: typeof CATALOG_CONTENT_FORMAT_V1;
  readonly version: typeof CATALOG_CONTENT_VERSION_V1;
  /** `sha256:<64 hex>` over the exact canonical index bytes read. */
  readonly digest: string;
  readonly package: { readonly name: string; readonly version: string };
  /** Surfaced verbatim from the index; today `"not-authoritative"`. Never admission. */
  readonly organizationAdmission: string;
  readonly status: CatalogContentStatusV1;
  readonly entries: readonly CatalogEntryV1[];
}

/** Caller-supplied byte access. Returning `undefined` means the artifact is genuinely absent. */
export interface CatalogContentV1Input {
  readonly root: string;
  readonly verifyArtifacts?: boolean;
  readonly readArtifact?: (request: {
    readonly path: string;
    readonly sha256: string;
  }) => Uint8Array | undefined;
}

export interface ReadCatalogContentV1Request {
  /** The exact index bytes, normally read from the installed package root. */
  readonly bytes: Uint8Array;
  /** Optional pin. A mismatch is a refusal, never a repair. */
  readonly expectedDigest?: string;
  readonly input?: CatalogContentV1Input;
}

const EVIDENCE_SUMMARY_MAX_TEXT = 4096;
/** Control characters, except the line feed that multi-line prose legitimately carries. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused.
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Package-root-relative POSIX path: no absolute form, no drive letter, no traversal. */
function safeRelativePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) return undefined;
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) return undefined;
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  return value;
}

/** A declared content address, or a named refusal: `unsafe-path` or `malformed-entry`. */
function descriptor(value: unknown): CatalogDescriptorV1 {
  if (!isObject(value) || typeof value.path !== "string") return refuse("malformed-entry");
  const path = safeRelativePath(value.path);
  if (path === undefined) return refuse("unsafe-path");
  const sha256 = value.sha256;
  if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) return refuse("malformed-entry");
  return { path, sha256 };
}

function evidenceRecord(value: unknown, subjectDigest: string): CatalogEvidenceV1 {
  const declared = descriptor(value);
  if (!isObject(value)) return refuse("malformed-entry");
  const record = value.evidence;
  if (!isObject(record)) return refuse("malformed-entry");
  if (record.format !== "aih-supported-evidence/v2") return refuse("malformed-entry");
  if (!isText(record.kind) || !isText(record.id) || !isText(record.attestor)) {
    return refuse("malformed-entry");
  }
  if (typeof record.summary !== "string") return refuse("malformed-entry");
  if (record.summary.length > EVIDENCE_SUMMARY_MAX_TEXT || CONTROL.test(record.summary)) {
    return refuse("malformed-entry");
  }
  // An evidence record that is not bound to this exact subject is not this entry's evidence.
  if (record.subjectDigest !== subjectDigest) return refuse("evidence-not-bound");
  return {
    path: declared.path,
    sha256: declared.sha256,
    subjectDigest,
    format: record.format,
    kind: record.kind,
    id: record.id,
    attestor: record.attestor,
    summary: record.summary,
  };
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "string") ? [...value] : undefined;
}

function capabilities(value: unknown): CatalogEntryV1["capabilities"] | undefined {
  if (!isObject(value)) return undefined;
  const commands = strings(value.commands);
  const egress = strings(value.egress);
  const hooks = strings(value.hooks);
  const mcpTools = strings(value.mcpTools);
  const permissions = strings(value.permissions);
  if (
    commands === undefined ||
    egress === undefined ||
    hooks === undefined ||
    mcpTools === undefined ||
    permissions === undefined
  ) {
    return undefined;
  }
  return { commands, egress, hooks, mcpTools, permissions };
}

function source(value: unknown): Readonly<Record<string, string>> | undefined {
  if (!isObject(value) || !isText(value.type)) return undefined;
  const entries: [string, string][] = [];
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") return undefined;
    entries.push([key, item]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function subject(value: unknown): CatalogEntryV1["subject"] | undefined {
  if (!isObject(value)) return undefined;
  const id = value.id;
  const kind = value.kind;
  if (!isText(id) || typeof kind !== "string") return undefined;
  if (!(SUBJECT_KINDS as readonly string[]).includes(kind)) return undefined;
  const declaredSource = source(value.source);
  const sourceDigest = value.sourceDigest;
  const subjectDigest = value.subjectDigest;
  if (declaredSource === undefined) return undefined;
  if (typeof sourceDigest !== "string" || !PREFIXED_SHA256.test(sourceDigest)) return undefined;
  if (typeof subjectDigest !== "string" || !PREFIXED_SHA256.test(subjectDigest)) return undefined;
  return {
    id,
    kind: kind as CatalogSubjectKindV1,
    source: declaredSource,
    sourceDigest,
    subjectDigest,
  };
}

function platforms(value: unknown): CatalogPlatformV1[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: CatalogPlatformV1[] = [];
  for (const item of value) {
    if (!isObject(item) || !isText(item.os) || !isText(item.architecture)) return undefined;
    parsed.push({ os: item.os, architecture: item.architecture });
  }
  return parsed;
}

/** Every reason `readCatalogContentV1Result` can refuse with. A closed set. */
export const CATALOG_CONTENT_REFUSALS_V1 = [
  "malformed-request",
  "malformed-bytes",
  "oversize-bytes",
  "non-canonical-bytes",
  "digest-mismatch",
  "malformed-document",
  "unknown-format",
  "unknown-version",
  "malformed-entry",
  "duplicate-entry",
  "unordered-entries",
  "unsafe-path",
  "evidence-not-bound",
] as const;
export type CatalogContentRefusalV1 = (typeof CATALOG_CONTENT_REFUSALS_V1)[number];

export type CatalogContentV1Result =
  | { readonly state: "read"; readonly content: CatalogContentV1 }
  | CatalogReadRefusedV1<CatalogContentRefusalV1>;

/**
 * Reads and validates the published Catalog content index, naming why it
 * refuses: `unknown-format` and `unknown-version` (each with the declared value
 * in `observed`), malformed, oversize or non-canonical bytes, a digest pin
 * mismatch, a malformed document or entry, a duplicate or out-of-order entry, an
 * unsafe declared path, or evidence not bound to its entry's subject.
 */
export function readCatalogContentV1Result(
  request: ReadCatalogContentV1Request,
): CatalogContentV1Result {
  try {
    return Object.freeze({ state: "read" as const, content: readContent(request) });
  } catch (error) {
    return refusedFrom<CatalogContentRefusalV1>(error);
  }
}

/**
 * Reads and validates the published Catalog content index.
 *
 * Returns `undefined` for every structural refusal: unknown format or version,
 * malformed, non-canonical or oversize bytes, a duplicate entry identity, an
 * unsafe declared path, or evidence not bound to its entry's subject. Use
 * `readCatalogContentV1Result` to learn which.
 */
export function readCatalogContentV1(
  request: ReadCatalogContentV1Request,
): CatalogContentV1 | undefined {
  const result = readCatalogContentV1Result(request);
  return result.state === "read" ? result.content : undefined;
}

function readContent(request: ReadCatalogContentV1Request): CatalogContentV1 {
  if (!isObject(request)) return refuse("malformed-request");
  const { value, digest } = readCanonicalDocument({
    bytes: request.bytes,
    maxBytes: CATALOG_CONTENT_MAX_BYTES_V1,
    expectedDigest: request.expectedDigest,
    // The generator emits `JSON.stringify` of its own key order plus a newline.
    canonical: (parsed) => `${JSON.stringify(parsed)}\n`,
  });

  // Exactly one supported format and version. Anything else fails closed, by name.
  requireFormatAndVersion(value, CATALOG_CONTENT_FORMAT_V1, CATALOG_CONTENT_VERSION_V1);

  const packageValue = value.package;
  if (!isObject(packageValue) || !isText(packageValue.name) || !isText(packageValue.version)) {
    return refuse("malformed-document");
  }
  if (!isText(value.organizationAdmission)) return refuse("malformed-document");
  if (!Array.isArray(value.entries) || value.entries.length === 0) {
    return refuse("malformed-document");
  }

  const seen = new Set<string>();
  const entries: CatalogEntryV1[] = [];
  for (const raw of value.entries) {
    const entry = readEntry(raw, seen);
    // The generator emits entries in code-unit `entryId` order; a different order is a rewrite.
    requireAscending(entries.at(-1)?.entryId, entry.entryId);
    entries.push(entry);
  }

  const verify = request.input?.verifyArtifacts === true;
  if (!verify) {
    return Object.freeze({
      format: CATALOG_CONTENT_FORMAT_V1,
      version: CATALOG_CONTENT_VERSION_V1,
      digest,
      package: { name: packageValue.name, version: packageValue.version },
      organizationAdmission: value.organizationAdmission,
      status: Object.freeze({
        structure: "valid",
        artifacts: "not-evaluated",
      }) as CatalogContentStatusV1,
      entries: Object.freeze(entries),
    });
  }

  const input = request.input as CatalogContentV1Input;
  const reader = input.readArtifact ?? defaultArtifactReader(input.root);
  let allVerified = true;
  const resolvedEntries = entries.map((entry) => {
    const artifacts: Partial<Record<CatalogArtifactNameV1, CatalogArtifactV1>> = {};
    for (const name of ARTIFACT_NAMES) {
      const declared = entry.artifacts[name];
      if (declared === undefined) continue;
      const artifact = resolveArtifact(declared, reader);
      if (artifact.state !== "verified") allVerified = false;
      artifacts[name] = artifact;
    }
    return Object.freeze({ ...entry, artifacts: Object.freeze(artifacts) }) as CatalogEntryV1;
  });

  return Object.freeze({
    format: CATALOG_CONTENT_FORMAT_V1,
    version: CATALOG_CONTENT_VERSION_V1,
    digest,
    package: { name: packageValue.name, version: packageValue.version },
    organizationAdmission: value.organizationAdmission,
    status: Object.freeze({
      structure: "valid",
      artifacts: allVerified ? "verified" : "unverified",
    }) as CatalogContentStatusV1,
    entries: Object.freeze(resolvedEntries),
  });
}

function resolveArtifact(
  declared: CatalogDescriptorV1,
  reader: (request: { readonly path: string; readonly sha256: string }) => Uint8Array | undefined,
): CatalogArtifactV1 {
  let bytes: Uint8Array | undefined;
  try {
    bytes = reader({ path: declared.path, sha256: declared.sha256 });
  } catch {
    return {
      state: "unverified",
      path: declared.path,
      sha256: declared.sha256,
      reason: "artifact-bytes-unreadable",
    };
  }
  if (bytes === undefined) {
    return {
      state: "unverified",
      path: declared.path,
      sha256: declared.sha256,
      reason: "artifact-absent",
    };
  }
  if (!(bytes instanceof Uint8Array)) {
    return {
      state: "unverified",
      path: declared.path,
      sha256: declared.sha256,
      reason: "artifact-bytes-invalid",
    };
  }
  if (sha256Hex(bytes) !== declared.sha256) {
    return {
      state: "unverified",
      path: declared.path,
      sha256: declared.sha256,
      reason: "artifact-digest-mismatch",
    };
  }
  const copy = Uint8Array.from(bytes);
  return {
    state: "verified",
    path: declared.path,
    sha256: declared.sha256,
    bytes: copy,
    byteLength: copy.byteLength,
  };
}

function defaultArtifactReader(
  root: string,
): (request: { readonly path: string; readonly sha256: string }) => Uint8Array | undefined {
  const base = resolve(root);
  return ({ path }) => {
    try {
      return readFileSync(resolve(base, ...path.split("/")));
    } catch {
      return undefined;
    }
  };
}

function readEntry(raw: unknown, seen: Set<string>): CatalogEntryV1 {
  if (!isObject(raw)) return refuse("malformed-entry");
  const entryId = raw.entryId;
  if (!isText(entryId)) return refuse("malformed-entry");
  if (seen.has(entryId)) return refuse("duplicate-entry");
  const parsedSubject = subject(raw.subject);
  if (parsedSubject === undefined) return refuse("malformed-entry");
  const seed = descriptor(raw.seed);
  const parsedCapabilities = capabilities(raw.capabilities);
  const parsedPlatforms = platforms(raw.platforms);
  if (parsedCapabilities === undefined || parsedPlatforms === undefined) {
    return refuse("malformed-entry");
  }
  if (!isObject(raw.qualification) || !isObject(raw.artifacts)) return refuse("malformed-entry");

  const artifacts: Partial<Record<CatalogArtifactNameV1, CatalogArtifactV1>> = {};
  for (const name of ARTIFACT_NAMES) {
    const declared = descriptor(raw.artifacts[name]);
    artifacts[name] = { state: "not-evaluated", path: declared.path, sha256: declared.sha256 };
  }

  const qualification = raw.qualification;
  const report = evidenceRecord(qualification.report, parsedSubject.subjectDigest);
  const list = (name: string, kind: CatalogEvidenceKindV1): CatalogEvidenceV1[] => {
    const value = qualification[name];
    if (!Array.isArray(value)) return refuse("malformed-entry");
    const records: CatalogEvidenceV1[] = [];
    for (const item of value) {
      const record = evidenceRecord(item, parsedSubject.subjectDigest);
      if (record.kind !== kind) return refuse("malformed-entry");
      records.push(record);
    }
    return records;
  };
  const findings = list("findings", "finding");
  const gaps = list("gaps", "gap");
  const rights = list("rights", "right");

  seen.add(entryId);
  return Object.freeze({
    entryId,
    subject: Object.freeze(parsedSubject),
    seed: Object.freeze(seed),
    capabilities: Object.freeze(parsedCapabilities),
    platforms: Object.freeze(parsedPlatforms),
    artifacts: Object.freeze(artifacts),
    qualification: Object.freeze({
      report: Object.freeze(report),
      findings: Object.freeze(findings),
      gaps: Object.freeze(gaps),
      rights: Object.freeze(rights),
    }),
  }) as CatalogEntryV1;
}

/**
 * Parses index bytes without a pin or artifact access. Convenience for a caller
 * that only needs the declared identity; identical refusals to
 * `readCatalogContentV1`.
 */
export function parseCatalogContentV1Bytes(bytes: Uint8Array): CatalogContentV1 | undefined {
  return readCatalogContentV1({ bytes });
}

/** Joins a package root and a validated descriptor path without escaping the root. */
export function resolveCatalogContentPathV1(root: string, path: string): string | undefined {
  const safe = safeRelativePath(path);
  if (safe === undefined) return undefined;
  const base = resolve(root);
  const target = resolve(base, ...safe.split("/"));
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
  return target.startsWith(prefix) ? target : undefined;
}
