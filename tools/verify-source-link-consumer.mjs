// One packed, outside consumer for samartomar/aih-catalog#120. The packed
// Catalog package installs into a disposable consumer with lifecycle scripts
// disabled; every case runs through the public `@aihq/catalog/source` export
// only. Pasted text stays data: the proof arms throwing guards on the process
// and network surfaces before importing the package, so any fetch, install,
// execution or host discovery inside the parser fails the proof.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
assert(args.length <= 1, "Usage: node tools/verify-source-link-consumer.mjs [catalog.tgz]");
const fixture = mkdtempSync(join(tmpdir(), "aih-source-link-"));
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
runNpm(["install", "--prefix", consumer, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", archive]);

writeFileSync(
  join(consumer, "proof.mjs"),
  `
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Arm the guards before the package import: any network, process or host
// discovery inside the parser throws and fails this proof.
const blocked = (surface) => () => {
  throw new Error(\`Blocked \${surface} during the parseSourceLink proof\`);
};
globalThis.fetch = blocked("fetch");
const require = createRequire(import.meta.url);
for (const name of ["node:http", "node:https", "node:net", "node:tls", "node:dns", "node:child_process"]) {
  const builtin = require(name);
  for (const key of ["request", "get", "createConnection", "connect", "lookup", "resolve", "query", "exec", "execFile", "execFileSync", "spawn", "spawnSync", "fork"]) {
    if (typeof builtin[key] === "function") builtin[key] = blocked(\`\${name}.\${key}\`);
  }
}

const { PARSE_SOURCE_LINK_MAX_CHARACTERS, parseSourceLink } = await import("@aihq/catalog/source");

assert.equal(PARSE_SOURCE_LINK_MAX_CHARACTERS, 2048);

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4";
const notExact = (reference) => ({
  code: "reference-not-exact",
  message: \`The reference \${JSON.stringify(reference)} is a branch, tag or other mutable pointer; it is reported as not exact and is never silently pinned.\`,
});
const skillsNote = (name) => ({
  code: "discovery-note",
  message: \`The selector "--skill \${name}" is a non-authoritative discovery note; it never changes the candidate source.\`,
});
const MCP_NOTE = {
  code: "discovery-note",
  message: "The MCP servers directory is a discovery listing, not a source; a listed server's upstream is never derived from the directory.",
};
const UNRECOGNISED_MESSAGE =
  "The input is not a recognised source link or install command; no candidate is derived. " +
  "Supported shapes: a GitHub repository, tree or permalink link, an npm package page, " +
  "an npx install command, or an npm package name.";
const unrecognised = {
  status: "unrecognised",
  diagnostics: [{ code: "unrecognised", message: UNRECOGNISED_MESSAGE }],
};

// Every accepted form, boundary, named refusal and no-guess case, with
// independently written expected documents.
const exactBase = \`https://github.com/owner/repo/blob/\${SHA}/docs/README.md\`;
const cases = [
  {
    input: exactBase,
    expected: {
      status: "recognised",
      candidate: { kind: "git", repository: "https://github.com/owner/repo", ref: SHA },
      diagnostics: [],
    },
  },
  {
    input: \`https://github.com/owner/repo/tree/\${SHA}\`,
    expected: {
      status: "recognised",
      candidate: { kind: "git", repository: "https://github.com/owner/repo", ref: SHA },
      diagnostics: [],
    },
  },
  {
    input: "https://github.com/owner/repo/tree/main/src",
    expected: {
      status: "recognised",
      candidate: { kind: "git", repository: "https://github.com/owner/repo", ref: "main" },
      diagnostics: [notExact("main")],
    },
  },
  {
    input: "https://github.com/owner/repo",
    expected: {
      status: "recognised",
      candidate: { kind: "git", repository: "https://github.com/owner/repo" },
      diagnostics: [notExact("default branch")],
    },
  },
  {
    input: "https://github.com/owner/repo.git",
    expected: {
      status: "recognised",
      candidate: { kind: "git", repository: "https://github.com/owner/repo" },
      diagnostics: [notExact("default branch")],
    },
  },
  {
    input: "https://www.npmjs.com/package/@scope/tool/v/1.2.3",
    expected: {
      status: "recognised",
      candidate: { kind: "npm", package: "@scope/tool", version: "1.2.3" },
      diagnostics: [],
    },
  },
  {
    input: "https://www.npmjs.com/package/tool",
    expected: {
      status: "recognised",
      candidate: { kind: "npm", package: "tool" },
      diagnostics: [notExact("latest")],
    },
  },
  {
    input: "npx -y package@1.2.3",
    expected: {
      status: "recognised",
      candidate: { kind: "npm", package: "package", version: "1.2.3" },
      diagnostics: [],
    },
  },
  {
    input: "npx @scope/tool@2.0.0",
    expected: {
      status: "recognised",
      candidate: { kind: "npm", package: "@scope/tool", version: "2.0.0" },
      diagnostics: [],
    },
  },
  {
    input: "npx -y package",
    expected: {
      status: "recognised",
      candidate: { kind: "npm", package: "package" },
      diagnostics: [notExact("latest")],
    },
  },
  {
    input: "npx package@latest",
    expected: {
      status: "recognised",
      candidate: { kind: "npm", package: "package" },
      diagnostics: [notExact("latest")],
    },
  },
  {
    input: "npx -y package@^1.2.3",
    expected: {
      status: "recognised",
      candidate: { kind: "npm", package: "package" },
      diagnostics: [notExact("^1.2.3")],
    },
  },
  {
    input: \`npx skills add https://github.com/owner/repo/tree/\${SHA} --skill review\`,
    expected: {
      status: "recognised",
      candidate: { kind: "git", repository: "https://github.com/owner/repo", ref: SHA },
      diagnostics: [skillsNote("review")],
    },
  },
  {
    input: "npx skills add https://github.com/owner/repo --skill review",
    expected: {
      status: "recognised",
      candidate: { kind: "git", repository: "https://github.com/owner/repo" },
      diagnostics: [notExact("default branch"), skillsNote("review")],
    },
  },
  {
    input: "https://github.com/modelcontextprotocol/servers",
    expected: {
      status: "recognised",
      candidate: { kind: "git", repository: "https://github.com/modelcontextprotocol/servers" },
      diagnostics: [notExact("default branch"), MCP_NOTE],
    },
  },
  {
    input: "https://github.com/modelcontextprotocol/servers/tree/main/src/everything",
    expected: {
      status: "recognised",
      candidate: {
        kind: "git",
        repository: "https://github.com/modelcontextprotocol/servers",
        ref: "main",
      },
      diagnostics: [notExact("main"), MCP_NOTE],
    },
  },
  {
    input: "@scope/tool@1.2.3",
    expected: {
      status: "recognised",
      candidate: { kind: "npm", package: "@scope/tool", version: "1.2.3" },
      diagnostics: [],
    },
  },
  {
    input: "tool",
    expected: {
      status: "recognised",
      candidate: { kind: "npm", package: "tool" },
      diagnostics: [notExact("latest")],
    },
  },
  {
    input: "tool@1.2.3-beta.1",
    expected: {
      status: "recognised",
      candidate: { kind: "npm", package: "tool", version: "1.2.3-beta.1" },
      diagnostics: [],
    },
  },
  {
    input: \`npx \${"a".repeat(2045)}\`,
    expected: {
      status: "unrecognised",
      diagnostics: [
        {
          code: "input-too-long",
          message:
            "Input exceeds the published limit of 2,048 characters for parseSourceLink; nothing was parsed.",
        },
      ],
    },
  },
  {
    input: "npx  -y   package@1.2.3",
    expected: {
      status: "recognised",
      candidate: { kind: "npm", package: "package", version: "1.2.3" },
      diagnostics: [],
    },
  },
  ...["", "   ", "hello world", "ftp://example.com/tool", "https://example.com/tool", "http://github.com/owner/repo", "github.com/owner/repo", "npx", "npx skills add not-a-url", "npm install tool", "https://github.com/owner", "https://github.com/owner/repo/extra/segments/here"].map((input) => ({ input, expected: unrecognised })),
];

const runAll = () =>
  cases.map(({ input, expected }) => {
    const result = parseSourceLink(input);
    return { input, result, expected };
  });

const first = runAll();
for (const { input, result, expected } of first) {
  assert.deepEqual(result, expected, input);
  assert.ok(Object.isFrozen(result), input);
  if (result.status === "unrecognised") {
    assert.ok(!("candidate" in result), \`no guessed candidate for \${JSON.stringify(input)}\`);
    assert.equal(result.diagnostics[0].code === "input-too-long", input.length > 2048, input);
  }
}

// Each accepted form parses to the same document on every run in this consumer.
const second = runAll();
assert.equal(JSON.stringify(second), JSON.stringify(first));

// Exactly 2,048 characters is admitted; 2,049 is the named refusal.
const admitted = \`\${exactBase}/\${"a".repeat(2048 - exactBase.length - 1)}\`;
assert.equal(admitted.length, 2048);
const atLimit = parseSourceLink(admitted);
assert.equal(atLimit.status, "recognised");
assert.equal(atLimit.candidate.ref, SHA);
const overLimit = parseSourceLink(\`\${admitted}a\`);
assert.equal(overLimit.status, "unrecognised");
assert.equal(overLimit.diagnostics[0].code, "input-too-long");
assert.ok(!("candidate" in overLimit));

assert.throws(() => parseSourceLink(42), TypeError);

console.log("Source link packed consumer passed");
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
