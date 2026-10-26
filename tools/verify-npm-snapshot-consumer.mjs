// Offline fixture transport; all Catalog behavior is tested in an installed package.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = mkdtempSync(join(tmpdir(), "aih-npm-snapshot-"));
const npm = [
  resolve(process.execPath, "../node_modules/npm/bin/npm-cli.js"),
  resolve(process.execPath, "../../lib/node_modules/npm/bin/npm-cli.js"),
].find(existsSync);
assert(npm);
const runNpm = (args) =>
  execFileSync(process.execPath, [npm, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
const archive = process.argv[2]
  ? resolve(process.argv[2])
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
]);
writeFileSync(
  join(consumer, "proof.mjs"),
  readFileSync(join(root, "tools/npm-snapshot-proof.mjs")),
);
const output = execFileSync(process.execPath, [join(consumer, "proof.mjs")], {
  cwd: consumer,
  encoding: "utf8",
  timeout: 120_000,
  windowsHide: true,
  maxBuffer: 4 * 1024 * 1024,
});
process.stdout.write(output);
console.log(
  JSON.stringify({
    archive,
    sha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
    fixture,
  }),
);
