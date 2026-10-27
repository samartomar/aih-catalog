// Copied into an installed packed consumer. Provider execution has no credentials or tool calls.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readReleaseContent, configureItem } from "@aihq/catalog/reader";
const [node, npmCli, cache, output, archive] = process.argv.slice(2);
const root = dirname(fileURLToPath(import.meta.resolve("@aihq/catalog/package.json")));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const bytes = readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/release-ecc.content.json")));
const read = readReleaseContent(bytes, { expectedSha256: sha(bytes) });
assert(read.valid, JSON.stringify(read.diagnostics));
const selected = JSON.parse(readFileSync(join(root, "producer/ecc/mcp-acquisition.json")));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SystemRoot|WINDIR|TEMP|TMP)$/i.test(key)));
const treeDigest = directory => {
  const hash = createHash("sha256");
  const visit = (path, prefix = "") => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (entry.isSymbolicLink()) continue;
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) visit(join(path, entry.name), `${name}/`);
      else { hash.update(name); hash.update(sha(readFileSync(join(path, entry.name)))); }
    }
  };
  visit(directory);
  return hash.digest("hex");
};
const handshake = (item, directory, key) => new Promise(resolve => {
  const args = item.payload.args.map(arg => arg.replace("${ECC_FILESYSTEM_ROOT}", directory));
  const rootVariable = `AIHQ_MCP_${key.replaceAll("-", "_").toUpperCase()}_ROOT`;
  const child = spawn(node, args, { cwd: directory, env: { ...env, HOME: directory, USERPROFILE: directory, [rootVariable]: directory, MEMORY_FILE_PATH: join(directory, "memory.json") }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "", size = 0, done = false;
  const finish = result => { if (done) return; done = true; clearTimeout(timer); child.kill(); resolve(result); };
  const timer = setTimeout(() => finish({ status: "unverified", reason: "handshake-timeout" }), 20000);
  child.on("error", () => finish({ status: "unverified", reason: "process-unavailable" }));
  child.on("exit", code => finish({ status: "unverified", reason: "process-exit", code }));
  child.stderr.on("data", chunk => { size += chunk.length; if (size > 1048576) finish({ status: "unverified", reason: "output-bound" }); });
  child.stdout.on("data", chunk => {
    size += chunk.length;
    if (size > 1048576) return finish({ status: "unverified", reason: "output-bound" });
    buffer += chunk.toString();
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n"), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.id === 1 && message.result) {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
      }
      if (message.id === 2 && Array.isArray(message.result?.tools)) finish({ status: "schema-observed", tools: message.result.tools.map(tool => tool.name), nativeClient: "not-run", toolCalls: 0 });
    }
  });
  child.stdin.on("error", () => {});
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "catalog-isolated-fixture", version: "1.0.0" } } })}\n`);
});
const results = [];
for (const [key, provider] of Object.entries(selected.providers)) {
  const item = read.release.items.find(item => item.id === `ecc.mcp.${key}`);
  const configured = configureItem({ release: read.release, itemId: item.id, configuration: { npmCli, npmCache: cache }, materialSource: { kind: "local", input: "catalog" }, ...(item.recipes ? { clientId: "claude-code" } : {}) });
  assert(configured.valid, JSON.stringify(configured.diagnostics));
  const recipe = JSON.parse(readFileSync(join(root, item.recipes?.["claude-code"].path ?? item.recipe.path)));
  const directory = join(output, key); mkdirSync(directory);
  for (const operation of recipe.operations.filter(operation => operation.kind === "file.write" && operation.content))
    writeFileSync(join(directory, operation.target.segments.at(-1).literal), operation.content.literal);
  const operation = recipe.operations.find(operation => operation.id === "acquire-server");
  const args = operation.args.map(slot => "literal" in slot ? slot.literal : ({ npmCli, npmCache: cache, acquisitionMode: "--online" })[slot.input]);
  const run = (executable, values) => execFileSync(executable, values, { cwd: directory, env: { ...env, HOME: directory, USERPROFILE: directory }, windowsHide: true, stdio: "pipe", timeout: 160000, encoding: "utf8", maxBuffer: 2097152 });
  const result = { key, ...provider, lockSha256: sha(readFileSync(join(directory, "package-lock.json"))), acquisition: "unverified", activation: "unverified" };
  try {
    assert.throws(() => run(process.execPath, args), /incompatible-runtime/);
    assert.throws(() => run(node, args.map((arg, index) => index === 1 ? "" : arg)), /missing-runtime/);
    const installed = JSON.parse(run(node, args).trim().split("\n").at(-1));
    assert.equal(installed.installation, "installed");
    const first = treeDigest(join(directory, "node_modules"));
    run(node, args.map(arg => arg === "--online" ? "--offline" : arg));
    assert.equal(treeDigest(join(directory, "node_modules")), first, "offline retry changed installed bytes");
    const lock = readFileSync(join(directory, "package-lock.json"));
    writeFileSync(join(directory, "package-lock.json"), `${lock}\n`);
    assert.throws(() => run(node, args), /changed acquisition lock/);
    writeFileSync(join(directory, "package-lock.json"), lock);
    result.acquisition = "installed-and-offline-reproduced";
    result.installedTreeSha256 = first;
    result.handshake = ["memory", "filesystem", "sequential-thinking"].includes(key) ? await handshake(item, directory, key) : { status: "unverified", reason: "service/native startup not authorized by package installation" };
  } catch (error) {
    result.reason = key === "squish" && /EBADENGINE|Unsupported engine/.test(String(error.stderr)) ? "locked better-sqlite3 12.9.0 excludes Node 26" : "fixture-failed";
    writeFileSync(join(directory, "fixture-error.txt"), String(error.stack ?? error));
  }
  results.push(result);
  writeFileSync(join(output, "receipt.json"), `${JSON.stringify({ archiveSha256: sha(readFileSync(archive)), releaseSha256: read.release.sha256, node: selected.node, npm: selected.npm, coreApply: "not-run", nativeClient: "not-run", results }, null, 2)}\n`);
  console.log(`${key}: ${result.acquisition}${result.reason ? ` (${result.reason})` : ""}`);
}
