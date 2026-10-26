// One packed, outside consumer for samartomar/aih-catalog#122. The packed
// Catalog package installs into a disposable consumer with lifecycle scripts
// disabled; every case runs through the public exports only
// (@aihq/catalog/node, /source and /producer) against a deterministic fixture
// transport — no live network, no git binary. The fixture definitions are
// shared verbatim with the unit tests (tools/git-resolution-fixture.mjs) so
// the two cannot drift. Throwing guards on the process and network surfaces
// are armed before the package import, so any fetch, install, execution or
// host discovery inside resolution or acquisition fails the proof: nothing
// acquired is executed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
assert(
  args.length <= 1,
  "Usage: node tools/verify-git-resolution-consumer.mjs [catalog.tgz]",
);
const fixture = mkdtempSync(join(tmpdir(), "aih-git-resolution-"));
const npm = [
  resolve(process.execPath, "../node_modules/npm/bin/npm-cli.js"),
  resolve(process.execPath, "../../lib/node_modules/npm/bin/npm-cli.js"),
].find((candidate) => {
  try {
    readFileSync(candidate);
    return true;
  } catch {
    return false;
  }
});
assert(npm, "An adjacent npm-cli.js is required.");
const runNpm = (argv) =>
  execFileSync(process.execPath, [npm, ...argv], {
    cwd: root,
    windowsHide: true,
    timeout: 120_000,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
const archive = args[0]
  ? resolve(args[0])
  : join(
      fixture,
      JSON.parse(
        runNpm(["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", fixture]),
      )[0].filename,
    );
const consumer = join(fixture, "consumer");
seedConsumerLock(consumer, root);
runNpm([
  "install",
  "--prefix",
  consumer,
  "--offline",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  archive,
]);

// The packed proof is self-contained (the consumer installs only the packed
// package), so the shared fixture source is inlined ahead of the proof body;
// both are ESM and the fixture only imports node:crypto.
const fixtureSource = readFileSync(join(root, "tools/git-resolution-fixture.mjs"), "utf8");

writeFileSync(
  join(consumer, "proof.mjs"),
  `${fixtureSource}
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Arm the guards before the package import: any network, process or host
// discovery inside resolution or acquisition throws and fails this proof.
const blocked = (surface) => () => {
  throw new Error(\`Blocked \${surface} during the git resolution proof\`);
};
globalThis.fetch = blocked("fetch");
const require = createRequire(import.meta.url);
for (const name of ["node:http", "node:https", "node:net", "node:tls", "node:dns", "node:child_process"]) {
  const builtin = require(name);
  for (const key of ["request", "get", "createConnection", "connect", "lookup", "resolve", "query", "exec", "execFile", "execFileSync", "spawn", "spawnSync", "fork"]) {
    if (typeof builtin[key] === "function") builtin[key] = blocked(\`\${name}.\${key}\`);
  }
}

const {
  acquireGitSnapshot,
  GIT_SNAPSHOT_MAX_FILE_BYTES,
  GIT_SNAPSHOT_MAX_FILES,
  GIT_SNAPSHOT_MAX_SOURCE_BYTES,
  GIT_SNAPSHOT_MAX_SOURCE_ENTRIES,
  gitCliTransport,
  resolveGitRef,
} = await import("@aihq/catalog/node");
const { checkExactSourceIdentity } = await import("@aihq/catalog/source");
const { compileProducerDeclaration, prepareSourceRefresh } = await import("@aihq/catalog/producer");

const REPOSITORY = FIXTURE_REPOSITORY;
const ENCODER = FIXTURE_ENCODER;
const reasons = (result) => result.diagnostics.map((d) => d.reason);

// The published capture limits follow Scan's capture limits; the per-file and
// file-count envelope is what prepareSourceRefresh consumes, so every accepted
// snapshot is usable by it.
assert.equal(GIT_SNAPSHOT_MAX_SOURCE_ENTRIES, 100_000);
assert.equal(GIT_SNAPSHOT_MAX_SOURCE_BYTES, 256 * 1024 * 1024);
assert.equal(GIT_SNAPSHOT_MAX_FILE_BYTES, 16 * 1024 * 1024);
assert.equal(GIT_SNAPSHOT_MAX_FILES, 65_536);
const defaultTransport = gitCliTransport();
for (const method of ["listRefs", "branchTagClosure", "fetchCommit"]) {
  assert.equal(typeof defaultTransport[method], "function");
}

// Branch and tag refs resolve to an exact commit proven reachable from the
// named repository; the result carries the exact git source identity.
const reachableFixture = fixtureTransport({
  refs: [fixtureRef("refs/heads/main", COMMIT), fixtureRef("refs/tags/v1", OTHER_COMMIT), fixtureRef("refs/tags/v2", "9".repeat(40)), fixtureRef("refs/tags/v2^{}", COMMIT)],
  closure: [COMMIT, OTHER_COMMIT],
});
const branch = await resolveGitRef({ repository: REPOSITORY, ref: "main" }, { transport: reachableFixture });
assert.equal(branch.valid, true);
assert.equal(branch.commit, COMMIT);
assert.equal(branch.reachable, true);
assert.equal(branch.installable, true);
assert.deepEqual(branch.identity, { kind: "git", repository: REPOSITORY, commit: COMMIT, reachable: true });
assert.equal(checkExactSourceIdentity(branch.identity).valid, true);
const lightweightTag = await resolveGitRef({ repository: REPOSITORY, ref: "v1" }, { transport: reachableFixture });
assert.equal(lightweightTag.commit, OTHER_COMMIT);
const annotatedTag = await resolveGitRef({ repository: REPOSITORY, ref: "v2" }, { transport: reachableFixture });
assert.equal(annotatedTag.commit, COMMIT, "an annotated tag peels to its commit");

// A fork-only commit is refused: the advertisement names it, the named
// repository's ancestry does not contain it.
const forkOnly = fixtureTransport({ refs: [fixtureRef("refs/heads/main", FORK_COMMIT)], closure: [COMMIT, OTHER_COMMIT] });
const refused = await resolveGitRef({ repository: REPOSITORY, ref: "main" }, { transport: forkOnly });
assert.equal(refused.valid, false);
assert.equal(refused.reachable, false);
assert.equal(refused.installable, false);
assert.equal(refused.commit, FORK_COMMIT);
assert.deepEqual(refused.identity, { kind: "git", repository: REPOSITORY, commit: FORK_COMMIT, reachable: false });
assert(reasons(refused).includes("git-commit-unreachable"));

// An uncheckable reachability resolves unchecked and blocks installability.
const unchecked = await resolveGitRef(
  { repository: REPOSITORY, ref: "main" },
  { transport: fixtureTransport({ refs: [fixtureRef("refs/heads/main", COMMIT)], closureError: new Error("offline") }) },
);
assert.equal(unchecked.valid, true);
assert.equal(unchecked.reachable, "unchecked");
assert.equal(unchecked.installable, false);
assert.deepEqual(unchecked.identity, { kind: "git", repository: REPOSITORY, commit: COMMIT, reachable: "unchecked" });
assert.equal(checkExactSourceIdentity(unchecked.identity).valid, true);
assert(reasons(unchecked).includes("git-reachability-unchecked"));
assert(unchecked.diagnostics[0].message.includes("cannot be made installable until it is checked"));

// Invalid requests never reach the transport.
const neverCalled = fixtureTransport({
  refs: [fixtureRef("refs/heads/main", COMMIT)],
  closure: [COMMIT],
  listRefsError: new Error("the transport must not be called"),
});
for (const request of [
  { repository: "http://github.com/example/skills", ref: "main" },
  { repository: REPOSITORY, ref: "refs/heads/main" },
  { repository: REPOSITORY, ref: "a b" },
]) {
  const result = await resolveGitRef(request, { transport: neverCalled });
  assert.equal(result.valid, false);
}

// Exact-commit acquisition returns a bounded snapshot usable by
// prepareSourceRefresh: the caller adds its declared source id and refreshes.
const LICENSE = ENCODER.encode("MIT license fixture\\n");
const SKILL = ENCODER.encode("---\\ndescription: Brought skill.\\n---\\n# Brought\\n\\nFixture.\\n");
const EXECUTABLE = ENCODER.encode("#!/bin/sh\\necho fixture\\n");
const treeFiles = [
  { path: "LICENSE", bytes: LICENSE },
  { path: "skills/brought/SKILL.md", bytes: SKILL },
  { path: "skills/brought/run.sh", bytes: EXECUTABLE, mode: "100755" },
];
const tree = fixtureAcquiredCommit(treeFiles);
const acquireFixture = fixtureTransport({ commits: new Map([[COMMIT, tree]]) });
const acquired = await acquireGitSnapshot({ repository: REPOSITORY, commit: COMMIT }, { transport: acquireFixture });
assert.equal(acquired.valid, true);
const snapshot = acquired.snapshot;
assert.equal(snapshot.repository, REPOSITORY);
assert.equal(snapshot.revision, COMMIT);
assert.equal(snapshot.entryCount, 3);
assert.equal(snapshot.byteLength, LICENSE.byteLength + SKILL.byteLength + EXECUTABLE.byteLength);
assert.equal(snapshot.modes["skills/brought/run.sh"], 0o755);
assert.equal(snapshot.modes["skills/brought/SKILL.md"], 0o644);
const expectedListing = treeFiles
  .map((file) => \`\${file.path}\\t\${sha256Hex(file.bytes)}\\n\`)
  .sort()
  .join("");
assert.equal(snapshot.captureSha256, sha256Hex(ENCODER.encode(expectedListing)));

const declaration = {
  schema: "urn:aihq:catalog:producer-declaration:3.1.0",
  format: "aihq-catalog-producer-declaration",
  version: 3,
  sources: [{ id: "brought", repository: "example/skills", licensePath: "LICENSE", license: "MIT" }],
  items: [{
    id: "brought.brought",
    source: "brought",
    label: "Brought",
    description: "Brought skill",
    kind: "skill",
    skillPath: "skills/brought/SKILL.md",
    requires: [],
    optional: [],
    conflicts: [],
    clientCapabilities: [],
    activation: [],
    configuration: { agentDirectory: { type: "string", required: true, default: ".claude", minLength: 1, maxLength: 64, description: "Project directory that receives skills/<name>/ (Claude Code reads .claude)." } },
  }],
};
const first = compileProducerDeclaration({
  declaration,
  sourceFiles: [{ source: "brought", revision: COMMIT, files: snapshot.files }],
});
assert.equal(first.status, "ok", JSON.stringify(first.diagnostics));
const refreshed = prepareSourceRefresh({
  declaration,
  source: "brought",
  inventoryComplete: true,
  sourceFiles: [{ source: "brought", revision: snapshot.revision, files: snapshot.files, modes: snapshot.modes }],
  previous: {
    releaseBytes: first.value.releaseBytes,
    materials: first.value.materials.map((member) => ({ path: member.path, bytes: member.bytes })),
  },
});
assert.equal(refreshed.status, "ok", JSON.stringify(refreshed.diagnostics));
assert.equal(refreshed.value.release.sources[0].origin.kind, "git");
assert.equal(refreshed.value.release.sources[0].origin.revision, COMMIT);

// Exceeding a published bound is a named refusal.
const twoFiles = fixtureAcquiredCommit([
  { path: "a.txt", bytes: ENCODER.encode("a") },
  { path: "b.txt", bytes: ENCODER.encode("b") },
]);
const entryLimit = await acquireGitSnapshot(
  { repository: REPOSITORY, commit: COMMIT },
  { transport: fixtureTransport({ commits: new Map([[COMMIT, twoFiles]]) }), maxSourceEntries: 1 },
);
assert.equal(entryLimit.valid, false);
assert(reasons(entryLimit).includes("snapshot-entry-limit"));
const byteLimit = await acquireGitSnapshot(
  { repository: REPOSITORY, commit: COMMIT },
  { transport: fixtureTransport({ commits: new Map([[COMMIT, twoFiles]]) }), maxSourceBytes: 1 },
);
assert.equal(byteLimit.valid, false);
assert(reasons(byteLimit).includes("snapshot-byte-limit"));
const bigFile = fixtureAcquiredCommit([{ path: "big.bin", bytes: new Uint8Array(GIT_SNAPSHOT_MAX_FILE_BYTES + 1) }]);
const fileLimit = await acquireGitSnapshot(
  { repository: REPOSITORY, commit: COMMIT },
  { transport: fixtureTransport({ commits: new Map([[COMMIT, bigFile]]) }) },
);
assert.equal(fileLimit.valid, false);
assert(reasons(fileLimit).includes("snapshot-file-limit"));

// Traversal-shaped content is refused by name: links, submodules and
// reserved git metadata never enter the snapshot.
const link = fixtureAcquiredCommit([{ path: "link", bytes: ENCODER.encode("../escape"), mode: "120000" }]);
assert(reasons(await acquireGitSnapshot({ repository: REPOSITORY, commit: COMMIT }, { transport: fixtureTransport({ commits: new Map([[COMMIT, link]]) }) })).includes("snapshot-link-refused"));
const submodule = {
  commitBytes: COMMIT_BYTES,
  entries: [{ mode: "160000", type: "commit", oid: "0".repeat(40), path: "vendor/dep" }],
  blobs: new Map(),
};
assert(reasons(await acquireGitSnapshot({ repository: REPOSITORY, commit: COMMIT }, { transport: fixtureTransport({ commits: new Map([[COMMIT, submodule]]) }) })).includes("snapshot-submodule-refused"));
const reservedBlob = ENCODER.encode("[core]");
const reserved = {
  commitBytes: COMMIT_BYTES,
  entries: [{ mode: "100644", type: "blob", oid: gitOid("blob", reservedBlob), path: ".git/config" }],
  blobs: new Map([[gitOid("blob", reservedBlob), reservedBlob]]),
};
assert(reasons(await acquireGitSnapshot({ repository: REPOSITORY, commit: COMMIT }, { transport: fixtureTransport({ commits: new Map([[COMMIT, reserved]]) }) })).includes("snapshot-reserved-path"));

// A lying transport that returns the wrong commit object is refused.
const lying = { commitBytes: ENCODER.encode("bogus"), entries: [], blobs: new Map() };
assert(reasons(await acquireGitSnapshot({ repository: REPOSITORY, commit: COMMIT }, { transport: fixtureTransport({ commits: new Map([[COMMIT, lying]]) }) })).includes("git-object-mismatch"));

console.log("Git resolution packed consumer passed");
`,
);
console.log(
  execFileSync(process.execPath, [join(consumer, "proof.mjs")], {
    cwd: consumer,
    windowsHide: true,
    encoding: "utf8",
    timeout: 90_000,
  }),
);
console.log(`Fixture retained: ${fixture}`);
