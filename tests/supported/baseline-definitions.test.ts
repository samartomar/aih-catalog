import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BASELINE_DEFINITION_SUBJECTS_V1,
  emitBaselineDefinitionV1,
} from "../../src/production/catalog/baseline-definitions-v1.js";
import { UPSTREAM_PRODUCED_FILES_V1 } from "../../src/production/catalog/upstream-inputs-v1.js";
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
  it("names the current producers and their repositories", () => {
    expect(BASELINE_DEFINITION_SUBJECTS_V1).toEqual({
      ecc: "affaan-m/ECC",
      superpowers: "obra/Superpowers",
      mattpocock: "mattpocock/skills",
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
      const removedDuplicateMcps = [
        "mcp:code-review-graph",
        "mcp:codebase-memory-mcp",
        "mcp:context7",
        "mcp:exa",
        "mcp:github",
        "mcp:sequential-thinking",
      ];
      const currentLocked = locked.components.filter(
        (component) => !removedDuplicateMcps.includes(component.id),
      );
      expect(locked.components.length - currentLocked.length).toBe(6);
      expect(definition.components.map((c) => c.id).sort()).toEqual(
        currentLocked.map((c) => c.id).sort(),
      );
      const byId = new Map(currentLocked.map((c) => [c.id, [...c.paths].sort()]));
      for (const component of definition.components)
        expect([...component.paths].sort()).toEqual(byId.get(component.id));
    }
  });

  it("covers the install-preview generator's atomic-write helper in runtime:ecc-installer", () => {
    // Core requires the generator's static require closure to lie inside this component;
    // ECC v2.2.1 scripts/lib/install/claude-settings.js requires ../atomic-write.js.
    const definition = emitBaselineDefinitionV1(root, "ecc", recorded("ecc-modules-v1.json")) as {
      components: { id: string; paths: string[] }[];
    };
    const installer = definition.components.find((c) => c.id === "runtime:ecc-installer");
    expect(installer?.paths).toContain("scripts/lib/atomic-write.js");
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

  it.each([
    "ecc",
    "superpowers",
    "mattpocock",
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

  it("names every input each producer writes", () => {
    expect(UPSTREAM_PRODUCED_FILES_V1).toEqual({
      ecc: [
        "ecc-content-metadata-v1.json",
        "ecc-hook-sources-v1.json",
        "ecc-mcp-inventory-v1.json",
        "ecc-modules-v1.json",
        "ecc-profile-sources-v1.json",
        "ecc-profiles-v1.json",
        "ecc-skill-inventory-v1.json",
      ],
      superpowers: ["superpowers-content-metadata-v1.json", "superpowers-hook-sources-v1.json"],
      mattpocock: ["mattpocock.snapshot.json"],
    });
  });

  it.each(
    Object.entries({
      ecc: [
        "ecc-mcp-inventory-v1.json",
        "ecc-content-metadata-v1.json",
        "ecc-skill-inventory-v1.json",
        "ecc-hook-sources-v1.json",
        "ecc-profile-sources-v1.json",
      ],
      superpowers: ["superpowers-hook-sources-v1.json", "superpowers-content-metadata-v1.json"],
      mattpocock: ["mattpocock.snapshot.json"],
    }).flatMap(([name, files]) => files.map((file) => [name, file] as const)),
  )("refuses %s when %s and its manifest entry are removed", (name, file) => {
    const copy = copiedRoot();
    const path = join(copy, "src", "production", "data", "upstream-inputs-v1.json");
    const value = JSON.parse(readFileSync(path, "utf8"));
    const commit = value.files[file].commit;
    delete value.files[file];
    writeFileSync(path, JSON.stringify(value));
    rmSync(join(copy, "src", "production", "data", file));
    expect(() => emitBaselineDefinitionV1(copy, name, commit)).toThrow(
      `upstream input ${file} is not recorded`,
    );
  });

  it("refuses a recorded input whose file is missing", () => {
    const copy = copiedRoot();
    rmSync(join(copy, "src", "production", "data", "ecc-skill-inventory-v1.json"));
    expect(() => emitBaselineDefinitionV1(copy, "ecc", recorded("ecc-modules-v1.json"))).toThrow(
      "upstream input ecc-skill-inventory-v1.json is recorded but its file is missing",
    );
  });

  it.each([
    ["ecc", "ecc-content-metadata-v1.json"],
    ["superpowers", "superpowers-hook-sources-v1.json"],
  ] as const)("refuses %s when %s no longer matches its recorded sha256", (name, file) => {
    const copy = copiedRoot();
    const path = join(copy, "src", "production", "data", file);
    writeFileSync(path, `${readFileSync(path, "utf8")} `);
    expect(() => emitBaselineDefinitionV1(copy, name, recorded(file))).toThrow(
      `upstream input ${file} does not match its recorded sha256`,
    );
  });

  it("refuses an expected input recorded from another repository", () => {
    const copy = copiedRoot();
    const path = join(copy, "src", "production", "data", "upstream-inputs-v1.json");
    const value = JSON.parse(readFileSync(path, "utf8"));
    const commit = value.files["superpowers-hook-sources-v1.json"].commit;
    value.files["superpowers-hook-sources-v1.json"].repository = "someone/Superpowers";
    writeFileSync(path, JSON.stringify(value));
    expect(() => emitBaselineDefinitionV1(copy, "superpowers", commit)).toThrow(
      "superpowers-hook-sources-v1.json was produced from someone/Superpowers, not obra/Superpowers",
    );
  });

  it("refuses an input recorded for a producer's repository that the producer does not write", () => {
    const copy = copiedRoot();
    const path = join(copy, "src", "production", "data", "upstream-inputs-v1.json");
    const value = JSON.parse(readFileSync(path, "utf8"));
    const commit = value.files["ecc-modules-v1.json"].commit;
    value.files["ecc-extra-v1.json"] = { ...value.files["ecc-modules-v1.json"] };
    writeFileSync(path, JSON.stringify(value));
    expect(() => emitBaselineDefinitionV1(copy, "ecc", commit)).toThrow(
      "ecc-extra-v1.json is recorded for affaan-m/ECC but produce:ecc does not write it",
    );
  });

  it.each([
    ["an unknown producer", "anthropics-skills", "a".repeat(40)],
    ["a short commit", "ecc", "5064474d"],
    ["an uppercase commit", "ecc", "A".repeat(40)],
  ])("rejects %s", (_label, name, commit) => {
    expect(() => emitBaselineDefinitionV1(root, name, commit)).toThrow(/baseline definition/);
  });
});
