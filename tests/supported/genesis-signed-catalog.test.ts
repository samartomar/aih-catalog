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
