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
const read = name => JSON.parse(readFileSync(resolve(root, `producer/anthropic/${name}.json`)));
export function generateAnthropicRelease(identity = JSON.parse(readFileSync(resolve(root, "package.json")))) {
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
  const files = {}, supplied = [];
  for (const source of snapshot.sources) {
    const supplement = inventory.supplementalNotices?.find(row => row.source === source.id);
    assert.equal(source.repository, supplement?.repository ?? inventory.repository);
    assert.equal(source.revision, supplement?.revision ?? inventory.revision);
    const ownFiles = {};
    for (const file of source.files) {
      const bytes = Buffer.from(file.base64, "base64"), row = supplement ?? rows.get(file.path);
      assert(row && (supplement || row.disposition === "supported-material"));
      assert.equal(bytes.length, file.byteLength); assert.equal(file.byteLength, row.byteLength);
      assert.equal(sha(bytes), file.sha256); assert.equal(file.sha256, row.sha256);
      assert.equal(objectId("blob", bytes), row.gitBlob);
      if (files[file.path]) assert(Buffer.from(files[file.path]).equals(bytes));
      files[file.path] = new Uint8Array(bytes); ownFiles[file.path] = new Uint8Array(bytes);
    }
    const declared = declaration.sources.find(row => row.id === source.id);
    assert(declared && declared.repository === source.repository);
    assert(Buffer.from(ownFiles[declared.licensePath]).includes(Buffer.from(supplement ? "MIT License" : "Apache License")));
    for (const item of declaration.items.filter(item => item.source === source.id)) {
      const text = snapshot.recipes[item.recipePath];
      assert(typeof text === "string" && !rows.has(item.recipePath));
      ownFiles[item.recipePath] = new TextEncoder().encode(text);
      for (const member of item.materials) assert((supplement ?? rows.get(member.path))?.items.includes(item.id));
    }
    supplied.push({source: source.id, revision: source.revision, files: ownFiles});
  }
  // Check embedded notices where fonts have no adjacent copyright/license file.
  // This reads data only; it never loads or renders a font.
  for (const row of inventory.entries.filter(row => row.embeddedFontNotices)) {
    const bytes = Buffer.from(files[row.path]), count = bytes.readUInt16BE(4);
    let names;
    for (let i = 0; i < count; i++) {
      const offset = 12 + i * 16;
      if (bytes.subarray(offset, offset + 4).toString() === "name") {
        const start = bytes.readUInt32BE(offset + 8), length = bytes.readUInt32BE(offset + 12);
        names = bytes.subarray(start, start + length);
      }
    }
    assert(names, `Missing font name table ${row.path}`);
    const records = {}, total = names.readUInt16BE(2), start = names.readUInt16BE(4);
    for (let i = 0; i < total; i++) {
      const offset = 6 + i * 12, platform = names.readUInt16BE(offset), id = names.readUInt16BE(offset + 6);
      if (![0, 13, 14].includes(id)) continue;
      const length = names.readUInt16BE(offset + 8), position = names.readUInt16BE(offset + 10);
      const text = new TextDecoder([0, 3].includes(platform) ? "utf-16be" : "windows-1252", {fatal: true}).decode(names.subarray(start + position, start + position + length));
      records[id] ??= [];
      if (!records[id].includes(text)) records[id].push(text);
    }
    assert.deepEqual(records, row.embeddedFontNotices);
    assert(records[13].some(text => text.includes("Open Font License")));
    assert(files[row.licensePath], `Missing accompanying font license ${row.path}`);
  }
  for (const supplement of inventory.supplementalNotices ?? []) {
    assert(supplement.reason && supplement.owner);
    const raw = rows.get(supplement.association.anthropicPath);
    assert(raw && raw.supplementalNoticeItems.join() === supplement.items.join());
    for (const id of supplement.items) {
      const notice = declaration.items.find(item => item.id === id);
      assert(notice && notice.source === supplement.source);
      assert(declaration.items.some(item => raw.items.includes(item.id) && item.requires.some(ref => ref.itemId === id)));
    }
  }
  assert.equal(snapshot.sources.length, declaration.sources.length);
  assert.equal(Object.keys(snapshot.recipes).length, declaration.items.length);
  for (const row of inventory.entries) for (const id of row.items) {
    assert(files[row.path], `Missing source ${row.path}`);
    assert(declaration.items.some(item => item.id === id && item.materials.some(member => member.path === row.path)));
  }
  assert.equal(inventory.entries.filter(row => row.path.startsWith("skills/")).length, 413);
  assert.equal(inventory.donor.skills.length, 19);
  const donorFiles = new Set();
  for (const donor of inventory.donor.skills) {
    const bytes = readFileSync(resolve(root, donor.closurePath));
    assert.equal(sha(bytes), donor.closureSha256);
    assert.deepEqual(JSON.parse(bytes).files, donor.files);
    assert(donor.reason && donor.owner);
    for (const file of donor.files) {
      assert.equal(file.digest, `sha256:${rows.get(file.path)?.sha256}`);
      if (file.path.startsWith("skills/")) donorFiles.add(file.path);
    }
    assert.equal(donor.disposition === "supported-declaration", donor.items.length > 0);
    for (const id of donor.items) assert(declaration.items.some(item => item.id === id));
  }
  assert.equal(donorFiles.size, 413);
  declaration.package = { name: identity.name, version: identity.version };
  const compiled = compileProducerDeclaration({ declaration, sourceFiles: supplied });
  assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics));
  const output = new Map(compiled.value.materials.map(member => [member.path, Buffer.from(member.bytes)]));
  output.set("release/release-anthropic.json", Buffer.from(compiled.value.releaseBytes));
  const supported = inventory.entries.filter(row => row.items.length).length;
  output.set("docs/ANTHROPIC-INVENTORY.md", Buffer.from(`# Anthropic inventory and disposition

Generated by tools/generate-anthropic-release.mjs from reviewed ordinary data.
Canonical repository: ${inventory.repository}. Exact revision: ${inventory.revision}.
Complete Git tree: ${inventory.gitTree}. Original commit/tree objects bind all ${inventory.treeFileCount} files; 413 files belong to all 19 skill directories. ${supported} files have material recipes. Every raw path, Git mode/blob, SHA-256, byte length, owner, reason and item mapping is in [inventory.json](../producer/anthropic/inventory.json).

All 19 retained donor closures are checked by exact digest against this full tree; their shared README brings the retained union to 414 source files and is historical reference only. They are review-only donors, not automatically executable declarations. The inventory records each donor file and its disposition. All prior release bytes are retained.

14 skills have complete ordinary material closures in three client projections. doc-coauthoring has no item license and is unsupported pending Anthropic rights clarification. docx, pdf, pptx and xlsx prohibit local copying outside Services and redistribution under their own notices; neither bundled bytes nor BYO local copies are supported. Only paths/hashes/lengths and tool facts are shipped for these restricted files. No document script execution is claimed. Root plugin/spec/template files have precise unsupported installation dispositions. The third-party notice document is preserved in each permitted closure; fonts retain adjacent and embedded OFL notices. A separate exact shadcn MIT notice source supplies required per-client notice items for the unchanged bundled component archive; supplementalNotices records its pin, blob/hash/length and byte-matched association.

[Snapshot](../producer/anthropic/snapshot.json) separates permitted exact raw bytes from Catalog recipe overlays. [Declaration](../producer/anthropic/declaration.json) uses the public v3 contract. [Content guidance](ANTHROPIC-CONTENT.md) describes runtime tools and refusal boundaries. Material Apply is distinct from interpreter checks, native client loading and model/tool execution.

| Donor skill | Disposition | Reason/owner |
| --- | --- | --- |
${inventory.donor.skills.map(row => `| ${row.id} | ${row.disposition} | ${row.reason} Owner: ${row.owner}. |`).join("\n")}

| Item | Kind | Material files |
| --- | --- | --- |
${declaration.items.map(item => `| ${item.id} | ${item.kind} | ${item.materials.length} |`).join("\n")}
`));
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv[2] === "--check";
  assert.equal(process.argv.length, check ? 3 : 2, "Usage: node tools/generate-anthropic-release.mjs [--check]");
  const output = generateAnthropicRelease();
  for (const [path, bytes] of output) {
    const destination = resolve(root, path);
    if (check) assert(readFileSync(destination).equals(bytes), `${path} is stale`);
    else { mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, bytes); }
  }
  console.log(`${check ? "Checked" : "Generated"} release/release-anthropic.json (${output.size - 2} material/recipe members)`);
}
