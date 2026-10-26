// One packed, outside consumer for samartomar/aih-catalog#121. The packed
// Catalog package installs into a disposable consumer with lifecycle scripts
// disabled; every case runs through the public `@aihq/catalog/source` export
// only. Descriptions and identities stay data: the proof arms throwing guards
// on the process and network surfaces before importing the package, so any
// fetch, install, execution or host discovery inside the readers fails the
// proof.
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
  "Usage: node tools/verify-source-description-consumer.mjs [catalog.tgz]",
);
const fixture = mkdtempSync(join(tmpdir(), "aih-source-description-"));
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

writeFileSync(
  join(consumer, "proof.mjs"),
  `
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Arm the guards before the package import: any network, process or host
// discovery inside the readers throws and fails this proof.
const blocked = (surface) => () => {
  throw new Error(\`Blocked \${surface} during the source description proof\`);
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
  checkExactSourceIdentity,
  readSourceDescription,
  SOURCE_DESCRIPTION_MAX_BYTES,
  SOURCE_DESCRIPTION_MAX_DEPTH,
} = await import("@aihq/catalog/source");
const { SOURCE_DESCRIPTION_SCHEMA_ID } = await import("@aihq/catalog/contracts");

assert.equal(SOURCE_DESCRIPTION_SCHEMA_ID, "urn:aihq:catalog:source-description:1.0.0");
assert.equal(SOURCE_DESCRIPTION_MAX_BYTES, 64 * 1024);
assert.equal(SOURCE_DESCRIPTION_MAX_DEPTH, 8);

const COMMIT = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
// base64 of 64 zero bytes: one complete sha512 digest.
const INTEGRITY = "sha512-" + "A".repeat(86) + "==";
const canonical = (value) => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? \`[\${value.map(canonical).join(",")}]\`
  : \`{\${Object.keys(value).sort().map((key) => \`\${JSON.stringify(key)}:\${canonical(value[key])}\`).join(",")}}\`;
const encode = (document) => new TextEncoder().encode(\`\${canonical(document)}\\n\`);
const description = (id, label, locator, extra = {}) => ({
  schema: SOURCE_DESCRIPTION_SCHEMA_ID, id, label, ...extra, locator,
});

const read = (document) => {
  const result = readSourceDescription(encode(document));
  assert.equal(result.valid, true, JSON.stringify(result));
  return result;
};

// A consumer builds, validates, saves and re-reads a description for MCP, skill
// and agent sources; the bytes survive the round trip unchanged.
const descriptions = [
  description("src-mcp", "MCP server collection", { kind: "git", repository: "https://github.com/example/mcp-servers", ref: "main" }, { publisher: "example-org" }),
  description("src-skill", "Skill package", { kind: "npm", package: "@scope/skill", versionSpec: "^1.2.3" }),
  description("src-skill-exact", "Skill package at a version", { kind: "npm", package: "skill", versionSpec: "1.2.3" }),
  description("src-agent", "Local agent folder", { kind: "local", label: "my-agents" }),
  description("src-git-default", "Git source default branch", { kind: "git", repository: "https://github.com/example/skills" }),
];
const exactFields = ["commit", "integrity", "captureSha256", "reachable"];
for (const source of descriptions) {
  const bytes = encode(source);
  const first = readSourceDescription(bytes);
  const second = readSourceDescription(bytes);
  assert.equal(first.valid, true, JSON.stringify(first));
  assert.equal(second.valid, true, JSON.stringify(second));
  assert.equal(JSON.stringify(second.description), JSON.stringify(first.description));
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.description));
  assert.ok(Object.isFrozen(first.description.locator));
  // Discovery data only: reading a description never yields an exact identity.
  for (const exact of exactFields) {
    assert(!JSON.stringify(first.description).includes(\`"\${exact}"\`), \`\${exact} leaked into a description\`);
  }
}

// Refusals are precise: non-https git repositories, unknown kinds, unknown
// fields and unknown format versions are each named.
const refused = (document) => {
  const result = readSourceDescription(encode(document));
  assert.equal(result.valid, false, JSON.stringify(result));
  return result.diagnostics;
};
for (const repository of ["http://github.com/example/mcp", "ssh://git@github.com/example/mcp", "git@github.com:example/mcp.git", "git://github.com/example/mcp", "https://example.com:bad/repo", "https://example.com:99999/repo", " https://example.com/repo", "https://example.com/repo ", "https://example.com/\\nrepo", "HTTPS://example.com/repo"]) {
  assert(refused(description("src", "s", { kind: "git", repository })).some((d) => d.reason === "repository-not-https"), repository);
}
const unknownKind = refused(description("src", "s", { kind: "hg", repository: "https://example.com/x" }));
assert(unknownKind.some((d) => d.reason === "invalid-locator-kind" && d.encountered === "hg" && JSON.stringify(d.supported) === '["git","npm","local"]'));
assert(refused({ ...description("src", "s", { kind: "local", label: "x" }), policy: "pre-ticked" }).some((d) => d.reason === "unknown-field"));
const wrongVersion = refused({ ...description("src", "s", { kind: "local", label: "x" }), schema: "urn:aihq:catalog:source-description:2.0.0" });
assert(wrongVersion.some((d) => d.code === "SCHEMA_UNSUPPORTED" && d.encountered === "urn:aihq:catalog:source-description:2.0.0" && JSON.stringify(d.supported) === \`["\${SOURCE_DESCRIPTION_SCHEMA_ID}"]\`));
assert(refused(description("src", "s", { kind: "git", repository: "https://github.com/example/mcp", ref: "a b" })).some((d) => d.reason === "invalid-ref"));
assert(refused(description("src", "s", { kind: "npm", package: "Not A Package" })).some((d) => d.reason === "invalid-package"));

// Bytes that are not bounded canonical JSON with one LF are refused.
assert.equal(readSourceDescription(new TextEncoder().encode(\`\${JSON.stringify(descriptions[0], null, 2)}\\n\`)).valid, false);
assert.equal(readSourceDescription(new TextEncoder().encode(canonical(descriptions[0]))).valid, false);

// Exact identities: only resolution and acquisition produce these; the reader
// here validates them. Each kind accepted, mutable references refused.
const identities = [
  { kind: "git", repository: "https://github.com/example/mcp", commit: COMMIT, reachable: true },
  { kind: "git", repository: "https://github.com/example/mcp", commit: COMMIT, reachable: false },
  { kind: "git", repository: "https://github.com/example/mcp", commit: COMMIT, reachable: "unchecked" },
  { kind: "npm", package: "@scope/tool", version: "1.2.3", integrity: INTEGRITY },
  { kind: "local", captureSha256: SHA },
];
for (const identity of identities) {
  const result = checkExactSourceIdentity(identity);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.ok(Object.isFrozen(result.identity));
}
const identityRefused = (identity) => {
  const result = checkExactSourceIdentity(identity);
  assert.equal(result.valid, false, JSON.stringify(result));
  return result.diagnostics;
};
assert(identityRefused({ kind: "git", repository: "https://github.com/example/mcp", commit: "main", reachable: true }).some((d) => d.reason === "invalid-commit"));
assert(identityRefused({ kind: "npm", package: "tool", version: "^1.2.3", integrity: INTEGRITY }).some((d) => d.reason === "version-not-exact"));
assert(identityRefused({ kind: "npm", package: "tool", version: "latest", integrity: INTEGRITY }).some((d) => d.reason === "version-not-exact"));
assert(identityRefused({ kind: "npm", package: "tool", version: "1.2.3" }).some((d) => d.reason === "missing-field"));
assert(identityRefused({ kind: "npm", package: "tool", version: "1.2.3", integrity: "md5-dGVzdA==" }).some((d) => d.reason === "invalid-integrity"));
assert(identityRefused({ kind: "npm", package: "tool", version: "1.2.3", integrity: "sha512-a" }).some((d) => d.reason === "invalid-integrity"));
assert(identityRefused({ kind: "git", repository: "git@github.com:example/mcp.git", commit: COMMIT, reachable: true }).some((d) => d.reason === "repository-not-https"));
assert(identityRefused({ kind: "git", repository: "https://example.com:99999/repo", commit: COMMIT, reachable: true }).some((d) => d.reason === "repository-not-https"));
assert(identityRefused({ kind: "archive", sha256: SHA }).some((d) => d.reason === "invalid-kind"));
assert(identityRefused({ kind: "local", captureSha256: SHA, policy: "members-only" }).some((d) => d.reason === "unknown-field"));
assert(identityRefused({ kind: "local", captureSha256: "nope" }).some((d) => d.reason === "invalid-sha256"));

// A description is never an exact identity: parsed discovery data lacks the
// exact fields, and a description-shaped value is refused as an identity.
assert(identityRefused({ kind: "git", repository: "https://github.com/example/mcp", ref: COMMIT }).some((d) => d.reason === "missing-field"));

console.log("Source description packed consumer passed");
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
