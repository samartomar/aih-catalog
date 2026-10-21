// Run only in a disposable installed public runtime. All reports are fixtures.
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContentInventory } from "@aihq/catalog/reader";
import { signArtifact } from "@aihq/scan/host";
import { defaultLimits } from "@aihq/scan/contracts";
let input = ""; for await (const chunk of process.stdin) input += chunk;
const { out } = JSON.parse(input);
mkdirSync(out);
const software = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const canonical = value => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const spki = publicKey.export({ type: "spki", format: "der" }), keyId = `ed25519:${hash(spki)}`;
const trust = Buffer.from(`${canonical({ keys: [{ identity: "package-fixture", keyId, publicKeySpkiBase64: spki.toString("base64") }], publishers: [] })}\n`);
const trustPath = join(out, "fixture-trust.json"); writeFileSync(trustPath, trust);
const views = [];
for (const id of ["default", "extensions", "ecc", "superpowers", "anthropic"]) {
  const exported = id === "default" ? "./release.json" : `./release-${id}.json`;
  const contentPath = fileURLToPath(import.meta.resolve(`@aihq/catalog/${exported.slice(2)}`));
  const content = readFileSync(contentPath), inventory = createContentInventory(content, { expectedSha256: hash(content) });
  assert(inventory.valid, JSON.stringify(inventory));
  const inventoryPath = `release/baselines/${id}/content-inventory.json`;
  const entries = [{ kind: "directory", path: "release" }, { kind: "directory", path: "release/baselines" },
    { kind: "directory", path: `release/baselines/${id}` },
    { kind: "file", path: inventoryPath, sha256: inventory.sha256, byteLength: inventory.byteLength }];
  const configurationSha256 = hash(Buffer.from("{}")), paths = [inventoryPath];
  const report = { schema: "urn:aihq:scan:report:1.0.0", producer: { name: "@aihq/scan", version: "0.5.0" }, createdAt: "2026-10-20T00:00:02.000Z",
    source: { kind: "local", capture: { profile: "aih-source-capture-1", entries, captureSha256: hash(Buffer.from(canonical({ domain: "aih.scan.capture.v1", profile: "aih-source-capture-1", entries }))) } },
    selection: { paths, excludedPaths: [] }, requestedDetectors: [{ detectorId: "fixture-unavailable", profileId: "fixture", configuration: {}, configurationSha256 }],
    results: [{ detectorId: "fixture-unavailable", outcome: "failed", observations: [], coverage: { coveredPaths: [], excludedPaths: [], uncoveredPaths: paths, complete: false }, diagnostics: [{ code: "fixture-unavailable", detail: "Controlled fixture: no detector executed" }] }],
    completion: "partial", annexes: [], effectiveLimits: defaultLimits, diagnostics: [] };
  const artifact = await signArtifact({ report, annexes: [], signer: { privateKey, keyId } });
  const artifactPath = join(out, `${id}-artifact.json`), inventoryFile = join(out, `${id}-inventory.json`);
  writeFileSync(artifactPath, artifact.bytes); writeFileSync(inventoryFile, inventory.bytes);
  views.push({ id, content: { path: contentPath, sha256: hash(content) }, materialRoot: software,
    inventory: { path: inventoryFile, sha256: inventory.sha256 },
    artifact: { path: artifactPath, sha256: hash(artifact.bytes), byteLength: artifact.bytes.length },
    scanId: artifact.scanId, scope: { namespace: "package-relative", paths, excludedPaths: [] } });
}
const plan = { version: 1, trust: { path: trustPath, sha256: hash(trust) }, views };
writeFileSync(join(out, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
console.log(JSON.stringify({ fixtureOnly: true, plan: join(out, "plan.json"), fullSoftware: software, views: views.length }));
