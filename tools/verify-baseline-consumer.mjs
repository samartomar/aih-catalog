// Exact public artifacts only. No scanner execution, sibling imports or publication.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { npmCliPath } from "../dist/producer/package.js";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";
const root = resolve(import.meta.dirname, "..");
const started = performance.now();
const [scanArg, coreArg, outArg, ...locks] = process.argv.slice(2);
assert(scanArg && coreArg && outArg, "Usage: verify-baseline-consumer.mjs scan.tgz core.tgz new-output-dir [runtime-lock.json ...]");
const scan = resolve(scanArg), core = resolve(coreArg), out = resolve(outArg);
assert(!existsSync(out), "Output must be a new directory.");
mkdirSync(out, { recursive: true });
const npm = npmCliPath();
const run = (args, cwd) => execFileSync(process.execPath, args, {
  cwd, encoding: "utf8", windowsHide: true, timeout: 180000, maxBuffer: 16 * 1024 * 1024,
});
const pack = (cwd, destination) => {
  mkdirSync(destination, { recursive: true });
  const [packed] = JSON.parse(run([npm, "pack", "--ignore-scripts", "--offline", "--json", "--pack-destination", destination], cwd));
  return join(destination, packed.filename);
};
const catalog = pack(root, join(out, "software"));
const runtime = join(out, "runtime");
seedConsumerLock(runtime, root);
const lockPath = join(runtime, "package-lock.json"), seeded = JSON.parse(readFileSync(lockPath));
for (const file of locks) {
  const lock = JSON.parse(readFileSync(resolve(file)));
  assert.equal(lock.lockfileVersion, 3);
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || entry.dev === true) continue;
    if (seeded.packages[path]) assert.equal(seeded.packages[path].version, entry.version, `Incompatible lock at ${path}`);
    else seeded.packages[path] = entry;
  }
}
writeFileSync(lockPath, JSON.stringify(seeded));
run([npm, "install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund", catalog, scan, core], runtime);
copyFileSync(join(root, "tools/baseline-consumer-scenario.mjs"), join(runtime, "scenario.mjs"));
const output = run([join(runtime, "scenario.mjs"), out, npm], runtime);
copyFileSync(join(root, "tools/baseline-consumer-types.mts"), join(runtime, "public-types.mts"));
run([join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022", join(runtime, "public-types.mts")], runtime);
// Exercise the actual release-preparation command against staged checked content.
const contentStage = join(out, "content-stage"); cpSync(join(out, "candidate"), contentStage, { recursive: true });
const content = readFileSync(join(out, "content.json"));
writeFileSync(join(contentStage, "release/release.json"), content);
run([join(root, "tools/prepare-release.mjs"), "prepare", "--content", join(out, "content.json"),
  "--content-sha256", createHash("sha256").update(content).digest("hex"), "--out", join(out, "cli-release.json"),
  "--baseline", join(out, "binding.json"), "--trust", join(out, "fixture-trust.json"),
  "--runtime", runtime, "--package-root", contentStage], root);
assert.deepEqual(readFileSync(join(out, "cli-release.json")), readFileSync(join(out, "candidate/release/release.json")));
run([join(root, "tools/check-release.mjs"), join(out, "candidate")], root);
const fixtureTarball = pack(join(out, "candidate"), join(out, "final"));
const finalConsumer = join(out, "final-consumer");
seedConsumerLock(finalConsumer, root);
run([npm, "install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund", fixtureTarball], finalConsumer);
copyFileSync(join(root, "tools/baseline-final-consumer.mjs"), join(finalConsumer, "verify.mjs"));
const finalOutput = run([join(finalConsumer, "verify.mjs"), join(out, "scenario-result.json")], finalConsumer);
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const artifacts = [catalog, scan, core, fixtureTarball].map((path, i) => ({ role: ["catalog-software", "scan", "core", "catalog-fixture-candidate"][i], file: basename(path), sha256: hash(path), byteLength: readFileSync(path).length }));
writeFileSync(join(out, "artifact-custody.json"), JSON.stringify({ artifacts, scenario: JSON.parse(output), finalConsumer: JSON.parse(finalOutput), publicTypesChecked: true, mandatoryCliChecked: true, offlineIntegrityChecked: true, elapsedMs: Math.round(performance.now() - started) }, null, 2));
assert(isAbsolute(fixtureTarball));
console.log(JSON.stringify({ out, fixtureTarball, artifacts }));
