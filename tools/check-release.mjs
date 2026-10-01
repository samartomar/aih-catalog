#!/usr/bin/env node
// Offline whole-package integrity check of the committed release/: envelope,
// identifiers, recipe/configuration agreement, member paths, lengths and hashes,
// the exact member inventory, required-dependency closure and source provenance.
// It needs no network, Scan, Core checkout or lock. Run `npm run build:dist` first.
//
//   node tools/check-release.mjs [package-root]
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const producer = (file) => import(`${new URL(`../dist/producer/${file}`, import.meta.url)}`);
try {
  const [{ checkCandidateFiles }, { readReleaseDirectory }] = await Promise.all([
    producer("integrity.js"),
    producer("install.js"),
  ]);
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const result = checkCandidateFiles(readReleaseDirectory(root), { name: manifest.name, version: manifest.version });
  for (const check of result.checks) {
    console.log(`${check.ok ? "pass" : "FAIL"} ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
  }
  if (!result.ok) {
    console.error("check-release: the committed release failed its integrity checks");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`check-release: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
