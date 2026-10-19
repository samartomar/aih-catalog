// Runs after copying into an isolated installed-package consumer.
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createContentInventory, readContentInventory, readRelease, configureItem } from "@aihq/catalog/reader";
import { validateSelectionSet } from "@aihq/catalog/reader";
import { acquireBaselineArtifact, prepareReleaseBaseline, readInstalledRelease } from "@aihq/catalog/node";
import { readArtifact, readContentCoverage } from "@aihq/scan/read";
import { signArtifact, prepareArtifact } from "@aihq/scan/host";
import { authenticateEvidence } from "@aihq/core";
import { defaultLimits } from "@aihq/scan/contracts";

const [out] = process.argv.slice(2), require = createRequire(import.meta.url);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const canonical = v => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v)
  ? `[${v.map(canonical).join(",")}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
const scanBytes = value => Buffer.from(canonical(value));
const releaseBytes = value => Buffer.from(`${canonical(value)}\n`);
const member = (path, bytes) => ({ path, sha256: hash(bytes), byteLength: bytes.length });
const candidate = join(out, "candidate"); mkdirSync(candidate);
const installed = dirname(require.resolve("@aihq/catalog/package.json"));
for (const entry of readdirSync(installed)) if (entry !== "release") cpSync(join(installed, entry), join(candidate, entry), { recursive: true });
const manifestPath = join(candidate, "package.json"), manifest = JSON.parse(readFileSync(manifestPath));
for (const [key, target] of Object.entries(manifest.exports)) if (typeof target === "string" && target.startsWith("./release/") && key !== "./release.json") delete manifest.exports[key];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const put = (path, bytes) => { mkdirSync(dirname(join(candidate, path)), { recursive: true }); writeFileSync(join(candidate, path), bytes); };
const items = [];
for (const id of ["alpha", "beta"]) {
  const text = Buffer.from(`Fixture ${id}\n`), material = { id: "text", ...member(`release/materials/${id}.txt`, text) };
  const target = { root: "project", segments: [{ literal: `${id}.txt` }] };
  const recipe = { schema: "urn:aihq:core:recipe:1.0.0", id, description: "Place ordinary fixture content", inputs: {}, materials: [{ id: "text", sha256: material.sha256, byteLength: material.byteLength }],
    targets: ["project"], prerequisites: [], operations: [{ id: "write", kind: "file.write", purpose: "Place fixture text", scope: "project", target, material: "text", requires: [], checks: [] }], checks: [] };
  const bytes = releaseBytes(recipe), descriptor = { id, schema: recipe.schema, ...member(`release/recipes/${id}.json`, bytes) };
  put(material.path, text); put(descriptor.path, bytes);
  items.push({ id, label: id, kind: "skill", sourceIds: ["fixture"], scopes: ["project"], targets: [], inputs: {}, recipe: descriptor, materials: [material],
    dependencies: { requires: id === "beta" ? [{ itemId: "alpha" }] : [], optional: [], conflicts: [] }, metadata: { fixture: true } });
}
const content = { schema: "urn:aihq:catalog:release:1.4.0", package: { name: manifest.name, version: manifest.version },
  sources: [{ id: "fixture", origin: { kind: "authored" } }], items, metadata: { unrelated: "inventoried" } };
const contentBytes = releaseBytes(content), inventory = createContentInventory(contentBytes, { expectedSha256: hash(contentBytes) });
assert(inventory.valid, JSON.stringify(inventory));
const descriptor = member("release/content-inventory.json", inventory.bytes); put(descriptor.path, inventory.bytes);
assert(readContentInventory(inventory.bytes, { expectedSha256: descriptor.sha256 }).valid);
const entries = [{ kind: "directory", path: "release" }, { kind: "file", ...descriptor },
  { kind: "directory", path: "release/recipes" }, { kind: "file", ...member(items[0].recipe.path, readFileSync(join(candidate, items[0].recipe.path))) }].sort((a,b) => a.path < b.path ? -1 : 1);
const paths = entries.filter(e => e.kind === "file").map(e => e.path);
const configHash = hash(scanBytes({})), producer = { name: "@aihq/scan", version: "0.5.0" };
const observationBody = { format: "aih-observation-v1", input: { detectorId: "fixture-success", detectorVersion: "1", adapterSha256: hash("adapter"), rulesSha256: hash("rules"), configurationSha256: configHash,
  profileId: "fixture", profileSha256: hash("profile"), platform: { os: "independent", architecture: "independent", relevantFactsSha256: configHash }, scopeKind: "selected-closure", targetPaths: paths, entries },
  startedAt: "2026-10-19T00:00:00.000Z", completedAt: "2026-10-19T00:00:01.000Z", producer, coverage: { coveredPaths: paths }, findings: [], gaps: [], annexIds: [] };
const observation = { observationId: `observation:sha256:${hash(Buffer.concat([Buffer.from("aih.scan.observation.v1\0"), scanBytes(observationBody)]))}`, origin: "fresh", body: observationBody };
function report(allFailed = false, createdAt = "2026-10-19T00:00:02.000Z") {
  return { schema: "urn:aihq:scan:report:1.0.0", producer, createdAt,
    source: { kind: "local", capture: { profile: "aih-source-capture-1", entries, captureSha256: hash(scanBytes({ domain: "aih.scan.capture.v1", profile: "aih-source-capture-1", entries })) } },
    selection: { paths, excludedPaths: [] }, requestedDetectors: ["fixture-failed", "fixture-success"].map(detectorId => ({ detectorId, profileId: "fixture", configuration: {}, configurationSha256: configHash })),
    results: ["fixture-failed", "fixture-success"].map(detectorId => { const succeeded = detectorId === "fixture-success" && !allFailed; return { detectorId, outcome: succeeded ? "succeeded" : "failed",
      observations: succeeded ? [observation] : [], coverage: { coveredPaths: succeeded ? paths : [], excludedPaths: [], uncoveredPaths: succeeded ? [] : paths, complete: succeeded },
      diagnostics: succeeded ? [] : [{ code: "fixture-failure", detail: "Provider unavailable in this fixture" }] }; }),
    completion: "partial", annexes: [], effectiveLimits: defaultLimits, diagnostics: [] };
}
const { publicKey, privateKey } = generateKeyPairSync("ed25519"), spki = publicKey.export({ type: "spki", format: "der" });
const keyId = `ed25519:${hash(spki)}`, trust = { keys: [{ identity: "catalog-baseline-fixture", keyId, publicKeySpkiBase64: spki.toString("base64") }], publishers: [] };
const s1 = await signArtifact({ report: report(), annexes: [], signer: { privateKey, keyId } });
put("release/baseline.json", s1.bytes);
const binding = artifact => ({ schema: "urn:aihq:catalog:scan-baseline:1.0.0", inventory: descriptor, scanId: artifact.scanId,
  artifact: { sha256: hash(artifact.bytes), byteLength: artifact.bytes.length, location: { kind: "package", path: "release/baseline.json" } },
  scope: { namespace: "package-relative", paths, excludedPaths: [] } });
const services = { readArtifact, readContentCoverage, authenticateEvidence, acquireArtifact: artifact => acquireBaselineArtifact(artifact, { packageRoot: candidate }) };
const request = { contentBytes, expectedSha256: hash(contentBytes), baseline: binding(s1), trust };
const result = await prepareReleaseBaseline(request, services);
assert(result.valid, JSON.stringify(result));
assert.equal(result.authentication.producerIdentity, "catalog-baseline-fixture");
assert.equal(result.itemCoverage[0].members[0].observationIds.length, 1);
assert.equal(result.itemCoverage[0].members[1].capture, "mismatched");
assert(result.itemCoverage[1].members.every(m => m.capture === "mismatched"));
put("release/release.json", result.releaseBytes);
const acquired = await readInstalledRelease({ root: candidate }); assert(acquired.valid, JSON.stringify(acquired));
for (const item of items) assert(configureItem({ release: acquired.release, itemId: item.id, configuration: {}, materialSource: acquired.source }).valid);
const expanded = validateSelectionSet({ releases: { [acquired.release.sha256]: acquired.release }, selections: acquired.release.items.map(item => ({
  id: item.id, item: { releaseSha256: acquired.release.sha256, itemId: item.id, itemSha256: item.itemSha256 }, configuration: {},
})) });
assert(expanded.valid, JSON.stringify(expanded)); assert.deepEqual(expanded.requiresBySelectionId.beta, ["alpha"]);
const reused = await prepareReleaseBaseline(request, services); assert(reused.valid);
assert.deepEqual(reused.releaseBytes, result.releaseBytes);
const failures = {};
async function refused(name, input, override = {}) {
  const value = await prepareReleaseBaseline(input, { ...services, ...override });
  assert.equal(value.valid, false, name); failures[name] = value.diagnostics.map(d => d.reason);
}
const changedBytes = releaseBytes({ ...content, metadata: { unrelated: "changed C2" } });
await refused("changed-content", { ...request, contentBytes: changedBytes, expectedSha256: hash(changedBytes) });
await refused("missing", { ...request, baseline: undefined });
await refused("trust", { ...request, trust: { keys: [], publishers: [] } });
await refused("unavailable", request, { acquireArtifact: async () => { throw new Error("fixture unavailable"); } });
await refused("artifact-digest", request, { acquireArtifact: async () => Buffer.from("wrong") });
await refused("scan-id", { ...request, baseline: { ...request.baseline, scanId: `scan:sha256:${"0".repeat(64)}` } });
await refused("scope", { ...request, baseline: { ...request.baseline, scope: { ...request.baseline.scope, paths: [descriptor.path] } } });
const malformed = Buffer.from("unreadable");
await refused("unreadable", { ...request, baseline: { ...request.baseline, artifact: { ...request.baseline.artifact, sha256: hash(malformed), byteLength: malformed.length } } }, { acquireArtifact: async () => malformed });
const unsigned = await prepareArtifact({ report: report(), annexes: [] });
await refused("unsigned", { ...request, baseline: binding(unsigned) }, { acquireArtifact: async () => unsigned.bytes });
const unsupportedReport = scanBytes({ ...report(), schema: "urn:aihq:scan:report:999.0.0" });
const unsupportedId = `scan:sha256:${hash(Buffer.concat([Buffer.from("aih.scan.report.v1\0"), unsupportedReport]))}`;
const unsupportedBytes = scanBytes({ ...unsigned.artifact, scanId: unsupportedId, report: {
  schema: "urn:aihq:scan:report:999.0.0", mediaType: "application/json", sha256: hash(unsupportedReport), byteLength: unsupportedReport.length, bytesBase64: unsupportedReport.toString("base64"),
} });
const unsupported = { bytes: unsupportedBytes, scanId: unsupportedId };
await refused("unsupported-report", { ...request, baseline: binding(unsupported) }, { acquireArtifact: async () => unsupportedBytes });
const badSignature = structuredClone(s1.artifact);
const signature = Buffer.from(badSignature.attestation.dsseEnvelope.signatures[0].sig, "base64"); signature[0] ^= 1;
badSignature.attestation.dsseEnvelope.signatures[0].sig = signature.toString("base64");
const badSignatureBytes = scanBytes(badSignature);
await refused("invalid-signature", { ...request, baseline: binding({ scanId: s1.scanId, bytes: badSignatureBytes }) }, { acquireArtifact: async () => badSignatureBytes });
const allFailed = await signArtifact({ report: report(true), annexes: [], signer: { privateKey, keyId } });
const failedResult = await prepareReleaseBaseline({ ...request, baseline: binding(allFailed) }, { ...services, acquireArtifact: async () => allFailed.bytes });
assert(failedResult.valid, JSON.stringify(failedResult));
assert(failedResult.itemCoverage.every(i => i.members.every(m => m.observationIds.length === 0)));
const wrongCapture = report(true);
wrongCapture.source.capture.entries = wrongCapture.source.capture.entries.map(entry => entry.path === descriptor.path ? { ...entry, sha256: "0".repeat(64) } : entry);
wrongCapture.source.capture.captureSha256 = hash(scanBytes({ domain: "aih.scan.capture.v1", profile: "aih-source-capture-1", entries: wrongCapture.source.capture.entries }));
const mismatch = await signArtifact({ report: wrongCapture, annexes: [], signer: { privateKey, keyId } });
await refused("inventory-capture", { ...request, baseline: binding(mismatch) }, { acquireArtifact: async () => mismatch.bytes });
// Reading later independently supplied evidence leaves R's pinned baseline unchanged.
// Actual saved policy/review/prepared-action preservation needs downstream consumer proof.
const s2 = await signArtifact({ report: report(false, "2026-10-20T00:00:02.000Z"), annexes: [], signer: { privateKey, keyId } });
const later = await readArtifact(s2.bytes);
assert.equal((await readContentCoverage({ read: later, descriptors: [descriptor] })).status, "matched");
assert.equal((await authenticateEvidence({ bytes: s2.bytes, expectedScanId: s2.scanId, trust })).status, "authenticated");
assert.notEqual(s2.scanId, s1.scanId);
assert.equal(readRelease(result.releaseBytes, { expectedSha256: hash(result.releaseBytes) }).release.baseline.scanId, s1.scanId);
// Old ordinary content still reads/configures without any evidence.
assert(readRelease(contentBytes, { expectedSha256: hash(contentBytes) }).valid);
const retained = { schema: "catalog-baseline-fixture-proof-v1", contentSha256: descriptor.sha256, inventoryPath: descriptor.path,
  releaseSha256: hash(result.releaseBytes), scanId: s1.scanId, laterScanId: s2.scanId, failures, itemCoverage: result.itemCoverage,
  partialAccepted: true, allFailedAccepted: true, reuseAccepted: true, secondItemConfigured: true, baselinePinUnchanged: true };
writeFileSync(join(out, "scenario-result.json"), JSON.stringify(retained, null, 2));
writeFileSync(join(out, "fixture-trust.json"), releaseBytes(trust));
writeFileSync(join(out, "later-s2.json"), s2.bytes);
writeFileSync(join(out, "content.json"), contentBytes);
writeFileSync(join(out, "binding.json"), releaseBytes(binding(s1)));
console.log(JSON.stringify(retained));
