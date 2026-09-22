import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATALOG_CATEGORIES_MAX_BYTES_V1,
  CATALOG_CATEGORIES_REFUSALS_V1,
  readCatalogCategoriesV1,
  readCatalogCategoriesV1Result,
} from "../../src/content/catalog-categories-v1.js";
import {
  CATALOG_COLLECTIONS_MAX_BYTES_V1,
  CATALOG_COLLECTIONS_REFUSALS_V1,
  readCatalogCollectionsV1,
  readCatalogCollectionsV1Result,
} from "../../src/content/catalog-collections-v1.js";
import {
  CATALOG_CONTENT_MAX_BYTES_V1,
  CATALOG_CONTENT_REFUSALS_V1,
  type CatalogContentV1,
  readCatalogContentV1,
  readCatalogContentV1Result,
} from "../../src/content/catalog-content-v1.js";
import {
  CATALOG_PRESENTATION_MAX_BYTES_V1,
  CATALOG_PRESENTATION_REFUSALS_V1,
  readCatalogPresentationV1,
  readCatalogPresentationV1Result,
} from "../../src/content/catalog-presentation-v1.js";
import {
  CATALOG_QUALIFICATION_MAX_BYTES_V1,
  CATALOG_QUALIFICATION_REFUSALS_V1,
  readCatalogQualificationV1,
  readCatalogQualificationV1Result,
} from "../../src/content/catalog-qualification-v1.js";
import { CATALOG_REFUSAL_OBSERVED_MAX_CHARS_V1 } from "../../src/content/refusal-v1.js";
import * as publicApi from "../../src/index.js";

const root = resolve(import.meta.dirname, "..", "..");
const readRoot = (path: string) => readFileSync(resolve(root, path));
const indexBytes = readRoot("defaults/catalog-index-v1.json");
const index = readCatalogContentV1({ bytes: indexBytes }) as CatalogContentV1;

// biome-ignore lint/suspicious/noExplicitAny: the tests mutate untyped published JSON.
type Doc = any;
const parse = (path: string): Doc => JSON.parse(readRoot(path).toString("utf8"));

/** Index and collections: the generator's own key order, `JSON.stringify` plus a newline. */
const inOrder = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
/** Presentation, qualification and categories: sorted keys plus a newline. */
function sorted(value: unknown): Buffer {
  const serialize = (item: unknown): string => {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(serialize).join(",")}]`;
    const object = item as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serialize(object[key])}`)
      .join(",")}}`;
  };
  return Buffer.from(`${serialize(value)}\n`, "utf8");
}
const pretty = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
const ZERO = `sha256:${"0".repeat(64)}`;

interface Case {
  readonly reason: string;
  readonly request: () => unknown;
  readonly observed?: string;
}

/**
 * Every reason in a reader's closed union is produced by a case, each case yields
 * exactly its reason, and the legacy function returns `undefined` for all of them.
 */
function expectEveryRefusal(
  union: readonly string[],
  cases: readonly Case[],
  result: (request: never) => { state: string; reason?: string; observed?: string },
  legacy: (request: never) => unknown,
): void {
  expect([...new Set(cases.map((item) => item.reason))].sort()).toEqual([...union].sort());
  for (const item of cases) {
    const request = item.request() as never;
    const outcome = result(request);
    expect(outcome, item.reason).toMatchObject({ state: "refused", reason: item.reason });
    if (item.reason === "unknown-format" || item.reason === "unknown-version") {
      expect(outcome.observed, item.reason).toBe(item.observed);
    } else {
      expect(outcome, item.reason).not.toHaveProperty("observed");
    }
    expect(legacy(request), item.reason).toBeUndefined();
  }
}

describe("named refusals of the content index reader", () => {
  const base = (): Doc => {
    const doc = parse("defaults/catalog-index-v1.json");
    doc.entries = doc.entries.slice(0, 3);
    return doc;
  };
  const mutate = (change: (doc: Doc) => void) => () => {
    const doc = base();
    change(doc);
    return { bytes: inOrder(doc) };
  };

  it("reads the shipped index and names every refusal", () => {
    expect(readCatalogContentV1Result({ bytes: indexBytes })).toMatchObject({ state: "read" });
    expect(readCatalogContentV1Result({ bytes: inOrder(base()) })).toMatchObject({
      state: "read",
    });
    expectEveryRefusal(
      CATALOG_CONTENT_REFUSALS_V1,
      [
        { reason: "malformed-request", request: () => null },
        { reason: "malformed-bytes", request: () => ({ bytes: new Uint8Array() }) },
        { reason: "malformed-bytes", request: () => ({ bytes: Uint8Array.from([0xff, 0x0a]) }) },
        { reason: "malformed-bytes", request: () => ({ bytes: Buffer.from("{not json}\n") }) },
        {
          reason: "oversize-bytes",
          request: () => ({ bytes: Buffer.alloc(CATALOG_CONTENT_MAX_BYTES_V1 + 1, 0x20) }),
        },
        { reason: "non-canonical-bytes", request: () => ({ bytes: pretty(base()) }) },
        {
          reason: "non-canonical-bytes",
          request: () => ({
            bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), inOrder(base())]),
          }),
        },
        { reason: "digest-mismatch", request: () => ({ bytes: indexBytes, expectedDigest: ZERO }) },
        { reason: "malformed-document", request: () => ({ bytes: Buffer.from("[]\n") }) },
        {
          reason: "malformed-document",
          request: mutate((doc) => {
            doc.entries = [];
          }),
        },
        {
          reason: "unknown-format",
          observed: '"aih-catalog-index-v2"',
          request: mutate((doc) => {
            doc.format = "aih-catalog-index-v2";
          }),
        },
        {
          reason: "unknown-version",
          observed: "2",
          request: mutate((doc) => {
            doc.version = 2;
          }),
        },
        {
          reason: "malformed-entry",
          request: mutate((doc) => {
            delete doc.entries[1].subject;
          }),
        },
        {
          reason: "duplicate-entry",
          request: mutate((doc) => {
            doc.entries = [doc.entries[0], doc.entries[0]];
          }),
        },
        {
          reason: "unordered-entries",
          request: mutate((doc) => {
            doc.entries = [doc.entries[1], doc.entries[0]];
          }),
        },
        {
          reason: "unsafe-path",
          request: mutate((doc) => {
            doc.entries[0].seed.path = "../outside.json";
          }),
        },
        {
          reason: "evidence-not-bound",
          request: mutate((doc) => {
            doc.entries[0].qualification.report.evidence.subjectDigest = ZERO;
          }),
        },
      ],
      readCatalogContentV1Result,
      readCatalogContentV1,
    );
  });

  it("keeps unknown format and unknown version distinct, each with a bounded observed value", () => {
    const format = readCatalogContentV1Result(
      mutate((doc) => {
        doc.format = "x".repeat(500);
      })() as never,
    );
    expect(format).toMatchObject({ state: "refused", reason: "unknown-format" });
    expect(format.state === "refused" && format.observed?.length).toBe(
      CATALOG_REFUSAL_OBSERVED_MAX_CHARS_V1,
    );
    const missing = readCatalogContentV1Result(
      mutate((doc) => {
        delete doc.version;
      })() as never,
    );
    expect(missing).toEqual({ state: "refused", reason: "unknown-version", observed: "undefined" });
    // The public root exports the result readers and their closed unions.
    expect(publicApi.readCatalogContentV1Result).toBe(readCatalogContentV1Result);
    expect(publicApi.CATALOG_CONTENT_REFUSALS_V1).toBe(CATALOG_CONTENT_REFUSALS_V1);
  });
});

describe("named refusals of the collections reader", () => {
  const base = (): Doc => parse("defaults/catalog-collections-v1.json");
  const mutate = (change: (doc: Doc) => void) => () => {
    const doc = base();
    change(doc);
    return { bytes: inOrder(doc), index };
  };

  it("reads the shipped view and names every refusal", () => {
    expect(readCatalogCollectionsV1Result(mutate(() => {})() as never)).toMatchObject({
      state: "read",
    });
    expectEveryRefusal(
      CATALOG_COLLECTIONS_REFUSALS_V1,
      [
        { reason: "malformed-request", request: () => ({ bytes: inOrder(base()), index: {} }) },
        { reason: "malformed-bytes", request: () => ({ bytes: new Uint8Array(), index }) },
        {
          reason: "oversize-bytes",
          request: () => ({
            bytes: Buffer.alloc(CATALOG_COLLECTIONS_MAX_BYTES_V1 + 1, 0x20),
            index,
          }),
        },
        { reason: "non-canonical-bytes", request: () => ({ bytes: pretty(base()), index }) },
        {
          reason: "malformed-document",
          request: mutate((doc) => {
            doc.extra = true;
          }),
        },
        {
          reason: "unknown-format",
          observed: '"aih-catalog-collections-v2"',
          request: mutate((doc) => {
            doc.format = "aih-catalog-collections-v2";
          }),
        },
        {
          reason: "unknown-version",
          observed: "2",
          request: mutate((doc) => {
            doc.version = 2;
          }),
        },
        {
          reason: "index-mismatch",
          request: mutate((doc) => {
            doc.index.sha256 = "0".repeat(64);
          }),
        },
        {
          reason: "malformed-collection",
          request: mutate((doc) => {
            doc.collections[0].id = "Not An Id";
          }),
        },
        {
          reason: "duplicate-collection",
          request: mutate((doc) => {
            doc.collections[1].id = doc.collections[0].id;
          }),
        },
        {
          reason: "member-not-in-index",
          request: mutate((doc) => {
            doc.collections[0].members[0].subjectDigest = ZERO;
          }),
        },
        {
          reason: "member-not-current",
          request: mutate((doc) => {
            doc.collections[0].current.release = "9.9.9";
            doc.collections[0].current.origin.version = "9.9.9";
          }),
        },
        {
          reason: "duplicate-entry",
          request: mutate((doc) => {
            const members = doc.collections[0].members;
            members.splice(1, 0, members[0]);
          }),
        },
        {
          reason: "unordered-entries",
          request: mutate((doc) => {
            doc.collections[0].members.reverse();
          }),
        },
      ],
      readCatalogCollectionsV1Result,
      readCatalogCollectionsV1,
    );
  });
});

describe("named refusals of the presentation reader", () => {
  const base = (): Doc => parse("defaults/catalog-presentation-v1.json");
  const mutate = (change: (doc: Doc) => void) => () => {
    const doc = base();
    change(doc);
    return { bytes: sorted(doc), index };
  };

  it("reads the shipped sidecar and names every refusal", () => {
    expect(readCatalogPresentationV1Result(mutate(() => {})() as never)).toMatchObject({
      state: "read",
    });
    expectEveryRefusal(
      CATALOG_PRESENTATION_REFUSALS_V1,
      [
        { reason: "malformed-request", request: () => ({ bytes: sorted(base()), index: null }) },
        { reason: "malformed-bytes", request: () => ({ bytes: "{}", index }) },
        {
          reason: "oversize-bytes",
          request: () => ({
            bytes: Buffer.alloc(CATALOG_PRESENTATION_MAX_BYTES_V1 + 1, 0x20),
            index,
          }),
        },
        { reason: "non-canonical-bytes", request: () => ({ bytes: pretty(base()), index }) },
        {
          reason: "malformed-document",
          request: mutate((doc) => {
            doc.extra = true;
          }),
        },
        {
          reason: "unknown-format",
          observed: '"aih-catalog-presentation-v2"',
          request: mutate((doc) => {
            doc.format = "aih-catalog-presentation-v2";
          }),
        },
        {
          reason: "unknown-version",
          observed: "2",
          request: mutate((doc) => {
            doc.version = 2;
          }),
        },
        {
          reason: "malformed-source",
          request: mutate((doc) => {
            doc.sources[0].type = "gitlab";
          }),
        },
        {
          reason: "index-mismatch",
          request: mutate((doc) => {
            doc.entries[0].subjectDigest = ZERO;
          }),
        },
        {
          reason: "malformed-entry",
          request: mutate((doc) => {
            doc.entries[0].extra = true;
          }),
        },
        {
          reason: "unsafe-path",
          request: mutate((doc) => {
            const entry = doc.entries.find((item: Doc) => item.source !== null);
            entry.source.path = "../outside/SKILL.md";
          }),
        },
        {
          reason: "duplicate-entry",
          request: mutate((doc) => {
            doc.entries.splice(1, 0, doc.entries[0]);
          }),
        },
        {
          reason: "unordered-entries",
          request: mutate((doc) => {
            [doc.entries[0], doc.entries[1]] = [doc.entries[1], doc.entries[0]];
          }),
        },
        {
          reason: "coverage-incomplete",
          request: mutate((doc) => {
            doc.entries.pop();
          }),
        },
      ],
      readCatalogPresentationV1Result,
      readCatalogPresentationV1,
    );
  });
});

describe("named refusals of the qualification reader", () => {
  const base = (): Doc => parse("defaults/catalog-qualification-v1.json");
  const mutate = (change: (doc: Doc) => void) => () => {
    const doc = base();
    change(doc);
    return { bytes: sorted(doc), index };
  };

  it("reads the shipped sidecar and names every structural refusal", () => {
    expect(readCatalogQualificationV1Result(mutate(() => {})() as never)).toMatchObject({
      state: "read",
    });
    expectEveryRefusal(
      CATALOG_QUALIFICATION_REFUSALS_V1,
      [
        { reason: "malformed-request", request: () => ({ bytes: sorted(base()), index: [] }) },
        {
          reason: "malformed-clock",
          request: () => ({ bytes: sorted(base()), index, now: "tomorrow" }),
        },
        { reason: "malformed-bytes", request: () => ({ bytes: new Uint8Array(), index }) },
        {
          reason: "oversize-bytes",
          request: () => ({
            bytes: Buffer.alloc(CATALOG_QUALIFICATION_MAX_BYTES_V1 + 1, 0x20),
            index,
          }),
        },
        { reason: "non-canonical-bytes", request: () => ({ bytes: pretty(base()), index }) },
        {
          reason: "digest-mismatch",
          request: () => ({ bytes: sorted(base()), index, expectedDigest: ZERO }),
        },
        {
          reason: "malformed-document",
          request: mutate((doc) => {
            delete doc.receiptSet;
          }),
        },
        {
          reason: "unknown-format",
          observed: '"aih-catalog-qualification-v2"',
          request: mutate((doc) => {
            doc.format = "aih-catalog-qualification-v2";
          }),
        },
        {
          reason: "unknown-version",
          observed: "2",
          request: mutate((doc) => {
            doc.version = 2;
          }),
        },
        {
          reason: "malformed-catalog-identity",
          request: mutate((doc) => {
            doc.catalog.sequence = -1;
          }),
        },
        {
          reason: "issued-outside-window",
          request: mutate((doc) => {
            doc.issuedAt = "2026-09-13T00:00:00Z";
          }),
        },
        {
          reason: "malformed-attestation",
          request: mutate((doc) => {
            doc.attestation.state = "pending";
          }),
        },
        {
          reason: "claims-publisher-mismatch",
          request: mutate((doc) => {
            doc.catalog.claims.repository = "someone-else/aih-catalog";
          }),
        },
        {
          reason: "malformed-signer-root",
          request: mutate((doc) => {
            doc.signerRoots[0].keyId = `ed25519:${"0".repeat(64)}`;
          }),
        },
        {
          reason: "malformed-entry",
          request: mutate((doc) => {
            doc.entries[0].expiresAt = doc.entries[0].notBefore;
          }),
        },
        {
          reason: "unsafe-path",
          request: mutate((doc) => {
            doc.entries[0].receipt.path = "../outside.json";
          }),
        },
        {
          reason: "duplicate-entry",
          request: mutate((doc) => {
            doc.entries.splice(1, 0, doc.entries[0]);
          }),
        },
        {
          reason: "unordered-entries",
          request: mutate((doc) => {
            doc.entries.reverse();
          }),
        },
        {
          reason: "index-mismatch",
          request: mutate((doc) => {
            doc.entries[0].subjectDigest = ZERO;
          }),
        },
      ],
      readCatalogQualificationV1Result,
      readCatalogQualificationV1,
    );
  });
});

describe("named refusals of the categories reader", () => {
  const base = (): Doc => parse("defaults/catalog-categories-v1.json");
  const mutate = (change: (doc: Doc) => void) => () => {
    const doc = base();
    change(doc);
    return { bytes: sorted(doc), index };
  };

  it("reads the shipped dataset and names every refusal", () => {
    expect(readCatalogCategoriesV1Result(mutate(() => {})() as never)).toMatchObject({
      state: "read",
    });
    const reviewer = (doc: Doc) =>
      doc.entries.find((entry: Doc) => entry.entryId === "agent.ecc.python-reviewer");
    const notCurated = (doc: Doc) => doc.entries.find((entry: Doc) => entry.category === null);
    expectEveryRefusal(
      CATALOG_CATEGORIES_REFUSALS_V1,
      [
        { reason: "malformed-request", request: () => undefined },
        { reason: "malformed-bytes", request: () => ({ bytes: new Uint8Array(), index }) },
        {
          reason: "oversize-bytes",
          request: () => ({
            bytes: Buffer.alloc(CATALOG_CATEGORIES_MAX_BYTES_V1 + 1, 0x20),
            index,
          }),
        },
        { reason: "non-canonical-bytes", request: () => ({ bytes: pretty(base()), index }) },
        {
          reason: "digest-mismatch",
          request: () => ({ bytes: sorted(base()), index, expectedDigest: ZERO }),
        },
        {
          reason: "malformed-document",
          request: mutate((doc) => {
            doc.basis = "upstream";
          }),
        },
        {
          reason: "unknown-format",
          observed: '"aih-catalog-categories-v2"',
          request: mutate((doc) => {
            doc.format = "aih-catalog-categories-v2";
          }),
        },
        {
          reason: "unknown-version",
          observed: "2",
          request: mutate((doc) => {
            doc.version = 2;
          }),
        },
        {
          reason: "malformed-taxonomy",
          request: mutate((doc) => {
            doc.taxonomy.reverse();
          }),
        },
        {
          reason: "malformed-entry",
          request: mutate((doc) => {
            notCurated(doc).rationale = "a rationale on a null category";
          }),
        },
        {
          reason: "index-mismatch",
          request: mutate((doc) => {
            reviewer(doc).subjectDigest = ZERO;
          }),
        },
        {
          reason: "unknown-category",
          request: mutate((doc) => {
            reviewer(doc).category = "misc";
          }),
        },
        {
          reason: "duplicate-entry",
          request: mutate((doc) => {
            doc.entries.splice(1, 0, doc.entries[0]);
          }),
        },
        {
          reason: "unordered-entries",
          request: mutate((doc) => {
            doc.entries.reverse();
          }),
        },
        {
          reason: "coverage-incomplete",
          request: mutate((doc) => {
            doc.entries.pop();
          }),
        },
      ],
      readCatalogCategoriesV1Result,
      readCatalogCategoriesV1,
    );
  });
});
