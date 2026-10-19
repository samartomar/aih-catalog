import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { createContentInventory, readContentInventory } from "../../src/release/inventory.js";
import { prepareReleaseBaseline } from "../../src/release/prepare-baseline.js";
import { readRelease } from "../../src/release/reader.js";
import { fixtureRelease, releaseBytes, sha256 } from "./fixtures.js";

function boundRelease() {
  const content = fixtureRelease();
  const bytes = releaseBytes(content);
  const inventory = createContentInventory(bytes, { expectedSha256: sha256(bytes) });
  if (!inventory.valid) throw new Error(JSON.stringify(inventory));
  return {
    ...inventory.inventory.release,
    baseline: {
      schema: "urn:aihq:catalog:scan-baseline:1.0.0",
      inventory: {
        path: "release/content-inventory.json",
        sha256: inventory.sha256,
        byteLength: inventory.byteLength,
      },
      scanId: `scan:sha256:${"a".repeat(64)}`,
      artifact: {
        sha256: "b".repeat(64),
        byteLength: 200,
        location: { kind: "package", path: "release/baseline.json" },
      },
      scope: { namespace: "package-relative", paths: ["release"], excludedPaths: [] },
    },
  };
}
const read = (document: unknown) => {
  const bytes = releaseBytes(document);
  return readRelease(bytes, { expectedSha256: sha256(bytes) });
};

describe("public content inventory", () => {
  it("freezes every content field before a baseline exists", () => {
    const document = fixtureRelease();
    document.metadata = { unrelated: "still part of content" };
    const bytes = releaseBytes(document);
    const frozen = createContentInventory(bytes, { expectedSha256: sha256(bytes) });
    expect(frozen.valid).toBe(true);
    if (!frozen.valid) return;
    const read = readContentInventory(frozen.bytes, { expectedSha256: frozen.sha256 });
    expect(read.valid).toBe(true);
    if (!read.valid) return;
    expect(read.inventory.release.metadata).toEqual(document.metadata);
    expect(read.inventory.release.items).toHaveLength(2);
    expect(Object.keys(read.inventory)).toEqual(["projection", "release", "schema"]);
    document.metadata = { unrelated: "changed" };
    const changed = releaseBytes(document);
    const next = createContentInventory(changed, { expectedSha256: sha256(changed) });
    expect(next.valid && next.sha256).not.toBe(frozen.sha256);
  });
});

it("preserves old release reading with no invented baseline", () => {
  const old = read(fixtureRelease());
  expect(old.valid && old.release.baseline).toBeUndefined();
});

it("checks the final release projection, including unrelated metadata", () => {
  const release = boundRelease();
  expect(read(release).valid).toBe(true);
  const changed = read({ ...release, metadata: { unrelated: "new" } });
  expect(changed.valid ? [] : changed.diagnostics.map((d) => d.reason)).toContain(
    "baseline-content-mismatch",
  );
  const rebind = read({
    ...release,
    baseline: { ...release.baseline, scanId: `scan:sha256:${"c".repeat(64)}` },
  });
  expect(rebind.valid).toBe(true);
});

it("never omits an unknown field or accepts a self-referential inventory", () => {
  const content = fixtureRelease();
  content.extra = "unrecognized semantic field";
  const bytes = releaseBytes(content);
  const frozen = createContentInventory(bytes, { expectedSha256: sha256(bytes) });
  expect(frozen.valid ? [] : frozen.diagnostics.map((d) => d.reason)).toContain("unknown-field");
  const release = boundRelease();
  const inventoryBytes = releaseBytes({
    schema: "urn:aihq:catalog:content-inventory:1.0.0",
    projection: "urn:aihq:catalog:release-content:1.0.0",
    release,
  });
  expect(
    readContentInventory(inventoryBytes, { expectedSha256: sha256(inventoryBytes) }).valid,
  ).toBe(false);
});

it("refuses unsupported inventory and new releases missing their binding", () => {
  const bytes = releaseBytes({ schema: "future", projection: "future", release: {} });
  const result = readContentInventory(bytes, { expectedSha256: sha256(bytes) });
  expect(result.valid ? [] : result.diagnostics.map((d) => d.code)).toContain("SCHEMA_UNSUPPORTED");
  const { baseline: _baseline, ...content } = boundRelease();
  expect(read(content).valid).toBe(false);
});

it("distinguishes an unknown nested release contract from an incompatible known projection", () => {
  const { baseline: _baseline, ...release } = boundRelease();
  for (const [schema, code] of [
    ["urn:aihq:catalog:release:9.0.0", "SCHEMA_UNSUPPORTED"],
    ["urn:aihq:catalog:release:1.4.0", "INPUT_INVALID"],
  ]) {
    const bytes = releaseBytes({
      schema: "urn:aihq:catalog:content-inventory:1.0.0",
      projection: "urn:aihq:catalog:release-content:1.0.0",
      release: { ...release, schema },
    });
    const result = readContentInventory(bytes, { expectedSha256: sha256(bytes) });
    expect(result.valid ? [] : result.diagnostics.map((d) => d.code)).toContain(code);
  }
});

it("publishes schemas that admit the same new release and inventory examples", () => {
  const ajv = new Ajv2020({ strict: true });
  const schema = JSON.parse(
    readFileSync(new URL("../../schemas/release/1.5.0.json", import.meta.url), "utf8"),
  );
  const validate = ajv.compile(schema);
  expect(validate(boundRelease())).toBe(true);
  const { baseline: _baseline, ...content } = boundRelease();
  expect(validate(content)).toBe(false);
  const inventorySchema = JSON.parse(
    readFileSync(new URL("../../schemas/content-inventory/1.0.0.json", import.meta.url), "utf8"),
  );
  expect(
    ajv.compile(inventorySchema)({
      schema: "urn:aihq:catalog:content-inventory:1.0.0",
      projection: "urn:aihq:catalog:release-content:1.0.0",
      release: content,
    }),
  ).toBe(true);
});

it("release preparation refuses an absent baseline even for readable historical content", async () => {
  const bytes = releaseBytes(fixtureRelease());
  const result = await prepareReleaseBaseline(
    { contentBytes: bytes, expectedSha256: sha256(bytes), baseline: undefined, trust: {} },
    {
      acquireArtifact: async () => {
        throw new Error("must not acquire");
      },
      readArtifact: async () => ({ status: "invalid" as const }),
      readContentCoverage: async () => ({ status: "invalid" as const }),
      authenticateEvidence: async () => ({ status: "unverifiable" as const }),
    },
  );
  expect(result.valid).toBe(false);
  expect(result.valid ? [] : result.diagnostics.map((d) => d.reason)).toContain(
    "baseline-required",
  );
});
