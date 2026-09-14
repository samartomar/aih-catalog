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
  const stat = lstatSync(sourceRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("source-root-real-directory");
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
  return { signedAt, expiresAt };
}

function validateHandoff(handoff, publicationBytes, sourceRoot, handoffPath) {
  exactKeys(handoff, HANDOFF_KEYS, "handoff");
  if (
    handoff.protocol !== "ScannerPublicationConsumerHandoffV1" ||
    handoff.authority !== "none" ||
    handoff.outcome !== "observed_with_gaps" ||
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
  const attestation = object(handoff.attestation, "handoff-attestation");
  if (
    object(object(attestation.subject, "attestation-subject").digest, "attestation-digest")
      .sha256 !== handoff.publicationSha256 ||
    attestation.sourceRepositoryDigest !== handoff.publisherCommit ||
    attestation.sourceRepositoryRef !== "refs/heads/main" ||
    attestation.runnerEnvironment !== "github-hosted" ||
    !Number.isSafeInteger(attestation.verifiedTimestampCount) ||
    attestation.verifiedTimestampCount < 1
  )
    fail("handoff-attestation-custody");
  const analyzerGaps = object(handoff.analyzerGaps, "analyzer-gaps");
  if (
    array(analyzerGaps.missingAnalyzers, "missing-analyzers").length !== 0 ||
    array(analyzerGaps.failedAnalyzers, "failed-analyzers").length !== 0 ||
    analyzerGaps.errorNotificationCount !== 0
  )
    fail("analyzer-execution-incomplete");
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
  const components = [];
  let mappedFindingCount = 0;
  for (const summary of summarized) {
    exactKeys(summary, HANDOFF_COMPONENT_KEYS, "handoff-component");
    const scannerComponentId = text(summary.scannerComponentId, "scanner-component-id", 300);
    const mappingComponent = mappedById.get(scannerComponentId);
    if (mappingComponent === undefined) fail("partial-component-mapping");
    if (
      summary.catalogAssetId !== mappingComponent.catalogAssetId ||
      summary.content !== "skill" ||
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
      artifact.content !== "skill" ||
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

function licenseFor(sourceRoot, files) {
  const candidates = files.filter((entry) => /^LICENSE(?:\..+)?$/i.test(posix.basename(entry.path)));
  if (candidates.length !== 1) fail("component-license-count");
  const candidate = candidates[0];
  const path = resolve(sourceRoot, ...candidate.path.split("/"));
  const contents = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    readPinnedFile(path, 512 * 1024),
  );
  if (contents.includes("Apache License") && contents.includes("Version 2.0"))
    return { id: "Apache-2.0", ...candidate };
  if (contents.includes("MIT License") && contents.includes("Permission is hereby granted"))
    return { id: "MIT", ...candidate };
  fail("component-license-unrecognized");
}
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
function renderRows(validated, handoff, provider, sourceRoot) {
  const files = new Map();
  const seedPaths = [];
  const repository = `${validated.source.owner}/${validated.source.repository}`;
  const sourceId = `source:${validated.source.id}`;
  const sourceContentDigest = `sha256:${validated.source.treeSha256}`;
  const locator = releaseLocator(handoff.release, handoff.publisherCommit, handoff.requestSha256);
  for (const component of [...validated.components].sort((left, right) =>
    codeUnitCompare(left.artifact.catalogAssetId, right.artifact.catalogAssetId),
  )) {
    const assetId = text(component.artifact.catalogAssetId, "catalog-asset-id", 300);
    const expectedPrefix = `${validated.source.id}/skill:`;
    if (!assetId.startsWith(expectedPrefix)) fail("catalog-asset-source");
    const subjectId = assetId.slice(expectedPrefix.length);
    if (!ID.test(subjectId) || subjectId.includes("/") || subjectId.includes(":"))
      fail("catalog-subject-id");
    const entryId = `skill.${provider}.${subjectId}`;
    const root = entryId;
    const skillFiles = component.files.filter((entry) => posix.basename(entry.path) === "SKILL.md");
    if (skillFiles.length !== 1) fail("component-skill-entrypoint");
    const source = {
      commit: validated.source.pinnedCommit,
      path: skillFiles[0].path,
      repository,
      type: "github",
    };
    const sourceDigest = domainDigest("aih-governance-decision-source/v2", source);
    const subjectDigest = domainDigest("aih-governance-decision-subject/v2", {
      id: subjectId,
      kind: "skill",
      sourceDigest,
    });
    const subject = { id: subjectId, kind: "skill", source, sourceDigest, subjectDigest };
    const contentDigest = `sha256:${component.artifact.treeSha256}`;
    const closureFiles = component.files.map((entry) => ({
      digest: `sha256:${entry.sha256}`,
      path: entry.path,
    }));
    const binding = {
      asset: {
        assetId,
        contentDigest,
        sourceId,
        sourceRevisionId: validated.source.pinnedCommit,
      },
      compiler: {
        id: "pinned-component-collection",
        inputFormat: "pinned-component-collection/v1",
        version: "1",
      },
      format: "aih-compiler-qualification-binding",
      material: {
        files: closureFiles,
        kind: "source-files",
        treeDigest: contentDigest,
      },
      sourceContentDigest,
      subject,
      version: 1,
    };
    const bindingDigest = domainDigest("aih-compiler-qualification-binding/v1", binding);
    const license = licenseFor(sourceRoot, component.files);
    const closure = {
      assetId,
      bindingDigest,
      contentDigest,
      files: closureFiles,
      format: "aih-supported-catalog-member-closure",
      scope: {
        description: `Exact pinned source-file closure and applicable ${license.id} notice; review-only assessment, with no execution or organization admission.`,
        kind: "source-files",
      },
      sourceContentDigest,
      sourceId,
      sourceRevisionId: validated.source.pinnedCommit,
      subjectDigest,
      version: 1,
    };
    const findingGroups = new Map();
    for (const finding of component.findings) {
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
        global: component.globalCoverage,
        locationBound: component.locationCoverage,
      }),
    );
    const coveragePath = "evidence/coverage-gap.json";
    files.set(
      `${root}/${coveragePath}`,
      canonical(
        evidence(
          "gap",
          "coverage-gap",
          subjectDigest,
          `Unresolved Scanner coverage notifications: ${component.locationCoverage.length} location-bound and ${component.globalCoverage.length} global. Canonical full ordered coverage group SHA256 ${coverageDigest}. Full raw notifications remain in the immutable Scanner publication; incomplete analyzer coverage is not a complete or clean scan.`,
        ),
      ),
    );
    files.set(
      `${root}/evidence/publication-1.json`,
      canonical(
        evidence(
          "gap",
          "publication-1",
          subjectDigest,
          `Original immutable Scanner publication SHA256 ${handoff.publicationSha256}; request ${handoff.requestSha256}; receipt ${handoff.receiptSha256}; locator ${locator}. Embedded Ed25519 signature verified for the time-bounded historical observation signed-at ${validated.publication.signedAt} and expires-at ${validated.publication.expiresAt}. Raw reports, findings, and notices remain the source of record; Catalog does not re-sign or refresh them.`,
        ),
      ),
    );
    files.set(
      `${root}/evidence/scope-gap.json`,
      canonical(
        evidence(
          "gap",
          "scope-gap",
          subjectDigest,
          `Review-only source-file assessment. Scanner authority none; coverageComplete ${component.artifact.coverageComplete}. Repository observations outside mapped closures remain outside this row and in the immutable publication. No runtime safety, clean scan, execution, installation, service access, cross-platform validation, or organization admission is asserted. Empty capability lists grant no executable effects.`,
        ),
      ),
    );
    files.set(
      `${root}/evidence/report.json`,
      canonical(
        evidence(
          "report",
          "report",
          subjectDigest,
          `Protected Scanner publication and component artifact verified against the exact source-file closure. Scanner authority none; time-bounded historical observation signed-at ${validated.publication.signedAt}, expires-at ${validated.publication.expiresAt}; component outcome observed. Scanner mapped findings: ${component.findings.length}; all ${component.requestedAnalyzers.length} requested analyzers executed successfully. Unresolved coverage notifications: ${component.locationCoverage.length} location-bound and ${component.globalCoverage.length} global. Publication sha256:${handoff.publicationSha256}. No finding cleared or report relabeled.`,
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
          `Applicable ${license.id} notice at ${repository}@${validated.source.pinnedCommit}:${license.path}, sha256:${license.sha256}. Preserve all applicable license terms and notices. No trademark, external-service, or organization-admission rights inferred.`,
        ),
      ),
    );
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
    files.set(
      `${root}/artifacts/prose.md`,
      `# ${entryId}\n\nExact review-only source-file assessment at ${repository}@${validated.source.pinnedCommit}:${source.path}. Scanner findings, coverage limits, authority, and dates remain unchanged. This is not a clean-scan declaration, installation approval, runtime authority, or organization admission.\n`,
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
        gaps: [coveragePath, "evidence/publication-1.json", "evidence/scope-gap.json"],
        report: "evidence/report.json",
        rights: ["evidence/source-right.json"],
      },
      subject: { id: subjectId, kind: "skill", source },
    };
    files.set(`${root}/seed.json`, canonical(seed));
    seedPaths.push(`${root}/seed.json`);
  }
  return { files, seedPaths };
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

export function generateSourceAssessmentRowsV1({
  sourceRoot,
  handoffPath,
  publicationPath,
  provider,
  outputRoot,
  manifestPath,
}) {
  if (!PROVIDER.test(text(provider, "provider", 80))) fail("provider");
  for (const [label, value] of Object.entries({
    sourceRoot,
    handoffPath,
    publicationPath,
    outputRoot,
    manifestPath,
  }))
    if (typeof value !== "string" || !isAbsolute(value)) fail(`${label}-absolute`);
  if (dirname(resolve(handoffPath)) !== dirname(resolve(publicationPath)))
    fail("publication-handoff-directory");
  const handoffRead = readJson(handoffPath, "handoff", MAX_INPUT_BYTES);
  const publicationBytes = readPinnedFile(publicationPath, MAX_INPUT_BYTES);
  const handoff = handoffRead.value;
  const validated = validateHandoff(handoff, publicationBytes, sourceRoot, handoffPath);
  const rendered = renderRows(validated, handoff, provider, sourceRoot);
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
  return { entries: rendered.seedPaths.length, seedPaths };
}

function argumentsFrom(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) fail("arguments");
    const name = key.slice(2);
    if (values.has(name)) fail("duplicate-argument");
    values.set(name, value);
  }
  const expected = [
    "source-root",
    "handoff",
    "publication",
    "provider",
    "output-root",
    "manifest",
  ];
  if (
    values.size !== expected.length ||
    expected.some((name) => !values.has(name)) ||
    [...values.keys()].some((name) => !expected.includes(name))
  )
    fail("arguments");
  return {
    sourceRoot: resolve(values.get("source-root")),
    handoffPath: resolve(values.get("handoff")),
    publicationPath: resolve(values.get("publication")),
    provider: values.get("provider"),
    outputRoot: resolve(values.get("output-root")),
    manifestPath: resolve(values.get("manifest")),
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
