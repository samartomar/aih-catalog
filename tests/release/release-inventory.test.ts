import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  contractSupport,
  preparedReleaseContent,
  releaseInventory,
} from "../../src/release/contracts.js";
import { readInstalledRelease } from "../../src/release/node.js";

const root = resolve(import.meta.dirname, "../..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
// Prepared content awaiting its baseline is not a release; it is listed separately.
const preparedExports = new Set(
  preparedReleaseContent.map((entry) => entry.export.replace("@aihq/catalog/", "./")),
);
const releaseExports = Object.keys(pkg.exports).filter(
  (name) => /^\.\/release[^/]*\.json$/.test(name) && !preparedExports.has(name),
);

describe("release inventory", () => {
  it("lists exactly the package's release exports, once each, with package identity", () => {
    const names = releaseInventory.releases.map((entry) => entry.release);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...releaseExports].sort());
    expect(releaseInventory.defaultRelease).toBe("./release.json");
    expect(releaseInventory.package).toEqual({ name: pkg.name, version: pkg.version });
    expect(releaseInventory.package).toBe(contractSupport.package);
    for (const entry of releaseInventory.releases) {
      expect(entry.export).toBe(`${pkg.name}/${entry.release.slice(2)}`);
    }
  });

  it("states each committed document's own format, declared in contractSupport", () => {
    for (const entry of releaseInventory.releases) {
      const document = JSON.parse(readFileSync(resolve(root, pkg.exports[entry.release]), "utf8"));
      expect(document.schema, entry.release).toBe(entry.schema);
      expect(
        contractSupport.contracts.some((c) => c.id === entry.schema && c.role === "both"),
      ).toBe(true);
    }
  });

  it("marks only the native acceptance documents as test-scope fixtures", () => {
    const tiers = Object.fromEntries(
      releaseInventory.releases.map((entry) => [entry.release, [entry.purpose, entry.support]]),
    );
    expect(tiers).toEqual({
      "./release.json": ["content", "supported"],
      "./release-1.1.json": ["hook", "supported"],
      "./release-native-fixture.json": ["native-fixture", "test-scope"],
      "./release-native-bundles.json": ["native-fixture", "test-scope"],
      "./release-guide.json": ["content", "supported"],
      "./release-extensions.json": ["content", "supported"],
      "./release-ecc.json": ["content", "supported"],
      "./release-superpowers.json": ["content", "supported"],
      "./release-anthropic.json": ["content", "supported"],
    });
  });

  it("keeps acquisition explicit: names outside the inventory are refused", async () => {
    for (const release of ["./release-unknown.json", "release.json", "./package.json"]) {
      const result = await readInstalledRelease({
        root,
        // @ts-expect-error only inventory names are selectable
        release,
      });
      expect(result.valid).toBe(false);
      expect(result.diagnostics.map((d) => d.reason)).toEqual(["invalid-request"]);
    }
  });
});
