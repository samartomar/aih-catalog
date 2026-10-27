// Copied into an installed packed consumer. Provider execution has no credentials or tool calls.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readReleaseContent, configureItem } from "@aihq/catalog/reader";
const [node, npmCli, cache, output, archive, incompatibleNode, nativeFixtures] = process.argv.slice(2);
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
  const args = item.payload.args.map(arg => arg.replace("${ECC_FILESYSTEM_ROOT}", directory).replace("${SUPABASE_PROJECT_REF}", "fixture-project"));
  const rootVariable = `AIHQ_MCP_${key.replaceAll("-", "_").toUpperCase()}_ROOT`;
  const nativePath = join(directory, "native-codescene.binary");
  const child = spawn(node, ["--require", join(import.meta.dirname, "offline-guard.cjs"), ...args], { cwd: directory, env: { ...env, HOME: directory, USERPROFILE: directory, [rootVariable]: directory, MEMORY_FILE_PATH: join(directory, "memory.json"), ...(key === "codescene" && existsSync(nativePath) ? { CS_MCP_BINARY_PATH: nativePath } : {}) }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "", stderr = "", serverInfo, size = 0, done = false;
  const finish = result => {
    if (done) return;
    done = true; clearTimeout(timer);
    writeFileSync(join(directory, "handshake-stderr.txt"), stderr);
    if (child.exitCode !== null || child.signalCode !== null) return resolve({ ...result, cleanup: "exited" });
    const stop = setTimeout(() => resolve({ ...result, cleanup: "unverified" }), 5000);
    child.once("exit", () => { clearTimeout(stop); resolve({ ...result, cleanup: "exited" }); });
    child.stdin.destroy(); child.kill();
  };
  const timer = setTimeout(() => finish({ status: "unverified", reason: "handshake-timeout" }), 20000);
  child.on("error", () => finish({ status: "unverified", reason: "process-unavailable" }));
  child.on("exit", code => {
    const normalized = stderr.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const missing = /missing|required|provide|not set|must.*set|must.*specify/i.test(stderr);
    const named = Object.entries(item.requirements.inputs).filter(([name, input]) => input.required && missing && normalized.includes(name.replaceAll("_", "")));
    const reason = /offline-network-refused/.test(stderr) ? "offline-network-refused" : /offline-process-refused/.test(stderr) ? "offline-process-refused" : ["railway", "codescene"].includes(key) && /missing-native-runtime|unsupported-native-artifact|ENOENT|binary.*not found|could not find.*binary|executable.*not found/i.test(stderr) ? "missing-native-runtime" : "process-exit";
    finish({ status: named.length ? named.some(([, input]) => input.sensitive) ? "missing-auth-observed" : "missing-input-observed" : "unverified", reason, code });
  });
  child.stderr.on("data", chunk => { size += chunk.length; if (size > 1048576) finish({ status: "unverified", reason: "output-bound" }); else stderr += chunk.toString(); });
  child.stdout.on("data", chunk => {
    size += chunk.length;
    if (size > 1048576) return finish({ status: "unverified", reason: "output-bound" });
    buffer += chunk.toString();
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n"), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.id === 1 && message.result) {
        serverInfo = message.result.serverInfo;
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
      }
      if (message.id === 2 && Array.isArray(message.result?.tools)) finish({ status: "schema-observed", serverInfo, tools: message.result.tools.map(tool => tool.name), nativeClient: "not-run", toolCalls: 0 });
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
    assert.throws(() => run(incompatibleNode, args), /incompatible-runtime/);
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
    writeFileSync(join(directory, ".npmrc"), "registry=https://unreviewed.invalid\n");
    assert.throws(() => run(node, args), /ambient-project-config/);
    unlinkSync(join(directory, ".npmrc"));
    result.acquisition = "installed-and-offline-reproduced";
    result.installedTreeSha256 = first;
    if (["codescene", "railway"].includes(key)) {
      const missing = await handshake(item, directory, key);
      assert.equal(missing.reason, "missing-native-runtime");
      assert.equal(missing.cleanup, "exited");
      result.missingNative = missing;
      if (nativeFixtures) {
        const manifest = JSON.parse(recipe.operations.find(operation => operation.kind === "file.write" && operation.target.segments.at(-1).literal === "native-artifacts.json").content.literal);
        const bytes = readFileSync(join(nativeFixtures, `${key}-${process.platform}-${process.arch}.binary`));
        assert.equal(sha(bytes), manifest.targets[`${process.platform}/${process.arch}`].binarySha256);
        const target = key === "codescene" ? join(directory, "native-codescene.binary") : join(directory, "node_modules/@railway/cli/bin", process.platform === "win32" ? "railway.exe" : "railway");
        writeFileSync(target, bytes);
        result.nativeBinarySha256 = sha(bytes);
      }
    }
    result.handshake = await handshake(item, directory, key);
    assert.equal(result.handshake.cleanup, "exited", `${key}: process cleanup was not verified`);
    const localSchema = ["memory", "filesystem", "sequential-thinking"].includes(key);
    const networkBlocked = ["browserbase", "confluence", "context7", "exa-web-search", "fal-ai", "firecrawl", "magic", "supabase", "railway"].includes(key) && result.handshake.reason === "offline-network-refused";
    const processBlocked = ["browserbase", "codescene", "railway", "playwright"].includes(key) && result.handshake.reason === "offline-process-refused";
    const nativeMissing = ["codescene", "railway"].includes(key) && result.handshake.reason === "missing-native-runtime";
    const inputMissing = ["browserbase", "codescene", "confluence", "exa-web-search", "fal-ai", "firecrawl", "supabase"].includes(key) && ["missing-auth-observed", "missing-input-observed"].includes(result.handshake.status);
    const schema = result.handshake.status === "schema-observed" && result.handshake.tools.length > 0;
    assert(schema || (!localSchema && (networkBlocked || processBlocked || nativeMissing || inputMissing)), `${key}: unexpected handshake outcome ${JSON.stringify(result.handshake)}`);
    result.handshake.expectedBlocked = !schema;
  } catch (error) {
    result.reason = key === "squish" && /EBADENGINE|Unsupported engine/.test(String(error.stderr)) ? "locked better-sqlite3 12.9.0 excludes Node 26" : "fixture-failed";
    result.expectedBlocked = key === "squish" && result.reason !== "fixture-failed";
    writeFileSync(join(directory, "fixture-error.txt"), String(error.stack ?? error));
  }
  results.push(result);
  writeFileSync(join(output, "receipt.json"), `${JSON.stringify({ archiveSha256: sha(readFileSync(archive)), releaseSha256: read.release.sha256, node: selected.node, npm: selected.npm, platform: process.platform, architecture: process.arch, coreApply: "not-run", nativeClient: "not-run", results }, null, 2)}\n`);
  console.log(`${key}: ${result.acquisition}${result.reason ? ` (${result.reason})` : ""}`);
}
if (results.some(result => result.reason === "fixture-failed" || (result.acquisition !== "installed-and-offline-reproduced" && !result.expectedBlocked))) process.exitCode = 1;
