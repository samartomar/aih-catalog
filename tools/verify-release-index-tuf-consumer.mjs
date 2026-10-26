// Packed public-only TUF verification with supplied local metadata; no live trust or signing.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
assert(
  args.length <= 2,
  "Usage: node tools/verify-release-index-tuf-consumer.mjs [catalog.tgz] [core.tgz]",
);
const fixture = mkdtempSync(join(tmpdir(), "aih-index-tuf-"));
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
runNpm([
  "install",
  "--prefix",
  consumer,
  "--offline",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  archive,
  ...(args[1] ? [resolve(args[1])] : []),
]);

writeFileSync(join(consumer, "proof.mjs"), readFileSync(join(root, "tools/fixtures/release-index-tuf-proof.mjs")));
const output = execFileSync(process.execPath, [join(consumer, "proof.mjs")], {
 env: {...process.env, CATALOG_TUF_CHECK_CORE: args[1] ? "1" : "0"},
 cwd: consumer, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
});
process.stdout.write(output);

console.log(JSON.stringify({consumer, archive}));
