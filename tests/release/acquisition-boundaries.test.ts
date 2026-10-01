import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readInstalledRelease } from "../../src/release/node.js";
import { canonical, sha256 } from "./fixtures.js";
import { installedRoot, rewriteRecipe } from "./installed-fixture.js";

describe("recipe admission for every advertised item", () => {
  it("checks a later item's inputs even when its recipe bytes share an earlier item's path", async () => {
    const fixture = installedRoot("shared-recipe-agreement");
    try {
      const path = join(fixture.root, "release/release.json");
      const release = JSON.parse(readFileSync(path, "utf8"));
      const second = structuredClone(release.items[0]);
      second.id = "zz.second";
      second.inputs.agentDirectory = { type: "boolean", required: true, default: false };
      release.items.push(second);
      writeFileSync(path, `${canonical(release)}\n`);
      const checked = await readInstalledRelease({ root: fixture.root });
      expect(checked.valid).toBe(false);
      expect(checked.diagnostics).toContainEqual(
        expect.objectContaining({
          reason: "recipe-inputs-mismatch",
          itemId: "zz.second",
          blocking: true,
        }),
      );
    } finally {
      fixture.cleanup();
    }
  });

  it.each([
    [
      "missing operations",
      (recipe: Record<string, unknown>) => {
        delete recipe.operations;
      },
    ],
    [
      "unknown fields",
      (recipe: Record<string, unknown>) => {
        recipe.executableCode = "ignored";
      },
    ],
  ])("refuses a re-pinned recipe with %s", async (_name, change) => {
    const fixture = installedRoot("recipe-structure");
    try {
      rewriteRecipe(
        fixture.root,
        "mattpocock.grilling",
        change as (recipe: Record<string, unknown>) => void,
      );
      const checked = await readInstalledRelease({ root: fixture.root });
      expect(checked.valid).toBe(false);
      expect(checked.diagnostics).toContainEqual(
        expect.objectContaining({ reason: "recipe-invalid" }),
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("refuses duplicate recipe keys even when the last value matches the advertised mirror", async () => {
    const fixture = installedRoot("recipe-duplicate-key");
    try {
      const manifestPath = join(fixture.root, "release/release.json");
      const release = JSON.parse(readFileSync(manifestPath, "utf8"));
      const item = release.items.find(
        (candidate: { id: string }) => candidate.id === "mattpocock.grilling",
      );
      const recipePath = join(fixture.root, item.recipe.path);
      const bytes = Buffer.from(readFileSync(recipePath, "utf8").replace("{", '{"id":"ignored",'));
      writeFileSync(recipePath, bytes);
      item.recipe.sha256 = sha256(bytes);
      item.recipe.byteLength = bytes.length;
      writeFileSync(manifestPath, `${canonical(release)}\n`);
      const checked = await readInstalledRelease({ root: fixture.root });
      expect(checked.valid).toBe(false);
      expect(checked.diagnostics).toContainEqual(
        expect.objectContaining({ reason: "recipe-unreadable" }),
      );
    } finally {
      fixture.cleanup();
    }
  });
});
