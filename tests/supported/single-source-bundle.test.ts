import { createHash } from "node:crypto";
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

const root = resolve(import.meta.dirname, "..", "..");
const data = (file: string) => resolve(root, "src", "production", "data", file);
const recorded = (file: string): string =>
  JSON.parse(readFileSync(data("upstream-inputs-v1.json"), "utf8")).files[file].commit;

type Json = Record<string, unknown>;
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const item = value as Json;
  return `{${Object.keys(item)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`)
    .join(",")}}`;
};
const sha256 = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const ordered = (ids: readonly string[]) =>
  new Set(ids).size === ids.length &&
  ids.every((id, index) => index === 0 || (ids[index - 1] as string) < id);

/**
 * What Core c00248ef requires of a `--source-bundle`, restated here so the Catalog proves its
 * output against Core's rules rather than against its own validator:
 * - src/baseline-evidence/scanner-catalog-consumer.ts:75-92: the bundle parses as
 *   AuthoringCatalogBundleV1, passes the integrity check, and carries exactly the one source;
 * - src/org-policy/workbench/contracts.ts:837-1022: the strict top-level shape and every
 *   cross reference (source and asset keys, asset revisions, detail chunks, groups,
 *   templates, relations, evidence subjects, canonical member order);
 * - src/org-policy/workbench/catalog-integrity.ts:5-21: each detail chunk digest is the
 *   sha256 of its bytes, and bundleDigest is the canonical JSON sha256 of the bundle with an
 *   empty provenance;
 * - src/baseline-evidence/scanner-definition.ts:450-457: the admitted source's revision is
 *   the definition's pin.
 */
function assertCoreAdmitsV1(bundle: Json, sourceId: string, pin: string): void {
  const allowed = [
    "version",
    "sources",
    "assets",
    "groups",
    "relations",
    "templates",
    "evidence",
    "qualifications",
    "provenance",
    "detailChunks",
  ];
  expect(Object.keys(bundle).every((key) => allowed.includes(key))).toBe(true);
  expect(bundle.version).toBe("authoring-catalog-bundle/v1");
  const sources = bundle.sources as Record<string, { id: string; revision: { id: string } }>;
  expect(Object.keys(sources)).toEqual([sourceId]);
  expect(sources[sourceId]?.id).toBe(sourceId);
  expect(sources[sourceId]?.revision.id).toBe(pin);
  const assets = bundle.assets as Record<
    string,
    {
      id: string;
      sourceId: string;
      sourceRevisionId: string;
      contentDigest: string;
      detailChunkId: string;
    }
  >;
  const chunks = bundle.detailChunks as Record<string, { bytes: string; digest: string }>;
  for (const [id, asset] of Object.entries(assets)) {
    expect(asset.id).toBe(id);
    expect(asset.sourceId).toBe(sourceId);
    expect(asset.sourceRevisionId).toBe(pin);
    expect(chunks[asset.detailChunkId]).toBeDefined();
  }
  for (const chunk of Object.values(chunks)) expect(chunk.digest).toBe(sha256(chunk.bytes));
  for (const [id, group] of Object.entries(bundle.groups as Record<string, Json>)) {
    expect(group.id).toBe(id);
    const members = group.assetIds as string[];
    expect(ordered(members)).toBe(true);
    expect(members.every((member) => assets[member] !== undefined)).toBe(true);
  }
  for (const [id, template] of Object.entries(bundle.templates as Record<string, Json>)) {
    expect(template.id).toBe(id);
    const roots = (template.roots as { assetId: string }[]).map((root) => root.assetId);
    const exclusions = template.exclusions as string[];
    expect(ordered(roots) && ordered(exclusions)).toBe(true);
    expect([...roots, ...exclusions].every((member) => assets[member] !== undefined)).toBe(true);
  }
  for (const relation of bundle.relations as { fromAssetId: string; toAssetId: string }[])
    expect(assets[relation.fromAssetId] && assets[relation.toAssetId]).toBeTruthy();
  for (const [id, evidence] of Object.entries(bundle.evidence as Record<string, Json>)) {
    expect(evidence.id).toBe(id);
    for (const subject of evidence.subjects as Json[]) {
      const asset = assets[subject.assetId as string];
      expect(asset).toBeDefined();
      expect(subject.sourceId).toBe(asset?.sourceId);
      expect(subject.sourceRevisionId).toBe(asset?.sourceRevisionId);
      expect(subject.contentDigest).toBe(asset?.contentDigest);
    }
  }
  const { bundleDigest, ...provenance } = bundle.provenance as { bundleDigest: string };
  expect(bundleDigest).toBe(sha256(canonical({ ...bundle, provenance })));
}

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
