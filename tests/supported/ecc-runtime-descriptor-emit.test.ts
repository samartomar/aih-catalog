import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Runbook step 8.4: the ECC runtime descriptor Catalog distributes is the one sealed inside
// the ECC packaged source record T3 produced. The writer copies its exact bytes and records
// the Core seal and the record digest; generate:catalog-runtime-descriptors then runs as today.

type Json = Record<string, unknown>;
type Writer = {
  ECC_RUNTIME_DECLARED_EVALUATION_CONTRACT_V2: Json;
  eccRuntimeProjectionContractDigestV1(): string;
  emitEccRuntimeDescriptorV1(root: string): {
    coreSeal: string;
    recordSha256: string;
    path: string;
    projectionContractDigest: string;
    removed?: string;
  };
};
type Sidecar = {
  generateCatalogRuntimeDescriptors(root: string): {
    descriptors: { descriptor: { path: string; sha256: string }; origin: Json }[];
  };
};

async function writer(): Promise<Writer> {
  // @ts-expect-error The maintenance tool is intentionally plain ESM JavaScript.
  return (await import("../../tools/emit-ecc-runtime-descriptor.mjs")) as Writer;
}
async function sidecar(): Promise<Sidecar> {
  // @ts-expect-error The maintenance tool is intentionally plain ESM JavaScript.
  return (await import("../../tools/generate-catalog-runtime-descriptors.mjs")) as Sidecar;
}

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const item = value as Json;
  return `{${Object.keys(item)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`)
    .join(",")}}`;
};
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fixture = resolve(
  import.meta.dirname,
  "..",
  "fixtures",
  "core-ecc-runtime-declared-evaluation-contract-v2.json",
);
const V2_DIGEST = `sha256:${sha256(canonical(JSON.parse(readFileSync(fixture, "utf8"))))}`;
const PIN = "5".repeat(40);
const OLD_PIN = "4".repeat(40);
const INPUTS = "defaults/catalog-runtime-descriptors-inputs-v1.json";
const descriptorPath = (commit: string) =>
  `defaults/runtime-descriptors/github.com/affaan-m/ECC/${commit}/ecc-runtime-descriptor-v1.json`;

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

interface Options {
  descriptor?: (descriptor: Json) => Json;
  descriptorText?: (text: string) => string;
  seal?: (seal: string) => string;
  record?: (record: Json) => Json;
  recordSha?: (sha: string) => string;
  extraEcc?: boolean;
}

/** A Catalog root whose committed records carry an ECC record with a sealed descriptor. */
function catalogRoot(options: Options = {}) {
  const root = mkdtempSync(join(tmpdir(), "aih-ecc-runtime-descriptor-"));
  temporary.push(root);
  const base: Json = {
    version: "ecc-runtime-descriptor/v1",
    source: { commit: PIN, repository: "affaan-m/ECC", treeSha256: "7".repeat(64) },
    components: [],
    evidence: { projectionContractDigest: V2_DIGEST, validUntil: "2026-12-01T00:00:00.000Z" },
  };
  const descriptor = options.descriptor ? options.descriptor(base) : base;
  const text = (options.descriptorText ?? ((value) => value))(canonical(descriptor));
  const descriptorBytes = Buffer.from(text, "utf8");
  const seal = (options.seal ?? ((value) => value))(`sha256:${sha256(descriptorBytes)}`);
  const ecc: Json = {
    version: "packaged-workbench-source-data/v1",
    source: { repository: "affaan-m/ECC", commit: PIN },
    sourceBundle: {},
    scannerProof: {},
    compilerTemplate: {},
    runtimeDescriptor: { bytesBase64: descriptorBytes.toString("base64"), sha256: seal },
    inlineBlobs: [],
    publicationBlobs: [],
  };
  const other: Json = {
    version: "packaged-workbench-source-data/v1",
    source: { repository: "obra/Superpowers", commit: "6".repeat(40) },
  };
  const sealed = (value: Json) => {
    const bytes = canonical(value);
    return { bytes, sha256: sha256(bytes) };
  };
  const record = sealed(options.record ? options.record(ecc) : ecc);
  if (options.recordSha) record.sha256 = options.recordSha(record.sha256);
  const records = [sealed(other), record, ...(options.extraEcc ? [record] : [])];
  mkdirSync(join(root, "src", "production", "data"), { recursive: true });
  writeFileSync(
    join(root, "src", "production", "data", "packaged-source-data-v1.json"),
    `${JSON.stringify(records)}\n`,
  );
  // The previous descriptor at another pin, as the committed inputs name it.
  mkdirSync(dirname(join(root, descriptorPath(OLD_PIN))), { recursive: true });
  writeFileSync(join(root, descriptorPath(OLD_PIN)), "{}");
  writeFileSync(
    join(root, INPUTS),
    `${JSON.stringify(
      {
        descriptors: [
          {
            coreSeal: `sha256:${"1".repeat(64)}`,
            format: "ecc-runtime-descriptor/v1",
            framework: "ecc",
            origin: { kind: "core-packaged-source-data", recordSha256: "2".repeat(64) },
            path: descriptorPath(OLD_PIN),
          },
        ],
        format: "aih-catalog-runtime-descriptors-inputs",
        version: 1,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "defaults", "catalog-index-v1.json"),
    JSON.stringify({
      entries: [
        { subject: { source: { type: "github", repository: "affaan-m/ECC", commit: PIN } } },
      ],
    }),
  );
  return { root, descriptorBytes, record };
}

describe("ECC runtime descriptor writer", () => {
  it("pins Core's ECC runtime declared evaluation contract v2 exactly", async () => {
    const api = await writer();
    expect(canonical(api.ECC_RUNTIME_DECLARED_EVALUATION_CONTRACT_V2)).toBe(
      canonical(JSON.parse(readFileSync(fixture, "utf8"))),
    );
    expect(api.eccRuntimeProjectionContractDigestV1()).toBe(V2_DIGEST);
    expect(V2_DIGEST).toBe(
      "sha256:72eefa8caae3551e2836972f333eafbc8434d742df75665d0eab7755ef8b71c5",
    );
  });

  it("writes the sealed descriptor bytes and its inputs entry, replacing the previous one", async () => {
    const api = await writer();
    const item = catalogRoot();
    const result = api.emitEccRuntimeDescriptorV1(item.root);
    expect(result).toEqual({
      coreSeal: `sha256:${sha256(item.descriptorBytes)}`,
      recordSha256: item.record.sha256,
      path: descriptorPath(PIN),
      projectionContractDigest: V2_DIGEST,
      removed: descriptorPath(OLD_PIN),
    });
    expect(readFileSync(join(item.root, descriptorPath(PIN))).equals(item.descriptorBytes)).toBe(
      true,
    );
    expect(existsSync(join(item.root, descriptorPath(OLD_PIN)))).toBe(false);
    const inputs = readFileSync(join(item.root, INPUTS), "utf8");
    expect(inputs).toBe(
      `${JSON.stringify(
        {
          descriptors: [
            {
              coreSeal: result.coreSeal,
              format: "ecc-runtime-descriptor/v1",
              framework: "ecc",
              origin: { kind: "core-packaged-source-data", recordSha256: item.record.sha256 },
              path: descriptorPath(PIN),
            },
          ],
          format: "aih-catalog-runtime-descriptors-inputs",
          version: 1,
        },
        null,
        2,
      )}\n`,
    );
    // generate:catalog-runtime-descriptors runs as today over what the writer left.
    const generated = (await sidecar()).generateCatalogRuntimeDescriptors(item.root);
    expect(generated.descriptors).toHaveLength(1);
    expect(generated.descriptors[0]?.descriptor.sha256).toBe(sha256(item.descriptorBytes));
    expect(generated.descriptors[0]?.origin.recordSha256).toBe(item.record.sha256);
    // A second run over the same record changes nothing.
    const again = api.emitEccRuntimeDescriptorV1(item.root);
    expect(again.removed).toBeUndefined();
    expect(readFileSync(join(item.root, INPUTS), "utf8")).toBe(inputs);
  });

  it.each([
    ["a record whose bytes do not match its seal", { recordSha: () => "0".repeat(64) }, /record/],
    ["two ECC records", { extraEcc: true }, /exactly one ECC packaged source record/],
    [
      "an ECC record without a runtime descriptor",
      {
        record: (record: Json) => {
          const { runtimeDescriptor: _, ...rest } = record;
          return rest;
        },
      },
      /carries no runtime descriptor/,
    ],
    [
      "descriptor bytes that do not match the Core seal",
      { seal: () => `sha256:${"0".repeat(64)}` },
      /Core seal/,
    ],
    [
      "a descriptor that is not canonical JSON",
      { descriptorText: (text: string) => `${text}\n` },
      /canonical/,
    ],
    [
      "a descriptor for another revision than its record",
      {
        descriptor: (descriptor: Json) => ({
          ...descriptor,
          source: { ...(descriptor.source as Json), commit: OLD_PIN },
        }),
      },
      /affaan-m\/ECC@4{40}.*affaan-m\/ECC@5{40}/,
    ],
    [
      "a descriptor evaluated under another contract",
      {
        descriptor: (descriptor: Json) => ({
          ...descriptor,
          evidence: {
            ...(descriptor.evidence as Json),
            projectionContractDigest:
              "sha256:018dd7a69d715bcd3c2255b14b760ef49d65ac935095c69b1f5ad3ed145d295f",
          },
        }),
      },
      /sha256:018dd7a6.*not Core's ECC runtime declared evaluation contract v2 sha256:72eefa8c/,
    ],
  ])("refuses %s and writes nothing", async (_label, options, message) => {
    const api = await writer();
    const item = catalogRoot(options as Options);
    const before = readFileSync(join(item.root, INPUTS), "utf8");
    expect(() => api.emitEccRuntimeDescriptorV1(item.root)).toThrow(message);
    expect(readFileSync(join(item.root, INPUTS), "utf8")).toBe(before);
    expect(existsSync(join(item.root, descriptorPath(OLD_PIN)))).toBe(true);
    expect(existsSync(join(item.root, descriptorPath(PIN)))).toBe(false);
  });

  it("refuses a resealed descriptor whose source commit is not a commit, before any write", async () => {
    const api = await writer();
    const outside = "../../../../../escape";
    const item = catalogRoot({
      descriptor: (descriptor) => ({
        ...descriptor,
        source: { ...(descriptor.source as Json), commit: outside },
      }),
      record: (record) => ({ ...record, source: { ...(record.source as Json), commit: outside } }),
    });
    const before = readFileSync(join(item.root, INPUTS), "utf8");
    expect(() => api.emitEccRuntimeDescriptorV1(item.root)).toThrow(
      'ecc-runtime-descriptor: the runtime descriptor source commit "../../../../../escape" is not a 40-character lowercase commit',
    );
    expect(existsSync(join(item.root, "escape"))).toBe(false);
    expect(readFileSync(join(item.root, INPUTS), "utf8")).toBe(before);
    expect(existsSync(join(item.root, descriptorPath(OLD_PIN)))).toBe(true);
  });

  it("refuses a stale temporary file by name before any write", async () => {
    const api = await writer();
    const item = catalogRoot();
    const stale = `${descriptorPath(PIN)}.tmp`;
    mkdirSync(dirname(join(item.root, stale)), { recursive: true });
    writeFileSync(join(item.root, stale), "partial");
    const before = readFileSync(join(item.root, INPUTS), "utf8");
    expect(() => api.emitEccRuntimeDescriptorV1(item.root)).toThrow(
      `ecc-runtime-descriptor: a stale temporary file ${stale} exists; remove it and rerun`,
    );
    expect(readFileSync(join(item.root, INPUTS), "utf8")).toBe(before);
    expect(existsSync(join(item.root, descriptorPath(PIN)))).toBe(false);
    expect(existsSync(join(item.root, descriptorPath(OLD_PIN)))).toBe(true);
  });
});
