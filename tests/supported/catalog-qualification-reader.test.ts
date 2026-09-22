import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CatalogContentV1,
  readCatalogContentV1,
} from "../../src/content/catalog-content-v1.js";
import {
  CATALOG_QUALIFICATION_FORMAT_V1,
  CATALOG_QUALIFICATION_MAX_BYTES_V1,
  CATALOG_QUALIFICATION_ROOT_URL,
  CATALOG_QUALIFICATION_SUBPATH_V1,
  CATALOG_QUALIFICATION_VERSION_V1,
  CATALOG_SIGNED_CATALOG_ROOT_URL,
  CATALOG_SIGNED_CATALOG_SUBPATH_V1,
  readCatalogQualificationV1,
  resolveCatalogQualificationPathV1,
} from "../../src/content/catalog-qualification-v1.js";
import * as publicApi from "../../src/index.js";
import {
  canonicalQualificationReceiptBytes,
  deriveQualificationBasisV2,
  emitQualificationReceipt,
  parseQualificationReceiptSetV1Json,
  verifySignedCatalogV2,
} from "../../src/supported/signed-catalog-v2.js";

const root = resolve(import.meta.dirname, "..", "..");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const readRoot = (path: string) => readFileSync(resolve(root, ...path.split("/")));

/** The real shipped index and sidecar, read from this checkout. Real data, never a fixture. */
const index = readCatalogContentV1({
  bytes: readRoot("defaults/catalog-index-v1.json"),
}) as CatalogContentV1;
const shippedBytes = readRoot(CATALOG_QUALIFICATION_ROOT_URL);
const shipped = JSON.parse(shippedBytes.toString("utf8"));
const inputs = JSON.parse(
  readRoot("defaults/catalog-qualification-inputs-v1.json").toString("utf8"),
);

const NAMED_ENTRY = "agent.aih.governance-quality.core-0-6-2";
const OTHER_ENTRY: string = shipped.entries.find(
  (entry: { entryId: string }) => entry.entryId !== NAMED_ENTRY,
).entryId;
/** Inside the shipped head's window and after every receipt's `notBefore`. */
const NOW = "2026-09-22T12:00:00Z";

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
/** The shipped document narrowed to the named entry: same bytes, fewer records. */
function subset(entryIds: readonly string[] = [NAMED_ENTRY]): Doc {
  const doc = clone();
  doc.entries = doc.entries.filter((entry: { entryId: string }) =>
    entryIds.includes(entry.entryId),
  );
  return doc;
}
const entryOf = (doc: Doc, entryId = NAMED_ENTRY) =>
  doc.entries.find((entry: { entryId: string }) => entry.entryId === entryId);

/** Serves the package's real bytes, with named substitutions, so refusals stay byte-exact. */
function reader(overrides: Record<string, Uint8Array | undefined> = {}) {
  return ({ path }: { path: string; sha256: string }) =>
    Object.hasOwn(overrides, path) ? overrides[path] : readRoot(path);
}

const readSubset = (doc: Doc, overrides: Record<string, Uint8Array | undefined> = {}) =>
  readCatalogQualificationV1({
    bytes: bytesOf(doc),
    index,
    now: NOW,
    input: { root, verifyReceipts: true, verifySignature: true, readFile: reader(overrides) },
  });

const stateOf = (doc: Doc, overrides: Record<string, Uint8Array | undefined> = {}) =>
  readSubset(doc, overrides)?.entries[0]?.state;

describe("published catalog qualification basis", () => {
  it("qualifies every shipped member against the signed head it ships", () => {
    const document = readCatalogQualificationV1({
      bytes: shippedBytes,
      index,
      now: NOW,
      expectedDigest: `sha256:${sha256(shippedBytes)}`,
      input: { root, verifyReceipts: true, verifySignature: true },
    });
    expect(document).toBeDefined();
    if (document === undefined) throw new Error("the shipped qualification basis was refused");
    expect(document.format).toBe(CATALOG_QUALIFICATION_FORMAT_V1);
    expect(document.version).toBe(CATALOG_QUALIFICATION_VERSION_V1);
    expect(document.organizationAdmission).toBe("not-authoritative");
    expect(document.signature).toBe("verified");
    // Nothing in this package is attested; that needs the owner's dispatch.
    expect(document.attestation).toBe("absent");
    expect(document.publisher.repository).toBe("samartomar/aih-catalog");
    expect(document.publisher.workflow).toBe(".github/workflows/signed-catalog-v2.yml");
    expect(document.publisher.locator).toBeNull();
    expect(document.coverage.entries).toBe(index.entries.length);
    expect(document.coverage.qualified).toBe(index.entries.length);
    expect(document.entries.every((entry) => entry.state === "qualified")).toBe(true);
    expect(document.issuedAt).toBe(inputs.issuedAt);
  }, 180_000);

  it("derives the named entry's basis from the head itself, byte for byte", () => {
    const signed = JSON.parse(readRoot(CATALOG_SIGNED_CATALOG_ROOT_URL).toString("utf8"));
    const signerRoot = JSON.parse(readRoot("defaults/catalog-signer-root.json").toString("utf8"));
    const emission = {
      catalogSignerRoots: [signerRoot],
      expectedClaims: shipped.catalog.claims,
      lastAccepted: signed.head,
      now: shipped.issuedAt,
      replay: { acceptedIdentities: [] },
      signed,
    };
    const head = verifySignedCatalogV2(emission);
    const basis = deriveQualificationBasisV2({ entryId: NAMED_ENTRY, head });
    const receipt = JSON.parse(readRoot(entryOf(clone()).receipt.path).toString("utf8"));
    expect(canonical(receipt.qualificationBasis)).toBe(canonical(basis));

    // The committed receipt bytes are exactly what the emitter produces today.
    for (const entryId of [
      shipped.entries[0].entryId,
      NAMED_ENTRY,
      shipped.entries.at(-1).entryId,
    ]) {
      const emitted = canonicalQualificationReceiptBytes(
        emitQualificationReceipt({ ...emission, entryId }),
      );
      expect(readRoot(entryOf(clone(), entryId).receipt.path).equals(emitted)).toBe(true);
    }
  }, 60_000);

  it("publishes a receipt set and trust material whose digests it declares", () => {
    const set = parseQualificationReceiptSetV1Json(
      readRoot(shipped.receiptSet.path).toString("utf8"),
    ) as {
      entries: Array<{
        entryId: string;
        memberDigest: string;
        path: string;
        receiptSha256: string;
      }>;
    };
    expect(sha256(readRoot(shipped.receiptSet.path))).toBe(shipped.receiptSet.sha256);
    expect(sha256(readRoot(shipped.signedCatalog.path))).toBe(shipped.signedCatalog.sha256);
    expect(set.entries).toHaveLength(shipped.entries.length);
    for (const [position, manifest] of set.entries.entries()) {
      const declared = shipped.entries[position];
      expect(manifest.entryId).toBe(declared.entryId);
      expect(manifest.memberDigest).toBe(declared.catalogMemberDigest);
      expect(manifest.path).toBe(`receipts/${declared.entryId}.json`);
      expect(manifest.receiptSha256).toBe(declared.receipt.sha256);
      expect(declared.receipt.path).toBe(
        `defaults/qualification/receipts/${declared.entryId}.json`,
      );
    }
    // Public SPKI material only: no private key reaches the package.
    const signerRoot = JSON.parse(readRoot("defaults/catalog-signer-root.json").toString("utf8"));
    expect(Object.keys(signerRoot).sort()).toEqual([
      "class",
      "identity",
      "keyId",
      "publicKeySpkiDerBase64",
      "publicKeySpkiSha256",
    ]);
    expect(shipped.signerRoots).toEqual([signerRoot]);
  });

  it("exports the readers, the constants and the two new subpaths", () => {
    expect(typeof publicApi.readCatalogQualificationV1).toBe("function");
    expect(typeof publicApi.resolveCatalogQualificationPathV1).toBe("function");
    expect(publicApi.CATALOG_QUALIFICATION_SUBPATH_V1).toBe("./catalog-qualification.json");
    expect(publicApi.CATALOG_SIGNED_CATALOG_SUBPATH_V1).toBe("./signed-catalog.json");
    const packageJson = JSON.parse(readRoot("package.json").toString("utf8"));
    expect(packageJson.exports[CATALOG_QUALIFICATION_SUBPATH_V1]).toBe(
      `./${CATALOG_QUALIFICATION_ROOT_URL}`,
    );
    expect(packageJson.exports[CATALOG_SIGNED_CATALOG_SUBPATH_V1]).toBe(
      `./${CATALOG_SIGNED_CATALOG_ROOT_URL}`,
    );
    expect(resolveCatalogQualificationPathV1(root, "defaults/qualification/receipt-set.json")).toBe(
      resolve(root, "defaults", "qualification", "receipt-set.json"),
    );
    expect(resolveCatalogQualificationPathV1(root, "../escape.json")).toBeUndefined();
    expect(resolveCatalogQualificationPathV1(root, "/absolute.json")).toBeUndefined();
  });

  it("evaluates nothing without receipt verification or a clock", () => {
    const declared = readCatalogQualificationV1({ bytes: shippedBytes, index });
    expect(declared?.signature).toBe("not-evaluated");
    expect(declared?.attestation).toBe("absent");
    expect(declared?.entries.every((entry) => entry.state === "not-evaluated")).toBe(true);
    const clockless = readCatalogQualificationV1({
      bytes: bytesOf(subset()),
      index,
      input: { root, verifyReceipts: true, readFile: reader() },
    });
    expect(clockless?.entries[0]?.state).toBe("not-evaluated");
  });

  it("names every way a declared receipt fails to qualify", () => {
    expect(stateOf(subset())).toBe("qualified");

    const receiptPath = entryOf(subset()).receipt.path;
    expect(stateOf(subset(), { [receiptPath]: undefined })).toBe("receipt-absent");

    const receiptBytes = readRoot(receiptPath);
    const mutated = Uint8Array.from(receiptBytes);
    mutated[mutated.length - 2] = mutated[mutated.length - 2] === 0x30 ? 0x31 : 0x30;
    expect(stateOf(subset(), { [receiptPath]: mutated })).toBe("receipt-digest-mismatch");

    // Bytes that hash to what the document declares but are not a receipt.
    const malformed = Buffer.from('{"format":"aih-supported-qualification-receipt"}', "utf8");
    const malformedDoc = subset();
    entryOf(malformedDoc).receipt.sha256 = sha256(malformed);
    expect(stateOf(malformedDoc, { [receiptPath]: malformed })).toBe("receipt-malformed");

    // Another member's receipt: valid bytes, wrong entry.
    const otherBytes = readRoot(`defaults/qualification/receipts/${OTHER_ENTRY}.json`);
    const swapped = subset();
    entryOf(swapped).receipt.sha256 = sha256(otherBytes);
    expect(stateOf(swapped, { [receiptPath]: otherBytes })).toBe("receipt-malformed");

    // Wrong member: another entry's catalogMemberDigest, never repaired into a pass.
    const wrongMember = subset();
    entryOf(wrongMember).catalogMemberDigest = entryOf(clone(), OTHER_ENTRY).catalogMemberDigest;
    expect(stateOf(wrongMember)).toBe("member-mismatch");

    // Wrong subject: the index entry's subject digest is not the receipt's.
    const otherSubject = index.entries.find(
      (entry) => entry.entryId !== NAMED_ENTRY,
    ) as CatalogContentV1["entries"][number];
    const wrongSubject = subset();
    entryOf(wrongSubject).subjectDigest = otherSubject.subject.subjectDigest;
    const restated = {
      ...index,
      entries: index.entries.map((entry) =>
        entry.entryId === NAMED_ENTRY
          ? {
              ...entry,
              subject: { ...entry.subject, subjectDigest: otherSubject.subject.subjectDigest },
            }
          : entry,
      ),
    } as CatalogContentV1;
    expect(
      readCatalogQualificationV1({
        bytes: bytesOf(wrongSubject),
        index: restated,
        now: NOW,
        input: { root, verifyReceipts: true, readFile: reader() },
      })?.entries[0]?.state,
    ).toBe("subject-mismatch");

    // Wrong catalog identity: the receipt binds a different catalog digest.
    const wrongBasis = subset();
    wrongBasis.catalog.catalogDigest = `sha256:${"0".repeat(64)}`;
    expect(
      readCatalogQualificationV1({
        bytes: bytesOf(wrongBasis),
        index,
        now: NOW,
        input: { root, verifyReceipts: true, readFile: reader() },
      })?.entries[0]?.state,
    ).toBe("basis-mismatch");

    // A window this document invented for an entry is not the receipt's own window.
    const wrongWindow = subset();
    entryOf(wrongWindow).expiresAt = "2026-12-07T00:47:41Z";
    expect(
      readCatalogQualificationV1({
        bytes: bytesOf(wrongWindow),
        index,
        now: NOW,
        input: { root, verifyReceipts: true, readFile: reader() },
      })?.entries[0]?.state,
    ).toBe("basis-mismatch");
  }, 60_000);

  it("separates expiry from not-yet-valid and from malformed", () => {
    const expired = readCatalogQualificationV1({
      bytes: bytesOf(subset()),
      index,
      now: entryOf(clone()).expiresAt,
      input: { root, verifyReceipts: true, readFile: reader() },
    });
    expect(expired?.entries[0]?.state).toBe("expired");

    const early = readCatalogQualificationV1({
      bytes: bytesOf(subset()),
      index,
      now: "2026-09-21T23:59:59Z",
      input: { root, verifyReceipts: true, readFile: reader() },
    });
    expect(early?.entries[0]?.state).toBe("not-yet-valid");
  });

  it("demotes every entry when no supplied root signed the shipped head", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const fingerprint = sha256(der);
    const foreign = subset();
    // A real, well-formed root that never signed this catalog.
    foreign.signerRoots = [
      {
        class: "administrator-ed25519",
        identity: "administrator:test-publisher/never-official",
        keyId: `ed25519:${fingerprint}`,
        publicKeySpkiDerBase64: der.toString("base64"),
        publicKeySpkiSha256: fingerprint,
      },
    ];
    const document = readSubset(foreign);
    expect(document?.signature).toBe("untrusted-signer");
    expect(document?.attestation).toBe("not-evaluated");
    expect(document?.entries.every((entry) => entry.state === "not-evaluated")).toBe(true);
    expect(document?.entries.some((entry) => entry.state === "qualified")).toBe(false);
  });

  it("reports a head that is not the one it describes as superseded", () => {
    const genesis = JSON.parse(readRoot("catalog/genesis/signed-catalog-v2.json").toString("utf8"))
      .head.catalogHeadSha256 as string;
    const other = subset();
    other.catalog.catalogHeadDigest = `sha256:${genesis}`;
    other.catalog.replayIdentity = `catalog-head:${genesis}:${"0".repeat(64)}`;
    const document = readSubset(other);
    expect(document?.signature).toBe("superseded");
    expect(document?.entries.every((entry) => entry.state === "not-evaluated")).toBe(true);

    // A document describing another head, issued before the shipped head's window
    // opened: the shipped head still verifies under its own window, so it is superseded,
    // not an untrusted signer.
    const earlier = subset();
    earlier.catalog.catalogHeadDigest = `sha256:${genesis}`;
    earlier.catalog.replayIdentity = `catalog-head:${genesis}:${"0".repeat(64)}`;
    earlier.catalog.validFrom = "2026-08-28T09:27:42Z";
    earlier.catalog.validUntil = "2026-09-27T09:27:42Z";
    earlier.issuedAt = "2026-09-01T00:00:00Z";
    expect(readSubset(earlier)?.signature).toBe("superseded");

    // The described head, restated with claims it was not signed under: the head is
    // authentic and is the one described, but the document misstates it, so nothing
    // is evaluated and nothing qualifies.
    const otherClaims = subset();
    otherClaims.catalog.claims.repositoryId = "1";
    const claimed = readSubset(otherClaims);
    expect(claimed?.signature).toBe("not-evaluated");
    expect(claimed?.entries.some((entry) => entry.state === "qualified")).toBe(false);
  });

  it("cannot evaluate a signature when the shipped head is absent or re-cut", () => {
    const absent = readSubset(subset(), { [CATALOG_SIGNED_CATALOG_ROOT_URL]: undefined });
    expect(absent?.signature).toBe("not-evaluated");
    expect(absent?.entries.every((entry) => entry.state === "not-evaluated")).toBe(true);

    const rewritten = Buffer.from(
      `${readRoot(CATALOG_SIGNED_CATALOG_ROOT_URL).toString("utf8")} `,
      "utf8",
    );
    const drifted = readSubset(subset(), { [CATALOG_SIGNED_CATALOG_ROOT_URL]: rewritten });
    expect(drifted?.signature).toBe("not-evaluated");
  });

  it("refuses every structural defect, exactly as the index reader does", () => {
    const refusals: Array<[string, unknown]> = [
      ["byte order mark", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), shippedBytes])],
      ["empty", new Uint8Array()],
      ["not bytes", "{}"],
      ["non-canonical", Buffer.from(`${JSON.stringify(shipped, null, 2)}\n`, "utf8")],
      ["no trailing newline", Buffer.from(canonical(shipped), "utf8")],
    ];
    for (const [reason, bytes] of refusals) {
      expect(
        readCatalogQualificationV1({ bytes: bytes as Uint8Array, index }),
        reason,
      ).toBeUndefined();
    }
    expect(
      readCatalogQualificationV1({
        bytes: Buffer.alloc(CATALOG_QUALIFICATION_MAX_BYTES_V1 + 1, 0x20),
        index,
      }),
    ).toBeUndefined();
    expect(
      readCatalogQualificationV1({
        bytes: shippedBytes,
        index,
        expectedDigest: `sha256:${"0".repeat(64)}`,
      }),
    ).toBeUndefined();
    expect(
      readCatalogQualificationV1({ bytes: shippedBytes, index, now: "not an instant" }),
    ).toBeUndefined();

    const mutations: Array<[string, (doc: Doc) => void]> = [
      [
        "unknown format",
        (doc) => {
          doc.format = "aih-catalog-qualification-v2";
        },
      ],
      [
        "unknown version",
        (doc) => {
          doc.version = 2;
        },
      ],
      [
        "extra member",
        (doc) => {
          doc.extra = true;
        },
      ],
      [
        "missing member",
        (doc) => {
          delete doc.receiptSet;
        },
      ],
      [
        "entry absent from the index",
        (doc) => {
          entryOf(doc).entryId = "zzz.not.in.the.index";
        },
      ],
      [
        "declared subject is not the index's",
        (doc) => {
          entryOf(doc).subjectDigest = `sha256:${"1".repeat(64)}`;
        },
      ],
      [
        "unsafe receipt path",
        (doc) => {
          entryOf(doc).receipt.path = "../outside.json";
        },
      ],
      [
        "absolute receipt path",
        (doc) => {
          entryOf(doc).receipt.path = "/etc/passwd";
        },
      ],
      [
        "unsorted entries",
        (doc) => {
          doc.entries = [...doc.entries].reverse();
        },
      ],
      [
        "duplicate entry",
        (doc) => {
          doc.entries = [entryOf(doc), structuredClone(entryOf(doc))];
        },
      ],
      [
        "no entries",
        (doc) => {
          doc.entries = [];
        },
      ],
      [
        "signer root fingerprint drift",
        (doc) => {
          doc.signerRoots[0].publicKeySpkiSha256 = "0".repeat(64);
        },
      ],
      [
        "signer root key id drift",
        (doc) => {
          doc.signerRoots[0].keyId = `ed25519:${"0".repeat(64)}`;
        },
      ],
      [
        "no signer roots",
        (doc) => {
          doc.signerRoots = [];
        },
      ],
      [
        "claims that do not name the publisher",
        (doc) => {
          doc.catalog.claims.repository = "someone-else/aih-catalog";
        },
      ],
      [
        "a claim set with an extra claim",
        (doc) => {
          doc.catalog.claims.extra = "x";
        },
      ],
      [
        "an event other than workflow_dispatch",
        (doc) => {
          doc.catalog.claims.eventName = "push";
        },
      ],
      [
        "issuedAt outside the head's window",
        (doc) => {
          doc.issuedAt = "2026-09-13T00:00:00Z";
        },
      ],
      [
        "an attestation state that is not a known one",
        (doc) => {
          doc.attestation.state = "pending";
        },
      ],
      [
        "a published attestation with no locator",
        (doc) => {
          doc.attestation.state = "published";
        },
      ],
      [
        "a replay identity for another head",
        (doc) => {
          doc.catalog.replayIdentity = `catalog-head:${"2".repeat(64)}:${"3".repeat(64)}`;
        },
      ],
      [
        "a window that ends before it starts",
        (doc) => {
          entryOf(doc).expiresAt = entryOf(doc).notBefore;
        },
      ],
    ];
    for (const [reason, mutate] of mutations) {
      const doc = subset([NAMED_ENTRY, OTHER_ENTRY]);
      mutate(doc);
      expect(readCatalogQualificationV1({ bytes: bytesOf(doc), index }), reason).toBeUndefined();
    }
  });

  it("accepts a future data-only update that publishes an attestation locator", () => {
    const doc = subset();
    doc.attestation.state = "published";
    doc.attestation.locator = {
      kind: "github-attestation",
      repository: "samartomar/aih-catalog",
      sourceDigest: `sha256:${"a".repeat(64)}`,
      subjectDigest: `sha256:${"b".repeat(64)}`,
    };
    const document = readSubset(doc);
    // The reader never verifies an attestation; it reports that one is named.
    expect(document?.attestation).toBe("published-locator");
    expect(document?.publisher.locator?.kind).toBe("github-attestation");
    expect(document?.entries[0]?.state).toBe("qualified");
  });
});
