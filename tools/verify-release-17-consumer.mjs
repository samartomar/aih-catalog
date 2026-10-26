// One packed, outside, headless consumer for release 1.7. The exact packed package
// is installed into a disposable consumer and the scenario runs through the public
// exports only. With --older <catalog.tgz>, an earlier packed Catalog is installed
// into a second consumer and must refuse the whole 1.7.0 format while still reading
// 1.6.0. No Core, no execution.
//
//   node tools/verify-release-17-consumer.mjs [catalog.tgz] [--older <older-catalog.tgz>]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const olderAt = args.indexOf("--older");
const older = olderAt >= 0 ? resolve(args.splice(olderAt, 2)[1] ?? "") : undefined;
assert(args.length <= 1, "Usage: node tools/verify-release-17-consumer.mjs [catalog.tgz] [--older <catalog.tgz>]");
const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-release-17-packed-"));
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
  execFileSync(process.execPath, [npm, ...argv], { cwd, env, encoding: "utf8", timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
const install = (name, archive) => {
  const consumer = join(fixture, name);
  seedConsumerLock(consumer, root);
  runNpm(["install", "--prefix", consumer, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", archive], fixture);
  return consumer;
};
try {
  const archive = args[0]
    ? resolve(args[0])
    : join(fixture, JSON.parse(runNpm(["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", fixture], root))[0].filename);
  const consumer = install("consumer", archive);
  cpSync(join(root, "tools/release-17-consumer-scenario.mjs"), join(consumer, "consume-release-17.mjs"));
  const receipt = JSON.parse(execFileSync(process.execPath, [join(consumer, "consume-release-17.mjs")], { cwd: consumer, env, encoding: "utf8", timeout: 180_000 }));
  const failures = receipt.results.filter((entry) => entry.status !== "pass");
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 1));
  let olderReceipt;
  if (older !== undefined) {
    // The earlier reader receives the new package's own 1.6 and 1.7 fixture bytes.
    const previous = install("older", older);
    const fixtures = join(consumer, "node_modules/@aihq/catalog/fixtures");
    const check = `import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readRelease, readReleaseContent } from "@aihq/catalog/reader";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const v17 = readFileSync(${JSON.stringify(join(fixtures, "release-1.7.0-valid.json"))});
const refused = readRelease(v17, { expectedSha256: sha(v17) });
assert.equal(refused.valid, false);
assert.equal(refused.diagnostics.length, 1);
assert.equal(refused.diagnostics[0].code, "SCHEMA_UNSUPPORTED");
assert.equal(refused.diagnostics[0].encountered, "urn:aihq:catalog:release:1.7.0");
assert.ok(!refused.diagnostics[0].supported.includes("urn:aihq:catalog:release:1.7.0"));
const v16 = readFileSync(${JSON.stringify(join(fixtures, "release-1.6.0-valid.json"))});
assert.equal(readRelease(v16, { expectedSha256: sha(v16) }).valid, true);
const copies = readFileSync(${JSON.stringify(join(fixtures, "release-1-7/extensions-copies-release-1.6.0.json"))});
assert.equal(readReleaseContent(copies, { expectedSha256: sha(copies) }).valid, true);
process.stdout.write(JSON.stringify({ refused: refused.diagnostics[0], supported: refused.diagnostics[0].supported.length }));
`;
    writeFileSync(join(previous, "older-reader.mjs"), check);
    olderReceipt = JSON.parse(execFileSync(process.execPath, [join(previous, "older-reader.mjs")], { cwd: previous, env, encoding: "utf8", timeout: 120_000 }));
  }
  console.log(JSON.stringify({
    ok: true,
    archiveSha256: sha(readFileSync(archive)),
    cases: receipt.results.length,
    ...(older === undefined ? {} : { olderArchiveSha256: sha(readFileSync(older)), older: olderReceipt }),
  }));
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
