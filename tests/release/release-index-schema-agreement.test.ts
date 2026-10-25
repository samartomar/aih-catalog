import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { readReleaseIndex } from "../../dist/release/reader.js";
import { canonical, encode, type Json, sha256 } from "./fixtures.js";

const root = resolve(import.meta.dirname, "../..");
const schema = JSON.parse(readFileSync(resolve(root, "schemas/release-index/1.0.0.json"), "utf8"));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

const NOW = "2026-06-01T00:00:00Z";

const digest = (seed: string) => sha256(encode(seed));

type Index = { [key: string]: Json };
const entry = (overrides: Record<string, Json> = {}): Json => ({
  frameworkId: "alpha",
  name: "Alpha",
  version: "1.0.0",
  location: {
    kind: "archive",
    url: "https://example.test/releases/alpha-1.0.0.json",
    sha256: digest("alpha-release"),
    byteLength: 100,
  },
  sha256: digest("alpha-release"),
  schema: "urn:aihq:catalog:release:1.5.0",
  status: "current",
  evidence: [],
  source: { id: "catalog-public", kind: "public" },
  ...overrides,
});

function fixtureIndex(overrides: Record<string, Json> = {}): Index {
  return {
    schema: "urn:aihq:catalog:release-index:1.0.0",
    sourceId: "catalog-public",
    version: 1,
    issuedAt: "2026-01-01T00:00:00Z",
    expires: "2027-01-01T00:00:00Z",
    entries: [entry()],
    ...overrides,
  };
}

const read = (document: unknown) => {
  const index = document as Index;
  const authorized = (index.entries as Record<string, Json>[])?.map((e) => e.frameworkId) ?? [];
  return readReleaseIndex({
    evaluatedAt: NOW,
    sources: [
      {
        sourceId: "catalog-public",
        trust: "none",
        authorizedFrameworks: [...new Set(authorized as string[])],
        indexBytes: encode(`${canonical(document)}\n`),
      },
    ],
    state: [
      { sourceId: "catalog-public", lastVersion: 0, lastVerifiedAt: null, lastIndexSha256: null },
    ],
  });
};

const reasons = (document: unknown) => {
  const result = read(document);
  return [
    ...result.diagnostics.map((d) => d.reason),
    ...result.sources.flatMap((source) => source.diagnostics.map((d) => d.reason)),
  ];
};

type Mutation = (index: Index) => void;
const firstEntry = (index: Index) =>
  (index.entries as Record<string, Json>[])[0] as Record<string, Json>;

/** Structural refusals: the published JSON Schema and the reader must both reject. */
const structural: [string, Mutation, string][] = [
  [
    "unknown root field",
    (i) => {
      i.extra = true;
    },
    "unknown-field",
  ],
  [
    "unknown entry field",
    (i) => {
      firstEntry(i).extra = 1;
    },
    "unknown-field",
  ],
  [
    "missing evidence",
    (i) => {
      delete firstEntry(i).evidence;
    },
    "missing-field",
  ],
  [
    "unknown status",
    (i) => {
      firstEntry(i).status = "withdrawn";
    },
    "invalid-status",
  ],
  [
    "unknown source kind",
    (i) => {
      (firstEntry(i).source as Record<string, Json>).kind = "federal";
    },
    "invalid-source-kind",
  ],
  [
    "zero version",
    (i) => {
      i.version = 0;
    },
    "invalid-version",
  ],
  [
    "fractional version",
    (i) => {
      i.version = 1.5;
    },
    "invalid-version",
  ],
  [
    "malformed issuedAt",
    (i) => {
      i.issuedAt = "yesterday";
    },
    "invalid-time",
  ],
  [
    "uppercase digest",
    (i) => {
      firstEntry(i).sha256 = "A".repeat(64);
    },
    "invalid-sha256",
  ],
  [
    "unknown release schema on entry",
    (i) => {
      firstEntry(i).schema = "urn:aihq:catalog:release:9.9.9";
    },
    "unsupported-release-schema",
  ],
  [
    "empty name",
    (i) => {
      firstEntry(i).name = "";
    },
    "invalid-text",
  ],
  [
    "version range on entry",
    (i) => {
      firstEntry(i).version = "^1.0.0";
    },
    "invalid-version",
  ],
  [
    "empty reason",
    (i) => {
      firstEntry(i).reason = "";
    },
    "invalid-text",
  ],
  [
    "zero archive byte length",
    (i) => {
      (firstEntry(i).location as Record<string, Json>).byteLength = 0;
    },
    "invalid-source",
  ],
  [
    "http archive url",
    (i) => {
      (firstEntry(i).location as Record<string, Json>).url = "http://example.test/a.json";
    },
    "invalid-source",
  ],
  [
    "local location without input",
    (i) => {
      firstEntry(i).location = { kind: "local" };
    },
    "missing-field",
  ],
  [
    "entry source as string",
    (i) => {
      firstEntry(i).source = "catalog-public";
    },
    "invalid-type",
  ],
];

/** Semantic refusals JSON Schema cannot express; the schema documents them as reader rules. */
const semantic: [string, Mutation, string][] = [
  [
    "entries out of order",
    (i) => {
      i.entries = [entry({ frameworkId: "beta" }), entry({ frameworkId: "alpha" })];
    },
    "unordered-entries",
  ],
  [
    "duplicate entry identity",
    (i) => {
      i.entries = [entry(), entry()];
    },
    "duplicate-entry",
  ],
  [
    "entry names another source",
    (i) => {
      (firstEntry(i).source as Record<string, Json>).id = "someone-else";
    },
    "source-id-mismatch",
  ],
  [
    "archive location digests different bytes",
    (i) => {
      (firstEntry(i).location as Record<string, Json>).sha256 = digest("other");
    },
    "location-digest-mismatch",
  ],
  [
    "expires before issue",
    (i) => {
      i.issuedAt = "2027-01-01T00:00:00Z";
      i.expires = "2026-01-01T00:00:00Z";
    },
    "invalid-times",
  ],
];

describe("release index schema and reader agree", () => {
  it("accepts the valid fixture under both", () => {
    const fixture = JSON.parse(
      readFileSync(resolve(root, "fixtures/release-index-1.0.0-valid.json"), "utf8"),
    );
    expect(validateSchema(fixture), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(read(fixture).valid).toBe(true);
  });

  it.each(structural)("rejects %s under both", (_name, mutate, reason) => {
    const index = fixtureIndex();
    mutate(index);
    expect(validateSchema(index)).toBe(false);
    expect(reasons(index)).toContain(reason);
  });

  it.each(semantic)("rejects %s in the reader", (_name, mutate, reason) => {
    const index = fixtureIndex();
    mutate(index);
    expect(reasons(index)).toContain(reason);
  });

  it("names an unsupported index format with encountered and supported IDs", () => {
    const result = read({ ...fixtureIndex(), schema: "urn:aihq:catalog:release-index:2.0.0" });
    expect(result.valid).toBe(false);
    const diagnostic = result.sources[0]?.diagnostics[0];
    expect(diagnostic).toMatchObject({
      code: "SCHEMA_UNSUPPORTED",
      reason: "unsupported-schema",
      encountered: "urn:aihq:catalog:release-index:2.0.0",
      supported: ["urn:aihq:catalog:release-index:1.0.0"],
    });
  });

  it("keeps retired and revoked entries listed under both", () => {
    const index = fixtureIndex({
      entries: [
        entry({ status: "retired", reason: "Old." }),
        entry({ frameworkId: "beta", status: "revoked", reason: "Withdrawn." }),
      ],
    });
    expect(validateSchema(index)).toBe(true);
    const result = read(index);
    expect(result.valid).toBe(true);
    expect(result.entries.map((e) => e.status)).toEqual(["retired", "revoked"]);
  });
});
