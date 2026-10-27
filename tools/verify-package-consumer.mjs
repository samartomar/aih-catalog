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
// One ordinary view is qualified; every other declared release, including the frozen
// default and the releases whose prepared content holds their baseline slot, is carried
// unchanged, and the frozen default keeps its recorded bytes.
const declared = JSON.parse(run(["--input-type=module", "--eval", 'import * as contracts from "@aihq/catalog/contracts"; console.log(JSON.stringify({ releases: contracts.releaseInventory.releases, frozen: contracts.FROZEN_DEFAULT_RELEASE_SHA256 }));'], runtime));
assert.deepEqual(receipt.views.map(view => view.id), ["anthropic"]);
assert.deepEqual([...receipt.views.map(view => view.export), ...receipt.unchangedExports].sort(), declared.releases.map(entry => entry.release).sort());
assert(receipt.unchangedExports.includes("./release.json")); assert.deepEqual(receipt.frozenExports, [{ export: "./release.json", sha256: declared.frozen }]);
assert.equal(receipt.installedReadback.releaseExports, declared.releases.length); assert.equal(receipt.installedReadback.qualifiedViews, 1);
assert.deepEqual(receipt.installedReadback.frozenExports, receipt.frozenExports); assert.equal(receipt.installedReadback.ownInstalledPublicReader, true);
const frozenCandidate = readFileSync(join(candidate, "package/release/release.json"));
assert.deepEqual(frozenCandidate, readFileSync(join(runtime, "node_modules/@aihq/catalog/release/release.json"))); assert.equal(createHash("sha256").update(frozenCandidate).digest("hex"), declared.frozen);
const installedFrozen = readFileSync(join(candidate, "consumer/node_modules/@aihq/catalog/release/release.json"));
assert.deepEqual(installedFrozen, frozenCandidate);
// Prepared content (no baseline bound) is carried byte for byte and read back by the content reader.
const preparedSource = JSON.parse(run(["--input-type=module", "--eval", 'import * as contracts from "@aihq/catalog/contracts"; console.log(JSON.stringify(contracts.preparedReleaseContent ?? []));'], runtime));
assert.deepEqual(receipt.installedReadback.preparedContent.map(entry => entry.frameworkId), preparedSource.map(entry => entry.frameworkId));
for (const entry of preparedSource) {
  for (const path of [entry.content, entry.inventory]) assert.deepEqual(readFileSync(join(candidate, "package", path)), readFileSync(join(runtime, "node_modules/@aihq/catalog", path)), path);
}
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
  const changed = structuredClone(plan); changed.views[0][field] = fixture.decoy[field];
  const path = join(out, `${field}-substitution.json`), destination = join(out, `${field}-refusal`); writeFileSync(path, JSON.stringify(changed));
  assert.throws(() => run(args(path, destination))); assert.equal(existsSync(join(destination, "package")), false);
  const details = readFileSync(join(destination, "qualification-0.log"), "utf8");
  assert(details.includes(field === "artifact" ? "Selected Scan ID differs" : "Frozen inventory differs from content")); refusals.push(`${field}-substitution`);
}
// Qualifying the frozen default, or an earlier release whose prepared content holds its
// baseline slot, is refused before any package is written.
for (const [id, expected] of [["default", "The frozen default is historical"], ["extensions", "Framework extensions has prepared release content awaiting its baseline at release/baselines/extensions/content-inventory.json"]]) {
  const view = { ...structuredClone(fixture.decoy), id }, path = join(out, `${id}-view.json`), destination = join(out, `${id}-view-refusal`);
  writeFileSync(path, JSON.stringify({ ...plan, views: [...plan.views, view] }));
  assert.throws(() => run(args(path, destination))); assert.equal(existsSync(join(destination, "package")), false);
  assert(readFileSync(join(destination, "qualification-0.log"), "utf8").includes(expected)); refusals.push(`${id}-view-qualification`);
}
const changedPath = join(out, "changed-plan.json"); writeFileSync(changedPath, JSON.stringify({ ...plan, version: 2 }));
assert.throws(() => run([...args(changedPath), "--resume", "true"]), /Resume inputs or tooling changed/); refusals.push("resume-input-change");
for (const [name, member] of [["resume-tree-change", "package/package.json"], ["resume-frozen-default-change", "package/release/release.json"]]) {
  const path = join(candidate, member), saved = readFileSync(path);
  writeFileSync(path, Buffer.concat([saved, Buffer.from("\n")]));
  try { assert.throws(() => run([...args(), "--resume", "true"])); refusals.push(name); }
  finally { writeFileSync(path, saved); }
}
const unexpectedMember = join(candidate, "package/unexpected-package-member.txt"); writeFileSync(unexpectedMember, "EXTRA");
try { assert.throws(() => run([...args(), "--resume", "true"])); const progress = JSON.parse(readFileSync(join(candidate, "progress.json"))); assert.equal(progress.phase, "qualification-failed"); assert(readFileSync(join(candidate, `qualification-${progress.timings.length - 1}.log`), "utf8").includes("Unexpected package member")); refusals.push("unexpected-package-member"); }
finally { unlinkSync(unexpectedMember); }
const progressPath = join(candidate, "progress.json"), originalProgress = readFileSync(progressPath);
const escapedLog = join(out, "sentinel.log"); writeFileSync(escapedLog, "UNCHANGED CHECKPOINT SENTINEL");
try {
  const malicious = JSON.parse(originalProgress); malicious.timings = { length: "../../../sentinel" };
  writeFileSync(progressPath, JSON.stringify(malicious));
  assert.throws(() => run([...args(), "--resume", "true"]), /Checkpoint timings must be an array/);
  assert.equal(readFileSync(escapedLog, "utf8"), "UNCHANGED CHECKPOINT SENTINEL"); refusals.push("checkpoint-log-path-escape");
} finally { writeFileSync(progressPath, originalProgress); }
// A runtime whose frozen default differs from its recorded digest is refused, not carried or requalified.
const runtimeFrozen = join(runtime, "node_modules/@aihq/catalog/release/release.json"), frozenOriginal = readFileSync(runtimeFrozen), frozenDestination = join(out, "frozen-default-refusal");
try {
  writeFileSync(runtimeFrozen, Buffer.concat([frozenOriginal, Buffer.from("\n")]));
  assert.throws(() => run(args(planPath, frozenDestination))); assert.equal(existsSync(join(frozenDestination, "package")), false);
  assert(readFileSync(join(frozenDestination, "qualification-0.log"), "utf8").includes("Frozen release differs from its recorded digest: ./release.json")); refusals.push("runtime-frozen-default-change");
} finally { writeFileSync(runtimeFrozen, frozenOriginal); }
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
  qualifiedViews: receipt.views.length, totalReleaseExports: receipt.installedReadback.releaseExports, preservedHistoricalExports: receipt.unchangedExports, frozenExports: receipt.frozenExports, allFailedOutcomesPreserved: true,
  verifiedReuse: true, tarball: first.tarball, tarballSha256: hash(readFileSync(first.tarball.path)), refusals, durationMs: Math.round(performance.now() - started) };
writeFileSync(join(out, "proof.json"), JSON.stringify(proof, null, 2) + "\n"); console.log(JSON.stringify(proof));
