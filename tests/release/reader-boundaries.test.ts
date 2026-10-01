import { describe, expect, it } from "vitest";
import { readRelease, validateSelectionSet } from "../../src/release/reader.js";
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
