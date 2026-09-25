import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
