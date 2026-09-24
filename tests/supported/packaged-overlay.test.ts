import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePackagedScannerCollectionEvidenceV1 } from "../../src/production/workbench/packaged-evidence-v1.js";
import { parsePackagedSourceRecordsV1 } from "../../src/production/workbench/packaged-source-overlay-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const data = (file: string) =>
  JSON.parse(readFileSync(resolve(root, "src", "production", "data", file), "utf8")) as {
    bytes: string;
    sha256: string;
  }[];
const TARGETS = ["claude", "codex", "copilot", "cursor", "kimi", "kiro", "opencode"];

describe("sealed packaged inputs", () => {
  it("reads every packaged source record and its seal", () => {
    const { records, seals } = parsePackagedSourceRecordsV1(
      data("packaged-source-data-v1.json"),
      TARGETS,
    );
    expect(records.map((item) => item.source.repository)).toEqual([
      "anthropics/skills",
      "DietrichGebert/ponytail",
      "affaan-m/ECC",
      "obra/Superpowers",
    ]);
    expect(seals.every((seal) => seal.bytes > 0)).toBe(true);
  });

  it("refuses a packaged source record whose bytes no longer match its seal", () => {
    const wrappers = data("packaged-source-data-v1.json");
    const first = wrappers[0] as { bytes: string; sha256: string };
    first.sha256 = "0".repeat(64);
    expect(() => parsePackagedSourceRecordsV1(wrappers, TARGETS)).toThrow(/seal mismatch/u);
  });

  it("refuses Scanner collection evidence whose seal does not match", () => {
    const records = data("packaged-collection-evidence-v1.json");
    expect(parsePackagedScannerCollectionEvidenceV1(records)).toHaveLength(3);
    const first = records[0] as { bytes: string; sha256: string };
    first.bytes = first.bytes.replace('"display-only"', '"authoritative"');
    expect(() => parsePackagedScannerCollectionEvidenceV1(records)).toThrow(/seal mismatch/u);
  });
});
