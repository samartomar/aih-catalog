import { describe, expect, it } from "vitest";
import type { CatalogRelease, Json, SelectionRequest } from "../../src/release/contracts.js";
import { getItem, readRelease, validateSelectionSet } from "../../src/release/reader.js";
import { fixtureRelease, releaseBytes, sha256 } from "./fixtures.js";

type Item = { [key: string]: Json };
const read = (document: unknown): CatalogRelease => {
  const bytes = releaseBytes(document);
  const result = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
  return result.release;
};

/** alpha; beta requires alpha and suggests gamma; gamma conflicts with delta; delta. */
function primaryDocument() {
  const document = fixtureRelease();
  const items = document.items as Item[];
  const simple = (id: string, dependencies: Json): Item => ({
    ...structuredClone(items[0] as Item),
    id,
    label: id,
    recipe: { ...(items[0]?.recipe as Item), id, path: `release/recipes/${id}.json` },
    dependencies,
  });
  (items[1] as Item).dependencies = {
    requires: [{ itemId: "alpha" }],
    optional: [{ itemId: "gamma" }],
  };
  items.push(simple("delta", {}), simple("gamma", { conflicts: [{ itemId: "delta" }] }));
  return document;
}

const primary = read(primaryDocument());
const itemRef = (release: CatalogRelease, itemId: string) => {
  const found = getItem(release, itemId);
  if (!found.found) throw new Error(itemId);
  return { releaseSha256: release.sha256, itemId, itemSha256: found.item.itemSha256 };
};
const select = (
  id: string,
  itemId: string,
  configuration: Record<string, Json> = {},
  release = primary,
): SelectionRequest => ({
  id,
  item: itemRef(release, itemId),
  configuration,
});
const beta = (id = "b") => select(id, "beta", { serverUrl: "https://mcp.example.org" });

/** A second release whose item requires primary's alpha through an exact cross-release reference. */
function secondary(target = primary, pinnedItemSha256?: string) {
  const document = fixtureRelease();
  document.package = { name: "@example/other", version: "2.0.0" };
  const items = document.items as Item[];
  const alpha = getItem(target, "alpha");
  if (!alpha.found) throw new Error("alpha");
  document.items = [
    {
      ...(items[0] as Item),
      id: "epsilon",
      recipe: {
        ...(items[0]?.recipe as Item),
        id: "epsilon",
        path: "release/recipes/epsilon.json",
      },
      dependencies: {
        requires: [
          {
            release: {
              source: { kind: "local", input: "primary" },
              manifest: {
                path: "release/release.json",
                sha256: target.sha256,
                byteLength: target.byteLength,
              },
            },
            itemId: "alpha",
            itemSha256: pinnedItemSha256 ?? alpha.item.itemSha256,
          },
        ],
      },
    },
  ];
  return read(document);
}

const reasons = (result: { diagnostics: readonly { reason: string }[] }) =>
  result.diagnostics.map((d) => d.reason);

describe("validateSelectionSet", () => {
  it("returns exact requires for every selection and leaves optional items unselected", () => {
    const result = validateSelectionSet({
      releases: { [primary.sha256]: primary },
      selections: [select("a", "alpha"), beta()],
    });
    expect(result.valid).toBe(true);
    expect(result.requiresBySelectionId).toEqual({ a: [], b: ["a"] });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "SUGGESTION",
        reason: "optional-unselected",
        blocking: false,
        selectionId: "b",
        itemId: "gamma",
      }),
    ]);
  });

  it("maps a shared selected dependency for each dependent", () => {
    const result = validateSelectionSet({
      releases: { [primary.sha256]: primary },
      selections: [select("shared", "alpha"), beta("b1"), beta("b2")],
    });
    expect(result.requiresBySelectionId).toEqual({ shared: [], b1: ["shared"], b2: ["shared"] });
  });

  it("diagnoses a required dependency that was not selected instead of selecting it", () => {
    const result = validateSelectionSet({
      releases: { [primary.sha256]: primary },
      selections: [beta()],
    });
    expect(result.valid).toBe(false);
    expect(result.requiresBySelectionId).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        reason: "dependency-missing",
        selectionId: "b",
        itemId: "alpha",
        blocking: true,
      }),
    );
  });

  it("diagnoses ambiguous multiple matches instead of choosing one", () => {
    const result = validateSelectionSet({
      releases: { [primary.sha256]: primary },
      selections: [select("a1", "alpha"), select("a2", "alpha"), beta()],
    });
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain("dependency-ambiguous");
  });

  it("diagnoses selected conflicts", () => {
    const result = validateSelectionSet({
      releases: { [primary.sha256]: primary },
      selections: [select("g", "gamma"), select("d", "delta")],
    });
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ reason: "conflict-selected", selectionId: "g", itemId: "delta" }),
    );
  });

  it("checks ordinary configuration per selection", () => {
    const result = validateSelectionSet({
      releases: { [primary.sha256]: primary },
      selections: [select("a", "alpha"), select("b", "beta", {})],
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        reason: "input-required",
        selectionId: "b",
        path: "/selections/1/configuration/serverUrl",
      }),
    );
  });

  it("resolves an exact cross-release reference only against the supplied release", () => {
    const other = secondary();
    const selections = [select("e", "epsilon", {}, other), select("a", "alpha")];
    const complete = validateSelectionSet({
      releases: { [primary.sha256]: primary, [other.sha256]: other },
      selections,
    });
    expect(complete.requiresBySelectionId).toEqual({ e: ["a"], a: [] });
    const missing = validateSelectionSet({
      releases: { [other.sha256]: other },
      selections: [selections[0]!],
    });
    expect(missing.diagnostics).toContainEqual(
      expect.objectContaining({ reason: "dependency-release-missing", selectionId: "e" }),
    );
  });

  it("does not satisfy a same-release reference with an item from another release", () => {
    const lookalike = read({
      ...fixtureRelease(),
      package: { name: "@example/fork", version: "1.2.0" },
    });
    const result = validateSelectionSet({
      releases: { [primary.sha256]: primary, [lookalike.sha256]: lookalike },
      selections: [select("a", "alpha", {}, lookalike), beta()],
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ reason: "dependency-missing", selectionId: "b" }),
    );
  });

  it("diagnoses unresolved cross-release item identities", () => {
    const changed = primaryDocument();
    ((changed.items as Item[])[0] as Item).label = "Alpha, changed";
    const other = secondary(primary);
    const changedPrimary = read(changed);
    // The dependency pins the original alpha identity; a release with these exact bytes is absent.
    const result = validateSelectionSet({
      releases: { [changedPrimary.sha256]: changedPrimary, [other.sha256]: other },
      selections: [select("e", "epsilon", {}, other), select("a", "alpha", {}, changedPrimary)],
    });
    expect(reasons(result)).toContain("dependency-release-missing");
    const stale = secondary(primary, sha256("an older alpha record"));
    const unresolved = validateSelectionSet({
      releases: { [primary.sha256]: primary, [stale.sha256]: stale },
      selections: [select("e", "epsilon", {}, stale), select("a", "alpha")],
    });
    expect(unresolved.diagnostics).toContainEqual(
      expect.objectContaining({
        reason: "dependency-unresolved",
        selectionId: "e",
        itemId: "alpha",
      }),
    );
  });

  it.each([
    [
      "an unknown release",
      (s: SelectionRequest) => ({ ...s, item: { ...s.item, releaseSha256: sha256("x") } }),
      "release-missing",
    ],
    [
      "an unknown item",
      (s: SelectionRequest) => ({ ...s, item: { ...s.item, itemId: "zeta" } }),
      "item-not-found",
    ],
    [
      "a stale item identity",
      (s: SelectionRequest) => ({ ...s, item: { ...s.item, itemSha256: sha256("old") } }),
      "item-sha256-mismatch",
    ],
    [
      "an invalid selection ID",
      (s: SelectionRequest) => ({ ...s, id: "not valid" }),
      "invalid-selection-id",
    ],
  ] as [
    string,
    (s: SelectionRequest) => SelectionRequest,
    string,
  ][])("diagnoses %s", (_name, change, reason) => {
    const result = validateSelectionSet({
      releases: { [primary.sha256]: primary },
      selections: [change(select("a", "alpha"))],
    });
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain(reason);
  });

  it("refuses duplicate selection IDs, mis-keyed releases and unchecked views", () => {
    expect(
      reasons(
        validateSelectionSet({
          releases: { [primary.sha256]: primary },
          selections: [select("a", "alpha"), select("a", "delta")],
        }),
      ),
    ).toContain("duplicate-selection-id");
    expect(
      reasons(validateSelectionSet({ releases: { [sha256("k")]: primary }, selections: [] })),
    ).toContain("release-key-mismatch");
    const forged = JSON.parse(JSON.stringify(primary)) as CatalogRelease;
    expect(
      reasons(validateSelectionSet({ releases: { [forged.sha256]: forged }, selections: [] })),
    ).toContain("release-unchecked");
  });
});
