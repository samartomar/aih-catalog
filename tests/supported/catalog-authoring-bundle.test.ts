import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareCatalogSourceDataV1, readCatalogAuthoringBundleV1Result } from "../../src/index.js";
import {
  buildCatalogFrameworkDefaultsV1,
  serializeCatalogDefaultV1,
} from "../../src/production/catalog-defaults-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const path = "defaults/catalog-authoring-bundle-v1.json";

describe("Catalog authoring production", () => {
  it("keeps the six curated ECC MCP duplicates out of the final built bundle", () => {
    const generated = buildCatalogFrameworkDefaultsV1(root);
    const output = generated[path] as {
      prepared: {
        bundle: {
          assets: Record<string, unknown>;
          groups: Record<string, { assetIds: string[] }>;
        };
      };
      sourceRecords: { bytes: string }[];
    };
    const finalBundle = output.prepared.bundle;
    const removed = [
      "code-review-graph",
      "codebase-memory-mcp",
      "context7",
      "exa",
      "github",
      "sequential-thinking",
    ].map((name) => `ecc/mcp:${name}`);
    for (const id of removed) {
      expect(finalBundle.assets, id).not.toHaveProperty(id);
      expect(JSON.stringify(finalBundle), id).not.toContain(JSON.stringify(id));
    }
    expect(finalBundle.assets).toHaveProperty("ecc/mcp:exa-web-search");
    expect(finalBundle.groups["group:ecc/mcp"]?.assetIds).toContain("ecc/mcp:exa-web-search");
    expect(finalBundle.groups["group:ecc/mcp"]?.assetIds).toHaveLength(31);
    expect(output.sourceRecords.some((record) => record.bytes.includes('"ecc/mcp:exa"'))).toBe(
      true,
    );
  });

  it("generates and reads the committed authoring bundle with its sealed records", () => {
    const generated = buildCatalogFrameworkDefaultsV1(root);
    expect(serializeCatalogDefaultV1(generated[path])).toBe(
      readFileSync(resolve(root, path), "utf8"),
    );
    const result = readCatalogAuthoringBundleV1Result({ bytes: readFileSync(resolve(root, path)) });
    expect(result).toMatchObject({
      state: "read",
      authoring: { format: "aih-catalog-authoring-bundle", version: 1 },
    });
    if (result.state !== "read") throw new Error(result.reason);
    expect(result.authoring.sourceRecords).toHaveLength(3);
    expect(result.authoring.prepared.bundle.version).toBe("authoring-catalog-bundle/v1");
  });

  it("prepares a closed unsigned source-data payload without signing or activating it", () => {
    const payload = prepareCatalogSourceDataV1({
      sourceId: "source:ecc",
      sourceBundle: { sources: { "source:ecc": { id: "source:ecc" } } },
      sequence: 2,
      previousDigest: "sha256:abc",
      issuedAt: "2026-09-23T00:00:00.000Z",
      expiresAt: "2026-12-22T00:00:00.000Z",
    });
    expect(payload).toEqual({
      version: "workbench-source-data/v1",
      compatibility: "core-workbench-data/v1",
      sequence: 2,
      previousDigest: "sha256:abc",
      issuedAt: "2026-09-23T00:00:00.000Z",
      expiresAt: "2026-12-22T00:00:00.000Z",
      sourceBundle: { sources: { "source:ecc": { id: "source:ecc" } } },
    });
  });
});
