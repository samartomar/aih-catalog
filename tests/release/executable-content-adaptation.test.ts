import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const source = resolve(root, "producer/executable-content/source");
const adapterFiles = [
  "adaptations/mcp-builder-mcp2/catalog_mcp2_evaluation.py",
  "adaptations/mcp-builder-mcp2/catalog_mcp2_connections.py",
  "adaptations/mcp-builder-mcp2/provenance.json",
];

it("compiles the explicit MCP2 adaptation into all three client deliveries", () => {
  // Source-only compiler seam: no package installation or Python execution.
  const recipes = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
      import {generateExecutableContentRelease} from './tools/generate-executable-content-release.mjs';
      const output = generateExecutableContentRelease();
      const release = JSON.parse(output.get('release/release-executable-content.json'));
      console.log(JSON.stringify(release.items.map(item => ({
        id: item.id, recipe: JSON.parse(output.get(item.recipe.path)),
        materials: item.materials
      }))));
    `,
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    ),
  ) as {
    id: string;
    recipe: { operations: { material: string; target: { segments: { literal: string }[] } }[] };
    materials: { id: string; path: string; sha256: string }[];
  }[];
  expect(recipes.map((item) => item.id).sort()).toEqual([
    "catalog.copilot.skill.executable-content-requirements",
    "catalog.kiro.skill.executable-content-requirements",
    "catalog.skill.executable-content-requirements",
  ]);
  for (const item of recipes) {
    for (const relative of adapterFiles) {
      const material = item.materials.find((member) => member.path.endsWith(`/${relative}`));
      expect(material, `${item.id}: ${relative}`).toBeDefined();
      const operation = item.recipe.operations.find((entry) => entry.material === material?.id);
      expect(operation?.target.segments.map((segment) => segment.literal).join("/")).toMatch(
        new RegExp(`/executable-content-requirements/${relative.replaceAll(".", "\\.")}$`),
      );
      expect(material?.sha256).toBe(
        createHash("sha256")
          .update(readFileSync(resolve(source, relative)))
          .digest("hex"),
      );
    }
  }
});
