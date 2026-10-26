import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import type { CatalogItem } from "../../src/release/contracts.js";
import { checkRecipeAgreement } from "../../src/release/recipe-agreement.js";

const root = resolve(import.meta.dirname, "../..");
const content = JSON.parse(readFileSync(resolve(root, "release/release-ecc.content.json"), "utf8"));
const github = content.items.find(
  (item: CatalogItem) => item.id === "ecc.mcp.github",
) as CatalogItem;
const recipeBytes = (path: string) => new Uint8Array(readFileSync(resolve(root, path)));
const reasons = (item: CatalogItem, clientId: "claude-code" | "codex") => {
  const entry = item.recipes?.[clientId];
  if (entry === undefined) throw new Error(`no ${clientId} entry`);
  return checkRecipeAgreement(item, recipeBytes(entry.path), entry).map((d) => d.reason);
};

it("admits each transition map entry that serves at least one of the item's scopes", () => {
  expect(github.scopes).toEqual(["project", "user"]);
  expect(reasons(github, "claude-code")).toEqual([]);
  expect(reasons(github, "codex")).toEqual([]);
});

it("refuses a map entry that serves none of the item's scopes", () => {
  const projectOnly = { ...github, scopes: ["project"] } as CatalogItem;
  expect(reasons(projectOnly, "claude-code")).toEqual([]);
  expect(reasons(projectOnly, "codex")).toEqual(["recipe-scope-mismatch"]);
});

it("still requires a single recipe to admit every item scope", () => {
  const { recipes, ...rest } = github;
  const entry = recipes?.["claude-code"];
  if (entry === undefined) throw new Error("no claude-code entry");
  const { materials: _materials, inputs: _inputs, ...descriptor } = entry;
  const single = { ...rest, recipe: descriptor } as CatalogItem;
  expect(
    checkRecipeAgreement(single, recipeBytes(descriptor.path), descriptor).map((d) => d.reason),
  ).toEqual(["recipe-scope-mismatch"]);
});
