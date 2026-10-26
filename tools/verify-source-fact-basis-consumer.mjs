// Packed public extraction/compiler/wire/reader regression for source-field basis.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
assert(args.length <= 1, "Usage: node tools/verify-source-fact-basis-consumer.mjs [catalog.tgz]");
const fixture = mkdtempSync(join(tmpdir(), "aih-source-fact-basis-"));
const npm = [
  resolve(process.execPath, "../node_modules/npm/bin/npm-cli.js"),
  resolve(process.execPath, "../../lib/node_modules/npm/bin/npm-cli.js"),
].find((candidate) => {
  try {
    readFileSync(candidate);
    return true;
  } catch {
    return false;
  }
});
assert(npm, "An adjacent npm-cli.js is required.");
const runNpm = (argv) =>
  execFileSync(process.execPath, [npm, ...argv], {
    cwd: root,
    windowsHide: true,
    timeout: 120_000,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
const archive = args[0]
  ? resolve(args[0])
  : join(
      fixture,
      JSON.parse(
        runNpm(["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", fixture]),
      )[0].filename,
    );
const consumer = join(fixture, "consumer");
seedConsumerLock(consumer, root);
runNpm(["install", "--prefix", consumer, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", archive]);

writeFileSync(join(consumer, "proof.mjs"), readFileSync(join(root, "tools/source-fact-basis-scenario.mjs")));
console.log(execFileSync(process.execPath, [join(consumer, "proof.mjs")], {
  cwd: consumer, encoding: "utf8", timeout: 30_000, windowsHide: true,
}));
