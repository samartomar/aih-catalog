import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CATALOG_COLLECTIONS_ROOT_URL } from "../../src/content/catalog-collections-v1.js";
import { CATALOG_CONTENT_INDEX_ROOT_URL } from "../../src/content/catalog-content-v1.js";
import {
  CATALOG_SOURCE_CLOSURE_FORMAT_V1,
  CATALOG_SOURCE_ROOT_URL,
  readCatalogSourceClosureV1,
} from "../../src/content/catalog-source-closure-v1.js";
import * as publicApi from "../../src/index.js";

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const digest = (domain: string, value: unknown) =>
  `sha256:${sha256(`${domain}\0${canonical(value)}`)}`;

const REVISION = "0123456789abcdef0123456789abcdef01234567";
/** The synthetic member's original files: this fixture's verification reference. */
const FILES = [
  ["aih-packs.json", '{"packs":["governance-quality"]}\n'],
  ["packs/governance-quality/aih-gov-doctor/LICENSE", "Apache License\nVersion 2.0\n"],
  ["packs/governance-quality/aih-gov-doctor/SKILL.md", "# aih-gov-doctor\n"],
  ["packs/governance-quality/aih-gov-doctor/profile.json", '{"id":"aih-gov-doctor"}\n'],
] as const;
const EXPECTED = FILES.map(([path, text]) => [path, sha256(text)] as const);
const TREE_DIGEST = `sha256:${"a7".repeat(32)}`;

/**
 * A synthetic Catalog package root, built by the real index and collection generators: a Core
 * collection (release 0.6.2, as the Catalog shipped until D57) whose governance-quality member's
 * source files are shipped under defaults/sources, a source-file member whose bytes are not
 * shipped (review-quality), a configuration-only member (context7) and the default profile.
 * The shipped Catalog names no Core collection until the Core 0.7.0 content lands.
 */
async function syntheticPackage(base: string) {
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(base, path)), { recursive: true });
    writeFileSync(join(base, path), text);
  };
  write("package.json", JSON.stringify({ name: "@aihq/catalog", version: "0.0.0" }));
  const profile = (id: string, kind: string, material: unknown) =>
    canonical({
      asset: {
        assetId: `aih/package:skill-pack/${id}`,
        contentDigest: `sha256:${sha256(id)}`,
        sourceId: "source:aih-core",
        sourceRevisionId: "package:@aihq/core@0.6.2",
      },
      compiler: { id: "built-in", inputFormat: "built-in/v1", version: "1" },
      format: "aih-first-party-qualification-profile",
      material,
      scanner: {
        catalog: {
          owner: "samartomar",
          pinnedCommit: REVISION,
          repository: "ai-harness",
          sourceTreeSha256: "b".repeat(64),
        },
        component: { componentId: `asset:${sha256(id)}`, paths: ["declared"] },
      },
      scope: { description: "Synthetic.", kind: "source-files" },
      subject: { id, kind },
      version: 1,
    });
  const sourceFiles = (paths: readonly (readonly [string, string])[]) => ({
    files: paths.map(([path, text]) => ({ digest: `sha256:${sha256(text)}`, path })),
    kind: "source-files",
    treeDigest: TREE_DIGEST,
  });
  const seeds: string[] = [];
  const seed = (
    seedPath: string,
    entryId: string,
    id: string,
    kind: string,
    release: string,
    profileBytes: string,
  ) => {
    const local = dirname(seedPath) === "." ? "profile/" : "";
    const directory = dirname(seedPath) === "." ? "profile" : dirname(seedPath);
    const source = { type: "aih", release, revision: `sha256:${sha256(profileBytes)}` };
    const sourceDigest = digest("aih-governance-decision-source/v2", source);
    const subjectDigest = digest("aih-governance-decision-subject/v2", { id, kind, sourceDigest });
    for (const name of ["closure", "prose", "recipe"])
      write(`defaults/${directory}/artifacts/${name}.json`, canonical({ name }));
    write(`defaults/${directory}/artifacts/profile.json`, profileBytes);
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
  seed(
    "default-catalog-v2.json",
    "recipe.default",
    "default-profile",
    "profile",
    "1.0.0",
    canonical({ id: "default" }),
  );
  const core = (kind: string, id: string, profileBytes: string) =>
    seed(
      `workbench/aih-core-0.6.2/${kind}.aih.${id}.core-0-6-2/seed.json`,
      `${kind}.aih.${id}.core-0-6-2`,
      id,
      kind,
      "0.6.2",
      profileBytes,
    );
  core("agent", "governance-quality", profile("governance-quality", "agent", sourceFiles(FILES)));
  core(
    "agent",
    "review-quality",
    profile(
      "review-quality",
      "agent",
      sourceFiles([["packs/review-quality/SKILL.md", "# review\n"]]),
    ),
  );
  core(
    "mcp",
    "context7",
    profile("context7", "mcp", {
      declarationDigest: `sha256:${"c".repeat(64)}`,
      kind: "configuration-only",
      sourceInputDigest: `sha256:${"d".repeat(64)}`,
    }),
  );
  write(
    "defaults/default-catalog-seed-manifest-v2.json",
    canonical({ format: "aih-supported-candidate-seed-manifest", seeds: seeds.sort(), version: 1 }),
  );
  for (const [path, text] of FILES)
    write(`${CATALOG_SOURCE_ROOT_URL}/github.com/samartomar/ai-harness/${REVISION}/${path}`, text);
  // @ts-expect-error The maintenance generators are intentionally plain ESM JavaScript.
  const indexGenerator = await import("../../tools/generate-catalog-index.mjs");
  // @ts-expect-error The maintenance generators are intentionally plain ESM JavaScript.
  const collectionGenerator = await import("../../tools/generate-catalog-collections.mjs");
  write(
    CATALOG_CONTENT_INDEX_ROOT_URL,
    indexGenerator.serializeCatalogIndex(indexGenerator.generateCatalogIndex(base)),
  );
  const shippedInputs = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, "..", "..", "defaults/catalog-collection-inputs-v1.json"),
      "utf8",
    ),
  );
  const inputs = {
    ...shippedInputs,
    collections: [
      {
        id: "aih-core",
        owner: { package: "@aihq/core" },
        sourceType: "aih",
        current: { release: "0.6.2", origin: { kind: "catalog-authored" } },
        seedRoot: "workbench/aih-core-0.6.2/",
      },
      ...shippedInputs.collections.filter(
        (collection: { id: string }) => collection.id !== "aih-core",
      ),
    ],
  };
  write(
    CATALOG_COLLECTIONS_ROOT_URL,
    collectionGenerator.serializeCatalogCollections(
      collectionGenerator.generateCatalogCollections(base, inputs),
    ),
  );
}

const root = mkdtempSync(join(tmpdir(), "aih-catalog-source-closure-"));
// biome-ignore lint/suspicious/noExplicitAny: the tests read untyped published JSON.
let indexJson: any;
// biome-ignore lint/suspicious/noExplicitAny: the tests read untyped published JSON.
let collectionsJson: any;
beforeAll(async () => {
  await syntheticPackage(root);
  indexJson = JSON.parse(readFileSync(resolve(root, CATALOG_CONTENT_INDEX_ROOT_URL), "utf8"));
  collectionsJson = JSON.parse(readFileSync(resolve(root, CATALOG_COLLECTIONS_ROOT_URL), "utf8"));
}, 30_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const disk = (path: string): Uint8Array | undefined => {
  try {
    return readFileSync(resolve(root, ...path.split("/")));
  } catch {
    return undefined;
  }
};
const coreMember = (subjectId: string) => {
  const core = collectionsJson.collections.find((c: { id: string }) => c.id === "aih-core");
  return core.members.find((member: { entryId: string }) =>
    indexJson.entries.some(
      (entry: { entryId: string; subject: { id: string } }) =>
        entry.entryId === member.entryId && entry.subject.id === subjectId,
    ),
  ) as { entryId: string; subjectDigest: string };
};
const entryOf = (entryId: string) =>
  indexJson.entries.find((entry: { entryId: string }) => entry.entryId === entryId);

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}
const bytesOf = (value: unknown) => Buffer.from(`${canonical(value)}\n`, "utf8");

/**
 * A consistent forged package: the entry's profile is rewritten and the index
 * and collection view are re-bound to it, so only the closure checks can refuse.
 */
// biome-ignore lint/suspicious/noExplicitAny: the forge mutates untyped published JSON.
function forgeProfile(subjectId: string, mutate: (profile: any) => void) {
  const entry = entryOf(coreMember(subjectId).entryId);
  const profilePath: string = entry.artifacts.profile.path;
  const profile = JSON.parse(readFileSync(resolve(root, profilePath), "utf8"));
  mutate(profile);
  const profileBytes = Buffer.from(`${JSON.stringify(profile, null, 2)}\n`, "utf8");
  const index = structuredClone(indexJson);
  const forgedEntry = index.entries.find((e: { entryId: string }) => e.entryId === entry.entryId);
  forgedEntry.artifacts.profile.sha256 = sha256(profileBytes);
  const indexBytes = bytesOf(index);
  const collections = structuredClone(collectionsJson);
  collections.index.sha256 = sha256(indexBytes);
  const collectionsBytes = bytesOf(collections);
  return (path: string): Uint8Array | undefined => {
    if (path === profilePath) return profileBytes;
    if (path === CATALOG_CONTENT_INDEX_ROOT_URL) return indexBytes;
    if (path === CATALOG_COLLECTIONS_ROOT_URL) return collectionsBytes;
    return disk(path);
  };
}

describe("catalog original-source closure", () => {
  it("is exported from the public package root", () => {
    expect(publicApi.readCatalogSourceClosureV1).toBe(readCatalogSourceClosureV1);
    expect(publicApi.CATALOG_SOURCE_CLOSURE_FORMAT_V1).toBe("aih-catalog-source-closure");
    expect(publicApi.CATALOG_SOURCE_ROOT_URL).toBe("defaults/sources");
  });

  it("supplies the current Core governance-quality member's exact original files", () => {
    const result = readCatalogSourceClosureV1({
      root,
      collectionId: "aih-core",
      subjectId: "governance-quality",
    });
    if (result.state !== "verified") throw new Error(`refused: ${result.reason}`);
    const closure = result.closure;
    const member = coreMember("governance-quality");
    const entry = entryOf(member.entryId);

    expect(closure.format).toBe(CATALOG_SOURCE_CLOSURE_FORMAT_V1);
    expect(closure.version).toBe(1);
    expect(closure.collection).toEqual({ id: "aih-core", release: "0.6.2" });
    // Identity is the index's own, unchanged.
    expect(closure.entry).toEqual({
      entryId: member.entryId,
      subject: {
        id: "governance-quality",
        kind: "agent",
        sourceDigest: entry.subject.sourceDigest,
        subjectDigest: member.subjectDigest,
      },
    });
    expect(closure.asset).toEqual({
      assetId: "aih/package:skill-pack/governance-quality",
      sourceRevisionId: "package:@aihq/core@0.6.2",
    });
    // The assessment artifact that declared the closure stays a separate reference.
    expect(closure.assessment.profile).toEqual(entry.artifacts.profile);
    expect(closure.source).toEqual({
      host: "github.com",
      repository: "samartomar/ai-harness",
      revision: REVISION,
    });
    expect(closure.root).toBe(
      `${CATALOG_SOURCE_ROOT_URL}/github.com/samartomar/ai-harness/${REVISION}`,
    );
    expect(closure.files.map((file) => [file.path, file.sha256])).toEqual(EXPECTED);
    for (const file of closure.files) {
      expect(sha256(file.bytes)).toBe(file.sha256);
      expect(file.byteLength).toBe(file.bytes.byteLength);
      expect(Buffer.from(file.bytes)).toEqual(
        Buffer.from(disk(`${closure.root}/${file.path}`) ?? []),
      );
    }
    expect(closure.declaredTreeDigest).toBe(TREE_DIGEST);
    expect(closure.materialRoots).toEqual([
      {
        kind: "closure",
        path: ".",
        files: EXPECTED.map(([path]) => path),
        excludes: [],
      },
      {
        kind: "skill",
        path: "packs/governance-quality/aih-gov-doctor",
        marker: "SKILL.md",
        files: EXPECTED.slice(1).map(([path]) => path),
        excludes: ["aih-packs.json"],
      },
    ]);
  });

  it("reports the Core-owned source file absent from its own installed package", () => {
    // The shipped Catalog names Core 0.7.0 members but does not carry their original files.
    expect(
      readCatalogSourceClosureV1({ collectionId: "aih-core", subjectId: "governance-quality" }),
    ).toEqual({ state: "refused", reason: "source-file-absent", path: "aih-packs.json" });
  });

  it("refuses an unknown collection or a subject that is not a current member", () => {
    expect(
      readCatalogSourceClosureV1({ root, collectionId: "nope", subjectId: "governance-quality" }),
    ).toEqual({ state: "refused", reason: "collection-unknown" });
    expect(
      readCatalogSourceClosureV1({ root, collectionId: "aih-core", subjectId: "not-a-member" }),
    ).toEqual({ state: "refused", reason: "member-unknown" });
  });

  it("refuses configuration-only material and members whose bytes are not shipped", () => {
    expect(
      readCatalogSourceClosureV1({ root, collectionId: "aih-core", subjectId: "context7" }),
    ).toEqual({ state: "refused", reason: "material-not-source-files" });
    expect(
      readCatalogSourceClosureV1({ root, collectionId: "aih-core", subjectId: "review-quality" }),
    ).toMatchObject({ state: "refused", reason: "source-file-absent" });
  });

  it("refuses a missing or altered source file instead of serving it", () => {
    const skill = `${CATALOG_SOURCE_ROOT_URL}/github.com/samartomar/ai-harness/${REVISION}/packs/governance-quality/aih-gov-doctor/SKILL.md`;
    const missing = readCatalogSourceClosureV1({
      root,
      collectionId: "aih-core",
      subjectId: "governance-quality",
      readFile: (path) => (path === skill ? undefined : disk(path)),
    });
    expect(missing).toEqual({
      state: "refused",
      reason: "source-file-absent",
      path: "packs/governance-quality/aih-gov-doctor/SKILL.md",
    });
    const altered = readCatalogSourceClosureV1({
      root,
      collectionId: "aih-core",
      subjectId: "governance-quality",
      readFile: (path) => (path === skill ? Buffer.from("# not the original\n") : disk(path)),
    });
    expect(altered).toEqual({
      state: "refused",
      reason: "source-file-digest-mismatch",
      path: "packs/governance-quality/aih-gov-doctor/SKILL.md",
    });
  });

  it("refuses a profile that does not match its index digest", () => {
    const profilePath = entryOf(coreMember("governance-quality").entryId).artifacts.profile.path;
    const result = readCatalogSourceClosureV1({
      root,
      collectionId: "aih-core",
      subjectId: "governance-quality",
      readFile: (path) => (path === profilePath ? Buffer.from("{}\n") : disk(path)),
    });
    expect(result).toEqual({ state: "refused", reason: "profile-unverified" });
  });

  it("refuses an index or collection view that is not the published one", () => {
    expect(
      readCatalogSourceClosureV1({
        root,
        collectionId: "aih-core",
        subjectId: "governance-quality",
        readFile: (path) => (path === CATALOG_CONTENT_INDEX_ROOT_URL ? undefined : disk(path)),
      }),
    ).toEqual({ state: "refused", reason: "index-unreadable" });
    expect(
      readCatalogSourceClosureV1({
        root,
        collectionId: "aih-core",
        subjectId: "governance-quality",
        readFile: (path) =>
          path === CATALOG_COLLECTIONS_ROOT_URL ? Buffer.from("{}\n") : disk(path),
      }),
    ).toEqual({ state: "refused", reason: "collections-unreadable" });
  });

  it("refuses declared paths that escape the source root or are not canonical", () => {
    for (const path of ["../escape", "/abs", "packs/./x", "packs\\x", "packs//x", "a/../b"]) {
      const readFile = forgeProfile("governance-quality", (profile) => {
        profile.material.files[1].path = path;
      });
      expect(
        readCatalogSourceClosureV1({
          root,
          collectionId: "aih-core",
          subjectId: "governance-quality",
          readFile,
        }),
      ).toEqual({ state: "refused", reason: "profile-invalid" });
    }
  });

  it("refuses duplicate, unordered or malformed declarations and an unpinned revision", () => {
    const cases: Array<(profile: Doc) => void> = [
      (p) => p.material.files.push({ ...p.material.files[0] }),
      (p) => p.material.files.reverse(),
      (p) => {
        p.material.files[0].digest = "sha256:XYZ";
      },
      (p) => {
        p.scanner.catalog.pinnedCommit = "main";
      },
      (p) => {
        p.scanner.catalog.repository = "../other";
      },
      (p) => {
        p.subject.id = "someone-else";
      },
      (p) => {
        p.material.files = [];
      },
    ];
    for (const mutate of cases) {
      const readFile = forgeProfile("governance-quality", mutate);
      expect(
        readCatalogSourceClosureV1({
          root,
          collectionId: "aih-core",
          subjectId: "governance-quality",
          readFile,
        }),
      ).toEqual({ state: "refused", reason: "profile-invalid" });
    }
  });

  it("names an unknown profile version apart from a malformed profile", () => {
    const read = (mutate: (profile: Doc) => void) =>
      readCatalogSourceClosureV1({
        root,
        collectionId: "aih-core",
        subjectId: "governance-quality",
        readFile: forgeProfile("governance-quality", mutate),
      });
    for (const version of [2, 0, "1", null]) {
      expect(
        read((p) => {
          p.version = version;
        }),
        JSON.stringify(version),
      ).toEqual({ state: "refused", reason: "profile-unknown-version" });
    }
    // Another format is not this profile at all: still malformed, not a version question.
    expect(
      read((p) => {
        p.format = "aih-first-party-qualification-profile-v2";
      }),
    ).toEqual({ state: "refused", reason: "profile-invalid" });
    expect(
      read((p) => {
        p.format = "aih-first-party-qualification-profile-v2";
        p.version = 2;
      }),
    ).toEqual({ state: "refused", reason: "profile-invalid" });
  });

  it("refuses a changed declared digest even when the shipped bytes are intact", () => {
    const readFile = forgeProfile("governance-quality", (profile) => {
      profile.material.files[0].digest = `sha256:${"0".repeat(64)}`;
    });
    expect(
      readCatalogSourceClosureV1({
        root,
        collectionId: "aih-core",
        subjectId: "governance-quality",
        readFile,
      }),
    ).toEqual({ state: "refused", reason: "source-file-digest-mismatch", path: "aih-packs.json" });
  });
});

// biome-ignore lint/suspicious/noExplicitAny: the tests mutate untyped published JSON.
type Doc = any;
