import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CatalogContentV1,
  readCatalogContentV1,
} from "../../src/content/catalog-content-v1.js";
import {
  CATALOG_RUNTIME_DESCRIPTORS_REFUSALS_V1,
  CATALOG_RUNTIME_DESCRIPTORS_ROOT_URL,
  CATALOG_RUNTIME_DESCRIPTORS_SUBPATH_V1,
  readCatalogRuntimeDescriptorsV1,
  readCatalogRuntimeDescriptorsV1Result,
} from "../../src/content/catalog-runtime-descriptors-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const indexBytes = readFileSync(resolve(root, "defaults/catalog-index-v1.json"));
const index = readCatalogContentV1({ bytes: indexBytes }) as CatalogContentV1;
const shippedBytes = readFileSync(resolve(root, CATALOG_RUNTIME_DESCRIPTORS_ROOT_URL));
const shipped = JSON.parse(shippedBytes.toString("utf8"));

/** The ECC revision the index publishes and Core's packaged source data compiled. */
const ECC_COMMIT = "5064474d4d762dc9640234a41617cccb79185cec";
/** Core's own seal over the descriptor, as its packaged source-data record declares it. */
const CORE_SEAL = "sha256:158f63e265f1ca18a7e65c97e372b1259200d6fb60eab87d70c20600d9d9abf0";
/** The sealed Core record (`packaged-source-data-data.json`) the bytes were taken from. */
const CORE_RECORD = "85d3f1c437bf5ba719588ec2aad512b53c89e6ce7562bf491cef6eb00d6fffde";

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
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
// biome-ignore lint/suspicious/noExplicitAny: the tests mutate untyped published JSON.
type Doc = any;
const clone = (): Doc => structuredClone(shipped);
const readValue = (value: unknown) =>
  readCatalogRuntimeDescriptorsV1Result({ bytes: bytesOf(value), index });

async function generator() {
  // @ts-expect-error The maintenance generator is intentionally plain ESM JavaScript.
  return import("../../tools/generate-catalog-runtime-descriptors.mjs");
}

describe("published runtime descriptors", () => {
  it("is the current generator output for the committed inputs", async () => {
    const { generateCatalogRuntimeDescriptors, serializeCatalogRuntimeDescriptors } =
      await generator();
    expect(serializeCatalogRuntimeDescriptors(generateCatalogRuntimeDescriptors(root))).toBe(
      shippedBytes.toString("utf8"),
    );
  }, 60_000);

  it("carries Core's sealed ECC descriptor for the indexed ECC revision, unread until asked", () => {
    const result = readCatalogRuntimeDescriptorsV1Result({ bytes: shippedBytes, index });
    if (result.state !== "read") throw new Error(`refused: ${result.reason}`);
    const read = result.runtimeDescriptors;
    expect(read.organizationAdmission).toBe("not-authoritative");
    expect(read.digest).toBe(`sha256:${sha256(shippedBytes)}`);
    expect(read.index).toEqual({
      path: "defaults/catalog-index-v1.json",
      sha256: sha256(indexBytes),
    });
    expect(read.status.descriptors).toBe("not-evaluated");
    expect(read.descriptors).toHaveLength(1);
    const [ecc] = read.descriptors;
    expect(ecc).toMatchObject({
      framework: "ecc",
      format: "ecc-runtime-descriptor/v1",
      source: { type: "github", repository: "affaan-m/ECC", commit: ECC_COMMIT },
      origin: { kind: "core-packaged-source-data", recordSha256: CORE_RECORD },
      descriptor: {
        state: "not-evaluated",
        path: `defaults/runtime-descriptors/github.com/affaan-m/ECC/${ECC_COMMIT}/ecc-runtime-descriptor-v1.json`,
        sha256: CORE_SEAL.slice("sha256:".length),
      },
    });
    // The descriptor's source is content this Catalog indexes.
    expect(
      index.entries.some(
        (entry) =>
          entry.subject.source.type === "github" &&
          entry.subject.source.repository === "affaan-m/ECC" &&
          entry.subject.source.commit === ECC_COMMIT,
      ),
    ).toBe(true);
  });

  it("returns Core's exact sealed bytes, and their declared identity, on request", () => {
    const result = readCatalogRuntimeDescriptorsV1Result({
      bytes: shippedBytes,
      index,
      input: { root, verifyDescriptors: true },
    });
    if (result.state !== "read") throw new Error(`refused: ${result.reason}`);
    expect(result.runtimeDescriptors.status.descriptors).toBe("verified");
    const descriptor = result.runtimeDescriptors.descriptors[0]?.descriptor;
    if (descriptor?.state !== "verified") throw new Error(`not verified: ${descriptor?.state}`);
    expect(`sha256:${sha256(descriptor.bytes)}`).toBe(CORE_SEAL);
    expect(descriptor.byteLength).toBe(descriptor.bytes.byteLength);
    const text = Buffer.from(descriptor.bytes).toString("utf8");
    // Canonical strict JSON, exactly as Core sealed it: sorted keys, no trailing newline.
    expect(canonical(JSON.parse(text))).toBe(text);
    const value = JSON.parse(text) as { version: string; source: Record<string, string> };
    expect(value.version).toBe("ecc-runtime-descriptor/v1");
    expect(value.source).toMatchObject({ repository: "affaan-m/ECC", commit: ECC_COMMIT });
    // Catalog hands the bytes over; it never re-serializes them.
    const shippedDescriptor = readFileSync(resolve(root, descriptor.path));
    expect(Buffer.from(descriptor.bytes).equals(shippedDescriptor)).toBe(true);
  });

  it("names every refusal from its closed list", () => {
    const refusals: Array<[string, () => ReturnType<typeof readValue>, string, string?]> = [
      [
        "empty bytes",
        () => readCatalogRuntimeDescriptorsV1Result({ bytes: new Uint8Array(), index }),
        "malformed-bytes",
      ],
      [
        "oversize",
        () =>
          readCatalogRuntimeDescriptorsV1Result({
            bytes: Buffer.alloc(1024 * 1024 + 1, 0x20),
            index,
          }),
        "oversize-bytes",
      ],
      [
        "pretty-printed",
        () =>
          readCatalogRuntimeDescriptorsV1Result({
            bytes: Buffer.from(`${JSON.stringify(shipped, null, 2)}\n`),
            index,
          }),
        "non-canonical-bytes",
      ],
      [
        "pinned elsewhere",
        () =>
          readCatalogRuntimeDescriptorsV1Result({
            bytes: shippedBytes,
            index,
            expectedDigest: `sha256:${"0".repeat(64)}`,
          }),
        "digest-mismatch",
      ],
      [
        "no index",
        () => readCatalogRuntimeDescriptorsV1Result({ bytes: shippedBytes } as never),
        "malformed-request",
      ],
      [
        "unusable input",
        () =>
          readCatalogRuntimeDescriptorsV1Result({
            bytes: shippedBytes,
            index,
            input: { root: 7 } as never,
          }),
        "malformed-request",
      ],
      [
        "other format",
        () => readValue({ ...clone(), format: "aih-catalog-index" }),
        "unknown-format",
        '"aih-catalog-index"',
      ],
      ["newer version", () => readValue({ ...clone(), version: 2 }), "unknown-version", "2"],
      [
        "authority claimed",
        () => readValue({ ...clone(), organizationAdmission: "authoritative" }),
        "malformed-document",
      ],
      ["extra member", () => readValue({ ...clone(), extra: true }), "malformed-document"],
      ["no descriptors", () => readValue({ ...clone(), descriptors: [] }), "malformed-document"],
      [
        "another index",
        () => {
          const value = clone();
          value.index.sha256 = "0".repeat(64);
          return readValue(value);
        },
        "index-mismatch",
      ],
      [
        "unknown entry member",
        () => {
          const value = clone();
          value.descriptors[0].note = "x";
          return readValue(value);
        },
        "malformed-entry",
      ],
      [
        "short commit",
        () => {
          const value = clone();
          value.descriptors[0].source.commit = "5064474d";
          return readValue(value);
        },
        "malformed-entry",
      ],
      [
        "unknown origin",
        () => {
          const value = clone();
          value.descriptors[0].origin.kind = "hand-copied";
          return readValue(value);
        },
        "malformed-entry",
      ],
      [
        "zero length",
        () => {
          const value = clone();
          value.descriptors[0].descriptor.byteLength = 0;
          return readValue(value);
        },
        "malformed-entry",
      ],
      [
        "another framework",
        () => {
          const value = clone();
          value.descriptors[0].framework = "superpowers";
          return readValue(value);
        },
        "unsupported-descriptor",
      ],
      [
        "a newer descriptor format",
        () => {
          const value = clone();
          value.descriptors[0].format = "ecc-runtime-descriptor/v2";
          return readValue(value);
        },
        "unsupported-descriptor",
      ],
      [
        "traversal",
        () => {
          const value = clone();
          value.descriptors[0].descriptor.path = "defaults/../../outside.json";
          return readValue(value);
        },
        "unsafe-path",
      ],
      [
        "absolute path",
        () => {
          const value = clone();
          value.descriptors[0].descriptor.path = "/etc/passwd";
          return readValue(value);
        },
        "unsafe-path",
      ],
      [
        "a revision the index does not carry",
        () => {
          const value = clone();
          value.descriptors[0].source.commit = "f".repeat(40);
          return readValue(value);
        },
        "source-not-in-index",
      ],
      [
        "listed twice",
        () => {
          const value = clone();
          value.descriptors = [value.descriptors[0], value.descriptors[0]];
          return readValue(value);
        },
        "duplicate-entry",
      ],
      [
        "out of order",
        () => {
          const value = clone();
          const superpowers = structuredClone(value.descriptors[0]);
          superpowers.source.repository = "obra/Superpowers";
          superpowers.source.commit = "b36e0829c6d0140e93cfef2ca599b1b07d4a7797";
          value.descriptors = [superpowers, value.descriptors[0]];
          return readValue(value);
        },
        "unordered-entries",
      ],
    ];
    const seen = new Set<string>();
    for (const [label, run, reason, observed] of refusals) {
      const result = run();
      expect(result, label).toMatchObject({ state: "refused", reason });
      if (result.state !== "refused") continue;
      expect(CATALOG_RUNTIME_DESCRIPTORS_REFUSALS_V1 as readonly string[], label).toContain(
        result.reason,
      );
      // `observed` is carried for unknown-format and unknown-version only.
      expect(result.observed, label).toBe(observed);
      seen.add(result.reason);
    }
    expect([...seen].sort()).toEqual([...CATALOG_RUNTIME_DESCRIPTORS_REFUSALS_V1].sort());
    // The thin wrapper returns undefined for a refusal and the document when read.
    expect(
      readCatalogRuntimeDescriptorsV1({ bytes: bytesOf({ ...clone(), version: 2 }), index }),
    ).toBe(undefined);
    expect(
      readCatalogRuntimeDescriptorsV1({ bytes: shippedBytes, index })?.descriptors,
    ).toHaveLength(1);
  });

  it("states a byte verdict per descriptor instead of refusing the document", () => {
    const declared = shipped.descriptors[0].descriptor as { path: string; byteLength: number };
    const real = readFileSync(resolve(root, declared.path));
    const verdict = (
      readFile: (request: { path: string; sha256: string }) => Uint8Array | undefined,
      value = shipped,
    ) => {
      const result = readCatalogRuntimeDescriptorsV1Result({
        bytes: bytesOf(value),
        index,
        input: { root, verifyDescriptors: true, readFile },
      });
      if (result.state !== "read") throw new Error(`refused: ${result.reason}`);
      expect(result.runtimeDescriptors.status.descriptors).toBe(
        result.runtimeDescriptors.descriptors[0]?.descriptor.state === "verified"
          ? "verified"
          : "unverified",
      );
      return result.runtimeDescriptors.descriptors[0]?.descriptor;
    };
    expect(verdict(() => undefined)).toMatchObject({
      state: "unverified",
      reason: "descriptor-absent",
    });
    expect(
      verdict(() => {
        throw new Error("EACCES");
      }),
    ).toMatchObject({ state: "unverified", reason: "descriptor-unreadable" });
    expect(verdict(() => real.subarray(0, real.byteLength - 1))).toMatchObject({
      state: "unverified",
      reason: "descriptor-size-mismatch",
    });
    const flipped = Buffer.from(real);
    flipped[10] = (flipped[10] ?? 0) ^ 0x01;
    expect(verdict(() => flipped)).toMatchObject({
      state: "unverified",
      reason: "descriptor-digest-mismatch",
    });

    // Bytes that match their declared digest but are not a descriptor at all.
    const notJson = Buffer.from("not json", "utf8");
    const pointNotJson = clone();
    pointNotJson.descriptors[0].descriptor.sha256 = sha256(notJson);
    pointNotJson.descriptors[0].descriptor.byteLength = notJson.byteLength;
    expect(verdict(() => notJson, pointNotJson)).toMatchObject({
      state: "unverified",
      reason: "descriptor-malformed",
    });

    // A well-formed descriptor for another revision, under this revision's label.
    const other = Buffer.from(
      canonical({
        source: { commit: "f".repeat(40), repository: "affaan-m/ECC" },
        version: "ecc-runtime-descriptor/v1",
      }),
      "utf8",
    );
    const mislabelled = clone();
    mislabelled.descriptors[0].descriptor.sha256 = sha256(other);
    mislabelled.descriptors[0].descriptor.byteLength = other.byteLength;
    expect(verdict(() => other, mislabelled)).toMatchObject({
      state: "unverified",
      reason: "descriptor-identity-mismatch",
    });
    const otherFormat = Buffer.from(
      canonical({
        source: { commit: ECC_COMMIT, repository: "affaan-m/ECC" },
        version: "ecc-runtime-descriptor/v2",
      }),
      "utf8",
    );
    const reformatted = clone();
    reformatted.descriptors[0].descriptor.sha256 = sha256(otherFormat);
    reformatted.descriptors[0].descriptor.byteLength = otherFormat.byteLength;
    expect(verdict(() => otherFormat, reformatted)).toMatchObject({
      state: "unverified",
      reason: "descriptor-identity-mismatch",
    });
  });

  it("ingests a descriptor only from an intact Core source-data seal", async () => {
    const {
      ingestCoreSourceDataRuntimeDescriptors,
      generateCatalogRuntimeDescriptors,
      serializeCatalogRuntimeDescriptors,
      INPUT,
    } = await generator();
    const temp = mkdtempSync(resolve(tmpdir(), "aih-catalog-runtime-descriptors-"));
    try {
      mkdirSync(resolve(temp, "defaults"), { recursive: true });
      writeFileSync(resolve(temp, "defaults/catalog-index-v1.json"), indexBytes);
      const descriptorText = canonical({
        components: [],
        source: { commit: ECC_COMMIT, repository: "affaan-m/ECC", treeSha256: "a".repeat(64) },
        version: "ecc-runtime-descriptor/v1",
      });
      const coreFile = (seal: string, text = descriptorText) => {
        const record = canonical({
          runtimeDescriptor: { bytesBase64: Buffer.from(text).toString("base64"), sha256: seal },
          source: { commit: ECC_COMMIT, repository: "affaan-m/ECC" },
          version: "packaged-workbench-source-data/v1",
        });
        const path = resolve(temp, `core-${sha256(seal + text).slice(0, 8)}.json`);
        writeFileSync(path, JSON.stringify([{ bytes: record, sha256: sha256(record) }]));
        return { path, recordSha256: sha256(record) };
      };

      expect(() =>
        ingestCoreSourceDataRuntimeDescriptors(temp, coreFile(`sha256:${"0".repeat(64)}`).path),
      ).toThrow(/seal/);
      const pretty = JSON.stringify(JSON.parse(descriptorText), null, 2);
      expect(() =>
        ingestCoreSourceDataRuntimeDescriptors(
          temp,
          coreFile(`sha256:${sha256(pretty)}`, pretty).path,
        ),
      ).toThrow(/canonical/);

      const intact = coreFile(`sha256:${sha256(descriptorText)}`);
      ingestCoreSourceDataRuntimeDescriptors(temp, intact.path);
      const inputs = JSON.parse(readFileSync(resolve(temp, INPUT), "utf8"));
      expect(inputs.descriptors).toEqual([
        {
          coreSeal: `sha256:${sha256(descriptorText)}`,
          format: "ecc-runtime-descriptor/v1",
          framework: "ecc",
          origin: { kind: "core-packaged-source-data", recordSha256: intact.recordSha256 },
          path: `defaults/runtime-descriptors/github.com/affaan-m/ECC/${ECC_COMMIT}/ecc-runtime-descriptor-v1.json`,
        },
      ]);
      const sidecar = serializeCatalogRuntimeDescriptors(generateCatalogRuntimeDescriptors(temp));
      const output = resolve(temp, CATALOG_RUNTIME_DESCRIPTORS_ROOT_URL);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, sidecar);
      const result = readCatalogRuntimeDescriptorsV1Result({
        bytes: readFileSync(output),
        index,
        input: { root: temp, verifyDescriptors: true },
      });
      if (result.state !== "read") throw new Error(`refused: ${result.reason}`);
      const descriptor = result.runtimeDescriptors.descriptors[0]?.descriptor;
      expect(descriptor?.state).toBe("verified");
      expect(
        descriptor?.state === "verified" && Buffer.from(descriptor.bytes).toString("utf8"),
      ).toBe(descriptorText);

      // A committed descriptor edited after ingestion no longer matches Core's seal.
      writeFileSync(resolve(temp, inputs.descriptors[0].path), `${descriptorText} `);
      expect(() => generateCatalogRuntimeDescriptors(temp)).toThrow(/seal/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }, 60_000);

  it("publishes through a declared subpath and the drift gate", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      exports: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(CATALOG_RUNTIME_DESCRIPTORS_SUBPATH_V1).toBe("./catalog-runtime-descriptors.json");
    expect(pkg.exports[CATALOG_RUNTIME_DESCRIPTORS_SUBPATH_V1]).toBe(
      `./${CATALOG_RUNTIME_DESCRIPTORS_ROOT_URL}`,
    );
    expect(pkg.scripts["generate:catalog-runtime-descriptors"]).toBe(
      "node tools/generate-catalog-runtime-descriptors.mjs",
    );
    expect(pkg.scripts["check:catalog-index"]).toContain(
      "tools/generate-catalog-runtime-descriptors.mjs --check",
    );
  });
});
