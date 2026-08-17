import {
  assertSafeRelativePosixPathV1,
  assertStrictJsonValueV1,
  canonicalStrictJsonBytesV1,
  canonicalStrictJsonSha256V1,
  deepFreezeStrictJsonV1,
  parseCanonicalStrictJsonObjectV1,
} from "../contract/strict-json-v1.js";

type JsonRecord = Record<string, unknown>;

type SourceSubject = Readonly<{
  commitSha256: string;
  closureMembers: readonly Readonly<{ path: string; sha256: string }>[];
  closureSha256: string;
  repository: string;
  treeSha256: string;
}>;

export type SourceWatchPolicyV1 = Readonly<JsonRecord> & {
  policySha256: string;
  requiredPlatforms: readonly Readonly<{ architecture: string; os: string }>[];
};
export type CandidateV1 = Readonly<JsonRecord> & {
  candidateIdentitySha256: string;
  candidateSha256: string;
  subject: SourceSubject;
};
export type QualificationBundleV1 = Readonly<JsonRecord> & {
  bundleSha256: string;
  detectorReceipts: readonly JsonRecord[];
};
export type PromotionDecisionV1 = Readonly<JsonRecord> & { promotionDecisionSha256: string };
export type CatalogHeadV1 = Readonly<JsonRecord> & {
  catalogHeadSha256: string;
  catalogSha256: string;
  compatibleEffectVersions: readonly string[];
  compatibleSchemaVersions: readonly string[];
  promotionDecisionSha256: string;
  sequence: number;
  signerIdentity: string;
  validFrom: string;
  validUntil: string;
};
export type DsseEnvelopeV1 = Readonly<{
  payload: string;
  payloadType: string;
  signatures: readonly Readonly<{ keyid: string; sig: string }>[];
}>;

const DIGEST = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9:._@/-]{0,255}$/;
const brands = new WeakMap<object, Buffer>();

function fail(label: string): never {
  throw new TypeError(`invalid supported V1: ${label}`);
}

function record(value: unknown, label: string): JsonRecord {
  assertStrictJsonValueV1(value, label);
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  return structuredClone(value) as JsonRecord;
}

function directRecord(value: unknown, label: string): JsonRecord {
  assertStrictJsonValueV1(value, label);
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  return value as JsonRecord;
}

function outerRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const prototype = Object.getPrototypeOf(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    fail(label);
  }
  for (const key of Object.keys(value)) ownData(value, key, label);
  return value as JsonRecord;
}

function ownData(value: object, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) fail(label);
  return descriptor.value;
}

function keys(value: JsonRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== [...expected].sort()[index])
  )
    fail(label);
}

function text(value: unknown, label: string, pattern = IDENTIFIER): string {
  if (typeof value !== "string" || !pattern.test(value)) fail(label);
  return value;
}

function sha(value: unknown, label: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(label);
  return value;
}

function domainSha(domain: string, value: unknown): string {
  return canonicalStrictJsonSha256V1({ domain, value });
}

function codeUnitCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortedUniqueStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4_096) fail(label);
  const parsed = value.map((entry) => text(entry, label));
  const sorted = [...parsed].sort();
  if (new Set(sorted).size !== sorted.length) fail(label);
  return sorted;
}

function freeze<T extends object>(value: T): T {
  const frozen = deepFreezeStrictJsonV1(value);
  brands.set(frozen, canonicalStrictJsonBytesV1(frozen));
  return frozen;
}

function requireBrand<T extends object>(value: T, label: string): T {
  const expected = brands.get(value);
  if (expected === undefined || !expected.equals(canonicalStrictJsonBytesV1(value)))
    fail(`${label} brand`);
  return value;
}

function sourceSubject(value: unknown): SourceSubject {
  const input = record(value, "subject");
  keys(
    input,
    ["commitSha256", "closureMembers", "closureSha256", "repository", "treeSha256"],
    "subject fields",
  );
  if (
    typeof input.repository !== "string" ||
    !/^github\.com\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(input.repository)
  ) {
    fail("subject repository");
  }
  const members = input.closureMembers;
  if (!Array.isArray(members) || members.length === 0 || members.length > 4_096)
    fail("closure members");
  const parsed = members.map((member) => {
    const item = record(member, "closure member");
    keys(item, ["path", "sha256"], "closure member fields");
    return {
      path: assertSafeRelativePosixPathV1(
        text(item.path, "closure path", /^.{1,4096}$/),
        "closure path",
      ),
      sha256: sha(item.sha256, "closure sha"),
    };
  });
  parsed.sort((left, right) => codeUnitCompare(left.path, right.path));
  if (new Set(parsed.map((member) => member.path)).size !== parsed.length)
    fail("duplicate closure member");
  return deepFreezeStrictJsonV1({
    commitSha256: sha(input.commitSha256, "commit"),
    closureMembers: parsed,
    closureSha256: sha(input.closureSha256, "closure"),
    repository: input.repository,
    treeSha256: sha(input.treeSha256, "tree"),
  });
}

function platformRows(value: unknown): readonly Readonly<{ architecture: string; os: string }>[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4_096) fail("platforms");
  const parsed = value.map((row) => {
    const item = record(row, "platform");
    keys(item, ["architecture", "os"], "platform fields");
    const architecture = text(item.architecture, "architecture");
    const os = text(item.os, "os");
    return { architecture, os };
  });
  parsed.sort((left, right) =>
    codeUnitCompare(`${left.os}/${left.architecture}`, `${right.os}/${right.architecture}`),
  );
  if (new Set(parsed.map((row) => `${row.os}/${row.architecture}`)).size !== parsed.length)
    fail("duplicate platform");
  return parsed;
}

function opaqueData(value: unknown, label: string): unknown {
  assertStrictJsonValueV1(value, label);
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  return structuredClone(value);
}

function selector(value: unknown): JsonRecord {
  const input = record(value, "release selector");
  keys(input, ["branch", "kind"], "release selector fields");
  if (input.kind !== "branch") fail("release selector kind");
  return {
    branch: text(input.branch, "release branch", /^[a-z0-9][a-z0-9._/-]{0,255}$/),
    kind: "branch",
  };
}

function licenseBoundary(value: unknown): JsonRecord {
  const input = record(value, "license boundary");
  keys(input, ["kind", "licenseIds"], "license boundary fields");
  if (input.kind !== "allowlist") fail("license boundary kind");
  return { kind: "allowlist", licenseIds: sortedUniqueStrings(input.licenseIds, "license ids") };
}

function promotionRule(value: unknown): JsonRecord {
  const input = record(value, "promotion rule");
  keys(input, ["kind"], "promotion rule fields");
  if (input.kind !== "all-required-platforms") fail("promotion rule kind");
  return { kind: "all-required-platforms" };
}

export function createSourceWatchPolicyV1(value: unknown): SourceWatchPolicyV1 {
  const input = record(value, "policy");
  keys(
    input,
    [
      "adapterIds",
      "immutableResolverId",
      "licenseBoundary",
      "policyRevisionSha256",
      "promotionRule",
      "protocol",
      "provider",
      "qualificationProfileSha256",
      "releaseSelector",
      "repository",
      "requiredPlatforms",
      "sourceId",
    ],
    "policy fields",
  );
  if (input.protocol !== "SourceWatchPolicyV1" || input.provider !== "github")
    fail("policy protocol");
  const repository = text(
    input.repository,
    "policy repository",
    /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/,
  );
  const sourceId = text(input.sourceId, "source id", /^[a-z][a-z0-9-]{0,255}$/);
  const result = {
    adapterIds: sortedUniqueStrings(input.adapterIds, "adapter ids"),
    immutableResolverId: text(input.immutableResolverId, "resolver"),
    licenseBoundary: licenseBoundary(input.licenseBoundary),
    policyRevisionSha256: sha(input.policyRevisionSha256, "policy revision"),
    promotionRule: promotionRule(input.promotionRule),
    protocol: "SourceWatchPolicyV1" as const,
    provider: "github" as const,
    qualificationProfileSha256: sha(input.qualificationProfileSha256, "qualification profile"),
    releaseSelector: selector(input.releaseSelector),
    repository,
    requiredPlatforms: platformRows(input.requiredPlatforms),
    sourceId,
  };
  return freeze({
    ...result,
    policySha256: domainSha("aih-supported.source-watch-policy-v1", result),
  }) as SourceWatchPolicyV1;
}

export function canonicalSourceWatchPolicyV1Bytes(value: unknown): Buffer {
  return canonicalStrictJsonBytesV1(requireBrand(value as object, "policy"));
}

function metadata(value: unknown, label: string): unknown {
  const data = opaqueData(value, label);
  return deepFreezeStrictJsonV1(data);
}

export function createCandidateV1(value: unknown): CandidateV1 {
  const input = record(value, "candidate");
  keys(
    input,
    [
      "discoveredMetadata",
      "discoveryWorkflowIdentity",
      "protocol",
      "sourceId",
      "sourceWatchPolicySha256",
      "subject",
      "triggerMetadata",
    ],
    "candidate fields",
  );
  if (input.protocol !== "CandidateV1") fail("candidate protocol");
  const subject = sourceSubject(input.subject);
  const identity = {
    sourceId: text(input.sourceId, "candidate source id", /^[a-z][a-z0-9-]{0,255}$/),
    sourceWatchPolicySha256: sha(input.sourceWatchPolicySha256, "candidate policy"),
    subject,
  };
  const candidateIdentitySha256 = domainSha("aih-supported.candidate-v1.identity", identity);
  const result = {
    candidateIdentitySha256,
    discoveredMetadata: metadata(input.discoveredMetadata, "discovered metadata"),
    discoveryWorkflowIdentity: text(input.discoveryWorkflowIdentity, "discovery workflow"),
    protocol: "CandidateV1" as const,
    sourceId: identity.sourceId,
    sourceWatchPolicySha256: identity.sourceWatchPolicySha256,
    subject,
    triggerMetadata: metadata(input.triggerMetadata, "trigger metadata"),
  };
  return freeze({
    ...result,
    candidateSha256: domainSha("aih-supported.candidate-v1", result),
  }) as CandidateV1;
}

export function canonicalCandidateV1Bytes(value: unknown): Buffer {
  return canonicalStrictJsonBytesV1(requireBrand(value as object, "candidate"));
}

function canonicalParser(
  text: string,
  label: string,
  digestField: string,
  create: (value: unknown) => JsonRecord,
): JsonRecord {
  const parsed = parseCanonicalStrictJsonObjectV1(text, label);
  const digest = parsed[digestField];
  delete parsed[digestField];
  const created = create(parsed);
  if (created[digestField] !== digest) fail(`${label} digest`);
  return created;
}

export function parseSourceWatchPolicyV1Json(text: string): SourceWatchPolicyV1 {
  return canonicalParser(
    text,
    "policy",
    "policySha256",
    createSourceWatchPolicyV1,
  ) as SourceWatchPolicyV1;
}

export function parseCandidateV1Json(text: string): CandidateV1 {
  const parsed = parseCanonicalStrictJsonObjectV1(text, "candidate");
  const candidateSha256 = parsed.candidateSha256;
  const candidateIdentitySha256 = parsed.candidateIdentitySha256;
  delete parsed.candidateSha256;
  delete parsed.candidateIdentitySha256;
  const created = createCandidateV1(parsed);
  if (
    created.candidateSha256 !== candidateSha256 ||
    created.candidateIdentitySha256 !== candidateIdentitySha256
  ) {
    fail("candidate digest");
  }
  return created;
}

function descriptorRows(value: unknown): readonly JsonRecord[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4_096)
    fail("annex descriptors");
  const parsed = value.map((row) => {
    const item = record(row, "annex descriptor");
    keys(
      item,
      ["byteLength", "descriptorId", "mediaType", "sha256", "uri"],
      "annex descriptor fields",
    );
    if (!Number.isSafeInteger(item.byteLength) || (item.byteLength as number) < 0)
      fail("annex byte length");
    return {
      byteLength: item.byteLength,
      descriptorId: text(item.descriptorId, "descriptor id"),
      mediaType: text(item.mediaType, "media type", /^application\/[a-z0-9.+-]+$/),
      sha256: sha(item.sha256, "annex sha"),
      uri: assertSafeRelativePosixPathV1(text(item.uri, "annex uri", /^.{1,4096}$/), "annex uri"),
    };
  });
  parsed.sort((left, right) => codeUnitCompare(left.descriptorId, right.descriptorId));
  if (new Set(parsed.map((row) => row.descriptorId)).size !== parsed.length)
    fail("duplicate annex descriptor");
  return parsed;
}

function receiptRows(value: unknown): readonly JsonRecord[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4_096)
    fail("detector receipts");
  const parsed = value.map((row) => {
    const item = record(row, "detector receipt");
    keys(item, ["coverageSha256", "detectorId", "receiptSha256"], "detector receipt fields");
    return {
      coverageSha256: sha(item.coverageSha256, "coverage"),
      detectorId: text(item.detectorId, "detector id"),
      receiptSha256: sha(item.receiptSha256, "receipt"),
    };
  });
  parsed.sort((left, right) => codeUnitCompare(left.detectorId, right.detectorId));
  if (new Set(parsed.map((row) => row.detectorId)).size !== parsed.length)
    fail("duplicate detector receipt");
  return parsed;
}

export function createQualificationBundleV1(value: unknown): QualificationBundleV1 {
  const input = record(value, "bundle");
  keys(
    input,
    [
      "annexDescriptors",
      "candidateSha256",
      "compatibilitySha256",
      "detectorReceipts",
      "effectResultsSha256",
      "licenseSha256",
      "profileSha256",
      "protocol",
      "provenanceSha256",
      "recipeSha256",
      "requiredPlatforms",
      "sbomSha256",
      "subject",
    ],
    "bundle fields",
  );
  if (input.protocol !== "QualificationBundleV1") fail("bundle protocol");
  const result = {
    annexDescriptors: descriptorRows(input.annexDescriptors),
    candidateSha256: sha(input.candidateSha256, "bundle candidate"),
    compatibilitySha256: sha(input.compatibilitySha256, "compatibility"),
    detectorReceipts: receiptRows(input.detectorReceipts),
    effectResultsSha256: sha(input.effectResultsSha256, "effects"),
    licenseSha256: sha(input.licenseSha256, "license"),
    profileSha256: sha(input.profileSha256, "bundle profile"),
    protocol: "QualificationBundleV1" as const,
    provenanceSha256: sha(input.provenanceSha256, "provenance"),
    recipeSha256: sha(input.recipeSha256, "bundle recipe"),
    requiredPlatforms: platformRows(input.requiredPlatforms),
    sbomSha256: sha(input.sbomSha256, "sbom"),
    subject: sourceSubject(input.subject),
  };
  return freeze({
    ...result,
    bundleSha256: domainSha("aih-supported.qualification-bundle-v1", result),
  }) as QualificationBundleV1;
}

export function canonicalQualificationBundleV1Bytes(value: unknown): Buffer {
  return canonicalStrictJsonBytesV1(requireBrand(value as object, "bundle"));
}

export function parseQualificationBundleV1Json(text: string): QualificationBundleV1 {
  return canonicalParser(
    text,
    "bundle",
    "bundleSha256",
    createQualificationBundleV1,
  ) as QualificationBundleV1;
}

function closureRows(value: unknown): readonly JsonRecord[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4_096)
    fail("enumerated closure");
  const parsed = value.map((row) => {
    const item = record(row, "closure row");
    keys(
      item,
      ["componentSha256", "profileSha256", "recipeSha256", "sourceSha256"],
      "closure row fields",
    );
    return {
      componentSha256: sha(item.componentSha256, "component"),
      profileSha256: sha(item.profileSha256, "closure profile"),
      recipeSha256: sha(item.recipeSha256, "closure recipe"),
      sourceSha256: sha(item.sourceSha256, "closure source"),
    };
  });
  parsed.sort((left, right) =>
    canonicalStrictJsonBytesV1(left).compare(canonicalStrictJsonBytesV1(right)),
  );
  if (new Set(parsed.map((row) => canonicalStrictJsonSha256V1(row))).size !== parsed.length)
    fail("duplicate closure row");
  return parsed;
}

export function createPromotionDecisionV1(value: unknown): PromotionDecisionV1 {
  const input = record(value, "promotion decision");
  keys(
    input,
    [
      "authority",
      "candidateIdentitySha256",
      "candidateSha256",
      "enumeratedClosure",
      "evidenceReference",
      "evidenceSha256",
      "issuedAt",
      "policyRevisionSha256",
      "protocol",
      "qualificationBundleSha256",
      "reasonCodes",
      "result",
      "workflowIdentity",
    ],
    "promotion fields",
  );
  if (
    input.protocol !== "PromotionDecisionV1" ||
    !["promoted", "review-required", "blocked", "superseded"].includes(input.result as string)
  )
    fail("promotion protocol/result");
  const authority = text(input.authority, "authority");
  const workflowIdentity = text(input.workflowIdentity, "promotion workflow");
  if (authority === "*" || workflowIdentity === "workflow:catalog-discovery-v1")
    fail("promotion authority/workflow");
  const result = {
    authority,
    candidateIdentitySha256: sha(input.candidateIdentitySha256, "candidate identity"),
    candidateSha256: sha(input.candidateSha256, "promotion candidate"),
    enumeratedClosure: closureRows(input.enumeratedClosure),
    evidenceReference: assertSafeRelativePosixPathV1(
      text(input.evidenceReference, "evidence reference", /^.{1,4096}$/),
      "evidence reference",
    ),
    evidenceSha256: sha(input.evidenceSha256, "evidence"),
    issuedAt: iso(input.issuedAt, "issued at"),
    policyRevisionSha256: sha(input.policyRevisionSha256, "promotion policy"),
    protocol: "PromotionDecisionV1" as const,
    qualificationBundleSha256: sha(input.qualificationBundleSha256, "qualification bundle"),
    reasonCodes: sortedUniqueStrings(input.reasonCodes, "reason codes"),
    result: input.result,
    workflowIdentity,
  };
  return freeze({
    ...result,
    promotionDecisionSha256: domainSha("aih-supported.promotion-decision-v1", result),
  }) as PromotionDecisionV1;
}

export function parsePromotionDecisionV1Json(text: string): PromotionDecisionV1 {
  return canonicalParser(
    text,
    "promotion decision",
    "promotionDecisionSha256",
    createPromotionDecisionV1,
  ) as PromotionDecisionV1;
}

export function canonicalPromotionDecisionV1Bytes(value: unknown): Buffer {
  return canonicalStrictJsonBytesV1(requireBrand(value as object, "promotion decision"));
}

function iso(value: unknown, label: string): string {
  if (typeof value !== "string") fail(label);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/);
  if (match === null) fail(label);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) fail(label);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  )
    fail(label);
  return value;
}

export function createCatalogHeadV1(value: unknown): CatalogHeadV1 {
  const input = record(value, "catalog head");
  keys(
    input,
    [
      "catalogSha256",
      "compatibleEffectVersions",
      "compatibleSchemaVersions",
      "previousCatalogHeadSha256",
      "promotionDecisionSha256",
      "protocol",
      "sequence",
      "signerIdentity",
      "validFrom",
      "validUntil",
    ],
    "head fields",
  );
  if (
    input.protocol !== "CatalogHeadV1" ||
    !Number.isSafeInteger(input.sequence) ||
    (input.sequence as number) < 1
  )
    fail("head protocol/sequence");
  const validFrom = iso(input.validFrom, "valid from");
  const validUntil = iso(input.validUntil, "valid until");
  if (validFrom >= validUntil) fail("head validity window");
  const result = {
    catalogSha256: sha(input.catalogSha256, "catalog"),
    compatibleEffectVersions: sortedUniqueStrings(
      input.compatibleEffectVersions,
      "effect versions",
    ),
    compatibleSchemaVersions: sortedUniqueStrings(
      input.compatibleSchemaVersions,
      "schema versions",
    ),
    previousCatalogHeadSha256: sha(input.previousCatalogHeadSha256, "previous head"),
    promotionDecisionSha256: sha(input.promotionDecisionSha256, "head promotion"),
    protocol: "CatalogHeadV1" as const,
    sequence: input.sequence as number,
    signerIdentity: text(input.signerIdentity, "head signer"),
    validFrom,
    validUntil,
  };
  if (
    !result.compatibleEffectVersions.every((version) => version === "1") ||
    !result.compatibleSchemaVersions.every((version) => version === "1")
  ) {
    fail("head compatible versions");
  }
  return freeze({
    ...result,
    catalogHeadSha256: domainSha("aih-supported.catalog-head-v1", result),
  }) as CatalogHeadV1;
}

export function canonicalCatalogHeadV1Bytes(value: unknown): Buffer {
  return canonicalStrictJsonBytesV1(requireBrand(value as object, "head"));
}

export function parseCatalogHeadV1Json(text: string): CatalogHeadV1 {
  return canonicalParser(
    text,
    "catalog head",
    "catalogHeadSha256",
    createCatalogHeadV1,
  ) as CatalogHeadV1;
}

function standardBase64(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    fail(label);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) fail(label);
  return value;
}

function statement(input: JsonRecord): JsonRecord {
  const recordDigestSha256 = sha(input.recordDigestSha256, "statement digest");
  const recordType = text(input.recordType, "statement type");
  const signerIdentity = text(input.signerIdentity, "statement signer");
  return {
    _type: "https://in-toto.io/Statement/v1",
    predicate: {
      protocol: "SupportedRecordPredicateV1",
      recordType,
      signerIdentity,
    },
    predicateType: "https://aih.dev/SupportedRecordV1",
    subject: [{ digest: { sha256: recordDigestSha256 }, name: `aih-supported/${recordType}` }],
  };
}

function statementBinding(
  value: unknown,
  label: string,
): {
  recordDigestSha256: string;
  recordType: string;
  signerIdentity: string;
} {
  const parsed = record(value, label);
  keys(parsed, ["_type", "predicate", "predicateType", "subject"], `${label} fields`);
  if (
    parsed._type !== "https://in-toto.io/Statement/v1" ||
    parsed.predicateType !== "https://aih.dev/SupportedRecordV1" ||
    !Array.isArray(parsed.subject) ||
    parsed.subject.length !== 1
  )
    fail(label);
  const subject = record(parsed.subject[0], `${label} subject`);
  keys(subject, ["digest", "name"], `${label} subject fields`);
  const subjectDigest = record(subject.digest, `${label} subject digest`);
  keys(subjectDigest, ["sha256"], `${label} subject digest fields`);
  const predicate = record(parsed.predicate, `${label} predicate`);
  keys(predicate, ["protocol", "recordType", "signerIdentity"], `${label} predicate fields`);
  if (predicate.protocol !== "SupportedRecordPredicateV1") fail(label);
  const recordDigestSha256 = sha(subjectDigest.sha256, `${label} digest`);
  const recordType = text(predicate.recordType, `${label} record type`);
  const signerIdentity = text(predicate.signerIdentity, `${label} signer`);
  if (subject.name !== `aih-supported/${recordType}`) fail(label);
  return { recordDigestSha256, recordType, signerIdentity };
}

export function createDsseEnvelopeV1(value: unknown): DsseEnvelopeV1 {
  const input = record(value, "DSSE envelope input");
  keys(
    input,
    ["payloadType", "recordDigestSha256", "recordType", "signatures", "signerIdentity"],
    "DSSE input fields",
  );
  if (
    input.payloadType !== "application/vnd.in-toto+json" ||
    !Array.isArray(input.signatures) ||
    input.signatures.length === 0 ||
    input.signatures.length > 64
  )
    fail("DSSE input");
  const signatures = input.signatures.map((entry) => {
    const item = record(entry, "DSSE signature");
    keys(item, ["keyid", "sig"], "DSSE signature fields");
    return { keyid: text(item.keyid, "key id"), sig: standardBase64(item.sig, "signature") };
  });
  if (new Set(signatures.map((entry) => entry.keyid)).size !== signatures.length)
    fail("duplicate signature");
  const payload = canonicalStrictJsonBytesV1(statement(input)).toString("base64");
  return freeze({ payload, payloadType: input.payloadType, signatures }) as DsseEnvelopeV1;
}

export function canonicalDsseEnvelopeV1Bytes(value: unknown): Buffer {
  return canonicalStrictJsonBytesV1(requireBrand(value as object, "DSSE envelope"));
}

export function parseDsseEnvelopeV1Json(text: string): DsseEnvelopeV1 {
  const input = parseCanonicalStrictJsonObjectV1(text, "DSSE envelope");
  keys(input, ["payload", "payloadType", "signatures"], "DSSE envelope fields");
  const payload = standardBase64(input.payload, "DSSE payload");
  let decoded: JsonRecord;
  try {
    decoded = parseCanonicalStrictJsonObjectV1(
      Buffer.from(payload, "base64").toString("utf8"),
      "DSSE statement",
    );
  } catch {
    fail("DSSE statement");
  }
  const binding = statementBinding(decoded, "DSSE statement");
  const envelope = createDsseEnvelopeV1({
    payloadType: input.payloadType,
    recordDigestSha256: binding.recordDigestSha256,
    recordType: binding.recordType,
    signerIdentity: binding.signerIdentity,
    signatures: input.signatures,
  });
  if (envelope.payload !== payload) fail("DSSE payload canonical");
  return envelope;
}

function pae(payloadType: string, payload: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `DSSEv1 ${String(Buffer.byteLength(payloadType, "utf8"))} ${payloadType} ${String(payload.length)} `,
      "utf8",
    ),
    payload,
  ]);
}

export function verifyDsseEnvelopeV1(
  value: unknown,
  verifier: { verifyCanonicalPae: (request: JsonRecord) => boolean },
): DsseEnvelopeV1 {
  const input = directRecord(value, "DSSE verification");
  keys(
    input,
    ["envelope", "expectedRecordDigestSha256", "expectedRecordType", "expectedSignerIdentity"],
    "DSSE verification fields",
  );
  const envelope = input.envelope as DsseEnvelopeV1;
  requireBrand(envelope, "DSSE envelope");
  const payload = Buffer.from(envelope.payload, "base64");
  const parsed = parseCanonicalStrictJsonObjectV1(payload.toString("utf8"), "DSSE statement");
  const binding = statementBinding(parsed, "DSSE statement");
  if (
    binding.recordDigestSha256 !== sha(input.expectedRecordDigestSha256, "expected digest") ||
    binding.recordType !== text(input.expectedRecordType, "expected type") ||
    binding.signerIdentity !== text(input.expectedSignerIdentity, "expected signer")
  )
    fail("DSSE statement binding");
  const signatures = deepFreezeStrictJsonV1(
    envelope.signatures.map((signature) => ({ keyid: signature.keyid, sig: signature.sig })),
  );
  const request = Object.freeze({
    expectedRecordDigestSha256: input.expectedRecordDigestSha256,
    expectedRecordType: input.expectedRecordType,
    expectedSignerIdentity: input.expectedSignerIdentity,
    paeBytes: Buffer.from(pae(envelope.payloadType, payload)),
    signatures,
  });
  if (!verifier.verifyCanonicalPae(request)) fail("DSSE verification");
  return envelope;
}

type HeadContext = JsonRecord;

function headContext(value: unknown): HeadContext {
  const input = record(value, "head context");
  const expected = [
    "expectedAuthority",
    "expectedCandidateIdentitySha256",
    "expectedCandidateSha256",
    "expectedCatalogSha256",
    "expectedEvidenceSha256",
    "expectedPolicyRevisionSha256",
    "expectedProfileSha256",
    "expectedPromotionDecisionSha256",
    "expectedQualificationBundleSha256",
    "expectedRecipeSha256",
    "expectedSignerIdentity",
    "expectedWorkflowIdentity",
  ];
  keys(input, expected, "head context fields");
  for (const field of expected.filter((field) => field.endsWith("Sha256")))
    sha(input[field], field);
  text(input.expectedAuthority, "expected authority");
  text(input.expectedSignerIdentity, "expected signer");
  text(input.expectedWorkflowIdentity, "expected workflow");
  return deepFreezeStrictJsonV1(input);
}

export function verifyCatalogHeadV1(
  value: unknown,
  verifier: { verifyCanonicalBytes: (request: JsonRecord) => boolean },
): CatalogHeadV1 {
  const input = directRecord(value, "head verification");
  keys(input, ["context", "envelope", "head"], "head verification fields");
  const head = requireBrand(input.head as CatalogHeadV1, "head");
  const context = headContext(input.context);
  if (
    head.catalogSha256 !== context.expectedCatalogSha256 ||
    head.promotionDecisionSha256 !== context.expectedPromotionDecisionSha256 ||
    head.signerIdentity !== context.expectedSignerIdentity ||
    !head.compatibleEffectVersions.includes("1") ||
    !head.compatibleSchemaVersions.includes("1")
  )
    fail("head context");
  verifyDsseEnvelopeV1(
    {
      envelope: input.envelope,
      expectedRecordDigestSha256: head.catalogHeadSha256,
      expectedRecordType: "CatalogHeadV1",
      expectedSignerIdentity: context.expectedSignerIdentity,
    },
    { verifyCanonicalPae: () => true },
  );
  const request = Object.freeze({
    context,
    envelope: input.envelope,
    expectedSignerIdentity: context.expectedSignerIdentity,
    headBytes: Buffer.from(canonicalCatalogHeadV1Bytes(head)),
  });
  if (!verifier.verifyCanonicalBytes(request)) fail("head verification");
  return head;
}

export function resolveCatalogHeadV1(value: unknown): {
  kind: "advanced" | "last-good";
  head: CatalogHeadV1;
} {
  const input = outerRecord(value, "head resolution");
  keys(
    input,
    ["context", "envelope", "lastGood", "next", "now", "verifier"],
    "head resolution fields",
  );
  const lastGood = requireBrand(input.lastGood as CatalogHeadV1, "last good head");
  try {
    const next = input.next as CatalogHeadV1;
    const now = iso(input.now, "resolution now");
    if (
      next.sequence <= lastGood.sequence ||
      next.previousCatalogHeadSha256 !== lastGood.catalogHeadSha256 ||
      next.validUntil <= now ||
      next.validFrom > now
    )
      fail("head continuity");
    const head = verifyCatalogHeadV1(
      { context: input.context, envelope: input.envelope, head: next },
      input.verifier as { verifyCanonicalBytes: (request: JsonRecord) => boolean },
    );
    return { kind: "advanced", head };
  } catch {
    return { kind: "last-good", head: lastGood };
  }
}
