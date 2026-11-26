import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { readReleaseIndex, readReportSummary, renderCoverage } from "./catalog-scan-coverage.mjs";

const published = `git-sha1:${"a".repeat(40)}`;
const pending = `git-sha1:${"b".repeat(40)}`;
const archive = "c".repeat(64);
const tag = "scan-catalog-results-example";
const summary = Buffer.from(
  JSON.stringify({
    format: "aih-scan-summary/1",
    scanKey: published,
    revision: 1,
    label: "CAUTION",
    coverage: "partial",
    tools: [{ mode: "ai" }],
  }),
);
const record = {
  scanKey: published,
  revision: 1,
  archiveSha256: archive,
  assetName: `${archive}.tar`,
  summary: {
    path: `targets/${published.replace(":", "-")}/summary.json`,
    sha256: createHash("sha256").update(summary).digest("hex"),
  },
};
const raw = Buffer.from(
  JSON.stringify({
    repository: "samartomar/aih-scan",
    releaseTag: tag,
    records: [record],
  }),
);
const index = {
  name: "index.json",
  state: "uploaded",
  digest: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
};
const asset = { name: `${archive}.tar`, state: "uploaded", digest: `sha256:${archive}` };

const framework = (id, items, extra = {}) => ({
  framework: { id, name: id },
  items: items.map((item) => ({ ...item, name: item.id.split(".").at(-1) })),
  ...extra,
});

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
  const { records, indexSha256 } = readReleaseIndex({ tag, assets: [index, asset] }, raw);
  const release = {
    tag,
    indexSha256,
    date: "2026-11-26T12:00:00Z",
    reports: [readReportSummary(records[0], summary)],
  };
  const { report, csv } = renderCoverage("d".repeat(40), manifests, [release]);
  assert.match(report, /\| \*\*All families\*\* \| 4 \| 2 \| 1 \| 1 \| 1 \|/);
  assert.match(report, /edited.*Codex edition.*No published scan yet/);
  assert.match(report, /example.*upstream-only.*AI · CAUTION · Partial.*Nov 26, 2026/);
  assert.match(report, /graph.*See qualifications/);
  assert.match(report, /runtime.*Runtime bundle.*CAUTION/);
  assert.match(report, /third-party.*Plugin.*CAUTION/);
  assert.match(report, /third-party.*Full plugin folder.*No published scan yet/);
  assert.ok(!report.includes(published));
  assert.match(csv, /sample\.skill\.edited@codex.*git-sha1:b{40}/);
});

test("refuses to count a missing archive or mismatched index digest as published", () => {
  assert.throws(() => readReleaseIndex({ tag, assets: [index] }, raw), /archive/);
  assert.throws(
    () => readReleaseIndex({ tag, assets: [index, asset] }, Buffer.from("{}")),
    /index digest/,
  );
  assert.throws(() => readReportSummary(record, Buffer.from("{}")), /mismatched summary/);
});
