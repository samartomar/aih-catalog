import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCatalogFrameworkDefaultsV1,
  serializeCatalogDefaultV1,
} from "../../src/production/catalog-defaults-v1.js";

const root = resolve(import.meta.dirname, "..", "..");

describe("Catalog-owned Workbench producers", () => {
  it("regenerates every published Core companion from Catalog production inputs", () => {
    const generated = buildCatalogFrameworkDefaultsV1(root);
    for (const path of [
      "defaults/catalog-authoring-bundle-v1.json",
      "defaults/catalog-core-qualification-v1.json",
      "defaults/catalog-scanner-evidence-v1.json",
      "defaults/catalog-public-baseline-v1.json",
    ]) {
      expect(serializeCatalogDefaultV1(generated[path])).toBe(
        readFileSync(resolve(root, path), "utf8"),
      );
    }
  });

  it("does not publish precomputed Core policy bindings", () => {
    const generated = buildCatalogFrameworkDefaultsV1(root);
    const authoring = generated["defaults/catalog-authoring-bundle-v1.json"] as {
      prepared: { bindings: Record<string, unknown> };
    };
    expect(authoring.prepared.bindings).toEqual({});
  });

  it("keeps no frozen derived authoring bundle beside its true inputs", () => {
    expect(
      existsSync(
        resolve(root, "src", "production", "data", "catalog-authoring-bundle-source-v1.json"),
      ),
    ).toBe(false);
  });
});
