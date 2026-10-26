#!/usr/bin/env node
// Offline whole-package integrity check of the committed release/: envelope,
// identifiers, recipe/configuration agreement, member paths, lengths and hashes,
// the exact member inventory, required-dependency closure, source provenance and
// the internal references and generation placeholders of Catalog-authored content.
// It needs no network, Scan, Core checkout or lock. Run `npm run build:dist` first.
// The authored-content allowances come from this checkout's producer declaration,
// also when another package root is checked.
//
//   node tools/check-release.mjs [package-root]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const producer = (file) => import(`${new URL(`../dist/producer/${file}`, import.meta.url)}`);
try {
  const [{ checkCandidateFiles }, { parseDeclaration }, { readReleaseDirectory }] = await Promise.all([
    producer("integrity.js"),
    producer("declaration.js"),
    producer("install.js"),
  ]);
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const declaration = parseDeclaration(
    readFileSync(new URL("../producer/declaration.json", import.meta.url)),
  );
  const result = checkCandidateFiles(
    readReleaseDirectory(root),
    { name: manifest.name, version: manifest.version },
    { authored: declaration.authored },
  );
  // The frozen default stays exported under its original path and exact bytes.
  const { FROZEN_DEFAULT_RELEASE_SHA256 } = await import(`${new URL("../dist/release/contracts.js", import.meta.url)}`);
  const frozen = createHash("sha256").update(readFileSync(join(root, "release/release.json"))).digest("hex");
  const checks = [...result.checks, {
    name: "frozen-default",
    ok: frozen === FROZEN_DEFAULT_RELEASE_SHA256,
    detail: frozen === FROZEN_DEFAULT_RELEASE_SHA256 ? "" : `release/release.json ${frozen} vs recorded ${FROZEN_DEFAULT_RELEASE_SHA256}`,
  }];
  for (const check of checks) {
    console.log(`${check.ok ? "pass" : "FAIL"} ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
  }
  if (!result.ok || frozen !== FROZEN_DEFAULT_RELEASE_SHA256) {
    console.error("check-release: the committed release failed its integrity checks");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`check-release: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
