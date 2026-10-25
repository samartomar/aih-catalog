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

it("checks shared members once per qualification while retaining each item's coverage", async () => {
  const content = fixtureRelease();
  const items = content.items as { materials: { sha256: string; byteLength: number }[] }[];
  const sameBytesAtAnotherPath = items[0]?.materials[1];
  if (!sameBytesAtAnotherPath) throw new Error("Expected alpha skill fixture");
  sameBytesAtAnotherPath.sha256 = sha256("license");
  sameBytesAtAnotherPath.byteLength = 1068;
  const contentBytes = releaseBytes(content);
  const inventory = createContentInventory(contentBytes, { expectedSha256: sha256(contentBytes) });
  if (!inventory.valid) throw new Error(JSON.stringify(inventory));
  const artifact = new TextEncoder().encode("fixture assessment");
  const baseline = {
    ...boundRelease().baseline,
    inventory: {
      path: "release/content-inventory.json",
      sha256: inventory.sha256,
      byteLength: inventory.byteLength,
    },
    artifact: {
      sha256: sha256(artifact),
      byteLength: artifact.length,
      location: { kind: "package", path: "release/baseline.json" },
    },
  };
  let qualification = 0;
  let licenseChecks = 0;
  let retained:
    | {
        observations: { observationId: string }[];
        detectorsWithoutCoverage: string[];
      }
    | undefined;
  const qualify = () =>
    prepareReleaseBaseline(
      { contentBytes, expectedSha256: sha256(contentBytes), baseline, trust: {} },
      {
        acquireArtifact: async () => artifact,
        readArtifact: async () => {
          qualification++;
          return {
            status: "read" as const,
            scanId: baseline.scanId,
            report: { selection: { paths: ["release"], excludedPaths: [] } },
          };
        },
        readContentCoverage: async ({ descriptors }) => {
          if (descriptors[0]?.path === "release/materials/LICENSE") {
            licenseChecks++;
            if (qualification === 2) return { status: "mismatched" as const };
            retained = {
              observations: [{ observationId: "fixture-observation" }],
              detectorsWithoutCoverage: ["semgrep"],
            };
            Object.assign(descriptors[0], { path: "changed-by-host" });
            return { status: "matched" as const, ...retained };
          }
          if (retained && descriptors[0]?.path === "release/materials/alpha/SKILL.md") {
            const observation = retained.observations[0];
            if (observation) observation.observationId = "changed-by-host";
            retained.detectorsWithoutCoverage.push("changed-by-host");
            return {
              status: "matched" as const,
              observations: [{ observationId: "different-path-observation" }],
              detectorsWithoutCoverage: [],
            };
          }
          return {
            status: "matched" as const,
            observations: [{ observationId: "fixture-observation" }],
            detectorsWithoutCoverage: ["semgrep"],
          };
        },
        authenticateEvidence: async () => ({
          status: "authenticated" as const,
          scanId: baseline.scanId,
          producerIdentity: "fixture-producer",
        }),
      },
    );
  const first = await qualify();
  expect(first.valid).toBe(true);
  if (!first.valid) return;
  expect(licenseChecks).toBe(1);
  const shared = first.itemCoverage
    .flatMap((item) => item.members)
    .filter((member) => member.descriptor.path === "release/materials/LICENSE");
  expect(shared).toHaveLength(2);
  expect(
    first.itemCoverage
      .flatMap((item) => item.members)
      .find((member) => member.descriptor.path === "release/materials/alpha/SKILL.md")
      ?.observationIds,
  ).toEqual(["different-path-observation"]);
  expect(
    shared.map((member) => [
      member.capture,
      member.observationIds,
      member.detectorsWithoutCoverage,
    ]),
  ).toEqual([
    ["matched", ["fixture-observation"], ["semgrep"]],
    ["matched", ["fixture-observation"], ["semgrep"]],
  ]);
  const second = await qualify();
  expect(second.valid).toBe(true);
  if (!second.valid) return;
  expect(licenseChecks).toBe(2);
  expect(
    second.itemCoverage
      .flatMap((item) => item.members)
      .filter((member) => member.descriptor.path === "release/materials/LICENSE")
      .map((member) => [member.capture, member.observationIds, member.detectorsWithoutCoverage]),
  ).toEqual([
    ["mismatched", [], []],
    ["mismatched", [], []],
  ]);
});

it("owns an admitted read snapshot without narrowing Scan's JSON depth", async () => {
  const contentBytes = releaseBytes(fixtureRelease());
  const artifact = new TextEncoder().encode("fixture assessment");
  const baseline = {
    ...boundRelease().baseline,
    artifact: {
      sha256: sha256(artifact),
      byteLength: artifact.length,
      location: { kind: "package", path: "release/baseline.json" },
    },
  };
  let details: unknown = JSON.parse('{"__proto__":{"ordinary":"data"}}');
  for (let index = 0; index < 508; index++) details = { nested: details };
  const hostRead = {
    status: "read" as const,
    scanId: baseline.scanId,
    report: { selection: { paths: ["release"], excludedPaths: [] }, details },
  };
  const result = await prepareReleaseBaseline(
    { contentBytes, expectedSha256: sha256(contentBytes), baseline, trust: {} },
    {
      acquireArtifact: async () => artifact,
      readArtifact: async () => hostRead,
      readContentCoverage: async ({ read }) => {
        expect(read.report.details).toEqual(details);
        return read.report.selection.paths.length === 1
          ? { status: "matched" as const, observations: [], detectorsWithoutCoverage: [] }
          : { status: "unavailable" as const };
      },
      authenticateEvidence: async () => {
        hostRead.report.selection.paths.push("later-host-change");
        return {
          status: "authenticated" as const,
          scanId: baseline.scanId,
          producerIdentity: "fixture-producer",
        };
      },
    },
  );
  expect(result.valid).toBe(true);
  expect(hostRead.report.selection.paths).toEqual(["release", "later-host-change"]);
});

it("uses one authenticated batch in member order and owns the projected result", async () => {
  const contentBytes = releaseBytes(fixtureRelease());
  const artifact = new TextEncoder().encode("batch fixture assessment");
  const baseline = {
    ...boundRelease().baseline,
    artifact: {
      sha256: sha256(artifact),
      byteLength: artifact.length,
      location: { kind: "package", path: "release/baseline.json" },
    },
  };
  const calls: string[] = [];
  const observations = [{ observationId: "first" }, { observationId: "second" }];
  const gaps = ["semgrep"];
  const result = await prepareReleaseBaseline(
    { contentBytes, expectedSha256: sha256(contentBytes), baseline, trust: {} },
    {
      acquireArtifact: async () => artifact,
      readArtifact: async () => ({
        status: "read" as const,
        scanId: baseline.scanId,
        report: { selection: { paths: ["release"], excludedPaths: [] } },
      }),
      readContentCoverage: async ({ descriptors }) => {
        expect(descriptors).toEqual([baseline.inventory]);
        calls.push("inventory");
        return { status: "matched" as const, observations: [], detectorsWithoutCoverage: [] };
      },
      authenticateEvidence: async () => {
        calls.push("authenticate");
        return {
          status: "authenticated" as const,
          scanId: baseline.scanId,
          producerIdentity: "fixture",
        };
      },
      readContentCoverageBatch: async ({ queries }) => {
        calls.push("batch");
        const fixture = readRelease(contentBytes, { expectedSha256: sha256(contentBytes) });
        if (!fixture.valid) throw new Error("Invalid fixture");
        const expected = fixture.release.items.flatMap((item) => [item.recipe, ...item.materials]);
        expect(queries.map((query) => query.descriptors)).toEqual(
          expected.map((member) => [
            {
              path: String(
                (member as { path?: string; packagePath?: string }).path ??
                  (member as { packagePath?: string }).packagePath,
              ),
              sha256: member.sha256,
              byteLength: member.byteLength,
            },
          ]),
        );
        const first = queries[0]?.descriptors[0];
        if (!first) throw new Error("Missing first query");
        Object.assign(first, { path: "host-change" });
        return {
          status: "complete" as const,
          observations,
          results: queries.map((_, index) =>
            index === 1
              ? { status: "mismatched" as const }
              : {
                  status: "matched" as const,
                  observationIndexes: [1, 0, 1],
                  detectorsWithoutCoverage: gaps,
                },
          ),
        };
      },
    },
  );
  expect(calls).toEqual(["inventory", "authenticate", "batch"]);
  expect(result.valid).toBe(true);
  if (!result.valid) return;
  Object.assign(observations[0] ?? {}, { observationId: "later-host-change" });
  gaps.push("later-host-change");
  const members = result.itemCoverage.flatMap((item) => item.members);
  expect(members[0]?.descriptor.path).not.toBe("host-change");
  expect(members[0]?.observationIds).toEqual(["second", "first", "second"]);
  expect(members[0]?.detectorsWithoutCoverage).toEqual(["semgrep"]);
  expect(members[1]).toMatchObject({
    capture: "mismatched",
    observationIds: [],
    detectorsWithoutCoverage: [],
  });
  expect(Object.isFrozen(members[0]?.observationIds)).toBe(true);
});

it.each([
  "global-invalid",
  "missing-row",
  "extra-row",
  "invalid-row",
  "unavailable-row",
  "negative-index",
  "fraction-index",
  "outside-index",
  "invalid-observation",
  "invalid-gap",
])("refuses a malformed or unreadable batch without singleton fallback: %s", async (kind) => {
  const contentBytes = releaseBytes(fixtureRelease());
  const artifact = new TextEncoder().encode("batch fixture assessment");
  const baseline = {
    ...boundRelease().baseline,
    artifact: {
      sha256: sha256(artifact),
      byteLength: artifact.length,
      location: { kind: "package", path: "release/baseline.json" },
    },
  };
  let singletonCalls = 0;
  const result = await prepareReleaseBaseline(
    { contentBytes, expectedSha256: sha256(contentBytes), baseline, trust: {} },
    {
      acquireArtifact: async () => artifact,
      readArtifact: async () => ({
        status: "read" as const,
        scanId: baseline.scanId,
        report: { selection: { paths: ["release"], excludedPaths: [] } },
      }),
      readContentCoverage: async () => {
        singletonCalls++;
        return { status: "matched" as const, observations: [], detectorsWithoutCoverage: [] };
      },
      authenticateEvidence: async () => ({
        status: "authenticated" as const,
        scanId: baseline.scanId,
        producerIdentity: "fixture",
      }),
      readContentCoverageBatch: async ({ queries }) => {
        if (kind === "global-invalid") return { status: "invalid" as const };
        const row = {
          status: "matched" as const,
          observationIndexes: [0],
          detectorsWithoutCoverage: [] as string[],
        };
        const results: unknown[] = queries.map(() => ({ ...row }));
        if (kind === "missing-row") results.pop();
        if (kind === "extra-row") results.push(row);
        if (kind === "invalid-row") results[0] = { status: "invalid" };
        if (kind === "unavailable-row") results[0] = { status: "unavailable" };
        if (kind.endsWith("-index"))
          results[0] = {
            ...row,
            observationIndexes: [
              kind === "negative-index" ? -1 : kind === "fraction-index" ? 0.5 : 1,
            ],
          };
        if (kind === "invalid-gap") results[0] = { ...row, detectorsWithoutCoverage: [42] };
        return {
          status: "complete",
          observations: [{ observationId: kind === "invalid-observation" ? 42 : "fixture" }],
          results,
        } as never;
      },
    },
  );
  expect(result.valid).toBe(false);
  expect(singletonCalls).toBe(1);
});

it("does not classify members before successful authentication", async () => {
  const contentBytes = releaseBytes(fixtureRelease());
  const artifact = new TextEncoder().encode("batch fixture assessment");
  const baseline = {
    ...boundRelease().baseline,
    artifact: {
      sha256: sha256(artifact),
      byteLength: artifact.length,
      location: { kind: "package", path: "release/baseline.json" },
    },
  };
  let batches = 0;
  const result = await prepareReleaseBaseline(
    { contentBytes, expectedSha256: sha256(contentBytes), baseline, trust: {} },
    {
      acquireArtifact: async () => artifact,
      readArtifact: async () => ({
        status: "read" as const,
        scanId: baseline.scanId,
        report: { selection: { paths: ["release"], excludedPaths: [] } },
      }),
      readContentCoverage: async () => ({
        status: "matched" as const,
        observations: [],
        detectorsWithoutCoverage: [],
      }),
      authenticateEvidence: async () => ({ status: "unverifiable" as const }),
      readContentCoverageBatch: async () => {
        batches++;
        return { status: "invalid" as const };
      },
    },
  );
  expect(result.valid ? [] : result.diagnostics.map((d) => d.reason)).toEqual([
    "baseline-unauthenticated",
  ]);
  expect(batches).toBe(0);
});
