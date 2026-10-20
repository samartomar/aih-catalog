#!/usr/bin/env node
// Local preparation only. Never scans, signs, publishes or changes trust.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, readlinkSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { npmCliPath } from "../dist/producer/package.js";
import { seedConsumerLock } from "./seed-consumer-lock.mjs";
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i], value = process.argv[i + 1];
  assert(["--runtime", "--plan", "--out", "--resume"].includes(name) && value && !Object.hasOwn(options, name), "Expected unique --runtime/--plan/--out/--resume value arguments"); options[name] = value;
}
for (const name of ["--runtime", "--plan", "--out"]) assert(options[name], `Missing ${name}`);
assert(!options["--resume"] || options["--resume"] === "true");
const root = resolve(import.meta.dirname, ".."), out = resolve(options["--out"]), runtime = realpathSync(options["--runtime"]), started = performance.now();
const outside = (parent, target) => { const path = relative(parent, target); return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path); };
assert(outside(root, runtime) && outside(runtime, root), "Selected runtime must be outside and independent of the source workspace");
assert(outside(root, out), "Candidate output must be outside the source workspace");
assert(outside(runtime, out) && outside(out, runtime), "Candidate output and selected runtime must be independent");
for (let parent = dirname(out);;) { if (existsSync(parent)) assert(lstatSync(parent).isDirectory() && !lstatSync(parent).isSymbolicLink(), "Linked output parent refused"); const next = dirname(parent); if (next === parent) break; parent = next; }
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const boundedFile = (path, maximum) => { const stat = lstatSync(path); assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= maximum, "Unsafe or oversized control input"); const bytes = readFileSync(path); assert(bytes.length <= maximum); return bytes; };
const planBytes = boundedFile(resolve(options["--plan"]), 2 * 1024 * 1024), plan = JSON.parse(planBytes);
const runtimeLock = boundedFile(join(runtime, "package-lock.json"), 8 * 1024 * 1024);
const parsedLock = JSON.parse(runtimeLock); assert.equal(parsedLock.lockfileVersion, 3, "Runtime must use a v3 npm lock");
const runtimePackages = parsedLock.packages;
const runtimeVersions = Object.fromEntries(["@aihq/catalog", "@aihq/scan", "@aihq/core"].map(name => {
  const version = runtimePackages?.[`node_modules/${name}`]?.version; assert(typeof version === "string", `Locked runtime must contain ${name}`);
  const packagePath = join(runtime, "node_modules", name), stat = lstatSync(packagePath); assert(stat.isDirectory() && !stat.isSymbolicLink(), "Runtime packages must be installed locally without links");
  const installed = JSON.parse(boundedFile(join(packagePath, "package.json"), 1024 * 1024)); assert.equal(installed.name, name); assert.equal(installed.version, version, "Installed runtime differs from lock");
  return [name, version];
}));
const worker = readFileSync(new URL("./release-package-consumer.mjs", import.meta.url), "utf8");
const readback = readFileSync(new URL("./release-package-readback.mjs", import.meta.url), "utf8");
// Pin executable inputs as well as lock intent. Internal npm bin links are
// recorded without traversal; links escaping their owned tree are refused.
const treeIdentity = (base, entries) => {
  const files = []; let total = 0;
  const visit = path => {
    const stat = lstatSync(path), name = relative(base, path).split(sep).join("/");
    if (stat.isSymbolicLink()) { assert(entries.length === 1 && entries[0] === "." && !outside(base, realpathSync(path)), "External tooling/runtime link refused"); files.push({ path: name, link: readlinkSync(path) }); }
    else if (stat.isDirectory()) for (const child of readdirSync(path).sort()) visit(join(path, child));
    else { assert(stat.isFile() && stat.nlink === 1 && stat.size <= 128 * 1024 * 1024, "Unsafe tooling/runtime member"); total += stat.size; assert(total <= 512 * 1024 * 1024, "Tooling/runtime tree too large"); files.push({ path: name, sha256: hash(readFileSync(path)), byteLength: stat.size }); }
    assert(files.length <= 30000, "Too many tooling/runtime members");
  };
  for (const entry of entries) visit(join(base, entry));
  return hash(JSON.stringify(files));
};
const integrityToolingSha256 = treeIdentity(root, ["tools/seed-consumer-lock.mjs", "tools/check-release.mjs", "package.json", "package-lock.json", "producer/declaration.json", "dist", "schemas"]);
const sourceDependenciesSha256 = treeIdentity(join(root, "node_modules"), ["."]);
const runtimeInstallationSha256 = treeIdentity(join(runtime, "node_modules"), ["."]);
const npm = realpathSync(npmCliPath()), npmRoot = dirname(dirname(npm));
const npmManifest = JSON.parse(boundedFile(join(npmRoot, "package.json"), 1024 * 1024)); assert.equal(npmManifest.name, "npm");
const execution = { node: process.execPath, nodeVersion: process.version, nodeSha256: hash(boundedFile(process.execPath, 256 * 1024 * 1024)),
  npm, npmVersion: npmManifest.version, npmToolingSha256: treeIdentity(npmRoot, ["."]) };
const identity = { execution, integrityToolingSha256, sourceDependenciesSha256, runtimeInstallationSha256, planSha256: hash(planBytes), toolSha256: hash(Buffer.concat([readFileSync(import.meta.filename), Buffer.from(worker), Buffer.from(readback)])), runtime, runtimeLockSha256: hash(runtimeLock), runtimeVersions };
const statePath = join(out, "progress.json"), resume = options["--resume"] === "true";
let state;
if (resume) { assert(lstatSync(out).isDirectory() && !lstatSync(out).isSymbolicLink(), "Linked checkpoint refused"); state = JSON.parse(boundedFile(statePath, 2 * 1024 * 1024)); assert.deepEqual(state.identity, identity, "Resume inputs or tooling changed"); }
else { assert(!existsSync(out), "Output already exists; use an explicitly verified --resume true checkpoint"); mkdirSync(out); state = { identity, timings: [], phase: "qualification" }; }
assert(Array.isArray(state.timings), "Checkpoint timings must be an array");
const lockPath = join(out, ".preparation.lock"), lock = openSync(lockPath, "wx");
try {
const safeWrite = (path, bytes) => {
  assert.equal(dirname(resolve(path)), out, "Control output must remain directly inside its owned output");
  // Replacement never opens the existing inode. Refuse linked control outputs,
  // including dangling symlinks that existsSync would otherwise hide.
  try { const stat = lstatSync(path); assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, "Unsafe linked control output"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, bytes, { flag: "wx" }); renameSync(temporary, path); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
};
const save = () => safeWrite(statePath, JSON.stringify(state, null, 2) + "\n"); save();
const run = (args, cwd, label, input) => {
  const began = performance.now();
  const result = spawnSync(process.execPath, args, { cwd, input, encoding: "utf8", windowsHide: true, timeout: 240000, maxBuffer: 64 * 1024 * 1024 });
  const value = result.stdout || "", success = !result.error && result.status === 0;
  safeWrite(join(out, `${label}-${state.timings.length}.log`), value + "\nSTDERR\n" + (result.stderr || ""));
  state.timings.push({ phase: label, durationMs: Math.round(performance.now() - began), status: success ? "passed" : "failed", exitCode: result.status, signal: result.signal }); if (!success) state.phase = `${label}-failed`; save();
  assert(success, `${label} failed; original output retained in ${out}. ${result.error?.message || ""}`); return value;
};
const packageRoot = join(out, "package"), receiptPath = join(out, "qualification.json");
state.phase = "qualification"; save();
assert(!existsSync(packageRoot) || existsSync(receiptPath), "Unverified partial assembly retained; inspect before selecting a fresh output");
const qualify = JSON.parse(run(["--input-type=module", "--eval", worker], runtime, "qualification", JSON.stringify({ plan, packageRoot, verifyOnly: existsSync(packageRoot) })));
if (existsSync(receiptPath)) assert.equal(JSON.parse(boundedFile(receiptPath, 64 * 1024 * 1024)).packageTreeSha256, qualify.packageTreeSha256, "Resume candidate tree changed");
else writeFileSync(receiptPath, JSON.stringify(qualify, null, 2) + "\n", { flag: "wx" });
state.phase = "integrity"; save(); run([join(root, "tools/check-release.mjs"), packageRoot], root, "integrity");
state.phase = "pack"; save();
if (!state.tarball) {
  assert(!readdirSync(out).some(name => name.toLowerCase().endsWith(".tgz")), "Unverified tarball retained; inspect before selecting a fresh output");
  const packed = JSON.parse(run([npm, "--prefix", packageRoot, "--global=false", "pack", "--ignore-scripts", "--offline", "--json", "--pack-destination", out], packageRoot, "pack"));
  assert.equal(packed.length, 1); const path = join(out, packed[0].filename), bytes = readFileSync(path);
  state.tarball = { path, sha256: hash(bytes), byteLength: bytes.length }; save();
} else { assert.equal(dirname(resolve(state.tarball.path)), out, "Checkpoint tarball must remain in its owned output"); const bytes = boundedFile(state.tarball.path, 256 * 1024 * 1024); assert.equal(hash(bytes), state.tarball.sha256, "Resume tarball changed"); assert.equal(bytes.length, state.tarball.byteLength); }
state.phase = "installed-readback"; save(); const consumer = join(out, "consumer");
if (!state.installed) {
  if (!existsSync(consumer)) seedConsumerLock(consumer, root);
  else assert(state.installStarted, "Unowned consumer directory refused");
  const plainTree = path => { const stat = lstatSync(path); assert(!stat.isSymbolicLink(), "Linked partial installation refused"); if (stat.isDirectory()) for (const name of readdirSync(path)) plainTree(join(path, name)); else assert(stat.isFile() && stat.nlink === 1); };
  plainTree(consumer);
  state.installStarted = true; save();
  run([npm, "--prefix", consumer, "--global=false", "install", "--ignore-scripts", "--bin-links=false", "--offline", "--no-audit", "--no-fund", state.tarball.path], consumer, "install"); state.installed = true; save();
}
const installedRoot = join(consumer, "node_modules/@aihq/catalog");
const installed = JSON.parse(run(["--input-type=module", "--eval", worker], runtime, "installed-readback", JSON.stringify({ plan, packageRoot: installedRoot, verifyOnly: true })));
assert.equal(installed.packageTreeSha256, qualify.packageTreeSha256);
const publicReadback = JSON.parse(run(["--input-type=module", "--eval", readback], consumer, "public-readback", JSON.stringify({ views: qualify.views, unchangedExports: qualify.unchangedExports })));
assert.equal(publicReadback.releaseExports, 9); assert.equal(publicReadback.qualifiedViews, 5);
state.phase = "complete"; state.durationMs = Math.round(performance.now() - started); save();
const result = { ...qualify, identity, tarball: state.tarball, installedReadback: publicReadback, timings: state.timings, durationMs: state.durationMs,
  totalRecordedPhaseMs: state.timings.reduce((sum, phase) => sum + phase.durationMs, 0), resumed: resume };
safeWrite(join(out, "receipt.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ receipt: join(out, "receipt.json"), tarball: state.tarball, views: qualify.views.map(view => ({ id: view.id, scanId: view.baseline.scanId })), installedReadback: true }));
} finally { closeSync(lock); unlinkSync(lockPath); }
