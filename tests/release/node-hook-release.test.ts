import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readInstalledRelease } from "../../src/release/node.js";
import { configureItem } from "../../src/release/reader.js";
import { sha256 } from "./fixtures.js";
import { installedRoot, rewriteRecipe } from "./installed-fixture.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function root() {
  const fixture = installedRoot("hook");
  cleanups.push(fixture.cleanup);
  return fixture.root;
}
const ITEM_ID = "aihq.hook.claude.protect-env";
const reasons = (result: { diagnostics: readonly { reason: string }[] }) =>
  result.diagnostics.map((d) => d.reason);

describe("explicit release export", () => {
  it("reads the 1.1 release only when the caller names it", async () => {
    const base = root();
    const result = await readInstalledRelease({ root: base, release: "./release-1.1.json" });
    expect(reasons(result)).toEqual([]);
    expect(result.release?.schema).toBe("urn:aihq:catalog:release:1.1.0");
    expect(result.release?.sha256).toBe(
      sha256(readFileSync(join(base, "release", "release-1.1.json"))),
    );
    expect(result.provenance).toMatchObject({ manifestPath: "release/release-1.1.json" });
    const configured = configureItem({
      release: result.release as never,
      itemId: ITEM_ID,
      configuration: {},
      materialSource: result.source as never,
    });
    expect(configured.diagnostics).toEqual([]);
    expect(configured.selection?.recipe.reference.materials.map((m) => m.id)).toEqual(["script"]);
  });

  it("never substitutes 1.1 for the default 1.0 release", async () => {
    const result = await readInstalledRelease({ root: root() });
    expect(result.release?.schema).toBe("urn:aihq:catalog:release:1.0.0");
    expect(result.release?.items.some((item) => item.id === ITEM_ID)).toBe(false);
  });

  it("refuses an export name outside the supported release exports", async () => {
    const result = await readInstalledRelease({ root: root(), release: "./package.json" as never });
    expect(result.valid).toBe(false);
    expect(reasons(result)).toEqual(["invalid-request"]);
  });

  it("checks a recipe 1.1 against Core's published 1.1 structure and the item's advertised parts", async () => {
    const base = root();
    rewriteRecipe(
      base,
      ITEM_ID,
      (recipe) => {
        const hook = (recipe.operations as Record<string, unknown>[])[1] as Record<string, unknown>;
        hook.action = "remove";
      },
      "release-1.1.json",
    );
    const bad = await readInstalledRelease({ root: base, release: "./release-1.1.json" });
    expect(bad.valid).toBe(false);
    expect(reasons(bad)).toEqual(["recipe-invalid"]);

    const other = root();
    rewriteRecipe(
      other,
      ITEM_ID,
      (recipe) => {
        recipe.targets = ["user"];
      },
      "release-1.1.json",
    );
    const scope = await readInstalledRelease({ root: other, release: "./release-1.1.json" });
    expect(reasons(scope)).toEqual(["recipe-scope-mismatch"]);
  });
});
