#!/usr/bin/env node
// The Extensions framework's release 1.7.0 prepared content (samartomar/aih-catalog#145):
// one tool-neutral item per piece of content, Matt's buckets as sets, true Matt
// provenance, the 27 frozen-default copies superseded by name and source path, and
// the three hook sources folded into their hook items. The build runs through the
// public transition compiler over the committed checked releases; this script only
// renders the prepared content document, its frozen content inventory, the
// synthesised behaviour files and the merged hook recipes. The baseline binding is
// a separate preparation step (docs/SCAN-BASELINE.md): this script freezes the
// content inventory an assessment must capture and binds nothing.
// Run `npm run build:dist` first. No acquisition, execution or Scan.
//
//   node tools/generate-extensions-17-release.mjs [--check]
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildExtensions17,
  EXTENSIONS_17_CONTENT_PATH,
} from "../dist/release/extensions-transition.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export { buildExtensions17, EXTENSIONS_17_CONTENT_PATH };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  assert(
    process.argv.length === (check ? 3 : 2),
    "Usage: node tools/generate-extensions-17-release.mjs [--check]",
  );
  const built = buildExtensions17({ root });
  const stale = [];
  for (const [path, { bytes, mode }] of built.outputs) {
    const target = resolve(root, path);
    if (check) {
      let current;
      try {
        current = readFileSync(target);
      } catch {
        stale.push(`${path} (missing)`);
        continue;
      }
      if (!Buffer.from(bytes).equals(current)) stale.push(path);
      else if (mode !== undefined && (statSync(target).mode & 0o111) !== 0)
        stale.push(`${path} (mode)`);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      if (mode !== undefined) chmodSync(target, mode);
    }
  }
  if (stale.length > 0) {
    console.error(
      `Stale Extensions release 1.7.0 output; run node tools/generate-extensions-17-release.mjs:\n  ${stale.join("\n  ")}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `${check ? "Checked" : "Generated"} ${EXTENSIONS_17_CONTENT_PATH} ${built.releaseSha256} (${built.release.items.length} items, ${built.release.sets?.length ?? 0} sets, ${built.release.retired?.length ?? 0} retired, ${built.outputs.size} members, inventory ${built.inventorySha256})`,
    );
  }
}
