import { describe, expect, it } from "vitest";
import type { CatalogRelease } from "../../src/release/contracts.js";
import { getItem, listItems, readRelease } from "../../src/release/reader.js";
import { canonical, fixtureRelease, releaseBytes, sha256 } from "./fixtures.js";

function checked(document: unknown = fixtureRelease()): CatalogRelease {
  const bytes = releaseBytes(document);
  const result = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
  return result.release;
}

describe("listItems and getItem", () => {
  it("lists items with identities over each item's canonical record", () => {
    const document = fixtureRelease();
    const items = listItems(checked(document));
    expect(items.map((item) => [item.id, item.itemSha256])).toEqual(
      (document.items as { id: string }[]).map((item) => [item.id, sha256(canonical(item))]),
    );
  });

  it("changes one item's identity without changing an unrelated item", () => {
    const before = listItems(checked());
    const changed = fixtureRelease();
    (changed.items as { label: string }[])[1]!.label = "Beta renamed";
    const after = listItems(checked(changed));
    expect(after[0]?.itemSha256).toBe(before[0]?.itemSha256);
    expect(after[1]?.itemSha256).not.toBe(before[1]?.itemSha256);
  });

  it("gets one item and names a missing one", () => {
    const release = checked();
    const found = getItem(release, "beta");
    expect(found.found && found.item.dependencies.requires).toEqual([{ itemId: "alpha" }]);
    const missing = getItem(release, "gamma");
    expect(missing.found).toBe(false);
    if (missing.found) return;
    expect(missing.diagnostics[0]).toMatchObject({ reason: "item-not-found", itemId: "gamma" });
  });

  it("normalizes an absent dependency list only to empty lists", () => {
    const document = fixtureRelease();
    (document.items as { dependencies: unknown }[])[0]!.dependencies = {};
    const alpha = getItem(checked(document), "alpha");
    expect(alpha.found && alpha.item.dependencies).toEqual({
      requires: [],
      optional: [],
      conflicts: [],
    });
  });

  it("returns immutable views and accepts only views it produced", () => {
    const release = checked();
    expect(Object.isFrozen(release)).toBe(true);
    expect(Object.isFrozen(release.items[0]?.inputs)).toBe(true);
    expect(() => {
      (release.items[0] as { label: string }).label = "changed";
    }).toThrow(TypeError);
    const forged = JSON.parse(JSON.stringify(release)) as CatalogRelease;
    expect(() => listItems(forged)).toThrow(TypeError);
    expect(() => getItem(forged, "alpha")).toThrow(TypeError);
  });
});

describe("readRelease", () => {
  it("returns a checked release whose identity is the exact byte hash", () => {
    const bytes = releaseBytes(fixtureRelease());
    const result = readRelease(bytes, { expectedSha256: sha256(bytes) });
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.release.sha256).toBe(sha256(bytes));
    expect(result.release.byteLength).toBe(bytes.byteLength);
    expect(result.release.package).toEqual({ name: "@example/catalog", version: "1.2.0" });
    expect(result.release.items.map((item) => item.id)).toEqual(["alpha", "beta"]);
  });

  it("refuses bytes that do not match the caller's expected hash", () => {
    const bytes = releaseBytes(fixtureRelease());
    const result = readRelease(bytes, { expectedSha256: sha256("other") });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => d.reason)).toEqual(["release-integrity-mismatch"]);
  });
});
