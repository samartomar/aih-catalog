// One outside packed public consumer; all writes are disposable and no hook is executed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const evidenceIndex = args.indexOf("--evidence");
const evidence = evidenceIndex < 0 ? undefined : resolve(args.splice(evidenceIndex, 2)[1]);
const withoutCore = args[0] === "--without-core";
if (withoutCore) args.shift();
assert(args.length <= (withoutCore ? 1 : 2) && (withoutCore || args[0]), "Usage: node tools/verify-ecc-consumer.mjs <core.tgz>|--without-core [catalog.tgz] [--evidence directory]");
const core = withoutCore ? undefined : resolve(args.shift());
const fixture = mkdtempSync(join(tmpdir(), "aih-catalog-ecc-"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const npm = [process.env.npm_execpath, resolve(process.execPath, "..", "node_modules/npm/bin/npm-cli.js"), resolve(process.execPath, "../..", "lib/node_modules/npm/bin/npm-cli.js")].find(path => path && isAbsolute(path) && basename(path) === "npm-cli.js" && existsSync(path));
assert(npm, "Adjacent npm-cli.js is required");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"));
const runNpm = (args, cwd) => execFileSync(process.execPath, [npm, ...args], { cwd, env, encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
try {
  const archive = args[0] ? resolve(args[0]) : join(fixture, JSON.parse(runNpm(["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", fixture], root))[0].filename);
  const archiveSha256 = sha(readFileSync(archive));
  const coreSha256 = core ? sha(readFileSync(core)) : undefined;
  const consumer = join(fixture, "consumer");
  seedConsumerLock(consumer, root);
  runNpm(["install", "--prefix", consumer, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", archive, ...(core ? [core] : [])], fixture);
  cpSync(new URL("./ecc-consumer-scenario.mjs", import.meta.url), join(consumer, "consume.mjs"));
  execFileSync(process.execPath, [join(consumer, "consume.mjs"), archive, ...(core ? ["core"] : [])], { cwd: consumer, env, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  const receipt = { archiveSha256, ...(core ? { coreSha256 } : {}), ...JSON.parse(readFileSync(join(consumer, "receipt.json"))) };
  assert.equal(sha(readFileSync(archive)), archiveSha256);
  if (core) assert.equal(sha(readFileSync(core)), coreSha256);
  if (evidence) {
    mkdirSync(evidence, { recursive: true }); cpSync(archive, join(evidence, basename(archive)));
    cpSync(consumer, join(evidence, "consumer"), { recursive: true });
    writeFileSync(join(evidence, "packed-ecc-consumer.json"), JSON.stringify(receipt, null, 2) + "\n");
  }
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  if (evidence) { mkdirSync(evidence, { recursive: true }); cpSync(fixture, join(evidence, "failed-fixture"), { recursive: true }); }
  throw error;
} finally { rmSync(fixture, { recursive: true, force: true }); }
