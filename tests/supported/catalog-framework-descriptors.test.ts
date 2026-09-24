import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readCatalogFrameworkDescriptorV1Result,
  readCatalogFrameworkPluginsV1Result,
} from "../../src/index.js";
import {
  buildCatalogFrameworkDefaultsV1,
  serializeCatalogDefaultV1,
} from "../../src/production/catalog-defaults-v1.js";

const root = resolve(import.meta.dirname, "..", "..");

describe("Catalog-owned framework descriptors", () => {
  it("generates the committed descriptors and plugin identities from Catalog-owned inputs", () => {
    const generated = buildCatalogFrameworkDefaultsV1(root);
    for (const [path, value] of Object.entries(generated)) {
      expect(readFileSync(resolve(root, path), "utf8")).toBe(serializeCatalogDefaultV1(value));
    }
  });

  it("publishes closed ECC and Superpowers descriptor documents", () => {
    for (const frameworkId of ["ecc", "superpowers"] as const) {
      const bytes = readFileSync(
        resolve(root, `defaults/catalog-framework-${frameworkId}-v1.json`),
      );
      const result = readCatalogFrameworkDescriptorV1Result({ bytes, frameworkId });
      expect(result).toMatchObject({
        state: "read",
        descriptor: {
          format: "aih-catalog-framework-descriptor",
          version: 1,
          frameworkId,
        },
      });
      if (result.state !== "read") throw new Error(result.reason);
      expect(Object.keys(result.descriptor.sections).length).toBeGreaterThan(0);
    }
  });

  it("publishes the closed plugin identity set with exact compatibility ranges", () => {
    const bytes = readFileSync(resolve(root, "defaults/catalog-framework-plugins-v1.json"));
    const result = readCatalogFrameworkPluginsV1Result({ bytes });
    expect(result).toMatchObject({ state: "read" });
    if (result.state !== "read") throw new Error(result.reason);
    expect(result.plugins.entries).toEqual([
      expect.objectContaining({
        frameworkId: "ecc",
        packageName: "@aihq/framework-ecc",
        version: "0.1.0",
        contractVersion: 1,
        supportedCore: ">=0.7.0 <0.8.0",
      }),
      expect.objectContaining({
        frameworkId: "superpowers",
        packageName: "@aihq/framework-superpowers",
        version: "0.1.0",
        contractVersion: 1,
        supportedCore: ">=0.7.0 <0.8.0",
      }),
    ]);
  });

  it("rejects a descriptor whose requested identity does not match its bytes", () => {
    const bytes = readFileSync(resolve(root, "defaults/catalog-framework-ecc-v1.json"));
    expect(
      readCatalogFrameworkDescriptorV1Result({ bytes, frameworkId: "superpowers" }),
    ).toMatchObject({ state: "refused", reason: "framework-mismatch" });
  });
});
