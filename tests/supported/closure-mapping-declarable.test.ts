import { describe, expect, it } from "vitest";

type Component = { id: string; content: string; paths: string[] };
type Selection = {
  components: { catalogAssetId: string; scannerComponentId: string }[];
  exclusions: { reason: string; scannerComponentId: string }[];
};

const mapping = async () =>
  // @ts-expect-error The maintenance helper is intentionally plain ESM JavaScript.
  (await import("../../tools/derive-closure-mapping.mjs")) as {
    selectMappingComponentsV1: (
      sourceId: string,
      components: Component[],
      closure: string[],
      rowIds: Set<string>,
    ) => Selection;
  };

describe("D110 ECC closure mapping", () => {
  it("excludes grouping components and curated duplicate MCPs while mapping declarable skills", async () => {
    const { selectMappingComponentsV1 } = await mapping();
    const components: Component[] = [
      { id: "module:database", content: "skill", paths: ["skills/database-migrations"] },
      { id: "capability:database", content: "skill", paths: ["skills/database-migrations"] },
      { id: "module:machine-learning", content: "skill", paths: ["skills/mle-workflow"] },
      { id: "capability:machine-learning", content: "skill", paths: ["skills/mle-workflow"] },
      { id: "mcp:github", content: "mcp", paths: [".mcp.json"] },
      { id: "skill:database-migrations", content: "skill", paths: ["skills/database-migrations"] },
    ];
    const result = selectMappingComponentsV1(
      "ecc",
      components,
      ["skills/database-migrations/SKILL.md", "skills/mle-workflow/SKILL.md", ".mcp.json"],
      new Set(["skill.ecc.database-migrations"]),
    );
    expect(result.components).toEqual([
      {
        catalogAssetId: "ecc/skill:database-migrations",
        scannerComponentId: "skill:database-migrations",
      },
    ]);
    expect(result.exclusions).toEqual(
      components.slice(0, 5).map((component) => ({
        reason: "not a committed declarable ECC Catalog row",
        scannerComponentId: component.id,
      })),
    );
    expect(new Set(result.components.map((component) => component.catalogAssetId)).size).toBe(
      result.components.length,
    );
  });

  it("refuses a declarable component whose content class conflicts with its id kind", async () => {
    const { selectMappingComponentsV1 } = await mapping();
    const components: Component[] = [
      { id: "skill:shared", content: "skill", paths: ["shared"] },
      { id: "mcp:shared", content: "skill", paths: ["shared"] },
    ];
    expect(() =>
      selectMappingComponentsV1(
        "ecc",
        components,
        ["shared/file"],
        new Set(["skill.ecc.shared", "mcp.ecc.shared"]),
      ),
    ).toThrow("closure-mapping:component-kind-content-mismatch mcp:shared");
    expect(() =>
      selectMappingComponentsV1("ecc", components, ["shared/file"], new Set(["skill.ecc.shared"])),
    ).toThrow("closure-mapping:component-kind-content-mismatch mcp:shared");
    expect(() =>
      selectMappingComponentsV1(
        "ecc",
        [{ id: "skill:shared", content: "mcp", paths: ["shared"] }],
        ["shared/file"],
        new Set(["skill.ecc.shared"]),
      ),
    ).toThrow("closure-mapping:component-kind-content-mismatch skill:shared");
  });
});
