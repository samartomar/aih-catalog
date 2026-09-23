import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATALOG_CONTENT_FORMAT_V1,
  CATALOG_CONTENT_INDEX_ROOT_URL,
  CATALOG_CONTENT_INDEX_SUBPATH_V1,
  CATALOG_CONTENT_MAX_BYTES_V1,
  type CatalogContentV1,
  type CatalogContentV1Input,
  parseCatalogContentV1Bytes,
  readCatalogContentV1,
} from "../../src/content/catalog-content-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const defaults = resolve(root, "defaults");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The real shipped index, read from this checkout. This is real data, never a fixture. */
const shippedBytes = readFileSync(resolve(defaults, "catalog-index-v1.json"));
const shippedText = shippedBytes.toString("utf8");
const shipped = JSON.parse(shippedText) as Record<string, unknown>;

/** Minimal well-formed index built through the same canonical serializer the generator uses. */
const artifact = (bytes: Uint8Array) => ({ path: "a.json", sha256: sha256(bytes), bytes });
const evidence = (kind: string, subjectDigest: string, bytes: Uint8Array) => ({
  path: `${kind}.json`,
  sha256: sha256(bytes),
  bytes,
  evidence: {
    format: "aih-supported-evidence/v2",
    kind,
    id: `${kind}-1`,
    attestor: "operator:test",
    summary: "synthetic unit fixture",
    subjectDigest,
  },
});
function syntheticIndex(overrides: Record<string, unknown> = {}): {
  bytes: Buffer;
  subjectDigest: string;
  subject: Record<string, unknown>;
} {
  const digest = `sha256:${"2".repeat(64)}`;
  const subject = {
    id: "governance-quality",
    kind: "agent",
    source: { type: "aih", release: "0.6.0", revision: `sha256:${"1".repeat(64)}` },
    sourceDigest: `sha256:${"3".repeat(64)}`,
    subjectDigest: digest,
  };
  const value = {
    format: CATALOG_CONTENT_FORMAT_V1,
    version: 1,
    package: { name: "@aihq/catalog", version: "0.2.0" },
    organizationAdmission: "not-authoritative",
    entries: [
      {
        entryId: "agent.aih.governance-quality",
        seed: { path: "seed.json", sha256: sha256(Buffer.from("seed")) },
        subject,
        capabilities: { commands: [], egress: [], hooks: [], mcpTools: [], permissions: [] },
        platforms: [{ os: "linux", architecture: "amd64" }],
        artifacts: {
          closure: artifact(Buffer.from("closure")),
          profile: artifact(Buffer.from("profile")),
          prose: artifact(Buffer.from("prose")),
          recipe: artifact(Buffer.from("recipe")),
        },
        qualification: {
          report: evidence("report", digest, Buffer.from("report")),
          findings: [],
          gaps: [evidence("gap", digest, Buffer.from("gap"))],
          rights: [evidence("right", digest, Buffer.from("right"))],
        },
      },
    ],
    ...overrides,
  };
  return {
    bytes: Buffer.from(`${JSON.stringify(value)}\n`, "utf8"),
    subjectDigest: digest,
    subject,
  };
}

describe("Catalog public content reader", () => {
  it("exposes the published index through a stable subpath export", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(packageJson.exports["./catalog-index.json"]).toBe("./defaults/catalog-index-v1.json");
    expect(CATALOG_CONTENT_INDEX_SUBPATH_V1).toBe("./catalog-index.json");
    // The subpath target is the exact file this reader validates.
    expect(resolve(root, CATALOG_CONTENT_INDEX_ROOT_URL)).toBe(
      resolve(root, "defaults", "catalog-index-v1.json"),
    );
  });

  it("reads the real shipped index to 457 digest-bound entries without reinterpreting v1", () => {
    const result = readCatalogContentV1({ bytes: shippedBytes });
    expect(result).toBeDefined();
    const content = result as CatalogContentV1;

    expect(content.format).toBe(CATALOG_CONTENT_FORMAT_V1);
    expect(content.version).toBe(1);
    expect(content.package).toEqual({ name: "@aihq/catalog", version: "0.2.0" });
    // Surfaced verbatim: presence in this index is never organization admission.
    expect(content.organizationAdmission).toBe("not-authoritative");
    expect(content.status).toEqual({ structure: "valid", artifacts: "not-evaluated" });

    // The digest is a real sha256 over the exact index bytes, prefixed for Core.
    expect(content.digest).toBe(`sha256:${sha256(shippedBytes)}`);
    expect(content.digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    expect(content.entries).toHaveLength(457);
    const entryIds = content.entries.map((entry) => entry.entryId);
    expect(new Set(entryIds).size).toBe(457);
    expect([...entryIds].sort()).toEqual(entryIds);

    const item = content.entries.find((entry) => entry.entryId === "agent.aih.governance-quality");
    expect(item).toBeDefined();
    if (item === undefined) return;
    // Exact identity preservation: the reader copies, it never recomputes or normalizes.
    expect(item.subject).toEqual({
      id: "governance-quality",
      kind: "agent",
      source: {
        release: "0.6.0",
        revision: "sha256:32ce6e9dea74ba84fe56b71ba6516e032f18aa4132e6ef7ebca507512d8735f7",
        type: "aih",
      },
      sourceDigest: "sha256:288af0d0f68dd2b2e8940703a28cd91146c5b3986d3be519747479c7ec7e31b3",
      subjectDigest: "sha256:3e11bc9ea59b2c7c27c86f3c6c7cf577391a76a7c8c0759a3b5914c51916c8f6",
    });
    // Artifact digests stay bare 64-hex exactly as published; the UI prefixes for Core.
    expect(item.artifacts.profile?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(item.artifacts).toHaveProperty(
      "profile.path",
      "defaults/workbench/aih/agent.aih.governance-quality/artifacts/profile.json",
    );
    expect(item.qualification.report.subjectDigest).toBe(item.subject.subjectDigest);
    expect(item.qualification.gaps.length).toBeGreaterThan(0);
    expect(item.qualification.report.kind).toBe("report");
    expect(item.qualification.report.attestor).toBe("operator:catalog-successor-preparation");
    expect(item.qualification.report.format).toBe("aih-supported-evidence/v2");
  });

  it("fails closed on a wrong declared index digest and on non-canonical bytes", () => {
    expect(
      readCatalogContentV1({ bytes: shippedBytes, expectedDigest: `sha256:${"0".repeat(64)}` }),
    ).toBeUndefined();
    expect(
      readCatalogContentV1({
        bytes: shippedBytes,
        expectedDigest: `sha256:${sha256(shippedBytes)}`,
      }),
    ).toBeDefined();
    // Same value, pretty-printed: not the canonical serialization, so no digest may be claimed.
    const pretty = Buffer.from(`${JSON.stringify(shipped, null, 2)}\n`, "utf8");
    expect(readCatalogContentV1({ bytes: pretty })).toBeUndefined();
    expect(parseCatalogContentV1Bytes(pretty)).toBeUndefined();
  });

  it("refuses unknown format and version instead of degrading or upgrading", () => {
    // The reader accepts exactly the one published format.
    expect(CATALOG_CONTENT_FORMAT_V1).toBe("aih-catalog-index");
    const inventedFormat = syntheticIndex({ format: "aih-catalog-content" });
    expect(readCatalogContentV1({ bytes: inventedFormat.bytes })).toBeUndefined();

    const unknownVersion = syntheticIndex({ version: 2 });
    expect(readCatalogContentV1({ bytes: unknownVersion.bytes })).toBeUndefined();

    const numericFormat = syntheticIndex({ format: 1 });
    expect(readCatalogContentV1({ bytes: numericFormat.bytes })).toBeUndefined();

    // A missing version is not v1.
    const malformed = JSON.parse(syntheticIndex().bytes.toString("utf8")) as Record<
      string,
      unknown
    >;
    delete malformed.version;
    expect(
      readCatalogContentV1({ bytes: Buffer.from(`${JSON.stringify(malformed)}\n`, "utf8") }),
    ).toBeUndefined();
  });

  it("refuses malformed, oversize and hostile input", () => {
    for (const bytes of [
      new Uint8Array(0),
      Buffer.from("{}"),
      Buffer.from("[]"),
      Buffer.from("null"),
      Buffer.from("{not json}"),
      // A UTF-8 BOM is not canonical JSON.
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}")]),
      // A raw tab inside the document is rejected by strict JSON parsing.
      Buffer.from('{"format":"aih-catalog-content",\t"version":1,"entries":[]}', "utf8"),
    ]) {
      expect(readCatalogContentV1({ bytes })).toBeUndefined();
    }
    const oversize = Buffer.alloc(CATALOG_CONTENT_MAX_BYTES_V1 + 1, 0x20);
    expect(readCatalogContentV1({ bytes: oversize })).toBeUndefined();
    expect(() => parseCatalogContentV1Bytes(new Uint8Array(0))).not.toThrow();
  });

  it("refuses an entry whose evidence is not bound to that entry's subject digest", () => {
    const built = syntheticIndex();
    const value = JSON.parse(built.bytes.toString("utf8")) as {
      entries: { qualification: { gaps: { evidence: { subjectDigest: string } }[] } }[];
    };
    const gap = value.entries[0]?.qualification.gaps[0];
    expect(gap).toBeDefined();
    if (gap === undefined) return;
    gap.evidence.subjectDigest = `sha256:${"9".repeat(64)}`;
    expect(
      readCatalogContentV1({ bytes: Buffer.from(`${JSON.stringify(value)}\n`, "utf8") }),
    ).toBeUndefined();
  });

  it("refuses duplicate entry identities and unsafe artifact paths", () => {
    const duplicate = JSON.parse(syntheticIndex().bytes.toString("utf8")) as {
      entries: unknown[];
    };
    duplicate.entries.push(JSON.parse(JSON.stringify(duplicate.entries[0])));
    expect(
      readCatalogContentV1({ bytes: Buffer.from(`${JSON.stringify(duplicate)}\n`, "utf8") }),
    ).toBeUndefined();

    for (const hostile of [
      "../../../etc/passwd",
      "/etc/passwd",
      "defaults/../../secret",
      "defaults\\workbench\\x",
      "",
      "./x",
    ]) {
      const value = JSON.parse(syntheticIndex().bytes.toString("utf8")) as {
        entries: { artifacts: { profile: { path: string } } }[];
      };
      const entry = value.entries[0];
      if (entry === undefined) return;
      entry.artifacts.profile.path = hostile;
      expect(
        readCatalogContentV1({ bytes: Buffer.from(`${JSON.stringify(value)}\n`, "utf8") }),
        hostile,
      ).toBeUndefined();
    }
  });

  it("verifies real artifact bytes against the declared digests, and reports absence honestly", () => {
    // Descriptor paths are package-root-relative, so `root` is the package root.
    const content = readCatalogContentV1({
      bytes: shippedBytes,
      input: { root, verifyArtifacts: true },
    }) as CatalogContentV1;
    expect(content.status).toEqual({ structure: "valid", artifacts: "verified" });

    const item = content.entries.find((entry) => entry.entryId === "agent.aih.governance-quality");
    expect(item?.artifacts.profile).toMatchObject({
      state: "verified",
      bytes: expect.any(Uint8Array),
    });
    expect(item?.artifacts.profile?.path).toBe(
      "defaults/workbench/aih/agent.aih.governance-quality/artifacts/profile.json",
    );
    if (item?.artifacts.profile !== undefined && item.artifacts.profile.state === "verified") {
      expect(item.artifacts.profile.bytes.byteLength).toBe(2352);
    }

    // Every entry in the real index resolves: 457 x 4 artifacts are present and digest-exact.
    let verified = 0;
    let unverified = 0;
    for (const entry of content.entries) {
      for (const descriptor of Object.values(entry.artifacts)) {
        if (descriptor?.state === "verified") verified += 1;
        else unverified += 1;
      }
    }
    expect(verified).toBe(457 * 4);
    expect(unverified).toBe(0);

    // A root that does not contain the content yields typed absence, never a silent pass.
    const displaced = readCatalogContentV1({
      bytes: shippedBytes,
      input: { root: resolve(root, "src"), verifyArtifacts: true },
    }) as CatalogContentV1;
    expect(displaced.status.artifacts).toBe("unverified");
    const displacedItem = displaced.entries.find(
      (entry) => entry.entryId === "agent.aih.governance-quality",
    );
    expect(displacedItem?.artifacts.profile?.state).toBe("unverified");
    if (displacedItem?.artifacts.profile?.state === "unverified") {
      expect(typeof displacedItem.artifacts.profile.reason).toBe("string");
      expect(displacedItem.artifacts.profile.reason.length).toBeGreaterThan(0);
    }
  });

  it("detects changed artifact bytes rather than trusting the declaration", () => {
    const built = syntheticIndex();
    const input: CatalogContentV1Input = {
      root: defaults,
      verifyArtifacts: true,
      readArtifact: () => Buffer.from("tampered", "utf8"),
    };
    const content = readCatalogContentV1({ bytes: built.bytes, input }) as CatalogContentV1;
    expect(content.status).toEqual({ structure: "valid", artifacts: "unverified" });
    const entry = content.entries[0];
    // The declared digest is preserved even though the bytes disagree with it.
    expect(entry?.artifacts.profile).toMatchObject({
      state: "unverified",
      reason: "artifact-digest-mismatch",
      sha256: sha256(Buffer.from("profile")),
    });
  });

  it("returns frozen data so a consumer cannot mutate the published identity", () => {
    const content = readCatalogContentV1({ bytes: shippedBytes }) as CatalogContentV1;
    expect(Object.isFrozen(content)).toBe(true);
    expect(Object.isFrozen(content.entries)).toBe(true);
    expect(Object.isFrozen(content.entries[0])).toBe(true);
    expect(Object.isFrozen(content.entries[0]?.subject)).toBe(true);
  });

  it("returns each evidence summary verbatim and refuses an oversize or control-character one", () => {
    const content = readCatalogContentV1({ bytes: shippedBytes }) as CatalogContentV1;
    const item = content.entries.find((entry) => entry.entryId === "agent.aih.governance-quality");
    const published = (
      shipped.entries as Array<{
        entryId: string;
        qualification: { report: { evidence: { summary: string } } };
      }>
    ).find((entry) => entry.entryId === "agent.aih.governance-quality");
    expect(item?.qualification.report.summary).toBe(
      published?.qualification.report.evidence.summary,
    );
    for (const entry of content.entries) {
      const records = [
        entry.qualification.report,
        ...entry.qualification.findings,
        ...entry.qualification.gaps,
        ...entry.qualification.rights,
      ];
      for (const record of records) expect(typeof record.summary).toBe("string");
    }

    const withSummary = (summary: string) => {
      const value = JSON.parse(syntheticIndex().bytes.toString("utf8"));
      value.entries[0].qualification.gaps[0].evidence.summary = summary;
      return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
    };
    const exact = "verdict pass; findings 0\nsecond line";
    expect(
      readCatalogContentV1({ bytes: withSummary(exact) })?.entries[0]?.qualification.gaps[0]
        ?.summary,
    ).toBe(exact);
    expect(readCatalogContentV1({ bytes: withSummary("x".repeat(4096)) })).toBeDefined();
    for (const [reason, summary] of [
      ["oversize", "x".repeat(4097)],
      ["NUL", "a\u0000b"],
      ["tab", "a\tb"],
      ["escape", "a\u001bb"],
      ["delete", "a\u007fb"],
    ] as const) {
      expect(readCatalogContentV1({ bytes: withSummary(summary) }), reason).toBeUndefined();
    }
  });
});
