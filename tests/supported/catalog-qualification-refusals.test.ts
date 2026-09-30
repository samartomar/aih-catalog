// Historical qualification-only evidence; not an active greenfield gate.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CatalogContentV1,
  readCatalogContentV1,
} from "../../src/content/catalog-content-v1.js";
import {
  CATALOG_QUALIFICATION_MAX_BYTES_V1,
  CATALOG_QUALIFICATION_REFUSALS_V1,
  readCatalogQualificationV1,
  readCatalogQualificationV1Result,
} from "../../src/content/catalog-qualification-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const readRoot = (path: string) => readFileSync(resolve(root, path));
const indexBytes = readRoot("defaults/catalog-index-v1.json");
const index = readCatalogContentV1({ bytes: indexBytes }) as CatalogContentV1;

// biome-ignore lint/suspicious/noExplicitAny: the tests mutate untyped published JSON.
type Doc = any;
const parse = (path: string): Doc => JSON.parse(readRoot(path).toString("utf8"));

/** Index and collections: the generator's own key order, `JSON.stringify` plus a newline. */
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

describe("named refusals of the qualification reader", () => {
  const base = (): Doc => parse("defaults/catalog-qualification-v1.json");
  const mutate = (change: (doc: Doc) => void) => () => {
    const doc = base();
    change(doc);
    return { bytes: sorted(doc), index };
  };

  it("reads the shipped sidecar and names every structural refusal", () => {
    const shipped = readCatalogQualificationV1Result(mutate(() => {})() as never);
    if (shipped.state === "refused") throw new Error(`qualification refused: ${shipped.reason}`);
    expect(shipped).toMatchObject({
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
