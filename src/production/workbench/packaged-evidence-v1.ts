import { parseBaselineEvidenceLockV1 } from "../catalog/baseline-lock-v1.js";
import { canonicalJsonV1, canonicalStrictJsonSha256V1, sha256HexV1 } from "../strict-json-v1.js";
import {
  COMMIT_SHA,
  exactKeys,
  type JsonRecord,
  list,
  literal,
  oneOf,
  QUALIFIED_SHA256,
  record,
  SHA256_HEX,
  text,
} from "../validate-v1.js";
import type { AuthoringCatalogBundleV1, EvidenceSummaryV1 } from "./contracts-v1.js";

/**
 * Sealed `packaged-scanner-collection-evidence/v1` records (true inputs from
 * the Scanner release process) and their display projection onto a bundle.
 * Ported from Core 80120883 src/org-policy/packaged-collection-evidence-v1.ts
 * and src/evidence-freshness.ts. The reviewed-publisher allowlist is Core's
 * acceptance policy and stays in Core; everything a record states about
 * itself is checked here.
 */
const CATALOG_IDS = ["aih", "mattpocock", "ponytail", "ecc", "superpowers"] as const;
const EVIDENCE_MAX_AGE_SECONDS = 90 * 86_400;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export interface PackagedEvidenceSubjectV1 {
  assetId: string;
  sourceId: string;
  sourceRevisionId: string;
  contentDigest: string;
}

/**
 * A compiler-partition component covers exactly one compiled asset (`subject`). A
 * whole-repository inventory component is scanned whatever its asset count and names the
 * zero-to-many compiled assets whose original path it scans (`subjects`, in asset-id order).
 */
export type PackagedEvidenceComponentV1 = {
  componentId: string;
  componentTreeSha256: string;
  paths: string[];
  files: { path: string; digest: string }[];
} & ({ subject: PackagedEvidenceSubjectV1 } | { subjects: PackagedEvidenceSubjectV1[] });

/** The compiled assets one coverage component binds. */
function componentSubjectsV1(covered: PackagedEvidenceComponentV1): PackagedEvidenceSubjectV1[] {
  return "subject" in covered ? [covered.subject] : covered.subjects;
}

export interface PackagedScannerCollectionEvidenceV1 {
  version: "packaged-scanner-collection-evidence/v1";
  authority: "display-only";
  catalog: {
    id: (typeof CATALOG_IDS)[number];
    owner: string;
    repository: string;
    pinnedCommit: string;
    sourceTreeSha256: string;
    coverageDigest: string;
    coverageProjectionDigest: string;
    source: {
      id: string;
      revisionId: string;
      contentDigest: string;
      inputFormat: string;
      upstreamOrigin: { kind: "git" | "aih"; locator: string };
    };
  };
  coverage: {
    version: "workbench-scanner-coverage/v1";
    authority: "none";
    scope: "declared-source-files";
    components: PackagedEvidenceComponentV1[];
    unmappedDerivedAssets: string[];
  };
  report: ReturnType<typeof parseBaselineEvidenceLockV1>["sources"][number];
  publications: {
    authority: "none";
    repository: string;
    workflow: string;
    ref: string;
    sourceCommit: string;
    publicationSha256: string;
    requestSha256: string;
    receiptSha256: string;
    publicationLocator: string;
    publishedAt: string;
  }[];
  observations: {
    componentId: string;
    reportSignedAt: string;
    reportVerificationExpiresAt: string;
    componentTreeSha256: string;
    requestSha256: string;
    publicationSha256: string;
    receiptSha256: string;
    reportComponentDigest: string;
  }[];
  verification: { method: "gh-attestation-verify"; preparedAt: string };
}

function timestamp(value: string, label: string): number {
  if (!UTC.test(value)) throw new TypeError(`${label} requires an exact UTC timestamp`);
  const parsed = Date.parse(value);
  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized)
    throw new TypeError(`${label} is invalid`);
  return parsed;
}

/** The original date owns the ninety-day freshness clock. */
export function evidenceExpiryV1(originalDate: string): string {
  const original = timestamp(originalDate, "evidence date");
  return new Date(original + EVIDENCE_MAX_AGE_SECONDS * 1000).toISOString().replace(".000Z", "Z");
}

function bounded(value: unknown, label: string, max: number): string {
  const result = text(value, label);
  if (result.length < 1 || result.length > max) throw new TypeError(`${label} is out of bounds`);
  return result;
}

function safePath(value: unknown, label: string): string {
  const path = bounded(value, label, 1_000);
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new TypeError(`${label} must be a safe relative path`);
  return path;
}

function dateTime(value: unknown, label: string): string {
  const result = text(value, label);
  timestamp(result, label);
  return result;
}

function strictKeys(value: unknown, keys: readonly string[], label: string): JsonRecord {
  return exactKeys(record(value, label), keys, label);
}

function subject(value: unknown, label: string): PackagedEvidenceSubjectV1 {
  const input = strictKeys(
    value,
    ["assetId", "sourceId", "sourceRevisionId", "contentDigest"],
    label,
  );
  return {
    assetId: bounded(input.assetId, `${label} asset`, 240),
    sourceId: bounded(input.sourceId, `${label} source`, 240),
    sourceRevisionId: bounded(input.sourceRevisionId, `${label} revision`, 240),
    contentDigest: text(input.contentDigest, `${label} content digest`, QUALIFIED_SHA256),
  };
}

function component(value: unknown, label: string): PackagedEvidenceComponentV1 {
  const inventory = Object.hasOwn(record(value, label), "subjects");
  const input = strictKeys(
    value,
    ["componentId", "componentTreeSha256", "paths", "files", inventory ? "subjects" : "subject"],
    label,
  );
  const subjects = inventory
    ? {
        subjects: list(input.subjects, `${label} subjects`, 0, 1_000).map((item, index) =>
          subject(item, `${label} subject ${String(index)}`),
        ),
      }
    : { subject: subject(input.subject, `${label} subject`) };
  return {
    componentId: bounded(input.componentId, `${label} id`, 240),
    componentTreeSha256: text(input.componentTreeSha256, `${label} tree`, SHA256_HEX),
    paths: list(input.paths, `${label} paths`, 1, 10_000).map((path, index) =>
      safePath(path, `${label} path ${String(index)}`),
    ),
    files: list(input.files, `${label} files`, 1, 20_000).map((file, index) => {
      const entry = strictKeys(file, ["path", "digest"], `${label} file ${String(index)}`);
      return {
        path: safePath(entry.path, `${label} file ${String(index)} path`),
        digest: text(entry.digest, `${label} file ${String(index)} digest`, QUALIFIED_SHA256),
      };
    }),
    ...subjects,
  };
}

export function packagedCoverageProjectionDigestV1(coverage: unknown): string {
  return `sha256:${canonicalStrictJsonSha256V1({ version: "packaged-coverage-projection/v1", coverage })}`;
}

export function packagedReportComponentDigestV1(value: unknown): string {
  return `sha256:${canonicalStrictJsonSha256V1({ version: "packaged-report-component/v1", component: value })}`;
}

function parseRecord(value: unknown): PackagedScannerCollectionEvidenceV1 {
  const label = "packaged collection evidence";
  const input = strictKeys(
    value,
    [
      "version",
      "authority",
      "catalog",
      "coverage",
      "report",
      "publications",
      "observations",
      "verification",
    ],
    label,
  );
  literal(input.version, "packaged-scanner-collection-evidence/v1", `${label} version`);
  literal(input.authority, "display-only", `${label} authority`);
  const catalog = strictKeys(
    input.catalog,
    [
      "id",
      "owner",
      "repository",
      "pinnedCommit",
      "sourceTreeSha256",
      "coverageDigest",
      "coverageProjectionDigest",
      "source",
    ],
    `${label} catalog`,
  );
  const source = strictKeys(
    catalog.source,
    ["id", "revisionId", "contentDigest", "inputFormat", "upstreamOrigin"],
    `${label} catalog source`,
  );
  const origin = strictKeys(source.upstreamOrigin, ["kind", "locator"], `${label} origin`);
  const coverage = strictKeys(
    input.coverage,
    ["version", "authority", "scope", "components", "unmappedDerivedAssets"],
    `${label} coverage`,
  );
  literal(coverage.version, "workbench-scanner-coverage/v1", `${label} coverage version`);
  literal(coverage.authority, "none", `${label} coverage authority`);
  literal(coverage.scope, "declared-source-files", `${label} coverage scope`);
  const report = parseBaselineEvidenceLockV1({ schemaVersion: 1, sources: [input.report] })
    .sources[0];
  if (report === undefined) throw new TypeError(`${label} report is missing`);
  const verification = strictKeys(
    input.verification,
    ["method", "preparedAt"],
    `${label} verification`,
  );
  literal(verification.method, "gh-attestation-verify", `${label} verification method`);
  const result: PackagedScannerCollectionEvidenceV1 = {
    version: "packaged-scanner-collection-evidence/v1",
    authority: "display-only",
    catalog: {
      id: oneOf(catalog.id, CATALOG_IDS, `${label} catalog id`),
      owner: bounded(catalog.owner, `${label} owner`, 256),
      repository: bounded(catalog.repository, `${label} repository`, 256),
      pinnedCommit: text(catalog.pinnedCommit, `${label} pinned commit`, COMMIT_SHA),
      sourceTreeSha256: text(catalog.sourceTreeSha256, `${label} source tree`, SHA256_HEX),
      coverageDigest: text(catalog.coverageDigest, `${label} coverage digest`, QUALIFIED_SHA256),
      coverageProjectionDigest: text(
        catalog.coverageProjectionDigest,
        `${label} coverage projection digest`,
        QUALIFIED_SHA256,
      ),
      source: {
        id: bounded(source.id, `${label} source id`, 240),
        revisionId: bounded(source.revisionId, `${label} source revision`, 240),
        contentDigest: text(source.contentDigest, `${label} source digest`, QUALIFIED_SHA256),
        inputFormat: bounded(source.inputFormat, `${label} input format`, 120),
        upstreamOrigin: {
          kind: oneOf(origin.kind, ["git", "aih"] as const, `${label} origin kind`),
          locator: bounded(origin.locator, `${label} origin locator`, 1_000),
        },
      },
    },
    coverage: {
      version: "workbench-scanner-coverage/v1",
      authority: "none",
      scope: "declared-source-files",
      components: list(coverage.components, `${label} components`, 1, 1_000).map((item, index) =>
        component(item, `${label} component ${String(index)}`),
      ),
      unmappedDerivedAssets: list(
        coverage.unmappedDerivedAssets,
        `${label} unmapped`,
        0,
        1_000,
      ).map((item, index) => bounded(item, `${label} unmapped ${String(index)}`, 240)),
    },
    report,
    publications: list(input.publications, `${label} publications`, 1, 1_000).map((item, index) => {
      const itemLabel = `${label} publication ${String(index)}`;
      const publication = strictKeys(
        item,
        [
          "authority",
          "repository",
          "workflow",
          "ref",
          "sourceCommit",
          "publicationSha256",
          "requestSha256",
          "receiptSha256",
          "publicationLocator",
          "publishedAt",
        ],
        itemLabel,
      );
      literal(publication.authority, "none", `${itemLabel} authority`);
      const parsed = {
        authority: "none" as const,
        repository: bounded(publication.repository, `${itemLabel} repository`, 256),
        workflow: bounded(publication.workflow, `${itemLabel} workflow`, 512),
        ref: bounded(publication.ref, `${itemLabel} ref`, 256),
        sourceCommit: text(publication.sourceCommit, `${itemLabel} commit`, COMMIT_SHA),
        publicationSha256: text(publication.publicationSha256, itemLabel, SHA256_HEX),
        requestSha256: text(publication.requestSha256, itemLabel, SHA256_HEX),
        receiptSha256: text(publication.receiptSha256, itemLabel, SHA256_HEX),
        publicationLocator: bounded(publication.publicationLocator, itemLabel, 2_048),
        publishedAt: dateTime(publication.publishedAt, `${itemLabel} publishedAt`),
      };
      if (
        parsed.publicationLocator !==
        `https://github.com/${parsed.repository}/releases/download/baseline-v1-${parsed.sourceCommit}-${parsed.requestSha256}/publication.json`
      )
        throw new TypeError(`${itemLabel} locator does not bind publisher and request`);
      return parsed;
    }),
    observations: list(input.observations, `${label} observations`, 1, 1_000).map((item, index) => {
      const itemLabel = `${label} observation ${String(index)}`;
      const observation = strictKeys(
        item,
        [
          "componentId",
          "reportSignedAt",
          "reportVerificationExpiresAt",
          "componentTreeSha256",
          "requestSha256",
          "publicationSha256",
          "receiptSha256",
          "reportComponentDigest",
        ],
        itemLabel,
      );
      return {
        componentId: bounded(observation.componentId, `${itemLabel} component`, 240),
        reportSignedAt: dateTime(observation.reportSignedAt, `${itemLabel} signedAt`),
        reportVerificationExpiresAt: dateTime(
          observation.reportVerificationExpiresAt,
          `${itemLabel} expiresAt`,
        ),
        componentTreeSha256: text(observation.componentTreeSha256, itemLabel, SHA256_HEX),
        requestSha256: text(observation.requestSha256, itemLabel, SHA256_HEX),
        publicationSha256: text(observation.publicationSha256, itemLabel, SHA256_HEX),
        receiptSha256: text(observation.receiptSha256, itemLabel, SHA256_HEX),
        reportComponentDigest: text(observation.reportComponentDigest, itemLabel, QUALIFIED_SHA256),
      };
    }),
    verification: {
      method: "gh-attestation-verify",
      preparedAt: dateTime(verification.preparedAt, `${label} preparedAt`),
    },
  };
  assertConsistent(result);
  return result;
}

/** The record's own cross-field consistency rules, as Core's schema refinement states them. */
function assertConsistent(value: PackagedScannerCollectionEvidenceV1): void {
  const fail = (message: string): never => {
    throw new TypeError(`packaged collection evidence ${value.catalog.id}: ${message}`);
  };
  if (value.catalog.coverageProjectionDigest !== packagedCoverageProjectionDigestV1(value.coverage))
    fail("coverage projection digest mismatch");
  if (
    value.catalog.id !== value.report.id ||
    value.catalog.owner !== value.report.owner ||
    value.catalog.repository !== value.report.repo ||
    value.catalog.pinnedCommit !== value.report.pinnedSha ||
    value.catalog.sourceTreeSha256 !== value.report.sourceTreeSha256
  )
    fail("catalog and report identity mismatch");
  const components = new Map(value.coverage.components.map((item) => [item.componentId, item]));
  const reports = new Map(value.report.components.map((item) => [item.id, item]));
  const publications = new Map(
    value.publications.map((item) => [
      `${item.requestSha256}\u0000${item.publicationSha256}\u0000${item.receiptSha256}`,
      item,
    ]),
  );
  if (components.size !== value.coverage.components.length) fail("duplicate coverage component");
  // Every compiled asset belongs to at most one component, named once.
  const assets = new Set<string>();
  for (const covered of value.coverage.components) {
    const ids = componentSubjectsV1(covered).map((item) => item.assetId);
    if (ids.some((id, index) => index > 0 && (ids[index - 1] as string) > id))
      fail("coverage subjects out of order");
    for (const id of ids) {
      if (assets.has(id)) fail("coverage asset bound twice");
      assets.add(id);
    }
  }
  if (reports.size !== value.report.components.length || reports.size !== components.size)
    fail("report coverage cardinality mismatch");
  const seen = new Set<string>();
  for (const observation of value.observations) {
    if (seen.has(observation.componentId)) fail("duplicate component observation");
    seen.add(observation.componentId);
    const covered = components.get(observation.componentId);
    const report = reports.get(observation.componentId);
    if (covered === undefined) fail("component observation has no coverage");
    if (report === undefined) fail("component observation has no report");
    if (observation.reportComponentDigest !== packagedReportComponentDigestV1(report))
      fail("report component digest mismatch");
    if (
      covered !== undefined &&
      report !== undefined &&
      (new Set(report.paths).size !== report.paths.length ||
        new Set(covered.paths).size !== covered.paths.length ||
        canonicalJsonV1([...report.paths].sort()) !== canonicalJsonV1([...covered.paths].sort()))
    )
      fail("report coverage paths mismatch");
    if (covered?.componentTreeSha256 !== observation.componentTreeSha256)
      fail("component observation tree mismatch");
    const published = publications.get(
      `${observation.requestSha256}\u0000${observation.publicationSha256}\u0000${observation.receiptSha256}`,
    );
    if (published === undefined) fail("component observation publication mismatch");
    const signedAt = Date.parse(observation.reportSignedAt);
    const expiresAt = Date.parse(observation.reportVerificationExpiresAt);
    const publishedAt = Date.parse(published?.publishedAt ?? "");
    if (signedAt > publishedAt) fail("report signed after publication");
    if (expiresAt <= signedAt) fail("report verification window");
    if (publishedAt >= expiresAt) fail("publication outside report verification window");
  }
  if (value.report.components.some((item) => !seen.has(item.id)))
    fail("report component lacks observation");
  if (
    value.publications.some(
      (item) => Date.parse(item.publishedAt) > Date.parse(value.verification.preparedAt),
    )
  )
    fail("collection intake predates publication");
}

/** Reads the sealed records: canonical bytes, matching seal, one record per catalog id. */
export function parsePackagedScannerCollectionEvidenceV1(
  value: unknown,
): PackagedScannerCollectionEvidenceV1[] {
  const catalogIds = new Set<string>();
  return list(value, "packaged collection evidence records").map((item, index) => {
    const label = `packaged collection evidence record ${String(index)}`;
    const sealed = strictKeys(item, ["bytes", "sha256"], label);
    const bytes = text(sealed.bytes, `${label} bytes`);
    if (Buffer.byteLength(bytes, "utf8") > 4 * 1024 * 1024)
      throw new TypeError(`${label} exceeds its byte budget`);
    if (text(sealed.sha256, `${label} seal`, QUALIFIED_SHA256) !== `sha256:${sha256HexV1(bytes)}`)
      throw new TypeError(`${label} seal mismatch`);
    const parsed = parseRecord(JSON.parse(bytes));
    if (canonicalJsonV1(parsed) !== bytes) throw new TypeError(`${label} must use canonical bytes`);
    if (catalogIds.has(parsed.catalog.id)) throw new TypeError("duplicate packaged collection");
    catalogIds.add(parsed.catalog.id);
    return parsed;
  });
}

function exactAsset(
  bundle: AuthoringCatalogBundleV1,
  subject: PackagedEvidenceSubjectV1,
  evidence: PackagedScannerCollectionEvidenceV1,
): boolean {
  const asset = bundle.assets[subject.assetId];
  const source = bundle.sources[subject.sourceId];
  const expected = evidence.catalog.source;
  return (
    asset !== undefined &&
    source !== undefined &&
    source.id === expected.id &&
    source.revision.id === expected.revisionId &&
    source.revision.contentDigest === expected.contentDigest &&
    source.inputFormat === expected.inputFormat &&
    source.upstreamOrigin.kind === expected.upstreamOrigin.kind &&
    source.upstreamOrigin.locator === expected.upstreamOrigin.locator &&
    source.id === subject.sourceId &&
    asset.id === subject.assetId &&
    asset.sourceId === subject.sourceId &&
    asset.sourceRevisionId === subject.sourceRevisionId &&
    asset.contentDigest === subject.contentDigest &&
    asset.derivation === (expected.upstreamOrigin.kind === "aih" ? "built-in" : "upstream")
  );
}

/** Pure display projection of exact sealed report facts onto the matching assets. */
export function projectScannerCollectionEvidenceV1(
  bundle: AuthoringCatalogBundleV1,
  records: readonly PackagedScannerCollectionEvidenceV1[],
): Record<string, EvidenceSummaryV1> {
  const result: Record<string, EvidenceSummaryV1> = {};
  for (const evidence of records) {
    const recordDigest = `sha256:${canonicalStrictJsonSha256V1(evidence)}`;
    const reports = new Map(evidence.report.components.map((item) => [item.id, item]));
    const observations = new Map(evidence.observations.map((item) => [item.componentId, item]));
    for (const covered of evidence.coverage.components) {
      const report = reports.get(covered.componentId);
      const observation = observations.get(covered.componentId);
      if (report === undefined || observation === undefined) continue;
      const published = evidence.publications.find(
        (item) =>
          item.requestSha256 === observation.requestSha256 &&
          item.publicationSha256 === observation.publicationSha256 &&
          item.receiptSha256 === observation.receiptSha256,
      );
      if (published === undefined) continue;
      // Each compiled asset the component's scan covers gets that scan's evidence.
      for (const subject of componentSubjectsV1(covered)) {
        if (!exactAsset(bundle, subject, evidence)) continue;
        const id = `evidence:${subject.assetId}`;
        result[id] = {
          id,
          projectionVersion: "evidence-summary/v1",
          subjects: [subject],
          evidenceDigest: `sha256:${canonicalStrictJsonSha256V1({ record: recordDigest, component: covered, observation, ...("subject" in covered ? {} : { subject }) })}`,
          coveredPaths: [...covered.paths].sort(),
          verification: {
            state: "verified",
            verifiedAt: evidence.verification.preparedAt,
            validUntil: evidenceExpiryV1(observation.reportSignedAt),
            contextDigest: `sha256:${canonicalStrictJsonSha256V1({ record: recordDigest, publication: observation.publicationSha256, receipt: observation.receiptSha256 })}`,
          },
          scan: {
            outcome: report.verdict === "blocked" ? "failed" : "pass",
            coverage: "complete",
            analyzers: [...report.analyzers].sort((left, right) => {
              const leftKey = `${left.name}\u0000${left.version}`;
              const rightKey = `${right.name}\u0000${right.version}`;
              return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
            }),
            reportSignedAt: observation.reportSignedAt,
            reportVerificationExpiresAt: observation.reportVerificationExpiresAt,
            publishedAt: published.publishedAt,
          },
          qualification: { state: "unknown" },
          findings: report.findings
            .slice(0, 50)
            .map((finding) => `${finding.code}: ${finding.detail}`.slice(0, 1000)),
        } as EvidenceSummaryV1;
      }
    }
  }
  return result;
}
