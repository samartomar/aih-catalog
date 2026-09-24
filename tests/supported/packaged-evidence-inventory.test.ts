import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJsonV1, sha256HexV1 } from "../../src/production/strict-json-v1.js";
import type { AuthoringCatalogBundleV1 } from "../../src/production/workbench/contracts-v1.js";
import {
  packagedCoverageProjectionDigestV1,
  parsePackagedScannerCollectionEvidenceV1,
  projectScannerCollectionEvidenceV1,
} from "../../src/production/workbench/packaged-evidence-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const json = (...path: string[]) => JSON.parse(readFileSync(resolve(root, ...path), "utf8"));

interface Subject {
  assetId: string;
}
interface Component {
  componentId: string;
  paths: string[];
  subject?: Subject;
  subjects?: Subject[];
}

/** The real sealed mattpocock record, its components' subjects rebound by `bind`, resealed. */
function inventoryRecord(bind: (all: Subject[]) => Subject[][]) {
  const sealed = (
    json("src", "production", "data", "packaged-collection-evidence-v1.json") as {
      bytes: string;
    }[]
  ).map((item) => JSON.parse(item.bytes));
  const record = sealed.find((item) => item.catalog.id === "mattpocock");
  const components = record.coverage.components as Component[];
  const bound = bind(components.slice(0, 2).map((component) => component.subject as Subject));
  record.coverage.components = components.map(({ subject, ...component }, index) =>
    index < bound.length ? { ...component, subjects: bound[index] } : { ...component, subject },
  );
  record.catalog.coverageProjectionDigest = packagedCoverageProjectionDigestV1(record.coverage);
  const bytes = canonicalJsonV1(record);
  return { record, sealed: [{ bytes, sha256: `sha256:${sha256HexV1(bytes)}` }] };
}

describe("packaged collection evidence for an inventory partition", () => {
  it("projects each compiled asset from the one component whose scan covers it", () => {
    const { record, sealed } = inventoryRecord(([first, second]) => [
      [first as Subject, second as Subject],
      [],
    ]);
    const [parsed] = parsePackagedScannerCollectionEvidenceV1(sealed);
    const bundle = json("defaults", "catalog-authoring-bundle-v1.json").prepared
      .bundle as AuthoringCatalogBundleV1;
    const evidence = projectScannerCollectionEvidenceV1(
      bundle,
      parsed === undefined ? [] : [parsed],
    );
    const [covering] = record.coverage.components as Component[];
    const ids = (covering?.subjects ?? []).map((subject) => subject.assetId);
    expect(ids).toHaveLength(2);
    for (const id of ids)
      expect(evidence[`evidence:${id}`]).toMatchObject({
        subjects: [expect.objectContaining({ assetId: id })],
        coveredPaths: [...(covering?.paths ?? [])].sort(),
      });
    expect(evidence[`evidence:${ids[0]}`]?.evidenceDigest).not.toBe(
      evidence[`evidence:${ids[1]}`]?.evidenceDigest,
    );
    // All 25 assets still project; the asset-free component, still scanned, projects none.
    expect(Object.keys(evidence)).toHaveLength(record.coverage.components.length);
  });

  it("refuses an asset bound twice, out-of-order subjects, and both subject forms at once", () => {
    expect(() =>
      parsePackagedScannerCollectionEvidenceV1(
        inventoryRecord(([first, second]) => [
          [first as Subject, second as Subject],
          [first as Subject],
        ]).sealed,
      ),
    ).toThrow(/coverage asset bound twice/u);
    expect(() =>
      parsePackagedScannerCollectionEvidenceV1(
        inventoryRecord(([first, second]) => [[second as Subject, first as Subject], []]).sealed,
      ),
    ).toThrow(/coverage subjects out of order/u);
    const { record } = inventoryRecord(([first]) => [[first as Subject]]);
    const [component] = record.coverage.components as Component[];
    if (component !== undefined) component.subject = component.subjects?.[0];
    record.catalog.coverageProjectionDigest = packagedCoverageProjectionDigestV1(record.coverage);
    const bytes = canonicalJsonV1(record);
    expect(() =>
      parsePackagedScannerCollectionEvidenceV1([{ bytes, sha256: `sha256:${sha256HexV1(bytes)}` }]),
    ).toThrow(/component 0/u);
  });
});
