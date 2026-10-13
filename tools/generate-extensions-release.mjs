// Maintained ordinary v3 declarations over a pinned, complete upstream file inventory.
// This generator checks supplied bytes, compiles through the public producer, and writes
// only the separate Extensions release. It never fetches or executes upstream code.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileProducerDeclaration } from "../dist/release/producer.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export function generateExtensionsRelease(identity = JSON.parse(readFileSync(resolve(root, "package.json")))) {
  const declaration = JSON.parse(readFileSync(resolve(root, "producer/extensions/declaration.json")));
  const snapshot = JSON.parse(readFileSync(resolve(root, "producer/extensions/snapshot.json")));
  const inventory = JSON.parse(readFileSync(resolve(root, "producer/extensions/inventory.json")));
  const identities = new Set();
  const supplied = snapshot.sources.map(source => {
    const files = {};
    for (const file of source.files) {
      const key = `${source.id}:${file.path}`;
      assert(!identities.has(key), `Duplicate source member ${key}`);
      identities.add(key);
      const bytes = Buffer.from(file.base64, "base64");
      assert.equal(sha(bytes), file.sha256, `Source hash mismatch ${key}`);
      assert.equal(bytes.length, file.byteLength, `Source length mismatch ${key}`);
      const rows = inventory.entries.filter(row => row.source === source.id && row.path === file.path);
      assert.equal(rows.length, 1, `Missing or duplicate disposition ${key}`);
      assert.equal(rows[0].sha256, file.sha256);
      assert.equal(rows[0].byteLength, file.byteLength);
      assert.equal(rows[0].revision, source.revision);
      assert(rows[0].reason.length > 0);
      assert(["supported-material", "unsupported-installation"].includes(rows[0].disposition));
      assert.equal(rows[0].disposition === "supported-material", rows[0].items.length > 0);
      for (const id of rows[0].items) {
        assert(declaration.items.some(item => item.id === id && item.source === source.id && item.materials.some(material => material.path === file.path)), `Disposition names missing material ${key} in ${id}`);
      }
      files[file.path] = new Uint8Array(bytes);
    }
    // Recipes are attributable Catalog-authored overlays, not files claimed to exist
    // at the upstream commit. snapshot.sources contains only original upstream bytes.
    for (const [path, text] of Object.entries(snapshot.recipes[source.id] ?? {})) {
      assert(!files[path], `Recipe collides with pinned upstream source ${path}`);
      files[path] = new TextEncoder().encode(text);
    }
    return { source: source.id, revision: source.revision, files };
  });
  assert.equal(identities.size, inventory.entries.length, "Extraneous disposition rows");
  declaration.package = { name: identity.name, version: identity.version };
  const compiled = compileProducerDeclaration({ declaration, sourceFiles: supplied });
  assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics));
  const files = new Map(compiled.value.materials.map(member => [member.path, Buffer.from(member.bytes)]));
  files.set("release/release-extensions.json", Buffer.from(compiled.value.releaseBytes));
  return files;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv[2] === "--check";
  assert(process.argv.length === (check ? 3 : 2), "Usage: node tools/generate-extensions-release.mjs [--check]");
  const files = generateExtensionsRelease();
  for (const [path, bytes] of files) {
    const destination = resolve(root, path);
    if (check) assert(readFileSync(destination).equals(bytes), `${path} is stale`);
    else { mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, bytes); }
  }
  console.log(`${check ? "Checked" : "Generated"} release/release-extensions.json (${files.size - 1} recipe/material members)`);
}
