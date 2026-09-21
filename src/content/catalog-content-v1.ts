import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

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
 * - fails closed (returns `undefined`) on unknown format or version, malformed,
 *   non-canonical or oversize bytes, or an evidence record not bound to its subject.
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

const fail = (reason: string): undefined => {
  void reason;
  return undefined;
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
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

function descriptor(value: unknown): CatalogDescriptorV1 | undefined {
  if (!isObject(value)) return undefined;
  const path = safeRelativePath(value.path);
  const sha256 = value.sha256;
  if (path === undefined || typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) {
    return undefined;
  }
  return { path, sha256 };
}

function evidenceRecord(value: unknown, subjectDigest: string): CatalogEvidenceV1 | undefined {
  const declared = descriptor(value);
  if (declared === undefined || !isObject(value)) return undefined;
  const record = value.evidence;
  if (!isObject(record)) return undefined;
  if (record.format !== "aih-supported-evidence/v2") return undefined;
  if (!isText(record.kind) || !isText(record.id) || !isText(record.attestor)) return undefined;
  if (typeof record.summary !== "string") return undefined;
  // An evidence record that is not bound to this exact subject is not this entry's evidence.
  if (record.subjectDigest !== subjectDigest) return undefined;
  return {
    path: declared.path,
    sha256: declared.sha256,
    subjectDigest,
    format: record.format,
    kind: record.kind,
    id: record.id,
    attestor: record.attestor,
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

/**
 * Reads and validates the published Catalog content index.
 *
 * Returns `undefined` for every structural refusal: unknown format or version,
 * malformed, non-canonical or oversize bytes, a duplicate entry identity, an
 * unsafe declared path, or evidence not bound to its entry's subject.
 */
export function readCatalogContentV1(
  request: ReadCatalogContentV1Request,
): CatalogContentV1 | undefined {
  if (!isObject(request)) return undefined;
  const { bytes } = request;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return fail("empty bytes");
  if (bytes.byteLength > CATALOG_CONTENT_MAX_BYTES_V1) return fail("oversize bytes");
  // A BOM would change the digest while leaving values equal.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return fail("byte order mark");
  const text = Buffer.from(bytes).toString("utf8");
  // Reject any byte sequence that is not exactly round-trippable UTF-8.
  if (!Buffer.from(text, "utf8").equals(Buffer.from(bytes))) return fail("utf8");

  const digest = `sha256:${sha256Hex(bytes)}`;
  if (request.expectedDigest !== undefined && request.expectedDigest !== digest) {
    return fail("declared digest mismatch");
  }

  let value: unknown;
  try {
    value = parseStrictJson(text);
  } catch {
    return fail("malformed or non-canonical json");
  }
  if (!isObject(value)) return fail("document");

  // Exactly one supported format and version. Anything else fails closed.
  if (value.format !== CATALOG_CONTENT_FORMAT_V1) return fail("format");
  if (value.version !== CATALOG_CONTENT_VERSION_V1) return fail("version");

  const packageValue = value.package;
  if (!isObject(packageValue) || !isText(packageValue.name) || !isText(packageValue.version)) {
    return fail("package");
  }
  if (!isText(value.organizationAdmission)) return fail("organizationAdmission");
  if (!Array.isArray(value.entries) || value.entries.length === 0) return fail("entries");

  const seen = new Set<string>();
  const entries: CatalogEntryV1[] = [];
  for (const raw of value.entries) {
    const entry = readEntry(raw, seen);
    if (entry === undefined) return fail("entry");
    entries.push(entry);
  }
  // The generator emits entries in code-unit `entryId` order; a different order is a rewrite.
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1]?.entryId ?? "";
    const current = entries[index]?.entryId ?? "";
    if (previous >= current) return fail("entry order");
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

function readEntry(raw: unknown, seen: Set<string>): CatalogEntryV1 | undefined {
  if (!isObject(raw)) return undefined;
  const entryId = raw.entryId;
  if (!isText(entryId) || seen.has(entryId)) return undefined;
  const parsedSubject = subject(raw.subject);
  const seed = descriptor(raw.seed);
  const parsedCapabilities = capabilities(raw.capabilities);
  const parsedPlatforms = platforms(raw.platforms);
  if (parsedSubject === undefined || seed === undefined) return undefined;
  if (parsedCapabilities === undefined || parsedPlatforms === undefined) return undefined;
  if (!isObject(raw.qualification) || !isObject(raw.artifacts)) return undefined;

  const artifacts: Partial<Record<CatalogArtifactNameV1, CatalogArtifactV1>> = {};
  for (const name of ARTIFACT_NAMES) {
    const declared = descriptor(raw.artifacts[name]);
    if (declared === undefined) return undefined;
    artifacts[name] = { state: "not-evaluated", path: declared.path, sha256: declared.sha256 };
  }

  const qualification = raw.qualification;
  const report = evidenceRecord(qualification.report, parsedSubject.subjectDigest);
  if (report === undefined) return undefined;
  const list = (name: string, kind: CatalogEvidenceKindV1): CatalogEvidenceV1[] | undefined => {
    const value = qualification[name];
    if (!Array.isArray(value)) return undefined;
    const records: CatalogEvidenceV1[] = [];
    for (const item of value) {
      const record = evidenceRecord(item, parsedSubject.subjectDigest);
      if (record === undefined || record.kind !== kind) return undefined;
      records.push(record);
    }
    return records;
  };
  const findings = list("findings", "finding");
  const gaps = list("gaps", "gap");
  const rights = list("rights", "right");
  if (findings === undefined || gaps === undefined || rights === undefined) return undefined;

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
 * Strict parse: the document must be the canonical serialization the publisher
 * emits. A reformatted document cannot honestly claim the published digest, so
 * it is refused rather than repaired. Duplicate members are already collapsed by
 * `JSON.parse`, which changes the value and therefore breaks the round-trip.
 */
function parseStrictJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  const canonical = `${JSON.stringify(value)}\n`;
  if (canonical !== text) throw new TypeError("non-canonical");
  return value;
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
