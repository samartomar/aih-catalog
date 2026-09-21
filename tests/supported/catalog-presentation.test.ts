import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CatalogContentV1,
  readCatalogContentV1,
} from "../../src/content/catalog-content-v1.js";
import {
  CATALOG_PRESENTATION_ROOT_URL,
  readCatalogPresentationV1,
} from "../../src/content/catalog-presentation-v1.js";
import * as publicApi from "../../src/index.js";

const root = resolve(import.meta.dirname, "..", "..");
const indexBytes = readFileSync(resolve(root, "defaults/catalog-index-v1.json"));
const index = readCatalogContentV1({ bytes: indexBytes }) as CatalogContentV1;
const shippedBytes = readFileSync(resolve(root, CATALOG_PRESENTATION_ROOT_URL));
const shipped = JSON.parse(shippedBytes.toString("utf8"));
const ECC = {
  type: "github",
  repository: "affaan-m/ECC",
  commit: "5064474d4d762dc9640234a41617cccb79185cec",
};

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
const read = (value: unknown) => readCatalogPresentationV1({ bytes: bytesOf(value), index });
// biome-ignore lint/suspicious/noExplicitAny: the tests mutate untyped published JSON.
type Doc = any;
const clone = (): Doc => structuredClone(shipped);
const record = (doc: Doc, entryId: string) =>
  doc.entries.find((entry: { entryId: string }) => entry.entryId === entryId);

async function generator() {
  // @ts-expect-error The maintenance generator is intentionally plain ESM JavaScript.
  return import("../../tools/generate-catalog-presentation.mjs");
}

describe("published catalog presentation", () => {
  it("is exported from the public package root and subpath", () => {
    expect(publicApi.readCatalogPresentationV1).toBe(readCatalogPresentationV1);
    expect(publicApi.CATALOG_PRESENTATION_SUBPATH_V1).toBe("./catalog-presentation.json");
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(pkg.exports["./catalog-presentation.json"]).toBe(`./${CATALOG_PRESENTATION_ROOT_URL}`);
  });

  it("covers every ECC entry at the indexed commit, with counts from the data", () => {
    const presentation = readCatalogPresentationV1({ bytes: shippedBytes, index });
    if (presentation === undefined) throw new Error("shipped presentation refused");
    expect(presentation.sources).toEqual([ECC]);
    const eccEntries = index.entries.filter(
      (entry) =>
        entry.subject.source.repository === ECC.repository &&
        entry.subject.source.commit === ECC.commit,
    );
    expect(presentation.entries.map((entry) => entry.entryId)).toEqual(
      eccEntries.map((entry) => entry.entryId),
    );
    expect(presentation.coverage).toEqual({
      entries: 367,
      title: { published: 330, unavailable: 37 },
      description: { published: 361, unavailable: 6 },
      category: { published: 3, unavailable: 364 },
    });
  });

  it("reads each value from the exact file the entry's closure declares", () => {
    const presentation = readCatalogPresentationV1({ bytes: shippedBytes, index });
    for (const entry of presentation?.entries ?? []) {
      if (entry.source === null) continue;
      const indexed = index.entries.find((candidate) => candidate.entryId === entry.entryId);
      const closure = JSON.parse(
        readFileSync(resolve(root, indexed?.artifacts.closure?.path ?? ""), "utf8"),
      );
      const declared = closure.files.find(
        (file: { path: string }) => file.path === entry.source?.path,
      );
      expect(declared?.digest, entry.entryId).toBe(`sha256:${entry.source.sha256}`);
    }
  });

  it("keeps publisher text verbatim, and marks what upstream does not declare", () => {
    const presentation = readCatalogPresentationV1({ bytes: shippedBytes, index });
    const byId = new Map(presentation?.entries.map((entry) => [entry.entryId, entry]));
    expect(byId.get("skill.ecc.content-hash-cache-pattern")).toEqual({
      entryId: "skill.ecc.content-hash-cache-pattern",
      subjectDigest: "sha256:dfa2e49a1fed3ebafd14c65ea768516b4a0e085ac14205b210e8c2d1bcadbb37",
      source: {
        path: "skills/content-hash-cache-pattern/SKILL.md",
        sha256: "c0242ee2fcb5c096d0625cb6957481fce2266e92985036795f5b5c13c329d802",
      },
      title: { state: "published", value: "content-hash-cache-pattern", field: "frontmatter.name" },
      description: {
        state: "published",
        value:
          "Cache expensive file processing results using SHA-256 content hashes — path-independent, auto-invalidating, with service layer separation. Use when repeated file processing is slow and results should be cached and invalidated by content rather than path.",
        field: "frontmatter.description",
      },
      category: { state: "unavailable", reason: "not-declared" },
    });
    // Only categories the upstream file declares are published.
    expect(
      presentation?.entries
        .filter((entry) => entry.category.state === "published")
        .map((e) => [e.entryId, e.category.state === "published" ? e.category.value : ""]),
    ).toEqual([
      ["skill.ecc.motion-advanced", "frontend"],
      ["skill.ecc.motion-foundations", "frontend"],
      ["skill.ecc.motion-patterns", "frontend"],
    ]);
    // An MCP server key is an id, not a display name.
    expect(byId.get("mcp.ecc.browser-use")?.title).toEqual({
      state: "unavailable",
      reason: "not-declared",
    });
    expect(byId.get("mcp.ecc.browser-use")?.description).toMatchObject({
      state: "published",
      field: "mcpServers.browser-use.description",
    });
    expect(byId.get("mcp.ecc.context7")?.description).toEqual({
      state: "unavailable",
      reason: "not-in-source-file",
    });
  });

  it("refuses records that are not the index's own entries, or that leave one out", () => {
    const wrongDigest = clone();
    wrongDigest.entries[0].subjectDigest = `sha256:${"0".repeat(64)}`;
    expect(read(wrongDigest)).toBeUndefined();

    const missing = clone();
    missing.entries.splice(3, 1);
    expect(read(missing)).toBeUndefined();

    const foreign = clone();
    foreign.entries.push({ ...foreign.entries[0], entryId: "skill.aih.docs-quality.core-0-6-2" });
    expect(read(foreign)).toBeUndefined();

    const reordered = clone();
    reordered.entries.reverse();
    expect(read(reordered)).toBeUndefined();

    const otherCommit = clone();
    otherCommit.sources[0].commit = "0".repeat(40);
    expect(read(otherCommit)).toBeUndefined();
  });

  it("refuses malformed values and unknown fields", () => {
    const id = "skill.ecc.content-hash-cache-pattern";
    const cases: Array<(doc: Doc) => void> = [
      (doc) => {
        record(doc, id).extra = true;
      },
      (doc) => {
        record(doc, id).source = null;
      },
      (doc) => {
        record(doc, id).description.value = "line\u0007bell";
      },
      (doc) => {
        record(doc, id).description.value = "";
      },
      (doc) => {
        record(doc, id).description.value = "x".repeat(4097);
      },
      (doc) => {
        record(doc, id).description.field = "prose.md";
      },
      (doc) => {
        record(doc, id).category = { state: "unavailable", reason: "guessed" };
      },
      (doc) => {
        record(doc, id).category = { state: "inferred", value: "Research" };
      },
      (doc) => {
        record(doc, id).source.path = "../skills/x/SKILL.md";
      },
      (doc) => {
        doc.format = "aih-catalog-presentation-v2";
      },
      (doc) => {
        doc.version = 2;
      },
    ];
    for (const mutate of cases) {
      const doc = clone();
      mutate(doc);
      expect(read(doc)).toBeUndefined();
    }
  });

  it("refuses bytes that are not the canonical serialization", () => {
    expect(
      readCatalogPresentationV1({ bytes: Buffer.from(JSON.stringify(shipped, null, 2)), index }),
    ).toBeUndefined();
    expect(
      readCatalogPresentationV1({
        bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), shippedBytes]),
        index,
      }),
    ).toBeUndefined();
    expect(readCatalogPresentationV1({ bytes: new Uint8Array(), index })).toBeUndefined();
  });
});

describe("presentation frontmatter extraction", () => {
  const values = async (text: string) => {
    const { readFrontmatter } = await generator();
    const parsed: Map<string, { value?: string; unparsed?: boolean }> = readFrontmatter(text);
    return Object.fromEntries(
      [...parsed].map(([key, entry]) => [key, entry.unparsed ? "<unparsed>" : entry.value]),
    );
  };

  it("reads plain, quoted, block and continued plain scalars exactly", async () => {
    expect(
      await values(
        [
          "---",
          "name: plain-name",
          'q: "say \\"hi\\" \\\\ ok"',
          "s: 'it''s'",
          "f: >",
          "  one",
          "  two",
          "",
          "  three",
          "g: >-",
          "  kept",
          "  short",
          "l: |",
          "  a",
          "  b",
          "c: first line",
          "  continued here",
          "---",
          "body",
        ].join("\n"),
      ),
    ).toEqual({
      name: "plain-name",
      q: 'say "hi" \\ ok',
      s: "it's",
      f: "one two\nthree\n",
      g: "kept short",
      l: "a\nb\n",
      c: "first line continued here",
    });
  });

  it("reads an ambiguous or unsupported form as unparsed, never a guess", async () => {
    expect(
      await values(
        [
          "---",
          'a: "tab\\tescape"',
          "b: value: with colon",
          "c: text # comment",
          "d: &anchor x",
          "e: >2",
          "  indented",
          "f: [list]",
          "g: one",
          "g: two",
          "---",
          "body",
        ].join("\n"),
      ),
    ).toEqual({
      a: "<unparsed>",
      b: "<unparsed>",
      c: "<unparsed>",
      d: "<unparsed>",
      e: "<unparsed>",
      f: "<unparsed>",
      g: "<unparsed>",
    });
  });
});
