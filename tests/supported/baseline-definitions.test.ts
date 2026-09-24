import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BASELINE_DEFINITION_SUBJECTS_V1,
  emitBaselineDefinitionV1,
} from "../../src/production/catalog/baseline-definitions-v1.js";
import { buildCatalogFrameworkDefaultsV1 } from "../../src/production/catalog-defaults-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const data = (file: string) => resolve(root, "src", "production", "data", file);
const manifest = () =>
  JSON.parse(readFileSync(data("upstream-inputs-v1.json"), "utf8")) as {
    files: Record<string, { repository: string; commit: string }>;
  };
const recorded = (file: string) => manifest().files[file]?.commit as string;
const temporary: string[] = [];

/** A private copy of the production data the emitter reads, for tamper cases. */
function copiedRoot(): string {
  const copy = mkdtempSync(join(tmpdir(), "aih-baseline-definitions-"));
  temporary.push(copy);
  cpSync(resolve(root, "src", "production", "data"), join(copy, "src", "production", "data"), {
    recursive: true,
  });
  return copy;
}

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("baseline definition emitter", () => {
  it("names the four producers and their repositories", () => {
    expect(BASELINE_DEFINITION_SUBJECTS_V1).toEqual({
      ecc: "affaan-m/ECC",
      superpowers: "obra/Superpowers",
      mattpocock: "mattpocock/skills",
      ponytail: "DietrichGebert/ponytail",
    });
  });

  it("emits the ECC baseline catalog from the produced module and profile inputs", () => {
    const commit = recorded("ecc-modules-v1.json");
    const definition = emitBaselineDefinitionV1(root, "ecc", commit) as {
      id: string;
      owner: string;
      repo: string;
      pinnedSha: string;
      components: { id: string; paths: string[] }[];
    };
    expect(definition).toMatchObject({
      id: "ecc",
      owner: "affaan-m",
      repo: "ECC",
      pinnedSha: commit,
    });
    // Cross-check against the sealed vendor lock the Catalog carries at the same pin.
    const vendor = JSON.parse(readFileSync(data("vendor-lock-v1.json"), "utf8")) as {
      sources: { id: string; pinnedSha: string; components: { id: string; paths: string[] }[] }[];
    };
    const locked = vendor.sources.find((source) => source.id === "ecc");
    if (locked?.pinnedSha === commit) {
      expect(definition.components.map((c) => c.id).sort()).toEqual(
        locked.components.map((c) => c.id).sort(),
      );
      const byId = new Map(locked.components.map((c) => [c.id, [...c.paths].sort()]));
      for (const component of definition.components)
        expect([...component.paths].sort()).toEqual(byId.get(component.id));
    }
  });

  it("emits the Superpowers baseline catalog only at the produced revision", () => {
    const commit = recorded("superpowers-content-metadata-v1.json");
    const definition = emitBaselineDefinitionV1(root, "superpowers", commit) as {
      pinnedSha: string;
      components: { id: string }[];
    };
    expect(definition.pinnedSha).toBe(commit);
    expect(definition.components[0]?.id).toBe("runtime:superpowers-plugin");
  });

  it("emits the Matt Pocock skill collection exactly as the Catalog registers it", () => {
    const commit = recorded("mattpocock.snapshot.json");
    const registered = buildCatalogFrameworkDefaultsV1(root)[
      "defaults/catalog-scanner-providers-v1.json"
    ] as { collections: { mattpocock: unknown } };
    expect(emitBaselineDefinitionV1(root, "mattpocock", commit)).toEqual(
      registered.collections.mattpocock,
    );
  });

  it("emits the Ponytail component collection from the produced snapshot", () => {
    const commit = recorded("ponytail.snapshot.json");
    const definition = emitBaselineDefinitionV1(root, "ponytail", commit) as {
      version: string;
      source: { commit: string; repository: string };
    };
    expect(definition.version).toBe("pinned-component-collection/v1");
    expect(definition.source).toMatchObject({
      commit,
      repository: "https://github.com/DietrichGebert/ponytail",
    });
  });

  it.each([
    "ecc",
    "superpowers",
    "mattpocock",
    "ponytail",
  ] as const)("refuses %s at a commit the produced inputs were not fetched at", (name) => {
    expect(() => emitBaselineDefinitionV1(root, name, "0".repeat(40))).toThrow(
      /was produced at [0-9a-f]{40}, not 0{40}/,
    );
  });

  it("refuses a partially produced subject (one input left at another revision)", () => {
    const copy = copiedRoot();
    const path = join(copy, "src", "production", "data", "upstream-inputs-v1.json");
    const value = JSON.parse(readFileSync(path, "utf8"));
    const commit = value.files["ecc-modules-v1.json"].commit;
    value.files["ecc-mcp-inventory-v1.json"].commit = "1".repeat(40);
    writeFileSync(path, JSON.stringify(value));
    expect(() => emitBaselineDefinitionV1(copy, "ecc", commit)).toThrow(
      `ecc-mcp-inventory-v1.json was produced at ${"1".repeat(40)}, not ${commit}`,
    );
  });

  it("refuses produced bytes that no longer match their recorded sha256", () => {
    const copy = copiedRoot();
    const path = join(copy, "src", "production", "data", "ponytail.snapshot.json");
    writeFileSync(path, `${readFileSync(path, "utf8")} `);
    expect(() =>
      emitBaselineDefinitionV1(copy, "ponytail", recorded("ponytail.snapshot.json")),
    ).toThrow("does not match its recorded sha256");
  });

  it.each([
    ["an unknown producer", "anthropics-skills", "a".repeat(40)],
    ["a short commit", "ecc", "5064474d"],
    ["an uppercase commit", "ecc", "A".repeat(40)],
  ])("rejects %s", (_label, name, commit) => {
    expect(() => emitBaselineDefinitionV1(root, name, commit)).toThrow(/baseline definition/);
  });
});
