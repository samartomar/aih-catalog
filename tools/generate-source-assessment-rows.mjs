import { createHash, createPublicKey, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, parse, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  reproduceConsumerHandoffV1,
  verifyAttestationBundleOfflineV1,
} from "./scanner-consumer-handoff-v1.mjs";

const HANDOFF_KEYS = [
  "analyzerGaps",
  "analyzers",
  "api",
  "attestation",
  "authority",
  "components",
  "coverageNotifications",
  "discoverySha256",
  "envelope",
  "findings",
  "inspectionSha256",
  "localInspection",
  "mapping",
  "outcome",
  "protocol",
  "publicationSha256",
  "publisherCommit",
  "rawReports",
  "receiptSha256",
  "release",
  "requestSha256",
  "riskDecision",
  "source",
  "sourceArchive",
  "workflow",
];
const ANALYZER_GAP_KEYS = [
  "completionEvidenceAbsent",
  "coverageComplete",
  "coverageWarningCount",
  "errorNotificationCount",
  "failedAnalyzers",
  "missingAnalyzers",
];
// The Scanner handoff's two truthful outcomes: "observed" only when nothing is unresolved.
const HANDOFF_OUTCOMES = ["observed", "observed_with_gaps"];
// The typed coverage-gap reasons a component artifact may carry.
const COVERAGE_GAP_REASONS = ["completion-evidence-absent"];
const HANDOFF_COMPONENT_KEYS = [
  "catalogAssetId",
  "content",
  "findings",
  "globalCoverage",
  "locationBoundCoverage",
  "observationArtifact",
  "paths",
  "requestedAnalyzers",
  "scannerComponentId",
  "treeSha256",
];
const MAPPING_KEYS = [
  "components",
  "contentClass",
  "exclusions",
  "requestSha256",
  "runtimeCapabilityClaim",
  "sourceId",
  "sourceTreeSha256",
];
const MAPPING_COMPONENT_KEYS = [
  "analyzers",
  "catalogAssetId",
  "paths",
  "scannerComponentId",
  "treeSha256",
];
const COMPONENT_ARTIFACT_KEYS = [
  "analyzerExecution",
  "authority",
  "catalogAssetId",
  "content",
  "coverageComplete",
  "coverageDisposition",
  "coverageGaps",
  "findingSummary",
  "findings",
  "globalCoverageNotifications",
  "globalCoverageSummary",
  "locationBoundCoverageNotifications",
  "locationBoundCoverageSummary",
  "outcome",
  "paths",
  "protocol",
  "publicationSha256",
  "publisherCommit",
  "receiptSha256",
  "requestSha256",
  "requestedAnalyzers",
  "riskDecision",
  "scannerComponentId",
  "source",
  "treeSha256",
];
const SOURCE_KEYS = ["id", "owner", "pinnedCommit", "repository", "treeSha256"];
const PUBLICATION_KEYS = ["annexes", "envelope", "protocol", "receipt", "request", "verification"];
const CATALOG_INDEX_FORMAT = "aih-catalog-index";
const CATALOG_INDEX_VERSION = 1;
const HEX_40 = /^[0-9a-f]{40}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:/-]{0,199}$/;
const PROVIDER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const codeUnitCompare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const fail = (message) => {
  throw new TypeError(`source-assessment-generator:${message}`);
};
const object = (value, label) => {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail(`${label}-object`);
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
const hex = (value, label, pattern = HEX_64) => {
  const candidate = text(value, label, 128);
  if (!pattern.test(candidate)) fail(`${label}-digest`);
  return candidate;
};
const exactKeys = (value, allowed, label) => {
  const actual = Object.keys(object(value, label)).sort(codeUnitCompare);
  const expected = [...allowed].sort(codeUnitCompare);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    fail(`${label}-fields`);
};
const canonical = (value) => {
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
const domainDigest = (domain, value) => `sha256:${sha256(`${domain}\0${canonical(value)}`)}`;
const same = (left, right) => canonical(left) === canonical(right);
const sameIdentity = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.nlink === right.nlink &&
  left.size === right.size &&
  left.mtimeMs === right.mtimeMs &&
  left.ctimeMs === right.ctimeMs;

function readPinnedFile(path, maxBytes = MAX_INPUT_BYTES) {
  const beforePath = lstatSync(path);
  if (
    !beforePath.isFile() ||
    beforePath.isSymbolicLink() ||
    beforePath.nlink !== 1 ||
    beforePath.size <= 0 ||
    beforePath.size > maxBytes
  )
    fail("input-file-shape");
  const descriptor = openSync(path, "r");
  try {
    const beforeDescriptor = fstatSync(descriptor);
    if (!beforeDescriptor.isFile() || !sameIdentity(beforePath, beforeDescriptor))
      fail("input-file-before-read");
    const bytes = readFileSync(descriptor);
    const afterDescriptor = fstatSync(descriptor);
    const afterPath = lstatSync(path);
    if (!sameIdentity(beforeDescriptor, afterDescriptor) || !sameIdentity(afterDescriptor, afterPath))
      fail("input-file-during-read");
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}
function parseJson(bytes, label) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    fail(`${label}-json`);
  }
}
function readJson(path, label, maxBytes) {
  const bytes = readPinnedFile(path, maxBytes);
  return { bytes, value: parseJson(bytes, label) };
}

const sourceRelative = (value, label = "component-path") => {
  const candidate = text(value, label, 1_024);
  if (candidate.includes("\\") || candidate.startsWith("/") || /^[A-Za-z]:/.test(candidate))
    fail(`${label}-relative`);
  const normalized = posix.normalize(candidate);
  if (
    normalized !== candidate ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  )
    fail(`${label}-normalized`);
  return normalized;
};
const pathInside = (root, target, label) => {
  const child = relative(resolve(root), resolve(target));
  if (!child || /^\.\.(?:[\\/]|$)/.test(child) || isAbsolute(child))
    fail(`${label}-outside-root`);
  return child.replaceAll("\\", "/");
};
function unlinkedAbsolutePath(path, label, allowMissing = false) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const segments = relative(root, absolute).split(/[\\/]/).filter(Boolean);
  if (segments.length === 0) fail(`${label}-path-root`);
  let cursor = root;
  for (const [index, segment] of segments.entries()) {
    cursor = resolve(cursor, segment);
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch (error) {
      if (
        allowMissing &&
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return { exists: false };
      fail(`${label}-ancestor-unreadable`);
    }
    if (stat.isSymbolicLink()) fail(`${label}: symbolic link ancestor`);
    if (index < segments.length - 1 && !stat.isDirectory())
      fail(`${label}-ancestor-directory`);
    if (index === segments.length - 1) return { exists: true, stat };
  }
  fail(`${label}-path`);
}
function unlinkedSourcePath(root, target) {
  const pathRel = relativeSourcePath(root, target);
  let cursor = root;
  let stat;
  for (const segment of pathRel.split("/")) {
    cursor = resolve(cursor, segment);
    try {
      stat = lstatSync(cursor);
    } catch {
      fail("component-path-missing");
    }
    if (stat.isSymbolicLink()) fail("component-path: symbolic link ancestor");
  }
  const actual = realpathSync(target);
  pathInside(root, actual, "component-real-path");
  return { pathRel, stat };
}
function rootOf(sourceRoot) {
  const source = unlinkedAbsolutePath(sourceRoot, "source-root");
  if (!source.exists || !source.stat.isDirectory()) fail("source-root-real-directory");
  return realpathSync(sourceRoot);
}
function file(path) {
  const bytes = readFileSync(path);
  return { bytes: bytes.length, sha256: sha256(bytes) };
}
function relativeSourcePath(root, target) {
  const value = relative(root, target).replaceAll("\\", "/");
  if (!value || value === ".." || value.startsWith("../") || isAbsolute(value))
    fail("source-path-escapes-root");
  return value;
}

export function hashComponentTreeV1(sourceRoot, declaredPaths) {
  const root = rootOf(sourceRoot);
  if (!Array.isArray(declaredPaths) || declaredPaths.length === 0) fail("component-declares-no-paths");
  const roots = declaredPaths.map((value) => sourceRelative(value));
  if (new Set(roots).size !== roots.length) fail("duplicate-component-root");
  const entries = new Map();
  const visit = (path) => {
    const { pathRel, stat } = unlinkedSourcePath(root, path);
    if (entries.has(pathRel)) fail("duplicate-component-entry");
    if (stat.isDirectory()) {
      entries.set(pathRel, { type: "directory", path: pathRel });
      for (const child of readdirSync(path).sort(codeUnitCompare)) visit(resolve(path, child));
      return;
    }
    if (!stat.isFile()) fail("unsupported-component-entry");
    if (stat.nlink > 1) fail("hard-link-in-component");
    entries.set(pathRel, { type: "file", path: pathRel, ...file(path) });
  };
  for (const item of [...roots].sort(codeUnitCompare)) visit(resolve(root, ...item.split("/")));
  const ordered = [...entries.values()].sort((left, right) =>
    codeUnitCompare(left.path, right.path),
  );
  return {
    treeSha256: sha256(JSON.stringify(ordered)),
    files: ordered.flatMap((entry) =>
      entry.type === "file"
        ? [{ path: entry.path, bytes: entry.bytes ?? 0, sha256: entry.sha256 ?? "" }]
        : [],
    ),
  };
}

export function hashSourceTreeV1(sourceRoot) {
  const root = rootOf(sourceRoot);
  const entries = new Map();
  const visit = (path) => {
    const stat = lstatSync(path);
    const pathRel = relativeSourcePath(root, path);
    if (entries.has(pathRel)) fail("duplicate-source-entry");
    if (stat.isSymbolicLink()) {
      entries.set(pathRel, { type: "symlink", path: pathRel, target: readlinkSync(path) });
      return;
    }
    if (stat.isDirectory()) {
      entries.set(pathRel, { type: "directory", path: pathRel });
      for (const child of readdirSync(path).sort(codeUnitCompare)) visit(resolve(path, child));
      return;
    }
    if (!stat.isFile()) fail("unsupported-source-entry");
    if (stat.nlink > 1) fail("hard-link-in-source");
    entries.set(pathRel, { type: "file", path: pathRel, ...file(path) });
  };
  const names = readdirSync(root)
    .filter((name) => name !== ".git")
    .sort(codeUnitCompare);
  if (names.length === 0) fail("source-tree-empty");
  for (const name of names) visit(resolve(root, name));
  const ordered = [...entries.values()].sort((left, right) =>
    codeUnitCompare(left.path, right.path),
  );
  return {
    treeSha256: sha256(JSON.stringify(ordered)),
    files: ordered.flatMap((entry) =>
      entry.type === "file"
        ? [{ path: entry.path, bytes: entry.bytes ?? 0, sha256: entry.sha256 ?? "" }]
        : [],
    ),
  };
}

function hashCanonicalGitSourceTreeV1(sourceRoot, revision) {
  const runGit = (args, maxBuffer = 128 * 1024 * 1024) => {
    try {
      return execFileSync("git", ["-C", sourceRoot, ...args], {
        maxBuffer,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      fail("source-git-verification");
    }
  };
  if (runGit(["rev-parse", "--is-inside-work-tree"]).toString("utf8").trim() !== "true")
    fail("source-git-worktree");
  if (runGit(["rev-parse", "HEAD"]).toString("utf8").trim() !== revision)
    fail("source-git-revision");
  if (runGit(["config", "--get", "core.autocrlf"]).toString("utf8").trim() !== "false")
    fail("source-git-autocrlf");
  if (
    runGit(["status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"])
      .toString("utf8")
      .trim().length !== 0
  )
    fail("source-git-dirty");
  const listing = runGit(["ls-tree", "-r", "-t", "-z", "--full-tree", revision]);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let records;
  try {
    records = decoder
      .decode(listing)
      .split("\0")
      .filter((record) => record.length > 0);
  } catch {
    fail("source-git-tree-encoding");
  }
  const entries = [];
  for (const record of records) {
    const tab = record.indexOf("\t");
    const metadata = tab < 0 ? [] : record.slice(0, tab).split(" ");
    if (metadata.length !== 3) fail("source-git-tree-record");
    const [mode, type, objectId] = metadata;
    const path = sourceRelative(record.slice(tab + 1), "source-git-path");
    if (type === "tree" && mode === "040000") {
      entries.push({ type: "directory", path });
      continue;
    }
    if (type !== "blob" || !/^(?:100644|100755|120000)$/.test(mode))
      fail("source-git-tree-entry");
    const bytes = runGit(["cat-file", "blob", objectId]);
    if (mode === "120000") {
      let target;
      try {
        target = decoder.decode(bytes);
      } catch {
        fail("source-git-link-encoding");
      }
      entries.push({ type: "symlink", path, target });
    } else {
      entries.push({ type: "file", path, bytes: bytes.length, sha256: sha256(bytes) });
    }
  }
  entries.sort((left, right) => codeUnitCompare(left.path, right.path));
  return { treeSha256: sha256(JSON.stringify(entries)) };
}

function validateSource(value) {
  exactKeys(value, SOURCE_KEYS, "source");
  const source = object(value, "source");
  if (!ID.test(text(source.id, "source-id", 200))) fail("source-id");
  if (!/^[A-Za-z0-9_.-]+$/.test(text(source.owner, "source-owner", 100))) fail("source-owner");
  if (!/^[A-Za-z0-9_.-]+$/.test(text(source.repository, "source-repository", 100)))
    fail("source-repository");
  hex(source.pinnedCommit, "source-commit", HEX_40);
  hex(source.treeSha256, "source-tree");
  return source;
}
function validateSummary(summary, label) {
  const value = object(summary, label);
  if (!Number.isSafeInteger(value.count) || value.count < 0) fail(`${label}-count`);
  return value;
}
function validateStringSet(values, label) {
  const strings = array(values, label).map((value) => text(value, label, 200));
  if (new Set(strings).size !== strings.length) fail(`${label}-duplicates`);
  return strings;
}
function validatePublication(publicationBytes, handoff) {
  if (sha256(publicationBytes) !== handoff.publicationSha256) fail("publication-digest");
  const publication = parseJson(publicationBytes, "publication");
  exactKeys(publication, PUBLICATION_KEYS, "publication");
  if (publication.protocol !== "BaselineVetPublicationV1") fail("publication-protocol");
  const envelope = object(publication.envelope, "publication-envelope");
  const payloadType = text(envelope.payloadType, "publication-payload-type", 200);
  if (payloadType !== "application/vnd.in-toto+json") fail("publication-payload-type");
  const signatures = array(envelope.signatures, "publication-signatures");
  if (signatures.length !== 1) fail("publication-signature-count");
  const signature = object(signatures[0], "publication-signature");
  const payload = Buffer.from(text(envelope.payload, "publication-payload", MAX_INPUT_BYTES), "base64");
  if (payload.length === 0 || payload.toString("base64") !== envelope.payload)
    fail("publication-payload-base64");
  const payloadValue = parseJson(payload, "publication-payload");
  if (canonical(payloadValue) !== payload.toString("utf8")) fail("publication-payload-canonical");
  const verificationValue = object(publication.verification, "publication-verification");
  const root = object(verificationValue.root, "publication-root");
  const keyId = text(root.keyId, "publication-key-id", 200);
  if (signature.keyid !== keyId) fail("publication-signature-key");
  const publicKeyBytes = Buffer.from(
    text(root.publicKeySpkiBase64, "publication-public-key", 1_024),
    "base64",
  );
  if (publicKeyBytes.length === 0 || publicKeyBytes.toString("base64") !== root.publicKeySpkiBase64)
    fail("publication-public-key-base64");
  if (keyId !== `ed25519:${sha256(publicKeyBytes)}`) fail("publication-key-id");
  const signatureBytes = Buffer.from(text(signature.sig, "publication-signature", 1_024), "base64");
  const pae = Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(payloadType)} ${payloadType} ${payload.length} `),
    payload,
  ]);
  let valid = false;
  try {
    valid = verify(
      null,
      pae,
      createPublicKey({ key: publicKeyBytes, format: "der", type: "spki" }),
      signatureBytes,
    );
  } catch {
    fail("publication-signature-key");
  }
  if (!valid) fail("publication-signature-invalid");
  const predicate = object(object(payloadValue, "publication-statement").predicate, "predicate");
  if (predicate.requestSha256 !== handoff.requestSha256) fail("publication-request");
  if (predicate.receiptSha256 !== handoff.receiptSha256) fail("publication-receipt");
  const claims = object(predicate.claims, "publication-claims");
  const signedAt = text(claims.signedAt, "publication-signed-at", 80);
  const expiresAt = text(claims.expiresAt, "publication-expires-at", 80);
  const signedTime = Date.parse(signedAt);
  const expiresTime = Date.parse(expiresAt);
  if (!Number.isFinite(signedTime) || !Number.isFinite(expiresTime) || signedTime >= expiresTime)
    fail("publication-observation-window");
  const signer = object(predicate.signer, "publication-signer");
  if (
    signer.keyId !== keyId ||
    signer.class !== root.class ||
    signer.identity !== root.identity ||
    object(verificationValue.expected, "publication-expected").now !== signedAt
  )
    fail("publication-signer-root");
  const receipt = object(publication.receipt, "publication-receipt");
  const request = object(publication.request, "publication-request");
  if (
    receipt.receiptSha256 !== handoff.receiptSha256 ||
    receipt.requestSha256 !== handoff.requestSha256 ||
    request.requestSha256 !== handoff.requestSha256 ||
    !same(receipt.source, handoff.source) ||
    !same(request.source, handoff.source)
  )
    fail("publication-bound-inputs");
  return { signedAt, expiresAt, predicate, value: publication };
}

// The handoff fields Scan derives from the publication (reproduceConsumerHandoffV1); the others
// (api, discovery and inspection digests, release, workflow, attestation, the envelope's custody
// booleans and the local inspection) are custody facts checked below or stated as trusted.
const REPRODUCED_KEYS = [
  "analyzerGaps",
  "analyzers",
  "authority",
  "components",
  "coverageNotifications",
  "findings",
  "mapping",
  "outcome",
  "protocol",
  "publicationSha256",
  "publisherCommit",
  "rawReports",
  "receiptSha256",
  "requestSha256",
  "riskDecision",
  "source",
  "sourceArchive",
];
const ATTESTATION_KEYS = [
  "buildSignerDigest",
  "buildSignerURI",
  "issuer",
  "predicateType",
  "runInvocationURI",
  "runnerEnvironment",
  "sourceRepositoryDigest",
  "sourceRepositoryRef",
  "sourceRepositoryURI",
  "subject",
  "subjectCount",
  "verifiedTimestampCount",
  "verifiedTimestamps",
];
const WORKFLOW_KEYS = [
  "attempt",
  "conclusion",
  "event",
  "headBranch",
  "headSha",
  "runId",
  "status",
  "url",
  "workflowName",
  "workflowPath",
];

/**
 * The handoff is Scan's derived, unsigned projection. Every value it derives from the publication
 * must equal what the Catalog reproduces from the publication's authenticated bytes, and its
 * attestation and workflow custody must equal what the Sigstore bundle itself states; any
 * difference refuses. Returns the reproduced component artifacts by Scanner component id.
 */
function reproducedHandoff(handoff, publication, publicationSha256, attestationBytes) {
  const { fields, artifacts } = reproduceConsumerHandoffV1({
    publication: publication.value,
    predicate: publication.predicate,
    publicationSha256,
    publisherCommit: handoff.publisherCommit,
    mapping: handoff.mapping,
  });
  // Each component first, so a refusal names the component artifact that differs.
  const stated = array(handoff.components, "handoff-components");
  if (stated.length !== fields.components.length) fail("handoff-not-reproduced components");
  fields.components.forEach((expected, index) => {
    if (!same(stated[index], expected))
      fail(`handoff-not-reproduced ${expected.observationArtifact.path}`);
  });
  for (const key of REPRODUCED_KEYS)
    if (!same(handoff[key], fields[key])) fail(`handoff-not-reproduced ${key}`);
  const envelope = object(handoff.envelope, "handoff-envelope");
  for (const key of ["authority", "signer", "claims"])
    if (!same(envelope[key], fields.envelope[key])) fail(`handoff-not-reproduced envelope.${key}`);
  const attested = verifyAttestationBundleOfflineV1({
    bundleBytes: attestationBytes,
    publicationSha256,
    publisherCommit: handoff.publisherCommit,
    claims: publication.predicate.claims,
  });
  const attestation = object(handoff.attestation, "handoff-attestation");
  exactKeys(attestation, ATTESTATION_KEYS, "handoff-attestation");
  const { verifiedTimestamps, ...facts } = attestation;
  const timestamps = array(verifiedTimestamps, "handoff-attestation-timestamps");
  if (
    !same(facts, attested.facts) ||
    timestamps.length !== attested.integratedTimes.length ||
    timestamps.some((value, index) => {
      exactKeys(value, ["timestamp", "type", "uri"], "handoff-attestation-timestamp");
      return (
        value.type !== "Tlog" ||
        value.uri !== "https://rekor.sigstore.dev" ||
        Date.parse(value.timestamp) !== attested.integratedTimes[index] * 1000
      );
    })
  )
    fail("handoff-attestation-custody");
  const workflow = object(handoff.workflow, "workflow");
  exactKeys(workflow, WORKFLOW_KEYS, "workflow");
  if (
    workflow.headSha !== handoff.publisherCommit ||
    workflow.headBranch !== "main" ||
    Object.entries(attested.run).some(([key, value]) => workflow[key] !== value)
  )
    fail("workflow-custody");
  const release = object(handoff.release, "release");
  if (release.url !== `${attested.repositoryUri}/releases/tag/${release.tag}`) fail("release-identity");
  return artifacts;
}

const NATIVE_ANNEX_PATH = "annex/aih-native.json";

/**
 * The native per-file hashes of a whole-repository publication. They are bound to the signed
 * statement through the receipt: the receipt must hash to the signed receipt digest (Scan's
 * receipt domain digest), and the native annex bytes must hash to the aih-native annex digest
 * the receipt records for every component that names it.
 */
function publicationNativeFiles(publication, handoff, source) {
  const receipt = object(publication.receipt, "publication-receipt");
  const { receiptSha256: _digest, ...authoring } = receipt;
  if (
    sha256(canonical({ domain: "aih.baseline-vet-receipt-v1", receipt: authoring })) !==
    handoff.receiptSha256
  )
    fail("publication-receipt-digest");
  const annexes = array(publication.annexes, "publication-annexes").filter(
    (annex) => object(annex, "publication-annex").path === NATIVE_ANNEX_PATH,
  );
  if (annexes.length !== 1) fail("publication-native-annex");
  const encoded = text(annexes[0].bytesBase64, "publication-native-annex", MAX_INPUT_BYTES);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== encoded)
    fail("publication-native-annex-base64");
  const recorded = array(receipt.components, "receipt-components").flatMap((component) =>
    array(object(component, "receipt-component").observations, "receipt-observations")
      .map((observation) => object(observation, "receipt-observation"))
      .filter((observation) => observation.analyzer === "aih-native")
      .map((observation) => observation.annexSha256),
  );
  if (recorded.length === 0 || recorded.some((digest) => digest !== sha256(bytes)))
    fail("publication-native-annex-digest");
  const native = object(parseJson(bytes, "publication-native-annex"), "publication-native-annex");
  exactKeys(native, ["files", "protocol", "sourceTreeSha256"], "publication-native-annex");
  if (
    native.protocol !== "BaselineNativeObservationV1" ||
    native.sourceTreeSha256 !== source.treeSha256
  )
    fail("publication-native-annex-source");
  const files = new Map();
  for (const entry of array(native.files, "publication-native-files")) {
    const file = object(entry, "publication-native-file");
    const path = sourceRelative(file.path, "publication-native-path");
    if (files.has(path)) fail("publication-native-duplicate");
    files.set(path, hex(file.sha256, "publication-native-digest"));
  }
  return files;
}

/** A publication's native per-file hashes, bound through its own receipt (see above). */
export function publicationNativeFilesV1(publication) {
  const receipt = object(object(publication, "publication").receipt, "publication-receipt");
  return publicationNativeFiles(
    publication,
    { receiptSha256: receipt.receiptSha256 },
    object(receipt.source, "receipt-source"),
  );
}

/**
 * Component ownership across the members of a publication set: no component id and no file
 * may belong to two members (a root that equals, contains or lies inside another member's).
 */
function assertDisjointOwnership(memberComponents) {
  const ids = new Map();
  const roots = new Map();
  memberComponents.forEach((components, member) => {
    for (const component of components) {
      if (ids.has(component.id) && ids.get(component.id) !== member)
        fail("publication-set-component-overlap");
      ids.set(component.id, member);
      for (const root of component.paths) {
        if (roots.has(root) && roots.get(root) !== member) fail("publication-set-component-overlap");
        roots.set(root, member);
      }
    }
  });
  for (const [root, member] of roots) {
    const parts = root.split("/");
    for (let length = 1; length < parts.length; length += 1) {
      const owner = roots.get(parts.slice(0, length).join("/"));
      if (owner !== undefined && owner !== member) fail("publication-set-component-overlap");
    }
  }
}

function definitionOverlapMode(value) {
  if (value !== "disjoint" && value !== "compiler-catalog") fail("definition-overlap");
  return value;
}

function assertCompilerCatalogOwnership(memberComponents) {
  const ids = new Map();
  const digests = new Map();
  memberComponents.forEach((components, member) => {
    for (const component of components) {
      if (ids.has(component.id) && ids.get(component.id) !== member)
        fail("publication-set-component-overlap");
      ids.set(component.id, member);
      for (const file of component.files) {
        if (digests.has(file.path) && digests.get(file.path) !== file.sha256)
          fail("publication-set-component-overlap-digest");
        digests.set(file.path, file.sha256);
      }
    }
  });
}

/**
 * A publication set (D49): the publications of one Scanner request set, which one execution
 * produced over one source. Its members must agree on the source and its pin, carry the same
 * bytes for every annex path they share, be distinct requests and own disjoint components;
 * any other set is refused, never merged. Each member is still verified on its own.
 */
export function assertPublicationSetV1(publications, definitionOverlap = "disjoint") {
  definitionOverlapMode(definitionOverlap);
  const members = array(publications, "publication-set").map((value) => {
    const publication = object(value, "publication");
    const request = object(publication.request, "publication-request");
    const annexes = new Map();
    for (const entry of array(publication.annexes, "publication-annexes")) {
      const annex = object(entry, "publication-annex");
      const path = text(annex.path, "publication-annex-path", 300);
      const encoded = text(annex.bytesBase64, "publication-annex-bytes", MAX_INPUT_BYTES);
      if (Buffer.from(encoded, "base64").toString("base64") !== encoded)
        fail("publication-annex-base64");
      if (annexes.has(path)) fail("publication-annex-duplicate");
      annexes.set(path, encoded);
    }
    const native = definitionOverlap === "compiler-catalog"
      ? publicationNativeFilesV1(publication)
      : undefined;
    return {
      annexes,
      components: array(request.components, "request-components").map((entry) => {
        const component = object(entry, "request-component");
        return {
          id: text(component.id, "scanner-component-id", 300),
          paths: validateStringSet(component.paths, "component-paths").map((path) =>
            sourceRelative(path),
          ),
          ...(native === undefined ? {} : {
            files: [...native].filter(([path]) => component.paths.some((root) =>
              path === root || path.startsWith(`${root}/`),
            )).map(([path, sha256]) => ({ path, sha256 })),
          }),
        };
      }),
      requestSha256: hex(request.requestSha256, "request"),
      source: validateSource(request.source),
    };
  });
  const [first] = members;
  if (first === undefined) fail("publication-set-empty");
  const requests = new Set();
  for (const member of members) {
    if (["id", "owner", "repository"].some((key) => member.source[key] !== first.source[key]))
      fail("publication-set-source");
    if (
      member.source.pinnedCommit !== first.source.pinnedCommit ||
      member.source.treeSha256 !== first.source.treeSha256
    )
      fail("publication-set-pin");
    if (requests.has(member.requestSha256)) fail("publication-set-duplicate");
    requests.add(member.requestSha256);
  }
  if (definitionOverlap === "compiler-catalog")
    assertCompilerCatalogOwnership(members.map((member) => member.components));
  const annexes = new Map();
  for (const member of members) {
    for (const [path, encoded] of member.annexes) {
      if (annexes.has(path) && annexes.get(path) !== encoded) fail("publication-set-annex-bytes");
      annexes.set(path, encoded);
    }
  }
  if (definitionOverlap === "disjoint")
    assertDisjointOwnership(members.map((member) => member.components));
}

/**
 * `closureMode`: rows come from the Catalog's curated inventory, so a mapped Scanner component
 * may hold any content (a skill directory, the repository root, a runtime directory); in the
 * direct skill mode every mapped component is itself one skill row.
 */
function validateHandoff(
  handoff,
  publicationBytes,
  attestationBytes,
  sourceRoot,
  handoffPath,
  closureMode = false,
) {
  exactKeys(handoff, HANDOFF_KEYS, "handoff");
  if (
    handoff.protocol !== "ScannerPublicationConsumerHandoffV1" ||
    handoff.authority !== "none" ||
    !HANDOFF_OUTCOMES.includes(handoff.outcome) ||
    handoff.riskDecision !== "consumer_required"
  )
    fail("handoff-authority");
  const source = validateSource(handoff.source);
  hex(handoff.publisherCommit, "publisher-commit", HEX_40);
  hex(handoff.requestSha256, "request");
  hex(handoff.receiptSha256, "receipt");
  hex(handoff.publicationSha256, "publication");
  const currentSource = hashSourceTreeV1(sourceRoot);
  if (currentSource.treeSha256 !== source.treeSha256) {
    if (!existsSync(resolve(sourceRoot, ".git"))) fail("source-tree-digest");
    if (hashCanonicalGitSourceTreeV1(sourceRoot, source.pinnedCommit).treeSha256 !== source.treeSha256)
      fail("source-tree-digest");
  }
  const workflow = object(handoff.workflow, "workflow");
  if (
    workflow.status !== "completed" ||
    workflow.conclusion !== "success" ||
    workflow.headSha !== handoff.publisherCommit
  )
    fail("workflow-custody");
  const envelope = object(handoff.envelope, "handoff-envelope");
  if (
    envelope.authority !== "none" ||
    envelope.envelopeValid !== true ||
    envelope.annexesComplete !== true ||
    envelope.sameRunArtifactAndReleaseBytesMatch !== true ||
    envelope.cliInspectionMatchesReleasedInspection !== true
  )
    fail("handoff-envelope-custody");
  const analyzerGaps = object(handoff.analyzerGaps, "analyzer-gaps");
  exactKeys(analyzerGaps, ANALYZER_GAP_KEYS, "analyzer-gaps");
  if (
    array(analyzerGaps.missingAnalyzers, "missing-analyzers").length !== 0 ||
    array(analyzerGaps.failedAnalyzers, "failed-analyzers").length !== 0 ||
    analyzerGaps.errorNotificationCount !== 0
  )
    fail("analyzer-execution-incomplete");
  const completionEvidenceAbsent = validateStringSet(
    analyzerGaps.completionEvidenceAbsent,
    "completion-evidence-absent",
  );
  if (typeof analyzerGaps.coverageComplete !== "boolean") fail("analyzer-coverage-claim");
  // Coverage is complete only with completion evidence for every analyzer, never from silence.
  if (analyzerGaps.coverageComplete && completionEvidenceAbsent.length !== 0)
    fail("analyzer-coverage-claim");
  // "observed" is truthful only when nothing is unresolved; any gap needs observed_with_gaps.
  const gapFree =
    analyzerGaps.coverageComplete === true &&
    validateSummary(object(handoff.findings, "handoff-findings").unmapped, "unmapped-findings")
      .count === 0;
  if ((handoff.outcome === "observed") !== gapFree) fail("handoff-outcome");
  const mapping = object(handoff.mapping, "mapping");
  exactKeys(mapping, MAPPING_KEYS, "mapping");
  if (
    mapping.sourceId !== source.id ||
    mapping.requestSha256 !== handoff.requestSha256 ||
    mapping.sourceTreeSha256 !== source.treeSha256 ||
    ![
      "exact compiler/source-file closure for assessment only",
      "exact direct plugin skill/source files for assessment only",
    ].includes(mapping.contentClass) ||
    array(mapping.runtimeCapabilityClaim, "runtime-capability-claim").length !== 0
  )
    fail("mapping-source-binding");
  const mapped = array(mapping.components, "mapping-components");
  const summarized = array(handoff.components, "handoff-components");
  if (mapped.length === 0 || mapped.length !== summarized.length) fail("partial-component-mapping");
  const mappedById = new Map();
  const declaredRoots = [];
  for (const component of mapped) {
    exactKeys(component, MAPPING_COMPONENT_KEYS, "mapping-component");
    const scannerComponentId = text(component.scannerComponentId, "scanner-component-id", 300);
    if (mappedById.has(scannerComponentId)) fail("duplicate-mapping-component");
    text(component.catalogAssetId, "catalog-asset-id", 300);
    hex(component.treeSha256, "component-tree");
    const paths = validateStringSet(component.paths, "component-paths").map((path) =>
      sourceRelative(path),
    );
    if (paths.length === 0) fail("component-paths-empty");
    for (const path of paths) {
      for (const existing of declaredRoots)
        if (path === existing || path.startsWith(`${existing}/`) || existing.startsWith(`${path}/`))
          fail("overlapping-component-paths");
      declaredRoots.push(path);
    }
    validateStringSet(component.analyzers, "component-analyzers");
    mappedById.set(scannerComponentId, component);
  }
  const publication = validatePublication(publicationBytes, handoff);
  const reproduced = reproducedHandoff(
    handoff,
    publication,
    handoff.publicationSha256,
    attestationBytes,
  );
  const components = [];
  let mappedFindingCount = 0;
  for (const summary of summarized) {
    exactKeys(summary, HANDOFF_COMPONENT_KEYS, "handoff-component");
    const scannerComponentId = text(summary.scannerComponentId, "scanner-component-id", 300);
    const mappingComponent = mappedById.get(scannerComponentId);
    if (mappingComponent === undefined) fail("partial-component-mapping");
    const content = text(summary.content, "component-content", 40);
    if (
      summary.catalogAssetId !== mappingComponent.catalogAssetId ||
      (!closureMode && content !== "skill") ||
      summary.treeSha256 !== mappingComponent.treeSha256 ||
      !same(summary.paths, mappingComponent.paths) ||
      !same(summary.requestedAnalyzers, mappingComponent.analyzers)
    )
      fail("component-mapping-mismatch");
    const artifactPointer = object(summary.observationArtifact, "component-artifact-pointer");
    const declaredArtifactPath = text(artifactPointer.path, "component-artifact-path", 4_096);
    const artifactName = declaredArtifactPath.replaceAll("\\", "/").split("/").at(-1);
    if (artifactName === undefined || !/^[a-z0-9-]+\.json$/.test(artifactName))
      fail("component-artifact-name");
    const artifactPath = resolve(dirname(handoffPath), "components", artifactName);
    pathInside(dirname(handoffPath), artifactPath, "component-artifact");
    const artifactRead = readJson(artifactPath, "component-artifact", MAX_INPUT_BYTES);
    if (
      artifactRead.bytes.length !== artifactPointer.byteLength ||
      sha256(artifactRead.bytes) !== artifactPointer.sha256
    )
      fail("component-artifact-digest");
    // The artifact states exactly what the publication's authenticated bytes say, byte for byte.
    if (!artifactRead.bytes.equals(reproduced.get(scannerComponentId)?.bytes ?? Buffer.alloc(0)))
      fail(`handoff-not-reproduced components/${artifactName}`);
    const artifact = artifactRead.value;
    exactKeys(artifact, COMPONENT_ARTIFACT_KEYS, "component-artifact");
    if (
      artifact.protocol !== "ScannerComponentObservationHandoffV1" ||
      artifact.authority !== "none" ||
      artifact.outcome !== "observed" ||
      artifact.riskDecision !== "consumer_required" ||
      artifact.publisherCommit !== handoff.publisherCommit ||
      artifact.requestSha256 !== handoff.requestSha256 ||
      artifact.receiptSha256 !== handoff.receiptSha256 ||
      artifact.publicationSha256 !== handoff.publicationSha256 ||
      artifact.scannerComponentId !== scannerComponentId ||
      artifact.catalogAssetId !== summary.catalogAssetId ||
      artifact.content !== content ||
      artifact.treeSha256 !== summary.treeSha256 ||
      !same(artifact.source, source) ||
      !same(artifact.paths, summary.paths) ||
      !same(artifact.requestedAnalyzers, summary.requestedAnalyzers)
    )
      fail("component-artifact-binding");
    const requestedAnalyzers = validateStringSet(
      artifact.requestedAnalyzers,
      "requested-analyzers",
    );
    const executions = array(artifact.analyzerExecution, "analyzer-execution");
    if (executions.length !== requestedAnalyzers.length) fail("analyzer-execution-incomplete");
    const executionNames = executions.map((execution) => {
      const row = object(execution, "analyzer-execution-row");
      if (row.executionSuccessful !== true) fail("analyzer-execution-failed");
      return text(row.analyzer, "analyzer-name", 200);
    });
    if (
      [...executionNames].sort(codeUnitCompare).join("\0") !==
      [...requestedAnalyzers].sort(codeUnitCompare).join("\0")
    )
      fail("analyzer-execution-incomplete");
    const findings = array(artifact.findings, "component-findings");
    const locationCoverage = array(
      artifact.locationBoundCoverageNotifications,
      "location-coverage",
    );
    const globalCoverage = array(artifact.globalCoverageNotifications, "global-coverage");
    const coverageGaps = array(artifact.coverageGaps, "component-coverage-gaps");
    const gapAnalyzers = new Set();
    for (const gap of coverageGaps) {
      exactKeys(gap, ["analyzer", "reason"], "component-coverage-gap");
      if (
        !COVERAGE_GAP_REASONS.includes(gap.reason) ||
        !requestedAnalyzers.includes(gap.analyzer) ||
        gapAnalyzers.has(gap.analyzer)
      )
        fail("component-coverage-gap");
      gapAnalyzers.add(gap.analyzer);
    }
    // A component is complete exactly when nothing about its coverage is unresolved.
    if (
      artifact.coverageComplete !==
      (locationCoverage.length === 0 && globalCoverage.length === 0 && coverageGaps.length === 0)
    )
      fail("component-coverage-claim");
    if (analyzerGaps.coverageComplete === true && !artifact.coverageComplete)
      fail("analyzer-coverage-claim");
    if (
      !same(validateSummary(artifact.findingSummary, "finding-summary"), summary.findings) ||
      !same(
        validateSummary(artifact.locationBoundCoverageSummary, "location-coverage-summary"),
        summary.locationBoundCoverage,
      ) ||
      !same(
        validateSummary(artifact.globalCoverageSummary, "global-coverage-summary"),
        summary.globalCoverage,
      ) ||
      artifact.findingSummary.count !== findings.length ||
      artifact.locationBoundCoverageSummary.count !== locationCoverage.length ||
      artifact.globalCoverageSummary.count !== globalCoverage.length
    )
      fail("component-summary-mismatch");
    for (const finding of findings) {
      const row = object(finding, "component-finding");
      if (row.unmapped !== false || !array(row.componentIds, "finding-components").includes(scannerComponentId))
        fail("unmapped-component-finding");
    }
    for (const notification of locationCoverage) {
      const row = object(notification, "location-coverage-notification");
      if (
        row.unmapped !== false ||
        !array(row.componentIds, "coverage-components").includes(scannerComponentId)
      )
        fail("unmapped-location-coverage");
    }
    const componentHash = hashComponentTreeV1(sourceRoot, artifact.paths);
    if (componentHash.treeSha256 !== artifact.treeSha256) fail("component-tree-digest");
    mappedFindingCount += findings.length;
    components.push({
      artifact,
      coverageGaps,
      files: componentHash.files,
      findings,
      globalCoverage,
      locationCoverage,
      requestedAnalyzers,
    });
  }
  const aggregate = validateSummary(
    object(handoff.findings, "handoff-findings").mappedToDeclaredClosures,
    "mapped-findings",
  );
  if (aggregate.count !== mappedFindingCount) fail("mapped-finding-count");
  return { source, mapping, publication, components };
}

const LICENSE_FILE = /^LICENSE(?:\..+)?$/i;
/**
 * The license texts the Catalog states as found (G21, D68): the label a row carries and the words
 * that label quotes from the file. A file carries a label only when every fragment is present in
 * it, compared with whitespace runs normalized, so a label is never stated over words the file does
 * not carry and a restrictive license is never relabeled as one it does not state. `quoted` states
 * the fragments as the file's own words in the row's source-right evidence, which its sha256 binds.
 */
const STATED_LICENSES = [
  { id: "Apache-2.0", fragments: ["Apache License", "Version 2.0"] },
  { id: "MIT", fragments: ["MIT License", "Permission is hereby granted"] },
  {
    id: "Anthropic-Proprietary",
    fragments: [
      "© 2025 Anthropic, PBC. All rights reserved.",
      "is governed by your agreement with Anthropic regarding use of Anthropic's services",
      "ADDITIONAL RESTRICTIONS: Notwithstanding anything in the Agreement to the contrary, users may not:",
    ],
    quoted: true,
  },
];
const STATED_LICENSE_IDS = STATED_LICENSES.map((label) => label.id).join(", ");
const normalizeLicenseText = (contents) => contents.replace(/\s+/gu, " ");

/** The stated label of one license text, or undefined when the Catalog states none for it. */
function statedLicense(contents) {
  const normalized = normalizeLicenseText(contents);
  return STATED_LICENSES.find((label) =>
    label.fragments.every((fragment) => normalized.includes(normalizeLicenseText(fragment))),
  );
}

function licenseLabel(sourceRoot, path) {
  const bytes = readPinnedFile(resolve(sourceRoot, ...path.split("/")), 512 * 1024);
  let contents;
  try {
    contents = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
  return statedLicense(contents);
}
/**
 * The license facts of one row (G21). Exactly one stated license file in the closure is its
 * applicable notice; a stated restrictive license is carried as its own label with the words the
 * file uses; any other state is rendered as "license not determined" with the reason, never
 * refused and never relabeled.
 */
function licenseFacts(sourceRoot, files) {
  const found = files
    .filter((entry) => LICENSE_FILE.test(posix.basename(entry.path)))
    .sort((left, right) => codeUnitCompare(left.path, right.path))
    .map((entry) => ({ ...entry, label: licenseLabel(sourceRoot, entry.path) }));
  const [only] = found;
  if (found.length === 1 && only !== undefined && only.label !== undefined) {
    const { label, ...entry } = only;
    return {
      determined: true,
      ...entry,
      id: label.id,
      ...(label.quoted === true ? { quotes: label.fragments } : {}),
    };
  }
  const reason =
    found.length === 0
      ? "no license file in the closure"
      : found.length === 1
        ? `${found[0].path} is not one of the license texts the Catalog states (${STATED_LICENSE_IDS})`
        : `${found.length} license files in the closure: ${found
            .map((entry) => `${entry.path} (${entry.label?.id ?? "not recognized"})`)
            .join(", ")}`;
  return { determined: false, reason };
}
// The Catalog's supported subject kinds (ai-coding/supported-catalog-v2.md:59-60, enforced by
// src/signed-catalog-v2.ts): a curated component of any other kind is reported as excluded and
// is never relabeled as a member (README.md:39-40).
const SUPPORTED_KINDS = ["agent", "mcp", "package", "profile", "skill", "tool"];
const unsupportedKindReason = (kind) =>
  `${kind} is not a supported Catalog subject kind (ai-coding/supported-catalog-v2.md:59-60; README.md:39-40)`;
const COMPILERS = {
  "pinned-baseline/v1": { id: "pinned-baseline", inputFormat: "pinned-baseline/v1", version: "1" },
  "pinned-component-collection/v1": {
    id: "pinned-component-collection",
    inputFormat: "pinned-component-collection/v1",
    version: "1",
  },
  "pinned-skill-collection/v1": {
    id: "pinned-skill-collection",
    inputFormat: "pinned-skill-collection/v1",
    version: "1",
  },
};

function evidence(kind, id, subjectDigest, summary) {
  if (summary.length > 1_024) fail("evidence-summary-too-long");
  return {
    attestor: "attestor:aih-catalog/source-evidence",
    format: "aih-supported-evidence/v2",
    id,
    kind,
    subjectDigest,
    summary,
  };
}
function releaseLocator(release, publisherCommit, requestSha256) {
  const value = object(release, "release");
  const tag = text(value.tag, "release-tag", 512);
  const expectedTag = `baseline-v1-${publisherCommit}-${requestSha256}`;
  const url = text(value.url, "release-url", 2_048);
  if (tag !== expectedTag || value.targetCommitish !== publisherCommit || !url.endsWith(`/tag/${tag}`))
    fail("release-identity");
  return `${url.slice(0, -(`/tag/${tag}`).length)}/download/${tag}/publication.json`;
}

const githubRepository = (value, label) => {
  const match = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(
    text(value, label, 300),
  );
  if (match === null) fail(`${label}-repository`);
  return `${match[1]}/${match[2]}`;
};
const declaredDigest = (value, label) => {
  const candidate = text(value, label, 80);
  if (!/^sha256:[0-9a-f]{64}$/.test(candidate)) fail(`${label}-digest`);
  return candidate.slice("sha256:".length);
};

/**
 * One supported component of a baseline catalog as a closure row (D59), in exactly one of its
 * three curated shapes; anything else refuses, naming the component and the shape it misses.
 * - skill: one directory with a SKILL.md, or several directory roots whose canonical root is
 *   `skills/<name>` (the compiler's preferred source path) and holds the entry SKILL.md; the
 *   closure is the union of the roots and every root must hold a file;
 * - agent: exactly one file, which is the entry;
 * - mcp: explicit declaration files only, which several components may share; the entry is the
 *   first one the definition lists (the compiler's preferred source path).
 */
function baselineCandidate(id, kind, name, roots, nativePaths) {
  const unrendered = (reason) => fail(`definition-component-unrendered ${id}: ${reason}`);
  const under = (root) => nativePaths.filter((path) => path.startsWith(`${root}/`));
  const isFile = (path) => nativePaths.includes(path);
  if (kind === "skill") {
    if (roots.length === 1) {
      const members = under(roots[0]);
      const entryPath = `${roots[0]}/SKILL.md`;
      if (!members.includes(entryPath)) fail("definition-skill-entrypoint");
      return { id, kind, name, entryPath, members, explicit: [] };
    }
    const canonicalRoot = `skills/${name}`;
    if (!roots.includes(canonicalRoot))
      unrendered(`a skill with several roots needs its canonical root ${canonicalRoot}`);
    const members = roots.flatMap((root) => {
      const files = under(root);
      if (files.length === 0 || isFile(root)) unrendered(`root ${root} holds no file`);
      return files;
    });
    const entryPath = `${canonicalRoot}/SKILL.md`;
    if (!members.includes(entryPath)) fail("definition-skill-entrypoint");
    return { id, kind, name, entryPath, members, explicit: [], roots };
  }
  if (kind === "agent") {
    if (roots.length !== 1 || !isFile(roots[0]) || under(roots[0]).length > 0)
      unrendered("an agent names exactly one file");
    return { id, kind, name, entryPath: roots[0], members: roots, roots };
  }
  if (kind === "mcp") {
    for (const root of roots)
      if (!isFile(root) || under(root).length > 0)
        unrendered(`an mcp names only explicit declaration files; ${root} is not one file`);
    return { id, kind, name, entryPath: roots[0], members: roots, roots };
  }
  return unrendered("a baseline catalog renders only agent, mcp and skill rows");
}

/**
 * The external-inventory MCP rows of a baseline catalog (D61): every mcp asset of the Catalog's
 * policy authoring catalog at the pin (tools/emit-compiler-input.mjs; framework-catalogs-v1.ts
 * externalEccMcpAssets) that is not a curated component. Each names exactly one declaration file
 * the curated definition lists for an mcp component, with its declared sha256; that file is its
 * entry and, beside the root license, its closure. The curated mcp assets must agree with the
 * definition (same paths, the entry the compiler prefers), and every curated mcp component must
 * be one of them.
 */
function externalMcpCandidates(value, source, repository, curated, nativePaths, declare) {
  const authoring = object(value, "authoring-catalog");
  const framework = object(authoring.framework, "authoring-catalog-framework");
  if (
    authoring.version !== "pinned-baseline/v1" ||
    framework.id !== source.id ||
    framework.repository !== repository ||
    framework.commit !== source.pinnedCommit
  )
    fail("authoring-catalog-source");
  const byId = new Map(curated.map((candidate) => [candidate.id, candidate]));
  const declarations = new Set(curated.flatMap((candidate) => candidate.members));
  const seen = new Set();
  const externals = [];
  for (const item of array(framework.assets, "authoring-catalog-assets")) {
    const asset = object(item, "authoring-catalog-asset");
    if (asset.kind !== "mcp") continue;
    const id = text(asset.id, "authoring-catalog-asset-id", 300);
    if (!id.startsWith("mcp:") || seen.has(id)) fail("authoring-catalog-asset-id");
    seen.add(id);
    const assetSource = object(asset.source, "authoring-catalog-asset-source");
    if (assetSource.repository !== repository || assetSource.commit !== source.pinnedCommit)
      fail("authoring-catalog-source");
    const path = text(assetSource.path, "authoring-catalog-asset-path", 1_000);
    const paths = validateStringSet(asset.sourcePaths, "authoring-catalog-source-paths");
    const component = byId.get(id);
    if (component !== undefined) {
      if (
        path !== component.entryPath ||
        canonical([...paths].sort(codeUnitCompare)) !==
          canonical([...component.members].sort(codeUnitCompare))
      )
        fail(`authoring-catalog-curated-mismatch ${id}`);
      continue;
    }
    const undeclared = (reason) => fail(`authoring-catalog-external-undeclared ${id}: ${reason}`);
    const metadata = asset.metadata;
    if (
      paths.length !== 1 ||
      paths[0] !== path ||
      metadata === null ||
      typeof metadata !== "object" ||
      metadata.sourcePath !== path ||
      typeof metadata.sourceSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(metadata.sourceSha256)
    )
      undeclared("an external asset names exactly its one declaration file");
    const relativePath = sourceRelative(path, "authoring-catalog-asset-path");
    if (!declarations.has(relativePath) || !nativePaths.includes(relativePath))
      undeclared(`${path} is not a declaration file the curated definition lists for an mcp component`);
    declare(relativePath, `sha256:${metadata.sourceSha256}`);
    externals.push({
      id,
      kind: "mcp",
      name: id.slice("mcp:".length),
      entryPath: relativePath,
      members: [relativePath],
      roots: [relativePath],
    });
  }
  for (const candidate of curated)
    if (!seen.has(candidate.id)) fail(`authoring-catalog-curated-missing ${candidate.id}`);
  return externals;
}

/**
 * The curated Catalog rows of one source and their compiler closures, from the Catalog's own
 * pinned definition (tools/emit-baseline-definitions.mjs): a pinned skill collection (its
 * skills' declared files and declared license), a pinned component collection (each
 * component's file references and the declared license file) or a pinned baseline catalog (each
 * agent file, mcp declaration files and skill root directories, expanded over the publication's
 * native file list, and the repository-root license files; baselineCandidate). A file several
 * rows share must be listed by each. A definition for another source or pin refuses.
 * `nativePaths` is the publication's native file list.
 */
export function curatedClosuresV1(definitionValue, source, nativePaths, authoringValue, requestedPaths) {
  const definition = object(definitionValue, "definition");
  const repository = `${source.owner}/${source.repository}`;
  const declared = new Map();
  const declare = (path, digest) => {
    const relativePath = sourceRelative(path, "definition-path");
    const value = declaredDigest(digest, "definition-file");
    if (declared.has(relativePath) && declared.get(relativePath) !== value)
      fail("definition-file-duplicate");
    declared.set(relativePath, value);
    return relativePath;
  };
  const pinnedSource = (value) => {
    const declaredSource = object(value, "definition-source");
    if (
      declaredSource.id !== source.id ||
      declaredSource.commit !== source.pinnedCommit ||
      githubRepository(declaredSource.repository, "definition-source") !== repository
    )
      fail("definition-source");
    return declaredSource;
  };
  const candidates = [];
  let licensePaths;
  const format = definition.version ?? (Object.hasOwn(definition, "pinnedSha") ? "pinned-baseline/v1" : undefined);
  if (authoringValue !== undefined && format !== "pinned-baseline/v1") fail("authoring-catalog-format");
  if (format === "pinned-skill-collection/v1") {
    pinnedSource(definition.source);
    const license = object(definition.license, "definition-license");
    licensePaths = [declare(license.path, license.sha256)];
    for (const value of array(definition.skills, "definition-skills")) {
      const skill = object(value, "definition-skill");
      const name = text(skill.id, "definition-skill-id", 200);
      const members = array(skill.files, "definition-skill-files").map((entry) => {
        const item = object(entry, "definition-skill-file");
        return declare(item.path, item.sha256);
      });
      const entries = members.filter((path) => posix.basename(path) === "SKILL.md");
      if (entries.length !== 1) fail("definition-skill-entrypoint");
      candidates.push({ id: `skill:${name}`, kind: "skill", name, entryPath: entries[0], members });
    }
  } else if (format === "pinned-component-collection/v1") {
    const declaredSource = pinnedSource(definition.source);
    licensePaths = [sourceRelative(declaredSource.licenseFileRef, "definition-license")];
    for (const value of array(definition.files, "definition-files")) {
      const item = object(value, "definition-file");
      declare(item.path, item.sha256);
    }
    for (const value of array(definition.components, "definition-components")) {
      const component = object(value, "definition-component");
      const id = text(component.id, "definition-component-id", 300);
      const kind = text(component.kind, "definition-component-kind", 40);
      if (!id.startsWith(`${kind}:`)) fail("definition-component-id");
      const members = validateStringSet(component.fileRefs, "definition-file-refs").map((path) =>
        sourceRelative(path, "definition-file-ref"),
      );
      const entryPath = sourceRelative(component.primaryPath, "definition-primary-path");
      if (!members.includes(entryPath)) fail("definition-primary-path");
      candidates.push({ id, kind, name: id.slice(kind.length + 1), entryPath, members });
    }
    for (const path of [...licensePaths, ...candidates.flatMap((candidate) => candidate.members)])
      if (!declared.has(path)) fail("definition-file-undeclared");
  } else if (format === "pinned-baseline/v1") {
    if (
      definition.id !== source.id ||
      definition.pinnedSha !== source.pinnedCommit ||
      `${text(definition.owner, "definition-owner", 100)}/${text(definition.repo, "definition-repo", 100)}` !==
        repository
    )
      fail("definition-source");
    licensePaths = nativePaths.filter((path) => !path.includes("/") && LICENSE_FILE.test(path));
    for (const value of array(definition.components, "definition-components")) {
      const component = object(value, "definition-component");
      const id = text(component.id, "definition-component-id", 300);
      const colon = id.indexOf(":");
      if (colon <= 0) fail("definition-component-id");
      const kind = id.slice(0, colon);
      const roots = validateStringSet(component.paths, "definition-component-paths").map((path) =>
        sourceRelative(path, "definition-component-path"),
      );
      if (!SUPPORTED_KINDS.includes(kind)) {
        candidates.push({ id, kind, name: id.slice(colon + 1), members: [] });
        continue;
      }
      candidates.push(baselineCandidate(id, kind, id.slice(colon + 1), roots, nativePaths));
    }
    // Every mcp asset of the policy authoring catalog keeps its row (D61), so a baseline catalog
    // with mcp components never renders them without it.
    const curatedMcp = candidates.filter((candidate) => candidate.kind === "mcp");
    if (authoringValue === undefined) {
      if (curatedMcp.length > 0)
        fail(
          "authoring-catalog-required: a baseline catalog with mcp components renders its mcp rows from the Catalog's policy authoring catalog at the pin",
        );
    } else
      candidates.push(
        ...externalMcpCandidates(authoringValue, source, repository, curatedMcp, nativePaths, declare),
      );
  } else fail("definition-format");
  if (licensePaths.length === 0 || licensePaths.some((path) => !nativePaths.includes(path)))
    fail("source-license-record-missing");
  // A file two curated rows share must be listed by each of them (D59): a closure never
  // reaches another row's file through a directory root.
  const listedBy = new Map();
  for (const candidate of candidates)
    for (const path of candidate.members) listedBy.set(path, [...(listedBy.get(path) ?? []), candidate]);
  for (const [path, holders] of listedBy)
    if (holders.length > 1 && holders.some((candidate) => !(candidate.explicit ?? candidate.members).includes(path)))
      fail(`definition-shared-file-implicit ${path}`);
  const rows = [];
  const excluded = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) fail("definition-duplicate-component");
    seen.add(candidate.id);
    if (!SUPPORTED_KINDS.includes(candidate.kind)) {
      excluded.push({
        id: candidate.id,
        kind: candidate.kind,
        reason: unsupportedKindReason(candidate.kind),
      });
      continue;
    }
    if (!ID.test(candidate.name) || candidate.name.includes("/") || candidate.name.includes(":"))
      fail("catalog-subject-id");
    rows.push({
      entryPath: candidate.entryPath,
      files: [...new Set([
        ...licensePaths.filter((path) => requestedPaths === undefined || requestedPaths.has(path)),
        ...candidate.members,
      ])].sort(codeUnitCompare),
      kind: candidate.kind,
      name: candidate.name,
      // A baseline catalog's multi-path shapes (D59) state their roots and shared files.
      ...(candidate.roots === undefined
        ? {}
        : {
            roots: candidate.roots,
            shared: candidate.members.filter((path) => listedBy.get(path).length > 1),
          }),
    });
  }
  return {
    compiler: COMPILERS[format],
    declared,
    excluded: excluded.sort((left, right) => codeUnitCompare(left.id, right.id)),
    sourceLicensePaths: licensePaths,
    rows: rows.sort((left, right) =>
      codeUnitCompare(`${left.kind}:${left.name}`, `${right.kind}:${right.name}`),
    ),
  };
}

const locatedIn = (closure) => (item) => {
  const locations = object(item, "located-observation").locations;
  return (
    !Array.isArray(locations) ||
    locations.length === 0 ||
    locations.some((location) => closure.has(object(location, "observation-location").path))
  );
};
const unique = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = canonical(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Closure-row mode: one row per curated Catalog component. Every closure file must be in the
 * publication's native per-file hashes, match the pinned checkout and any digest the definition
 * declares, and lie in exactly one mapped Scanner component. A row carries the findings and
 * location-bound notifications of those components whose location lies in its closure (or that
 * carry none), and all their global notifications. Over a publication set every member's
 * receipt and native annex are verified (the set shares the annex bytes), the mapped components
 * are the union of the members' and a row cites exactly the members that own its closure.
 */
export function selectCurrentClosureRowsV1(rows, index, provider) {
  const entries = array(object(index, "current-index").entries, "current-index-entries");
  const current = new Set(entries.map((value) => text(object(value, "current-entry").entryId, "current-entry-id", 300)));
  return rows.filter((row) => current.has(`${row.kind}.${provider}.${row.name}`));
}

/** Copy only index-bound files of an uncovered committed MCP row, without changing its P' evidence. */
export function preserveUnmappedMcpRowsV1({ root, index, provider, names, sourceCommit }) {
  const entries = array(object(index, "current-index").entries, "current-index-entries");
  const byId = new Map(entries.map((value) => {
    const entry = object(value, "current-entry");
    return [text(entry.entryId, "current-entry-id", 300), entry];
  }));
  const preserved = new Map();
  if (new Set(names).size !== names.length) fail("retained-row-duplicate");
  const source = unlinkedAbsolutePath(root, "retained-root");
  if (!source.exists || !source.stat.isDirectory()) fail("retained-root-directory");
  for (const name of names) {
    const entryId = name.startsWith(`mcp.${provider}.`) ? name : `mcp.${provider}.${name}`;
    if (!entryId.startsWith(`mcp.${provider}.`)) fail("retained-row-kind");
    const entry = byId.get(entryId);
    if (entry === undefined || object(entry.subject, "retained-subject").kind !== "mcp")
      fail("retained-row-kind");
    if (object(entry.subject.source, "retained-source").commit !== sourceCommit)
      fail("retained-row-pin");
    const references = [];
    const collect = (value) => {
      if (Array.isArray(value)) return value.forEach(collect);
      if (value === null || typeof value !== "object") return;
      if (typeof value.path === "string" && typeof value.sha256 === "string") {
        references.push({ path: value.path, sha256: value.sha256 });
        return;
      }
      for (const child of Object.values(value)) collect(child);
    };
    collect({ seed: entry.seed, artifacts: entry.artifacts, qualification: entry.qualification });
    if (references.length === 0) fail("retained-row-files");
    const seen = new Set();
    for (const reference of references) {
      const expected = `defaults/workbench/${provider}/${entryId}/`;
      if (!reference.path.startsWith(expected) || !HEX_64.test(reference.sha256))
        fail("retained-row-reference");
      const suffix = sourceRelative(reference.path.slice(expected.length), "retained-file");
      if (seen.has(suffix)) fail("retained-row-duplicate-file");
      seen.add(suffix);
      const filePath = resolve(root, entryId, ...suffix.split("/"));
      const item = unlinkedAbsolutePath(filePath, "retained-file");
      if (!item.exists || !item.stat.isFile()) fail("retained-row-file");
      const bytes = readPinnedFile(filePath);
      if (sha256(bytes) !== reference.sha256) fail("retained-row-digest");
      preserved.set(`${entryId}/${suffix}`, bytes);
    }
  }
  return preserved;
}

function closureRows(members, provider, sourceRoot, definition, authoring, currentIndex) {
  const natives = members.map(({ handoff, validated }) =>
    publicationNativeFiles(validated.publication.value, handoff, validated.source),
  );
  const [native] = natives;
  const { source } = members[0].validated;
  const requestedPaths = new Set([...native.keys()].filter((path) =>
    members.some(({ validated }) => validated.publication.value.request.components.some((component) =>
      component.paths.some((componentRoot) =>
        path === componentRoot || path.startsWith(`${componentRoot}/`),
      ),
    )),
  ));
  const inventory = curatedClosuresV1(
    definition,
    source,
    [...native.keys()].sort(codeUnitCompare),
    authoring,
    requestedPaths,
  );
  const root = rootOf(sourceRoot);
  const sourceLicenseFiles = inventory.sourceLicensePaths.map((path) => {
    const nativeDigest = native.get(path);
    if (nativeDigest === undefined) fail("source-license-record-missing");
    const target = resolve(root, ...path.split("/"));
    const { stat } = unlinkedSourcePath(root, target);
    if (!stat.isFile() || stat.nlink > 1) fail("source-license-shape");
    const checkout = file(target);
    if (checkout.sha256 !== nativeDigest) fail("source-license-native-digest");
    const declared = inventory.declared.get(path);
    if (declared !== undefined && declared !== checkout.sha256)
      fail("source-license-declared-digest");
    return { path, ...checkout };
  });
  const nativeAnnex = members[0].validated.publication.value.annexes.find(
    (annex) => annex.path === NATIVE_ANNEX_PATH,
  );
  const sourceLicenseRecord = {
    annex: { path: NATIVE_ANNEX_PATH, sha256: sha256(Buffer.from(nativeAnnex.bytesBase64, "base64")) },
    files: sourceLicenseFiles.map(({ path, sha256: digest }) => ({ path, sha256: digest })),
    format: "aih-supported-source-license",
    sourceContentDigest: `sha256:${source.treeSha256}`,
    sourceId: source.id,
    sourceRevisionId: source.pinnedCommit,
    version: 1,
  };
  const owners = new Map();
  const memberOf = new Map();
  for (const member of members)
    for (const component of member.validated.components) {
      memberOf.set(component, member);
      for (const entry of component.files) {
        const existing = owners.get(entry.path) ?? [];
        if (existing.some((owner) => owner.files.find((file) => file.path === entry.path)?.sha256 !== entry.sha256))
          fail("publication-set-component-overlap-digest");
        existing.push(component);
        owners.set(entry.path, existing);
      }
    }
  const selectedRows = currentIndex === undefined ? inventory.rows :
    selectCurrentClosureRowsV1(inventory.rows, currentIndex, provider);
  const preservedNames = [];
  const rows = selectedRows.filter((row) => {
    const missing = row.files.some((path) => !owners.has(path));
    if (!missing) return true;
    if (currentIndex === undefined || row.kind !== "mcp") fail("closure-file-unmapped");
    if (row.files.some((path) => owners.has(path))) fail("retained-row-partial-coverage");
    preservedNames.push(row.name);
    return false;
  }).map((row) => {
    const closureFiles = row.files.map((path) => {
      const nativeDigest = native.get(path);
      if (nativeDigest === undefined) fail("closure-file-native-missing");
      const target = resolve(root, ...path.split("/"));
      const { stat } = unlinkedSourcePath(root, target);
      if (!stat.isFile() || stat.nlink > 1) fail("closure-file-shape");
      const checkout = file(target);
      if (checkout.sha256 !== nativeDigest) fail("closure-file-native-digest");
      const declared = inventory.declared.get(path);
      if (declared !== undefined && declared !== checkout.sha256)
        fail("closure-file-declared-digest");
      const owner = owners.get(path);
      if (owner === undefined) fail("closure-file-unmapped");
      return { path, ...checkout, owners: owner };
    });
    const closure = new Set(row.files);
    const involved = [...new Set(closureFiles.flatMap((entry) => entry.owners))].sort((left, right) =>
      codeUnitCompare(left.artifact.scannerComponentId, right.artifact.scannerComponentId),
    );
    const files = closureFiles.map(({ path, bytes, sha256: digest }) => ({ path, bytes, sha256: digest }));
    const cited = new Set(involved.map((component) => memberOf.get(component)));
    return {
      assetId: `${source.id}/${row.kind}:${row.name}`,
      closureFiles: files.map((entry) => ({ digest: `sha256:${entry.sha256}`, path: entry.path })),
      compiler: inventory.compiler,
      ...(row.roots === undefined ? {} : { roots: row.roots, shared: row.shared }),
      componentIds: involved.map((component) => component.artifact.scannerComponentId),
      contentDigest: `sha256:${sha256(JSON.stringify(files.map((entry) => ({ type: "file", ...entry }))))}`,
      coverageComplete: involved.every((component) => component.artifact.coverageComplete === true),
      entryId: `${row.kind}.${provider}.${row.name}`,
      entryPath: row.entryPath,
      findings: unique(involved.flatMap((component) => component.findings).filter(locatedIn(closure))),
      globalCoverage: unique(involved.flatMap((component) => component.globalCoverage)),
      kind: row.kind,
      license: licenseFacts(root, [...new Map([...files, ...sourceLicenseFiles].map((entry) =>
        [entry.path, entry],
      )).values()]),
      locationCoverage: unique(
        involved.flatMap((component) => component.locationCoverage).filter(locatedIn(closure)),
      ),
      publications: members.filter((member) => cited.has(member)),
      requestedAnalyzers: [
        ...new Set(involved.flatMap((component) => component.requestedAnalyzers)),
      ].sort(codeUnitCompare),
      subjectId: row.name,
    };
  });
  return { rows, excluded: inventory.excluded, sourceLicenseRecord, preservedNames };
}

/**
 * The Catalog's curated inventory of one provider at one source and pin, from the Catalog's own
 * committed catalog index (tools/generate-catalog-index.mjs; defaults/catalog-index-v1.json in the
 * package). A curated row of a provider is its seed at
 * `defaults/workbench/<provider>/<entryId>/seed.json`; the index also carries rows of no provider
 * (the collection recipe), which no provider renders and this inventory skips.
 */
function curatedDirectSkillInventory(indexValue, provider, source) {
  const index = object(indexValue, "catalog-index");
  if (index.format !== CATALOG_INDEX_FORMAT || index.version !== CATALOG_INDEX_VERSION)
    fail("catalog-index-format");
  const repository = `${source.owner}/${source.repository}`;
  const entries = new Map();
  for (const value of array(index.entries, "catalog-index-entries")) {
    const entry = object(value, "catalog-index-entry");
    const entryId = text(entry.entryId, "catalog-index-entry-id", 300);
    const subject = object(entry.subject, "catalog-index-subject");
    const name = text(subject.id, "catalog-index-subject-id", 200);
    const kind = text(subject.kind, "catalog-index-subject-kind", 40);
    const seed = object(entry.seed, "catalog-index-seed");
    const seedPath = text(seed.path, "catalog-index-seed-path", 1_024);
    // A row of no provider (the collection's own row) is not a provider's curated row; a
    // defaults/workbench path states its provider and its entry id and must agree with both.
    if (!seedPath.startsWith("defaults/workbench/")) continue;
    const row = /^defaults\/workbench\/([^/]+)\/(.+)\/seed\.json$/.exec(seedPath);
    if (row === null || row[2] !== entryId) fail(`catalog-index-seed-path ${entryId}`);
    if (row[1] !== provider) continue;
    hex(seed.sha256, "catalog-index-seed");
    if (entryId !== `${kind}.${provider}.${name}`) fail(`catalog-index-entry-id ${entryId}`);
    // A direct skill run replaces every row of its provider in the seed manifest, so an inventory
    // of another kind can never be rendered as direct skill rows and is refused, never dropped.
    if (kind !== "skill")
      fail(`mapping-selection-kind ${entryId}: not a curated skill row of provider ${provider}`);
    const declared = object(subject.source, "catalog-index-subject-source");
    if (
      text(declared.repository, "catalog-index-subject-repository", 200) !== repository ||
      hex(declared.commit, "catalog-index-subject-commit", HEX_40) !== source.pinnedCommit
    )
      fail(
        `mapping-selection-pin ${entryId}: ${declared.repository}@${declared.commit} is not ${repository}@${source.pinnedCommit}`,
      );
    if (entries.has(name)) fail(`catalog-index-duplicate ${entryId}`);
    entries.set(name, {
      entryId,
      entryPath: sourceRelative(declared.path, "catalog-index-subject-path"),
    });
  }
  return { entries, provider, repository, pin: source.pinnedCommit };
}

/**
 * A direct skill row's subject is the mapping's `catalogAssetId` (skillRowsOf), and the mapping is
 * Scan's unsigned copy of the consumer's selection, so the selection itself is the Catalog's
 * curated inventory: one row per curated skill of the provider, the curated entry point inside the
 * Scanner component that renders it, and every curated skill covered exactly once. A mapping that
 * drops, adds or rebinds one refuses.
 */
function assertCuratedDirectSkillSelection(inventory, members) {
  const claimed = new Map();
  for (const member of members)
    for (const component of member.validated.components) {
      const { artifact, files } = component;
      const scannerComponentId = artifact.scannerComponentId;
      const prefix = `${member.validated.source.id}/skill:`;
      const assetId = artifact.catalogAssetId;
      const name = assetId.startsWith(prefix) ? assetId.slice(prefix.length) : "";
      const entry = inventory.entries.get(name);
      if (entry === undefined)
        fail(
          `mapping-selection-uncatalogued ${assetId}: no curated skill of provider ${inventory.provider} at ${inventory.repository}@${inventory.pin}`,
        );
      if (!files.some((file) => file.path === entry.entryPath))
        fail(`mapping-selection-unbound ${scannerComponentId} ${entry.entryPath}`);
      if (claimed.has(name)) fail(`mapping-selection-duplicate ${assetId}`);
      claimed.set(name, scannerComponentId);
    }
  for (const [name, entry] of inventory.entries)
    if (!claimed.has(name)) fail(`mapping-selection-unmapped ${entry.entryId}`);
}

/** Direct skill mode: every mapped Scanner component is one skill row with its exact files. */
function skillRows(members, provider, sourceRoot) {
  return members.flatMap((member) => skillRowsOf(member, provider, sourceRoot));
}
function skillRowsOf(member, provider, sourceRoot) {
  const { validated } = member;
  return validated.components.map((component) => {
    const assetId = text(component.artifact.catalogAssetId, "catalog-asset-id", 300);
    const expectedPrefix = `${validated.source.id}/skill:`;
    if (!assetId.startsWith(expectedPrefix)) fail("catalog-asset-source");
    const subjectId = assetId.slice(expectedPrefix.length);
    if (!ID.test(subjectId) || subjectId.includes("/") || subjectId.includes(":"))
      fail("catalog-subject-id");
    const skillFiles = component.files.filter((entry) => posix.basename(entry.path) === "SKILL.md");
    if (skillFiles.length !== 1) fail("component-skill-entrypoint");
    return {
      assetId,
      closureFiles: component.files.map((entry) => ({
        digest: `sha256:${entry.sha256}`,
        path: entry.path,
      })),
      compiler: COMPILERS["pinned-component-collection/v1"],
      contentDigest: `sha256:${component.artifact.treeSha256}`,
      coverageComplete: component.artifact.coverageComplete,
      entryId: `skill.${provider}.${subjectId}`,
      entryPath: skillFiles[0].path,
      findings: component.findings,
      globalCoverage: component.globalCoverage,
      kind: "skill",
      license: licenseFacts(sourceRoot, component.files),
      locationCoverage: component.locationCoverage,
      publications: [member],
      requestedAnalyzers: component.requestedAnalyzers,
      subjectId,
    };
  });
}

/**
 * `members`: the verified publications of one source, one or the members of a publication set
 * ordered by publication digest. Rows are rendered once over their union; each row cites the
 * publications its closure comes from, and a row of one publication renders as it always has.
 */
function renderRows(members, provider, sourceRoot, definition, authoring, currentIndex, preserveRoot) {
  const files = new Map();
  const seedPaths = [];
  const validated = { source: members[0].validated.source };
  const repository = `${validated.source.owner}/${validated.source.repository}`;
  const sourceId = `source:${validated.source.id}`;
  const sourceContentDigest = `sha256:${validated.source.treeSha256}`;
  const locators = new Map(
    members.map(({ handoff }) => [
      handoff,
      releaseLocator(handoff.release, handoff.publisherCommit, handoff.requestSha256),
    ]),
  );
  const closureMode = definition !== undefined;
  const selected = closureMode
    ? closureRows(members, provider, sourceRoot, definition, authoring, currentIndex)
    : { rows: skillRows(members, provider, sourceRoot), excluded: undefined };
  const sourceLicenseBytes = closureMode ? canonical(selected.sourceLicenseRecord) : undefined;
  if (sourceLicenseBytes !== undefined) files.set("source-license.json", sourceLicenseBytes);
  if (selected.preservedNames?.length > 0) {
    if (preserveRoot === undefined) fail("retained-root-required");
    const retained = preserveUnmappedMcpRowsV1({
      root: preserveRoot, index: currentIndex, provider,
      names: selected.preservedNames, sourceCommit: validated.source.pinnedCommit,
    });
    for (const [path, bytes] of retained) files.set(path, bytes);
    for (const name of selected.preservedNames) seedPaths.push(`mcp.${provider}.${name}/seed.json`);
  }
  for (const row of [...selected.rows].sort((left, right) =>
    codeUnitCompare(left.assetId, right.assetId),
  )) {
    const { assetId, subjectId, entryId, kind, license } = row;
    const root = entryId;
    if (files.has(`${root}/seed.json`)) fail("duplicate-row");
    const cited = row.publications;
    const many = cited.length > 1;
    const [{ handoff }] = cited;
    const { signedAt, expiresAt } = cited[0].validated.publication;
    const source = {
      commit: validated.source.pinnedCommit,
      path: row.entryPath,
      repository,
      type: "github",
    };
    const sourceDigest = domainDigest("aih-governance-decision-source/v2", source);
    const subjectDigest = domainDigest("aih-governance-decision-subject/v2", {
      id: subjectId,
      kind,
      sourceDigest,
    });
    const subject = { id: subjectId, kind, source, sourceDigest, subjectDigest };
    const binding = {
      asset: {
        assetId,
        contentDigest: row.contentDigest,
        sourceId,
        sourceRevisionId: validated.source.pinnedCommit,
      },
      compiler: row.compiler,
      format: "aih-compiler-qualification-binding",
      material: {
        files: row.closureFiles,
        kind: "source-files",
        treeDigest: row.contentDigest,
      },
      sourceContentDigest,
      subject,
      version: 1,
    };
    const bindingDigest = domainDigest("aih-compiler-qualification-binding/v1", binding);
    const closure = {
      assetId,
      bindingDigest,
      contentDigest: row.contentDigest,
      files: row.closureFiles,
      format: "aih-supported-catalog-member-closure",
      ...(sourceLicenseBytes === undefined ? {} : { sourceLicense: {
        path: `defaults/workbench/${provider}/source-license.json`,
        sha256: sha256(sourceLicenseBytes),
      } }),
      scope: {
        description: license.determined
          ? `Exact pinned source-file closure and applicable ${license.id} notice; review-only assessment, with no execution or organization admission.`
          : "Exact pinned source-file closure; license not determined; review-only assessment, with no execution or organization admission.",
        kind: "source-files",
      },
      sourceContentDigest,
      sourceId,
      sourceRevisionId: validated.source.pinnedCommit,
      subjectDigest,
      version: 1,
    };
    const findingGroups = new Map();
    for (const finding of row.findings) {
      const analyzer = text(object(finding, "finding").analyzer, "finding-analyzer", 200);
      const group = findingGroups.get(analyzer) ?? [];
      group.push(finding);
      findingGroups.set(analyzer, group);
    }
    const findingPaths = [];
    let findingIndex = 0;
    for (const analyzer of [...findingGroups.keys()].sort(codeUnitCompare)) {
      findingIndex += 1;
      const group = findingGroups.get(analyzer);
      const findingPath = `evidence/findings-${findingIndex}.json`;
      findingPaths.push(findingPath);
      files.set(
        `${root}/${findingPath}`,
        canonical(
          evidence(
            "finding",
            `findings-${findingIndex}`,
            subjectDigest,
            `Unresolved original annex/${analyzer}.json findings: ${group.length}. Canonical full ordered finding group SHA256 ${sha256(canonical(group))}. Full raw findings remain in the immutable Scanner publication; this digest-bound grouping is not a dismissal or a clean scan.`,
          ),
        ),
      );
    }
    const coverageDigest = sha256(
      canonical({
        global: row.globalCoverage,
        locationBound: row.locationCoverage,
      }),
    );
    const gaps = [
      "evidence/coverage-gap.json",
      ...cited.map((_, index) => `evidence/publication-${index + 1}.json`),
      "evidence/scope-gap.json",
    ];
    files.set(
      `${root}/evidence/coverage-gap.json`,
      canonical(
        evidence(
          "gap",
          "coverage-gap",
          subjectDigest,
          `Unresolved Scanner coverage notifications: ${row.locationCoverage.length} location-bound and ${row.globalCoverage.length} global. Canonical full ordered coverage group SHA256 ${coverageDigest}. Full raw notifications remain in the immutable Scanner publication; incomplete analyzer coverage is not a complete or clean scan.`,
        ),
      ),
    );
    cited.forEach((member, index) => {
      const { publicationSha256, requestSha256, receiptSha256 } = member.handoff;
      const observed = member.validated.publication;
      files.set(
        `${root}/evidence/publication-${index + 1}.json`,
        canonical(
          evidence(
            "gap",
            `publication-${index + 1}`,
            subjectDigest,
            `Original immutable Scanner publication SHA256 ${publicationSha256}; request ${requestSha256}; receipt ${receiptSha256}; locator ${locators.get(member.handoff)}. Embedded Ed25519 signature verified for the time-bounded historical observation signed-at ${observed.signedAt} and expires-at ${observed.expiresAt}. Raw reports, findings, and notices remain the source of record; Catalog does not re-sign or refresh them.`,
          ),
        ),
      );
    });
    const immutable = many ? "the immutable publications" : "the immutable publication";
    files.set(
      `${root}/evidence/scope-gap.json`,
      canonical(
        evidence(
          "gap",
          "scope-gap",
          subjectDigest,
          closureMode
            ? `Review-only source-file assessment of the Catalog's curated compiler closure. Scanner authority none; coverageComplete ${row.coverageComplete}. Findings and location-bound notifications of the ${row.componentIds.length} mapped Scanner components are carried here when a location lies in this closure or none is given; their other observations, and repository observations outside mapped closures, remain outside this row and in ${immutable}. No runtime safety, clean scan, execution, installation, service access, cross-platform validation, or organization admission is asserted. Empty capability lists grant no executable effects.`
            : `Review-only source-file assessment. Scanner authority none; coverageComplete ${row.coverageComplete}. Repository observations outside mapped closures remain outside this row and in ${immutable}. No runtime safety, clean scan, execution, installation, service access, cross-platform validation, or organization admission is asserted. Empty capability lists grant no executable effects.`,
        ),
      ),
    );
    const verified = many
      ? `${cited.length} protected Scanner publications of one request set, their receipts and identical native annexes, and the component artifacts of ${row.componentIds.length} Scanner components (${row.componentIds.join(", ")}) verified; each of the ${row.closureFiles.length} closure files matches the pinned checkout and the publications' native per-file hash. Scanner authority none; time-bounded historical observations, each signed-at and expires-at as its publication evidence states; component outcomes observed.`
      : closureMode
      ? `Protected Scanner publication, its receipt and native annex, and the component artifacts of ${row.componentIds.length} Scanner components (${row.componentIds.join(", ")}) verified; each of the ${row.closureFiles.length} closure files matches the pinned checkout and the publication's native per-file hash. Scanner authority none; time-bounded historical observation signed-at ${signedAt}, expires-at ${expiresAt}; component outcomes observed.`
      : `Protected Scanner publication and component artifact verified against the exact source-file closure. Scanner authority none; time-bounded historical observation signed-at ${signedAt}, expires-at ${expiresAt}; component outcome observed.`;
    files.set(
      `${root}/evidence/report.json`,
      canonical(
        evidence(
          "report",
          "report",
          subjectDigest,
          `${verified} Scanner mapped findings: ${row.findings.length}; all ${row.requestedAnalyzers.length} requested analyzers executed successfully. Unresolved coverage notifications: ${row.locationCoverage.length} location-bound and ${row.globalCoverage.length} global. ${many ? `Publications ${cited.map((member) => `sha256:${member.handoff.publicationSha256}`).join(", ")}` : `Publication sha256:${handoff.publicationSha256}`}. No finding cleared or report relabeled.`,
        ),
      ),
    );
    files.set(
      `${root}/evidence/source-right.json`,
      canonical(
        evidence(
          "right",
          "source-right",
          subjectDigest,
          license.determined
            ? `Applicable ${license.id} notice at ${repository}@${validated.source.pinnedCommit}:${license.path}, sha256:${license.sha256}.${license.quotes === undefined ? "" : ` The file's own words: ${license.quotes.map((quote) => `"${quote}"`).join(" ")}.`} Preserve all applicable license terms and notices. No trademark, external-service, or organization-admission rights inferred.`
            : `No applicable license determined for this closure at ${repository}@${validated.source.pinnedCommit}: ${license.reason}. No license grant, trademark, external-service, or organization-admission rights inferred.`,
        ),
      ),
    );
    if (!license.determined) {
      gaps.push("evidence/license-gap.json");
      files.set(
        `${root}/evidence/license-gap.json`,
        canonical(
          evidence(
            "gap",
            "license-not-determined",
            subjectDigest,
            `License not determined: ${license.reason}. The row is rendered with this gap; no license grant is inferred from it.`,
          ),
        ),
      );
    }
    files.set(`${root}/artifacts/closure.json`, canonical(closure));
    files.set(
      `${root}/artifacts/profile.json`,
      canonical({ id: subjectId, kind: "source-evidence-profile", source }),
    );
    files.set(
      `${root}/artifacts/recipe.json`,
      canonical({
        id: `review-${subjectId}`,
        installation: false,
        kind: "review-only",
        organizationAdmission: "not-authoritative",
        source,
      }),
    );
    const listed = (paths) => paths.map((path) => `\`${path}\``).join(", ");
    const shape = [
      ...(row.roots?.length > 1 && kind === "skill"
        ? [
            `Curated source roots: ${listed(row.roots)}; the entry is the canonical root's \`${row.entryPath}\`.`,
          ]
        : []),
      ...(row.shared?.length > 0
        ? [
            `Shared declaration files, listed by the curated definition for several components: ${listed(row.shared)}. A finding located in a shared file is stated on every row whose closure holds it.`,
          ]
        : []),
    ];
    files.set(
      `${root}/artifacts/prose.md`,
      `# ${entryId}\n\nExact review-only source-file assessment at ${repository}@${validated.source.pinnedCommit}:${source.path}. Scanner findings, coverage limits, authority, and dates remain unchanged. This is not a clean-scan declaration, installation approval, runtime authority, or organization admission.\n${shape.map((line) => `\n${line}\n`).join("")}`,
    );
    const seed = {
      artifacts: {
        closure: "artifacts/closure.json",
        profile: "artifacts/profile.json",
        prose: "artifacts/prose.md",
        recipe: "artifacts/recipe.json",
      },
      capabilities: { commands: [], egress: [], hooks: [], mcpTools: [], permissions: [] },
      entryId,
      platforms: [{ architecture: "amd64", os: "linux" }],
      qualification: {
        findings: findingPaths,
        gaps: gaps.sort(codeUnitCompare),
        report: "evidence/report.json",
        rights: ["evidence/source-right.json"],
      },
      subject: { id: subjectId, kind, source },
    };
    files.set(`${root}/seed.json`, canonical(seed));
    seedPaths.push(`${root}/seed.json`);
  }
  return { files, seedPaths, excluded: selected.excluded };
}

function destinationLayout(manifestPath, outputRoot, provider) {
  const manifest = unlinkedAbsolutePath(manifestPath, "manifest");
  if (!manifest.exists || !manifest.stat.isFile()) fail("manifest-file");
  const output = unlinkedAbsolutePath(outputRoot, "output", true);
  if (output.exists) fail("output-already-exists");
  const prefix = pathInside(dirname(manifestPath), outputRoot, "provider-output");
  if (prefix !== `workbench/${provider}`) fail("provider-output-layout");
  const temporary = `${manifestPath}.source-assessment-generator.tmp`;
  if (unlinkedAbsolutePath(temporary, "manifest-temporary", true).exists)
    fail("seed-manifest-temporary-exists");
  return { prefix, temporary };
}
function writeGeneratedRows(outputRoot, files) {
  if (unlinkedAbsolutePath(outputRoot, "output", true).exists) fail("output-already-exists");
  mkdirSync(dirname(outputRoot), { recursive: true });
  const parent = unlinkedAbsolutePath(dirname(outputRoot), "output-parent");
  if (!parent.exists || !parent.stat.isDirectory()) fail("output-parent-directory");
  mkdirSync(outputRoot, { recursive: false });
  try {
    const root = unlinkedAbsolutePath(outputRoot, "output");
    if (!root.exists || !root.stat.isDirectory()) fail("output-directory");
    for (const [relativePath, contents] of [...files.entries()].sort(([left], [right]) =>
      codeUnitCompare(left, right),
    )) {
      const path = resolve(outputRoot, ...relativePath.split("/"));
      pathInside(outputRoot, path, "generated-output");
      mkdirSync(dirname(path), { recursive: true });
      const parent = unlinkedAbsolutePath(dirname(path), "generated-output-parent");
      if (!parent.exists || !parent.stat.isDirectory()) fail("generated-output-parent-directory");
      writeFileSync(path, contents, { encoding: "utf8", flag: "wx" });
    }
  } catch (error) {
    rmSync(outputRoot, { recursive: true, force: true });
    throw error;
  }
}
function prepareManifestUpdate(
  manifestPath,
  generatedSeedPaths,
  { prefix, temporary },
) {
  const read = readJson(manifestPath, "seed-manifest", 4 * 1024 * 1024);
  const manifest = object(read.value, "seed-manifest");
  exactKeys(manifest, ["format", "seeds", "version"], "seed-manifest");
  if (manifest.format !== "aih-supported-candidate-seed-manifest" || manifest.version !== 1)
    fail("seed-manifest-version");
  const current = validateStringSet(manifest.seeds, "seed-manifest-paths").map((path) =>
    sourceRelative(path, "seed-manifest-path"),
  );
  const seedPaths = generatedSeedPaths.map((path) => `${prefix}/${path}`);
  const providerPrefix = `${prefix}/`;
  const seeds = [...current.filter((path) => !path.startsWith(providerPrefix)), ...seedPaths].sort(
    codeUnitCompare,
  );
  if (new Set(seeds).size !== seeds.length) fail("seed-manifest-duplicates");
  return {
    contents: canonical({ format: manifest.format, seeds, version: manifest.version }),
    manifestBytes: read.bytes,
    manifestPath,
    seedPaths,
    temporary,
  };
}
function updateManifest(prepared) {
  const { contents, manifestBytes, manifestPath, seedPaths, temporary } = prepared;
  unlinkedAbsolutePath(manifestPath, "manifest");
  if (!readPinnedFile(manifestPath, 4 * 1024 * 1024).equals(manifestBytes))
    fail("seed-manifest-changed");
  if (unlinkedAbsolutePath(temporary, "manifest-temporary", true).exists)
    fail("seed-manifest-temporary-exists");
  try {
    writeFileSync(temporary, contents, { encoding: "utf8", flag: "wx" });
    const temporaryFile = unlinkedAbsolutePath(temporary, "manifest-temporary");
    if (!temporaryFile.exists || !temporaryFile.stat.isFile() || temporaryFile.stat.nlink !== 1)
      fail("seed-manifest-temporary-shape");
    unlinkedAbsolutePath(manifestPath, "manifest");
    renameSync(temporary, manifestPath);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
  return seedPaths;
}

/**
 * Renders the review-only rows of one provider from verified publications.
 *
 * The selection never comes from the unsigned handoff. Closure rows (`definitionPath`) are one row
 * per curated Catalog component of the Catalog's pinned definition, and a mapped component that is
 * dropped leaves its closure files unowned (`closure-file-unmapped`). Direct skill rows
 * (`catalogIndexPath`) are one row per mapped Scanner component, and the row's subject is the
 * mapping's `catalogAssetId`, so the selection and every subject come from the Catalog's own
 * curated inventory (its committed catalog index; `assertCuratedDirectSkillSelection`).
 */
export function generateSourceAssessmentRowsV1({
  sourceRoot,
  handoffPath,
  publicationPath,
  attestationPath,
  provider,
  outputRoot,
  manifestPath,
  definitionPath,
  authoringCatalogPath,
  catalogIndexPath,
  currentIndexPath,
  preserveRoot,
  definitionOverlap = "disjoint",
}) {
  definitionOverlapMode(definitionOverlap);
  if (!PROVIDER.test(text(provider, "provider", 80))) fail("provider");
  // One publication, or the members of one publication set as handoff/publication pairs (D49),
  // each with the Sigstore bundle of its outer attestation.
  const handoffPaths = Array.isArray(handoffPath) ? handoffPath : [handoffPath];
  const publicationPaths = Array.isArray(publicationPath) ? publicationPath : [publicationPath];
  const attestationPaths = Array.isArray(attestationPath) ? attestationPath : [attestationPath];
  if (
    handoffPaths.length === 0 ||
    handoffPaths.length !== publicationPaths.length ||
    handoffPaths.length !== attestationPaths.length
  )
    fail("publication-set-pairs");
  for (const [label, value] of [
    ["sourceRoot", sourceRoot],
    ...handoffPaths.map((path) => ["handoffPath", path]),
    ...publicationPaths.map((path) => ["publicationPath", path]),
    ...attestationPaths.map((path) => ["attestationPath", path]),
    ["outputRoot", outputRoot],
    ["manifestPath", manifestPath],
    ...(definitionPath === undefined ? [] : [["definitionPath", definitionPath]]),
    ...(authoringCatalogPath === undefined ? [] : [["authoringCatalogPath", authoringCatalogPath]]),
    ...(catalogIndexPath === undefined ? [] : [["catalogIndexPath", catalogIndexPath]]),
    ...(currentIndexPath === undefined ? [] : [["currentIndexPath", currentIndexPath]]),
    ...(preserveRoot === undefined ? [] : [["preserveRoot", preserveRoot]]),
  ])
    if (typeof value !== "string" || !isAbsolute(value)) fail(`${label}-absolute`);
  // A direct skill row states the mapping's catalogAssetId as its subject, so its selection has to
  // come from the Catalog's curated inventory, never from the handoff's own copy of the mapping.
  if (definitionPath === undefined && catalogIndexPath === undefined)
    fail(
      "direct-skill-selection-unauthored: direct skill rows need the Catalog's curated inventory (--catalog-index <aih-catalog-index>); the handoff's mapping is not a selection authority",
    );
  if (definitionPath !== undefined && catalogIndexPath !== undefined)
    fail("catalog-index-with-definition");
  if ((currentIndexPath === undefined) !== (preserveRoot === undefined) ||
      (currentIndexPath !== undefined && definitionPath === undefined))
    fail("retained-row-arguments");
  handoffPaths.forEach((path, index) => {
    if (dirname(resolve(path)) !== dirname(resolve(publicationPaths[index])))
      fail("publication-handoff-directory");
  });
  // Closure-row mode reads the Catalog's curated definition at the publication's pin.
  const definition =
    definitionPath === undefined
      ? undefined
      : readJson(definitionPath, "definition", 64 * 1024 * 1024).value;
  // Direct skill rows read the Catalog's curated inventory of the provider (its catalog index).
  const catalogIndex =
    catalogIndexPath === undefined
      ? undefined
      : readJson(catalogIndexPath, "catalog-index", 64 * 1024 * 1024).value;
  const currentIndex = currentIndexPath === undefined ? undefined :
    readJson(currentIndexPath, "current-index", 64 * 1024 * 1024).value;
  // The external-inventory MCP rows come from the Catalog's policy authoring catalog (D61).
  if (authoringCatalogPath !== undefined && definition === undefined)
    fail("authoring-catalog-without-definition");
  const authoring =
    authoringCatalogPath === undefined
      ? undefined
      : readJson(authoringCatalogPath, "authoring-catalog", 64 * 1024 * 1024).value;
  const members = handoffPaths.map((path, index) => {
    const handoff = readJson(path, "handoff", MAX_INPUT_BYTES).value;
    const publicationBytes = readPinnedFile(publicationPaths[index], MAX_INPUT_BYTES);
    const attestationBytes = readPinnedFile(attestationPaths[index], 4 * 1024 * 1024);
    const validated = validateHandoff(
      handoff,
      publicationBytes,
      attestationBytes,
      sourceRoot,
      path,
      definition !== undefined,
    );
    return { handoff, validated };
  });
  if (members.length > 1) {
    assertPublicationSetV1(members.map(({ validated }) => validated.publication.value), definitionOverlap);
    const components = members.map(({ validated }) =>
        validated.components.map(({ artifact, files }) => ({
          id: artifact.scannerComponentId,
          paths: artifact.paths,
          files,
        })),
      );
    if (definitionOverlap === "disjoint") assertDisjointOwnership(components);
    else assertCompilerCatalogOwnership(components);
    members.sort((left, right) =>
      codeUnitCompare(left.handoff.publicationSha256, right.handoff.publicationSha256),
    );
  }
  // The direct skill selection is the Catalog's curated inventory of this provider, at this source
  // and pin; the handoff's mapping is only the claim that is compared with it.
  if (catalogIndex !== undefined)
    assertCuratedDirectSkillSelection(
      curatedDirectSkillInventory(catalogIndex, provider, members[0].validated.source),
      members,
    );
  const rendered = renderRows(members, provider, sourceRoot, definition, authoring, currentIndex, preserveRoot);
  const layout = destinationLayout(manifestPath, outputRoot, provider);
  const preparedManifest = prepareManifestUpdate(manifestPath, rendered.seedPaths, layout);
  writeGeneratedRows(outputRoot, rendered.files);
  let seedPaths;
  try {
    seedPaths = updateManifest(preparedManifest);
  } catch (error) {
    rmSync(outputRoot, { recursive: true, force: true });
    throw error;
  }
  return rendered.excluded === undefined
    ? { entries: rendered.seedPaths.length, seedPaths }
    : { entries: rendered.seedPaths.length, excluded: rendered.excluded, seedPaths };
}

function argumentsFrom(argv) {
  const values = new Map();
  // A publication set is named as repeated --handoff/--publication/--attestation triples, in the
  // same order.
  const pairs = { handoff: [], publication: [], attestation: [] };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) fail("arguments");
    const name = key.slice(2);
    if (Object.hasOwn(pairs, name)) {
      pairs[name].push(resolve(value));
      values.set(name, value);
      continue;
    }
    if (values.has(name)) fail("duplicate-argument");
    values.set(name, value);
  }
  if (
    pairs.handoff.length !== pairs.publication.length ||
    pairs.handoff.length !== pairs.attestation.length
  )
    fail("arguments");
  const expected = [
    "source-root",
    "handoff",
    "publication",
    "attestation",
    "provider",
    "output-root",
    "manifest",
  ];
  const optional = ["definition", "authoring-catalog", "catalog-index", "definition-overlap", "current-index", "preserve-root"];
  if (
    expected.some((name) => !values.has(name)) ||
    [...values.keys()].some((name) => !expected.includes(name) && !optional.includes(name))
  )
    fail("arguments");
  return {
    sourceRoot: resolve(values.get("source-root")),
    handoffPath: pairs.handoff.length === 1 ? pairs.handoff[0] : pairs.handoff,
    publicationPath: pairs.publication.length === 1 ? pairs.publication[0] : pairs.publication,
    attestationPath: pairs.attestation.length === 1 ? pairs.attestation[0] : pairs.attestation,
    provider: values.get("provider"),
    outputRoot: resolve(values.get("output-root")),
    manifestPath: resolve(values.get("manifest")),
    ...(values.has("definition") ? { definitionPath: resolve(values.get("definition")) } : {}),
    ...(values.has("authoring-catalog")
      ? { authoringCatalogPath: resolve(values.get("authoring-catalog")) }
      : {}),
    ...(values.has("catalog-index")
      ? { catalogIndexPath: resolve(values.get("catalog-index")) }
      : {}),
    ...(values.has("current-index")
      ? { currentIndexPath: resolve(values.get("current-index")) }
      : {}),
    ...(values.has("preserve-root")
      ? { preserveRoot: resolve(values.get("preserve-root")) }
      : {}),
    ...(values.has("definition-overlap")
      ? { definitionOverlap: values.get("definition-overlap") }
      : {}),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = generateSourceAssessmentRowsV1(argumentsFrom(process.argv.slice(2)));
    process.stdout.write(`${canonical(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "source-assessment-generator:failed"}\n`);
    process.exitCode = 1;
  }
}
