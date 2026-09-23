import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CATALOG_CATEGORIES_MAX_BYTES_V1,
  CATALOG_CATEGORIES_ROOT_URL,
  CATALOG_CATEGORIES_SUBPATH_V1,
  readCatalogCategoriesV1,
} from "../../src/content/catalog-categories-v1.js";
import {
  type CatalogContentV1,
  readCatalogContentV1,
} from "../../src/content/catalog-content-v1.js";
import * as publicApi from "../../src/index.js";

const root = resolve(import.meta.dirname, "..", "..");
const index = readCatalogContentV1({
  bytes: readFileSync(resolve(root, "defaults/catalog-index-v1.json")),
}) as CatalogContentV1;
const shippedBytes = readFileSync(resolve(root, CATALOG_CATEGORIES_ROOT_URL));
const shipped = JSON.parse(shippedBytes.toString("utf8"));
const rules = JSON.parse(
  readFileSync(resolve(root, "defaults/catalog-categories-rules-v1.json"), "utf8"),
);
const temporaryRoots: string[] = [];

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
// biome-ignore lint/suspicious/noExplicitAny: the tests mutate untyped published JSON.
type Doc = any;
const clone = (): Doc => structuredClone(shipped);
const record = (doc: Doc, entryId: string) =>
  doc.entries.find((entry: { entryId: string }) => entry.entryId === entryId);

async function generator() {
  // @ts-expect-error The maintenance generator is intentionally plain ESM JavaScript.
  return import("../../tools/generate-catalog-categories.mjs");
}

/** A disposable root holding only what the generator reads, with a replaced rules file. */
function fixture(rulesValue: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "aih-catalog-categories-"));
  temporaryRoots.push(directory);
  for (const path of ["defaults/catalog-index-v1.json", "defaults/catalog-presentation-v1.json"]) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    cpSync(join(root, path), join(directory, path));
  }
  writeFileSync(
    join(directory, "defaults/catalog-categories-rules-v1.json"),
    JSON.stringify(rulesValue),
  );
  return directory;
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("curated catalog categories", () => {
  it("is exported from the package root and a subpath", () => {
    expect(publicApi.readCatalogCategoriesV1).toBe(readCatalogCategoriesV1);
    expect(CATALOG_CATEGORIES_SUBPATH_V1).toBe("./catalog-categories.json");
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(pkg.exports[CATALOG_CATEGORIES_SUBPATH_V1]).toBe(`./${CATALOG_CATEGORIES_ROOT_URL}`);
    expect(pkg.scripts["check:catalog-index"]).toContain(
      "tools/generate-catalog-categories.mjs --check",
    );
  });

  it("regenerates the committed bytes from the committed rules", async () => {
    const { generateCatalogCategories, serializeCatalogCategories } = await generator();
    expect(serializeCatalogCategories(generateCatalogCategories(root))).toBe(
      shippedBytes.toString("utf8"),
    );
  });

  it("covers every index entry once, as curation with a taxonomy from the rules file", () => {
    const categories = readCatalogCategoriesV1({ bytes: shippedBytes, index });
    if (categories === undefined) throw new Error("shipped categories refused");
    expect(categories.basis).toBe("curated");
    expect(categories.curatedBy).toBe("AIH catalog maintainers");
    expect(categories.taxonomy).toEqual(rules.taxonomy);
    expect(categories.entries.map((entry) => entry.entryId)).toEqual(
      index.entries.map((entry) => entry.entryId),
    );
    expect(categories.coverage).toMatchObject({ entries: 457, curated: 365, notCurated: 92 });
    const ruleIds = new Set(rules.rules.map((rule: { id: string }) => rule.id));
    for (const entry of categories.entries) {
      if (entry.category === null) {
        expect(entry.reason).toBe("not-curated");
        continue;
      }
      // Every assignment names its evidence and a rule that exists.
      const rule = /\(rule ([a-z0-9-]+)\)\.$/.exec(entry.rationale)?.[1];
      expect(ruleIds.has(rule), entry.entryId).toBe(true);
    }
  });

  it("traces each assignment to upstream evidence", () => {
    const categories = readCatalogCategoriesV1({ bytes: shippedBytes, index });
    const byId = new Map(categories?.entries.map((entry) => [entry.entryId, entry]));
    expect(byId.get("agent.ecc.python-reviewer")).toMatchObject({
      category: "code-review",
      rationale:
        'Upstream name "python-reviewer" at affaan-m/ECC:agents/python-reviewer.md contains "reviewer" (rule review-names).',
    });
    expect(byId.get("mcp.ecc.jira")).toMatchObject({
      category: "tool-integration",
      rationale:
        'Declared with kind "mcp" at affaan-m/ECC:mcp-configs/mcp-servers.json (rule mcp-server).',
    });
    expect(byId.get("skill.ecc.motion-advanced")).toMatchObject({
      category: "frontend-and-design",
      rationale:
        'Upstream frontmatter category "frontend" in affaan-m/ECC:skills/motion-advanced/SKILL.md (rule upstream-frontend-category).',
    });
    expect(byId.get("package.picocolors")).toEqual({
      entryId: "package.picocolors",
      subjectDigest: index.entries.find((entry) => entry.entryId === "package.picocolors")?.subject
        .subjectDigest,
      reason: "not-curated",
      category: null,
      rationale: null,
    });
  });

  it("refuses every structural defect", () => {
    expect(
      readCatalogCategoriesV1({
        bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), shippedBytes]),
        index,
      }),
    ).toBeUndefined();
    expect(
      readCatalogCategoriesV1({
        bytes: Buffer.from(`${JSON.stringify(shipped, null, 2)}\n`),
        index,
      }),
    ).toBeUndefined();
    expect(
      readCatalogCategoriesV1({
        bytes: Buffer.alloc(CATALOG_CATEGORIES_MAX_BYTES_V1 + 1, 0x20),
        index,
      }),
    ).toBeUndefined();
    expect(
      readCatalogCategoriesV1({
        bytes: shippedBytes,
        index,
        expectedDigest: `sha256:${"0".repeat(64)}`,
      }),
    ).toBeUndefined();

    const reviewer = "agent.ecc.python-reviewer";
    const unCurated = "package.picocolors";
    const top = (doc: Doc) => doc;
    const entry = (entryId: string) => (doc: Doc) => record(doc, entryId);
    const set =
      (target: (doc: Doc) => Doc, key: string, value: unknown) =>
      (doc: Doc): void => {
        target(doc)[key] = value;
      };
    const cases: Array<[string, (doc: Doc) => void]> = [
      ["unknown format", set(top, "format", "aih-catalog-categories-v2")],
      ["unknown version", set(top, "version", 2)],
      ["an upstream basis", set(top, "basis", "upstream")],
      ["extra member", set(top, "extra", true)],
      ["bad curatedAt", set(top, "curatedAt", "yesterday")],
      ["unsorted taxonomy", (doc) => doc.taxonomy.reverse()],
      ["empty taxonomy", set(top, "taxonomy", [])],
      ["unknown category", set(entry(reviewer), "category", "misc")],
      ["missing entry", (doc) => doc.entries.splice(3, 1)],
      ["unsorted entries", (doc) => doc.entries.reverse()],
      ["duplicate entry", (doc) => doc.entries.splice(1, 0, doc.entries[0])],
      ["wrong subject digest", set(entry(reviewer), "subjectDigest", `sha256:${"0".repeat(64)}`)],
      [
        "entry not in the index",
        (doc) =>
          doc.entries.push({
            entryId: "zzz.not.indexed",
            subjectDigest: `sha256:${"1".repeat(64)}`,
            category: null,
            rationale: null,
          }),
      ],
      ["rationale on a null category", set(entry(unCurated), "rationale", "x")],
      ["category without rationale", set(entry(reviewer), "rationale", null)],
      ["control character", set(entry(reviewer), "rationale", "a\nb")],
      ["oversize rationale", set(entry(reviewer), "rationale", "x".repeat(513))],
    ];
    for (const [reason, mutate] of cases) {
      const doc = clone();
      mutate(doc);
      expect(readCatalogCategoriesV1({ bytes: bytesOf(doc), index }), reason).toBeUndefined();
    }
  });

  it("refuses a rule it cannot apply exactly", async () => {
    const { generateCatalogCategories } = await generator();
    const withRule = (rule: unknown) => ({ ...rules, rules: [rule, ...rules.rules] });
    const cases: Array<[unknown, string]> = [
      [withRule({ id: "unknown", category: "misc", match: { kind: "mcp" } }), "unknown category"],
      [
        withRule({ id: "two", category: "testing", match: { kind: "mcp", namePattern: "(x)" } }),
        "exactly one match",
      ],
      [
        withRule({ id: "no-group", category: "testing", match: { namePattern: "test" } }),
        "one capture group",
      ],
      [{ ...rules, taxonomy: [...rules.taxonomy].reverse() }, "sorted and unique"],
      [{ ...rules, extra: true }, "unknown or missing members"],
    ];
    for (const [value, message] of cases) {
      expect(() => generateCatalogCategories(fixture(value))).toThrow(message);
    }
    // The committed rules applied to the same inputs in a fresh root give the same bytes.
    const { serializeCatalogCategories } = await generator();
    expect(serializeCatalogCategories(generateCatalogCategories(fixture(rules)))).toBe(
      shippedBytes.toString("utf8"),
    );
  });
});
