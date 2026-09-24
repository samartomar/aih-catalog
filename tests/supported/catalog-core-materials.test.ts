import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readCatalogCoreQualificationV1Result,
  readCatalogPublicBaselineV1Result,
  readCatalogScannerEvidenceV1Result,
} from "../../src/index.js";

const root = resolve(import.meta.dirname, "..", "..");

describe("Catalog-owned Core materials", () => {
  it.each([
    ["catalog-core-qualification-v1.json", readCatalogCoreQualificationV1Result],
    ["catalog-scanner-evidence-v1.json", readCatalogScannerEvidenceV1Result],
    ["catalog-public-baseline-v1.json", readCatalogPublicBaselineV1Result],
  ] as const)("reads the generated %s document", (name, reader) => {
    expect(reader({ bytes: readFileSync(resolve(root, "defaults", name)) })).toMatchObject({
      state: "read",
    });
  });
});
