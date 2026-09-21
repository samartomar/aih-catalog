import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATALOG_COLLECTIONS_ROOT_URL,
  type CatalogCollectionsV1,
  readCatalogCollectionsV1,
} from "../../src/content/catalog-collections-v1.js";
import {
  type CatalogContentV1,
  readCatalogContentV1,
} from "../../src/content/catalog-content-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const readJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

/** The real shipped index and collections, read from this checkout. */
const indexBytes = readFileSync(resolve(root, "defaults/catalog-index-v1.json"));
const index = readCatalogContentV1({ bytes: indexBytes }) as CatalogContentV1;
const shippedBytes = readFileSync(resolve(root, CATALOG_COLLECTIONS_ROOT_URL));
const shipped = JSON.parse(shippedBytes.toString("utf8"));
const inputs = readJson("defaults/catalog-collection-inputs-v1.json");

const bytesOf = (value: unknown) => Buffer.from(`${canonical(value)}\n`, "utf8");
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}
const read = (value: unknown) => readCatalogCollectionsV1({ bytes: bytesOf(value), index });
const clone = () => structuredClone(shipped);
// biome-ignore lint/suspicious/noExplicitAny: the tests mutate untyped published JSON.
type Doc = any;
const core = (value: Doc) =>
  value.collections.find((collection: { id: string }) => collection.id === "aih-core") as {
    current: { release: string };
    members: Doc[];
  };

async function generator() {
  // @ts-expect-error The maintenance generator is intentionally plain ESM JavaScript.
  return import("../../tools/generate-catalog-collections.mjs");
}

describe("published catalog collections", () => {
  it("is the current generator output for the committed inputs", async () => {
    const { generateCatalogCollections, serializeCatalogCollections } = await generator();
    expect(serializeCatalogCollections(generateCatalogCollections(root))).toBe(
      shippedBytes.toString("utf8"),
    );
  }, 30_000);

  it("names exactly one current Core collection, of that release's own entries", () => {
    const collections = readCatalogCollectionsV1({
      bytes: shippedBytes,
      index,
    }) as CatalogCollectionsV1;
    expect(collections).toBeDefined();
    expect(collections.collectedSourceTypes).toEqual(["aih"]);
    const owned = collections.collections.filter((c) => c.owner.package === "@aihq/core");
    expect(owned).toHaveLength(1);
    const [coreCollection] = owned;
    const release = coreCollection?.current.release;
    expect(release).toBe(inputs.collections[0].current.release);
    for (const member of coreCollection?.members ?? []) {
      const entry = index.entries.find((candidate) => candidate.entryId === member.entryId);
      // Member identity is the index's own, unchanged.
      expect(entry?.subject.subjectDigest).toBe(member.subjectDigest);
      expect(entry?.subject.source.type).toBe("aih");
      expect(entry?.subject.source.release).toBe(release);
    }
    // Older Core entries stay in the index for reference but are not current.
    const older = index.entries.filter(
      (entry) =>
        entry.subject.source.type === "aih" &&
        entry.subject.kind !== "profile" &&
        entry.subject.source.release !== release,
    );
    expect(older.length).toBeGreaterThan(0);
    const current = new Set(
      collections.collections.flatMap((c) => c.members.map((m) => m.entryId)),
    );
    for (const entry of older) expect(current.has(entry.entryId)).toBe(false);
  });

  it("keeps the independently versioned default profile out of the Core collection", () => {
    const collections = readCatalogCollectionsV1({ bytes: shippedBytes, index });
    const profile = collections?.collections.find((c) => c.id === "aih-default-profile");
    expect(profile?.owner.package).toBe("@aihq/catalog");
    expect(profile?.members.map((m) => m.entryId)).toEqual(["recipe.default"]);
    expect(core(shipped).members.map((m) => m.entryId)).not.toContain("recipe.default");
  });

  it("changes membership from the inputs alone, with no code edit", async () => {
    const { generateCatalogCollections } = await generator();
    const changed = structuredClone(inputs);
    changed.collections[0].current = { release: "0.6.1", origin: { kind: "catalog-authored" } };
    changed.collections[0].seedRoot = "workbench/aih-core-0.6.1/";
    const result = generateCatalogCollections(root, changed);
    const members = core(result).members;
    expect(members).toHaveLength(9);
    for (const member of members) {
      expect(index.entries.find((e) => e.entryId === member.entryId)?.subject.source.release).toBe(
        "0.6.1",
      );
    }
  }, 30_000);

  it.each([
    [
      "a member of another release",
      (value: Doc) => {
        value.collections[0].seedRoot = "workbench/aih/";
      },
      /not the current release/,
    ],
    [
      "a release with no Catalog seeds",
      (value: Doc) => {
        value.collections[0].current = { release: "9.9.9", origin: { kind: "catalog-authored" } };
        value.collections[0].seedRoot = "workbench/aih-core-9.9.9/";
      },
      /needs a Catalog content update/,
    ],
    [
      "an identified version that differs from the release",
      (value: Doc) => {
        value.collections[0].current.origin = {
          kind: "npm-dist-tag",
          name: "@aihq/core",
          tag: "latest",
          version: "0.6.1",
        };
      },
      /not the identified version/,
    ],
    [
      "an entry claimed by two collections",
      (value: Doc) => {
        value.collections[1].seedRoot = value.collections[0].seedRoot;
        delete value.collections[1].seeds;
        value.collections[1].current = value.collections[0].current;
        value.collections[1].owner = value.collections[0].owner;
      },
      /member of both/,
    ],
    [
      "an unknown field",
      (value: Doc) => {
        value.collections[0].latest = true;
      },
      /unknown field/,
    ],
  ])(
    "generation refuses %s",
    async (_label, mutate, message) => {
      const { generateCatalogCollections } = await generator();
      const changed = structuredClone(inputs);
      mutate(changed);
      expect(() => generateCatalogCollections(root, changed)).toThrow(message);
    },
    30_000,
  );

  it.each([
    ["a different index", (v: Doc) => (v.index.sha256 = "0".repeat(64))],
    [
      "a changed member digest",
      (v: Doc) => (core(v).members[0].subjectDigest = `sha256:${"1".repeat(64)}`),
    ],
    ["a relabelled release", (v: Doc) => (core(v).current.release = "0.6.1")],
    [
      "an entry of another release",
      (v: Doc) => {
        const older = index.entries.find(
          (e) => e.entryId === "agent.aih.governance-quality",
        ) as CatalogContentV1["entries"][number];
        core(v).members[0] = { entryId: older.entryId, subjectDigest: older.subject.subjectDigest };
      },
    ],
    ["a member listed twice", (v: Doc) => core(v).members.splice(1, 0, core(v).members[0])],
    ["an unknown field", (v: Doc) => (v.collections[0].latest = true)],
    ["an unknown format", (v: Doc) => (v.format = "aih-catalog-collections-x")],
    ["an uncollected source type", (v: Doc) => (v.collections[0].sourceType = "npm")],
  ])("reading refuses %s", (_label, mutate) => {
    const value = clone();
    mutate(value);
    expect(read(value)).toBeUndefined();
  });

  it("refuses non-canonical bytes and a byte order mark", () => {
    expect(read(clone())).toBeDefined();
    const pretty = Buffer.from(`${JSON.stringify(shipped, null, 2)}\n`, "utf8");
    expect(readCatalogCollectionsV1({ bytes: pretty, index })).toBeUndefined();
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), shippedBytes]);
    expect(readCatalogCollectionsV1({ bytes: bom, index })).toBeUndefined();
  });
});
