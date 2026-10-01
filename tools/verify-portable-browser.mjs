import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve, sep } from "node:path";

const [artifact] = process.argv.slice(2);
assert(artifact, "Usage: node tools/verify-portable-browser.mjs <catalog-tarball>");
const npm = [process.env.npm_execpath,
  resolve(process.execPath, "..", "node_modules/npm/bin/npm-cli.js"),
  resolve(process.execPath, "../..", "lib/node_modules/npm/bin/npm-cli.js"),
].find((candidate) => candidate && isAbsolute(candidate) &&
  basename(candidate) === "npm-cli.js" && existsSync(candidate));
assert(npm, "Use a Node distribution with adjacent npm.");
const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-browser-"));
try {
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"));
  execFileSync(process.execPath, [npm, "install", "--prefix", fixture,
    "--ignore-scripts", "--offline", "--no-audit", "--no-fund", resolve(artifact)],
  { encoding: "utf8", env: environment, timeout: 120_000 });
  const root = join(fixture, "node_modules/@aihq/catalog");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const entry = (name) => {
    const declared = manifest.exports[name];
    const path = typeof declared === "string" ? declared : declared.import;
    assert(path.startsWith("./") && !path.includes(".."), "Expected contained public exports.");
    return path.slice(1);
  };
  const manifestPath = entry("./release.json");
  const expectedSha256 = createHash("sha256").update(readFileSync(join(root, manifestPath))).digest("hex");
  const imports = { "@aihq/catalog/reader": entry("./reader"),
    "@aihq/catalog/contracts": entry("./contracts") };
  const page = `<!doctype html><meta charset="utf-8"><title>Catalog portable consumer</title>
<script type="importmap">${JSON.stringify({ imports })}</script>
<pre id="result">Checking portable exports...</pre>
<script type="module">
import { readRelease, listItems, configureItem, validateSelectionSet } from "@aihq/catalog/reader";
import { contractSupport } from "@aihq/catalog/contracts";
const verify = (condition, message) => { if (!condition) throw new Error(message); };
try {
  verify(typeof process === "undefined" && typeof Buffer === "undefined", "Node globals leaked into the browser");
  const bytes = new Uint8Array(await (await fetch(${JSON.stringify(manifestPath)})).arrayBuffer());
  globalThis.fetch = () => { throw new Error("Portable operations attempted acquisition"); };
  const checked = readRelease(bytes, { expectedSha256: ${JSON.stringify(expectedSha256)} });
  verify(checked.valid, JSON.stringify(checked.diagnostics));
  const configured = ["mattpocock.grill-me", "mattpocock.grilling"].map(itemId => configureItem({
    release: checked.release, itemId, configuration: {}, materialSource: { kind: "local", input: "fixture" }
  }));
  for (const item of configured) {
    verify(item.valid, JSON.stringify(item.diagnostics));
    verify(Object.keys(item.selection.configuration).length === 0, "Omitted defaults were inserted");
  }
  const selections = configured.map((item, index) => ({ id: index ? "required" : "chosen",
    item: { releaseSha256: item.provenance.manifestSha256, itemId: item.provenance.itemId,
      itemSha256: item.provenance.itemSha256 }, configuration: {} }));
  const selected = validateSelectionSet({ releases: { [${JSON.stringify(expectedSha256)}]: checked.release }, selections });
  verify(selected.valid, JSON.stringify(selected.diagnostics));
  verify(JSON.stringify(selected.requiresBySelectionId.chosen) === '["required"]', "Wrong selection-ID dependency mapping");
  window.browserResult = { passed: true, portable: true, nodeGlobals: false, acquisition: false,
    schema: checked.release.schema, items: listItems(checked.release).length, support: contractSupport.schema,
    requiresBySelectionId: selected.requiresBySelectionId };
} catch (error) { window.browserResult = { passed: false, error: String(error) }; }
document.getElementById("result").textContent = JSON.stringify(window.browserResult, null, 2);
</script>`;
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(page); return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const file = resolve(root, `.${pathname}`);
      if (!file.startsWith(root + sep)) throw new Error("outside fixture");
      const bytes = readFileSync(file);
      response.writeHead(200, { "content-type": file.endsWith(".js")
        ? "text/javascript; charset=utf-8" : "application/json; charset=utf-8" });
      response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/`, expectedSha256 }));
  // Run this helper in an interactive terminal so stdin remains open; type "quit"
  // after inspecting the result. Only a task-owned fixture is served.
  await new Promise((finished) => {
    const stop = () => { process.stdin.pause(); server.close(finished); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    process.stdin.on("data", (chunk) => { if (chunk.toString().trim() === "quit") stop(); });
    process.stdin.resume();
  });
} finally {
  assert(fixture.startsWith(join(tmpdir(), "aih-catalog-browser-")));
  rmSync(fixture, { recursive: true, force: true });
}
