/**
 * Compares a loaded recipe with the item that advertises it: Core recipe format,
 * recipe ID, the exact InputSpec mirror, prerequisite targets, admitted scopes
 * and the named material closure `{id,sha256,byteLength}`. Core repeats full
 * recipe validation; this check keeps Catalog from advertising a recipe that
 * says something different. Portable.
 */
import { type CatalogDiagnostic, type CatalogItem, CORE_RECIPE_SCHEMA_ID } from "./contracts.js";
import { isRecord } from "./document.js";
import { canonicalJson } from "./json.js";

const RECIPE_MAX_BYTES = 1_000_000;
const fatalUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function checkRecipeAgreement(item: CatalogItem, bytes: Uint8Array): CatalogDiagnostic[] {
  const diagnostics: CatalogDiagnostic[] = [];
  const report = (reason: string, message: string) =>
    diagnostics.push(
      Object.freeze({
        code: "INPUT_INVALID",
        reason,
        message,
        blocking: true,
        path: item.recipe.path,
        itemId: item.id,
      }),
    );
  let recipe: unknown;
  try {
    if (bytes.byteLength > RECIPE_MAX_BYTES) throw new Error("size");
    recipe = JSON.parse(fatalUtf8.decode(bytes));
  } catch {
    report("recipe-unreadable", "The recipe is not bounded UTF-8 JSON.");
    return diagnostics;
  }
  if (!isRecord(recipe)) {
    report("recipe-unreadable", "The recipe is not a JSON object.");
    return diagnostics;
  }
  if (recipe.schema !== CORE_RECIPE_SCHEMA_ID) {
    report("recipe-schema-mismatch", "The recipe is not the advertised Core recipe format.");
    return diagnostics;
  }
  if (recipe.id !== item.recipe.id)
    report("recipe-id-mismatch", "The recipe ID differs from the item.");
  const same = (left: unknown, right: unknown) => {
    try {
      return canonicalJson(left) === canonicalJson(right);
    } catch {
      return false;
    }
  };
  if (!same(recipe.inputs, item.inputs)) {
    report("recipe-inputs-mismatch", "The recipe's input definitions differ from the item's.");
  }
  if (!same(recipe.prerequisites, item.targets)) {
    report("recipe-targets-mismatch", "The recipe's prerequisites differ from the item's targets.");
  }
  const targets = Array.isArray(recipe.targets) ? recipe.targets : [];
  if (!item.scopes.every((scope) => targets.includes(scope))) {
    report("recipe-scope-mismatch", "The item advertises a scope its recipe does not admit.");
  }
  const declared = Array.isArray(recipe.materials) ? [...recipe.materials] : undefined;
  const expected = item.materials.map(({ id, sha256, byteLength }) => ({ id, sha256, byteLength }));
  const byId = (a: unknown, b: unknown) => {
    const left = isRecord(a) ? String(a.id) : "";
    const right = isRecord(b) ? String(b.id) : "";
    return left < right ? -1 : left > right ? 1 : 0;
  };
  if (declared === undefined || !same(declared.sort(byId), expected)) {
    report("recipe-materials-mismatch", "The recipe's material closure differs from the item's.");
  }
  return diagnostics;
}
