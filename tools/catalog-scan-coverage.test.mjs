import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { readReleaseIndex, renderCoverage } from "./catalog-scan-coverage.mjs";

const published = `git-sha1:${"a".repeat(40)}`;
const pending = `git-sha1:${"b".repeat(40)}`;
const archive = "c".repeat(64);
const tag = "scan-catalog-results-example";
const raw = Buffer.from(
  JSON.stringify({
    repository: "samartomar/aih-scan",
    releaseTag: tag,
    records: [{ scanKey: published, archiveSha256: archive, assetName: `${archive}.tar` }],
  }),
);
const index = {
  name: "index.json",
  state: "uploaded",
  digest: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
};
const asset = { name: `${archive}.tar`, state: "uploaded", digest: `sha256:${archive}` };

const framework = (id, items, extra = {}) => ({ framework: { id }, items, ...extra });

test("reports exact keys once overall and shows every Catalog reference", () => {
  const manifests = [
    framework(
      "sample",
      [
        { id: "sample.skill.example", kind: "skill", scanKey: published, fetch: "upstream" },
        {
          id: "sample.skill.edited",
          kind: "skill",
          scanKey: published,
          editions: { codex: { scanKey: pending } },
        },
        { id: "sample.ai-setup.graph", kind: "ai-setup" },
      ],
      {
        bundles: [{ id: "runtime", scanKey: published }],
        plugins: [{ plugin: "third-party", scanKey: published, folderScanKey: pending }],
      },
    ),
    framework("other", [{ id: "other.skill.shared", kind: "skill", scanKey: pending }]),
  ];
  const release = readReleaseIndex({ tag, assets: [index, asset] }, raw);
  const report = renderCoverage("d".repeat(40), manifests, [release]);
  assert.match(report, /\| \*\*All families\*\* \| 4 \| 2 \| 1 \| 1 \| 1 \|/);
  assert.match(report, /sample\.skill\.edited@codex.*Pending/);
  assert.match(report, /sample\.skill\.example.*upstream-only.*Published/);
  assert.match(report, /sample\.ai-setup\.graph.*No Scan key/);
  assert.match(report, /runtime.*Bundle.*Published/);
  assert.match(report, /third-party.*Plugin.*Published/);
  assert.match(report, /third-party:full-folder.*Full plugin folder.*Pending/);
});

test("refuses to count a missing archive or mismatched index digest as published", () => {
  assert.throws(() => readReleaseIndex({ tag, assets: [index] }, raw), /archive/);
  assert.throws(
    () => readReleaseIndex({ tag, assets: [index, asset] }, Buffer.from("{}")),
    /index digest/,
  );
});
