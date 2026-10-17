import { describe, expect, it } from "vitest";
import type { CatalogRelease } from "../../src/release/contracts.js";
import type { ItemComparison } from "../../src/release/reader.js";
import { compareReleases, readRelease } from "../../src/release/reader.js";
import { fixtureRelease, type Json, releaseBytes, sha256 } from "./fixtures.js";

type Document = ReturnType<typeof fixtureRelease> & {
  package: { name: string; version: string };
  items: { [key: string]: Json }[];
};

const document = (change: (doc: Document) => void = () => {}): Document => {
  const doc = fixtureRelease() as Document;
  change(doc);
  return doc;
};
function checked(doc: Document): CatalogRelease {
  const bytes = releaseBytes(doc);
  const read = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!read.valid) throw new Error(JSON.stringify(read.diagnostics));
  return read.release;
}
const withVersion = (version: string) =>
  checked(
    document((doc) => {
      doc.package.version = version;
    }),
  );
function value(first: CatalogRelease, second: CatalogRelease) {
  const result = compareReleases({ first, second });
  if (result.status !== "ok") throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
const order = (a: string, b: string) => value(withVersion(a), withVersion(b)).version;
const item = (items: readonly ItemComparison[], id: string) => items.find((i) => i.itemId === id);
const recipe = (doc: Document, id: string) =>
  (doc.items.find((i) => i.id === id) as { recipe: { sha256: string } }).recipe;

describe("version order", () => {
  it("orders by semantic-version precedence, second relative to first", () => {
    expect(order("1.2.0", "1.10.0").secondIs).toBe("newer");
    expect(order("2.0.0", "1.99.99").secondIs).toBe("older");
    expect(order("1.2.0", "1.2.0").secondIs).toBe("equal");
    expect(order("9007199254740993.0.0", "9007199254740992.0.0").secondIs).toBe("older");
  });

  it("orders pre-releases by the Semantic Versioning precedence chain", () => {
    const chain = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let index = 1; index < chain.length; index++) {
      expect(order(chain[index - 1] as string, chain[index] as string).secondIs).toBe("newer");
      expect(order(chain[index] as string, chain[index - 1] as string).secondIs).toBe("older");
    }
  });

  it("keeps unordered and invalid versions unknown instead of guessing", () => {
    expect(order("1.0.0+build.1", "1.0.0+build.2")).toEqual({
      first: "1.0.0+build.1",
      second: "1.0.0+build.2",
      secondIs: "unknown",
      reason: "build-metadata-only",
    });
    expect(order("1.0.0+same", "1.0.0+same").secondIs).toBe("equal");
    expect(order("1.0.0+build", "1.0.1").secondIs).toBe("newer");
    // The reader admits these exact versions; strict Semantic Versioning does not.
    for (const loose of ["1.0.0-01", "1.0.0-alpha.007"]) {
      expect(withVersion(loose).package.version).toBe(loose);
      expect(order("1.0.0", loose)).toEqual({
        first: "1.0.0",
        second: loose,
        secondIs: "unknown",
        reason: "version-not-semver",
      });
      expect(order(loose, "2.0.0").secondIs).toBe("unknown");
    }
  });
});

describe("item facts", () => {
  it("reports the same release as unchanged in every item", () => {
    const release = checked(document());
    const result = value(release, release);
    expect(result.sameRelease).toBe(true);
    expect(result.package).toBe("same-package");
    expect(result.version.secondIs).toBe("equal");
    expect(result.items.map((i) => [i.itemId, i.presence])).toEqual([
      ["alpha", "in-both"],
      ["beta", "in-both"],
    ]);
    for (const entry of result.items) {
      expect(entry).toMatchObject({
        content: "unchanged",
        recipe: "unchanged",
        materials: "unchanged",
        record: "unchanged",
      });
    }
  });

  it("reports changed content even when the versions are equal", () => {
    const first = checked(document());
    const second = checked(
      document((doc) => {
        recipe(doc, "beta").sha256 = sha256("beta-recipe-2");
        (doc.items[0] as { label: string }).label = "Alpha renamed";
      }),
    );
    const result = value(first, second);
    expect(result.sameRelease).toBe(false);
    expect(result.version.secondIs).toBe("equal");
    expect(item(result.items, "beta")).toMatchObject({
      presence: "in-both",
      content: "changed",
      recipe: "changed",
      materials: "unchanged",
      record: "changed",
      first: { recipeSha256: sha256("beta-recipe") },
      second: { recipeSha256: sha256("beta-recipe-2") },
    });
    // A descriptive-only change alters the item record, not its content.
    expect(item(result.items, "alpha")).toMatchObject({
      content: "unchanged",
      record: "changed",
    });
  });

  it("compares the material digest set and ignores material IDs and paths", () => {
    const first = checked(document());
    const moved = checked(
      document((doc) => {
        const alpha = doc.items[0] as { materials: { id: string; path: string }[] };
        alpha.materials[1] = {
          ...(alpha.materials[1] as { id: string; path: string }),
          id: "skill-md",
          path: "release/materials/alpha/moved.md",
        };
      }),
    );
    expect(item(value(first, moved).items, "alpha")).toMatchObject({
      content: "unchanged",
      materials: "unchanged",
      record: "changed",
    });
    const changed = checked(
      document((doc) => {
        const alpha = doc.items[0] as { materials: { sha256: string }[] };
        (alpha.materials[1] as { sha256: string }).sha256 = sha256("alpha-2");
      }),
    );
    const fact = item(value(first, changed).items, "alpha");
    expect(fact).toMatchObject({ content: "changed", recipe: "unchanged", materials: "changed" });
    expect(fact?.presence === "in-both" && fact.second.materialSha256).toEqual(
      [sha256("alpha-2"), sha256("license")].sort(),
    );
  });

  it("counts identical material bytes once in the digest set", () => {
    const first = checked(document());
    const duplicated = checked(
      document((doc) => {
        const alpha = doc.items[0] as { materials: { [key: string]: Json }[] };
        alpha.materials.push({
          id: "skill-copy",
          path: "release/materials/alpha/copy.md",
          sha256: sha256("alpha"),
          byteLength: 157,
        });
      }),
    );
    expect(duplicated.items[0]?.materials).toHaveLength(3);
    const fact = item(value(first, duplicated).items, "alpha");
    expect(fact).toMatchObject({ content: "unchanged", materials: "unchanged", record: "changed" });
    expect(fact?.presence === "in-both" && fact.second.materialSha256).toEqual(
      [sha256("alpha"), sha256("license")].sort(),
    );
  });

  it("reports input, dependency, target, scope and kind changes as record-only", () => {
    const first = checked(document());
    const changes: ((doc: Document) => void)[] = [
      (doc) => {
        (doc.items[0] as { inputs: { [key: string]: Json } }).inputs.extra = {
          type: "boolean",
          required: false,
        };
      },
      (doc) => {
        (doc.items[1] as { dependencies: { requires: Json[] } }).dependencies.requires = [];
      },
      (doc) => {
        (doc.items[0] as { targets: Json[] }).targets = [{ kind: "executable", name: "git" }];
      },
      (doc) => {
        (doc.items[0] as { scopes: Json[] }).scopes = ["project", "user"];
      },
      (doc) => {
        (doc.items[0] as { kind: string }).kind = "rule";
      },
    ];
    for (const change of changes) {
      const result = value(first, checked(document(change)));
      const changed = result.items.filter(
        (entry) => entry.presence === "in-both" && entry.record === "changed",
      );
      expect(changed).toHaveLength(1);
      expect(changed[0]).toMatchObject({ content: "unchanged", recipe: "unchanged" });
    }
  });

  it("reports partially overlapping releases item by item", () => {
    const first = checked(document());
    const second = checked(
      document((doc) => {
        doc.package.version = "1.3.0-rc.1";
        const beta: { [key: string]: Json } = {
          ...(doc.items[1] as { [key: string]: Json }),
          dependencies: { requires: [], optional: [], conflicts: [] },
        };
        const gamma = {
          ...beta,
          id: "gamma",
          label: "Gamma",
          recipe: { ...(beta.recipe as { [key: string]: Json }), id: "gamma" },
        };
        doc.items = [beta, gamma];
      }),
    );
    const result = value(first, second);
    expect(result.version.secondIs).toBe("newer");
    expect(result.items.map((i) => [i.itemId, i.presence])).toEqual([
      ["alpha", "only-in-first"],
      ["beta", "in-both"],
      ["gamma", "only-in-second"],
    ]);
    const alpha = item(result.items, "alpha");
    expect(alpha).toEqual({
      itemId: "alpha",
      presence: "only-in-first",
      first: {
        itemSha256: first.items[0]?.itemSha256,
        recipeSha256: sha256("alpha-recipe"),
        materialSha256: [sha256("alpha"), sha256("license")].sort(),
      },
    });
    expect(item(result.items, "beta")).toMatchObject({ content: "unchanged" });
    expect(Object.isFrozen(result.items)).toBe(true);
  });

  it("treats different packages as unrelated and compares no items", () => {
    const first = checked(document());
    const second = checked(
      document((doc) => {
        doc.package.name = "@example/other";
        doc.package.version = "9.0.0";
      }),
    );
    expect(value(first, second)).toEqual({
      first: { sha256: first.sha256, package: { name: "@example/catalog", version: "1.2.0" } },
      second: { sha256: second.sha256, package: { name: "@example/other", version: "9.0.0" } },
      sameRelease: false,
      package: "different-package",
      version: {
        first: "1.2.0",
        second: "9.0.0",
        secondIs: "unknown",
        reason: "different-package",
      },
      items: [],
    });
  });
});

describe("boundaries", () => {
  it("refuses values that are not reader handles or an exact request", () => {
    const release = checked(document());
    const clone = JSON.parse(JSON.stringify(release)) as CatalogRelease;
    const forged = compareReleases({ first: release, second: clone });
    expect(forged).toEqual({
      status: "refused",
      diagnostics: [
        {
          code: "INPUT_INVALID",
          path: "/second",
          message: "Expected a release view returned by readRelease.",
        },
      ],
    });
    for (const request of [
      undefined,
      null,
      [],
      { first: release },
      { first: release, second: release, extra: true },
    ]) {
      const result = compareReleases(request as never);
      expect(result.status).toBe("refused");
      expect(result.diagnostics[0]?.path).toBe("");
    }
  });
});
