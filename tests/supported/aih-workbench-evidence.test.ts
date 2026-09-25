import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { verifySignedCatalogV2 } from "../../src/index.js";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

it("verifies the signed AIH successor without replacing retained members or extending expiry", () => {
  const directory = resolve(root, "catalog/workbench-aih-2026-09-09");
  const signed = read(resolve(directory, "signed-catalog-v2.json"));
  const previous = read(resolve(directory, "previous-head.json"));
  const rootKey = read(resolve(root, "catalog/genesis/catalog-signer-root.json"));
  const head = verifySignedCatalogV2({
    signed,
    catalogSignerRoots: [rootKey],
    expectedClaims: previous.claims,
    lastAccepted: previous,
    replay: { acceptedIdentities: [] },
    now: signed.head.validFrom,
  });
  expect(head.sequence).toBe(3);
  expect(head.catalogHeadSha256).toBe(
    "c149358bf6d75cb9d7ee75887bd629921604d1dd78ded382f52ffe341d027e1f",
  );
  expect(head.validUntil).toBe(previous.validUntil);
  const entries = head.entries as Record<string, unknown>[];
  expect(entries).toHaveLength(437);
  expect(previous.entries).toHaveLength(428);
  for (const member of previous.entries) {
    expect(entries.find((item) => item.entryId === member.entryId)).toEqual(member);
  }
});
