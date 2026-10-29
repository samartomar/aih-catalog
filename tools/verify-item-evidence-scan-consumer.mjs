// One packed, outside consumer for the Scan item-evidence mapping. The exact
// packed Catalog package and an exact packed Scan archive install into a
// disposable consumer; tools/item-evidence-scan-consumer-scenario.mjs runs through
// the public exports only (@aihq/catalog/reader and @aihq/scan/read, /host). Scan
// runs its local detector over a disposable copy of the package members: no live
// network scanning and no scan against this checkout. Run it on Linux to see items
// matched: Scan records executable bits from file modes, which Windows lacks.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
assert(
  args.length <= 2,
  "Usage: node tools/verify-item-evidence-scan-consumer.mjs <scan.tgz> [catalog.tgz]",
);
const scanArg = args[0];
const catalogArg = args[1];
assert(scanArg, "Usage: node tools/verify-item-evidence-scan-consumer.mjs <scan.tgz> [catalog.tgz]");
const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-item-evidence-scan-"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const npm = [
  process.env.npm_execpath,
  resolve(process.execPath, "..", "node_modules/npm/bin/npm-cli.js"),
  resolve(process.execPath, "../..", "lib/node_modules/npm/bin/npm-cli.js"),
].find((candidate) => candidate && isAbsolute(candidate) && basename(candidate) === "npm-cli.js");
assert(npm, "An adjacent npm-cli.js is required.");
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"),
);
const runNpm = (argv, cwd) =>
  execFileSync(process.execPath, [npm, ...argv], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
try {
  const scan = resolve(scanArg);
  const archive = catalogArg
    ? resolve(catalogArg)
    : join(
        fixture,
        JSON.parse(
          runNpm(["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", fixture], root),
        )[0].filename,
      );
  const archiveSha256 = sha(readFileSync(archive));
  const scanSha256 = sha(readFileSync(scan));
  const consumer = join(fixture, "consumer");
  mkdirSync(consumer, { recursive: true });
  // Both tarballs declare exact runtime versions; npm resolves the shared
  // dependency tree (Catalog's yaml range accepts Scan's exact pin).
  runNpm(["install", "--prefix", consumer, "--ignore-scripts", "--no-audit", "--no-fund", archive, scan], fixture);

  copyFileSync(join(root, "tools/item-evidence-scan-consumer-scenario.mjs"), join(consumer, "consume-item-evidence.mjs"));

  const output = execFileSync(process.execPath, [join(consumer, "consume-item-evidence.mjs")], {
    cwd: consumer,
    env,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const receipt = JSON.parse(output);
  const failures = receipt.results.filter((entry) => entry.status !== "pass");
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 1));
  assert.equal(receipt.results.length, 5, JSON.stringify(receipt.results.map((entry) => entry.name)));
  console.log(
    JSON.stringify({
      ok: true,
      archiveSha256,
      scanSha256,
      cases: receipt.results.length,
      platform: receipt.platform,
    }),
  );
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
