// The internal local-package path for Project basics: the exact packed Catalog (and,
// when supplied, an exact packed Core) is installed offline into a disposable consumer,
// and the prepared content is read, browsed, composed and, with Core, prepared and
// applied through public exports only. No baseline, signing, publication or network.
//
//   node tools/verify-project-basics-internal-consumer.mjs [--core <core.tgz>] [catalog.tgz]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const coreAt = args.indexOf("--core");
const core = coreAt >= 0 ? resolve(args.splice(coreAt, 2)[1] ?? "") : undefined;
assert(args.length <= 1, "Usage: node tools/verify-project-basics-internal-consumer.mjs [--core <core.tgz>] [catalog.tgz]");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const npm = [
  process.env.npm_execpath,
  resolve(process.execPath, "..", "node_modules/npm/bin/npm-cli.js"),
  resolve(process.execPath, "../..", "lib/node_modules/npm/bin/npm-cli.js"),
].find((path) => path && isAbsolute(path) && basename(path) === "npm-cli.js" && existsSync(path));
assert(npm, "An adjacent npm-cli.js is required.");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"));
const runNpm = (argv, cwd) =>
  execFileSync(process.execPath, [npm, ...argv], { cwd, env, encoding: "utf8", timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-project-basics-internal-"));
try {
  const archive = args[0]
    ? resolve(args[0])
    : join(fixture, JSON.parse(runNpm(["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", fixture], root))[0].filename);
  const archiveSha256 = sha(readFileSync(archive));
  const coreSha256 = core === undefined ? undefined : sha(readFileSync(core));
  const consumer = join(fixture, "consumer");
  seedConsumerLock(consumer, root);
  runNpm(["install", "--prefix", consumer, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", archive, ...(core ? [core] : [])], fixture);
  cpSync(join(root, "tools/project-basics-internal-scenario.mjs"), join(consumer, "consume-project-basics-internal.mjs"));
  const receipt = JSON.parse(execFileSync(process.execPath, [join(consumer, "consume-project-basics-internal.mjs"), ...(core ? ["core"] : [])], { cwd: consumer, env, encoding: "utf8", timeout: 180_000 }));
  const failures = receipt.results.filter((entry) => entry.status !== "pass");
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 1));
  assert.equal(sha(readFileSync(archive)), archiveSha256);
  console.log(JSON.stringify({ ok: true, archiveSha256, ...(core ? { coreSha256 } : {}), cases: receipt.results.length, results: receipt.results, core: receipt.core }));
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
