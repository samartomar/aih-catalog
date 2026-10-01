import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { readRelease } from "../../src/release/reader.js";
import { encode, fixtureRelease, type Json, releaseBytes, sha256 } from "./fixtures.js";

const root = resolve(import.meta.dirname, "../..");
const schema = JSON.parse(readFileSync(resolve(root, "schemas/release/1.0.0.json"), "utf8"));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

type Release = ReturnType<typeof fixtureRelease>;
type Mutation = (release: Release) => void;
const item = (release: Release, index: number) =>
  (release.items as { [key: string]: Json }[])[index] as { [key: string]: Json };

const read = (document: unknown) => {
  const bytes = releaseBytes(document);
  return readRelease(bytes, { expectedSha256: sha256(bytes) });
};
const reasons = (document: unknown) => {
  const result = read(document);
  return result.valid ? [] : result.diagnostics.map((d) => d.reason);
};

/** Structural refusals: the published JSON Schema and the reader must both reject. */
const structural: [string, Mutation, string][] = [
  [
    "unknown root field",
    (r) => {
      r.extra = true;
    },
    "unknown-field",
  ],
  [
    "unknown item field",
    (r) => {
      item(r, 0).extra = 1;
    },
    "unknown-field",
  ],
  [
    "missing items",
    (r) => {
      delete r.items;
    },
    "missing-field",
  ],
  [
    "package version range",
    (r) => {
      (r.package as Record<string, Json>).version = "^1.2.0";
    },
    "invalid-version",
  ],
  [
    "uppercase hash",
    (r) => {
      (item(r, 0).recipe as Record<string, Json>).sha256 = "A".repeat(64);
    },
    "invalid-sha256",
  ],
  [
    "unsafe traversal path",
    (r) => {
      (item(r, 0).recipe as Record<string, Json>).path = "release/../x.json";
    },
    "unsafe-path",
  ],
  [
    "absolute path",
    (r) => {
      (item(r, 0).materials as Record<string, Json>[])[0]!.path = "/etc/passwd";
    },
    "unsafe-path",
  ],
  [
    "backslash path",
    (r) => {
      (item(r, 0).materials as Record<string, Json>[])[0]!.path = "a\\b";
    },
    "unsafe-path",
  ],
  [
    "negative length",
    (r) => {
      (item(r, 0).materials as Record<string, Json>[])[0]!.byteLength = -1;
    },
    "invalid-length",
  ],
  [
    "fractional length",
    (r) => {
      (item(r, 0).materials as Record<string, Json>[])[0]!.byteLength = 1.5;
    },
    "invalid-length",
  ],
  [
    "unknown scope",
    (r) => {
      item(r, 0).scopes = ["system"];
    },
    "invalid-scope",
  ],
  [
    "empty scopes",
    (r) => {
      item(r, 0).scopes = [];
    },
    "invalid-scope",
  ],
  [
    "unknown input type",
    (r) => {
      (item(r, 0).inputs as Record<string, Record<string, Json>>).agentDirectory!.type = "object";
    },
    "invalid-input",
  ],
  [
    "unknown input field",
    (r) => {
      (item(r, 0).inputs as Record<string, Record<string, Json>>).agentDirectory!.pattern = ".*";
    },
    "unknown-field",
  ],
  [
    "recipe schema not Core recipe",
    (r) => {
      (item(r, 0).recipe as Record<string, Json>).schema = "urn:example:recipe:1";
    },
    "unsupported-recipe-schema",
  ],
  [
    "unknown origin kind",
    (r) => {
      (r.sources as Record<string, Json>[])[0]!.origin = { kind: "svn" };
    },
    "invalid-origin",
  ],
  [
    "short git revision",
    (r) => {
      (
        (r.sources as Record<string, Record<string, Json>>[])[0]!.origin as Record<string, Json>
      ).revision = "0123abc";
    },
    "invalid-origin",
  ],
  [
    "dependency ref with unknown field",
    (r) => {
      (item(r, 1).dependencies as Record<string, Json>).requires = [{ itemId: "alpha", extra: 1 }];
    },
    "unknown-field",
  ],
  [
    "http archive source in cross-release ref",
    (r) => {
      (item(r, 1).dependencies as Record<string, Json>).requires = [
        {
          itemId: "x",
          itemSha256: sha256("x"),
          release: {
            source: {
              kind: "archive",
              url: "http://example.org/a.tgz",
              sha256: sha256("a"),
              byteLength: 10,
            },
            manifest: { path: "release/release.json", sha256: sha256("m"), byteLength: 10 },
          },
        },
      ];
    },
    "invalid-source",
  ],
];

/** Semantic refusals JSON Schema cannot express; the schema documents them as reader rules. */
const semantic: [string, Mutation, string][] = [
  [
    "items out of order",
    (r) => {
      (r.items as Json[]).reverse();
    },
    "unordered-ids",
  ],
  [
    "duplicate item id",
    (r) => {
      (r.items as Json[]).push(structuredClone(item(r, 0)));
    },
    "duplicate-id",
  ],
  [
    "unknown source id",
    (r) => {
      item(r, 0).sourceIds = ["missing"];
    },
    "unknown-source",
  ],
  [
    "materials out of order",
    (r) => {
      (item(r, 0).materials as Json[]).reverse();
    },
    "unordered-ids",
  ],
  [
    "same path, different bytes",
    (r) => {
      (item(r, 0).materials as Record<string, Json>[])[1]!.path = "release/materials/LICENSE";
    },
    "inconsistent-material-path",
  ],
  [
    "same path across items with different bytes",
    (r) => {
      (item(r, 1).materials as Record<string, Json>[])[0]!.byteLength = 1;
    },
    "inconsistent-material-path",
  ],
  [
    "self dependency",
    (r) => {
      (item(r, 0).dependencies as Record<string, Json>).requires = [{ itemId: "alpha" }];
    },
    "self-dependency",
  ],
  [
    "required cycle",
    (r) => {
      (item(r, 0).dependencies as Record<string, Json>).requires = [{ itemId: "beta" }];
    },
    "dependency-cycle",
  ],
  [
    "unknown same-release dependency",
    (r) => {
      (item(r, 1).dependencies as Record<string, Json>).requires = [{ itemId: "gamma" }];
    },
    "unknown-item",
  ],
  [
    "default outside bounds",
    (r) => {
      (item(r, 0).inputs as Record<string, Record<string, Json>>).agentDirectory!.maxLength = 3;
    },
    "input-default",
  ],
  [
    "sensitive input with default",
    (r) => {
      (item(r, 1).inputs as Record<string, Record<string, Json>>).token!.default = "secret";
    },
    "input-default",
  ],
  [
    "string bounds on boolean",
    (r) => {
      (item(r, 1).inputs as Record<string, Record<string, Json>>).enabled!.minLength = 1;
    },
    "input-bounds",
  ],
  [
    "enum value of the wrong type",
    (r) => {
      (item(r, 1).inputs as Record<string, Record<string, Json>>).mode!.enum = ["fast", 1];
    },
    "input-enum",
  ],
];

describe("release schema and reader agree", () => {
  it("accepts the valid fixture under both", () => {
    expect(validateSchema(fixtureRelease()), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(read(fixtureRelease()).valid).toBe(true);
  });

  it.each(structural)("rejects %s under both", (_name, mutate, reason) => {
    const release = fixtureRelease();
    mutate(release);
    expect(validateSchema(release)).toBe(false);
    expect(reasons(release)).toContain(reason);
  });

  it.each(semantic)("rejects %s in the reader", (_name, mutate, reason) => {
    const release = fixtureRelease();
    mutate(release);
    expect(reasons(release)).toContain(reason);
  });

  it("names an unsupported release format with encountered and supported IDs", () => {
    const release = fixtureRelease();
    release.schema = "urn:aihq:catalog:release:2.0.0";
    const result = read(release);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.diagnostics[0]).toMatchObject({
      code: "SCHEMA_UNSUPPORTED",
      reason: "unsupported-schema",
      encountered: "urn:aihq:catalog:release:2.0.0",
      supported: ["urn:aihq:catalog:release:1.0.0"],
    });
  });

  it("keeps descriptive metadata inert and preserved", () => {
    const release = fixtureRelease();
    release.metadata = { anything: { nested: [1, "two", null] } };
    const result = read(release);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.release.metadata).toEqual({ anything: { nested: [1, "two", null] } });
    expect(result.release.items[1]?.metadata).toEqual({ note: "descriptive only" });
  });
});

describe("release byte admission", () => {
  const valid = `${JSON.stringify(fixtureRelease())}`;
  const cases: [string, Uint8Array, string][] = [
    [
      "missing LF",
      encode(new TextDecoder().decode(releaseBytes(fixtureRelease())).slice(0, -1)),
      "non-canonical-bytes",
    ],
    [
      "two LFs",
      encode(`${new TextDecoder().decode(releaseBytes(fixtureRelease()))}\n`),
      "non-canonical-bytes",
    ],
    [
      "CRLF",
      encode(`${new TextDecoder().decode(releaseBytes(fixtureRelease())).slice(0, -1)}\r\n`),
      "non-canonical-bytes",
    ],
    [
      "byte order mark",
      new Uint8Array([0xef, 0xbb, 0xbf, ...releaseBytes(fixtureRelease())]),
      "non-canonical-bytes",
    ],
    [
      "pretty printed",
      encode(`${JSON.stringify(JSON.parse(valid), null, 2)}\n`),
      "non-canonical-bytes",
    ],
    [
      "duplicate key",
      encode(
        `{"items":[],"items":[],"package":{"name":"a","version":"1.0.0"},"schema":"urn:aihq:catalog:release:1.0.0","sources":[]}\n`,
      ),
      "non-canonical-bytes",
    ],
    [
      "escaped spelling",
      encode(
        `{"items":[],"package":{"name":"\\u0061","version":"1.0.0"},"schema":"urn:aihq:catalog:release:1.0.0","sources":[]}\n`,
      ),
      "non-canonical-bytes",
    ],
    ["invalid UTF-8", new Uint8Array([0x7b, 0xff, 0x7d, 0x0a]), "malformed-utf8"],
    [
      "non-NFC string",
      encode(
        `{"items":[],"package":{"name":"e\u0301","version":"1.0.0"},"schema":"urn:aihq:catalog:release:1.0.0","sources":[]}\n`,
      ),
      "non-nfc-string",
    ],
    [
      "unsafe integer",
      encode(
        `{"items":[],"metadata":{"n":9007199254740993},"package":{"name":"a","version":"1.0.0"},"schema":"urn:aihq:catalog:release:1.0.0","sources":[]}\n`,
      ),
      "non-canonical-bytes",
    ],
    [
      "33 levels",
      encode(
        `{"items":[],"metadata":{"n":${"[".repeat(31)}${"]".repeat(31)}},"package":{"name":"a","version":"1.0.0"},"schema":"urn:aihq:catalog:release:1.0.0","sources":[]}\n`,
      ),
      "depth-limit",
    ],
  ];
  it.each(cases)("refuses %s", (_name, bytes, reason) => {
    const result = readRelease(bytes, { expectedSha256: sha256(bytes) });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.diagnostics.map((d) => d.reason)).toContain(reason);
  });

  it("admits exactly 32 levels", () => {
    const bytes = encode(
      `{"items":[],"metadata":{"n":${"[".repeat(30)}${"]".repeat(30)}},"package":{"name":"a","version":"1.0.0"},"schema":"urn:aihq:catalog:release:1.0.0","sources":[]}\n`,
    );
    expect(readRelease(bytes, { expectedSha256: sha256(bytes) }).valid).toBe(true);
  });

  it("refuses more than 16 MiB including the LF before parsing", () => {
    const filler = "x".repeat(16 * 1024 * 1024);
    const bytes = encode(
      `{"items":[],"metadata":{"f":"${filler}"},"package":{"name":"a","version":"1.0.0"},"schema":"urn:aihq:catalog:release:1.0.0","sources":[]}\n`,
    );
    const result = readRelease(bytes, { expectedSha256: sha256(bytes) });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.diagnostics.map((d) => d.reason)).toEqual(["byte-limit"]);
  });

  it("refuses a read with no expected integrity", () => {
    const bytes = releaseBytes(fixtureRelease());
    const result = readRelease(bytes, {} as { expectedSha256: string });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.diagnostics.map((d) => d.reason)).toEqual(["expected-sha256-required"]);
  });
});
