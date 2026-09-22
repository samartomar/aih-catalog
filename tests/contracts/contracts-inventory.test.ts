import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as api from "../../src/index.js";
import {
  QUALIFICATION_RECEIPT_SET_V1_MAX_BYTES,
  QUALIFICATION_RECEIPT_SET_V1_MAX_ENTRIES,
  QUALIFICATION_RECEIPT_V2_MAX_BYTES,
  STRICT_V2_CORE_LOCK,
} from "../../src/supported/signed-catalog-v2.js";

const root = resolve(import.meta.dirname, "..", "..");
const contracts = readFileSync(resolve(root, "CONTRACTS.md"), "utf8");
const lineOf = (file: string, line: number) =>
  readFileSync(resolve(root, file), "utf8").split("\n")[line - 1] ?? "";
const MiB = 1024 * 1024;

/**
 * Each citation names the line CONTRACTS.md points at and the text that line must
 * hold. A renamed constant, a moved declaration or a bumped literal fails here.
 */
const citations: ReadonlyArray<readonly [file: string, line: number, holds: string]> = [
  ["src/content/catalog-content-v1.ts", 34, 'CATALOG_CONTENT_FORMAT_V1 = "aih-catalog-index"'],
  ["src/content/catalog-content-v1.ts", 35, "CATALOG_CONTENT_VERSION_V1 = 1"],
  ["src/content/catalog-content-v1.ts", 40, "CATALOG_CONTENT_MAX_BYTES_V1 = 64 * 1024 * 1024"],
  ["src/content/catalog-content-v1.ts", 285, "CATALOG_CONTENT_REFUSALS_V1 = ["],
  [
    "src/content/catalog-collections-v1.ts",
    35,
    'CATALOG_COLLECTIONS_FORMAT_V1 = "aih-catalog-collections"',
  ],
  ["src/content/catalog-collections-v1.ts", 36, "CATALOG_COLLECTIONS_VERSION_V1 = 1"],
  ["src/content/catalog-collections-v1.ts", 41, "CATALOG_COLLECTIONS_MAX_BYTES_V1 = 1024 * 1024"],
  ["src/content/catalog-collections-v1.ts", 107, "CATALOG_COLLECTIONS_REFUSALS_V1 = ["],
  [
    "src/content/catalog-presentation-v1.ts",
    30,
    'CATALOG_PRESENTATION_FORMAT_V1 = "aih-catalog-presentation"',
  ],
  ["src/content/catalog-presentation-v1.ts", 31, "CATALOG_PRESENTATION_VERSION_V1 = 1"],
  [
    "src/content/catalog-presentation-v1.ts",
    36,
    "CATALOG_PRESENTATION_MAX_BYTES_V1 = 8 * 1024 * 1024",
  ],
  ["src/content/catalog-presentation-v1.ts", 37, "CATALOG_PRESENTATION_MAX_TEXT_V1 = 4096"],
  ["src/content/catalog-presentation-v1.ts", 106, "CATALOG_PRESENTATION_REFUSALS_V1 = ["],
  [
    "src/content/catalog-qualification-v1.ts",
    48,
    'CATALOG_QUALIFICATION_FORMAT_V1 = "aih-catalog-qualification"',
  ],
  ["src/content/catalog-qualification-v1.ts", 49, "CATALOG_QUALIFICATION_VERSION_V1 = 1"],
  [
    "src/content/catalog-qualification-v1.ts",
    58,
    "CATALOG_QUALIFICATION_MAX_BYTES_V1 = 8 * 1024 * 1024",
  ],
  [
    "src/content/catalog-qualification-v1.ts",
    59,
    "CATALOG_QUALIFICATION_HEAD_MAX_BYTES_V1 = 16 * 1024 * 1024",
  ],
  ["src/content/catalog-qualification-v1.ts", 60, "CATALOG_QUALIFICATION_MAX_ENTRIES_V1 = 512"],
  ["src/content/catalog-qualification-v1.ts", 228, "CATALOG_QUALIFICATION_REFUSALS_V1 = ["],
  [
    "src/content/catalog-categories-v1.ts",
    29,
    'CATALOG_CATEGORIES_FORMAT_V1 = "aih-catalog-categories"',
  ],
  ["src/content/catalog-categories-v1.ts", 30, "CATALOG_CATEGORIES_VERSION_V1 = 1"],
  ["src/content/catalog-categories-v1.ts", 35, "CATALOG_CATEGORIES_MAX_BYTES_V1 = 4 * 1024 * 1024"],
  ["src/content/catalog-categories-v1.ts", 36, "CATALOG_CATEGORIES_MAX_TAXONOMY_V1 = 32"],
  ["src/content/catalog-categories-v1.ts", 96, "CATALOG_CATEGORIES_REFUSALS_V1 = ["],
  [
    "src/content/catalog-source-closure-v1.ts",
    39,
    'CATALOG_SOURCE_CLOSURE_FORMAT_V1 = "aih-catalog-source-closure"',
  ],
  ["src/content/catalog-source-closure-v1.ts", 40, "CATALOG_SOURCE_CLOSURE_VERSION_V1 = 1"],
  [
    "src/content/catalog-source-closure-v1.ts",
    43,
    "CATALOG_SOURCE_FILE_MAX_BYTES_V1 = 16 * 1024 * 1024",
  ],
  [
    "src/content/catalog-source-closure-v1.ts",
    52,
    'CATALOG_ASSESSMENT_PROFILE_FORMAT_V1 = "aih-first-party-qualification-profile"',
  ],
  ["src/content/catalog-source-closure-v1.ts", 53, "CATALOG_ASSESSMENT_PROFILE_VERSION_V1 = 1"],
  ["src/content/catalog-source-closure-v1.ts", 61, "export type CatalogSourceClosureRefusalV1 ="],
  ["src/content/refusal-v1.ts", 13, "CATALOG_REFUSAL_OBSERVED_MAX_CHARS_V1 = 128"],
  ["tools/verify-core-v2-lock.mjs", 11, 'coreCommit = "c31741602b3dbd5f228dafe00591e5679c782878"'],
  ["tools/verify-core-v2-lock.mjs", 18, "schemaSha256 = "],
  ["tools/verify-core-v2-lock.mjs", 20, "receiptSchemaSha256 = "],
  ["tools/verify-core-v2-lock.mjs", 21, "receiptMaxBytes = 5970"],
  ["tools/verify-core-v2-lock.mjs", 22, "receiptSourceMaxBytes = 4096"],
  ["tools/verify-core-v2-lock.mjs", 29, "export const profileContract = Object.freeze({"],
  ["src/supported/signed-catalog-v2.ts", 15, "MAX_HEAD = 8 * 1024 * 1024"],
  ["src/supported/signed-catalog-v2.ts", 16, "MAX_SIGNED = 24 * 1024 * 1024"],
  ["src/supported/signed-catalog-v2.ts", 22, "QUALIFICATION_RECEIPT_V2_MAX_BYTES = 5970"],
  ["src/supported/signed-catalog-v2.ts", 23, "QUALIFICATION_RECEIPT_SET_V1_MAX_ENTRIES = 512"],
  ["src/supported/signed-catalog-v2.ts", 24, "QUALIFICATION_RECEIPT_SET_V1_MAX_BYTES = 256 * 1024"],
  ["src/supported/signed-catalog-v2.ts", 26, "STRICT_V2_CORE_LOCK = Object.freeze({"],
  ["src/supported/signed-catalog-v2.ts", 600, 'protocol: "CatalogHeadV2"'],
  ["src/supported/signed-catalog-v2.ts", 889, 'fail("unsupported-version")'],
  ["src/supported/signed-catalog-v2.ts", 896, 'kind: "unsupported-version"'],
  [
    "src/supported/signed-catalog-v2.ts",
    981,
    'x.format !== "aih-supported-qualification-receipt" || x.version !== 2',
  ],
  [
    "src/supported/signed-catalog-v2.ts",
    1098,
    'x.format !== "aih-supported-qualification-receipt-set" || x.version !== 1',
  ],
];

describe("CONTRACTS.md inventory", () => {
  it("cites each constant at the line that declares it", () => {
    for (const [file, line, holds] of citations) {
      expect(contracts, `${file}:${line} is cited`).toContain(`\`${file}:${line}\``);
      expect(lineOf(file, line), `${file}:${line}`).toContain(holds);
    }
  });

  it("holds no citation that does not resolve to a checked line", () => {
    const cited = [...contracts.matchAll(/`([A-Za-z0-9_./-]+\.(?:ts|mjs)):(\d+)`/gu)].map(
      ([, file, line]) => `${file}:${line}`,
    );
    expect(cited.length).toBeGreaterThan(0);
    const checked = new Set(citations.map(([file, line]) => `${file}:${line}`));
    for (const citation of cited) {
      expect(checked.has(citation), citation).toBe(true);
      const [file] = citation.split(":");
      expect(existsSync(resolve(root, file as string)), citation).toBe(true);
    }
  });

  it("states the values the published readers actually enforce", () => {
    const rows: ReadonlyArray<readonly [unknown, string | number]> = [
      [api.CATALOG_CONTENT_FORMAT_V1, "aih-catalog-index"],
      [api.CATALOG_CONTENT_VERSION_V1, 1],
      [api.CATALOG_CONTENT_MAX_BYTES_V1, 64 * MiB],
      [api.CATALOG_COLLECTIONS_FORMAT_V1, "aih-catalog-collections"],
      [api.CATALOG_COLLECTIONS_VERSION_V1, 1],
      [api.CATALOG_COLLECTIONS_MAX_BYTES_V1, MiB],
      [api.CATALOG_PRESENTATION_FORMAT_V1, "aih-catalog-presentation"],
      [api.CATALOG_PRESENTATION_VERSION_V1, 1],
      [api.CATALOG_PRESENTATION_MAX_BYTES_V1, 8 * MiB],
      [api.CATALOG_QUALIFICATION_FORMAT_V1, "aih-catalog-qualification"],
      [api.CATALOG_QUALIFICATION_VERSION_V1, 1],
      [api.CATALOG_QUALIFICATION_MAX_BYTES_V1, 8 * MiB],
      [api.CATALOG_CATEGORIES_FORMAT_V1, "aih-catalog-categories"],
      [api.CATALOG_CATEGORIES_VERSION_V1, 1],
      [api.CATALOG_CATEGORIES_MAX_BYTES_V1, 4 * MiB],
      [api.CATALOG_SOURCE_CLOSURE_FORMAT_V1, "aih-catalog-source-closure"],
      [api.CATALOG_SOURCE_CLOSURE_VERSION_V1, 1],
      [api.CATALOG_SOURCE_FILE_MAX_BYTES_V1, 16 * MiB],
      [api.CATALOG_ASSESSMENT_PROFILE_FORMAT_V1, "aih-first-party-qualification-profile"],
      [api.CATALOG_ASSESSMENT_PROFILE_VERSION_V1, 1],
      [api.CATALOG_REFUSAL_OBSERVED_MAX_CHARS_V1, 128],
      [QUALIFICATION_RECEIPT_V2_MAX_BYTES, 5970],
      [QUALIFICATION_RECEIPT_SET_V1_MAX_ENTRIES, 512],
      [QUALIFICATION_RECEIPT_SET_V1_MAX_BYTES, 256 * 1024],
    ];
    for (const [actual, expected] of rows) expect(actual).toBe(expected);
    for (const format of [
      "aih-catalog-index",
      "aih-catalog-collections",
      "aih-catalog-presentation",
      "aih-catalog-qualification",
      "aih-catalog-categories",
      "aih-catalog-source-closure",
      "aih-first-party-qualification-profile",
      "aih-supported-qualification-receipt",
      "aih-supported-qualification-receipt-set",
      "CatalogHeadV2",
    ])
      expect(contracts, format).toContain(format);
    // Every closed refusal list and each named reason CONTRACTS.md relies on.
    for (const [name, reasons] of [
      ["CATALOG_CONTENT_REFUSALS_V1", api.CATALOG_CONTENT_REFUSALS_V1],
      ["CATALOG_COLLECTIONS_REFUSALS_V1", api.CATALOG_COLLECTIONS_REFUSALS_V1],
      ["CATALOG_PRESENTATION_REFUSALS_V1", api.CATALOG_PRESENTATION_REFUSALS_V1],
      ["CATALOG_QUALIFICATION_REFUSALS_V1", api.CATALOG_QUALIFICATION_REFUSALS_V1],
      ["CATALOG_CATEGORIES_REFUSALS_V1", api.CATALOG_CATEGORIES_REFUSALS_V1],
    ] as const) {
      expect(contracts, name).toContain(name);
      expect(reasons as readonly string[]).toContain("unknown-format");
      expect(reasons as readonly string[]).toContain("unknown-version");
    }
    expect(api.CATALOG_COLLECTIONS_REFUSALS_V1).toContain("unknown-owner");
    expect(api.CATALOG_COLLECTIONS_REFUSALS_V1).toContain("index-mismatch");
    expect(contracts).toContain("profile-unknown-version");
  });

  it("states Catalog's Core lock exactly as the code pins it", () => {
    expect(contracts).toContain(STRICT_V2_CORE_LOCK.coreCommit);
    expect(contracts).toContain(STRICT_V2_CORE_LOCK.corePackageManifestSha256);
    expect(contracts).toContain(STRICT_V2_CORE_LOCK.schemaSha256);
    expect(contracts).toContain(STRICT_V2_CORE_LOCK.receiptSchemaSha256);
    expect(contracts).toContain(`\`${STRICT_V2_CORE_LOCK.corePackageVersion}\``);
    expect(contracts).toContain("2b3212f22e9f7006455b75f29377be3add58fac7");
    const lock = readFileSync(resolve(root, "tools/verify-core-v2-lock.mjs"), "utf8");
    for (const value of [
      STRICT_V2_CORE_LOCK.coreCommit,
      STRICT_V2_CORE_LOCK.corePackageManifestSha256,
      STRICT_V2_CORE_LOCK.schemaSha256,
      STRICT_V2_CORE_LOCK.receiptSchemaSha256,
      "2b3212f22e9f7006455b75f29377be3add58fac7",
    ])
      expect(lock).toContain(value);
    for (const refusal of [
      "profile-mirror-drift",
      "core-profile-drift",
      "vendored-lock-drift",
      "core-schema-digest",
      "core-commit",
      "core-dirty",
    ]) {
      expect(contracts, refusal).toContain(refusal);
      expect(lock, refusal).toContain(refusal);
    }
  });
});
