// The Catalog's own reading of a Scanner publication and its outer attestation, for T4
// (tools/generate-source-assessment-rows.mjs).
//
// A consumer handoff (Scan's tools/emit-consumer-handoff.mjs) is a derived, unsigned file. The
// findings, notices and observations a row states therefore come from the publication's
// authenticated bytes, never from the handoff: reproduceConsumerHandoffV1 recomputes every
// value the handoff derives from the publication (its signed receipt, the request it binds and
// the SARIF and aih-native annexes the receipt binds by digest), exactly as Scan's projection
// does, so the caller can refuse a handoff that differs in any of them.
//
// verifyAttestationBundleOfflineV1 checks the publication's outer Sigstore attestation against
// the bundle itself, offline: the DSSE signature under the bundle's certificate key, the
// certificate's workflow identity (SAN and Fulcio extensions), the in-toto statement naming the
// publication digest and the publisher commit, and the transparency-log entry bound to that
// envelope with its Merkle inclusion proof up to the root hash the bundle carries. What it cannot
// check offline, and so remains trusted from Scan's own `gh attestation verify` run, is that the
// certificate chains to Sigstore's Fulcio root and that Rekor signed the checkpoint and the
// inclusion promise: both need Sigstore's trusted root, which gh fetches over the network (TUF).
import { createHash, verify, X509Certificate } from "node:crypto";

const fail = (message) => {
  throw new TypeError(`source-assessment-generator:${message}`);
};
const codeUnitCompare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const isRecord = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const object = (value, label) => {
  if (!isRecord(value)) fail(`${label}-object`);
  return value;
};
const array = (value, label) => {
  if (!Array.isArray(value)) fail(`${label}-array`);
  return value;
};
const text = (value, label, max = 2_048) => {
  if (typeof value !== "string" || value.length === 0 || value.length > max) fail(`${label}-text`);
  return value;
};
const exactKeys = (value, allowed, label) => {
  const actual = Object.keys(object(value, label)).sort(codeUnitCompare);
  const expected = [...allowed].sort(codeUnitCompare);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    fail(`${label}-fields`);
  return value;
};
export const canonical = (value) => {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) fail("canonical-value");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort(codeUnitCompare)
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const HEX_40 = /^[0-9a-f]{40}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
function jsonOf(bytes, label) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    fail(`${label}-json`);
  }
}
function base64Bytes(value, label, max = 128 * 1024 * 1024) {
  const encoded = text(value, label, max);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== encoded) fail(`${label}-base64`);
  return bytes;
}

// ---------------------------------------------------------------------------------------------
// The publication's authenticated parts.

/**
 * The request, receipt and annex bytes of a publication whose signed statement names
 * `predicate.requestSha256` and `predicate.receiptSha256`: the request and the receipt must hash
 * to those digests under Scan's domain digests, and every annex a receipt observation names must
 * be present once, with exactly the byte length and sha256 the receipt records for it.
 */
export function authenticatedPublicationV1(publication, predicate) {
  const request = object(publication.request, "publication-request");
  const receipt = object(publication.receipt, "publication-receipt");
  const { requestSha256: requestDigest, ...requestAuthoring } = request;
  if (
    requestDigest !== predicate.requestSha256 ||
    sha256(canonical({ domain: "aih.baseline-vet-request-v1", request: requestAuthoring })) !==
      predicate.requestSha256
  )
    fail("publication-request-digest");
  const { receiptSha256: receiptDigest, ...receiptAuthoring } = receipt;
  if (
    receiptDigest !== predicate.receiptSha256 ||
    sha256(canonical({ domain: "aih.baseline-vet-receipt-v1", receipt: receiptAuthoring })) !==
      predicate.receiptSha256
  )
    fail("publication-receipt-digest");
  if (receipt.requestSha256 !== request.requestSha256 || canonical(receipt.source) !== canonical(request.source))
    fail("publication-receipt-request");
  const present = new Map();
  for (const entry of array(publication.annexes, "publication-annexes")) {
    const annex = object(entry, "publication-annex");
    const path = text(annex.path, "publication-annex-path", 300);
    if (present.has(path)) fail("publication-annex-duplicate");
    present.set(path, annex.bytesBase64);
  }
  const annexes = new Map();
  for (const entry of array(receipt.observations, "receipt-observations")) {
    const observation = object(entry, "receipt-observation");
    const annex = object(observation.annex, "receipt-observation-annex");
    const path = text(annex.path, "receipt-annex-path", 300);
    if (!present.has(path) || annexes.has(path)) fail(`publication-annex-missing ${path}`);
    const bytes = base64Bytes(present.get(path), "publication-annex-bytes");
    if (bytes.length !== annex.byteLength || sha256(bytes) !== annex.sha256)
      fail(`publication-annex-digest ${path}`);
    annexes.set(path, bytes);
  }
  return { request, receipt, annexes };
}

// ---------------------------------------------------------------------------------------------
// Scan's source-relative SARIF locations (aih-scan src/baseline/sarif-source-relative-v1.ts),
// for the locations the consumer projection reads. Published annexes are already source-relative
// (the annex digest is taken over the rewritten document), so this is the identity for them;
// the same rules still relate an older absolute /aih/source or /scan spelling.

const ANALYZER_SOURCE_ROOTS = ["/aih/source", "/scan"];
const SOURCE_ROOT_BASE_ID = "%SRCROOT%";
const uriFail = (message) => fail(`scanner-annex-location ${message}`);

function safeRelativePath(path) {
  for (let index = 0; index < path.length; index += 1) {
    const unit = path.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = path.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return undefined;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return undefined;
  }
  if (
    path.normalize("NFC") !== path ||
    !path ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    /[\\%?#:]/.test(path) ||
    [...path].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    }) ||
    path.endsWith("/") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    return undefined;
  return path;
}
function decodedPath(uri) {
  if (!/^file:/i.test(uri)) return uri;
  if (!/^file:\/\/\//i.test(uri) || uri.includes("?") || uri.includes("#"))
    uriFail(`${JSON.stringify(uri)} is a file URL with an authority, query or fragment`);
  let path;
  try {
    path = decodeURIComponent(uri.slice("file://".length));
  } catch {
    uriFail(`${JSON.stringify(uri)} cannot be percent-decoded`);
  }
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}
const isAbsoluteLocation = (uri) => {
  const path = decodedPath(uri).replaceAll("\\", "/");
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
};
function relativeTo(uri, allowDirectory = false) {
  if (typeof uri !== "string" || uri.length === 0) uriFail("an empty artifact URI");
  if (uri.includes("\0")) uriFail("an artifact URI holds a NUL character");
  if (allowDirectory && uri.endsWith("/")) {
    const trimmed = uri.slice(0, -1);
    if (trimmed === "" || trimmed === "." || trimmed.endsWith("/") || /^file:\/*$/i.test(trimmed))
      uriFail(`${JSON.stringify(uri)} does not name a directory under the source root`);
    return `${relativeTo(trimmed)}/`;
  }
  const path = decodedPath(uri).replaceAll("\\", "/");
  let relative;
  if (path.startsWith("/") || /^[A-Za-z]:\//.test(path)) {
    const root = ANALYZER_SOURCE_ROOTS.find((spelling) => path === spelling || path.startsWith(`${spelling}/`));
    if (root === undefined) uriFail(`${JSON.stringify(uri)} is outside the declared source root`);
    relative = path.slice(root.length).replace(/^\/+/, "");
    if (relative === "") uriFail(`${JSON.stringify(uri)} names the source root itself`);
  } else relative = path.startsWith("./") ? path.slice(2) : path;
  const safe = safeRelativePath(relative);
  if (safe === undefined) uriFail(`${JSON.stringify(uri)} does not resolve to a safe path`);
  return safe;
}
const joined = (base, uri) => {
  const reference = uri.startsWith("./") ? uri.slice(2) : uri;
  return "absolute" in base ? `${base.absolute}${reference}` : `${base.underRoot}${reference}`;
};
function baseResolver(declared) {
  if (declared !== undefined && !isRecord(declared)) uriFail("originalUriBaseIds is not an object");
  const resolved = new Map();
  const resolveBase = (id, seen) => {
    const known = resolved.get(id);
    if (known !== undefined) return known;
    if (seen.includes(id)) uriFail(`base ${id} refers back to itself`);
    const entry = declared !== undefined && Object.hasOwn(declared, id) ? declared[id] : undefined;
    let base;
    if (entry === undefined) {
      if (id !== SOURCE_ROOT_BASE_ID) uriFail(`base ${id} is not declared in originalUriBaseIds`);
      base = { underRoot: "" };
    } else {
      if (!isRecord(entry) || typeof entry.uri !== "string" || !entry.uri.endsWith("/"))
        uriFail(`base ${id} has no directory URI`);
      const uri = entry.uri;
      if (uri.includes("\0")) uriFail(`base ${id} holds a NUL character`);
      if (/^[A-Za-z][A-Za-z0-9+.-]+:/.test(uri) && !/^file:/i.test(uri))
        uriFail(`base ${id} is not a file location`);
      if (isAbsoluteLocation(uri))
        base = { absolute: /^file:/i.test(uri) ? uri : uri.replaceAll("\\", "/") };
      else if (entry.uriBaseId === undefined) uriFail(`base ${id} is relative and names no base`);
      else if (typeof entry.uriBaseId !== "string") uriFail(`base ${id} names a malformed base`);
      else {
        const parent = resolveBase(entry.uriBaseId, [...seen, id]);
        base =
          "absolute" in parent
            ? { absolute: joined(parent, uri) }
            : { underRoot: joined(parent, uri) };
      }
    }
    resolved.set(id, base);
    return base;
  };
  return (id) => resolveBase(id, []);
}

// ---------------------------------------------------------------------------------------------
// Scan's consumer projection (aih-scan tools/emit-consumer-handoff.mjs: observationRows,
// findingSummary, coverageSummary, the component artifacts and the handoff's derived fields).

const NATIVE_MEDIA_TYPE = "application/vnd.aih.baseline-native+json";
const COMPLETION_EVIDENCE_ABSENT = "completion-evidence-absent";
const SARIF_LEVELS = ["none", "note", "warning", "error"];
const SARIF_KINDS = ["pass", "open", "informational", "notApplicable", "review", "fail"];
const NOTIFICATION_KINDS = ["toolExecutionNotifications", "toolConfigurationNotifications"];
const CONTENT_CLASSES = [
  "exact compiler/source-file closure for assessment only",
  "exact direct plugin skill/source files for assessment only",
];
const SUBJECT = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const annexFail = (message) => fail(`scanner-annex ${message}`);

function positive(value, label) {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 1) annexFail(label);
  return value;
}
function projectedLocations(value, label, base, directory) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) annexFail(`${label} locations`);
  return value.map((entry) => {
    if (!isRecord(entry) || !isRecord(entry.physicalLocation)) annexFail(`${label} physicalLocation`);
    const physical = entry.physicalLocation;
    if (!isRecord(physical.artifactLocation)) annexFail(`${label} artifactLocation`);
    const artifact = physical.artifactLocation;
    if (physical.region !== undefined && !isRecord(physical.region)) annexFail(`${label} region`);
    const region = physical.region ?? {};
    const baseId = artifact.uriBaseId;
    if (baseId !== undefined && typeof baseId !== "string") uriFail("an artifact uriBaseId is not a string");
    if (typeof artifact.uri !== "string") uriFail("an artifact URI is not a string");
    const target =
      baseId === undefined || isAbsoluteLocation(artifact.uri)
        ? artifact.uri
        : joined(base(baseId), artifact.uri);
    return {
      path: text(relativeTo(target, directory), `${label}-artifact-uri`, 4096),
      startLine: positive(region.startLine, `${label} startLine`),
      startColumn: positive(region.startColumn, `${label} startColumn`),
    };
  });
}
function messageText(value, label) {
  if (value === undefined) return null;
  if (!isRecord(value) || typeof value.text !== "string") annexFail(`${label} message without text`);
  return value.text;
}
function enumOrNull(value, allowed, label) {
  if (value === undefined) return null;
  if (!allowed.includes(value)) annexFail(label);
  return value;
}
function optionalRecord(value, label) {
  if (value === undefined) return null;
  if (!isRecord(value)) annexFail(label);
  return value;
}

/** Every finding and coverage notification of the publication, related to its components. */
function observationRows(receipt, annexes, components, sourceTreeSha256) {
  const within = (component, path) =>
    component.paths.some((root) => path === root || path.startsWith(`${root}/`));
  const owners = (locations) =>
    components
      .filter((component) => locations.some((location) => within(component, location.path)))
      .map((component) => component.id);
  const findings = [];
  const notifications = [];
  const analyzers = [];
  const completionEvidence = new Set();
  for (const observation of receipt.observations) {
    const analyzer = text(observation.analyzer, "receipt-analyzer", 200);
    const document = jsonOf(annexes.get(observation.annex.path), `annex ${analyzer}`);
    if (!isRecord(document)) annexFail(`${analyzer} annex root`);
    const row = {
      analyzer,
      analyzerVersion: observation.analyzerVersion,
      annex: { ...observation.annex },
      executionSuccessful: false,
      resultCount: 0,
      notificationCount: 0,
    };
    analyzers.push(row);
    if (observation.annex.mediaType === NATIVE_MEDIA_TYPE) {
      row.executionSuccessful =
        document.protocol === "BaselineNativeObservationV1" &&
        document.sourceTreeSha256 === sourceTreeSha256;
      if (row.executionSuccessful) completionEvidence.add(analyzer);
      continue;
    }
    if (!Array.isArray(document.runs) || document.runs.length === 0) annexFail(`${analyzer} SARIF runs`);
    let successful = true;
    document.runs.forEach((run, runIndex) => {
      const label = `${analyzer} run ${runIndex}`;
      if (!isRecord(run)) annexFail(`${analyzer} SARIF run`);
      const base = baseResolver(run.originalUriBaseIds);
      if (run.invocations !== undefined && !Array.isArray(run.invocations)) annexFail(`${label} invocations`);
      const invocations = run.invocations ?? [];
      if (invocations.length === 0) successful = false;
      for (const invocation of invocations) {
        if (!isRecord(invocation)) annexFail(`${label} invocation`);
        if (invocation.executionSuccessful !== true) successful = false;
        for (const kind of NOTIFICATION_KINDS) {
          if (invocation[kind] === undefined) continue;
          if (!Array.isArray(invocation[kind])) annexFail(`${label} ${kind}`);
          for (const notification of invocation[kind]) {
            if (!isRecord(notification)) annexFail(`${label} notification`);
            const locations = projectedLocations(notification.locations, `${label} notification`, base, true);
            const componentIds = owners(locations);
            notifications.push({
              analyzer,
              runIndex,
              kind,
              level: enumOrNull(notification.level, SARIF_LEVELS, `${label} notification level`),
              message: messageText(notification.message, `${label} notification`),
              descriptor: optionalRecord(notification.descriptor, `${label} notification descriptor`),
              properties: optionalRecord(notification.properties, `${label} notification properties`),
              locations,
              componentIds,
              unmapped: componentIds.length === 0,
            });
            row.notificationCount += 1;
          }
        }
      }
      if (run.results !== undefined && !Array.isArray(run.results)) annexFail(`${label} results`);
      for (const result of run.results ?? []) {
        if (!isRecord(result)) annexFail(`${label} result`);
        const locations = projectedLocations(result.locations, `${label} result`, base, false);
        const componentIds = owners(locations);
        if (result.ruleId !== undefined) text(result.ruleId, `${label} ruleId`, 512);
        findings.push({
          analyzer,
          runIndex,
          ruleId: result.ruleId ?? null,
          level: enumOrNull(result.level, SARIF_LEVELS, `${label} result level`),
          kind: enumOrNull(result.kind, SARIF_KINDS, `${label} result kind`),
          message: messageText(result.message, `${label} result`),
          locations,
          componentIds,
          unmapped: componentIds.length === 0,
        });
        row.resultCount += 1;
      }
    });
    row.executionSuccessful = successful;
  }
  return { findings, notifications, analyzers, completionEvidence };
}

function tally(rows, keyOf) {
  const counts = new Map();
  for (const row of rows) {
    const key = String(keyOf(row));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => codeUnitCompare(left, right)));
}
const findingSummary = (rows) => ({
  count: rows.length,
  byAnalyzer: tally(rows, (row) => row.analyzer),
  byLevel: tally(rows, (row) => row.level),
  byRule: tally(rows, (row) => row.ruleId),
});
function reasonCode(row) {
  const code = row.properties?.reasonCode;
  if (code !== undefined && typeof code !== "string") annexFail("notification reasonCode");
  return code ?? null;
}
const coverageSummary = (rows) => ({
  count: rows.length,
  byAnalyzer: tally(rows, (row) => row.analyzer),
  byLevel: tally(rows, (row) => row.level),
  byMessage: tally(rows, (row) => row.message),
  byReasonCode: tally(rows, reasonCode),
});
export function componentArtifactNameV1(scannerComponentId) {
  const name = `${scannerComponentId.replace(/[^a-z0-9-]/g, "-")}.json`;
  if (!/^[a-z0-9-]+\.json$/.test(name)) fail(`component-artifact-name ${scannerComponentId}`);
  return name;
}

/**
 * The Catalog's reviewed mapping as the handoff states it (the components and exclusions it
 * chose; they are the consumer's own selection, not an observation), checked the way Scan's
 * mapping input is: every requested Scanner component is covered exactly once.
 */
function mappingSelection(value, request, components) {
  const mapping = object(value, "mapping");
  if (!CONTENT_CLASSES.includes(mapping.contentClass)) fail("mapping-content-class");
  const requested = new Map(components.map((component) => [component.id, component]));
  const covered = new Set();
  const cover = (id) => {
    if (typeof id !== "string" || !requested.has(id) || covered.has(id))
      fail(`mapping-coverage ${String(id)}`);
    covered.add(id);
    return requested.get(id);
  };
  const assets = new Set();
  const selected = array(mapping.components, "mapping-components").map((entry) => {
    const item = object(entry, "mapping-component");
    const component = cover(item.scannerComponentId);
    const prefix = `${request.source.id}/${component.content}:`;
    const assetId = text(item.catalogAssetId, "catalog-asset-id", 300);
    if (!assetId.startsWith(prefix) || !SUBJECT.test(assetId.slice(prefix.length)) || assets.has(assetId))
      fail(`mapping-catalog-asset-id ${assetId}`);
    assets.add(assetId);
    return { component, catalogAssetId: assetId };
  });
  if (selected.length === 0) fail("partial-component-mapping");
  const exclusions = array(mapping.exclusions, "mapping-exclusions").map((entry) => {
    const item = exactKeys(entry, ["reason", "scannerComponentId"], "mapping-exclusion");
    cover(item.scannerComponentId);
    return { scannerComponentId: item.scannerComponentId, reason: text(item.reason, "mapping-exclusion-reason", 1024) };
  });
  if (covered.size !== requested.size) fail("mapping-coverage partial");
  return { contentClass: mapping.contentClass, components: selected, exclusions };
}

/**
 * Every value a consumer handoff derives from its publication, recomputed from the publication's
 * authenticated parts ({@link authenticatedPublicationV1}): `fields` are the handoff's derived
 * top-level fields, `artifacts` the exact canonical bytes of each component artifact, by Scanner
 * component id. `publisherCommit` is the attested publisher commit; `mapping` is the handoff's
 * mapping, read only for the consumer's own selection.
 */
export function reproduceConsumerHandoffV1({ publication, predicate, publicationSha256, publisherCommit, mapping }) {
  const { request, receipt, annexes } = authenticatedPublicationV1(publication, predicate);
  const source = object(request.source, "request-source");
  const components = array(request.components, "request-components").map((entry) => {
    const component = object(entry, "request-component");
    text(component.id, "scanner-component-id", 300);
    text(component.content, "component-content", 40);
    array(component.paths, "component-paths").forEach((path) => text(path, "component-path", 1_024));
    array(component.analyzers, "component-analyzers").forEach((name) => text(name, "component-analyzer", 200));
    return component;
  });
  const selection = mappingSelection(mapping, request, components);
  const rows = observationRows(receipt, annexes, components, source.treeSha256);
  const globalRows = rows.notifications.filter((row) => row.locations.length === 0);
  const locationRows = rows.notifications.filter((row) => row.locations.length > 0);
  const executionByAnalyzer = new Map(rows.analyzers.map((row) => [row.analyzer, row]));
  const requestedAnalyzers = [...new Set(components.flatMap((component) => component.analyzers))];
  const missingAnalyzers = requestedAnalyzers
    .filter((analyzer) => !executionByAnalyzer.has(analyzer))
    .sort(codeUnitCompare);
  const failedAnalyzers = rows.analyzers
    .filter((row) => !row.executionSuccessful)
    .map((row) => row.analyzer)
    .sort(codeUnitCompare);
  const completionEvidenceAbsent = requestedAnalyzers
    .filter((analyzer) => !rows.completionEvidence.has(analyzer))
    .sort(codeUnitCompare);
  const coverageComplete = rows.notifications.length === 0 && completionEvidenceAbsent.length === 0;
  const common = {
    authority: "none",
    riskDecision: "consumer_required",
    publisherCommit,
    source,
    requestSha256: request.requestSha256,
    receiptSha256: receipt.receiptSha256,
    publicationSha256,
  };
  const artifacts = new Map();
  const summaries = [];
  const mappedFindings = [];
  const names = new Set();
  for (const { component, catalogAssetId } of selection.components) {
    const findings = rows.findings.filter((row) => row.componentIds.includes(component.id));
    const locationBound = locationRows.filter((row) => row.componentIds.includes(component.id));
    const coverageGaps = component.analyzers
      .filter((analyzer) => !rows.completionEvidence.has(analyzer))
      .map((analyzer) => ({ analyzer, reason: COMPLETION_EVIDENCE_ABSENT }));
    const componentCoverageComplete =
      locationBound.length === 0 && globalRows.length === 0 && coverageGaps.length === 0;
    const notified = `${locationBound.length} location-bound and ${globalRows.length} global Scanner coverage notifications remain unresolved`;
    const artifact = {
      protocol: "ScannerComponentObservationHandoffV1",
      ...common,
      outcome: "observed",
      scannerComponentId: component.id,
      catalogAssetId,
      content: component.content,
      paths: component.paths,
      treeSha256: component.treeSha256,
      requestedAnalyzers: component.analyzers,
      analyzerExecution: component.analyzers.flatMap((analyzer) => {
        const row = executionByAnalyzer.get(analyzer);
        return row === undefined ? [] : [row];
      }),
      findings,
      findingSummary: findingSummary(findings),
      locationBoundCoverageNotifications: locationBound,
      locationBoundCoverageSummary: coverageSummary(locationBound),
      globalCoverageNotifications: globalRows,
      globalCoverageSummary: coverageSummary(globalRows),
      coverageComplete: componentCoverageComplete,
      coverageGaps,
      coverageDisposition: componentCoverageComplete
        ? "Every requested analyzer carries subject-bound completion evidence and the Scanner reported no coverage notifications for this component; Scanner authority none."
        : coverageGaps.length === 0
          ? `${notified}; Scanner authority none.`
          : `${notified}, and ${coverageGaps.length} requested analyzers (${coverageGaps.map((gap) => gap.analyzer).join(", ")}) carry no subject-bound completion evidence; Scanner authority none.`,
    };
    const name = componentArtifactNameV1(component.id);
    if (names.has(name)) fail(`component-artifact-name-collision ${name}`);
    names.add(name);
    const bytes = Buffer.from(canonical(artifact), "utf8");
    artifacts.set(component.id, { name, bytes });
    mappedFindings.push(...findings);
    summaries.push({
      scannerComponentId: component.id,
      catalogAssetId,
      content: component.content,
      paths: component.paths,
      treeSha256: component.treeSha256,
      requestedAnalyzers: component.analyzers,
      findings: artifact.findingSummary,
      locationBoundCoverage: artifact.locationBoundCoverageSummary,
      globalCoverage: artifact.globalCoverageSummary,
      observationArtifact: { path: `components/${name}`, byteLength: bytes.length, sha256: sha256(bytes) },
    });
  }
  const unmappedFindings = rows.findings.filter((row) => row.unmapped);
  const gaps =
    !coverageComplete || unmappedFindings.length > 0 || missingAnalyzers.length > 0 || failedAnalyzers.length > 0;
  const claims = object(predicate.claims, "publication-claims");
  const fields = {
    protocol: "ScannerPublicationConsumerHandoffV1",
    ...common,
    outcome: gaps ? "observed_with_gaps" : "observed",
    sourceArchive: {
      repository: `${source.owner}/${source.repository}`,
      pinnedCommit: source.pinnedCommit,
      treeSha256: source.treeSha256,
      basis: "The signed request source of the verified publication; the Scanner hashed this exact tree.",
    },
    envelope: {
      authority: "none",
      signer: predicate.signer,
      claims: { signedAt: claims.signedAt, expiresAt: claims.expiresAt },
    },
    analyzers: rows.analyzers,
    analyzerGaps: {
      missingAnalyzers,
      failedAnalyzers,
      errorNotificationCount: rows.notifications.filter((row) => row.level === "error").length,
      coverageWarningCount: rows.notifications.filter((row) => row.level === "warning").length,
      completionEvidenceAbsent,
      coverageComplete,
    },
    findings: {
      mappedToDeclaredClosures: findingSummary(mappedFindings),
      repository: findingSummary(rows.findings),
      unmapped: findingSummary(unmappedFindings),
    },
    coverageNotifications: {
      global: coverageSummary(globalRows),
      locationBound: coverageSummary(locationRows),
      unmappedLocationBound: coverageSummary(locationRows.filter((row) => row.unmapped)),
    },
    mapping: {
      sourceId: source.id,
      requestSha256: request.requestSha256,
      sourceTreeSha256: source.treeSha256,
      contentClass: selection.contentClass,
      runtimeCapabilityClaim: [],
      exclusions: selection.exclusions,
      components: selection.components.map(({ component, catalogAssetId }) => ({
        scannerComponentId: component.id,
        catalogAssetId,
        paths: component.paths,
        treeSha256: component.treeSha256,
        analyzers: component.analyzers,
      })),
    },
    components: summaries,
    rawReports: receipt.observations.map((observation, index) => ({
      analyzer: observation.analyzer,
      analyzerVersion: observation.analyzerVersion,
      ...observation.annex,
      locator: `publication.json#/annexes/${index}`,
    })),
  };
  return { fields, artifacts };
}

// ---------------------------------------------------------------------------------------------
// The outer attestation, offline.

export const SCANNER_PUBLICATION_REPOSITORY = "samartomar/aih-scan";
const WORKFLOW_PATH = ".github/workflows/baseline-publication.yml";
const SOURCE_REF = "refs/heads/main";
const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const PROVENANCE_PREDICATE = "https://slsa.dev/provenance/v1";
const IN_TOTO_STATEMENT = "https://in-toto.io/Statement/v1";
const BUNDLE_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json";
const REKOR = "rekor.sigstore.dev";
// Fulcio certificate extensions (github.com/sigstore/fulcio docs/oid-info.md), 1.3.6.1.4.1.57264.1.N.
const FULCIO = {
  workflowName: 4, // deprecated v1 extension: the raw workflow name, not DER-wrapped
  issuer: 8,
  buildSignerURI: 9,
  buildSignerDigest: 10,
  runnerEnvironment: 11,
  sourceRepositoryURI: 12,
  sourceRepositoryDigest: 13,
  sourceRepositoryRef: 14,
  buildTrigger: 20,
  runInvocationURI: 21,
};
const FULCIO_PREFIX = Buffer.from("2b0601040183bf3001", "hex");
const attestationFail = (message) => fail(`attestation ${message}`);

function derNode(buffer, offset) {
  if (offset + 2 > buffer.length) attestationFail("certificate-der");
  const tag = buffer[offset];
  let length = buffer[offset + 1];
  let start = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4 || start + count > buffer.length) attestationFail("certificate-der");
    length = 0;
    for (let index = 0; index < count; index += 1) length = length * 256 + buffer[start + index];
    start += count;
  }
  if (start + length > buffer.length) attestationFail("certificate-der");
  return { tag, start, end: start + length };
}
function derChildren(buffer, node) {
  const children = [];
  for (let offset = node.start; offset < node.end; ) {
    const child = derNode(buffer, offset);
    children.push(child);
    offset = child.end;
  }
  return children;
}
/** The Fulcio extensions of a DER certificate, by the last OID arc; each at most once. */
function fulcioExtensions(der) {
  const certificate = derNode(der, 0);
  const [tbs] = derChildren(der, certificate);
  if (tbs === undefined) attestationFail("certificate-der");
  const holder = derChildren(der, tbs).find((node) => node.tag === 0xa3);
  if (holder === undefined) attestationFail("certificate-extensions");
  const [list] = derChildren(der, holder);
  const values = new Map();
  for (const extension of derChildren(der, list)) {
    const parts = derChildren(der, extension);
    const oid = der.subarray(parts[0].start, parts[0].end);
    const value = parts.at(-1);
    if (parts[0].tag !== 0x06 || value.tag !== 0x04) attestationFail("certificate-extension");
    if (oid.length !== FULCIO_PREFIX.length + 1 || !oid.subarray(0, FULCIO_PREFIX.length).equals(FULCIO_PREFIX))
      continue;
    const arc = oid[FULCIO_PREFIX.length];
    if (values.has(arc)) attestationFail("certificate-extension-repeated");
    values.set(arc, der.subarray(value.start, value.end));
  }
  const utf8 = (bytes, label) => {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      attestationFail(`certificate ${label}`);
    }
  };
  const read = (label) => {
    const bytes = values.get(FULCIO[label]);
    if (bytes === undefined) attestationFail(`certificate ${label} missing`);
    if (label === "workflowName") return utf8(bytes, label);
    const inner = derNode(bytes, 0);
    if (inner.tag !== 0x0c || inner.end !== bytes.length) attestationFail(`certificate ${label}`);
    return utf8(bytes.subarray(inner.start, inner.end), label);
  };
  return Object.fromEntries(Object.keys(FULCIO).map((label) => [label, read(label)]));
}

/** RFC 9162 §2.1.3.2: the inclusion proof of `leaf` at `index` in a tree of `size` leaves. */
function merkleRoot(index, size, leaf, proof) {
  let fn = index;
  let sn = size - 1n;
  if (fn > sn) attestationFail("tlog-inclusion-proof");
  let hash = leaf;
  for (const sibling of proof) {
    if (sn === 0n) attestationFail("tlog-inclusion-proof");
    if ((fn & 1n) === 1n || fn === sn) {
      hash = createHash("sha256").update(Buffer.from([1])).update(sibling).update(hash).digest();
      if ((fn & 1n) === 0n) while ((fn & 1n) === 0n && fn !== 0n) {
        fn >>= 1n;
        sn >>= 1n;
      }
    } else hash = createHash("sha256").update(Buffer.from([1])).update(hash).update(sibling).digest();
    fn >>= 1n;
    sn >>= 1n;
  }
  if (sn !== 0n) attestationFail("tlog-inclusion-proof");
  return hash;
}
const decimal = (value, label) => {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,19})$/.test(value)) attestationFail(label);
  return BigInt(value);
};

/**
 * The facts of one publication's outer attestation, from the Sigstore bundle alone (see the file
 * header for what this proves offline and what stays trusted). `claims` is the publication's
 * signed observation window, which the log entry must fall inside. Returns Scan's handoff
 * attestation facts, with each log entry's integrated time, and the attested run.
 */
export function verifyAttestationBundleOfflineV1({ bundleBytes, publicationSha256, publisherCommit, claims }) {
  const lines = new TextDecoder("utf-8", { fatal: true })
    .decode(bundleBytes)
    .replace(/\r?\n$/, "")
    .split(/\r?\n/);
  if (lines.length !== 1) attestationFail("bundle-count");
  const bundle = exactKeys(jsonOf(Buffer.from(lines[0], "utf8"), "attestation-bundle"), ["dsseEnvelope", "mediaType", "verificationMaterial"], "attestation-bundle");
  if (bundle.mediaType !== BUNDLE_MEDIA_TYPE) attestationFail("bundle-media-type");
  const envelope = exactKeys(bundle.dsseEnvelope, ["payload", "payloadType", "signatures"], "attestation-envelope");
  const payloadType = text(envelope.payloadType, "attestation-payload-type", 200);
  if (payloadType !== "application/vnd.in-toto+json") attestationFail("payload-type");
  const payload = base64Bytes(envelope.payload, "attestation-payload");
  const signatures = array(envelope.signatures, "attestation-signatures");
  if (signatures.length !== 1) attestationFail("signature-count");
  const signatureText = text(object(signatures[0], "attestation-signature").sig, "attestation-signature", 1_024);
  const material = object(bundle.verificationMaterial, "attestation-material");
  const der = base64Bytes(object(material.certificate, "attestation-certificate").rawBytes, "attestation-certificate", 64 * 1024);
  let certificate;
  try {
    certificate = new X509Certificate(der);
  } catch {
    attestationFail("certificate");
  }
  const pae = Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(payloadType)} ${payloadType} ${payload.length} `),
    payload,
  ]);
  let signed = false;
  try {
    signed = verify("sha256", pae, certificate.publicKey, base64Bytes(signatureText, "attestation-signature"));
  } catch {
    attestationFail("signature");
  }
  if (!signed) attestationFail("signature-invalid");

  // The certificate's workflow identity.
  const repositoryUri = `https://github.com/${SCANNER_PUBLICATION_REPOSITORY}`;
  const workflowUri = `${repositoryUri}/${WORKFLOW_PATH}@${SOURCE_REF}`;
  const identity = fulcioExtensions(der);
  const invocation = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/actions\/runs\/([1-9]\d{0,19})\/attempts\/([1-9]\d{0,3})$/.exec(
    identity.runInvocationURI,
  );
  if (
    certificate.subjectAltName !== `URI:${workflowUri}` ||
    identity.issuer !== OIDC_ISSUER ||
    identity.buildSignerURI !== workflowUri ||
    identity.buildSignerDigest !== publisherCommit ||
    identity.runnerEnvironment !== "github-hosted" ||
    identity.sourceRepositoryURI !== repositoryUri ||
    identity.sourceRepositoryDigest !== publisherCommit ||
    identity.sourceRepositoryRef !== SOURCE_REF ||
    invocation === null ||
    invocation[1] !== SCANNER_PUBLICATION_REPOSITORY
  )
    attestationFail("certificate-identity");

  // The in-toto statement: the publication among its subjects, built from the publisher commit.
  const statement = exactKeys(jsonOf(payload, "attestation-statement"), ["_type", "predicate", "predicateType", "subject"], "attestation-statement");
  if (statement._type !== IN_TOTO_STATEMENT || statement.predicateType !== PROVENANCE_PREDICATE)
    attestationFail("statement-type");
  const subjects = array(statement.subject, "attestation-subjects").map((entry) => {
    const subject = exactKeys(entry, ["digest", "name"], "attestation-subject");
    const digest = exactKeys(subject.digest, ["sha256"], "attestation-subject-digest");
    if (subject.name !== "publication.json" || typeof digest.sha256 !== "string" || !HEX_64.test(digest.sha256))
      attestationFail("subject");
    return digest.sha256;
  });
  if (subjects.length === 0 || subjects.length > 1000 || new Set(subjects).size !== subjects.length)
    attestationFail("subject-count");
  if (!subjects.includes(publicationSha256)) attestationFail("subject-does-not-cover-publication");
  const provenance = object(statement.predicate, "attestation-predicate");
  const build = object(provenance.buildDefinition, "attestation-build");
  const workflow = object(object(build.externalParameters, "attestation-parameters").workflow, "attestation-workflow");
  const dependencies = array(build.resolvedDependencies, "attestation-dependencies");
  const runDetails = object(provenance.runDetails, "attestation-run");
  if (
    workflow.repository !== repositoryUri ||
    workflow.path !== WORKFLOW_PATH ||
    workflow.ref !== SOURCE_REF ||
    dependencies.length !== 1 ||
    object(dependencies[0], "attestation-dependency").uri !== `git+${repositoryUri}@${SOURCE_REF}` ||
    object(dependencies[0].digest, "attestation-dependency-digest").gitCommit !== publisherCommit ||
    object(object(build.internalParameters, "attestation-internal").github, "attestation-github").runner_environment !==
      "github-hosted" ||
    object(runDetails.builder, "attestation-builder").id !== workflowUri ||
    object(runDetails.metadata, "attestation-metadata").invocationId !== identity.runInvocationURI
  )
    attestationFail("statement-provenance");

  // The transparency-log entries: each binds this envelope and certificate, and its inclusion
  // proof reaches the root hash its checkpoint names.
  const signedAt = Date.parse(text(claims.signedAt, "publication-signed-at", 80));
  const expiresAt = Date.parse(text(claims.expiresAt, "publication-expires-at", 80));
  const certificateFrom = Date.parse(certificate.validFrom);
  const certificateTo = Date.parse(certificate.validTo);
  const pem = `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
  const timestamps = material.timestampVerificationData;
  if (timestamps !== undefined) {
    const data = object(timestamps, "attestation-timestamps");
    if (Object.keys(data).some((key) => key !== "rfc3161Timestamps") || (data.rfc3161Timestamps ?? []).length !== 0)
      attestationFail("timestamp-authority-unsupported-offline");
  }
  const entries = array(material.tlogEntries, "attestation-tlog-entries");
  if (entries.length === 0 || entries.length > 16) attestationFail("tlog-count");
  const integratedTimes = entries.map((value) => {
    const entry = object(value, "attestation-tlog-entry");
    const kind = object(entry.kindVersion, "attestation-tlog-kind");
    if (kind.kind !== "dsse" || kind.version !== "0.0.1") attestationFail("tlog-kind");
    const bodyBytes = base64Bytes(entry.canonicalizedBody, "attestation-tlog-body");
    const body = object(jsonOf(bodyBytes, "attestation-tlog-body"), "attestation-tlog-body");
    const spec = object(body.spec, "attestation-tlog-spec");
    const bodySignatures = array(spec.signatures, "attestation-tlog-signatures");
    const payloadHash = object(spec.payloadHash, "attestation-tlog-payload-hash");
    if (
      body.apiVersion !== "0.0.1" ||
      body.kind !== "dsse" ||
      payloadHash.algorithm !== "sha256" ||
      payloadHash.value !== sha256(payload) ||
      bodySignatures.length !== 1 ||
      object(bodySignatures[0], "attestation-tlog-signature").signature !== signatureText ||
      bodySignatures[0].verifier !== Buffer.from(pem, "utf8").toString("base64")
    )
      attestationFail("tlog-body");
    const proof = object(entry.inclusionProof, "attestation-tlog-proof");
    const rootHash = base64Bytes(proof.rootHash, "attestation-tlog-root");
    const treeSize = decimal(proof.treeSize, "tlog-tree-size");
    const checkpoint = text(object(proof.checkpoint, "attestation-tlog-checkpoint").envelope, "attestation-tlog-checkpoint", 4_096).split("\n");
    if (
      !checkpoint[0]?.startsWith(`${REKOR} - `) ||
      checkpoint[1] !== String(treeSize) ||
      checkpoint[2] !== proof.rootHash
    )
      attestationFail("tlog-checkpoint");
    const leaf = createHash("sha256").update(Buffer.from([0])).update(bodyBytes).digest();
    const hashes = array(proof.hashes, "attestation-tlog-hashes").map((hash) => base64Bytes(hash, "attestation-tlog-hash"));
    if (!merkleRoot(decimal(proof.logIndex, "tlog-log-index"), treeSize, leaf, hashes).equals(rootHash))
      attestationFail("tlog-inclusion-proof");
    const integrated = Number(decimal(entry.integratedTime, "tlog-integrated-time"));
    const moment = integrated * 1000;
    if (moment < certificateFrom || moment > certificateTo) attestationFail("tlog-outside-certificate-validity");
    if (!(moment >= signedAt && moment < expiresAt)) attestationFail("tlog-outside-observation-window");
    return integrated;
  });
  return {
    facts: {
      subject: { name: "publication.json", digest: { sha256: publicationSha256 } },
      subjectCount: subjects.length,
      predicateType: PROVENANCE_PREDICATE,
      issuer: OIDC_ISSUER,
      buildSignerURI: workflowUri,
      buildSignerDigest: publisherCommit,
      sourceRepositoryURI: repositoryUri,
      sourceRepositoryDigest: publisherCommit,
      sourceRepositoryRef: SOURCE_REF,
      runnerEnvironment: "github-hosted",
      runInvocationURI: identity.runInvocationURI,
      verifiedTimestampCount: integratedTimes.length,
    },
    integratedTimes,
    run: {
      runId: Number(invocation[2]),
      attempt: Number(invocation[3]),
      event: identity.buildTrigger,
      workflowName: identity.workflowName,
      url: `${repositoryUri}/actions/runs/${invocation[2]}`,
      workflowPath: WORKFLOW_PATH,
    },
    repositoryUri,
  };
}
