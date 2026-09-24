import { canonicalStrictJsonSha256V1, sha256HexV1 } from "../strict-json-v1.js";
import {
  exactKeys,
  integer,
  type JsonRecord,
  list,
  oneOf,
  QUALIFIED_SHA256,
  record,
  text,
} from "../validate-v1.js";

/**
 * Authoring-catalog bundle shapes and the fail-closed structural validator ported
 * from Core's zod contract (Catalog has no runtime dependencies). Every schema in
 * the Core contract is strict, so validation never rewrites the value.
 */

export type AuthoringActionV1 =
  | "select-control"
  | "record-selection"
  | "record-request"
  | "prepare-approval"
  | "inspect-evidence";

export interface SourceDescriptorV1 {
  id: string;
  distributor: { kind: string; locator: string };
  upstreamOrigin: { kind: string; locator: string };
  inputFormat: string;
  policyInputRequired?: true;
  revision: { id: string; contentDigest: string };
  compiler: { id: string; version: string };
}

export interface CompilerAssetDeclarationV1 {
  id: string;
  sourceId: string;
  sourceRevisionId: string;
  contentDigest: string;
  originalPath: string;
  derivation:
    | "upstream"
    | "modified-copy"
    | "organization-declaration"
    | "built-in"
    | "core-derived";
  kind: string;
  label: string;
  detailChunkId: string;
  declaredHostCapabilities: string[];
  runtimeIdentity?: string;
  exclusiveSlot?: "methodology";
  methodologyKey?: string;
}

export interface AuthoringAssetV1 extends CompilerAssetDeclarationV1 {
  authoring: {
    action: AuthoringActionV1;
    projectorId?: "mcp-managed-settings" | "usage-hook";
    supportedTargets: string[];
  };
}

export interface CatalogRelationV1 {
  fromAssetId: string;
  toAssetId: string;
  kind: "requires" | "member" | "conflicts";
  membership?: "required" | "optional";
}

export interface SelectionTemplateV1 {
  id: string;
  label?: string;
  digest: string;
  roots: { assetId: string; mode: "select" | "structural"; includeOptionalMembers: boolean }[];
  exclusions: string[];
}

export interface EvidenceSummaryV1 {
  id: string;
  projectionVersion: "evidence-summary/v1";
  subjects: {
    assetId: string;
    sourceId: string;
    sourceRevisionId: string;
    contentDigest: string;
  }[];
  evidenceDigest: string;
  coveredPaths: string[];
  verification: {
    state: "verified" | "unverified" | "missing" | "stale";
    verifiedAt?: string;
    contextDigest?: string;
    validUntil?: string;
  };
  scan: JsonRecord & { outcome: "pass" | "failed" | "unknown"; coverage: string };
  qualification: { state: "qualified" | "unqualified" | "unknown" };
  findings: string[];
}

export interface AuthoringCatalogBundleV1 {
  version: "authoring-catalog-bundle/v1";
  sources: Record<string, SourceDescriptorV1>;
  assets: Record<string, AuthoringAssetV1>;
  groups: Record<string, { id: string; label: string; assetIds: string[] }>;
  relations: CatalogRelationV1[];
  templates: Record<string, SelectionTemplateV1>;
  evidence: Record<string, EvidenceSummaryV1>;
  qualifications?: Record<string, JsonRecord & { assetId: string }>;
  provenance: { bundleDigest: string };
  detailChunks: Record<string, { bytes: string; digest: string }>;
}

export interface CoreAuthoringCapabilityRegistryEntryV1 {
  assetId: string;
  sourceId: string;
  sourceRevisionId: string;
  contentDigest: string;
  action: AuthoringActionV1;
  projectorId?: "mcp-managed-settings" | "usage-hook";
  supportedTargets: readonly string[];
}

const ACTIONS: readonly AuthoringActionV1[] = [
  "select-control",
  "record-selection",
  "record-request",
  "prepare-approval",
  "inspect-evidence",
];
const ORIGIN_KINDS = ["git", "package", "organization", "built-in", "aih"] as const;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

function visible(value: unknown, label: string, max: number): string {
  const result = text(value, label);
  if (
    result.length < 1 ||
    result.length > max ||
    result !== result.normalize("NFC") ||
    /\p{C}/u.test(result)
  )
    throw new TypeError(`${label} must be bounded NFC text without hidden characters`);
  return result;
}
const id = (value: unknown, label: string) => visible(value, label, 240);
const digest = (value: unknown, label: string) => text(value, label, QUALIFIED_SHA256);
function safePath(value: unknown, label: string): string {
  const path = visible(value, label, 1_000);
  if (
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    /[\\%?#:]/.test(path) ||
    path.endsWith("/") ||
    !path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  )
    throw new TypeError(`${label} must be a safe relative POSIX path`);
  return path;
}
function datetime(value: unknown, label: string): string {
  const result = text(value, label, DATETIME);
  if (!Number.isFinite(Date.parse(result))) throw new TypeError(`${label} must be a datetime`);
  return result;
}
function ordered(values: readonly string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.every((value, index) => index === 0 || value >= (values[index - 1] as string))
  );
}

function validateSource(value: unknown, key: string): void {
  const source = exactKeys(
    record(value, `source ${key}`),
    ["id", "distributor", "upstreamOrigin", "inputFormat", "revision", "compiler"],
    `source ${key}`,
    ["policyInputRequired"],
  );
  if (id(source.id, "source id") !== key) throw new TypeError("Source key must match id.");
  for (const field of ["distributor", "upstreamOrigin"] as const) {
    const origin = exactKeys(record(source[field], field), ["kind", "locator"], field);
    oneOf(origin.kind, ORIGIN_KINDS, `${field} kind`);
    visible(origin.locator, `${field} locator`, 1_000);
  }
  visible(source.inputFormat, "source input format", 1_000);
  if (source.policyInputRequired !== undefined && source.policyInputRequired !== true)
    throw new TypeError("policyInputRequired must be true when present");
  const revision = exactKeys(
    record(source.revision, "revision"),
    ["id", "contentDigest"],
    "revision",
  );
  id(revision.id, "revision id");
  digest(revision.contentDigest, "revision digest");
  const compiler = exactKeys(record(source.compiler, "compiler"), ["id", "version"], "compiler");
  id(compiler.id, "compiler id");
  const version = text(compiler.version, "compiler version");
  if (version.length < 1 || version.length > 80) throw new TypeError("invalid compiler version");
}

const DECLARATION_KEYS = [
  "id",
  "sourceId",
  "sourceRevisionId",
  "contentDigest",
  "originalPath",
  "derivation",
  "kind",
  "label",
  "detailChunkId",
  "declaredHostCapabilities",
] as const;
const DECLARATION_OPTIONAL = ["runtimeIdentity", "exclusiveSlot", "methodologyKey"] as const;

function validateDeclarationFields(asset: JsonRecord, label: string): void {
  id(asset.id, `${label} id`);
  id(asset.sourceId, `${label} source`);
  id(asset.sourceRevisionId, `${label} revision`);
  digest(asset.contentDigest, `${label} digest`);
  safePath(asset.originalPath, `${label} original path`);
  oneOf(
    asset.derivation,
    ["upstream", "modified-copy", "organization-declaration", "built-in", "core-derived"],
    `${label} derivation`,
  );
  visible(asset.kind, `${label} kind`, 80);
  visible(asset.label, `${label} label`, 500);
  id(asset.detailChunkId, `${label} detail chunk`);
  for (const capability of list(asset.declaredHostCapabilities, `${label} capabilities`, 0, 50)) {
    const value = text(capability, `${label} capability`);
    if (value.length < 1 || value.length > 160) throw new TypeError(`${label} capability`);
  }
  if (asset.runtimeIdentity !== undefined) {
    id(asset.runtimeIdentity, `${label} runtime identity`);
    if (asset.kind !== "mcp")
      throw new TypeError("Only MCP assets may declare a runtime identity.");
  }
  if (asset.exclusiveSlot !== undefined)
    oneOf(asset.exclusiveSlot, ["methodology"], `${label} slot`);
  if (asset.methodologyKey !== undefined) id(asset.methodologyKey, `${label} methodology key`);
  if (asset.exclusiveSlot === "methodology" && asset.methodologyKey === undefined)
    throw new TypeError("Methodology assets require a methodology key.");
  if (asset.exclusiveSlot === undefined && asset.methodologyKey !== undefined)
    throw new TypeError("Only methodology assets may carry a methodology key.");
}

export function validateCompilerDeclarationV1(value: unknown): CompilerAssetDeclarationV1 {
  const asset = exactKeys(
    record(value, "compiler declaration"),
    DECLARATION_KEYS,
    "compiler declaration",
    DECLARATION_OPTIONAL,
  );
  validateDeclarationFields(asset, "compiler declaration");
  return asset as unknown as CompilerAssetDeclarationV1;
}

function validateAsset(value: unknown, key: string, targets: ReadonlySet<string>): void {
  const label = `asset ${key}`;
  const asset = exactKeys(record(value, label), [...DECLARATION_KEYS, "authoring"], label, [
    ...DECLARATION_OPTIONAL,
  ]);
  validateDeclarationFields(asset, label);
  if (asset.id !== key) throw new TypeError("Asset key must match id.");
  const authoring = exactKeys(
    record(asset.authoring, `${label} authoring`),
    ["action", "supportedTargets"],
    `${label} authoring`,
    ["projectorId"],
  );
  const action = oneOf(authoring.action, ACTIONS, `${label} action`);
  if (authoring.projectorId !== undefined)
    oneOf(authoring.projectorId, ["mcp-managed-settings", "usage-hook"], `${label} projector`);
  const supported = list(authoring.supportedTargets, `${label} targets`, 0, targets.size).map(
    (target) => text(target, `${label} target`),
  );
  if (supported.some((target) => !targets.has(target)))
    throw new TypeError(`${label} names an ungoverned target`);
  const control = action === "select-control";
  if (control && (authoring.projectorId === undefined || supported.length === 0))
    throw new TypeError("Selectable controls require a projector id and supported targets.");
  if (!control && (authoring.projectorId !== undefined || supported.length !== 0))
    throw new TypeError("Only selectable controls may carry a projector or targets.");
  if (!ordered(supported)) throw new TypeError("Supported targets must be unique and ordered.");
}

function validateEvidence(value: unknown, key: string): void {
  const label = `evidence ${key}`;
  const evidence = exactKeys(
    record(value, label),
    [
      "id",
      "projectionVersion",
      "subjects",
      "evidenceDigest",
      "coveredPaths",
      "verification",
      "scan",
      "qualification",
      "findings",
    ],
    label,
  );
  id(evidence.id, `${label} id`);
  if (evidence.projectionVersion !== "evidence-summary/v1")
    throw new TypeError(`${label} projection version`);
  for (const subject of list(evidence.subjects, `${label} subjects`, 1, 1_000)) {
    const item = exactKeys(
      record(subject, `${label} subject`),
      ["assetId", "sourceId", "sourceRevisionId", "contentDigest"],
      `${label} subject`,
    );
    id(item.assetId, "subject asset");
    id(item.sourceId, "subject source");
    id(item.sourceRevisionId, "subject revision");
    digest(item.contentDigest, "subject digest");
  }
  digest(evidence.evidenceDigest, `${label} digest`);
  for (const path of list(evidence.coveredPaths, `${label} covered paths`, 1, 10_000))
    safePath(path, `${label} covered path`);
  const verification = exactKeys(
    record(evidence.verification, `${label} verification`),
    ["state"],
    `${label} verification`,
    ["verifiedAt", "contextDigest", "validUntil"],
  );
  const state = oneOf(
    verification.state,
    ["verified", "unverified", "missing", "stale"],
    `${label} verification state`,
  );
  if (verification.verifiedAt !== undefined) datetime(verification.verifiedAt, "verifiedAt");
  if (verification.validUntil !== undefined) datetime(verification.validUntil, "validUntil");
  if (verification.contextDigest !== undefined) digest(verification.contextDigest, "context");
  const custody =
    verification.verifiedAt !== undefined &&
    verification.contextDigest !== undefined &&
    verification.validUntil !== undefined;
  if (
    state === "verified" &&
    (!custody ||
      Date.parse(verification.validUntil as string) <=
        Date.parse(verification.verifiedAt as string))
  )
    throw new TypeError("Verified evidence requires ordered verification time, context, validity.");
  if (
    state !== "verified" &&
    (verification.verifiedAt !== undefined ||
      verification.contextDigest !== undefined ||
      verification.validUntil !== undefined)
  )
    throw new TypeError("Only verified evidence may carry custody timestamps or context.");
  const scan = exactKeys(record(evidence.scan, `${label} scan`), ["outcome", "coverage"], label, [
    "analyzers",
    "reportSignedAt",
    "reportVerificationExpiresAt",
    "publishedAt",
    "scope",
    "publishedComponentIds",
    "reportFindingCount",
  ]);
  const outcome = oneOf(scan.outcome, ["pass", "failed", "unknown"], `${label} outcome`);
  const coverage = oneOf(scan.coverage, ["complete", "partial", "none"], `${label} coverage`);
  if (outcome === "pass" && coverage !== "complete")
    throw new TypeError("A passing scan requires complete coverage.");
  if (scan.analyzers !== undefined) {
    let previous: string | undefined;
    for (const analyzer of list(scan.analyzers, `${label} analyzers`, 0, 32)) {
      const item = exactKeys(record(analyzer, "analyzer"), ["name", "version"], "analyzer");
      const pair = `${visible(item.name, "analyzer name", 256)}\u0000${visible(item.version, "analyzer version", 256)}`;
      if (previous !== undefined && previous >= pair)
        throw new TypeError("analyzers must be uniquely ordered by name and version");
      previous = pair;
    }
  }
  for (const field of ["reportSignedAt", "reportVerificationExpiresAt", "publishedAt"] as const)
    if (scan[field] !== undefined) datetime(scan[field], `${label} ${field}`);
  const signed = scan.reportSignedAt as string | undefined;
  const expires = scan.reportVerificationExpiresAt as string | undefined;
  const published = scan.publishedAt as string | undefined;
  if (
    (expires !== undefined && signed === undefined) ||
    (published !== undefined && signed === undefined) ||
    (signed !== undefined &&
      ((expires !== undefined && Date.parse(signed) >= Date.parse(expires)) ||
        (published !== undefined && Date.parse(signed) > Date.parse(published))))
  )
    throw new TypeError("Authenticated scan provenance dates must be ordered from signing.");
  if (scan.scope !== undefined && scan.scope !== "published-component-containment")
    throw new TypeError(`${label} scope`);
  if (scan.publishedComponentIds !== undefined)
    for (const component of list(scan.publishedComponentIds, "published ids", 1, 1_000))
      id(component, "published component id");
  if (scan.reportFindingCount !== undefined) {
    const count = integer(scan.reportFindingCount, "report finding count");
    if (count > 1_000_000) throw new TypeError("report finding count out of bounds");
  }
  const qualification = exactKeys(
    record(evidence.qualification, `${label} qualification`),
    ["state"],
    label,
  );
  oneOf(qualification.state, ["qualified", "unqualified", "unknown"], `${label} qualification`);
  for (const finding of list(evidence.findings, `${label} findings`, 0, 50)) {
    const value = text(finding, "finding");
    if (value.length < 1 || value.length > 1_000) throw new TypeError("finding out of bounds");
  }
}

/**
 * Structural validation equivalent to Core's AuthoringCatalogBundleV1Schema.
 * `governedTargets` is the Core-declared closed MCP target set.
 */
export function validateAuthoringCatalogBundleV1(
  value: unknown,
  governedTargets: readonly string[],
): AuthoringCatalogBundleV1 {
  const bundle = exactKeys(
    record(value, "authoring catalog bundle"),
    [
      "version",
      "sources",
      "assets",
      "groups",
      "relations",
      "templates",
      "evidence",
      "provenance",
      "detailChunks",
    ],
    "authoring catalog bundle",
    ["qualifications"],
  );
  if (bundle.version !== "authoring-catalog-bundle/v1")
    throw new TypeError("unsupported authoring catalog bundle version");
  const targets = new Set(governedTargets);
  const sources = record(bundle.sources, "sources");
  for (const [key, source] of Object.entries(sources)) validateSource(source, id(key, "source"));
  const assets = record(bundle.assets, "assets") as Record<string, AuthoringAssetV1>;
  for (const [key, asset] of Object.entries(assets))
    validateAsset(asset, id(key, "asset"), targets);
  const detailChunks = record(bundle.detailChunks, "detail chunks");
  for (const [key, chunk] of Object.entries(detailChunks)) {
    id(key, "detail chunk id");
    const item = exactKeys(record(chunk, "detail chunk"), ["bytes", "digest"], "detail chunk");
    const bytes = text(item.bytes, "detail chunk bytes");
    if (bytes.length < 1 || bytes.length > 1_000_000) throw new TypeError("detail chunk bounds");
    digest(item.digest, "detail chunk digest");
  }
  const exists = (assetId: string) => assets[assetId] !== undefined;
  for (const [key, asset] of Object.entries(assets)) {
    const source = sources[asset.sourceId] as SourceDescriptorV1 | undefined;
    if (source === undefined || source.revision.id !== asset.sourceRevisionId)
      throw new TypeError(`Asset ${key} source and immutable revision must exist in the bundle.`);
    if (detailChunks[asset.detailChunkId] === undefined)
      throw new TypeError(`Asset ${key} detail chunk must exist in the bundle.`);
  }
  for (const [key, value] of Object.entries(record(bundle.groups, "groups"))) {
    const group = exactKeys(record(value, `group ${key}`), ["id", "label", "assetIds"], "group");
    id(group.id, "group id");
    visible(group.label, "group label", 500);
    const ids = list(group.assetIds, "group assets", 0, 50_000).map((item) => id(item, "member"));
    if (group.id !== key || ids.some((item) => !exists(item)) || !ordered(ids))
      throw new TypeError(`Group ${key} is malformed or references an unknown asset.`);
  }
  const relationKeys = new Set<string>();
  for (const value of list(bundle.relations, "relations", 0, 100_000)) {
    const relation = exactKeys(
      record(value, "relation"),
      ["fromAssetId", "toAssetId", "kind"],
      "relation",
      ["membership"],
    ) as unknown as CatalogRelationV1;
    id(relation.fromAssetId, "relation from");
    id(relation.toAssetId, "relation to");
    oneOf(relation.kind, ["requires", "member", "conflicts"], "relation kind");
    if (relation.membership !== undefined)
      oneOf(relation.membership, ["required", "optional"], "relation membership");
    if ((relation.kind === "member") !== (relation.membership !== undefined))
      throw new TypeError("Only member relations state membership semantics, and all of them do.");
    if (!exists(relation.fromAssetId) || !exists(relation.toAssetId))
      throw new TypeError("Relation references an unknown asset.");
    const endpoints =
      relation.kind === "conflicts" && relation.toAssetId < relation.fromAssetId
        ? [relation.toAssetId, relation.fromAssetId]
        : [relation.fromAssetId, relation.toAssetId];
    const key = `${endpoints[0]}\u0000${endpoints[1]}`;
    if (relation.fromAssetId === relation.toAssetId || relationKeys.has(key))
      throw new TypeError("Relations must be unique and cannot be self-referential.");
    relationKeys.add(key);
    const target = assets[relation.toAssetId] as AuthoringAssetV1;
    if (
      relation.kind !== "conflicts" &&
      target.authoring.action !== "select-control" &&
      target.authoring.action !== "record-selection"
    )
      throw new TypeError("Closure relations may target only selectable records.");
  }
  for (const [key, value] of Object.entries(record(bundle.templates, "templates"))) {
    const template = exactKeys(
      record(value, `template ${key}`),
      ["id", "digest", "roots", "exclusions"],
      "template",
      ["label"],
    );
    id(template.id, "template id");
    if (template.label !== undefined) {
      const label = visible(template.label, "template label", 1_000);
      if (label.trim() !== label) throw new TypeError("template label has surrounding space");
    }
    digest(template.digest, "template digest");
    const roots = list(template.roots, "template roots", 1, 1_000).map((root) => {
      const item = exactKeys(
        record(root, "template root"),
        ["assetId", "mode", "includeOptionalMembers"],
        "template root",
      );
      const mode = oneOf(item.mode, ["select", "structural"], "template root mode");
      if (typeof item.includeOptionalMembers !== "boolean")
        throw new TypeError("template root includeOptionalMembers");
      if (mode === "structural" && item.includeOptionalMembers)
        throw new TypeError("Structural roots cannot expand optional members.");
      return id(item.assetId, "template root");
    });
    const exclusions = list(template.exclusions, "exclusions", 0, 10_000).map((item) =>
      id(item, "exclusion"),
    );
    if (
      template.id !== key ||
      [...roots, ...exclusions].some((item) => !exists(item)) ||
      !ordered(roots) ||
      !ordered(exclusions) ||
      roots.some((item) => exclusions.includes(item))
    )
      throw new TypeError(`Template ${key} is malformed or references an unknown asset.`);
  }
  for (const [key, value] of Object.entries(record(bundle.evidence, "evidence"))) {
    validateEvidence(value, key);
    const evidence = value as EvidenceSummaryV1;
    const subjectIds = evidence.subjects.map((subject) => subject.assetId);
    if (evidence.id !== key || !ordered(subjectIds) || !ordered(evidence.coveredPaths))
      throw new TypeError(`Evidence ${key} key, subjects and paths must be unique and ordered.`);
    if (
      evidence.subjects.some((subject) => {
        const asset = assets[subject.assetId];
        return (
          asset === undefined ||
          asset.sourceId !== subject.sourceId ||
          asset.sourceRevisionId !== subject.sourceRevisionId ||
          asset.contentDigest !== subject.contentDigest
        );
      })
    )
      throw new TypeError(`Evidence ${key} subject must exactly match an asset identity.`);
  }
  if (bundle.qualifications !== undefined)
    for (const [key, qualification] of Object.entries(
      record(bundle.qualifications, "qualifications"),
    ))
      if (record(qualification, "qualification").assetId !== key)
        throw new TypeError("Catalog qualification key must match its asset identity.");
  const provenance = exactKeys(
    record(bundle.provenance, "provenance"),
    ["bundleDigest"],
    "provenance",
  );
  digest(provenance.bundleDigest, "bundle digest");
  return bundle as unknown as AuthoringCatalogBundleV1;
}

/** Core-only assembly policy joins declarations with the closed capability registry. */
export function assembleAuthoringAssetV1(
  declaration: CompilerAssetDeclarationV1,
  registry: readonly CoreAuthoringCapabilityRegistryEntryV1[],
): AuthoringAssetV1 {
  const matches = registry.filter(
    (entry) =>
      entry.assetId === declaration.id &&
      entry.sourceId === declaration.sourceId &&
      entry.sourceRevisionId === declaration.sourceRevisionId &&
      entry.contentDigest === declaration.contentDigest,
  );
  if (matches.length > 1) throw new Error("ambiguous Core authoring capability");
  const match = matches[0];
  const authoring =
    match === undefined
      ? { action: "record-request" as const, supportedTargets: [] }
      : {
          action: match.action,
          ...(match.projectorId === undefined ? {} : { projectorId: match.projectorId }),
          supportedTargets: [...match.supportedTargets],
        };
  return structuredClone({ ...validateCompilerDeclarationV1(declaration), authoring });
}

export function authoringCatalogDigestV1(bytes: Uint8Array | string): string {
  return `sha256:${sha256HexV1(bytes)}`;
}

/** Detail chunk digests and the bundle's self digest must both hold. */
export function verifyAuthoringCatalogBundleIntegrityV1(bundle: AuthoringCatalogBundleV1): void {
  for (const [chunkId, chunk] of Object.entries(bundle.detailChunks)) {
    if (authoringCatalogDigestV1(chunk.bytes) !== chunk.digest)
      throw new Error(`detail chunk digest mismatch: ${chunkId}`);
  }
  const { bundleDigest: declaredDigest, ...provenance } = bundle.provenance;
  const expectedDigest = `sha256:${canonicalStrictJsonSha256V1({ ...bundle, provenance })}`;
  if (declaredDigest !== expectedDigest) throw new Error("bundle digest mismatch");
}
