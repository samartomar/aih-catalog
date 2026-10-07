import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifySignedHistoryDigests } from "./signed-history-digests.js";

const root = resolve(import.meta.dirname, "..", "..");
const json = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const index = json("defaults/catalog-index-v1.json");
const presentation = json("defaults/catalog-presentation-v1.json");
const declaration = json("src/production/data/core-product-declarations-v1.json");
const ids = index.entries.map((entry: { entryId: string }) => entry.entryId);
const signedHistory = json("tests/fixtures/catalog-signed-history-sha256.json");

describe("REL4 current curation", () => {
  it("has one indexed row per server and keeps the distinct ECC integrations", () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("mcp.ecc.exa-web-search");
    expect(ids).toContain("mcp.ecc.token-optimizer");
    expect(ids).not.toContain("mcp.aih.exa.core-0-7-0");
    expect(ids).not.toContain("tool.aih.token-optimizer.core-0-7-0");
    for (const name of [
      "code-review-graph",
      "codebase-memory-mcp",
      "context7",
      "github",
      "sequential-thinking",
      "exa",
    ])
      expect(ids).not.toContain(`mcp.ecc.${name}`);
  });

  it("publishes Core-authored aih descriptions bound to the declaration source", () => {
    const aih = presentation.entries.filter((entry: { entryId: string }) =>
      entry.entryId.startsWith("mcp.aih."),
    );
    expect(aih).toHaveLength(7);
    for (const entry of aih) {
      expect(entry.description.state, entry.entryId).toBe("published");
      expect(entry.source?.path, entry.entryId).toBe(
        "src/production/data/core-product-declarations-v1.json",
      );
      expect(entry.source?.sha256, entry.entryId).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.management, entry.entryId).toBeDefined();
    }
    for (const name of ["github", "context7"]) {
      const entry = aih.find(
        (candidate: { entryId: string }) => candidate.entryId === `mcp.aih.${name}.core-0-7-0`,
      );
      expect(entry?.management).toBe("developer-managed");
      expect(entry?.availability).toBe("request-only");
      expect(entry?.availabilityReason).toBe(
        declaration.nonProjectableMcp.find((item: { id: string }) => item.id === name)?.reason,
      );
      expect(entry?.managementNote).toContain("hosted service; network egress");
    }
    for (const name of [
      "code-review-graph",
      "codebase-memory-mcp",
      "sequential-thinking",
      "serena",
    ]) {
      const entry = aih.find(
        (candidate: { entryId: string }) => candidate.entryId === `mcp.aih.${name}.core-0-7-0`,
      );
      expect(entry?.management).toBe("aih-managed");
      expect(entry?.availability).toBe("available");
    }
    const playwright = aih.find(
      (candidate: { entryId: string }) => candidate.entryId === "mcp.aih.playwright.core-0-7-0",
    );
    expect(playwright?.management).toBe("aih-owned-unavailable");
    expect(playwright?.availability).toBe("request-only");
    expect(playwright?.availabilityReason).toBe(declaration.unavailableMcp[0].reason);
  });

  it("has no Ponytail in current Catalog surfaces, while preserving signed history", () => {
    expect(signedHistory).toHaveLength(20);
    expect(ids.some((id: string) => id.includes("ponytail"))).toBe(false);
    expect(
      presentation.sources.some((source: { repository?: string }) =>
        source.repository?.includes("ponytail"),
      ),
    ).toBe(false);
    expect(() => verifySignedHistoryDigests(root, signedHistory)).not.toThrow();
  });

  it("rejects changes or deletion of signed history, but permits a successor file", () => {
    const temporaryRoot = mkdtempSync(resolve(tmpdir(), "catalog-signed-history-"));
    try {
      cpSync(resolve(root, "catalog"), resolve(temporaryRoot, "catalog"), { recursive: true });
      const listedPath = resolve(temporaryRoot, signedHistory[0].path);
      writeFileSync(listedPath, "changed signed history");
      expect(() => verifySignedHistoryDigests(temporaryRoot, signedHistory)).toThrow();
      cpSync(resolve(root, signedHistory[0].path), listedPath);
      unlinkSync(listedPath);
      expect(() => verifySignedHistoryDigests(temporaryRoot, signedHistory)).toThrow();
      cpSync(resolve(root, signedHistory[0].path), listedPath);
      writeFileSync(resolve(temporaryRoot, "catalog", "successor-seq7.json"), "new history");
      expect(() => verifySignedHistoryDigests(temporaryRoot, signedHistory)).not.toThrow();
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
