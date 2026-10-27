// Explicit maintainer lock refresh only; no package lifecycle or provider execution.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const [npmCli, work, cache] = process.argv.slice(2);
assert(process.argv.length === 5 && [npmCli, work, cache].every(isAbsolute), "Usage: node tools/lock-ecc-mcp.mjs <npm-cli.js> <isolated-work> <isolated-cache>");
const selected = JSON.parse(readFileSync(join(root, "producer/ecc/mcp-acquisition.json")));
assert.equal(process.versions.node, selected.node);
const run = (args, cwd) => execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: "utf8", windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
assert.equal(run(["--version"], root).trim(), selected.npm);
for (const [key, provider] of Object.entries(selected.providers)) {
  const directory = join(work, key), output = join(root, "producer/ecc/acquisition", key);
  mkdirSync(directory, { recursive: true });
  const manifest = { name: `aihq-mcp-${key}`, version: "1.0.0", private: true, engines: { node: selected.nodeRange, npm: selected.npm }, dependencies: { [provider.package]: provider.version } };
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(directory, "package.json"), bytes);
  run(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org", "--cache", cache], directory);
  const lockBytes = readFileSync(join(directory, "package-lock.json"));
  const lock = JSON.parse(lockBytes);
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages[`node_modules/${provider.package}`].version, provider.version);
  for (const [path, member] of Object.entries(lock.packages)) {
    if (!path) continue;
    assert.equal(member.link, undefined, `${key}: linked dependency ${path}`);
    assert(/^https:\/\/registry\.npmjs\.org\//.test(member.resolved), `${key}: non-registry dependency ${path}`);
    assert(/^sha512-[A-Za-z0-9+/]+=*$/.test(member.integrity), `${key}: missing SHA512 ${path}`);
  }
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "package.json"), bytes);
  writeFileSync(join(output, "package-lock.json"), lockBytes);
  console.log(`${key}: ${Object.keys(lock.packages).length - 1} integrity-bound packages`);
}
