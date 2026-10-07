import { createHash } from "node:crypto";
import { expect } from "vitest";

export type Json = Record<string, unknown>;
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
export function assertCoreAdmitsV1(bundle: Json, sourceId: string, pin: string): void {
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
