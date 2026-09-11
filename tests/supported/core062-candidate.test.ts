import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, it } from "vitest";
import {
  parseCatalogHeadV2Json,
  planCatalogPromotionV2,
  verifySignedCatalogV2,
} from "../../src/index.js";

const root = resolve(import.meta.dirname, "../..");
const directory = resolve(root, "catalog/workbench-core062-2026-09-11");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const sha = (bytes: Buffer | string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

it("verifies the approved head under the established administrator key and predecessor", () => {
  const bytes = readFileSync(resolve(directory, "signed-catalog-v2.json"), "utf8");
  expect(sha(bytes)).toBe(
    "sha256:51f1f0689c57235429f4312b660cbf4d95d75258001c755b7d221bae6729859e",
  );
  const signed = JSON.parse(bytes);
  const previous = read(resolve(directory, "previous-head.json"));
  const verified = verifySignedCatalogV2({
    signed,
    catalogSignerRoots: [read(resolve(root, "catalog/genesis/catalog-signer-root.json"))],
    expectedClaims: previous.claims,
    lastAccepted: previous,
    replay: { acceptedIdentities: [] },
    now: signed.head.validFrom,
  });
  expect(verified).toEqual(
    parseCatalogHeadV2Json(
      readFileSync(resolve(directory, "unsigned-candidate-seq5.json"), "utf8"),
    ),
  );
});

it("adds only nine Core 0.6.2 members while preserving the exact predecessor and expiry", () => {
  const bytes = readFileSync(resolve(directory, "unsigned-candidate-seq5.json"), "utf8");
  expect(sha(bytes)).toBe(
    "sha256:5b815982235e85b857d443ee778fa7e84592fd75985a2a770f4eb4390c9df3aa",
  );
  const candidate = parseCatalogHeadV2Json(bytes);
  const previous = read(resolve(directory, "previous-head.json"));
  expect(previous).toEqual(
    read(resolve(root, "catalog/workbench-core061-npm-2026-09-09/signed-catalog-v2.json")).head,
  );
  expect(candidate.sequence).toBe(5);
  expect(candidate.previousCatalogHeadSha256).toBe(previous.catalogHeadSha256);
  expect(candidate.validUntil).toBe(previous.validUntil);
  expect(candidate.claims).toEqual(previous.claims);
  expect(candidate.signer).toEqual(previous.signer);
  const entries = candidate.entries as Record<string, unknown>[];
  expect(entries).toHaveLength(456);
  expect(previous.entries).toHaveLength(447);
  for (const member of previous.entries) {
    expect(entries.find((entry) => entry.entryId === member.entryId)).toEqual(member);
  }
  const added = entries.filter(
    (entry) => !previous.entries.some((old: { entryId: string }) => old.entryId === entry.entryId),
  );
  expect(added).toHaveLength(9);
  expect(added.every((entry) => String(entry.entryId).endsWith(".core-0-6-2"))).toBe(true);
  const promotion = planCatalogPromotionV2({
    candidateHead: candidate,
    lastGood: previous,
    now: candidate.validFrom,
  });
  expect(promotion.kind).toBe("last-good");
  const facts = promotion.facts as Record<string, unknown>[];
  expect(facts).toHaveLength(9);
  expect(facts.every((fact) => fact.surface === "entry-added")).toBe(true);
  expect(read(resolve(directory, "promotion-plan.json"))).toEqual({
    candidateCatalogHeadSha256: candidate.catalogHeadSha256,
    facts,
    kind: promotion.kind,
    lastGoodCatalogHeadSha256: previous.catalogHeadSha256,
  });
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

it("binds current declarations while retaining Scanner findings, dates and unsupported hook scope", () => {
  const prefix = "workbench/aih-core-0.6.2/";
  const manifest = read(resolve(root, "defaults/default-catalog-seed-manifest-v2.json"));
  const paths: string[] = manifest.seeds.filter((path: string) => path.startsWith(prefix));
  expect(paths).toHaveLength(9);
  expect(manifest.seeds).toHaveLength(456);
  const wrapper = read(
    resolve(root, "defaults", prefix, "source-reports/verified-report-wrapper.json"),
  );
  expect(sha(wrapper.bytes)).toBe(wrapper.sha256);
  const report = JSON.parse(wrapper.bytes);
  const old = JSON.parse(
    read(
      resolve(
        root,
        "defaults/workbench/aih-core-0.6.1/source-reports/verified-report-wrapper.json",
      ),
    ).bytes,
  );
  for (const key of ["report", "observations", "publications"])
    expect(report[key]).toEqual(old[key]);
  expect(report.catalog.pinnedCommit).toBe(old.catalog.pinnedCommit);
  expect(report.catalog.sourceTreeSha256).toBe(old.catalog.sourceTreeSha256);
  expect(report.catalog.source.revisionId).toBe("package:@aihq/core@0.6.2");
  expect(report.coverage.components).toHaveLength(10);
  let blocked = 0;
  for (const path of paths) {
    const seedPath = resolve(root, "defaults", path);
    const seed = read(seedPath);
    const profileBytes = readFileSync(resolve(dirname(seedPath), seed.artifacts.profile));
    const profile = JSON.parse(profileBytes.toString("utf8"));
    const closure = read(resolve(dirname(seedPath), seed.artifacts.closure));
    expect(seed.subject.source).toEqual({
      type: "aih",
      release: "0.6.2",
      revision: sha(profileBytes),
    });
    expect(closure.sourceRevisionId).toBe("package:@aihq/core@0.6.2");
    expect(closure.contentDigest).toBe(profile.asset.contentDigest);
    expect(closure.sourceContentDigest).toBe(report.catalog.source.contentDigest);
    expect(closure.scope).toEqual(profile.scope);
    expect(closure.files).toEqual(profile.material.files ?? []);
    expect(seed.entryId).toMatch(/\.core-0-6-2$/);
    expect(seed.qualification.gaps).toHaveLength(1);
    expect(seed.qualification.rights).toHaveLength(1);
    const observation = report.observations.find(
      (item: { componentId: string }) => item.componentId === profile.scanner.component.componentId,
    );
    expect(observation).toMatchObject(profile.scanner.observation);
    const recipe = read(resolve(dirname(seedPath), seed.artifacts.recipe));
    expect(recipe.asset).toEqual(profile.asset);
    expect(recipe.scannerObservation).toEqual(observation);
    expect(recipe.scannerReportSha256).toBe(wrapper.sha256);
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
  const draft = read(resolve(root, "defaults", prefix, "source-reports/qualification-draft.json"));
  expect(draft.unsupported).toEqual([
    { assetId: "aih/usage-metering", reason: "unsupported-governance-subject-kind" },
  ]);
});
