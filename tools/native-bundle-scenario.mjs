// Runs inside a disposable consumer that installed the exact packed Catalog and the supplied Core
// artifact (see tools/verify-native-bundle.mjs). It imports only public package entries, starts no
// AI client, calls no native verifier and touches no real home or client configuration.
//
//   node scenario.mjs <catalog-tarball> <core-tarball>
//
// It prints one sanitized JSON record: identities, check outcomes and the join digests. It never
// prints an absolute path.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { readInstalledRelease } from "@aihq/catalog/node";
import { configureItem, validateSelectionSet } from "@aihq/catalog/reader";
import { apply, prepare } from "@aihq/core";
import {
  validateNativeVerificationBundle,
  validateNativeVerificationRequest,
} from "@aihq/core/contracts";

const [catalogTarball, coreTarball] = process.argv.slice(2);
assert(catalogTarball && coreTarball, "Usage: scenario.mjs <catalog-tarball> <core-tarball>");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort(compare).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
};
const canonicalSha = (value) => sha(Buffer.from(canonical(value)));
const checks = [];
const record = (id, ok, detail) => {
  checks.push({ id, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
  assert(ok, `${id}${detail === undefined ? "" : `: ${detail}`}`);
};

const ITEM = "aihq.mcp.claude.graph-fixture";
const BUNDLE_ITEM = "aihq.native-bundle.claude.graph-fixture";
const catalogRoot = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
// Core does not export its package.json; the consumer installed it directly beside this scenario.
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), "node_modules", "@aihq", "core");
const coreManifest = JSON.parse(readFileSync(join(coreRoot, "package.json"), "utf8"));
const catalogManifest = JSON.parse(readFileSync(join(catalogRoot, "package.json"), "utf8"));
const scratch = mkdtempSync(join(tmpdir(), "aih-native-bundle-scenario-"));
// Remove the disposable projects on every exit path, including a failed check.
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

// ---- Archive: the packed Catalog tarball, read as Core's supplied-bundle reader reads it ----

/** Core refuses an archive entry that is not a bounded regular ustar member with a safe path. */
const safePath = (value) =>
  value.length > 0 && value.length <= 512 && !/[\\:\p{Cc}\p{Cf}]/u.test(value) && !value.startsWith("/") &&
  value.startsWith("package/") &&
  value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".." &&
    !/[. ]$/.test(segment) && !/[<>"|?*]/.test(segment) &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment));
const octal = (field) => {
  const text = field.toString("ascii").replace(/\0.*$/, "").trim();
  assert(/^[0-7]+$/.test(text), "tar numeric field");
  return Number.parseInt(text, 8);
};
const text = (field) => {
  const zero = field.indexOf(0);
  return new TextDecoder("utf-8", { fatal: true }).decode(zero < 0 ? field : field.subarray(0, zero));
};
function readArchive(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 512 * 1024 * 1024 });
  const members = new Map();
  const aliases = new Set();
  const kinds = new Set();
  let entries = 0;
  let offset = 0;
  let ended = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((value) => value === 0)) { ended = true; break; }
    entries += 1;
    const sum = header.reduce((total, value, index) => total + (index >= 148 && index < 156 ? 32 : value), 0);
    assert.equal(sum, octal(header.subarray(148, 156)), "tar header checksum");
    const prefix = text(header.subarray(345, 500));
    const name = text(header.subarray(0, 100));
    const kind = header[156];
    kinds.add(kind);
    const directory = kind === 53;
    const path = `${prefix ? `${prefix}/` : ""}${name}`.replace(directory ? /\/$/ : /$^/, "");
    assert(safePath(path) || (directory && path === "package"), "unsafe archive path");
    const alias = path.normalize("NFC").toLowerCase();
    assert(!aliases.has(alias), "archive alias collision");
    aliases.add(alias);
    const length = octal(header.subarray(124, 136));
    assert(offset + length <= tar.length, "tar member length");
    if (directory) assert.equal(length, 0, "directory length");
    else {
      assert(kind === 0 || kind === 48, `tar entry type ${kind}`);
      members.set(path, tar.subarray(offset, offset + length));
    }
    offset += Math.ceil(length / 512) * 512;
  }
  assert(ended && tar.subarray(offset).every((value) => value === 0), "tar end");
  assert(entries <= 4096, "tar entry count");
  for (const path of members.keys()) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      assert(!members.has(parts.slice(0, index).join("/")), "file used as directory");
    }
  }
  return { members, entries };
}
const catalogBytes = readFileSync(catalogTarball);
const archive = readArchive(catalogBytes);
record("archive-admissible", true, `${archive.entries} entries, every path safe and unique`);
const inArchive = (path) => {
  const bytes = archive.members.get(path);
  assert(bytes !== undefined, `archive lacks ${path}`);
  return bytes;
};

// ---- Pinned inputs: the packed documents and the bundle they carry ----
const bundleItemRelease = JSON.parse(inArchive("package/release/release-native-bundles.json").toString("utf8"));
const bundleRecord = bundleItemRelease.items.find((item) => item.id === BUNDLE_ITEM);
const bundleMaterial = bundleRecord.materials.find((material) => material.id === "bundle");
const bundleBytes = inArchive(`package/${bundleMaterial.path}`);
record("bundle-material-pinned", sha(bundleBytes) === bundleMaterial.sha256 && bundleBytes.length === bundleMaterial.byteLength);
const bundle = JSON.parse(bundleBytes.toString("utf8"));
const bundleManifestSha256 = sha(bundleBytes);

// 1. Core's portable validators accept the bundle and a matching request, and refuse a mutation.
const bundleValidation = validateNativeVerificationBundle(bundle);
record("bundle-valid", bundleValidation.valid === true, JSON.stringify(bundleValidation.diagnostics ?? []));
const request = {
  schema: "urn:aihq:core:native-verification-request:1.0.0",
  client: "claude",
  configuration: { kind: "supplied", input: "catalog", bundleId: bundle.id, manifestSha256: bundleManifestSha256 },
};
const requestValidation = validateNativeVerificationRequest(request);
record("request-valid", requestValidation.valid === true, JSON.stringify(requestValidation.diagnostics ?? []));
record("bundle-unknown-field-refused", validateNativeVerificationBundle({ ...bundle, unexpected: true }).valid === false);
record("bundle-server-unknown-field-refused",
  validateNativeVerificationBundle({ ...bundle, server: { ...bundle.server, unexpected: true } }).valid === false);
record("request-unknown-field-refused", validateNativeVerificationRequest({ ...request, unexpected: true }).valid === false);

// 2. The committed recorder bytes are Core's own. Core does not export the recorder, so its data
// module in the installed artifact is read as text (never imported or run): the raw template
// literal is cut out, required to hold no interpolation, and compared with the packed member.
const recorderData = readFileSync(join(coreRoot, "dist/harness/native/recorder-data.mjs"), "utf8");
const recorderHelpers = readFileSync(join(coreRoot, "dist/harness/native/recorder.mjs"), "utf8");
const opener = "export const recorderSource = String.raw`";
const begin = recorderData.indexOf(opener);
const finish = recorderData.lastIndexOf("`;");
assert(begin >= 0 && finish > begin, "Core recorder data module layout");
const coreRecorder = Buffer.from(recorderData.slice(begin + opener.length, finish), "utf8");
const corePin = /recorderPin = Object\.freeze\(\{ sha256: '([0-9a-f]{64})', byteLength: (\d+) \}\)/.exec(recorderHelpers);
const recorderMember = inArchive(bundle.server.recorder.path);
record("recorder-matches-core",
  !coreRecorder.includes("`") && !coreRecorder.includes("${") && corePin !== null &&
  sha(coreRecorder) === corePin[1] && coreRecorder.length === Number(corePin[2]) &&
  coreRecorder.equals(recorderMember) && bundle.server.recorder.sha256 === corePin[1] &&
  bundle.server.recorder.byteLength === coreRecorder.length &&
  recorderData.includes("recorderRelativePath = '.aihq-native/recorder.mjs'") &&
  bundle.outputTree.some((file) => file.path === ".aihq-native/recorder.mjs" && file.member.sha256 === corePin[1]),
  "the packed recorder equals the recorder text and pin of the supplied Core artifact");

// 3. Every member the bundle names exists in the packed archive with the pinned bytes.
const treeDigest = (tree) => canonicalSha(tree
  .map(({ root, path, member }) => ({ root, path, sha256: member.sha256, byteLength: member.byteLength }))
  .sort((a, b) => compare(a.root, b.root) || compare(a.path, b.path)));
const named = [bundle.release, bundle.selection.recipe, ...bundle.startingTree.map((file) => file.member),
  ...bundle.outputTree.map((file) => file.member), ...bundle.server.runtime, bundle.server.recorder];
for (const member of named) {
  const bytes = inArchive(member.path);
  assert(sha(bytes) === member.sha256 && bytes.length === member.byteLength, `member differs: ${member.path}`);
}
record("members-pinned", true, `${named.length} members resolved with matching SHA-256 and length`);
record("starting-tree-digest", treeDigest(bundle.startingTree) === bundle.startingTreeSha256 && bundle.startingTree.length === 0);
record("output-tree-digest", treeDigest(bundle.outputTree) === bundle.outputTreeSha256);
record("runtime-within-output-tree", bundle.server.runtime.every((member) => bundle.outputTree.some((file) =>
  file.member.path === member.path && file.member.sha256 === member.sha256 && file.member.byteLength === member.byteLength)));
const claude = bundle.outputTree.find((file) => file.root === "project" && file.path === "CLAUDE.md");
const [instruction] = bundle.instructions;
const markers = inArchive(claude.member.path).toString("utf8").match(/\b[0-9a-f]{64}\b/g) ?? [];
record("instruction-pinned", bundle.instructions.length === 1 && instruction.sha256 === claude.member.sha256 &&
  markers.length === 1 && sha(Buffer.from(markers[0])) === instruction.markerSha256);
record("release-and-item-pinned", (() => {
  const document = inArchive(bundle.release.path);
  const release = JSON.parse(document.toString("utf8"));
  const item = release.items.find((entry) => entry.id === bundle.selection.itemId);
  return item !== undefined && sha(Buffer.from(canonical(item))) === bundle.selection.itemSha256 &&
    item.recipe.sha256 === bundle.selection.recipe.sha256 &&
    release.package.name === bundle.package.name && release.package.version === bundle.package.version &&
    catalogManifest.name === bundle.package.name && catalogManifest.version === bundle.package.version;
})());

// 4. Recipe proof through the packed Catalog reader and Core Prepare, review and Apply.
// Core Prepare admits work only under Node 24.15 or newer 24.x, so any other runtime stops here.
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor !== 24 || nodeMinor < 15) {
  console.error(`blocked: Core Prepare requires Node 24.15 or newer 24.x, but this scenario ran under ${process.version}. ` +
    `Checks that passed before the block: ${checks.map((entry) => entry.id).join(", ")}.`);
  rmSync(scratch, { recursive: true, force: true });
  process.exit(3);
}
const installed = await readInstalledRelease({ root: catalogRoot, release: "./release-native-fixture.json" });
assert.equal(installed.valid, true, JSON.stringify(installed.diagnostics));
const configured = configureItem({ release: installed.release, itemId: ITEM, configuration: {}, materialSource: installed.source });
assert.equal(configured.valid, true, JSON.stringify(configured.diagnostics));
const set = validateSelectionSet({
  releases: { [installed.release.sha256]: installed.release },
  selections: [{ id: "graph-fixture", item: { releaseSha256: configured.provenance.manifestSha256, itemId: ITEM,
    itemSha256: configured.provenance.itemSha256 }, configuration: {} }],
});
assert.equal(set.valid, true, JSON.stringify(set.diagnostics));
record("reader-identities-match-bundle", configured.provenance.manifestSha256 === bundle.release.sha256 &&
  configured.provenance.itemSha256 === bundle.selection.itemSha256 &&
  configured.selection.recipe.reference.sha256 === bundle.selection.recipe.sha256 &&
  configured.selection.recipe.reference.byteLength === bundle.selection.recipe.byteLength);
const policy = { schema: "urn:aihq:core:execution-policy:1.0.0", mode: "vibe",
  selections: [{ ...configured.selection, id: "graph-fixture", managementId: "graph-fixture", scope: "project",
    requires: set.requiresBySelectionId["graph-fixture"] }] };
const controls = { logging: "off", materialRoots: installed.materialRoots };

/** Every regular file below a directory, POSIX-relative, with its hash and length; empty directories noted. */
function readTree(directory) {
  const files = new Map();
  const emptyDirectories = [];
  const walk = (current) => {
    const entries = readdirSync(current, { withFileTypes: true });
    if (entries.length === 0 && current !== directory) emptyDirectories.push(current.slice(directory.length + 1).replaceAll("\\", "/"));
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        assert(entry.isFile(), "project tree holds only regular files");
        const bytes = readFileSync(path);
        files.set(path.slice(directory.length + 1).replaceAll("\\", "/"), { sha256: sha(bytes), byteLength: bytes.length });
      }
    }
  };
  walk(directory);
  return { files, emptyDirectories };
}

const project = join(scratch, "project");
mkdirSync(project);
const prepared = await prepare({ useCase: "policy", policy, target: { project } }, controls);
assert.equal(prepared.status, "ready", JSON.stringify(prepared.diagnostics));
record("prepare-writes-nothing", readdirSync(project).length === 0);
const reviewSha256 = prepared.review.reviewDigest;
const applied = await apply(prepared.prepared, { approved: true, origin: "automation", reviewDigest: reviewSha256 }, controls);
assert.equal(applied.completion, "complete", JSON.stringify(applied.diagnostics));
record("apply-checks-passed", applied.checks.length > 0 && applied.checks.every((check) => check.status === "passed"),
  `${applied.checks.length} checks`);

const actual = readTree(project);
const expected = new Map(bundle.outputTree.map((file) => [file.path, { sha256: file.member.sha256, byteLength: file.member.byteLength }]));
const actualOutputTree = [...actual.files].map(([path, value]) => ({ root: "project", path, member: value }));
const actualOutputTreeSha256 = treeDigest(actualOutputTree);
record("actual-tree-equals-pinned-tree",
  actual.files.size === expected.size && [...expected].every(([path, value]) => {
    const found = actual.files.get(path);
    return found?.sha256 === value.sha256 && found.byteLength === value.byteLength;
  }) && actualOutputTreeSha256 === bundle.outputTreeSha256,
  `${actual.files.size} files, no extra and none missing`);
record("no-empty-directories-left", actual.emptyDirectories.length === 0, actual.emptyDirectories.join(","));
record("configuration-names-recorder-and-server", (() => {
  const config = JSON.parse(readFileSync(join(project, ".mcp.json"), "utf8"));
  const entry = config.mcpServers?.[bundle.server.name];
  return Object.keys(config.mcpServers).length === 1 && entry.type === "stdio" && entry.command === "node" &&
    JSON.stringify(entry.args) === JSON.stringify([".aihq-native/recorder.mjs", "--", "node", ".aihq/graph-fixture/graph-server.mjs"]);
})());

// 5. The delivered server answers the fixed read-only query through plain node, with no client or recorder.
const queryId = "c".repeat(64);
const run = spawnSync(process.execPath, [".aihq/graph-fixture/graph-server.mjs"], {
  cwd: project, encoding: "utf8", timeout: 30_000,
  input: `${[
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: queryId, method: "tools/call", params: { name: bundle.server.queryTool, arguments: bundle.server.queryArguments } },
  ].map((message) => JSON.stringify(message)).join("\n")}\n`,
});
assert.equal(run.status, 0, run.stderr);
const replies = run.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
const query = replies.find((reply) => reply.id === queryId);
const listed = replies.find((reply) => reply.id === 2)?.result?.tools?.map((tool) => tool.name);
record("server-lists-query-tool", JSON.stringify(listed) === JSON.stringify([bundle.server.queryTool]));
record("server-result-matches-pin", canonicalSha(query?.result) === bundle.server.expectedResultSha256 &&
  query.result.content[0].text === bundle.server.expectedAnswer && query.result.isError === false);
record("tool-names-cover-query-and-recorder-attestation", bundle.server.toolNames.includes(bundle.server.queryTool) &&
  bundle.server.toolNames.includes("aihq_attest_instruction"));

// 6. The bundle item's own recipe lands its bundle with the unused expected-output materials declared.
const bundleInstalled = await readInstalledRelease({ root: catalogRoot, release: "./release-native-bundles.json", sourceInput: "catalog-bundles" });
assert.equal(bundleInstalled.valid, true, JSON.stringify(bundleInstalled.diagnostics));
const bundleConfigured = configureItem({ release: bundleInstalled.release, itemId: BUNDLE_ITEM, configuration: {}, materialSource: bundleInstalled.source });
assert.equal(bundleConfigured.valid, true, JSON.stringify(bundleConfigured.diagnostics));
const bundlePolicy = { schema: "urn:aihq:core:execution-policy:1.0.0", mode: "vibe",
  selections: [{ ...bundleConfigured.selection, id: "bundle", managementId: "bundle", scope: "project", requires: [] }] };
const bundleControls = { logging: "off", materialRoots: bundleInstalled.materialRoots };
const bundleProject = join(scratch, "bundle-project");
mkdirSync(bundleProject);
const bundlePrepared = await prepare({ useCase: "policy", policy: bundlePolicy, target: { project: bundleProject } }, bundleControls);
assert.equal(bundlePrepared.status, "ready", JSON.stringify(bundlePrepared.diagnostics));
const bundleApplied = await apply(bundlePrepared.prepared, { approved: true, origin: "automation",
  reviewDigest: bundlePrepared.review.reviewDigest }, bundleControls);
assert.equal(bundleApplied.completion, "complete", JSON.stringify(bundleApplied.diagnostics));
const landed = readTree(bundleProject).files;
record("bundle-item-recipe-lands-bundle-only", landed.size === 1 &&
  landed.get(`.aihq-native/verification/${bundle.id}.json`)?.sha256 === bundleManifestSha256);

rmSync(scratch, { recursive: true, force: true });
assert(!existsSync(scratch));

const lastOperation = applied.operations.length;
console.log(JSON.stringify({
  core: { name: coreManifest.name, version: coreManifest.version, file: basename(coreTarball),
    sha256: sha(readFileSync(coreTarball)), byteLength: statSync(coreTarball).size },
  catalog: { name: catalogManifest.name, version: catalogManifest.version, file: basename(catalogTarball),
    sha256: sha(catalogBytes), byteLength: catalogBytes.length, archiveEntries: archive.entries },
  join: {
    bundleId: bundle.id,
    bundleManifestSha256,
    archiveSha256: sha(catalogBytes),
    itemSha256: bundle.selection.itemSha256,
    recipeSha256: bundle.selection.recipe.sha256,
    inputsSha256: canonicalSha(bundle.selection.inputs),
    startingTreeSha256: bundle.startingTreeSha256,
    expectedOutputTreeSha256: bundle.outputTreeSha256,
    actualOutputTreeSha256,
    policySha256: canonicalSha(policy),
    reviewSha256,
    runResultSha256: canonicalSha(applied),
    nativeResultSha256: null,
  },
  derivation: {
    inputsSha256: "SHA-256 of the canonical JSON of the bundle's selection inputs",
    policySha256: "SHA-256 of the canonical JSON of the execution policy passed to Core Prepare",
    reviewSha256: "the reviewDigest that Core Prepare returned",
    runResultSha256: "SHA-256 of the canonical JSON of the RunResult that Core Apply returned (run-specific)",
    actualOutputTreeSha256: "bundle tree digest rule applied to the files Apply left in the disposable project",
  },
  operations: lastOperation,
  checks,
}, null, 2));
