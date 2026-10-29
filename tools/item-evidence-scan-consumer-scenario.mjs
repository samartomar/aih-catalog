// Copied into an outside consumer beside an exact packed Scan; only public package
// interfaces are imported (@aihq/catalog/reader and @aihq/scan/read, /host). The
// prepared release 1.7.0 items map to Scan's item descriptor, a local Scan request
// 2.0.0 assessment of their exact package members derives contract item records, and
// changed declarations (payload only, executable bit only) are never covered by the
// old assessment. Scan records executable bits from file modes, which Windows lacks:
// there every record is `unavailable`, never `matched`. No live network scanning.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { itemEvidenceDescriptor, readReleaseContent } from "@aihq/catalog/reader";
import { createRetainedObservationsV1, prepareArtifact, runScan } from "@aihq/scan/host";
import { readArtifact, recordItems, verifyItemRecord } from "@aihq/scan/read";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
      : JSON.stringify(value);
const linux = process.platform === "linux";
const PROFILE = {
  schema: "urn:aihq:scan:severity-profile:1.0.0",
  id: "aih-default",
  version: "1",
  rules: ["error", "warning", "note"].map((level) => ({ detectorId: "*", level, maps: level })),
  suppressions: [],
};
const ITEMS = [
  ["extensions", "extensions.matt.grill-me"],
  ["extensions", "extensions.hook.git-guard"],
  ["ecc", "ecc.hook.pre-config-protection"],
  ["superpowers", "superpowers.hook.session-start"],
];
const results = [];
const case_ = async (name, fn) => {
  try {
    await fn();
    results.push({ name, status: "pass" });
  } catch (error) {
    results.push({ name, status: "fail", error: String(error?.stack ?? error) });
  }
};

const documentOf = (framework) =>
  JSON.parse(readFileSync(fileURLToPath(import.meta.resolve(`@aihq/catalog/release-${framework}.content.json`)), "utf8"));
const read = (document) => {
  const bytes = Buffer.from(`${canonical(document)}\n`);
  const result = readReleaseContent(bytes, { expectedSha256: sha256(bytes) });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  return result.release;
};
const descriptorOf = (release, itemId) => {
  const evidence = itemEvidenceDescriptor(release, { itemId });
  assert.equal(evidence.valid, true, JSON.stringify(evidence.diagnostics));
  return evidence.descriptor;
};
/** One item with an edited declaration: its behaviour file and identity follow; sets that pin it are left out. */
const variant = (framework, itemId, edit) => {
  const document = documentOf(framework);
  delete document.sets;
  const item = document.items.find((entry) => entry.id === itemId);
  edit(item);
  const deps = { requires: item.dependencies.requires ?? [], optional: item.dependencies.optional ?? [], conflicts: item.dependencies.conflicts ?? [] };
  const content = item.materials.filter((member) => member.role !== "behaviour");
  const lines = content.map((member) => `${member.relPath}\t${member.sha256}\n`).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).join("");
  const value = { kind: item.kind, payload: item.payload, requirements: { inputs: item.requirements.inputs }, dependencies: deps, executable: item.executable };
  const behaviour = Buffer.from(`${canonical(value)}\n`);
  const file = item.materials.find((member) => member.role === "behaviour");
  Object.assign(file, { sha256: sha256(behaviour), byteLength: behaviour.length, size: { ...file.size, bytes: behaviour.length, chars: behaviour.length } });
  item.behaviourSha256 = sha256(Buffer.from(canonical({ ...value, materials: lines })));
  return { descriptor: descriptorOf(read(document), itemId), behaviour };
};

/** Stages each descriptor's exact package members with their declared modes and assesses them locally. */
const assess = async (descriptors) => {
  const source = mkdtempSync(join(tmpdir(), "aih-catalog-item-evidence-subject-"));
  try {
    for (const material of descriptors.flatMap((descriptor) => descriptor.materials)) {
      const at = join(source, material.capturePath);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, readFileSync(join(root, material.capturePath)));
      chmodSync(at, material.executable === true ? 0o755 : 0o644);
    }
    const request = {
      schema: "urn:aihq:scan:request:2.0.0",
      source: { kind: "local", path: source },
      selection: { paths: "all", excludedPaths: [] },
      detectors: [{ detectorId: "detector.aih-native", configuration: {} }],
    };
    const scanned = await runScan(request, { retained: createRetainedObservationsV1() });
    assert.equal(scanned.status, "assessment", JSON.stringify(scanned).slice(0, 2000));
    const annexes = scanned.annexes.map(({ id, bytesBase64 }) => ({ id, bytes: new Uint8Array(Buffer.from(bytesBase64, "base64")) }));
    const prepared = await prepareArtifact({ report: scanned.report, annexes });
    const assessment = await readArtifact(prepared.bytes);
    assert.equal(assessment.status, "read", JSON.stringify(assessment).slice(0, 2000));
    return assessment;
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
};

const releases = Object.fromEntries(["extensions", "ecc", "superpowers"].map((framework) => [framework, read(documentOf(framework))]));
const descriptors = ITEMS.map(([framework, itemId]) => descriptorOf(releases[framework], itemId));

await case_("each prepared 1.7 item maps to Scan's item descriptor", () => {
  for (const [index, [framework, itemId]] of ITEMS.entries()) {
    const descriptor = descriptors[index];
    const item = releases[framework].items.find((entry) => entry.id === itemId);
    assert.equal(descriptor.frameworkId, framework);
    assert.deepEqual([descriptor.contentSha256, descriptor.behaviourSha256], [item.contentSha256, item.behaviourSha256]);
    assert.equal(descriptor.kind, item.kind);
    assert.deepEqual(descriptor.payload, item.payload);
    assert.deepEqual(Object.keys(descriptor.requirements), ["inputs"]);
    assert.deepEqual(Object.keys(descriptor.dependencies).sort(), ["conflicts", "optional", "requires"]);
    assert.deepEqual(
      descriptor.materials.map((member) => [member.materialId, member.relPath, member.capturePath, member.executable]).sort(),
      item.materials.map((member) => [member.id, member.relPath, member.packagePath, member.executable]).sort(),
    );
  }
  assert.ok(descriptors.some((descriptor) => descriptor.materials.some((member) => member.executable === true)), "an executable script is covered");
});

await case_("descriptor derivation is portable", () => {
  const entry = fileURLToPath(import.meta.resolve("@aihq/catalog/reader"));
  const seen = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const at = pending.pop();
    if (seen.has(at)) continue;
    seen.add(at);
    const source = readFileSync(at, "utf8");
    assert.ok(!source.includes("node:"), `portable seam imports a Node builtin: ${at}`);
    for (const match of source.matchAll(/from\s+"(\.\/[^"]+)"/g)) pending.push(resolve(dirname(at), match[1]));
  }
});

const assessment = await assess(descriptors);
let records;
await case_(`Scan records each item ${linux ? "matched with its exact bytes and bits" : "unavailable without file modes (Windows)"}`, async () => {
  const batch = await recordItems({ artifact: assessment, items: descriptors, severityProfile: PROFILE });
  assert.equal(batch.status, "complete", JSON.stringify(batch).slice(0, 2000));
  records = batch.results;
  for (const [index, record] of records.entries()) {
    assert.equal(record.coverage, linux ? "matched" : "unavailable", `${descriptors[index].itemId}: ${JSON.stringify(record).slice(0, 1500)}`);
    if (!linux) continue;
    assert.deepEqual(record.subject, { frameworkId: descriptors[index].frameworkId, itemId: descriptors[index].itemId, contentSha256: descriptors[index].contentSha256, behaviourSha256: descriptors[index].behaviourSha256 });
    assert.equal(await verifyItemRecord(record, assessment, descriptors[index], PROFILE), "same");
  }
});

await case_("the old assessment never covers a payload-only change", async () => {
  const { descriptor } = variant("extensions", "extensions.matt.grill-me", (item) => {
    item.payload = { ...item.payload, invocation: "model-allowed", invocationBasis: "changed" };
  });
  assert.equal(descriptor.contentSha256, descriptors[0].contentSha256);
  assert.notEqual(descriptor.behaviourSha256, descriptors[0].behaviourSha256);
  const batch = await recordItems({ artifact: assessment, items: [descriptor], severityProfile: PROFILE });
  assert.ok(batch.status !== "complete" || batch.results[0].coverage !== "matched", JSON.stringify(batch).slice(0, 1500));
  if (records?.[0]) assert.notEqual(await verifyItemRecord(records[0], assessment, descriptor, PROFILE), "same");
});

await case_("the old assessment never covers an executable-bit-only change", async () => {
  const { descriptor } = variant("extensions", "extensions.hook.git-guard", (item) => {
    const script = item.materials.find((member) => member.id === item.payload.command.script);
    script.executable = true;
    item.executable = { ...item.executable, [script.relPath]: true };
  });
  assert.equal(descriptor.contentSha256, descriptors[1].contentSha256);
  assert.notEqual(descriptor.behaviourSha256, descriptors[1].behaviourSha256);
  const batch = await recordItems({ artifact: assessment, items: [descriptor], severityProfile: PROFILE });
  assert.ok(batch.status !== "complete" || batch.results[0].coverage !== "matched", JSON.stringify(batch).slice(0, 1500));
  if (records?.[1]) assert.notEqual(await verifyItemRecord(records[1], assessment, descriptor, PROFILE), "same");
});

process.stdout.write(JSON.stringify({ platform: process.platform, results }));
