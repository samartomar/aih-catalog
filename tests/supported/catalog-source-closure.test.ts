import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG_COLLECTIONS_ROOT_URL } from "../../src/content/catalog-collections-v1.js";
import { CATALOG_CONTENT_INDEX_ROOT_URL } from "../../src/content/catalog-content-v1.js";
import {
  CATALOG_SOURCE_CLOSURE_FORMAT_V1,
  CATALOG_SOURCE_ROOT_URL,
  readCatalogSourceClosureV1,
} from "../../src/content/catalog-source-closure-v1.js";
import * as publicApi from "../../src/index.js";

const root = resolve(import.meta.dirname, "..", "..");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const disk = (path: string): Uint8Array | undefined => {
  try {
    return readFileSync(resolve(root, ...path.split("/")));
  } catch {
    return undefined;
  }
};
const indexJson = JSON.parse(readFileSync(resolve(root, CATALOG_CONTENT_INDEX_ROOT_URL), "utf8"));
const collectionsJson = JSON.parse(
  readFileSync(resolve(root, CATALOG_COLLECTIONS_ROOT_URL), "utf8"),
);
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

const REVISION = "54ceab4118aade25a8a07608532b434feb0a6e6b";
/** This checkpoint's verification reference, not a release-selection constant. */
const EXPECTED = [
  ["aih-packs.json", "bc21b9787fb8cfb589085a4f7fb4308a73d30fa9adfa7aa67636efc6ffdce950"],
  [
    "packs/governance-quality/aih-gov-doctor/LICENSE",
    "c7963d5f486ca7f94b9141d20a08f0f2ec6f44447ceab499d8adc6ca516cf71e",
  ],
  [
    "packs/governance-quality/aih-gov-doctor/SKILL.md",
    "c67ab49713c49abdc53d4d20b97e42c998040dc67e7a2d4db7423efa81cb21b6",
  ],
  [
    "packs/governance-quality/aih-gov-doctor/profile.json",
    "2c467d7689fe043f5eda45da8ef947bb5ccda64255f430ef4d05ffecdcbe8e5b",
  ],
] as const;

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
    expect(closure.declaredTreeDigest).toBe(
      "sha256:a72ef33803283dc2950f50bb238ed915cf86c069964a1971cc3a38510ede4c1c",
    );
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

  it("reads its own installed package when no root is given", () => {
    const result = readCatalogSourceClosureV1({
      collectionId: "aih-core",
      subjectId: "governance-quality",
    });
    expect(result.state).toBe("verified");
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
