// One packed, outside consumer for the Scan item-evidence mapping. The exact
// packed Catalog package and an exact packed Scan archive install into a
// disposable consumer; every case runs through the public exports only
// (@aihq/catalog/contracts, /reader, /producer and @aihq/scan/read, /host).
// Scan runs its local detector over a disposable fixture root: no live network
// scanning and no scan against this checkout.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
assert(
  args.length <= 2,
  "Usage: node tools/verify-item-evidence-scan-consumer.mjs <scan.tgz> [catalog.tgz]",
);
const scanArg = args[0];
const catalogArg = args[1];
assert(scanArg, "Usage: node tools/verify-item-evidence-scan-consumer.mjs <scan.tgz> [catalog.tgz]");
const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-item-evidence-scan-"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const npm = [
  process.env.npm_execpath,
  resolve(process.execPath, "..", "node_modules/npm/bin/npm-cli.js"),
  resolve(process.execPath, "../..", "lib/node_modules/npm/bin/npm-cli.js"),
].find((candidate) => candidate && isAbsolute(candidate) && basename(candidate) === "npm-cli.js");
assert(npm, "An adjacent npm-cli.js is required.");
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"),
);
const runNpm = (argv, cwd) =>
  execFileSync(process.execPath, [npm, ...argv], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
try {
  const scan = resolve(scanArg);
  const archive = catalogArg
    ? resolve(catalogArg)
    : join(
        fixture,
        JSON.parse(
          runNpm(["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", fixture], root),
        )[0].filename,
      );
  const archiveSha256 = sha(readFileSync(archive));
  const scanSha256 = sha(readFileSync(scan));
  const consumer = join(fixture, "consumer");
  mkdirSync(consumer, { recursive: true });
  // Both tarballs declare exact runtime versions; npm resolves the shared
  // dependency tree (Catalog's yaml range accepts Scan's exact pin).
  runNpm(["install", "--prefix", consumer, "--ignore-scripts", "--no-audit", "--no-fund", archive, scan], fixture);

  const consume = `
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createContentInventory, itemEvidenceDescriptor, readRelease } from "@aihq/catalog/reader";
import { compileProducerDeclaration } from "@aihq/catalog/producer";
import { readArtifact, recordItem, verifyItemRecord } from "@aihq/scan/read";
import { createRetainedObservationsV1, prepareArtifact, runScan } from "@aihq/scan/host";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? \`[\${value.map(canonical).join(",")}]\`
      : \`{\${Object.keys(value)
          .sort()
          .map((key) => \`\${JSON.stringify(key)}:\${canonical(value[key])}\`)
          .join(",")}}\`;
const encode = (text) => new TextEncoder().encode(text);

const SKILL = "---\\ndescription: Review the proposed setup.\\n---\\n# Review\\n\\nCheck the setup carefully.\\n";
const MCP_SKILL = "---\\ndescription: Serve the notes index.\\n---\\n# Notes server\\n\\nRuns the notes MCP server.\\n";
const FRAMEWORK_ID = "example-framework";
const AGENT_DIRECTORY = {
  type: "string", required: true, default: ".claude", minLength: 1, maxLength: 64,
  description: "Project directory that receives skills/<name>/ (Claude Code reads .claude).",
};

const declaration = (overrides = {}) => ({
  schema: "urn:aihq:catalog:producer-declaration:3.2.0",
  format: "aihq-catalog-producer-declaration",
  version: 3,
  framework: { id: FRAMEWORK_ID, name: "Example Framework", version: "1.0.0", description: "Scan consumer fixture." },
  sources: [{ id: "notes", repository: "example/notes", licensePath: "LICENSE", license: "MIT" }],
  items: [
    {
      id: "notes.review", source: "notes", label: "Review", description: "Review skill", kind: "skill",
      skillPath: "review/SKILL.md",
      requires: overrides.requires ?? [],
      optional: [], conflicts: [],
      clientCapabilities: [], activation: [], configuration: { agentDirectory: AGENT_DIRECTORY },
      payload: overrides.payload ?? { dirName: "review", invocation: "user-only", invocationBasis: "authored" },
      provenance: { selectedBy: "scan-consumer" },
    },
    {
      id: "notes.mcp", source: "notes", label: "MCP server", description: "Captured MCP definition", kind: "mcp-server",
      skillPath: "mcp/SKILL.md", requires: [], optional: [], conflicts: [],
      clientCapabilities: [], activation: [], configuration: { agentDirectory: AGENT_DIRECTORY },
      requirements: { inputs: { serverToken: { type: "string", required: true, sensitive: true } } },
      payload: { key: "notes", transport: "stdio", command: "node", args: ["server.js"], env: { notes_token: { input: "serverToken" } } },
    },
  ],
});
const sourceFiles = (overrides = {}) => [{
  source: "notes",
  revision: "a".repeat(40),
  files: {
    LICENSE: encode("MIT license fixture\\n"),
    "review/SKILL.md": encode(SKILL),
    "mcp/SKILL.md": encode(MCP_SKILL),
  },
  ...(overrides.modes ? { modes: overrides.modes } : {}),
}];

const results = [];
const case_ = (name, fn) => {
  try {
    fn();
    results.push({ name, status: "pass" });
  } catch (error) {
    results.push({ name, status: "fail", error: String(error && error.message ? error.message : error) });
  }
};

/** Compiles one declaration, binds an inventory baseline and reads the release. */
const checked = (label, overrides = {}, modes) => {
  const compiled = compileProducerDeclaration({ declaration: declaration(overrides), sourceFiles: sourceFiles({ modes }) });
  assert.equal(compiled.status, "ok", \`\${label}: \${JSON.stringify(compiled.diagnostics)}\`);
  const inventory = createContentInventory(compiled.value.releaseBytes, {
    expectedSha256: compiled.value.releaseSha256,
  });
  assert.equal(inventory.valid, true, \`\${label}: \${JSON.stringify(inventory.diagnostics)}\`);
  const document = {
    ...JSON.parse(Buffer.from(compiled.value.releaseBytes).toString("utf8")),
    baseline: {
      schema: "urn:aihq:catalog:scan-baseline:1.0.0",
      inventory: { path: "release/content-inventory.json", sha256: inventory.sha256, byteLength: inventory.byteLength },
      scanId: \`scan:sha256:\${"c".repeat(64)}\`,
      artifact: { sha256: "d".repeat(64), byteLength: 200, location: { kind: "package", path: "release/baseline.json" } },
      scope: { namespace: "package-relative", paths: ["release"], excludedPaths: [] },
    },
  };
  const bytes = encode(\`\${canonical(document)}\\n\`);
  const read = readRelease(bytes, { expectedSha256: sha256(bytes) });
  assert.equal(read.valid, true, \`\${label}: \${JSON.stringify(read.diagnostics)}\`);
  return { compiled: compiled.value, release: read.release };
};

const descriptorFor = (release, itemId) => {
  const evidence = itemEvidenceDescriptor(release, { itemId });
  assert.equal(evidence.valid, true, JSON.stringify(evidence.diagnostics));
  return evidence.descriptor;
};

/** Writes one descriptor's materials at their package-relative paths and scans them. */
const assess = async (descriptor, materials) => {
  const source = mkdtempSync(join(tmpdir(), "aih-catalog-item-evidence-subject-"));
  const byPath = new Map(materials.map((member) => [member.path, member.bytes]));
  for (const material of descriptor.materials) {
    const bytes = byPath.get(material.path);
    assert.ok(bytes, \`compiled material bytes for \${material.path}\`);
    const at = join(source, material.path);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, bytes);
    chmodSync(at, material.executable === true ? 0o755 : 0o644);
  }
  const request = {
    schema: "urn:aihq:scan:request:2.0.0",
    source: { kind: "local", path: source },
    selection: { paths: "all", excludedPaths: [] },
    detectors: [
      { detectorId: "detector.aih-native", configuration: {} },
      { detectorId: "detector.unavailable", configuration: {} },
    ],
  };
  const retained = createRetainedObservationsV1();
  const scanned = await runScan(request, { retained });
  assert.equal(scanned.status, "assessment", JSON.stringify(scanned));
  const annexes = scanned.annexes.map(({ id, bytesBase64 }) => ({ id, bytes: new Uint8Array(Buffer.from(bytesBase64, "base64")) }));
  const prepared = await prepareArtifact({ report: scanned.report, annexes });
  const assessment = await readArtifact(prepared.bytes);
  assert.equal(assessment.status, "read", JSON.stringify(assessment));
  rmSync(source, { recursive: true, force: true });
  return assessment;
};

const main = async () => {
  // 1. A compiled 1.6 release derives Scan's item descriptor shape with
  //    package-relative paths and the behaviour file always present.
  const base = checked("base");
  const baseDescriptor = descriptorFor(base.release, "notes.review");
  case_("descriptor maps release materials to the Scan item descriptor", () => {
    assert.equal(baseDescriptor.frameworkId, FRAMEWORK_ID);
    assert.equal(baseDescriptor.itemId, "notes.review");
    assert.match(baseDescriptor.contentSha256, /^[0-9a-f]{64}$/);
    assert.match(baseDescriptor.behaviourSha256, /^[0-9a-f]{64}$/);
    assert.ok(baseDescriptor.materials.length >= 2);
    const behaviour = baseDescriptor.materials.find((member) => member.role === "behaviour");
    assert.ok(behaviour, "every descriptor includes the behaviour file");
    assert.equal(behaviour.path, "release/items/notes.review/aih-behaviour.json");
    for (const member of baseDescriptor.materials) {
      assert.ok(member.path.startsWith("release/"), \`package-relative path \${member.path}\`);
      assert.ok(!member.path.includes(".."), \`no traversal in \${member.path}\`);
      assert.match(member.sha256, /^[0-9a-f]{64}$/);
      assert.equal(typeof member.byteLength, "number");
      assert.ok(member.executable === true || member.executable === false || member.executable === "unknown");
      assert.ok(member.role === "content" || member.role === "behaviour");
    }
  });

  // 2. Releases never embed item scan records; consumers derive them from an
  //    assessment through Scan's public item-record derivation.
  case_("releases embed no item scan records", () => {
    const text = Buffer.from(base.compiled.releaseBytes).toString("utf8");
    assert.ok(!text.includes("urn:aihq:scan:item-record"), "no item record schema in release bytes");
    const item = base.release.items.find((candidate) => candidate.id === "notes.review");
    assert.ok(!JSON.stringify(Object.keys(item)).includes("scan"), "items carry no scan record fields");
  });

  // 3. The portable reader entry derives descriptors without Node globals.
  case_("descriptor derivation is portable", () => {
    const entry = fileURLToPath(import.meta.resolve("@aihq/catalog/reader"));
    const seen = new Set();
    const pending = [entry];
    while (pending.length > 0) {
      const at = pending.pop();
      if (seen.has(at)) continue;
      seen.add(at);
      const source = readFileSync(at, "utf8");
      assert.ok(!source.includes("node:"), \`portable seam imports a Node builtin: \${at}\`);
      assert.ok(!source.includes("require("), \`portable seam uses require: \${at}\`);
      for (const match of source.matchAll(/from\\s+"(\\.\\/[^"]+)"/g))
        pending.push(resolve(dirname(at), match[1]));
    }
  });

  // 4. A real local assessment covers the descriptor and verifies same.
  const baseAssessment = await assess(baseDescriptor, base.compiled.materials);
  let baseRecord;
  try {
    baseRecord = await recordItem(baseAssessment, baseDescriptor);
    assert.equal(baseRecord.schema, "urn:aihq:scan:item-record:1.0.0");
    assert.equal(baseRecord.coverage, "matched", JSON.stringify(baseRecord.materials));
    assert.equal(baseRecord.subject.contentSha256, baseDescriptor.contentSha256);
    assert.equal(baseRecord.subject.behaviourSha256, baseDescriptor.behaviourSha256);
    const native = baseRecord.detectors.find((entry) => entry.detectorId === "detector.aih-native");
    assert.equal(native.outcome, "succeeded");
    assert.equal(native.itemCoverage, "covered");
    assert.equal(await verifyItemRecord(baseRecord, baseAssessment, baseDescriptor), "same");
    results.push({ name: "Scan item-record verification accepts the mapped descriptor", status: "pass" });
  } catch (error) {
    results.push({ name: "Scan item-record verification accepts the mapped descriptor", status: "fail", error: String(error && error.message ? error.message : error) });
  }

  // 5. An assessment of old declarations never covers the changed item.
  const changed = [
    ["payload", { payload: { dirName: "review", invocation: "model-allowed", invocationBasis: "changed basis" } }],
    ["dependencies", { requires: [{ itemId: "notes.mcp" }] }],
  ];
  for (const [label, overrides] of changed) {
    try {
      const variant = checked(label, overrides);
      const variantDescriptor = descriptorFor(variant.release, "notes.review");
      assert.equal(variantDescriptor.contentSha256, baseDescriptor.contentSha256, \`\${label}: content identity unchanged\`);
      assert.notEqual(variantDescriptor.behaviourSha256, baseDescriptor.behaviourSha256, \`\${label}: behaviour identity changed\`);
      const derived = await recordItem(baseAssessment, variantDescriptor);
      assert.equal(derived.coverage, "mismatched", \`\${label}: old capture never matches changed declarations\`);
      const verdict = await verifyItemRecord(baseRecord, baseAssessment, variantDescriptor);
      assert.ok(verdict !== "same", \`\${label}: old assessment must never verify same, got \${verdict}\`);
      results.push({ name: \`old assessment never covers a \${label}-only change\`, status: "pass" });
    } catch (error) {
      results.push({ name: \`old assessment never covers a \${label}-only change\`, status: "fail", error: String(error && error.message ? error.message : error) });
    }
  }
  try {
    const executableVariant = checked("executable", {}, { "review/SKILL.md": 0o755 });
    const executableDescriptor = descriptorFor(executableVariant.release, "notes.review");
    assert.equal(executableDescriptor.contentSha256, baseDescriptor.contentSha256);
    assert.notEqual(executableDescriptor.behaviourSha256, baseDescriptor.behaviourSha256);
    const skill = executableDescriptor.materials.find((member) => member.path.endsWith("/SKILL.md"));
    assert.equal(skill.executable, true, "executable state projects into the descriptor");
    const derived = await recordItem(baseAssessment, executableDescriptor);
    assert.equal(derived.coverage, "mismatched", "old capture never matches changed executable state");
    assert.equal(derived.materials.find((member) => member.path.endsWith("/SKILL.md")).executableComparison, "differs");
    const verdict = await verifyItemRecord(baseRecord, baseAssessment, executableDescriptor);
    assert.ok(verdict !== "same", \`executable: old assessment must never verify same, got \${verdict}\`);
    results.push({ name: "old assessment never covers an executable-only change", status: "pass" });
  } catch (error) {
    results.push({ name: "old assessment never covers an executable-only change", status: "fail", error: String(error && error.message ? error.message : error) });
  }

  // 6. A changed release stays verifiable against its own fresh assessment.
  try {
    const variant = checked("payload-fresh", changed[0][1]);
    const variantDescriptor = descriptorFor(variant.release, "notes.review");
    const variantAssessment = await assess(variantDescriptor, variant.compiled.materials);
    const variantRecord = await recordItem(variantAssessment, variantDescriptor);
    assert.equal(variantRecord.coverage, "matched", JSON.stringify(variantRecord.materials));
    assert.equal(await verifyItemRecord(variantRecord, variantAssessment, variantDescriptor), "same");
    const cross = await verifyItemRecord(baseRecord, baseAssessment, variantDescriptor);
    assert.ok(cross !== "same", "cross-check: base record never verifies the changed item");
    results.push({ name: "changed release verifies against its own assessment", status: "pass" });
  } catch (error) {
    results.push({ name: "changed release verifies against its own assessment", status: "fail", error: String(error && error.message ? error.message : error) });
  }

  console.log(JSON.stringify({ results }, null, 1));
};

await main();
`;

  writeFileSync(join(consumer, "consume-item-evidence.mjs"), consume);
  const output = execFileSync(process.execPath, [join(consumer, "consume-item-evidence.mjs")], {
    cwd: consumer,
    env,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const receipt = JSON.parse(output);
  const failures = receipt.results.filter((entry) => entry.status !== "pass");
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 1));
  assert.equal(receipt.results.length, 8, JSON.stringify(receipt.results.map((entry) => entry.name)));
  console.log(
    JSON.stringify({
      ok: true,
      archiveSha256,
      scanSha256,
      cases: receipt.results.length,
    }),
  );
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
