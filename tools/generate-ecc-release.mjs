// Compile ordinary pinned ECC declarations. No fetch, source execution or installation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { translateCodexMcpServer } from "../dist/release/codex-mcp-entries.js";
import { compileProducerDeclaration } from "../dist/release/producer.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const read = name => JSON.parse(readFileSync(resolve(root, `producer/ecc/${name}.json`)));
export function generateEccRelease(identity = JSON.parse(readFileSync(resolve(root, "package.json")))) {
  const declaration = read("declaration"), snapshot = read("snapshot"), inventory = read("inventory");
  assert.equal(inventory.complete, true);
  assert.equal(inventory.treeFileCount, inventory.entries.length);
  const rows = new Map();
  for (const row of inventory.entries) {
    assert(!rows.has(row.path), `Duplicate source path ${row.path}`);
    assert(row.owner && row.reason && ["supported-material", "unsupported-installation"].includes(row.disposition));
    assert.equal(row.disposition === "supported-material", row.items.length > 0);
    rows.set(row.path, row);
  }
  // Reconstruct the complete Git tree from the full file ledger. Omitting even
  // an unsupported file changes this independently acquired pinned identity.
  const tree = new Map();
  for (const row of inventory.entries) {
    assert(/^[0-9a-f]{40}$/.test(row.gitBlob));
    assert(["100644", "100755"].includes(row.mode), `Unsupported Git member mode ${row.path}`);
    assert(!row.path.startsWith("/") && row.path.split("/").every(part => part && part !== "." && part !== ".."));
    let current = tree;
    const parts = row.path.split("/");
    for (const part of parts.slice(0, -1)) {
      if (!current.has(part)) current.set(part, new Map());
      assert(current.get(part) instanceof Map, `Tree/file collision ${row.path}`);
      current = current.get(part);
    }
    assert(!current.has(parts.at(-1)), `Tree member collision ${row.path}`);
    current.set(parts.at(-1), row);
  }
  const gitTreeHash = directory => {
    const members = [...directory].sort(([a, av], [b, bv]) => Buffer.compare(Buffer.from(a + (av instanceof Map ? "/" : "")), Buffer.from(b + (bv instanceof Map ? "/" : ""))));
    const body = Buffer.concat(members.map(([name, value]) => Buffer.concat([
      Buffer.from(`${value instanceof Map ? "40000" : value.mode} ${name}\0`),
      Buffer.from(value instanceof Map ? gitTreeHash(value) : value.gitBlob, "hex"),
    ])));
    return createHash("sha1").update(`tree ${body.length}\0`).update(body).digest("hex");
  };
  assert.equal(gitTreeHash(tree), inventory.gitTree, "Full pinned tree disposition is incomplete or changed");
  const source = snapshot.sources[0];
  assert.equal(snapshot.sources.length, 1);
  assert.equal(source.repository, inventory.repository);
  assert.equal(source.revision, inventory.revision);
  assert.equal(declaration.sources[0].repository, inventory.repository);
  const files = {}, seen = new Set();
  for (const file of source.files) {
    assert(!seen.has(file.path), `Duplicate supplied member ${file.path}`);
    seen.add(file.path);
    const bytes = Buffer.from(file.base64, "base64"), row = rows.get(file.path);
    assert(row, `Missing disposition ${file.path}`);
    assert.equal(row.disposition, "supported-material");
    assert.equal(sha(bytes), file.sha256);
    assert.equal(bytes.length, file.byteLength);
    assert.equal(file.sha256, row.sha256);
    assert.equal(file.byteLength, row.byteLength);
    assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), row.gitBlob);
    files[file.path] = new Uint8Array(bytes);
  }
  for (const row of inventory.entries) for (const id of row.items) {
    assert(seen.has(row.path), `Missing supported source ${row.path}`);
    assert(declaration.items.some(item => item.id === id && item.materials.some(material => material.path === row.path)), `Missing declared disposition ${id}:${row.path}`);
  }
  for (const item of declaration.items) for (const material of item.materials) {
    assert(rows.get(material.path)?.items.includes(item.id), `Missing reverse disposition ${item.id}:${material.path}`);
  }
  assert.equal(inventory.donor.assets.length, 442);
  assert.equal(sha(readFileSync(resolve(root, inventory.donor.path))), inventory.donor.sha256);
  const donor = JSON.parse(readFileSync(resolve(root, inventory.donor.path))).sections.componentDefinitions.framework.assets;
  assert.deepEqual(inventory.donor.assets.map(row => row.id), donor.map(row => row.id));
  for (const row of inventory.donor.assets) {
    assert(row.reason && row.owner);
    assert.equal(row.disposition === "supported-declaration", row.items.length > 0);
    for (const id of row.items) assert(declaration.items.some(item => item.id === id));
  }
  for (const [path, text] of Object.entries(snapshot.recipes.ecc)) {
    assert(!files[path], `Overlay collides with upstream source ${path}`);
    assert(declaration.items.some(item => item.recipePath === path), `Orphan recipe ${path}`);
    files[path] = new TextEncoder().encode(text);
  }
  const rawServers = JSON.parse(Buffer.from(files["mcp-configs/mcp-servers.json"]).toString("utf8")).mcpServers;
  for (const item of declaration.items.filter(item => item.id.startsWith("ecc.claude.mcp."))) {
    const fact = inventory.itemFacts[item.id];
    assert(fact, `Missing MCP facts ${item.id}`);
    assert.deepEqual(fact.rawServer, rawServers[fact.upstreamSourceKey ?? fact.sourceKey], `Raw MCP facts differ ${item.id}`);
    assert.equal(item.clientCapabilities.find(capability => capability.capability === "native-execution")?.reason, fact.runtimePrerequisites, `MCP execution facts differ ${item.id}`);
    assert.equal(item.activation[0]?.instructions, fact.runtimePrerequisites, `MCP activation facts differ ${item.id}`);
    const recipe = JSON.parse(snapshot.recipes.ecc[item.recipePath]);
    const offered = recipe.operations.find(operation => operation.kind === "config.entries")?.entries[0];
    assert.deepEqual(offered?.path, ["mcpServers", fact.sourceKey]);
    assert.deepEqual(offered?.value.literal, fact.offeredServer, `Offered MCP facts differ ${item.id}`);
    assert.deepEqual(recipe.prerequisites, fact.offeredServer.command ? [{ kind: "executable", name: fact.offeredServer.command }] : []);
    const variables = [...JSON.stringify(fact.offeredServer).matchAll(/\$\{([A-Z_][A-Z0-9_]*)(:-[^}]*)?\}/g)];
    const required = [...new Set(variables.filter(match => !match[2]).map(match => match[1]))].sort();
    const optional = [...new Set(variables.filter(match => match[2]).map(match => match[1]))].sort();
    assert.deepEqual([...fact.requiredHostEnvironment].sort(), required, `Required host inputs differ ${item.id}`);
    assert.deepEqual([...(fact.optionalHostEnvironment ?? [])].sort(), optional, `Optional host inputs differ ${item.id}`);
  }
  // Codex counterparts: each offered Claude server has exactly one of a Codex item or a recorded exclusion.
  const claudeItems = declaration.items.filter(item => item.id.startsWith("ecc.claude.mcp."));
  const claudeKeys = claudeItems.map(item => inventory.itemFacts[item.id].sourceKey);
  const excluded = new Map();
  for (const { sourceKey, reason } of inventory.codexMcpExclusions ?? []) {
    assert(reason, `Missing Codex MCP exclusion reason ${sourceKey}`);
    assert(!excluded.has(sourceKey), `Duplicate Codex MCP exclusion ${sourceKey}`);
    excluded.set(sourceKey, reason);
  }
  const translated = new Set();
  for (const item of declaration.items.filter(item => item.id.startsWith("ecc.codex.mcp."))) {
    const fact = inventory.itemFacts[item.id];
    assert(fact, `Missing Codex MCP facts ${item.id}`);
    assert.equal(item.id, `ecc.codex.mcp.${fact.sourceKey}`);
    assert.equal(item.kind, "mcp");
    assert(!translated.has(fact.sourceKey), `Duplicate Codex MCP item ${item.id}`);
    translated.add(fact.sourceKey);
    assert.deepEqual(fact.rawServer, rawServers[fact.upstreamSourceKey ?? fact.sourceKey], `Raw MCP facts differ ${item.id}`);
    const sibling = inventory.itemFacts[`ecc.claude.mcp.${fact.sourceKey}`];
    const siblingItem = claudeItems.find(claude => claude.id === `ecc.claude.mcp.${fact.sourceKey}`);
    assert(sibling && siblingItem, `Codex MCP item without a Claude counterpart ${item.id}`);
    assert.deepEqual(fact.offeredServer, sibling.offeredServer, `Codex MCP translation input differs ${item.id}`);
    for (const name of ["requiredHostEnvironment", "optionalHostEnvironment", "runtimePrerequisites"]) assert.deepEqual(fact[name], sibling[name], `Codex MCP ${name} differ ${item.id}`);
    assert.deepEqual(item.materials, siblingItem.materials, `Codex MCP materials differ from the Claude counterpart ${item.id}`);
    assert.equal(item.clientCapabilities.find(capability => capability.client === "codex" && capability.capability === "native-execution")?.reason, fact.runtimePrerequisites, `MCP execution facts differ ${item.id}`);
    assert.equal(item.activation[0]?.instructions, fact.runtimePrerequisites, `MCP activation facts differ ${item.id}`);
    const translation = translateCodexMcpServer(fact.sourceKey, fact.offeredServer);
    assert(translation.supported, `Codex MCP item for an untranslatable server ${item.id}: ${translation.reason}`);
    const recipe = JSON.parse(snapshot.recipes.ecc[item.recipePath]);
    const claudeRecipe = JSON.parse(snapshot.recipes.ecc[siblingItem.recipePath]);
    const home = (target) => ({ root: "userHome", segments: target.segments.map(segment => segment.literal === siblingItem.id ? { literal: item.id } : segment) });
    const delivered = [
      ...claudeRecipe.operations.filter(operation => operation.kind === "file.write").map(operation => ({ ...operation, scope: "user", target: home(operation.target) })),
      ...claudeRecipe.operations.filter(operation => operation.kind === "process.run").map(operation => ({ ...operation, scope: "user", cwd: home(operation.cwd) })),
    ];
    assert.deepEqual(recipe.operations.slice(0, -1), delivered, `Codex MCP material delivery differs from the Claude counterpart ${item.id}`);
    assert.deepEqual(recipe.checks, claudeRecipe.checks.map(check => ({ ...check, target: home(check.target) })), `Codex MCP material checks differ ${item.id}`);
    assert.deepEqual(recipe.operations.at(-1), {
      id: "register-server",
      purpose: `Register exact offered ECC ${fact.sourceKey} server for Codex`,
      kind: "config.entries",
      scope: "user",
      target: { root: "userHome", segments: [{ literal: ".codex" }, { literal: "config.toml" }] },
      format: "toml",
      entries: translation.entries,
      requires: claudeRecipe.operations.find(operation => operation.kind === "config.entries").requires,
      checks: [],
    }, `Codex MCP operation differs from the translation ${item.id}`);
    assert.deepEqual(recipe.prerequisites, translation.prerequisites, `Codex MCP prerequisites differ ${item.id}`);
    assert.deepEqual(recipe.targets, ["user"]);
    assert.deepEqual(recipe.materials, []);
    assert(recipe.operations.every(operation => operation.scope === "user"), `Codex MCP operation outside user scope ${item.id}`);
  }
  for (const key of claudeKeys) assert.notEqual(translated.has(key), excluded.has(key), `Claude MCP server ${key} needs exactly one of a Codex item or a recorded exclusion`);
  for (const key of excluded.keys()) {
    assert(claudeKeys.includes(key), `Codex MCP exclusion for an unknown server ${key}`);
    const translation = translateCodexMcpServer(key, inventory.itemFacts[`ecc.claude.mcp.${key}`].offeredServer);
    assert.equal(translation.supported, false, `Excluded Codex MCP server ${key} is translatable`);
    assert.equal(excluded.get(key), translation.reason, `Codex MCP exclusion reason differs ${key}`);
  }
  declaration.package = { name: identity.name, version: identity.version };
  const compiled = compileProducerDeclaration({ declaration, sourceFiles: [{ source: "ecc", revision: source.revision, files }] });
  assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics));
  const output = new Map(compiled.value.materials.map(file => [file.path, Buffer.from(file.bytes)]));
  output.set("release/release-ecc.json", Buffer.from(compiled.value.releaseBytes));
  const counts = key => inventory.entries.reduce((total, row) => total + (row.disposition === key ? 1 : 0), 0);
  const kindCounts = new Map();
  for (const item of declaration.items) kindCounts.set(item.kind, (kindCounts.get(item.kind) ?? 0) + 1);
  const summary = `# ECC inventory and disposition\n\nGenerated by tools/generate-ecc-release.mjs from reviewed ordinary data.\n\nRepository: ${inventory.repository}\n\nRevision: ${inventory.revision}\n\nComplete Git tree: ${inventory.gitTree}\n\nAll ${inventory.treeFileCount} regular source files have one disposition: ${counts("supported-material")} supported material files and ${counts("unsupported-installation")} files without an installation recipe. Supported material means exact file delivery, not native execution. Each unsupported row names a reason and the Catalog ECC adapter maintainer as owner.\n\nThe independent historical donor has ${inventory.donor.assets.length} assets: ${inventory.donor.assets.filter(row => row.items.length).length} mapped to declarations and ${inventory.donor.assets.filter(row => !row.items.length).length} explicitly unsupported aggregate/runtime assets. It is not the current delivered-item count.\n\nThe ${declaration.items.length} declarations comprise ${[...kindCounts].map(([kind, count]) => count + " " + kind).join(", ")}. Raw original bytes and Catalog recipes remain separate.\n\nFull file paths, Git blob identities, modes, SHA-256 digests, lengths, notices, per-file owners/reasons, donor mappings and item facts are in [inventory.json](../producer/ecc/inventory.json). The supported original bytes are in [snapshot.json](../producer/ecc/snapshot.json); all selectable contracts are in [declaration.json](../producer/ecc/declaration.json). [Content guidance](ECC-CONTENT.md) explains client/prerequisite and distribution limits.\n\n## Granular choices\n\n| Item | Kind | Source material files |\n| --- | --- | --- |\n${declaration.items.map(item => "| " + item.id + " | " + item.kind + " | " + item.materials.length + " |").join("\n")}\n`;
  output.set("docs/ECC-INVENTORY.md", Buffer.from(summary));
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv[2] === "--check";
  assert.equal(process.argv.length, check ? 3 : 2, "Usage: node tools/generate-ecc-release.mjs [--check]");
  const output = generateEccRelease();
  for (const [path, bytes] of output) {
    const destination = resolve(root, path);
    if (check) assert(readFileSync(destination).equals(bytes), `${path} is stale`);
    else { mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, bytes); }
  }
  console.log(`${check ? "Checked" : "Generated"} release/release-ecc.json (${output.size - 2} material/recipe members)`);
}
