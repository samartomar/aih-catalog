import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
