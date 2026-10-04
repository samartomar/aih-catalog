import { createHash, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  deriveQualificationBasisV2,
  parseQualificationReceiptV2Json,
  QUALIFICATION_RECEIPT_V2_MAX_BYTES,
  verifySignedCatalogV2,
} from "../supported/signed-catalog-v2.js";
import type { CatalogContentV1, CatalogDescriptorV1 } from "./catalog-content-v1.js";
import {
  type CatalogReadRefusedV1,
  readCanonicalDocument,
  refuse,
  refusedFrom,
  requireAscending,
  requireFormatAndVersion,
} from "./refusal-v1.js";

/**
 * Public, Catalog-owned reading of the published qualification basis: the signed
 * Catalog V2 head this package ships, the public signer root that head was signed
 * with, and one canonical Qualification Receipt per catalog member.
 *
 * Every verdict here is derived from bytes this reader hashed itself. The sidecar
 * is a locator and a restatement, never a trusted claim: a receipt is `qualified`
 * only when its own bytes hash to the declared digest, parse under the receipt
 * format, name this entry, carry this entry's member and subject identity, agree
 * with the shipped head, and fall inside the caller's clock.
 *
 * The outer GitHub attestation over these receipts is NOT in this package. It
 * exists only after the owner dispatches the publisher workflow at the exact
 * commit, so `attestation` reports `absent` for what this package ships. Publisher
 * qualification is never organization admission, installation or effect authority.
 *
 * Continuity limit, stated plainly: the predecessor head is not shipped, so this
 * reader cannot re-derive that this head's sequence follows that exact earlier
 * head. It verifies this head's own signature, signer, claims and validity
 * window, and requires every receipt to restate this head's own continuity
 * fields. The published `previousCatalogHeadDigest` and `sequence` are the
 * signed head's own values, not an independently checked chain.
 *
 * This reader performs no network access, executes nothing and writes nothing.
 * `readCatalogQualificationV1Result` names every structural refusal;
 * `readCatalogQualificationV1` returns `undefined` for each of them.
 */

export const CATALOG_QUALIFICATION_FORMAT_V1 = "aih-catalog-qualification";
export const CATALOG_QUALIFICATION_VERSION_V1 = 1;
/** Root-relative location of the sidecar inside the installed package. */
export const CATALOG_QUALIFICATION_ROOT_URL = "defaults/catalog-qualification-v1.json";
/** Public subpath export carrying those bytes: `@aihq/catalog/catalog-qualification.json`. */
export const CATALOG_QUALIFICATION_SUBPATH_V1 = "./catalog-qualification.json";
/** Root-relative location of the signed catalog head inside the installed package. */
export const CATALOG_SIGNED_CATALOG_ROOT_URL = "defaults/signed-catalog-v2.json";
/** Public subpath export carrying those bytes: `@aihq/catalog/signed-catalog.json`. */
export const CATALOG_SIGNED_CATALOG_SUBPATH_V1 = "./signed-catalog.json";
export const CATALOG_QUALIFICATION_MAX_BYTES_V1 = 8 * 1024 * 1024;
export const CATALOG_QUALIFICATION_HEAD_MAX_BYTES_V1 = 16 * 1024 * 1024;
export const CATALOG_QUALIFICATION_MAX_ENTRIES_V1 = 512;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const PREFIXED_SHA256 = /^sha256:[0-9a-f]{64}$/;
const KEY_ID = /^ed25519:[0-9a-f]{64}$/;
const ENTRY_ID = /^[a-z][a-z0-9.-]{0,63}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const REPLAY_IDENTITY = /^catalog-head:[0-9a-f]{64}:[0-9a-f]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORKFLOW = /^[A-Za-z0-9.][A-Za-z0-9._/-]*$/;
const REF = /^refs\/heads\/[A-Za-z0-9._/-]+$/;
const HTTPS_URL = /^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{1,512}$/;
const DIGITS = /^[0-9]{1,32}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Refusal codes of the head verifier that mean no supplied root signed the head. */
const SIGNER_REFUSALS: ReadonlySet<string> = new Set([
  "root",
  "roots",
  "64 roots",
  "duplicate root",
  "signature",
  "signer",
]);

const ENTRY_STATES = [
  "qualified",
  "expired",
  "not-yet-valid",
  "receipt-absent",
  "receipt-digest-mismatch",
  "receipt-malformed",
  "basis-mismatch",
  "member-mismatch",
  "subject-mismatch",
  "not-evaluated",
] as const;

/**
 * A closed set. `receipt-malformed` also covers bytes that parse but do not name
 * this entry; `basis-mismatch` covers a receipt that disagrees with the shipped
 * head, with this document's catalog identity, or with the validity window this
 * document declares for it.
 */
export type CatalogQualificationEntryStateV1 = (typeof ENTRY_STATES)[number];

/** `superseded`: the shipped head is not the head this document describes. */
export type CatalogQualificationSignatureStateV1 =
  | "verified"
  | "untrusted-signer"
  | "superseded"
  | "not-evaluated";

/**
 * `absent`: this package carries no outer attestation, which is the state today.
 * `published-locator`: the document names where an attestation was published; this
 * reader never verifies one, because that needs the network and GitHub's store.
 */
export type CatalogQualificationAttestationStateV1 =
  | "absent"
  | "published-locator"
  | "not-evaluated";

/** The signed head's own identity, restated. Verified when `verifySignature` is asked for. */
export interface CatalogQualificationCatalogV1 {
  readonly catalogDigest: string;
  readonly catalogHeadDigest: string;
  readonly previousCatalogHeadDigest: string;
  readonly replayIdentity: string;
  readonly sequence: number;
  readonly signerIdentity: string;
  readonly signerKeyId: string;
  readonly validFrom: string;
  readonly validUntil: string;
  /** The exact OIDC claim set the head was signed under. */
  readonly claims: Readonly<Record<string, string>>;
}

/** Public SPKI material only. A private key is never published and never read here. */
export interface CatalogQualificationSignerRootV1 {
  readonly class: string;
  readonly identity: string;
  readonly keyId: string;
  readonly publicKeySpkiDerBase64: string;
  readonly publicKeySpkiSha256: string;
}

/** Where an outer attestation over these bytes would be found, once one exists. */
export interface CatalogQualificationPublisherV1 {
  readonly repository: string;
  readonly workflow: string;
  readonly ref: string;
  readonly issuer: string;
  /** The exact owner operation that mints the outer attestation. */
  readonly requiredOperation: string;
  readonly receiptSubjectNamePattern: string;
  readonly receiptSetSubjectName: string;
  readonly locator: {
    readonly kind: string;
    readonly repository: string;
    readonly sourceDigest: string;
    readonly subjectDigest: string;
  } | null;
}

export interface CatalogQualificationEntryV1 {
  readonly entryId: string;
  /** This entry's subject digest, equal to the index's. */
  readonly subjectDigest: string;
  readonly catalogMemberDigest: string;
  readonly receipt: CatalogDescriptorV1;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly state: CatalogQualificationEntryStateV1;
}

export interface CatalogQualificationDocumentV1 {
  readonly format: typeof CATALOG_QUALIFICATION_FORMAT_V1;
  readonly version: typeof CATALOG_QUALIFICATION_VERSION_V1;
  /** `sha256:<64 hex>` over the exact sidecar bytes read. */
  readonly digest: string;
  readonly package: { readonly name: string; readonly version: string };
  /** Surfaced verbatim; today `"not-authoritative"`. Never admission. */
  readonly organizationAdmission: string;
  /** The fixed instant every shipped receipt was issued at. */
  readonly issuedAt: string;
  readonly catalog: CatalogQualificationCatalogV1;
  readonly signedCatalog: CatalogDescriptorV1;
  readonly receiptSet: CatalogDescriptorV1;
  readonly signerRoots: readonly CatalogQualificationSignerRootV1[];
  readonly publisher: CatalogQualificationPublisherV1;
  readonly signature: CatalogQualificationSignatureStateV1;
  readonly attestation: CatalogQualificationAttestationStateV1;
  readonly entries: readonly CatalogQualificationEntryV1[];
  readonly coverage: {
    readonly entries: number;
    readonly qualified: number;
    /** How many index entries this document covers at all. */
    readonly indexEntries: number;
  };
}

/** Caller-supplied byte access. Returning `undefined` means the file is genuinely absent. */
export interface CatalogQualificationV1Input {
  readonly root: string;
  /** Hash and parse every declared receipt. Without it every entry is `not-evaluated`. */
  readonly verifyReceipts?: boolean;
  /** Re-verify the shipped head against the shipped public signer roots. */
  readonly verifySignature?: boolean;
  readonly readFile?: (request: {
    readonly path: string;
    readonly sha256: string;
  }) => Uint8Array | undefined;
}

export interface ReadCatalogQualificationV1Request {
  /** The exact sidecar bytes, normally read from the installed package root. */
  readonly bytes: Uint8Array;
  /** The index the entries must belong to, as returned by `readCatalogContentV1`. */
  readonly index: CatalogContentV1;
  /** Canonical UTC instant. Without it validity is not evaluated. */
  readonly now?: string;
  /** Optional pin. A mismatch is a refusal, never a repair. */
  readonly expectedDigest?: string;
  readonly input?: CatalogQualificationV1Input;
}

/** Every structural reason `readCatalogQualificationV1Result` can refuse with. A closed set. */
export const CATALOG_QUALIFICATION_REFUSALS_V1 = [
  "malformed-request",
  "malformed-clock",
  "malformed-bytes",
  "oversize-bytes",
  "non-canonical-bytes",
  "digest-mismatch",
  "malformed-document",
  "unknown-format",
  "unknown-version",
  "malformed-catalog-identity",
  "issued-outside-window",
  "malformed-attestation",
  "claims-publisher-mismatch",
  "malformed-signer-root",
  "malformed-entry",
  "unsafe-path",
  "duplicate-entry",
  "unordered-entries",
  "index-mismatch",
] as const;
export type CatalogQualificationRefusalV1 = (typeof CATALOG_QUALIFICATION_REFUSALS_V1)[number];

/**
 * A structural refusal is about the document. A document that is read still
 * carries per-entry states and the signature and attestation states; those are
 * verdicts, never refusals.
 */
export type CatalogQualificationV1Result =
  | { readonly state: "read"; readonly qualification: CatalogQualificationDocumentV1 }
  | CatalogReadRefusedV1<CatalogQualificationRefusalV1>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const matches = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.test(value);
const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const present = Object.keys(value);
  return present.length === keys.length && present.every((key) => keys.includes(key));
};

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

/** A declared content address; an unsafe path refuses `unsafe-path`, anything else `malformed`. */
function descriptor(value: unknown, malformed: CatalogQualificationRefusalV1): CatalogDescriptorV1 {
  if (!isObject(value) || !exactKeys(value, ["path", "sha256"])) return refuse(malformed);
  if (typeof value.path !== "string" || !matches(value.sha256, SHA256_HEX)) {
    return refuse(malformed);
  }
  const path = safeRelativePath(value.path);
  if (path === undefined) return refuse("unsafe-path");
  return Object.freeze({ path, sha256: value.sha256 });
}

function catalogIdentity(value: unknown): CatalogQualificationCatalogV1 | undefined {
  if (!isObject(value)) return undefined;
  if (
    !exactKeys(value, [
      "catalogDigest",
      "catalogHeadDigest",
      "claims",
      "previousCatalogHeadDigest",
      "replayIdentity",
      "sequence",
      "signerIdentity",
      "signerKeyId",
      "validFrom",
      "validUntil",
    ])
  ) {
    return undefined;
  }
  if (!matches(value.catalogDigest, PREFIXED_SHA256)) return undefined;
  if (!matches(value.catalogHeadDigest, PREFIXED_SHA256)) return undefined;
  if (!matches(value.previousCatalogHeadDigest, PREFIXED_SHA256)) return undefined;
  if (!matches(value.replayIdentity, REPLAY_IDENTITY)) return undefined;
  if (!matches(value.signerKeyId, KEY_ID)) return undefined;
  if (typeof value.signerIdentity !== "string" || value.signerIdentity.length === 0) {
    return undefined;
  }
  if (!matches(value.validFrom, INSTANT) || !matches(value.validUntil, INSTANT)) return undefined;
  if (value.validFrom >= value.validUntil) return undefined;
  const sequence = value.sequence;
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 0) {
    return undefined;
  }
  // The replay identity always restates this head's own digest.
  if (!value.replayIdentity.startsWith(`catalog-head:${value.catalogHeadDigest.slice(7)}:`)) {
    return undefined;
  }
  const claims = value.claims;
  if (!isObject(claims)) return undefined;
  const claimEntries: [string, string][] = [];
  for (const [key, item] of Object.entries(claims)) {
    if (typeof item !== "string" || item.length === 0 || item.length > 512) return undefined;
    claimEntries.push([key, item]);
  }
  return Object.freeze({
    catalogDigest: value.catalogDigest,
    catalogHeadDigest: value.catalogHeadDigest,
    previousCatalogHeadDigest: value.previousCatalogHeadDigest,
    replayIdentity: value.replayIdentity,
    sequence,
    signerIdentity: value.signerIdentity,
    signerKeyId: value.signerKeyId,
    validFrom: value.validFrom,
    validUntil: value.validUntil,
    claims: Object.freeze(Object.fromEntries(claimEntries)),
  });
}

function signerRoot(value: unknown): CatalogQualificationSignerRootV1 | undefined {
  if (!isObject(value)) return undefined;
  if (
    !exactKeys(value, [
      "class",
      "identity",
      "keyId",
      "publicKeySpkiDerBase64",
      "publicKeySpkiSha256",
    ])
  ) {
    return undefined;
  }
  if (value.class !== "administrator-ed25519") return undefined;
  if (typeof value.identity !== "string" || value.identity.length === 0) return undefined;
  if (!matches(value.keyId, KEY_ID)) return undefined;
  if (!matches(value.publicKeySpkiSha256, SHA256_HEX)) return undefined;
  if (!matches(value.publicKeySpkiDerBase64, BASE64)) return undefined;
  const der = Buffer.from(value.publicKeySpkiDerBase64, "base64");
  if (der.toString("base64") !== value.publicKeySpkiDerBase64) return undefined;
  // The key id and the declared fingerprint are recomputed from the published bytes.
  if (sha256Hex(der) !== value.publicKeySpkiSha256) return undefined;
  if (value.keyId !== `ed25519:${value.publicKeySpkiSha256}`) return undefined;
  try {
    if (
      createPublicKey({ key: der, format: "der", type: "spki" }).asymmetricKeyType !== "ed25519"
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return Object.freeze({
    class: value.class,
    identity: value.identity,
    keyId: value.keyId,
    publicKeySpkiDerBase64: value.publicKeySpkiDerBase64,
    publicKeySpkiSha256: value.publicKeySpkiSha256,
  });
}

function publisherRecord(value: unknown):
  | {
      readonly declared: "absent" | "published";
      readonly publisher: CatalogQualificationPublisherV1;
    }
  | undefined {
  if (!isObject(value)) return undefined;
  const base = [
    "publisher",
    "receiptSetSubjectName",
    "receiptSubjectNamePattern",
    "requiredOperation",
    "state",
  ];
  const declared = value.state;
  if (declared !== "absent" && declared !== "published") return undefined;
  if (!exactKeys(value, declared === "absent" ? base : [...base, "locator"])) return undefined;
  const publisher = value.publisher;
  if (!isObject(publisher) || !exactKeys(publisher, ["issuer", "ref", "repository", "workflow"])) {
    return undefined;
  }
  if (!matches(publisher.repository, REPOSITORY)) return undefined;
  if (!matches(publisher.workflow, WORKFLOW) || publisher.workflow.includes("..")) return undefined;
  if (!matches(publisher.ref, REF)) return undefined;
  if (!matches(publisher.issuer, HTTPS_URL)) return undefined;
  const operation = value.requiredOperation;
  if (typeof operation !== "string" || operation.length === 0 || operation.length > 1024) {
    return undefined;
  }
  if (value.receiptSubjectNamePattern !== "<entryId>.json") return undefined;
  if (value.receiptSetSubjectName !== "qualification-receipt-set.json") return undefined;

  let locator: CatalogQualificationPublisherV1["locator"] = null;
  if (declared === "published") {
    const raw = value.locator;
    if (!isObject(raw)) return undefined;
    if (!exactKeys(raw, ["kind", "repository", "sourceDigest", "subjectDigest"])) return undefined;
    if (raw.kind !== "github-attestation") return undefined;
    if (!matches(raw.repository, REPOSITORY)) return undefined;
    if (!matches(raw.sourceDigest, PREFIXED_SHA256)) return undefined;
    if (!matches(raw.subjectDigest, PREFIXED_SHA256)) return undefined;
    locator = Object.freeze({
      kind: raw.kind,
      repository: raw.repository,
      sourceDigest: raw.sourceDigest,
      subjectDigest: raw.subjectDigest,
    });
  }
  return {
    declared,
    publisher: Object.freeze({
      repository: publisher.repository,
      workflow: publisher.workflow,
      ref: publisher.ref,
      issuer: publisher.issuer,
      requiredOperation: operation,
      receiptSubjectNamePattern: value.receiptSubjectNamePattern,
      receiptSetSubjectName: value.receiptSetSubjectName,
      locator,
    }),
  };
}

/** The claims a head was signed under must name the publisher this document publishes. */
function claimsNamePublisher(
  claims: Readonly<Record<string, string>>,
  publisher: CatalogQualificationPublisherV1,
): boolean {
  const expected = [
    "environment",
    "eventName",
    "issuer",
    "jobWorkflowRef",
    "ref",
    "repository",
    "repositoryId",
    "repositoryOwnerId",
  ];
  const present = Object.keys(claims);
  if (present.length !== expected.length || !present.every((key) => expected.includes(key))) {
    return false;
  }
  if (claims.eventName !== "workflow_dispatch") return false;
  if (claims.repository !== publisher.repository) return false;
  if (claims.ref !== publisher.ref) return false;
  if (claims.issuer !== publisher.issuer) return false;
  if (claims.jobWorkflowRef !== `${publisher.repository}/${publisher.workflow}@${publisher.ref}`) {
    return false;
  }
  if (!DIGITS.test(claims.repositoryId ?? "")) return false;
  if (!DIGITS.test(claims.repositoryOwnerId ?? "")) return false;
  return (claims.environment ?? "").length > 0;
}

interface DeclaredEntryV1 {
  readonly entryId: string;
  readonly subjectDigest: string;
  readonly catalogMemberDigest: string;
  readonly receipt: CatalogDescriptorV1;
  readonly notBefore: string;
  readonly expiresAt: string;
}

function declaredEntry(value: unknown): DeclaredEntryV1 {
  if (!isObject(value)) return refuse("malformed-entry");
  if (
    !exactKeys(value, [
      "catalogMemberDigest",
      "entryId",
      "expiresAt",
      "notBefore",
      "receipt",
      "subjectDigest",
    ])
  ) {
    return refuse("malformed-entry");
  }
  if (!matches(value.entryId, ENTRY_ID)) return refuse("malformed-entry");
  if (!matches(value.subjectDigest, PREFIXED_SHA256)) return refuse("malformed-entry");
  if (!matches(value.catalogMemberDigest, PREFIXED_SHA256)) return refuse("malformed-entry");
  if (!matches(value.notBefore, INSTANT) || !matches(value.expiresAt, INSTANT))
    return refuse("malformed-entry");
  if (value.notBefore >= value.expiresAt) return refuse("malformed-entry");
  const receipt = descriptor(value.receipt, "malformed-entry");
  return {
    entryId: value.entryId,
    subjectDigest: value.subjectDigest,
    catalogMemberDigest: value.catalogMemberDigest,
    receipt,
    notBefore: value.notBefore,
    expiresAt: value.expiresAt,
  };
}

/**
 * Reads and validates the published qualification basis against the index it
 * describes, naming every structural refusal: `unknown-format` and
 * `unknown-version` (each with the declared value in `observed`), a malformed
 * `now` (`malformed-clock`), malformed, oversize or non-canonical bytes, a digest
 * pin mismatch, a malformed document, catalog identity, attestation record,
 * signer root or entry, receipts issued outside the head's window, claims that do
 * not name the declared publisher, an unsafe declared path, a duplicate or
 * out-of-order `entryId`, or an entry absent from the index or with a different
 * subject digest (`index-mismatch`).
 */
export function readCatalogQualificationV1Result(
  request: ReadCatalogQualificationV1Request,
): CatalogQualificationV1Result {
  try {
    return Object.freeze({ state: "read" as const, qualification: readQualification(request) });
  } catch (error) {
    return refusedFrom<CatalogQualificationRefusalV1>(error);
  }
}

/**
 * Reads and validates the published qualification basis against the index it
 * describes.
 *
 * Returns `undefined` for every structural refusal: a byte order mark, bytes that
 * are not exactly round-trippable UTF-8, non-canonical or oversize bytes, an
 * `expectedDigest` that does not match, an unknown format or version, a malformed
 * catalog identity, signer root, publisher or entry, claims that do not name the
 * declared publisher, a duplicate or out-of-order `entryId`, an `entryId` absent
 * from the supplied index, a declared subject digest that is not the index's, a
 * malformed `now`, or an unsafe declared path. Use
 * `readCatalogQualificationV1Result` to learn which.
 */
export function readCatalogQualificationV1(
  request: ReadCatalogQualificationV1Request,
): CatalogQualificationDocumentV1 | undefined {
  const result = readCatalogQualificationV1Result(request);
  return result.state === "read" ? result.qualification : undefined;
}

function readQualification(
  request: ReadCatalogQualificationV1Request,
): CatalogQualificationDocumentV1 {
  if (!isObject(request)) return refuse("malformed-request");
  const { index } = request;
  if (!isObject(index) || !Array.isArray(index.entries)) return refuse("malformed-request");
  if (request.now !== undefined && !matches(request.now, INSTANT)) return refuse("malformed-clock");
  const { value, digest } = readCanonicalDocument({
    bytes: request.bytes,
    maxBytes: CATALOG_QUALIFICATION_MAX_BYTES_V1,
    expectedDigest: request.expectedDigest,
    canonical,
  });
  requireFormatAndVersion(value, CATALOG_QUALIFICATION_FORMAT_V1, CATALOG_QUALIFICATION_VERSION_V1);
  if (
    !exactKeys(value, [
      "attestation",
      "catalog",
      "entries",
      "format",
      "issuedAt",
      "organizationAdmission",
      "package",
      "receiptSet",
      "signedCatalog",
      "signerRoots",
      "version",
    ])
  ) {
    return refuse("malformed-document");
  }

  const packageValue = value.package;
  if (!isObject(packageValue) || !exactKeys(packageValue, ["name", "version"])) {
    return refuse("malformed-document");
  }
  if (typeof packageValue.name !== "string" || packageValue.name.length === 0) {
    return refuse("malformed-document");
  }
  if (typeof packageValue.version !== "string" || packageValue.version.length === 0) {
    return refuse("malformed-document");
  }
  if (typeof value.organizationAdmission !== "string" || value.organizationAdmission.length === 0) {
    return refuse("malformed-document");
  }
  if (!matches(value.issuedAt, INSTANT)) return refuse("malformed-document");

  const catalog = catalogIdentity(value.catalog);
  if (catalog === undefined) return refuse("malformed-catalog-identity");
  // The receipts were issued while the head they bind was inside its own window.
  if (value.issuedAt < catalog.validFrom || value.issuedAt >= catalog.validUntil) {
    return refuse("issued-outside-window");
  }

  const attestation = publisherRecord(value.attestation);
  if (attestation === undefined) return refuse("malformed-attestation");
  if (!claimsNamePublisher(catalog.claims, attestation.publisher)) {
    return refuse("claims-publisher-mismatch");
  }

  const signedCatalog = descriptor(value.signedCatalog, "malformed-document");
  const receiptSet = descriptor(value.receiptSet, "malformed-document");

  if (!Array.isArray(value.signerRoots) || value.signerRoots.length === 0) {
    return refuse("malformed-signer-root");
  }
  if (value.signerRoots.length > 64) return refuse("malformed-signer-root");
  const signerRoots: CatalogQualificationSignerRootV1[] = [];
  for (const raw of value.signerRoots) {
    const parsed = signerRoot(raw);
    if (parsed === undefined) return refuse("malformed-signer-root");
    if (signerRoots.some((existing) => existing.keyId === parsed.keyId)) {
      return refuse("malformed-signer-root");
    }
    signerRoots.push(parsed);
  }

  if (!Array.isArray(value.entries) || value.entries.length === 0) {
    return refuse("malformed-document");
  }
  if (value.entries.length > CATALOG_QUALIFICATION_MAX_ENTRIES_V1) {
    return refuse("malformed-document");
  }
  const indexed = new Map(index.entries.map((entry) => [entry.entryId, entry]));
  const declared: DeclaredEntryV1[] = [];
  for (const raw of value.entries) {
    const entry = declaredEntry(raw);
    requireAscending(declared.at(-1)?.entryId, entry.entryId);
    // Each record is that exact index entry. An unknown item is never described here.
    const indexEntry = indexed.get(entry.entryId);
    if (indexEntry === undefined) return refuse("index-mismatch");
    if (indexEntry.subject.subjectDigest !== entry.subjectDigest) return refuse("index-mismatch");
    declared.push(entry);
  }

  const input = request.input;
  const verifySignature = input?.verifySignature === true;
  const verifyReceipts = input?.verifyReceipts === true;
  const readFile =
    input?.readFile ?? (input === undefined ? undefined : defaultFileReader(input.root));

  let signature: CatalogQualificationSignatureStateV1 = "not-evaluated";
  let head: Record<string, unknown> | undefined;
  if (verifySignature) {
    const verified = verifyShippedHead({
      catalog,
      signedCatalog,
      signerRoots,
      issuedAt: value.issuedAt,
      readFile,
    });
    signature = verified.signature;
    head = verified.head;
  }

  const entries: CatalogQualificationEntryV1[] = declared.map((entry) => {
    const indexEntry = indexed.get(entry.entryId);
    const state =
      !verifyReceipts || request.now === undefined || readFile === undefined
        ? "not-evaluated"
        : verifySignature && signature !== "verified"
          ? // Nothing is qualified against a head this reader could not establish.
            "not-evaluated"
          : evaluateEntry({
              entry,
              catalog,
              head,
              indexSubjectDigest: indexEntry?.subject.subjectDigest ?? "",
              indexSubjectKind: indexEntry?.subject.kind ?? "",
              now: request.now,
              readFile,
            });
    return Object.freeze({ ...entry, state });
  });

  const attestationState: CatalogQualificationAttestationStateV1 =
    verifySignature && signature !== "verified"
      ? "not-evaluated"
      : attestation.declared === "absent"
        ? "absent"
        : "published-locator";

  return Object.freeze({
    format: CATALOG_QUALIFICATION_FORMAT_V1,
    version: CATALOG_QUALIFICATION_VERSION_V1,
    digest,
    package: Object.freeze({ name: packageValue.name, version: packageValue.version }),
    organizationAdmission: value.organizationAdmission,
    issuedAt: value.issuedAt,
    catalog,
    signedCatalog,
    receiptSet,
    signerRoots: Object.freeze(signerRoots),
    publisher: attestation.publisher,
    signature,
    attestation: attestationState,
    entries: Object.freeze(entries),
    coverage: Object.freeze({
      entries: entries.length,
      qualified: entries.filter((entry) => entry.state === "qualified").length,
      indexEntries: index.entries.length,
    }),
  });
}

function verifyShippedHead(request: {
  readonly catalog: CatalogQualificationCatalogV1;
  readonly signedCatalog: CatalogDescriptorV1;
  readonly signerRoots: readonly CatalogQualificationSignerRootV1[];
  readonly issuedAt: string;
  readonly readFile:
    | ((request: { readonly path: string; readonly sha256: string }) => Uint8Array | undefined)
    | undefined;
}): {
  readonly signature: CatalogQualificationSignatureStateV1;
  readonly head: Record<string, unknown> | undefined;
} {
  const { catalog, signedCatalog, signerRoots, issuedAt, readFile } = request;
  if (readFile === undefined) return { signature: "not-evaluated", head: undefined };
  let bytes: Uint8Array | undefined;
  try {
    bytes = readFile({ path: signedCatalog.path, sha256: signedCatalog.sha256 });
  } catch {
    return { signature: "not-evaluated", head: undefined };
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    return { signature: "not-evaluated", head: undefined };
  }
  if (bytes.byteLength > CATALOG_QUALIFICATION_HEAD_MAX_BYTES_V1) {
    return { signature: "not-evaluated", head: undefined };
  }
  // The shipped head is pinned by the digest this document declares for it.
  if (sha256Hex(bytes) !== signedCatalog.sha256) {
    return { signature: "not-evaluated", head: undefined };
  }
  let signed: unknown;
  try {
    signed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return { signature: "not-evaluated", head: undefined };
  }
  if (!isObject(signed) || !isObject(signed.head)) {
    return { signature: "not-evaluated", head: undefined };
  }
  const envelope: Record<string, unknown> = signed;
  const shippedHead: Record<string, unknown> = signed.head;

  const attempt = (
    claims: unknown,
    now: unknown,
  ): { readonly head?: Record<string, unknown>; readonly code?: string } => {
    try {
      return {
        head: verifySignedCatalogV2({
          catalogSignerRoots: signerRoots.map((root) => ({ ...root })),
          expectedClaims: claims,
          // The predecessor head is not shipped; see the continuity limit in the module note.
          lastAccepted: shippedHead,
          now,
          replay: { acceptedIdentities: [] },
          signed: envelope,
        }) as Record<string, unknown>,
      };
    } catch (error) {
      return { code: error instanceof Error ? error.message : "" };
    }
  };
  const describes = (head: Record<string, unknown>): boolean => {
    const identity = head.signer as Record<string, unknown> | undefined;
    return (
      head.catalogHeadSha256 === catalog.catalogHeadDigest.slice(7) &&
      head.catalogSha256 === catalog.catalogDigest.slice(7) &&
      head.previousCatalogHeadSha256 === catalog.previousCatalogHeadDigest.slice(7) &&
      head.sequence === catalog.sequence &&
      head.validFrom === catalog.validFrom &&
      head.validUntil === catalog.validUntil &&
      identity?.keyId === catalog.signerKeyId &&
      identity?.identity === catalog.signerIdentity
    );
  };

  // First, exactly as described: these claims, at the instant the receipts were issued.
  const described = attempt({ ...catalog.claims }, issuedAt);
  if (described.head !== undefined) {
    return describes(described.head)
      ? { signature: "verified", head: described.head }
      : // A valid head, but not the head this document describes.
        { signature: "superseded", head: undefined };
  }
  if (SIGNER_REFUSALS.has(described.code ?? "")) {
    return { signature: "untrusted-signer", head: undefined };
  }
  // The claims or window differ. If the shipped head still verifies under a trusted
  // root with its own claims and window, it is authentic but not the head described.
  const own = attempt(shippedHead.claims, shippedHead.validFrom);
  if (own.head !== undefined) {
    return describes(own.head)
      ? { signature: "not-evaluated", head: undefined }
      : { signature: "superseded", head: undefined };
  }
  return SIGNER_REFUSALS.has(own.code ?? "")
    ? { signature: "untrusted-signer", head: undefined }
    : { signature: "not-evaluated", head: undefined };
}

function evaluateEntry(request: {
  readonly entry: DeclaredEntryV1;
  readonly catalog: CatalogQualificationCatalogV1;
  readonly head: Record<string, unknown> | undefined;
  readonly indexSubjectDigest: string;
  readonly indexSubjectKind: string;
  readonly now: string;
  readonly readFile: (request: {
    readonly path: string;
    readonly sha256: string;
  }) => Uint8Array | undefined;
}): CatalogQualificationEntryStateV1 {
  const { entry, catalog, head, indexSubjectDigest, indexSubjectKind, now, readFile } = request;
  let bytes: Uint8Array | undefined;
  try {
    bytes = readFile({ path: entry.receipt.path, sha256: entry.receipt.sha256 });
  } catch {
    return "receipt-absent";
  }
  if (bytes === undefined) return "receipt-absent";
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return "receipt-malformed";
  if (bytes.byteLength > QUALIFICATION_RECEIPT_V2_MAX_BYTES) return "receipt-malformed";
  // The declared digest is a pin, never repaired.
  if (sha256Hex(bytes) !== entry.receipt.sha256) return "receipt-digest-mismatch";

  let receipt: Record<string, unknown>;
  try {
    receipt = parseQualificationReceiptV2Json(Buffer.from(bytes).toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return "receipt-malformed";
  }
  // These bytes must be this entry's receipt, not another member's.
  if (receipt.entryId !== entry.entryId) return "receipt-malformed";
  if (receipt.organizationAdmission !== "not-authoritative") return "receipt-malformed";

  const basis = receipt.qualificationBasis as Record<string, unknown>;
  const subject = receipt.subject as Record<string, unknown>;
  const continuity = receipt.catalogContinuity as Record<string, unknown>;

  if (basis.catalogMemberDigest !== entry.catalogMemberDigest) return "member-mismatch";
  if (subject.subjectDigest !== indexSubjectDigest) return "subject-mismatch";
  if (subject.kind !== indexSubjectKind) return "subject-mismatch";

  if (basis.kind !== "aih-supported") return "basis-mismatch";
  if (basis.catalogHeadDigest !== catalog.catalogHeadDigest) return "basis-mismatch";
  if (basis.catalogDigest !== catalog.catalogDigest) return "basis-mismatch";
  if (basis.catalogSignerIdentity !== catalog.signerIdentity) return "basis-mismatch";
  if (continuity.catalogHeadDigest !== catalog.catalogHeadDigest) return "basis-mismatch";
  if (continuity.previousCatalogHeadDigest !== catalog.previousCatalogHeadDigest) {
    return "basis-mismatch";
  }
  if (continuity.replayIdentity !== catalog.replayIdentity) return "basis-mismatch";
  if (continuity.sequence !== catalog.sequence) return "basis-mismatch";
  if (continuity.signerKeyId !== catalog.signerKeyId) return "basis-mismatch";
  if (continuity.headValidFrom !== catalog.validFrom) return "basis-mismatch";
  if (continuity.headValidUntil !== catalog.validUntil) return "basis-mismatch";
  // The window this document publishes for the entry is the receipt's own window.
  if (receipt.notBefore !== entry.notBefore) return "basis-mismatch";
  if (receipt.expiresAt !== entry.expiresAt) return "basis-mismatch";

  if (head !== undefined) {
    let derived: unknown;
    try {
      derived = deriveQualificationBasisV2({ entryId: entry.entryId, head });
    } catch {
      return "basis-mismatch";
    }
    // The basis must be the one the verified head itself derives, byte for byte.
    if (canonical(derived) !== canonical(basis)) return "basis-mismatch";
  }

  if (now < entry.notBefore) return "not-yet-valid";
  if (now >= entry.expiresAt) return "expired";
  return "qualified";
}

function defaultFileReader(
  root: string,
): (request: { readonly path: string; readonly sha256: string }) => Uint8Array | undefined {
  const base = resolve(root);
  return ({ path }) => {
    const target = resolveCatalogQualificationPathV1(base, path);
    if (target === undefined) return undefined;
    try {
      return readFileSync(target);
    } catch {
      return undefined;
    }
  };
}

/** Joins a package root and a validated descriptor path without escaping the root. */
export function resolveCatalogQualificationPathV1(root: string, path: string): string | undefined {
  const safe = safeRelativePath(path);
  if (safe === undefined) return undefined;
  const base = resolve(root);
  const target = resolve(base, ...safe.split("/"));
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
  return target.startsWith(prefix) ? target : undefined;
}

function canonical(value: unknown): string {
  return `${serialize(value)}\n`;
}

function serialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => `${JSON.stringify(key)}:${serialize(object[key])}`)
    .join(",")}}`;
}
