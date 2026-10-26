#!/usr/bin/env node
// The release 1.7 restructuring check. Every release 1.7.0 document this package
// lists must pass the scripted item-by-item comparison with its framework's
// amended expected projection (hashes, supersessions, collapsed MCP pairs and edit
// digests) before its release index entry can ship. Run `npm run build:dist` first.
//
//   node tools/check-restructuring.mjs [release.json ...]
//
// With no arguments it checks every 1.7.0 release in the package's releaseInventory;
// explicit paths check those documents instead and print each row.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RELEASE_SCHEMA_ID_1_7, releaseInventory } from "../dist/release/contracts.js";
import { compareRestructuring } from "../dist/release/producer.js";
import { readReleaseContent } from "../dist/release/reader.js";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const expectation = JSON.parse(readFileSync(resolve(root, "restructuring/expected-1.7.0.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const explicit = process.argv.slice(2);
const targets = explicit.length > 0
  ? explicit.map((path) => resolve(path))
  : releaseInventory.releases
      .filter((entry) => entry.schema === RELEASE_SCHEMA_ID_1_7)
      .map((entry) => resolve(root, manifest.exports[entry.release]));
let failed = 0;
for (const path of targets) {
  const bytes = readFileSync(path);
  const read = readReleaseContent(bytes, { expectedSha256: createHash("sha256").update(bytes).digest("hex") });
  if (!read.valid) {
    failed++;
    console.error(`FAIL ${path}: not a readable release (${read.diagnostics.map((d) => d.reason).join(", ")})`);
    continue;
  }
  if (read.release.schema !== RELEASE_SCHEMA_ID_1_7) {
    failed++;
    console.error(`FAIL ${path}: ${read.release.schema} is not release 1.7.0`);
    continue;
  }
  const result = compareRestructuring({ release: read.release, expectation });
  const summary = Object.entries(result.counts)
    .filter(([, count]) => count.pass + count.fail > 0)
    .map(([check, count]) => `${check} ${count.pass}/${count.pass + count.fail}`)
    .join(", ");
  console.log(`${result.status === "pass" ? "pass" : "FAIL"} ${result.framework} (${path}): ${summary}`);
  for (const row of result.rows)
    if (explicit.length > 0 || row.status === "fail")
      console.log(`  ${row.status} ${row.check} ${row.subject}${row.status === "fail" ? `: expected ${row.expected}, actual ${row.actual}` : ""}`);
  if (result.status !== "pass") failed++;
}
if (targets.length === 0) console.log("No release 1.7.0 documents are listed yet; nothing to compare.");
if (failed > 0) {
  console.error(`check-restructuring: ${failed} release(s) fail the comparison; their index entries cannot ship`);
  process.exitCode = 1;
}
