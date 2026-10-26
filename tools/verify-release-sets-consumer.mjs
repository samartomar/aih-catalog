// One packed, outside, headless consumer for release sets and set resolution.
// The exact packed package is installed into a disposable consumer and the
// scenario runs through the public exports only. No Core, no execution.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
assert(args.length <= 1, "Usage: node tools/verify-release-sets-consumer.mjs [catalog.tgz]");
const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-release-sets-packed-"));
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
  const archive = args[0]
    ? resolve(args[0])
    : join(
        fixture,
        JSON.parse(
          runNpm(["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", fixture], root),
        )[0].filename,
      );
  const archiveSha256 = sha(readFileSync(archive));
  const consumer = join(fixture, "consumer");
  seedConsumerLock(consumer, root);
  runNpm(["install", "--prefix", consumer, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", archive], fixture);
  cpSync(join(root, "tools/release-sets-consumer-scenario.mjs"), join(consumer, "consume-sets.mjs"));
  const output = execFileSync(process.execPath, [join(consumer, "consume-sets.mjs")], {
    cwd: consumer,
    env,
    encoding: "utf8",
    timeout: 120_000,
  });
  const receipt = JSON.parse(output);
  const failures = receipt.results.filter((entry) => entry.status !== "pass");
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 1));
  console.log(JSON.stringify({ ok: true, archiveSha256, cases: receipt.results.length }));
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
