// Meaningful outside-source fixture proof using exact installed public packages.
// No real detector execution, production signing, publication or native use.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [runtimeArg, outArg] = process.argv.slice(2);
assert(runtimeArg && outArg, "Usage: verify-package-consumer.mjs exact-installed-runtime new-output");
const runtime = resolve(runtimeArg), out = resolve(outArg), root = resolve(import.meta.dirname, ".."), started = performance.now();
assert(!existsSync(out)); mkdirSync(out);
const run = (args, cwd = root, input) => execFileSync(process.execPath, args, { cwd, input, encoding: "utf8", windowsHide: true, timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
const fixture = JSON.parse(run(["--input-type=module", "--eval", readFileSync(new URL("./package-consumer-fixture.mjs", import.meta.url), "utf8")], runtime, JSON.stringify({ out: join(out, "fixture") })));
const planPath = fixture.plan, candidate = join(out, "candidate"), tool = join(root, "tools/assemble-release-package.mjs");
const args = (plan = planPath, destination = candidate) => [tool, "--runtime", runtime, "--plan", plan, "--out", destination];
const first = JSON.parse(run(args())), receipt = JSON.parse(readFileSync(first.receipt));
assert.equal(receipt.views.length, 5); assert.equal(receipt.unchangedExports.length, 4);
assert.equal(receipt.installedReadback.releaseExports, 9); assert.equal(receipt.installedReadback.ownInstalledPublicReader, true);
for (const view of receipt.views) {
  assert.equal(view.authentication.producerIdentity, "package-fixture");
  assert.equal(view.assessment.completion, "partial"); assert.equal(view.assessment.results[0].outcome, "failed");
  assert(view.itemCoverage.every(item => item.members.every(member => member.observationIds.length === 0)));
  assert.equal(view.baseline.inventory.path, `release/baselines/${view.id}/content-inventory.json`);
}
const manifest = JSON.parse(readFileSync(join(candidate, "package/package.json")));
for (const exported of receipt.unchangedExports) assert.deepEqual(readFileSync(join(candidate, "package", manifest.exports[exported])), readFileSync(join(fixture.fullSoftware, manifest.exports[exported])));
const reused = JSON.parse(run([...args(), "--resume", "true"])); assert.deepEqual(reused.tarball, first.tarball);
const resumedReceipt = JSON.parse(readFileSync(reused.receipt));
assert.equal(resumedReceipt.timings.filter(row => row.phase === "pack").length, 1);
assert.equal(resumedReceipt.timings.filter(row => row.phase === "install").length, 1);
const plan = JSON.parse(readFileSync(planPath)), refusals = [];
for (const field of ["artifact", "inventory"]) {
  const changed = structuredClone(plan); changed.views[0][field] = changed.views[1][field];
  const path = join(out, `${field}-substitution.json`), destination = join(out, `${field}-refusal`); writeFileSync(path, JSON.stringify(changed));
  assert.throws(() => run(args(path, destination))); assert.equal(existsSync(join(destination, "package")), false);
  const details = readFileSync(join(destination, "qualification-0.log"), "utf8");
  assert(details.includes(field === "artifact" ? "Selected Scan ID differs" : "Frozen inventory differs from content")); refusals.push(`${field}-substitution`);
}
const changedPath = join(out, "changed-plan.json"); writeFileSync(changedPath, JSON.stringify({ ...plan, version: 2 }));
assert.throws(() => run([...args(changedPath), "--resume", "true"]), /Resume inputs or tooling changed/); refusals.push("resume-input-change");
const packageJson = join(candidate, "package/package.json"), saved = readFileSync(packageJson);
writeFileSync(packageJson, Buffer.concat([saved, Buffer.from("\n")]));
try { assert.throws(() => run([...args(), "--resume", "true"])); refusals.push("resume-tree-change"); }
finally { writeFileSync(packageJson, saved); }
const unexpectedMember = join(candidate, "package/unexpected-package-member.txt"); writeFileSync(unexpectedMember, "EXTRA");
try { assert.throws(() => run([...args(), "--resume", "true"])); const progress = JSON.parse(readFileSync(join(candidate, "progress.json"))); assert.equal(progress.phase, "qualification-failed"); assert(readFileSync(join(candidate, `qualification-${progress.timings.length - 1}.log`), "utf8").includes("Unexpected package member")); refusals.push("unexpected-package-member"); }
finally { unlinkSync(unexpectedMember); }
const sourceRefusal = join(out, "runtime-source-refusal");
assert.throws(() => run([tool, "--runtime", root, "--plan", planPath, "--out", sourceRefusal]), /Selected runtime must be outside/);
assert.equal(existsSync(sourceRefusal), false); refusals.push("runtime-inside-source");
// Change actual executable inputs, then restore their original bytes even on
// failure. Lock/version declarations deliberately stay unchanged.
for (const [name, path] of [["seed-tooling", join(root, "tools/seed-consumer-lock.mjs")], ["installed-runtime", join(runtime, "node_modules/@aihq/core/package.json")]]) {
  const original = readFileSync(path);
  try { writeFileSync(path, Buffer.concat([original, Buffer.from("\n")])); assert.throws(() => run([...args(), "--resume", "true"]), /Resume inputs or tooling changed/); refusals.push(`${name}-change`); }
  finally { writeFileSync(path, original); }
}
// Simulate only the stat of a multiply-linked destination: this remains portable
// on Windows hosts that cannot create file links. Child commands and all writes
// are real. A normal writer would replace the existing sentinel contents.
const preload = join(out, "linked-output-preload.mjs");
writeFileSync(preload, `import fs from "node:fs"; import {syncBuiltinESMExports} from "node:module"; import {resolve} from "node:path";
const original = fs.lstatSync; fs.lstatSync = function(path, ...args) { const stat = original.call(this, path, ...args); if (resolve(String(path)) === resolve(process.env.CATALOG_TEST_LINK)) Object.defineProperty(stat, "nlink", {value: 2}); return stat; }; syncBuiltinESMExports();`);
for (const name of ["log", "receipt"]) {
  const progress = JSON.parse(readFileSync(join(candidate, "progress.json")));
  const path = name === "receipt" ? join(candidate, "receipt.json") : join(candidate, `qualification-${progress.timings.length}.log`);
  const existed = existsSync(path), original = existed ? readFileSync(path) : Buffer.from("LINKED OUTPUT SENTINEL");
  if (!existed) writeFileSync(path, original);
  try { assert.throws(() => execFileSync(process.execPath, ["--import", pathToFileURL(preload).href, ...args(), "--resume", "true"], { cwd: root, env: { ...process.env, CATALOG_TEST_LINK: path }, encoding: "utf8", windowsHide: true, timeout: 300000, maxBuffer: 64 * 1024 * 1024 }), /Unsafe linked control output/); assert.deepEqual(readFileSync(path), original); refusals.push(`simulated-linked-${name}`); }
  finally { if (!existed) unlinkSync(path); }
}
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const proof = { fixtureOnly: true, realDetectorExecution: false, productionSigning: false, publicPackageInstalled: true,
  qualifiedViews: 5, totalReleaseExports: 9, preservedHistoricalExports: receipt.unchangedExports, allFailedOutcomesPreserved: true,
  verifiedReuse: true, tarball: first.tarball, tarballSha256: hash(readFileSync(first.tarball.path)), refusals, durationMs: Math.round(performance.now() - started) };
writeFileSync(join(out, "proof.json"), JSON.stringify(proof, null, 2) + "\n"); console.log(JSON.stringify(proof));
