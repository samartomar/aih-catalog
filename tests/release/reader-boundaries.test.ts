import { describe, expect, it } from "vitest";
import { configureItem, readRelease, validateSelectionSet } from "../../src/release/reader.js";
import { fixtureRelease, type Json, releaseBytes, sha256 } from "./fixtures.js";

describe("release admission at byte boundaries", () => {
  it("preserves a large descriptive array within the release byte and depth limits", () => {
    const document = fixtureRelease();
    document.metadata = { samples: Array.from({ length: 200_000 }, () => 0) };
    const bytes = releaseBytes(document);
    expect(bytes.byteLength).toBeLessThan(16 * 1024 * 1024);
    const checked = readRelease(bytes, { expectedSha256: sha256(bytes) });
    expect(checked.valid).toBe(true);
    if (checked.valid)
      expect(((checked.release.metadata as Record<string, Json>).samples as Json[]).length).toBe(
        200_000,
      );
  });

  it.each([
    ["a lone high surrogate value", { text: "\ud800" }],
    ["a lone low surrogate value", { text: "\udc00" }],
    ["a lone surrogate key", { "\ud800": "value" }],
  ])("refuses malformed Unicode in %s with a diagnostic", (_name, metadata) => {
    const bytes = releaseBytes({ ...fixtureRelease(), metadata });
    const checked = readRelease(bytes, { expectedSha256: sha256(bytes) });
    expect(checked.valid).toBe(false);
    expect(checked.diagnostics).toEqual([
      expect.objectContaining({ reason: "malformed-unicode", blocking: true }),
    ]);
  });
});

it.each([
  ["malformed Unicode", "string", "\ud800"],
  ["non-NFC text", "string", "e\u0301"],
  ["an unsafe integer", "number", 9_007_199_254_740_992],
])("refuses %s in ordinary configuration", (_label, type, value) => {
  const document = fixtureRelease();
  const item = (document.items as Record<string, Json>[])[0];
  if (!item) throw new Error("fixture lacks an item");
  item.inputs = { setting: { type: type as string, required: true } };
  const bytes = releaseBytes(document);
  const checked = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!checked.valid) throw new Error(JSON.stringify(checked.diagnostics));
  const configured = configureItem({
    release: checked.release,
    itemId: "alpha",
    configuration: { setting: value as Json },
    materialSource: { kind: "local", input: "catalog" },
  });
  expect(configured.valid).toBe(false);
  expect(configured.diagnostics).toContainEqual(expect.objectContaining({ reason: "input-value" }));
});

it.each([
  "https://example.test:8443/a.tgz",
  "https://user:password@example.test/a.tgz",
  "https://example.test/a.tgz#fragment",
])("refuses an archive URL outside Core's shared source grammar: %s", (url) => {
  const bytes = releaseBytes(fixtureRelease());
  const checked = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!checked.valid) throw new Error(JSON.stringify(checked.diagnostics));
  const configured = configureItem({
    release: checked.release,
    itemId: "alpha",
    configuration: {},
    materialSource: { kind: "archive", url, sha256: sha256("archive"), byteLength: 512 },
  });
  expect(configured.valid).toBe(false);
  expect(configured.diagnostics).toContainEqual(
    expect.objectContaining({ reason: "invalid-source" }),
  );
});

describe("unselected advisory references", () => {
  it.each([
    "optional",
    "conflicts",
  ])("keeps a valid set when the %s release is unselected and unsupplied", (relation) => {
    const document = fixtureRelease();
    const item = (document.items as Record<string, Json>[])[0];
    if (!item) throw new Error("fixture lacks an item");
    document.items = [item];
    item.dependencies = {
      [relation]: [
        {
          release: {
            source: { kind: "local", input: "suggested" },
            manifest: {
              path: "release/release.json",
              sha256: sha256("unsupplied"),
              byteLength: 512,
            },
          },
          itemId: "optional-skill",
          itemSha256: sha256("optional"),
        },
      ],
    };
    const bytes = releaseBytes(document);
    const checked = readRelease(bytes, { expectedSha256: sha256(bytes) });
    if (!checked.valid) throw new Error(JSON.stringify(checked.diagnostics));
    const selected = checked.release.items[0];
    if (!selected) throw new Error("checked fixture lacks an item");
    const result = validateSelectionSet({
      releases: { [checked.release.sha256]: checked.release },
      selections: [
        {
          id: "chosen",
          item: {
            releaseSha256: checked.release.sha256,
            itemId: selected.id,
            itemSha256: selected.itemSha256,
          },
          configuration: {},
        },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.requiresBySelectionId).toEqual({ chosen: [] });
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.every((diagnostic) => !diagnostic.blocking)).toBe(true);
  });
});

it("maps repeated references to one unique Core selection dependency", () => {
  const document = fixtureRelease();
  const items = document.items as Record<string, Json>[];
  const dependent = items[1];
  if (!dependent) throw new Error("fixture lacks a dependent item");
  dependent.dependencies = { requires: [{ itemId: "alpha" }, { itemId: "alpha" }] };
  const bytes = releaseBytes(document);
  const checked = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!checked.valid) throw new Error(JSON.stringify(checked.diagnostics));
  const selected = validateSelectionSet({
    releases: { [checked.release.sha256]: checked.release },
    selections: checked.release.items.map((item) => ({
      id: item.id,
      item: { releaseSha256: checked.release.sha256, itemId: item.id, itemSha256: item.itemSha256 },
      configuration: (item.id === "beta" ? { serverUrl: "https://example.test" } : {}) as Record<
        string,
        Json
      >,
    })),
  });
  expect(selected.valid).toBe(true);
  expect(selected.requiresBySelectionId).toEqual({ alpha: [], beta: ["alpha"] });
});
