/**
 * Compares a loaded recipe with the item that advertises it: Core recipe format,
 * recipe ID, the exact InputSpec mirror, prerequisite targets, admitted scopes
 * and the named material closure `{id,sha256,byteLength}`. Core repeats full
 * recipe validation; this check keeps Catalog from advertising a recipe that
 * says something different. Node host only: uses Core's owned structural schema.
 */
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { type Node as JsonNode, type ParseError, parseTree } from "jsonc-parser";
import {
  type CatalogDiagnostic,
  type CatalogItem,
  CORE_RECIPE_SCHEMA_ID,
  CORE_RECIPE_SCHEMA_ID_1_1,
} from "./contracts.js";
import { isRecord } from "./document.js";
import { assertStrictValues, canonicalJson, textDepth } from "./json.js";

const RECIPE_MAX_BYTES = 1_000_000;
const fatalUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const ajv = new Ajv2020({ strict: true, allErrors: false });
const compileRecipe = (version: string) =>
  ajv.compile(
    JSON.parse(
      readFileSync(new URL(`../../schemas/core-recipe/${version}.json`, import.meta.url), "utf8"),
    ),
  );
/** Core's owned structural schema for each recipe format Catalog admits. */
const validators = {
  [CORE_RECIPE_SCHEMA_ID]: compileRecipe("1.0.0"),
  [CORE_RECIPE_SCHEMA_ID_1_1]: compileRecipe("1.1.0"),
};

/** Compare decimal values independently of spelling, as in Core's strict JSON profile. */
function decimalIdentity(token: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) throw new TypeError("recipe number grammar");
  const digits = `${match[2]}${match[3] ?? ""}`.replace(/^0+/, "");
  if (!digits) return `${match[1]}0`;
  let end = digits.length;
  while (digits.charCodeAt(end - 1) === 0x30) end -= 1;
  const trailingZeros = digits.length - end;
  const power = Number(match[4] ?? 0) - (match[3]?.length ?? 0) + trailingZeros;
  if (!Number.isSafeInteger(power)) throw new TypeError("recipe number exponent");
  return `${match[1]}${digits.slice(0, end)}e${power}`;
}

/** Core permits ordinary JSON spacing; strict admission preserves keys and number values. */
function readRecipe(bytes: Uint8Array): unknown {
  if (bytes.byteLength > RECIPE_MAX_BYTES) throw new TypeError("recipe byte limit");
  const text = fatalUtf8.decode(bytes);
  if (textDepth(text) > 32) throw new TypeError("recipe depth limit");
  // Validate syntax before the recovering parser sees it, within the same depth bound.
  const value: unknown = JSON.parse(text);
  assertStrictValues(value);
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  if (!tree || errors.length) throw new TypeError("recipe JSON grammar");
  const pending: JsonNode[] = [tree];
  while (pending.length) {
    const node = pending.pop() as JsonNode;
    if (node.type === "object") {
      const names = new Set<string>();
      for (const property of node.children ?? []) {
        const key = property.children?.[0]?.value as string;
        if (names.has(key)) throw new TypeError("duplicate recipe key");
        names.add(key);
        const child = property.children?.[1];
        if (child) pending.push(child);
      }
    } else if (node.type === "array") {
      for (const child of node.children ?? []) pending.push(child);
    } else if (node.type === "number") {
      const token = text.slice(node.offset, node.offset + node.length);
      if (decimalIdentity(token) !== decimalIdentity(JSON.stringify(node.value))) {
        throw new TypeError("recipe number loses its authored value");
      }
    }
  }
  return value;
}

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
    recipe = readRecipe(bytes);
  } catch {
    report("recipe-unreadable", "The recipe is not bounded UTF-8 JSON.");
    return diagnostics;
  }
  if (!isRecord(recipe)) {
    report("recipe-unreadable", "The recipe is not a JSON object.");
    return diagnostics;
  }
  const validateRecipe = validators[item.recipe.schema];
  if (recipe.schema !== item.recipe.schema || validateRecipe === undefined) {
    report("recipe-schema-mismatch", "The recipe is not the advertised Core recipe format.");
    return diagnostics;
  }
  if (!validateRecipe(recipe)) {
    report("recipe-invalid", "The recipe does not satisfy Core's structural recipe contract.");
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
