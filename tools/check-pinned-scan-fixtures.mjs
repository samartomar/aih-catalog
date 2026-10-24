// CI uses an exact registry version. Candidate proof requires an explicit archive
// and SHA-256; neither route uses sibling source or a moving dist-tag.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import pin from "./scan-fixture-pin.json" with { type: "json" };
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

assert.equal(pin.name, "@aihq/scan");
assert.match(pin.version, /^\d+\.\d+\.\d+$/);
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 4 && args[0] === "--archive" && args[2] === "--sha256"), "Expected --archive absolute-path --sha256 lowercase-hex");
let target = `${pin.name}@${pin.version}`, metadata, archiveSha256;
if (args.length) {
  assert(isAbsolute(args[1]), "Candidate archive must be absolute");
  assert.match(args[3], /^[0-9a-f]{64}$/);
  archiveSha256 = createHash("sha256").update(readFileSync(args[1])).digest("hex");
  assert.equal(archiveSha256, args[3], "Candidate archive SHA-256 mismatch");
  target = args[1];
} else {
  const response = await fetch(`https://registry.npmjs.org/@aihq%2fscan/${pin.version}`, { signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (response.status === 404) {
    console.log(JSON.stringify({ status: "unavailable", package: pin, reason: "exact-version-not-published" }));
    process.exit(0);
  }
  assert(response.ok, `Scan registry lookup failed: ${response.status}`);
  metadata = await response.json();
  assert.equal(metadata.name, pin.name); assert.equal(metadata.version, pin.version);
  assert(metadata.dist?.integrity, "Scan metadata has no archive integrity");
}
const root = resolve(import.meta.dirname, "..");
const consumer = mkdtempSync(join(tmpdir(), "catalog-pinned-scan-fixtures-"));
try {
  seedConsumerLock(consumer, root);
  const npm = [process.env.npm_execpath, resolve(process.execPath, "../node_modules/npm/bin/npm-cli.js"), resolve(process.execPath, "../../lib/node_modules/npm/bin/npm-cli.js")]
    .find(path => path && isAbsolute(path) && path.endsWith("npm-cli.js") && existsSync(path));
  assert(npm, "Cannot locate npm-cli.js");
  // Ajv is check tooling, not an assumed transitive dependency of Scan.
  const ajv = JSON.parse(readFileSync(join(root, "package.json"))).dependencies.ajv;
  execFileSync(process.execPath, [npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", target, `ajv@${ajv}`], {
    cwd: consumer, timeout: 180_000, stdio: "pipe", windowsHide: true,
    env: Object.fromEntries(Object.entries({ ...process.env, npm_config_registry: "https://registry.npmjs.org" })
      .filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts")),
  });
  const lock = JSON.parse(readFileSync(join(consumer, "package-lock.json")));
  if (metadata) assert.equal(lock.packages["node_modules/@aihq/scan"].integrity, metadata.dist.integrity);
  const installed = JSON.parse(readFileSync(join(consumer, "node_modules/@aihq/scan/package.json")));
  assert.equal(installed.name, pin.name);
  if (metadata) assert.equal(installed.version, pin.version);
  writeFileSync(join(consumer, "check.mjs"), readFileSync(new URL("./check-scan-fixtures.mjs", import.meta.url)));
  const checked = JSON.parse(execFileSync(process.execPath, [join(consumer, "check.mjs")], { cwd: consumer, encoding: "utf8", timeout: 120_000, windowsHide: true }));
  console.log(JSON.stringify({ ...checked, ...(archiveSha256 ? { archiveSha256 } : {}) }));
} finally { rmSync(consumer, { recursive: true, force: true }); }
