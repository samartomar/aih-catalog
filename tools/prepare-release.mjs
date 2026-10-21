#!/usr/bin/env node
// Freeze content first; prepare a final release only after checking exact evidence.
// This tool never scans, signs, changes trust, allocates a version or publishes.
import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createContentInventory } from "../dist/release/reader.js";
import { readInstalledRelease } from "../dist/release/node.js";
import { readCanonicalBytes } from "../dist/release/json.js";

const [mode, ...args] = process.argv.slice(2), options = {};
const started = performance.now();
const allowed = new Set(["--content", "--content-sha256", "--out", "--baseline", "--trust", "--runtime", "--package-root", "--release", "--receipt"]);
for (let i = 0; i < args.length; i += 2) {
  if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || Object.hasOwn(options, args[i]))
    throw new Error("Expected unique --name value arguments.");
  options[args[i]] = args[i + 1];
}
if (!["freeze", "prepare"].includes(mode) || !options["--content"] || !options["--content-sha256"] || !options["--out"])
  throw new Error("Usage: prepare-release.mjs freeze|prepare --content file --content-sha256 hex --out new-file [--baseline file --trust file --runtime installed-root --package-root staged-package]");
if (options["--receipt"] && mode !== "prepare") throw new Error("Receipts require baseline preparation.");
const outputPath = resolve(options["--out"]), receiptPath = options["--receipt"] && resolve(options["--receipt"]);
if (existsSync(outputPath) || (receiptPath && (existsSync(receiptPath) || receiptPath === outputPath)))
  throw new Error("Release and receipt outputs must be distinct new files.");
const bounded = (path, maxBytes) => {
  if (statSync(path).size > maxBytes) throw new Error("Input exceeds byte limit.");
  const bytes = readFileSync(path);
  if (bytes.length > maxBytes) throw new Error("Input exceeds byte limit.");
  return bytes;
};
const contentBytes = bounded(resolve(options["--content"]), 16 * 1024 * 1024);
const expectedSha256 = options["--content-sha256"];
if (mode === "freeze") {
  const result = createContentInventory(contentBytes, { expectedSha256 });
  if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
  writeFileSync(resolve(options["--out"]), result.bytes, { flag: "wx" });
  console.log(JSON.stringify({ sha256: result.sha256, byteLength: result.byteLength }));
} else {
  for (const key of ["--baseline", "--trust", "--runtime", "--package-root"]) if (!options[key]) throw new Error(`Missing ${key}.`);
  const checkedContent = await readInstalledRelease({ root: resolve(options["--package-root"]), release: options["--release"] });
  if (!checkedContent.valid || checkedContent.release.sha256 !== expectedSha256)
    throw new Error("The staged package does not contain the exact checked input content and material.");
  const control = path => readCanonicalBytes(bounded(resolve(path), 16 * 1024 * 1024), { maxBytes: 16 * 1024 * 1024, maxDepth: 32 });
  // Node resolves ESM import conditions from the explicitly selected installed
  // runtime. No require-condition fallback or package-private target discovery.
  const runtimeSource = `
    import { prepareReleaseBaseline, acquireBaselineArtifact } from '@aihq/catalog/node';
    import { readArtifact, readContentCoverage, readContentCoverageBatch } from '@aihq/scan/read';
    import { authenticateEvidence } from '@aihq/core';
    let json = ''; for await (const chunk of process.stdin) json += chunk;
    const input = JSON.parse(json);
    const result = await prepareReleaseBaseline({ ...input, contentBytes: Buffer.from(input.contentBase64, 'base64') }, {
      readArtifact, readContentCoverage, readContentCoverageBatch, authenticateEvidence,
      acquireArtifact: artifact => acquireBaselineArtifact(artifact, { packageRoot: input.packageRoot }),
    });
    process.stdout.write(JSON.stringify(result.valid ? { valid: true,
      releaseBase64: Buffer.from(result.releaseBytes).toString('base64'), releaseSha256: result.release.sha256,
      inventorySha256: result.inventory.sha256, authentication: result.authentication, itemCoverage: result.itemCoverage,
    } : result));
  `;
  const baseline = control(options["--baseline"]), trustBytes = bounded(resolve(options["--trust"]), 16 * 1024 * 1024);
  const trust = readCanonicalBytes(trustBytes, { maxBytes: 16 * 1024 * 1024, maxDepth: 32 });
  const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", runtimeSource], {
    cwd: resolve(options["--runtime"]), windowsHide: true, encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024,
    input: JSON.stringify({ contentBase64: contentBytes.toString("base64"), expectedSha256,
      baseline, trust, packageRoot: resolve(options["--package-root"]) }),
  }));
  if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
  const releaseBytes = Buffer.from(result.releaseBase64, "base64");
  writeFileSync(outputPath, releaseBytes, { flag: "wx" });
  if (receiptPath) writeFileSync(receiptPath, JSON.stringify({
    schema: "urn:aihq:catalog:qualification-receipt:1.0.0",
    content: { sha256: expectedSha256, byteLength: contentBytes.length },
    release: { sha256: result.releaseSha256, byteLength: releaseBytes.length },
    inventorySha256: result.inventorySha256, baseline,
    trustSha256: createHash("sha256").update(trustBytes).digest("hex"),
    authentication: result.authentication, itemCoverage: result.itemCoverage,
    durationMs: Math.round(performance.now() - started),
  }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ releaseSha256: result.releaseSha256,
    inventorySha256: result.inventorySha256, authentication: result.authentication,
    itemCoverage: result.itemCoverage }));
}
