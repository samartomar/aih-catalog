import { canonicalJsonV1, canonicalStrictJsonSha256V1, sha256HexV1 } from "../strict-json-v1.js";
import {
  COMMIT_SHA,
  exactKeys,
  integer,
  type JsonRecord,
  list,
  literal,
  record,
  SHA256_HEX,
  text,
} from "../validate-v1.js";
import {
  actionForCompilerDeclarationV1,
  compilerRegistrationForInputFormatV1,
} from "./compiler-formats-v1.js";
import {
  type AuthoringCatalogBundleV1,
  validateAuthoringCatalogBundleV1,
  verifyAuthoringCatalogBundleIntegrityV1,
} from "./contracts-v1.js";
import {
  type PackagedScannerCollectionEvidenceV1,
  projectScannerCollectionEvidenceV1,
} from "./packaged-evidence-v1.js";

/**
 * Sealed `packaged-workbench-source-data/v1` records are true inputs: each is a
 * release-prepared, Scanner-proven source bundle for one upstream collection.
 * The Catalog swaps each record's source into the compiled bundle exactly as
 * Core does. Ported from Core 80120883 src/org-policy/workbench/core/
 * {packaged-source-data,packaged-source-data-record,source-data}.ts; bindings
 * and runtime descriptor registration are Core concerns and stay there.
 */
export interface PackagedSourceRecordV1 {
  version: "packaged-workbench-source-data/v1";
  sourceBundle: AuthoringCatalogBundleV1;
  source: { repository: string; commit: string };
  record: JsonRecord;
}

export interface PackagedSourceSealV1 {
  bytes: number;
  sha256: string;
}

const PACKAGED_FORMATS = [
  "pinned-baseline/v1",
  "pinned-skill-collection/v1",
  "pinned-component-collection/v1",
];

function blob(value: unknown, label: string, extra: "bytesBase64" | "url"): void {
  const input = exactKeys(record(value, label), ["sha256", "bytes", extra], label);
  text(input.sha256, `${label} sha256`, SHA256_HEX);
  const size = integer(input.bytes, `${label} bytes`, 1);
  if (size > 64 * 1024 * 1024) throw new TypeError(`${label} bytes out of bounds`);
  const value2 = text(input[extra], `${label} ${extra}`);
  if (value2.length > (extra === "url" ? 1_000 : 700_000))
    throw new TypeError(`${label} ${extra} out of bounds`);
}

function parseRecord(value: unknown, governedTargets: readonly string[]): PackagedSourceRecordV1 {
  const label = "packaged source record";
  const input = exactKeys(
    record(value, label),
    [
      "version",
      "sourceBundle",
      "source",
      "scannerProof",
      "compilerTemplate",
      "inlineBlobs",
      "publicationBlobs",
    ],
    label,
    ["runtimeDescriptor"],
  );
  literal(input.version, "packaged-workbench-source-data/v1", `${label} version`);
  const source = exactKeys(
    record(input.source, `${label} source`),
    ["repository", "commit"],
    label,
  );
  if (input.runtimeDescriptor !== undefined) {
    const descriptor = exactKeys(
      record(input.runtimeDescriptor, `${label} runtime descriptor`),
      ["bytesBase64", "sha256"],
      `${label} runtime descriptor`,
    );
    const bytes = text(descriptor.bytesBase64, `${label} runtime descriptor bytes`);
    if (bytes.length < 1 || bytes.length > 16 * 1024 * 1024)
      throw new TypeError(`${label} runtime descriptor bytes out of bounds`);
    text(descriptor.sha256, `${label} runtime descriptor seal`, /^sha256:[a-f0-9]{64}$/u);
  }
  list(input.inlineBlobs, `${label} inline blobs`, 0, 32).forEach((item, index) => {
    blob(item, `${label} inline blob ${String(index)}`, "bytesBase64");
  });
  list(input.publicationBlobs, `${label} publication blobs`, 1, 16).forEach((item, index) => {
    blob(item, `${label} publication blob ${String(index)}`, "url");
  });
  const sourceBundle = validateAuthoringCatalogBundleV1(input.sourceBundle, governedTargets);
  verifyAuthoringCatalogBundleIntegrityV1(sourceBundle);
  return {
    version: "packaged-workbench-source-data/v1",
    sourceBundle,
    source: {
      repository: text(
        source.repository,
        `${label} repository`,
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
      ),
      commit: text(source.commit, `${label} commit`, COMMIT_SHA),
    },
    record: input,
  };
}

/** Reads the sealed records: canonical bytes, matching seal, one exact source each. */
export function parsePackagedSourceRecordsV1(
  value: unknown,
  governedTargets: readonly string[],
): { records: PackagedSourceRecordV1[]; seals: PackagedSourceSealV1[] } {
  const wrappers = list(value, "packaged source records", 0, 64);
  let total = 0;
  const seen = new Set<string>();
  const seals: PackagedSourceSealV1[] = [];
  const records = wrappers.map((wrapper, index) => {
    const label = `packaged source record ${String(index)}`;
    const sealed = exactKeys(record(wrapper, label), ["bytes", "sha256"], label);
    const bytes = text(sealed.bytes, `${label} bytes`);
    const size = Buffer.byteLength(bytes, "utf8");
    total += size;
    if (size > 16 * 1024 * 1024 || total > 64 * 1024 * 1024)
      throw new TypeError("packaged source data exceeds its byte budget");
    const seal = text(sealed.sha256, `${label} seal`, SHA256_HEX);
    const parsed: unknown = JSON.parse(bytes);
    if (canonicalJsonV1(parsed) !== bytes || sha256HexV1(bytes) !== seal)
      throw new TypeError("packaged source data seal mismatch");
    const result = parseRecord(parsed, governedTargets);
    const sources = Object.values(result.sourceBundle.sources);
    const source = sources[0];
    if (sources.length !== 1 || source === undefined || seen.has(source.id))
      throw new TypeError("packaged source identity is ambiguous");
    if (
      source.upstreamOrigin.kind !== "aih" &&
      (source.upstreamOrigin.locator.replace(/^https:\/\/github\.com\//u, "") !==
        result.source.repository ||
        source.revision.id !== result.source.commit)
    )
      throw new TypeError("packaged source archive identity mismatch");
    seen.add(source.id);
    seals.push({ bytes: size, sha256: seal });
    return result;
  });
  return { records, seals };
}

function fail(message: string): never {
  throw new TypeError(`Workbench source data: ${message}`);
}

/** Only reviewed pinned-collection formats may replace a compiled source. */
function assertCompatibleSourceBundle(bundle: AuthoringCatalogBundleV1) {
  const sources = Object.values(bundle.sources);
  const source = sources[0];
  if (sources.length !== 1 || source === undefined) fail("one exact source is required");
  if (source.policyInputRequired || !PACKAGED_FORMATS.includes(source.inputFormat))
    fail("unsupported source data format");
  if (source.id === "source:aih-core" || source.upstreamOrigin.kind === "aih")
    fail("unauthorized source scope");
  const registration = compilerRegistrationForInputFormatV1(source.inputFormat);
  if (source.compiler.id !== registration.id || source.compiler.version !== registration.version)
    fail("incompatible compiler");
  for (const asset of Object.values(bundle.assets))
    if (
      asset.derivation === "built-in" ||
      asset.sourceId !== source.id ||
      asset.authoring.projectorId !== undefined ||
      asset.authoring.supportedTargets.length !== 0 ||
      asset.authoring.action !== actionForCompilerDeclarationV1(source.inputFormat, asset.kind)
    )
      fail("data cannot supply Core capabilities");
  verifyAuthoringCatalogBundleIntegrityV1(bundle);
  return source;
}

type Pin = { assetId: string; sourceId: string; sourceRevisionId: string; contentDigest: string };

function exactPins(bundle: AuthoringCatalogBundleV1, pins: readonly Pin[]): boolean {
  return pins.every((pin) => {
    const asset = bundle.assets[pin.assetId];
    return (
      asset !== undefined &&
      asset.sourceId === pin.sourceId &&
      asset.sourceRevisionId === pin.sourceRevisionId &&
      asset.contentDigest === pin.contentDigest
    );
  });
}

const REPLACED_FIELDS = [
  "sources",
  "assets",
  "detailChunks",
  "groups",
  "templates",
  "evidence",
  "qualifications",
] as const;

// D105 curates the current projection, while the sealed source record remains intact.
const CURATED_ECC_MCP_ASSETS = new Set(
  [
    "code-review-graph",
    "codebase-memory-mcp",
    "context7",
    "exa",
    "github",
    "sequential-thinking",
  ].map((name) => `ecc/mcp:${name}`),
);

function curateCurrentEccMcpAssets(result: AuthoringCatalogBundleV1): void {
  for (const assetId of CURATED_ECC_MCP_ASSETS) {
    const asset = result.assets[assetId];
    if (asset === undefined) continue;
    if (asset.sourceId !== "source:ecc" || asset.kind !== "mcp")
      fail(`curated ECC MCP identity differs: ${assetId}`);
    delete result.assets[assetId];
    if (!Object.values(result.assets).some((item) => item.detailChunkId === asset.detailChunkId))
      delete result.detailChunks[asset.detailChunkId];
    delete result.qualifications?.[assetId];
  }
  for (const [groupId, group] of Object.entries(result.groups)) {
    group.assetIds = group.assetIds.filter((id) => !CURATED_ECC_MCP_ASSETS.has(id));
    if (group.assetIds.length === 0) delete result.groups[groupId];
  }
  for (const [evidenceId, evidence] of Object.entries(result.evidence)) {
    if (!evidence.subjects.some((subject) => CURATED_ECC_MCP_ASSETS.has(subject.assetId))) continue;
    if (evidence.subjects.some((subject) => !CURATED_ECC_MCP_ASSETS.has(subject.assetId)))
      fail(`curated ECC MCP has shared evidence: ${evidenceId}`);
    delete result.evidence[evidenceId];
  }
  if (
    result.relations.some(
      (relation) =>
        CURATED_ECC_MCP_ASSETS.has(relation.fromAssetId) ||
        CURATED_ECC_MCP_ASSETS.has(relation.toAssetId),
    ) ||
    Object.values(result.templates).some((template) =>
      [...template.roots.map((root) => root.assetId), ...template.exclusions].some((id) =>
        CURATED_ECC_MCP_ASSETS.has(id),
      ),
    )
  )
    fail("curated ECC MCP has a relation or template reference");
}

function replaceSource(
  result: AuthoringCatalogBundleV1,
  chosen: AuthoringCatalogBundleV1,
  id: string,
  evidenceRecords: readonly PackagedScannerCollectionEvidenceV1[],
): void {
  const previousIds = new Set(
    Object.values(result.assets)
      .filter((asset) => asset.sourceId === id)
      .map((asset) => asset.id),
  );
  const previousChunks = new Set(
    [...previousIds].map((assetId) => result.assets[assetId]?.detailChunkId),
  );
  const changed = (assetId: string) => {
    const old = previousIds.has(assetId) ? result.assets[assetId] : undefined;
    return (
      old !== undefined &&
      !exactPins(chosen, [
        {
          assetId,
          sourceId: old.sourceId,
          sourceRevisionId: old.sourceRevisionId,
          contentDigest: old.contentDigest,
        },
      ])
    );
  };
  const mixed = (ids: readonly string[]) =>
    ids.some((assetId) => previousIds.has(assetId)) &&
    ids.some((assetId) => !previousIds.has(assetId));
  const incompatible = (ids: readonly string[]) => mixed(ids) && ids.some(changed);
  if (
    Object.values(result.groups).some((group) => incompatible(group.assetIds)) ||
    Object.values(result.templates).some((template) =>
      incompatible([...template.roots.map((root) => root.assetId), ...template.exclusions]),
    ) ||
    result.relations.some((relation) => incompatible([relation.fromAssetId, relation.toAssetId])) ||
    Object.values(result.evidence).some((evidence) =>
      incompatible(evidence.subjects.map((subject) => subject.assetId)),
    )
  )
    fail(
      "update invalidates a cross-source closure; recompile the affected composition explicitly",
    );
  for (const assetId of previousIds) delete result.assets[assetId];
  for (const chunk of previousChunks)
    if (
      chunk !== undefined &&
      !Object.values(result.assets).some((asset) => asset.detailChunkId === chunk)
    )
      delete result.detailChunks[chunk];
  for (const [groupId, group] of Object.entries(result.groups))
    if (group.assetIds.some((assetId) => previousIds.has(assetId)) && !mixed(group.assetIds))
      delete result.groups[groupId];
  for (const [templateId, template] of Object.entries(result.templates)) {
    const ids = [...template.roots.map((root) => root.assetId), ...template.exclusions];
    if (ids.some((assetId) => previousIds.has(assetId)) && !mixed(ids))
      delete result.templates[templateId];
  }
  result.relations = result.relations.filter(
    (item) =>
      (!previousIds.has(item.fromAssetId) && !previousIds.has(item.toAssetId)) ||
      mixed([item.fromAssetId, item.toAssetId]),
  );
  for (const [evidenceId, evidence] of Object.entries(result.evidence))
    if (
      evidence.subjects.some((subject) => previousIds.has(subject.assetId)) &&
      !mixed(evidence.subjects.map((subject) => subject.assetId))
    )
      delete result.evidence[evidenceId];
  for (const [qualificationId, qualification] of Object.entries(result.qualifications ?? {}))
    if (previousIds.has((qualification as { assetId: string }).assetId))
      delete result.qualifications?.[qualificationId];
  for (const field of REPLACED_FIELDS) {
    // Missing publisher display data must not erase known exact-source Scanner findings.
    let incoming: Record<string, unknown> | undefined;
    if (field === "evidence") {
      const retained = projectScannerCollectionEvidenceV1(chosen, evidenceRecords);
      incoming = {
        ...retained,
        ...Object.fromEntries(
          Object.entries(chosen.evidence).map(([key, value]) => [
            key,
            value.verification.state === "verified" ? value : (retained[key] ?? value),
          ]),
        ),
      };
    } else incoming = chosen[field] as Record<string, unknown> | undefined;
    if (incoming === undefined) continue;
    const current = (result[field] ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(incoming))
      if (Object.hasOwn(current, key) && !(field === "sources" && key === id))
        fail("source data collides with unrelated data");
    Object.assign(current, incoming);
    Object.assign(result, { [field]: current });
  }
  result.relations.push(...chosen.relations);
}

/** Replaces each packaged source in order, then reseals the bundle. */
export function applyPackagedSourceBundlesV1(
  base: AuthoringCatalogBundleV1,
  records: readonly PackagedSourceRecordV1[],
  evidenceRecords: readonly PackagedScannerCollectionEvidenceV1[],
  governedTargets: readonly string[],
): AuthoringCatalogBundleV1 {
  const result = structuredClone(base);
  const seen = new Set<string>();
  for (const item of records) {
    const source = assertCompatibleSourceBundle(item.sourceBundle);
    if (seen.has(source.id)) fail("duplicate packaged source");
    seen.add(source.id);
    replaceSource(result, structuredClone(item.sourceBundle), source.id, evidenceRecords);
  }
  curateCurrentEccMcpAssets(result);
  result.provenance.bundleDigest = `sha256:${canonicalStrictJsonSha256V1({ ...result, provenance: {} })}`;
  const sealed = validateAuthoringCatalogBundleV1(result, governedTargets);
  verifyAuthoringCatalogBundleIntegrityV1(sealed);
  return sealed;
}
