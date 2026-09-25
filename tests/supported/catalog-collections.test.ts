import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CATALOG_COLLECTIONS_ROOT_URL,
  type CatalogCollectionsV1,
  readCatalogCollectionsV1,
  readCatalogCollectionsV1Result,
} from "../../src/content/catalog-collections-v1.js";
import {
  type CatalogContentV1,
  readCatalogContentV1,
  readCatalogContentV1Result,
} from "../../src/content/catalog-content-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const readJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

/** The real shipped index and collections, read from this checkout. */
const indexBytes = readFileSync(resolve(root, "defaults/catalog-index-v1.json"));
const index = readCatalogContentV1({ bytes: indexBytes }) as CatalogContentV1;
const shippedBytes = readFileSync(resolve(root, CATALOG_COLLECTIONS_ROOT_URL));
const shipped = JSON.parse(shippedBytes.toString("utf8"));
const inputs = readJson("defaults/catalog-collection-inputs-v1.json");
/**
 * Inputs naming a Core collection. The shipped Catalog names none until the Core 0.7.0 content
 * lands (D57), so Core-collection behavior is exercised on the synthetic root below.
 */
const coreInputs = {
  ...inputs,
  collections: [
    {
      id: "aih-core",
      owner: { package: "@aihq/core" },
      sourceType: "aih",
      current: {
        release: "0.6.2",
        origin: {
          kind: "package-file",
          name: "@aihq/core",
          version: "0.6.2",
          sha256: "0".repeat(64),
        },
      },
      seedRoot: "workbench/aih-core-0.6.2/",
    },
    ...inputs.collections,
  ],
};

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

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const digest = (domain: string, value: unknown) =>
  `sha256:${sha256(`${domain}\0${canonical(value)}`)}`;

/**
 * A synthetic Catalog root whose index carries three Core releases (0.6.0 under workbench/aih/,
 * 0.6.1 and 0.6.2 under workbench/aih-core-<release>/) and the default profile, so membership
 * changes and cross-release refusals are exercised without superseded seeds in the shipped
 * Catalog. The index is the real generator's output over these seeds.
 */
async function syntheticCatalog() {
  const base = mkdtempSync(join(tmpdir(), "aih-catalog-collections-"));
  temporaryRoots.push(base);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(base, path)), { recursive: true });
    writeFileSync(join(base, path), text);
  };
  write("package.json", JSON.stringify({ name: "@aihq/catalog", version: "0.0.0" }));
  const seeds: string[] = [];
  const seed = (seedPath: string, entryId: string, id: string, kind: string, release: string) => {
    // Seed-relative artifact and evidence paths; the default profile's seed sits in defaults/.
    const local = dirname(seedPath) === "." ? "profile/" : "";
    const directory = dirname(seedPath) === "." ? "profile" : dirname(seedPath);
    const profile = canonical({ entryId, release });
    const source = { type: "aih", release, revision: `sha256:${sha256(profile)}` };
    const sourceDigest = digest("aih-governance-decision-source/v2", source);
    const subjectDigest = digest("aih-governance-decision-subject/v2", { id, kind, sourceDigest });
    for (const name of ["closure", "prose", "recipe"])
      write(`defaults/${directory}/artifacts/${name}.json`, canonical({ name }));
    write(`defaults/${directory}/artifacts/profile.json`, profile);
    write(
      `defaults/${directory}/evidence/report.json`,
      canonical({
        attestor: "attestor:fixture",
        format: "aih-supported-evidence/v2",
        id: "report",
        kind: "report",
        subjectDigest,
        summary: "Synthetic report.",
      }),
    );
    write(
      `defaults/${seedPath}`,
      canonical({
        artifacts: Object.fromEntries(
          ["closure", "profile", "prose", "recipe"].map((name) => [
            name,
            `${local}artifacts/${name}.json`,
          ]),
        ),
        capabilities: { commands: [], egress: [], hooks: [], mcpTools: [], permissions: [] },
        entryId,
        platforms: [{ architecture: "amd64", os: "linux" }],
        qualification: {
          findings: [],
          gaps: [],
          report: `${local}evidence/report.json`,
          rights: [],
        },
        subject: { id, kind, source },
      }),
    );
    seeds.push(seedPath);
  };
  seed("default-catalog-v2.json", "recipe.default", "default-profile", "profile", "1.0.0");
  seed(
    "workbench/aih/agent.aih.governance-quality/seed.json",
    "agent.aih.governance-quality",
    "governance-quality",
    "agent",
    "0.6.0",
  );
  for (const release of ["0.6.1", "0.6.2"]) {
    const suffix = `core-${release.replaceAll(".", "-")}`;
    for (const [kind, id] of [
      ["agent", "governance-quality"],
      ["mcp", "github"],
    ] as const)
      seed(
        `workbench/aih-core-${release}/${kind}.aih.${id}.${suffix}/seed.json`,
        `${kind}.aih.${id}.${suffix}`,
        id,
        kind,
        release,
      );
  }
  write(
    "defaults/default-catalog-seed-manifest-v2.json",
    canonical({ format: "aih-supported-candidate-seed-manifest", seeds: seeds.sort(), version: 1 }),
  );
  // @ts-expect-error The maintenance generator is intentionally plain ESM JavaScript.
  const indexGenerator = await import("../../tools/generate-catalog-index.mjs");
  const read = readCatalogContentV1Result({
    bytes: Buffer.from(
      indexGenerator.serializeCatalogIndex(indexGenerator.generateCatalogIndex(base)),
    ),
  });
  if (read.state !== "read") throw new Error(`synthetic index refused: ${JSON.stringify(read)}`);
  const syntheticIndex = read.content;
  return { root: base, index: syntheticIndex };
}

/** The collection view generated over the synthetic root with a Core collection, and its reader. */
async function syntheticView() {
  const { generateCatalogCollections } = await generator();
  const synthetic = await syntheticCatalog();
  const view = generateCatalogCollections(synthetic.root, coreInputs);
  return {
    ...synthetic,
    clone: () => structuredClone(view),
    read: (candidate: unknown) =>
      readCatalogCollectionsV1({ bytes: bytesOf(candidate), index: synthetic.index }),
  };
}

describe("published catalog collections", () => {
  it("is the current generator output for the committed inputs", async () => {
    const { generateCatalogCollections, serializeCatalogCollections } = await generator();
    expect(serializeCatalogCollections(generateCatalogCollections(root))).toBe(
      shippedBytes.toString("utf8"),
    );
  }, 30_000);

  it("names no Core collection and indexes no Core entry until the Core 0.7.0 content lands", () => {
    const collections = readCatalogCollectionsV1({
      bytes: shippedBytes,
      index,
    }) as CatalogCollectionsV1;
    expect(collections).toBeDefined();
    expect(collections.collectedSourceTypes).toEqual(["aih"]);
    expect(collections.collections.map((c) => c.id)).toEqual(["aih-default-profile"]);
    expect(collections.collections.filter((c) => c.owner.package === "@aihq/core")).toEqual([]);
    // The 0.6.2 seeds are deleted (D57); the only aih entry left is the default profile.
    expect(
      index.entries
        .filter((entry) => entry.subject.source.type === "aih")
        .map((entry) => entry.entryId),
    ).toEqual(["recipe.default"]);
  });

  it("names exactly one Core collection, of that release's own entries, when the inputs state one", async () => {
    const synthetic = await syntheticView();
    const collections = synthetic.read(synthetic.clone()) as CatalogCollectionsV1;
    expect(collections).toBeDefined();
    const owned = collections.collections.filter((c) => c.owner.package === "@aihq/core");
    expect(owned).toHaveLength(1);
    const release = owned[0]?.current.release;
    expect(release).toBe("0.6.2");
    for (const member of owned[0]?.members ?? []) {
      const entry = synthetic.index.entries.find(
        (candidate) => candidate.entryId === member.entryId,
      );
      // Member identity is the index's own, unchanged.
      expect(entry?.subject.subjectDigest).toBe(member.subjectDigest);
      expect(entry?.subject.source.type).toBe("aih");
      expect(entry?.subject.source.release).toBe(release);
    }
    // Older releases stay in the index for reference and are members of no collection.
    const current = new Set(
      collections.collections.flatMap((c) => c.members.map((m) => m.entryId)),
    );
    const older = synthetic.index.entries.filter(
      (entry) =>
        entry.subject.source.type === "aih" &&
        entry.subject.kind !== "profile" &&
        entry.subject.source.release !== release,
    );
    expect(older).toHaveLength(3);
    for (const entry of older) expect(current.has(entry.entryId)).toBe(false);
  }, 30_000);

  it("keeps the independently versioned default profile out of the Core collection", async () => {
    const shippedProfile = readCatalogCollectionsV1({
      bytes: shippedBytes,
      index,
    })?.collections.find((c) => c.id === "aih-default-profile");
    expect(shippedProfile?.owner.package).toBe("@aihq/catalog");
    expect(shippedProfile?.members.map((m) => m.entryId)).toEqual(["recipe.default"]);
    const synthetic = await syntheticView();
    expect(core(synthetic.clone()).members.map((m) => m.entryId)).not.toContain("recipe.default");
  }, 30_000);

  it("changes membership from the inputs alone, with no code edit", async () => {
    const { generateCatalogCollections } = await generator();
    const synthetic = await syntheticCatalog();
    const current = core(generateCatalogCollections(synthetic.root, coreInputs)).members;
    expect(current.map((member: { entryId: string }) => member.entryId)).toEqual([
      "agent.aih.governance-quality.core-0-6-2",
      "mcp.aih.github.core-0-6-2",
    ]);
    const changed = structuredClone(coreInputs);
    changed.collections[0].current = { release: "0.6.1", origin: { kind: "catalog-authored" } };
    changed.collections[0].seedRoot = "workbench/aih-core-0.6.1/";
    const members = core(generateCatalogCollections(synthetic.root, changed)).members;
    expect(members).toHaveLength(2);
    for (const member of members) {
      expect(
        synthetic.index.entries.find((e) => e.entryId === member.entryId)?.subject.source.release,
      ).toBe("0.6.1");
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
      const synthetic = await syntheticCatalog();
      const changed = structuredClone(coreInputs);
      mutate(changed);
      expect(() => generateCatalogCollections(synthetic.root, changed)).toThrow(message);
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
    ["a member listed twice", (v: Doc) => core(v).members.splice(1, 0, core(v).members[0])],
    ["an unknown field", (v: Doc) => (v.collections[0].latest = true)],
    ["an unknown format", (v: Doc) => (v.format = "aih-catalog-collections-x")],
    ["an uncollected source type", (v: Doc) => (v.collections[0].sourceType = "npm")],
  ])(
    "reading refuses %s",
    async (_label, mutate) => {
      const synthetic = await syntheticView();
      expect(synthetic.read(synthetic.clone())).toBeDefined();
      const value = synthetic.clone();
      mutate(value);
      expect(synthetic.read(value)).toBeUndefined();
    },
    30_000,
  );

  it("reading refuses an entry of another release", async () => {
    const synthetic = await syntheticView();
    const value = synthetic.clone();
    const readSynthetic = synthetic.read;
    expect(readSynthetic(value)).toBeDefined();
    const older = synthetic.index.entries.find(
      (e) => e.entryId === "agent.aih.governance-quality.core-0-6-1",
    ) as CatalogContentV1["entries"][number];
    core(value).members[0] = { entryId: older.entryId, subjectDigest: older.subject.subjectDigest };
    expect(readSynthetic(value)).toBeUndefined();
  }, 30_000);

  it("refuses non-canonical bytes and a byte order mark", () => {
    expect(read(clone())).toBeDefined();
    const pretty = Buffer.from(`${JSON.stringify(shipped, null, 2)}\n`, "utf8");
    expect(readCatalogCollectionsV1({ bytes: pretty, index })).toBeUndefined();
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), shippedBytes]);
    expect(readCatalogCollectionsV1({ bytes: bom, index })).toBeUndefined();
  });

  it("refuses an owner outside the consumer's stated owners, and only when it states them", async () => {
    const synthetic = await syntheticView();
    const evil = synthetic.clone();
    (core(evil) as Doc).owner.package = "@evil/pkg";
    (core(evil).current as Doc).origin.name = "@evil/pkg";
    const bytes = bytesOf(evil);
    const syntheticIndex = synthetic.index;
    // Catalog holds no allowlist of its own: without knownOwners the owner is data.
    expect(readCatalogCollectionsV1Result({ bytes, index: syntheticIndex })).toMatchObject({
      state: "read",
    });
    const knownOwners = ["@aihq/core", "@aihq/catalog"];
    expect(readCatalogCollectionsV1Result({ bytes, index: syntheticIndex, knownOwners })).toEqual({
      state: "refused",
      reason: "unknown-owner",
    });
    expect(readCatalogCollectionsV1({ bytes, index: syntheticIndex, knownOwners })).toBeUndefined();
    // The shipped owners are exactly the ones a consumer names.
    expect(
      readCatalogCollectionsV1Result({ bytes: shippedBytes, index, knownOwners }),
    ).toMatchObject({ state: "read" });
    expect(
      readCatalogCollectionsV1Result({ bytes: shippedBytes, index, knownOwners: ["@aihq/core"] }),
    ).toEqual({ state: "refused", reason: "unknown-owner" });
    // A stated owner list that is not a list of package names is a malformed request.
    for (const malformed of [[], ["Not A Package"], "@aihq/core", [1]]) {
      expect(
        readCatalogCollectionsV1Result({
          bytes: shippedBytes,
          index,
          knownOwners: malformed as never,
        }),
        JSON.stringify(malformed),
      ).toEqual({ state: "refused", reason: "malformed-request" });
    }
  });
});
