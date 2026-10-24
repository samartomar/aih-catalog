// Public CI checks an exact registry version, never sibling source or a dist-tag.
// Before first publication, only registry 404 is an allowed unavailable result.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pin from "./scan-fixture-pin.json" with { type: "json" };
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

assert.equal(pin.name, "@aihq/scan");
assert.match(pin.version, /^\d+\.\d+\.\d+$/);
const response = await fetch(`https://registry.npmjs.org/@aihq%2fscan/${pin.version}`, { signal: AbortSignal.timeout(30_000), redirect: "error" });
if (response.status === 404) {
  console.log(JSON.stringify({ status: "unavailable", package: pin, reason: "exact-version-not-published" }));
} else {
  assert(response.ok, `Scan registry lookup failed: ${response.status}`);
  const metadata = await response.json();
  assert.equal(metadata.name, pin.name); assert.equal(metadata.version, pin.version);
  assert(metadata.dist?.integrity, "Scan metadata has no archive integrity");
  const root = resolve(import.meta.dirname, "..");
  const consumer = mkdtempSync(join(tmpdir(), "catalog-pinned-scan-fixtures-"));
  try {
    seedConsumerLock(consumer, root);
    const npm = process.env.npm_execpath;
    assert(npm && npm.endsWith("npm-cli.js"), "Run through npm run check:scan-fixtures");
    execFileSync(process.execPath, [npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", `${pin.name}@${pin.version}`], {
      cwd: consumer, timeout: 180_000, stdio: "pipe", windowsHide: true,
      env: { ...process.env, npm_config_registry: "https://registry.npmjs.org" },
    });
    const lock = JSON.parse(readFileSync(join(consumer, "package-lock.json")));
    assert.equal(lock.packages["node_modules/@aihq/scan"].integrity, metadata.dist.integrity);
    writeFileSync(join(consumer, "check.mjs"), readFileSync(new URL("./check-scan-fixtures.mjs", import.meta.url)));
    execFileSync(process.execPath, [join(consumer, "check.mjs")], { cwd: consumer, timeout: 120_000, stdio: "inherit", windowsHide: true });
  } finally { rmSync(consumer, { recursive: true, force: true }); }
}
