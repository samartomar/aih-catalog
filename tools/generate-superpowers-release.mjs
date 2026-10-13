// Ordinary supplied v3 data only: verify the pinned Git ledger, then compile.
// No acquisition, upstream execution, plugin installation or client settings change.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileProducerDeclaration } from "../dist/release/producer.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const objectId = (kind, bytes) => createHash("sha1").update(`${kind} ${bytes.length}\0`).update(bytes).digest("hex");
const read = name => JSON.parse(readFileSync(resolve(root, `producer/superpowers/${name}.json`)));
export function generateSuperpowersRelease(identity = JSON.parse(readFileSync(resolve(root, "package.json")))) {
  const declaration = read("declaration"), snapshot = read("snapshot"), inventory = read("inventory");
  assert.equal(inventory.complete, true);
  assert.equal(inventory.entries.length, inventory.treeFileCount);
  const commit = Buffer.from(inventory.commitBase64, "base64");
  assert.equal(objectId("commit", commit), inventory.revision);
  assert.equal(commit.toString().split("\n")[0], `tree ${inventory.gitTree}`);
  // The independently acquired commit and tree objects prove the entire file ledger,
  // including unsupported members. No ignored source path can silently disappear.
  const treeRows = new Map(), visited = new Set();
  function walk(id, prefix = "", ancestors = new Set()) {
    assert(!ancestors.has(id), `Cyclic source tree ${id}`);
    const nextAncestors = new Set([...ancestors, id]);
    visited.add(id);
    const bytes = Buffer.from(inventory.trees[id], "base64");
    assert.equal(objectId("tree", bytes), id);
    let offset = 0;
    while (offset < bytes.length) {
      const end = bytes.indexOf(0, offset);
      assert(end > offset && end + 21 <= bytes.length);
      const entry = bytes.subarray(offset, end).toString("utf8");
      const split = entry.indexOf(" "), mode = entry.slice(0, split), name = entry.slice(split + 1);
      assert(name && !name.includes("/") && ![".", ".."].includes(name));
      const blob = bytes.subarray(end + 1, end + 21).toString("hex"), path = prefix + name;
      if (mode === "40000") walk(blob, `${path}/`, nextAncestors);
      else { assert(["100644", "100755"].includes(mode)); assert(!treeRows.has(path)); treeRows.set(path, { mode, gitBlob: blob }); }
      offset = end + 21;
    }
  }
  walk(inventory.gitTree);
  assert.equal(visited.size, Object.keys(inventory.trees).length);
  assert.equal(treeRows.size, inventory.entries.length);
  const rows = new Map();
  for (const row of inventory.entries) {
    assert(!rows.has(row.path)); rows.set(row.path, row);
    assert.deepEqual(treeRows.get(row.path), { mode: row.mode, gitBlob: row.gitBlob });
    assert(row.owner && row.reason && ["supported-material", "unsupported-installation"].includes(row.disposition));
    assert.equal(row.disposition === "supported-material", row.items.length > 0);
  }
  const [source] = snapshot.sources;
  assert.equal(snapshot.sources.length, 1);
  assert.equal(source.repository, inventory.repository);
  assert.equal(source.revision, inventory.revision);
  assert.equal(declaration.sources[0].repository, inventory.repository);
  const files = {};
  for (const file of source.files) {
    assert(!files[file.path]);
    const bytes = Buffer.from(file.base64, "base64"), row = rows.get(file.path);
    assert(row && row.disposition === "supported-material");
    assert.equal(bytes.length, file.byteLength); assert.equal(file.byteLength, row.byteLength);
    assert.equal(sha(bytes), file.sha256); assert.equal(file.sha256, row.sha256);
    assert.equal(objectId("blob", bytes), row.gitBlob);
    files[file.path] = new Uint8Array(bytes);
  }
  for (const row of inventory.entries) for (const id of row.items) {
    assert(files[row.path], `Missing source ${row.path}`);
    assert(declaration.items.some(item => item.id === id && item.materials.some(member => member.path === row.path)), `Missing declared disposition ${id}:${row.path}`);
  }
  for (const item of declaration.items) for (const member of item.materials) assert(rows.get(member.path)?.items.includes(item.id));
  assert.equal(sha(readFileSync(resolve(root, inventory.donor.path))), inventory.donor.sha256);
  const donor = JSON.parse(readFileSync(resolve(root, inventory.donor.path))).sections.componentDefinitions.framework.assets;
  assert.equal(donor.length, 16);
  assert.deepEqual(inventory.donor.assets.map(row => row.id), donor.map(row => row.id));
  for (const row of inventory.donor.assets) {
    assert(row.reason && row.owner);
    assert.equal(row.disposition === "supported-declaration", row.items.length > 0);
    for (const id of row.items) assert(declaration.items.some(item => item.id === id));
  }
  for (const [path, text] of Object.entries(snapshot.recipes.superpowers)) {
    assert(!rows.has(path), `Overlay collides with raw source ${path}`);
    assert(declaration.items.some(item => item.recipePath === path));
    files[path] = new TextEncoder().encode(text);
  }
  declaration.package = { name: identity.name, version: identity.version };
  const compiled = compileProducerDeclaration({ declaration, sourceFiles: [{ source: source.id, revision: source.revision, files }] });
  assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics));
  const output = new Map(compiled.value.materials.map(member => [member.path, Buffer.from(member.bytes)]));
  output.set("release/release-superpowers.json", Buffer.from(compiled.value.releaseBytes));
  const supported = inventory.entries.filter(row => row.items.length).length;
  output.set("docs/SUPERPOWERS-INVENTORY.md", Buffer.from(`# Superpowers inventory and disposition\n\nGenerated by tools/generate-superpowers-release.mjs from reviewed ordinary data.\n\nCanonical repository: ${inventory.repository} (requested spelling ${inventory.requestedRepository}).\n\nExact revision: ${inventory.revision} (upstream ${inventory.upstreamVersion}, MIT).\n\nComplete Git tree: ${inventory.gitTree}. Original commit/tree objects bind all ${inventory.treeFileCount} files: ${supported} supported material files, ${inventory.treeFileCount - supported} files without an installation recipe. Every file has a path, mode, Git blob, SHA-256, length, owner, reason and item mapping in [inventory.json](../producer/superpowers/inventory.json). Runtime reference delivery is not native adapter installation.\n\nThe retained 16 donor assets are historical only: 15 skills mapped to current declarations and one aggregate plugin with an unsupported installation disposition. All 15 selected upstream skills have three client material projections. The ${declaration.items.length} declarations also include notices, runtime source references, caller-configured opt-in Claude hook registration and one labelled Catalog template.\n\n[Snapshot](../producer/superpowers/snapshot.json) separates exact upstream source bytes from Catalog-authored recipes; [declarations](../producer/superpowers/declaration.json) carry supported v3 metadata and relationships. [Content guidance](SUPERPOWERS-CONTENT.md) records distribution, client and runtime limitations. Empty conflict lists mean no declared conflict, not universal compatibility.\n\n| Item | Kind | Material files |\n| --- | --- | --- |\n${declaration.items.map(item => `| ${item.id} | ${item.kind} | ${item.materials.length} |`).join("\n")}\n`));
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv[2] === "--check";
  assert.equal(process.argv.length, check ? 3 : 2, "Usage: node tools/generate-superpowers-release.mjs [--check]");
  const output = generateSuperpowersRelease();
  for (const [path, bytes] of output) {
    const destination = resolve(root, path);
    if (check) assert(readFileSync(destination).equals(bytes), `${path} is stale`);
    else { mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, bytes); }
  }
  console.log(`${check ? "Checked" : "Generated"} release/release-superpowers.json (${output.size - 2} material/recipe members)`);
}
