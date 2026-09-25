import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assembleCatalogAuthoringBundleV1,
  readCollectionSnapshotV1,
} from "../../src/production/workbench/authoring-bundle-v1.js";
import {
  compileMattPocockProviderV1,
  compilePonytailProviderV1,
} from "../../src/production/workbench/catalog-providers-v1.js";
import {
  produceSingleSourceAuthoringBundleV1,
  projectAuthoringBundleSourceV1,
} from "../../src/production/workbench/single-source-bundle-v1.js";
import { assertCoreAdmitsV1 } from "./core-admits.js";

const root = resolve(import.meta.dirname, "..", "..");
const data = (file: string) => resolve(root, "src", "production", "data", file);
const recorded = (file: string): string =>
  JSON.parse(readFileSync(data("upstream-inputs-v1.json"), "utf8")).files[file].commit;

type Json = Record<string, unknown>;

describe("single-source authoring bundle", () => {
  it("emits Matt Pocock at its fetched pin as the one sealed source Core admits", () => {
    const pin = recorded("mattpocock.snapshot.json");
    const bundle = produceSingleSourceAuthoringBundleV1(root, "mattpocock", pin) as unknown as Json;
    assertCoreAdmitsV1(bundle, "source:mattpocock", pin);
    const snapshot = readCollectionSnapshotV1(root, "mattpocock.snapshot.json") as {
      inclusion: { canonicalSkillPaths: unknown[] };
    };
    expect(Object.keys(bundle.assets as Json)).toHaveLength(
      snapshot.inclusion.canonicalSkillPaths.length,
    );
  });

  it("is the one-source projection of the assembly the full authoring bundle runs", () => {
    const pin = recorded("mattpocock.snapshot.json");
    const { bundle: assembled } = assembleCatalogAuthoringBundleV1(
      root,
      [
        compileMattPocockProviderV1(readCollectionSnapshotV1(root, "mattpocock.snapshot.json")),
        compilePonytailProviderV1(readCollectionSnapshotV1(root, "ponytail.snapshot.json")),
      ],
      [],
    );
    expect(Object.keys(assembled.sources).length).toBeGreaterThan(1);
    expect(projectAuthoringBundleSourceV1(root, assembled, "source:mattpocock")).toEqual(
      produceSingleSourceAuthoringBundleV1(root, "mattpocock", pin),
    );
  });

  it("refuses a pin other than the revision it compiles", () => {
    expect(() => produceSingleSourceAuthoringBundleV1(root, "mattpocock", "0".repeat(40))).toThrow(
      /emits source:mattpocock@c55ee46073ed923f86ce59a5eb3b6d895095d1b7, not 0{40}/,
    );
  });

  it("keeps the vetted-pin guard for the vendor-lock-bound framework sources", () => {
    const pin = recorded("ecc-modules-v1.json");
    expect(() => produceSingleSourceAuthoringBundleV1(root, "ecc", pin)).toThrow(
      /was not fetched at the vetted pin/,
    );
    const lock = JSON.parse(readFileSync(data("vendor-lock-v1.json"), "utf8")) as {
      sources: { id: string; pinnedSha: string }[];
    };
    expect(lock.sources.find((source) => source.id === "ecc")?.pinnedSha).not.toBe(pin);
    expect(() =>
      produceSingleSourceAuthoringBundleV1(root, "ecc", pin, { vendorLock: lock }),
    ).toThrow(/was not fetched at the vetted pin/);
  });

  it("refuses a projection that would cut a cross-source closure", () => {
    const { bundle } = assembleCatalogAuthoringBundleV1(
      root,
      [
        compileMattPocockProviderV1(readCollectionSnapshotV1(root, "mattpocock.snapshot.json")),
        compilePonytailProviderV1(readCollectionSnapshotV1(root, "ponytail.snapshot.json")),
      ],
      [],
    );
    const from = Object.values(bundle.assets).find((a) => a.sourceId === "source:mattpocock");
    const to = Object.values(bundle.assets).find((a) => a.sourceId === "source:ponytail");
    if (from === undefined || to === undefined) throw new Error("the fixture needs both sources");
    const crossed = structuredClone(bundle);
    crossed.relations.push({
      fromAssetId: from.id,
      toAssetId: to.id,
      kind: "requires",
    } as (typeof crossed.relations)[number]);
    expect(() => projectAuthoringBundleSourceV1(root, crossed, "source:mattpocock")).toThrow(
      /cross-source relation/,
    );
  });

  it("refuses a subject without a Catalog compiler or a malformed pin", () => {
    expect(() =>
      produceSingleSourceAuthoringBundleV1(root, "aih-core" as "ecc", "0".repeat(40)),
    ).toThrow(/no single-source subject aih-core/);
    expect(() => produceSingleSourceAuthoringBundleV1(root, "mattpocock", "C55EE46")).toThrow(
      /40-character lowercase commit/,
    );
  });
});
