import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, it } from "vitest";
import { parseCatalogHeadV2Json, verifySignedCatalogV2 } from "../../src/index.js";

const root = resolve(import.meta.dirname, "../..");
const directory = resolve(root, "catalog/workbench-core061-npm-2026-09-09");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const sha = (bytes: Buffer | string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const candidateBytes = readFileSync(resolve(directory, "unsigned-candidate-seq4.json"), "utf8");
const candidate = parseCatalogHeadV2Json(candidateBytes);
const previous = read(resolve(directory, "previous-head.json"));

it("retains all published members and original authority boundaries in the unsigned successor", () => {
  expect(sha(candidateBytes)).toBe(
    "sha256:6423cf2a8795d5d76ca481bc6718de8425245f99701514a63e7dc415a25184d2",
  );
  expect(previous).toEqual(
    read(resolve(root, "catalog/workbench-aih-2026-09-09/signed-catalog-v2.json")).head,
  );
  expect(candidate.sequence).toBe(previous.sequence + 1);
  expect(candidate.previousCatalogHeadSha256).toBe(previous.catalogHeadSha256);
  expect(candidate.validUntil).toBe(previous.validUntil);
  expect(candidate.claims).toEqual(previous.claims);
  expect(candidate.signer).toEqual(previous.signer);
  const entries = candidate.entries as Record<string, unknown>[];
  expect(entries).toHaveLength(447);
  expect(previous.entries).toHaveLength(437);
  for (const retained of previous.entries) {
    expect(entries.find((entry) => entry.entryId === retained.entryId)).toEqual(retained);
  }
  expect(() =>
    verifySignedCatalogV2({
      signed: candidate,
      catalogSignerRoots: [read(resolve(root, "catalog/genesis/catalog-signer-root.json"))],
      expectedClaims: previous.claims,
      lastAccepted: previous,
      replay: { acceptedIdentities: [] },
      now: candidate.validFrom,
    }),
  ).toThrow();
});

it("binds nine current Core subjects while retaining original Scanner facts and the blocked finding", () => {
  const prefix = "workbench/aih-core-0.6.1/";
  const manifest = read(resolve(root, "defaults/default-catalog-seed-manifest-v2.json"));
  const paths: string[] = manifest.seeds.filter((path: string) => path.startsWith(prefix));
  expect(paths).toHaveLength(9);
  const wrapper = read(
    resolve(root, "defaults", prefix, "source-reports/verified-report-wrapper.json"),
  );
  expect(sha(wrapper.bytes)).toBe(wrapper.sha256);
  const report = JSON.parse(wrapper.bytes);
  const old = JSON.parse(
    read(resolve(root, "defaults/workbench/aih/source-reports/verified-report-wrapper.json")).bytes,
  );
  for (const key of ["report", "observations", "publications"])
    expect(report[key]).toEqual(old[key]);
  expect(report.coverage.components).toHaveLength(10);
  expect(report.catalog.source.revisionId).toBe("package:@aihq/core@0.6.1");
  let blocked = 0;
  for (const path of paths) {
    const seedPath = resolve(root, "defaults", path);
    const seed = read(seedPath);
    const profileBytes = readFileSync(resolve(dirname(seedPath), seed.artifacts.profile));
    const profile = JSON.parse(profileBytes.toString("utf8"));
    const closure = read(resolve(dirname(seedPath), seed.artifacts.closure));
    expect(seed.subject.source).toEqual({
      type: "aih",
      release: "0.6.1",
      revision: sha(profileBytes),
    });
    expect(closure.sourceRevisionId).toBe("package:@aihq/core@0.6.1");
    expect(closure.sourceContentDigest).toBe(report.catalog.source.contentDigest);
    expect(closure.scope).toEqual(profile.scope);
    expect(closure.files).toEqual(profile.material.files ?? []);
    expect(seed.entryId).toMatch(/\.core-0-6-1$/);
    expect(seed.qualification.gaps).toHaveLength(1);
    expect(seed.qualification.rights).toHaveLength(1);
    const observation = report.observations.find(
      (item: { componentId: string }) => item.componentId === profile.scanner.component.componentId,
    );
    expect(observation).toMatchObject(profile.scanner.observation);
    const evidence = read(resolve(dirname(seedPath), seed.qualification.report));
    expect(evidence.subjectDigest).toBe(closure.subjectDigest);
    if (seed.subject.id === "github") {
      expect(evidence.summary).toContain("verdict blocked");
      expect(seed.qualification.findings).toHaveLength(1);
      expect(read(resolve(dirname(seedPath), seed.qualification.findings[0])).summary).toContain(
        "trust.external-egress",
      );
      blocked++;
    } else expect(seed.qualification.findings).toHaveLength(0);
  }
  expect(blocked).toBe(1);
  expect(paths.some((path) => path.includes("usage-metering"))).toBe(false);
});

it("keeps exact npm bytes and explicit missing scan coverage without claiming a passing scan", () => {
  const base = resolve(root, "defaults/workbench/npm/package.picocolors");
  const seed = read(resolve(base, "seed.json"));
  expect(seed.subject.source).toMatchObject({
    package: "picocolors",
    type: "npm",
    version: "1.1.1",
  });
  const tar = readFileSync(resolve(base, "artifacts/public-projection/picocolors-1.1.1.tgz"));
  expect(`sha512-${createHash("sha512").update(tar).digest("base64")}`).toBe(
    seed.subject.source.integrity,
  );
  expect(seed.qualification.findings).toHaveLength(0);
  expect(seed.qualification.gaps).toHaveLength(9);
  expect(seed.qualification.rights).toHaveLength(1);
  expect(
    read(resolve(base, "artifacts/public-projection/preflight-projection.json")).observed,
  ).toMatchObject({
    finalVerdict: "warn",
    scanState: "missing",
    nativeOnly: true,
    trustScore: 50,
  });
});
