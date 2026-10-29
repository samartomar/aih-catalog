// One packed, outside, headless consumer for release 1.6 behavior. No Core
// source, no execution, no registry publication: the exact packed package is
// installed into a disposable consumer and every case runs through the public
// exports only (@aihq/catalog/contracts, /reader, /producer, /node, /source
// and the schema exports).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
assert(args.length <= 1, "Usage: node tools/verify-release-1-6-consumer.mjs [catalog.tgz]");
const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-release-1-6-packed-"));
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
  const archive = args[0]
    ? resolve(args[0])
    : join(
        fixture,
        JSON.parse(
          runNpm(["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", fixture], root),
        )[0].filename,
      );
  const archiveSha256 = sha(readFileSync(archive));
  const consumer = join(fixture, "consumer");
  seedConsumerLock(consumer, root);
  runNpm(["install", "--prefix", consumer, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", archive], fixture);

  const consume = `
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { contractSupport } from "@aihq/catalog/contracts";
import {
  createContentInventory,
  itemEvidenceDescriptor,
  readContentInventory,
  readRelease,
  readReleaseContent,
} from "@aihq/catalog/reader";
import {
  checkProducerDeclaration,
  compileProducerDeclaration,
  prepareSourceRefresh,
} from "@aihq/catalog/producer";
import release16Schema from "@aihq/catalog/schemas/release/1.6.0.json" with { type: "json" };
import inventory11Schema from "@aihq/catalog/schemas/content-inventory/1.1.0.json" with { type: "json" };

const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? \`[\${value.map(canonical).join(",")}]\`
      : \`{\${Object.keys(value)
          .sort()
          .map((key) => \`\${JSON.stringify(key)}:\${canonical(value[key])}\`)
          .join(",")}}\`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encode = (text) => new TextEncoder().encode(text);
const hex = (seed) => sha256(encode(seed));

const SKILL = "---\\ndescription: Review the proposed setup.\\n---\\n# Review\\n\\nCheck the setup carefully.\\n";
const MCP_SKILL = "---\\ndescription: Serve the notes index.\\n---\\n# Notes server\\n\\nRuns the notes MCP server.\\n";
const AGENT_DIRECTORY = {
  type: "string", required: true, default: ".claude", minLength: 1, maxLength: 64,
  description: "Project directory that receives skills/<name>/ (Claude Code reads .claude).",
};

const declaration = (overrides = {}) => ({
  schema: "urn:aihq:catalog:producer-declaration:3.2.0",
  format: "aihq-catalog-producer-declaration",
  version: 3,
  framework: { id: "example-framework", name: "Example Framework", version: "1.0.0", description: "Packed consumer fixture." },
  sources: [{ id: "notes", repository: "example/notes", licensePath: "LICENSE", license: "MIT" }],
  items: [
    {
      id: "notes.review", source: "notes", label: "Review", description: "Review skill", kind: "skill",
      skillPath: "review/SKILL.md", requires: [], optional: [], conflicts: [],
      clientCapabilities: [], activation: [], configuration: { agentDirectory: AGENT_DIRECTORY },
      provenance: { selectedBy: "packed-consumer" },
      ...overrides.review,
    },
    {
      id: "notes.mcp", source: "notes", label: "MCP server", description: "Captured MCP definition", kind: "mcp-server",
      skillPath: "mcp/SKILL.md", requires: [], optional: [], conflicts: [],
      clientCapabilities: [], activation: [], configuration: { agentDirectory: AGENT_DIRECTORY },
      requirements: { inputs: { serverToken: { type: "string", required: true, sensitive: true } } },
      payload: {
        key: "notes", transport: "stdio", command: "node", args: ["server.js"],
        env: { notes_token: { input: "serverToken" } },
      },
      ...overrides.mcp,
    },
  ],
  ...overrides.root,
});
const sourceFiles = (overrides = {}) => [{
  source: "notes",
  revision: overrides.revision ?? "a".repeat(40),
  files: {
    LICENSE: encode("MIT license fixture\\n"),
    "review/SKILL.md": encode(overrides.skill ?? SKILL),
    "mcp/SKILL.md": encode(MCP_SKILL),
    ...(overrides.extra ?? {}),
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
const expectRefusal = (result, reason) => {
  assert.equal(result.valid, false, "expected a refusal");
  assert.ok(
    result.diagnostics.some((diagnostic) => diagnostic.reason === reason),
    \`expected refusal reason \${reason}, got \${JSON.stringify(result.diagnostics.map((d) => d.reason))}\`,
  );
};
const contentRead = (document) => {
  const bytes = encode(\`\${canonical(document)}\\n\`);
  return readReleaseContent(bytes, { expectedSha256: sha256(bytes) });
};

// 1. The package support lists every new contract with its schema export.
case_("support lists the 1.6 contracts", () => {
  const ids = contractSupport.contracts.map((contract) => contract.id);
  for (const id of [
    "urn:aihq:catalog:release:1.6.0",
    "urn:aihq:catalog:producer-declaration:3.2.0",
    "urn:aihq:catalog:content-inventory:1.1.0",
    "urn:aihq:catalog:release-content:1.1.0",
  ]) assert.ok(ids.includes(id), \`missing \${id}\`);
  assert.equal(release16Schema.$id, "urn:aihq:catalog:release:1.6.0");
  assert.equal(inventory11Schema.$id, "urn:aihq:catalog:content-inventory:1.1.0");
});

// 2. Producer 3.2 compiles release 1.6 with behaviour files and both identities.
let compiled;
case_("producer 3.2 compiles release 1.6", () => {
  const result = compileProducerDeclaration({ declaration: declaration(), sourceFiles: sourceFiles() });
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));
  compiled = result.value;
  assert.equal(compiled.release.schema, "urn:aihq:catalog:release:1.6.0");
  const review = compiled.release.items.find((item) => item.id === "notes.review");
  assert.match(review.contentSha256, /^[0-9a-f]{64}$/);
  assert.match(review.behaviourSha256, /^[0-9a-f]{64}$/);
  assert.ok(
    review.materials.some((member) => member.role === "behaviour" && member.relPath === "aih-behaviour.json"),
  );
  const reread = readReleaseContent(compiled.releaseBytes, { expectedSha256: compiled.releaseSha256 });
  assert.equal(reread.valid, true);
});

// 3. Identity vectors: payload-only moves only behaviourSha256.
case_("payload-only change moves only behaviourSha256", () => {
  const changed = declaration({
    review: {
      payload: { dirName: "review", invocation: "model-allowed", invocationBasis: "changed basis" },
    },
  });
  const result = compileProducerDeclaration({ declaration: changed, sourceFiles: sourceFiles() });
  assert.equal(result.status, "ok");
  const before = compiled.release.items.find((item) => item.id === "notes.review");
  const after = result.value.release.items.find((item) => item.id === "notes.review");
  assert.equal(after.contentSha256, before.contentSha256);
  assert.notEqual(after.behaviourSha256, before.behaviourSha256);
});

// 4. A content byte change moves both identities.
case_("content byte change moves both identities", () => {
  const result = compileProducerDeclaration({
    declaration: declaration(),
    sourceFiles: sourceFiles({ skill: SKILL + "\\nExtra content.\\n" }),
  });
  assert.equal(result.status, "ok");
  const before = compiled.release.items.find((item) => item.id === "notes.review");
  const after = result.value.release.items.find((item) => item.id === "notes.review");
  assert.notEqual(after.contentSha256, before.contentSha256);
  assert.notEqual(after.behaviourSha256, before.behaviourSha256);
});

// 5. The reader recomputes the behaviour file and refuses a mismatch.
case_("behaviour mismatch is refused", () => {
  const document = JSON.parse(Buffer.from(compiled.releaseBytes).toString("utf8"));
  document.items[0].payload = { dirName: "review", invocation: "model-allowed", invocationBasis: "tampered" };
  const result = contentRead(document);
  expectRefusal(result, "behaviour-mismatch");
});

// 6. Closed payload and name rules.
case_("hook placeholder outside the closed list is refused", () => {
  const result = compileProducerDeclaration({
    declaration: declaration({
      review: {
        kind: "hook",
        payload: { event: "pre-commit", protocol: "claude-code-hooks", command: { script: "skill", args: ["{bad}"] } },
      },
    }),
    sourceFiles: sourceFiles(),
  });
  assert.equal(result.status, "refused");
  assert.ok(JSON.stringify(result.diagnostics).includes("unknown-placeholder"));
});
case_("an MCP stdio transport without a command is refused", () => {
  const result = compileProducerDeclaration({
    declaration: declaration({ mcp: { payload: { key: "notes", transport: "stdio" } } }),
    sourceFiles: sourceFiles(),
  });
  assert.equal(result.status, "refused");
  const mcpText = JSON.stringify(result.diagnostics);
  assert.ok(
    mcpText.includes("mcp-command-required") || mcpText.includes("command"),
    \`expected a command refusal, got \${mcpText}\`,
  );
});
case_("a path-shaped display name is refused", () => {
  const result = compileProducerDeclaration({
    declaration: declaration({ review: { name: "some/path" } }),
    sourceFiles: sourceFiles(),
  });
  assert.equal(result.status, "refused");
  assert.ok(JSON.stringify(result.diagnostics).includes("path-shaped-name"));
});

// 7. Provenance: verified requires per-material proof; declared does not.
case_("verified provenance without proof is refused", () => {
  const result = compileProducerDeclaration({
    declaration: declaration({
      review: { provenance: { selectedBy: "x", derivedFrom: [{ itemId: "upstream", status: "verified" }] } },
    }),
    sourceFiles: sourceFiles(),
  });
  assert.equal(result.status, "refused");
  assert.ok(JSON.stringify(result.diagnostics).includes("unverified-derivation"));
});
case_("declared provenance and matching verified proof are accepted", () => {
  const result = compileProducerDeclaration({
    declaration: declaration({
      review: {
        provenance: {
          derivedFrom: [
            { itemId: "other", status: "declared" },
            { itemId: "upstream", status: "verified", proof: { materials: [{ relPath: "SKILL.md", sha256: hex("source") }] } },
          ],
        },
      },
    }),
    sourceFiles: sourceFiles(),
  });
  assert.equal(result.status, "ok");
});

// 8. The Scan evidence descriptor recomputes identities from the checked release.
case_("itemEvidenceDescriptor returns recomputed identities", () => {
  const inventory = createContentInventory(compiled.releaseBytes, {
    expectedSha256: compiled.releaseSha256,
  });
  assert.equal(inventory.valid, true);
  const document = {
    ...JSON.parse(Buffer.from(compiled.releaseBytes).toString("utf8")),
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
  assert.equal(read.valid, true, JSON.stringify(read.diagnostics));
  const evidence = itemEvidenceDescriptor(read.release, { itemId: "notes.review" });
  assert.equal(evidence.valid, true, JSON.stringify(evidence.diagnostics));
  const review = read.release.items.find((item) => item.id === "notes.review");
  assert.equal(evidence.descriptor.contentSha256, review.contentSha256);
  assert.ok(
    evidence.descriptor.materials.some((member) => member.role === "behaviour" && member.relPath === "aih-behaviour.json" && member.capturePath.endsWith("/aih-behaviour.json")),
  );
});

// 9. Executable state comes from supplied modes, and refresh works end to end.
case_("executable states come from supplied modes and refresh preserves them", () => {
  const files = sourceFiles({ modes: { "review/SKILL.md": 0o755 } });
  const result = compileProducerDeclaration({ declaration: declaration(), sourceFiles: files });
  assert.equal(result.status, "ok");
  const review = result.value.release.items.find((item) => item.id === "notes.review");
  assert.equal(review.executable["SKILL.md"], true);
  const refreshed = prepareSourceRefresh({
    declaration: declaration(),
    source: "notes",
    inventoryComplete: true,
    sourceFiles: sourceFiles({ revision: "b".repeat(40), skill: SKILL + "\\nRefreshed.\\n" }),
    previous: {
      releaseBytes: result.value.releaseBytes,
      materials: result.value.materials.map((member) => ({ path: member.path, bytes: member.bytes })),
    },
  });
  assert.equal(refreshed.status, "ok", JSON.stringify(refreshed.diagnostics));
  assert.equal(refreshed.value.release.schema, "urn:aihq:catalog:release:1.6.0");
});

// 10. The 1.1 inventory freezes release 1.6 content including behaviour files.
case_("content inventory 1.1 freezes release 1.6 content", () => {
  const inventory = createContentInventory(compiled.releaseBytes, {
    expectedSha256: compiled.releaseSha256,
  });
  assert.equal(inventory.valid, true);
  assert.equal(inventory.inventory.schema, "urn:aihq:catalog:content-inventory:1.1.0");
  assert.equal(inventory.inventory.projection, "urn:aihq:catalog:release-content:1.1.0");
  const read = readContentInventory(inventory.bytes, { expectedSha256: inventory.sha256 });
  assert.equal(read.valid, true);
});

// 11. SPDX and NOTICE rules.
case_("a licence outside the SPDX list is refused", () => {
  const bad = declaration();
  bad.sources[0].license = "not-a-real-license";
  const checked = checkProducerDeclaration(bad);
  assert.equal(checked.status, "refused");
  assert.equal(checked.diagnostics[0]?.path, "/sources/0/license");
});
case_("a pinned NOTICE file that no item carries is refused", () => {
  const result = compileProducerDeclaration({
    declaration: declaration(),
    sourceFiles: sourceFiles({ extra: { "NOTICE.md": encode("# Notices\\n") } }),
  });
  assert.equal(result.status, "refused");
  assert.ok(JSON.stringify(result.diagnostics).includes("NOTICE.md"));
});

console.log(JSON.stringify({ results }, null, 1));
`;

  writeFileSync(join(consumer, "consume-1-6.mjs"), consume);
  const output = execFileSync(process.execPath, [join(consumer, "consume-1-6.mjs")], {
    cwd: consumer,
    env,
    encoding: "utf8",
    timeout: 120_000,
  });
  const receipt = JSON.parse(output);
  const failures = receipt.results.filter((entry) => entry.status !== "pass");
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 1));
  assert.equal(receipt.results.length, 15, JSON.stringify(receipt.results.map((entry) => entry.name)));
  console.log(JSON.stringify({ ok: true, archiveSha256, cases: receipt.results.length }));
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
