import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  catalogScannerEvidenceV1,
  parseCoreQualificationDataV1,
} from "../../src/production/workbench-producers-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const dataPath = (file: string) => resolve(root, "src", "production", "data", file);
const data = (file: string): unknown => JSON.parse(readFileSync(dataPath(file), "utf8"));
const TARGETS = ["claude", "codex", "copilot", "cursor", "kimi", "kiro", "opencode"];

interface QualificationData {
  version: number;
  artifacts: Record<string, string>;
  records: { member: string; closures: Record<string, string> }[];
  [key: string]: unknown;
}

const qualification = () => data("core-qualification-data-v1.json") as QualificationData;

describe("Core companion materials", () => {
  it("keeps no frozen derived companion documents beside their true inputs", () => {
    for (const file of [
      "catalog-core-qualification-source-v1.json",
      "catalog-scanner-evidence-source-v1.json",
      "catalog-public-baseline-source-v1.json",
    ])
      expect(existsSync(dataPath(file)), file).toBe(false);
  });

  it("derives the Scanner source proofs from the sealed packaged records in order", () => {
    const evidence = catalogScannerEvidenceV1(
      data("packaged-source-data-v1.json"),
      data("packaged-collection-evidence-v1.json"),
      TARGETS,
    );
    expect(evidence.records).toEqual(data("packaged-collection-evidence-v1.json"));
    expect(
      evidence.sourceProofs.map((proof) => (proof.source as { repository: string }).repository),
    ).toEqual(["anthropics/skills", "DietrichGebert/ponytail", "affaan-m/ECC", "obra/Superpowers"]);
  });

  it("reads the qualification data as content-addressed artifacts", () => {
    expect(parseCoreQualificationDataV1(qualification()).version).toBe(2);
  });

  it("refuses an artifact whose bytes do not hash to its address", () => {
    const value = qualification();
    const [address] = Object.keys(value.artifacts);
    value.artifacts[address as string] = Buffer.from("tampered").toString("base64");
    expect(() => parseCoreQualificationDataV1(value)).toThrow(/content address/u);
  });

  it("refuses a record that names an artifact the data does not carry", () => {
    const value = qualification();
    (value.records[0] as { member: string }).member = "f".repeat(64);
    expect(() => parseCoreQualificationDataV1(value)).toThrow(/absent artifact/u);
  });

  it("refuses an unknown version or field", () => {
    expect(() => parseCoreQualificationDataV1({ ...qualification(), version: 3 })).toThrow(
      /version/u,
    );
    expect(() => parseCoreQualificationDataV1({ ...qualification(), extra: true })).toThrow(
      /unsupported field extra/u,
    );
  });
});
