import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifySignedCatalogV2 } from "../../src/supported/signed-catalog-v2.js";

const root = resolve(import.meta.dirname, "..", "..");
const genesisRootPath = resolve(root, "catalog", "genesis", "catalog-signer-root.json");
const signedCatalogPath = resolve(root, "catalog", "genesis", "signed-catalog-v2.json");
const zeroDigest = "0".repeat(64);
const genesisSignerFingerprint = "a286e8c5ce5c20b4393ea8eafe7f149ac65685c2d3ce8ca49fdc295ecbfdad6a";
const genesisSignedCatalogSha256 =
  "6a561e5b4e38292578ce73ffba17dd17fec9ee99048205aacddcd75261efa2f2";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

describe("committed Catalog V2 genesis", () => {
  it("verifies the 428-member successor with unchanged previous membership and pinned signer", () => {
    const directory = resolve(root, "catalog/workbench-latest-source-2026-09-09");
    const bytes = readFileSync(resolve(directory, "signed-catalog-v2.json"), "utf8");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "5949d4d5b333b8ade30ce47c5525e7ba0bb3f7e68a892d3b554ae6bca65718e9",
    );
    const signed = JSON.parse(bytes);
    const previous = JSON.parse(readFileSync(resolve(directory, "previous-head.json"), "utf8"));
    const signerRoot = JSON.parse(readFileSync(genesisRootPath, "utf8"));
    const head = verifySignedCatalogV2({
      catalogSignerRoots: [signerRoot],
      expectedClaims: {
        environment: "catalog-signing",
        eventName: "workflow_dispatch",
        issuer: "https://token.actions.githubusercontent.com",
        jobWorkflowRef:
          "samartomar/aih-catalog/.github/workflows/signed-catalog-v2.yml@refs/heads/main",
        ref: "refs/heads/main",
        repository: "samartomar/aih-catalog",
        repositoryId: "1337425654",
        repositoryOwnerId: "9993940",
      },
      now: "2026-09-09T00:53:33Z",
      lastAccepted: previous,
      replay: { acceptedIdentities: [] },
      signed,
    });
    expect(head).toMatchObject({
      sequence: 2,
      previousCatalogHeadSha256: "04ac3bb54a716cf4681c5d2c40f11d72a40fb9f6440c5d77e3f1451788e8f5a2",
      signer: { keyId: `ed25519:${genesisSignerFingerprint}` },
    });
    const entries = head.entries as Record<string, unknown>[];
    expect(entries).toHaveLength(428);
    expect(previous.entries).toHaveLength(26);
    for (const prior of previous.entries)
      expect(entries.find((entry) => entry.entryId === prior.entryId)).toEqual(prior);
  });

  it("is a canonical, signed, live-claim genesis with bounded validity", () => {
    const rootText = readFileSync(genesisRootPath, "utf8");
    const signedText = readFileSync(signedCatalogPath, "utf8");
    const signerRoot = JSON.parse(rootText) as Record<string, unknown>;
    const signed = JSON.parse(signedText) as { head: Record<string, unknown> };
    const head = signed.head;
    const validFrom = String(head.validFrom);
    const validUntil = String(head.validUntil);

    expect(rootText).toBe(canonicalJson(signerRoot));
    expect(signedText).toBe(canonicalJson(signed));
    expect(createHash("sha256").update(signedText).digest("hex")).toBe(genesisSignedCatalogSha256);
    expect(signerRoot).toMatchObject({
      class: "administrator-ed25519",
      identity: "administrator:aih-supported/catalog-v2",
      keyId: `ed25519:${genesisSignerFingerprint}`,
      publicKeySpkiSha256: genesisSignerFingerprint,
    });
    expect(head).toMatchObject({
      sequence: 0,
      previousCatalogHeadSha256: zeroDigest,
      claims: {
        environment: "catalog-signing",
        eventName: "workflow_dispatch",
        issuer: "https://token.actions.githubusercontent.com",
        jobWorkflowRef:
          "samartomar/aih-catalog/.github/workflows/signed-catalog-v2.yml@refs/heads/main",
        ref: "refs/heads/main",
        repository: "samartomar/aih-catalog",
        repositoryId: "1337425654",
        repositoryOwnerId: "9993940",
      },
    });
    expect(Date.parse(validUntil) - Date.parse(validFrom)).toBeGreaterThan(0);
    expect(Date.parse(validUntil) - Date.parse(validFrom)).toBeLessThanOrEqual(
      90 * 24 * 60 * 60 * 1000,
    );

    expect(
      verifySignedCatalogV2({
        catalogSignerRoots: [signerRoot],
        expectedClaims: head.claims,
        now: validFrom,
        signed,
      }),
    ).toMatchObject({ catalogHeadSha256: head.catalogHeadSha256 });
  });
});
