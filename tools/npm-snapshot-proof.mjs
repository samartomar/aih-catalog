import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { gzipSync } from "node:zlib";
const require = createRequire(import.meta.url);
const blocked = () => {
  throw new Error("Package execution or live network is forbidden");
};
for (const name of ["node:child_process", "node:http", "node:https", "node:net", "node:tls"]) {
  const module = require(name);
  for (const key of [
    "exec",
    "execSync",
    "execFile",
    "execFileSync",
    "spawn",
    "spawnSync",
    "fork",
    "request",
    "get",
    "connect",
    "createConnection",
  ])
    if (typeof module[key] === "function") module[key] = blocked;
}
syncBuiltinESMExports();
globalThis.fetch = blocked;
const { acquireNpmSnapshot, NPM_SNAPSHOT_LIMITS } = await import("@aihq/catalog/node");
assert.deepEqual(NPM_SNAPSHOT_LIMITS, {
  sourceEntries: 100000,
  sourceBytes: 268435456,
  archiveBytes: 370837504,
  metadataBytes: 1048576,
  timeoutMs: 30000,
});
const { checkExactSourceIdentity } = await import("@aihq/catalog/source");
function tar(entries) {
  const chunks = [];
  for (const [path, value, mode = 0o644, type = "0"] of entries) {
    const bytes = Buffer.from(value),
      header = Buffer.alloc(512);
    header.write(path);
    header.write(mode.toString(8).padStart(7, "0") + "\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124);
    header.fill(32, 148, 156);
    header.write(type, 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    const checksum = header.reduce((n, b) => n + b, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
    chunks.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
const manifest = {
  name: "@example/ordinary",
  version: "1.2.3",
  scripts: { install: "node should-never-run.cjs" },
};
const entries = [
  ["package/LICENSE", "Apache-2.0 fixture notice"],
  ["package/package.json", JSON.stringify(manifest)],
  ["package/note.md", "# Ordinary package\n"],
  ["package/bin/start.cjs", "throw new Error('must never execute');", 0o755],
];
let bytes = tar(entries);
const pin = (archive) => "sha512-" + createHash("sha512").update(archive).digest("base64");
const request = { name: manifest.name, version: manifest.version, integrity: pin(bytes) };
const fetch = async (url, options) => {
  assert.equal(options.redirect, "error");
  assert.equal(options.credentials, "omit");
  if (String(url) === "https://registry.npmjs.org/%40example%2Fordinary/1.2.3")
    return new Response(
      JSON.stringify({
        ...manifest,
        dist: { tarball: "https://registry.npmjs.org/example.tgz", integrity: request.integrity },
      }),
    );
  assert.equal(String(url), "https://registry.npmjs.org/example.tgz");
  return new Response(bytes);
};
const result = await acquireNpmSnapshot(request, { fetch });
assert.equal(result.valid, true, JSON.stringify(result));
assert.deepEqual(result.identity, {
  kind: "npm",
  package: "@example/ordinary",
  version: "1.2.3",
  integrity: request.integrity,
});
assert.equal(checkExactSourceIdentity(result.identity).valid, true);
assert.equal(Buffer.from(result.snapshot.files["note.md"]).toString(), "# Ordinary package\n");
assert.equal(result.snapshot.modes["bin/start.cjs"], 0o755);
assert.equal(result.snapshot.modes["note.md"], 0o644);
assert.match(result.snapshot.revision, /^[0-9a-f]{64}$/);

const duplicateDirectory = tar([
  ...entries,
  ["package/empty/", "", 0o755, "5"],
  ["package/empty/", "", 0o755, "5"],
]);
const duplicate = await acquireNpmSnapshot(
  { ...request, integrity: pin(duplicateDirectory) },
  {
    fetch: async (url) =>
      String(url).endsWith("1.2.3")
        ? new Response(
            JSON.stringify({
              ...manifest,
              dist: {
                tarball: "https://registry.npmjs.org/example.tgz",
                integrity: pin(duplicateDirectory),
              },
            }),
          )
        : new Response(duplicateDirectory),
  },
);
assert.equal(duplicate.valid, false, "Duplicate explicit directories must be refused");
assert.equal(duplicate.diagnostics[0].reason, "archive-duplicate-entry");
async function refused(input, reason, controls = { fetch }) {
  const r = await acquireNpmSnapshot(input, controls);
  assert.equal(r.valid, false, JSON.stringify(r));
  assert.equal(r.diagnostics[0].reason, reason, JSON.stringify(r));
  assert(!("snapshot" in r));
  assert(!("identity" in r));
}
for (const version of ["latest", "^1.2.3", "1.x", "v1.2.3"])
  await refused({ ...request, version }, "npm-version-not-exact", { fetch: blocked });
const missing = { ...request };
delete missing.integrity;
await refused(missing, "npm-integrity-required", { fetch: blocked });
for (const integrity of ["", "sha512-AA==", "sha1-" + "a".repeat(28)])
  await refused({ ...request, integrity }, "npm-invalid-integrity", { fetch: blocked });
const transport =
  (archive, metadata = { ...manifest }, override = {}) =>
  async (url) =>
    String(url).endsWith("1.2.3")
      ? new Response(
          JSON.stringify({
            ...metadata,
            dist: {
              tarball: "https://registry.npmjs.org/example.tgz",
              integrity: pin(archive),
              ...override,
            },
          }),
        )
      : new Response(archive);
const mutable = tar([
  ["package/package.json", JSON.stringify({ ...manifest, version: "latest" })],
  ...entries.filter(([path]) => path !== "package/package.json"),
]);
await refused({ ...request, integrity: pin(mutable) }, "npm-package-identity-mismatch", {
  fetch: transport(mutable),
});
await refused(request, "npm-package-identity-mismatch", {
  fetch: transport(bytes, { ...manifest, name: "substituted" }),
});
await refused(request, "npm-integrity-mismatch", {
  fetch: async (url) =>
    String(url).endsWith("1.2.3")
      ? fetch(url, { redirect: "error", credentials: "omit" })
      : new Response(Buffer.from("tampered")),
});
await refused(request, "npm-integrity-mismatch", {
  fetch: transport(bytes, manifest, { integrity: pin(Buffer.from("different")) }),
});
for (const tarball of [
  "http://example.invalid/x.tgz",
  "https://user:password@example.invalid/x.tgz",
  "https://example.invalid/x#fragment",
  "https://example.invalid:99999/x",
])
  await refused(request, "npm-invalid-archive-url", {
    fetch: transport(bytes, manifest, { tarball }),
  });
for (const [extra, reason] of [
  [["package/../escape", "bad"], "unsafe-archive-entry"],
  [["elsewhere/file", "bad"], "archive-layout"],
  [["package/link", "", 0o644, "2"], "unsafe-archive-entry"],
  [["package/hard", "", 0o644, "1"], "unsafe-archive-entry"],
  [["package/special", "", 0o644, "3"], "unsafe-archive-entry"],
  [["package/pax", "", 0o644, "x"], "unsafe-archive-entry"],
  [["package/.git/config", "bad"], "unsafe-archive-entry"],
  [["package/NOTE.md", "bad"], "archive-duplicate-entry"],
  [["package/note.md", "bad"], "archive-duplicate-entry"],
]) {
  const archive = tar([...entries, extra]);
  await refused({ ...request, integrity: pin(archive) }, reason, { fetch: transport(archive) });
}
await refused(request, "npm-entry-limit", { fetch, limits: { sourceEntries: 3 } }); // Counts bin/ as an implicit entry.
await refused(request, "npm-byte-limit", { fetch, limits: { sourceBytes: 20 } });
await refused(request, "npm-byte-limit", { fetch, limits: { archiveBytes: bytes.length - 1 } });
await refused(request, "npm-byte-limit", { fetch, limits: { archiveBytes: bytes.length + 1 } }); // compressed fits, expanded tar does not.
await refused(request, "npm-byte-limit", { fetch, limits: { metadataBytes: 10 } });
await refused(request, "npm-byte-limit", {
  fetch: async () => new Response("", { headers: { "content-length": "1048577" } }),
});
await refused(request, "npm-invalid-request", {
  fetch: blocked,
  limits: { sourceEntries: 100001 },
});
await refused(request, "npm-download-failed", {
  fetch: async () => new Response(null, { status: 302 }),
});
const cancelled = new AbortController();
cancelled.abort();
await refused(request, "npm-cancelled", { fetch: blocked, signal: cancelled.signal });
await refused(request, "npm-cancelled", {
  fetch: () => new Promise(() => {}),
  limits: { timeoutMs: 5 },
});
await refused(request, "npm-byte-limit", {
  fetch,
  limits: { sourceBytes: Buffer.byteLength(JSON.stringify(manifest)) + 1 },
});
let streamCancelled = false;
await refused(request, "npm-byte-limit", {
  fetch: async () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(12));
        },
        cancel() {
          streamCancelled = true;
        },
      }),
    ),
  limits: { metadataBytes: 10 },
});
assert(streamCancelled, "The over-limit response stream is cancelled");
for (const archive of [
  gzipSync(Buffer.alloc(1024, 1)),
  Buffer.from("not gzip"),
  bytes.subarray(0, bytes.length - 5),
])
  await refused({ ...request, integrity: pin(archive) }, "archive-unreadable", {
    fetch: transport(archive),
  });
const oversizedManifest = tar([
  ["package/package.json", JSON.stringify({ ...manifest, description: "x".repeat(1048576) })],
]);
await refused({ ...request, integrity: pin(oversizedManifest) }, "npm-byte-limit", {
  fetch: transport(oversizedManifest),
});
const tightenedManifest = tar([
  ["package/package.json", JSON.stringify({ ...manifest, description: "x".repeat(1024) })],
]);
await refused({ ...request, integrity: pin(tightenedManifest) }, "npm-byte-limit", {
  fetch: transport(tightenedManifest),
  limits: { metadataBytes: 512 },
});
for (const cause of ["deadline", "host-abort"]) {
  let streamController;
  let bodyCancelled = false;
  let archiveRequested = false;
  const body = new ReadableStream({
    start(controller) {
      streamController = controller;
      controller.enqueue(new Uint8Array(64 * 1024));
      // An upstream body that stalls after a bounded prefix.
    },
    cancel() {
      bodyCancelled = true;
    },
  });
  const host = new AbortController();
  const request = {
    name: "example",
    version: "1.2.3",
    integrity: "sha512-" + Buffer.alloc(64).toString("base64"),
  };
  const transport = async (url) => {
    if (String(url).endsWith("/1.2.3")) {
      return new Response(
        JSON.stringify({
          name: request.name,
          version: request.version,
          dist: { integrity: request.integrity, tarball: "https://example.invalid/archive.tgz" },
        }),
      );
    }
    archiveRequested = true;
    return new Response(body);
  };
  const abortTimer = cause === "host-abort" ? setTimeout(() => host.abort(), 20) : undefined;
  const result = await acquireNpmSnapshot(request, {
    fetch: transport,
    signal: host.signal,
    limits: { timeoutMs: cause === "deadline" ? 20 : 1000 },
  });
  if (abortTimer !== undefined) clearTimeout(abortTimer);
  assert.equal(archiveRequested, true);
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].reason, "npm-cancelled");
  const cancelledAtReturn = bodyCancelled;
  const lockedAtReturn = body.locked;
  // Clean up the deliberately stalled fixture after recording the returned state.
  if (!bodyCancelled) streamController.close();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(cancelledAtReturn, true, cause + " cancels stalled body");
  assert.equal(lockedAtReturn, false, cause + " releases body reader");
}

console.log("npm refusal fixtures passed");

const { compileProducerDeclaration } = await import("@aihq/catalog/producer");
// A caller-authored fixture declaration and recipe, separate from the acquired package.
const declaration = {
  schema: "urn:aihq:catalog:producer-declaration:3.1.0",
  format: "aihq-catalog-producer-declaration",
  version: 3,
  package: { name: "review-notes-catalog", version: "1.0.0" },
  sources: [
    { id: "notes", licensePath: "LICENSE", license: "Apache-2.0", origin: { kind: "local" } },
  ],
  items: [
    {
      id: "consumer-proof.review-note",
      source: "notes",
      label: "Review note",
      description:
        "An independently authored review note; no AIHQ curation or admission is implied.",
      kind: "instruction",
      recipePath: "recipe.json",
      materials: [
        { id: "license", path: "LICENSE" },
        { id: "note", path: "note.md" },
      ],
      requires: [],
      optional: [],
      conflicts: [],
      clientCapabilities: [
        {
          client: "generic",
          surface: "markdown",
          capability: "native-loading",
          support: "unknown",
          reason: "This example declares file delivery only; native loading has not been observed.",
        },
      ],
      activation: [],
      configuration: {},
    },
  ],
};
const recipe = Buffer.from(
  JSON.stringify({
    schema: "urn:aihq:core:recipe:1.0.0",
    id: "consumer-proof.review-note",
    description: "Deliver an independent note and its license.",
    inputs: {},
    materials: [],
    targets: ["project"],
    prerequisites: [],
    operations: [
      {
        id: "write-license",
        purpose: "Write license",
        kind: "file.write",
        scope: "project",
        target: { root: "project", segments: [{ literal: "license.md" }] },
        material: "license",
        requires: [],
        checks: ["check-license"],
      },
      {
        id: "write-note",
        purpose: "Write note",
        kind: "file.write",
        scope: "project",
        target: { root: "project", segments: [{ literal: "note.md" }] },
        material: "note",
        requires: [],
        checks: ["check-note"],
      },
    ],
    checks: [
      {
        id: "check-license",
        purpose: "Verify license",
        kind: "file.sha256",
        target: { root: "project", segments: [{ literal: "license.md" }] },
        sha256: { materialSha256: "license" },
      },
      {
        id: "check-note",
        purpose: "Verify note",
        kind: "file.sha256",
        target: { root: "project", segments: [{ literal: "note.md" }] },
        sha256: { materialSha256: "note" },
      },
    ],
  }),
);
const compiled = compileProducerDeclaration({
  declaration,
  sourceFiles: [
    {
      source: "notes",
      ...result.snapshot,
      files: { ...result.snapshot.files, "recipe.json": recipe },
    },
  ],
});
assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics));
assert.equal(compiled.value.release.items[0].label, "Review note");
assert(
  compiled.value.materials.some(
    (material) => Buffer.from(material.bytes).toString() === "# Ordinary package\n",
  ),
);
console.log("npm snapshot packed consumer passed");
