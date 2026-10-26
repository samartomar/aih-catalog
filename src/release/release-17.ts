/**
 * Release 1.7 admission rules beyond the release 1.6 item checks: closed kinds,
 * the presentation role, the transition recipe map, supersession, retirement,
 * declarations that stay outside both identities, cross-release references with
 * both identities, and embedded sets. Portable: no Node built-ins.
 */

import {
  type CatalogItem,
  DOCUMENT_PURPOSES,
  ITEM_KINDS,
  type RecipeDescriptor,
  type RecipeMapEntry,
} from "./contracts.js";
import {
  CLIENT_ID,
  type DiagnosticCollector,
  fields,
  isId,
  isRecord,
  SHA256,
  safeMemberPath,
} from "./document.js";

const MAX_LIST = 4096;
const MAX_TEXT = 4096;
/** Kinds delivered only natively; a fallback can never stand in for them. */
const NATIVE_ONLY = new Set(["agent", "command"]);

/** Release 1.7 item fields: everything a 1.6 item may carry is required, plus `role`. */
export const ITEM17_REQUIRED = [
  "id",
  "label",
  "kind",
  "role",
  "name",
  "nameBasis",
  "source",
  "sourceIds",
  "targets",
  "scopes",
  "inputs",
  "materials",
  "dependencies",
  "payload",
  "requirements",
  "executable",
  "contentSha256",
  "behaviourSha256",
] as const;
export const ITEM17_OPTIONAL = [
  "recipe",
  "recipes",
  "description",
  "descriptionBasis",
  "metadata",
  "selectedBy",
  "derivedFrom",
  "size",
  "supersedes",
  "fallback",
  "variantOf",
  "hints",
] as const;

const text = (value: unknown, max = MAX_TEXT): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const sha = (value: unknown): value is string => typeof value === "string" && SHA256.test(value);

/** Strictly ascending, unique strings (code-unit order). */
function ascendingUnique(values: readonly unknown[]): boolean {
  return values.every(
    (value, index) =>
      typeof value === "string" && (index === 0 || (values[index - 1] as string) < value),
  );
}

/** Every recipe one item references: the single recipe, or each transition map entry. */
export function itemRecipes(
  item: Record<string, unknown>,
): { readonly clientId?: string; readonly recipe: Record<string, unknown> }[] {
  if (isRecord(item.recipes)) {
    return Object.entries(item.recipes)
      .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
      .map(([clientId, recipe]) => ({ clientId, recipe }));
  }
  return isRecord(item.recipe) ? [{ recipe: item.recipe }] : [];
}

/** The typed recipes of one checked item, in map key order for a transition map. */
export function catalogItemRecipes(
  item: CatalogItem,
): { readonly clientId?: string; readonly recipe: RecipeDescriptor | RecipeMapEntry }[] {
  if (item.recipes !== undefined)
    return Object.entries(item.recipes).map(([clientId, recipe]) => ({ clientId, recipe }));
  return item.recipe === undefined ? [] : [{ recipe: item.recipe }];
}

/** Content material ids of an item (the behaviour file excluded). */
export function contentMaterialIds(item: Record<string, unknown>): Set<string> {
  return new Set(
    (Array.isArray(item.materials) ? item.materials : [])
      .filter((member) => isRecord(member) && member.role !== "behaviour")
      .map((member) => String((member as Record<string, unknown>).id)),
  );
}

/**
 * The material and input agreement of one transition map entry with its item.
 * Shared by release admission and `configureItem`. Returns the problem reason, if any.
 */
export function recipeEntryProblem(
  item: { readonly materials: readonly unknown[]; readonly inputs: unknown },
  entry: unknown,
): string | undefined {
  if (!isRecord(entry) || !Array.isArray(entry.materials) || !Array.isArray(entry.inputs))
    return "recipe-entry-invalid";
  const content = contentMaterialIds(item as unknown as Record<string, unknown>);
  if (!ascendingUnique(entry.materials) || entry.materials.some((id) => !content.has(id as string)))
    return "recipe-materials-mismatch";
  const inputs = isRecord(item.inputs) ? item.inputs : {};
  if (
    !ascendingUnique(entry.inputs) ||
    entry.inputs.some((name) => !Object.hasOwn(inputs, name as string))
  )
    return "recipe-inputs-mismatch";
  // Every required input without a default must reach the recipe that configures it.
  for (const [name, spec] of Object.entries(inputs)) {
    if (
      isRecord(spec) &&
      spec.required === true &&
      spec.default === undefined &&
      !entry.inputs.includes(name)
    )
      return "recipe-inputs-mismatch";
  }
  return undefined;
}

function checkRecipeMap(d: DiagnosticCollector, item: Record<string, unknown>, path: string): void {
  const hasRecipe = Object.hasOwn(item, "recipe");
  const hasMap = Object.hasOwn(item, "recipes");
  if (hasRecipe === hasMap) {
    d.add(
      "recipe-or-map",
      `${path}/recipe`,
      "A release 1.7 item carries exactly one of recipe or recipes.",
    );
    return;
  }
  if (!hasMap) return;
  const map = item.recipes;
  if (!isRecord(map) || Object.keys(map).length === 0 || Object.keys(map).length > 64) {
    d.add("invalid-recipes", `${path}/recipes`, "Expected 1 to 64 recipes keyed by client id.");
    return;
  }
  for (const [clientId, entry] of Object.entries(map)) {
    const at = `${path}/recipes/${clientId}`;
    if (!CLIENT_ID.test(clientId)) {
      d.add("invalid-client-id", at, "Recipe map keys are lowercase client identifiers.");
    }
    // The entry's field set and descriptor fields are checked with the single recipe's rules.
    if (!isRecord(entry) || !Array.isArray(entry.materials) || !Array.isArray(entry.inputs))
      continue;
    const problem = recipeEntryProblem(item as { materials: unknown[]; inputs: unknown }, entry);
    if (problem !== undefined) {
      d.add(
        problem,
        at,
        "A map entry names ascending content material ids and input names of this item, including every required input without a default.",
      );
    }
  }
}

function checkSupersedes(
  d: DiagnosticCollector,
  item: Record<string, unknown>,
  path: string,
): void {
  const value = item.supersedes;
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LIST) {
    d.add("invalid-supersedes", `${path}/supersedes`, "Expected 1 to 4096 superseded items.");
    return;
  }
  const content = (Array.isArray(item.materials) ? item.materials : []).filter(
    (member) => isRecord(member) && member.role !== "behaviour",
  ) as Record<string, unknown>[];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const at = `${path}/supersedes/${index}`;
    const common = ["match", "releaseSha256", "itemId", "itemSha256"];
    const identities = ["contentSha256", "behaviourSha256"];
    if (!isRecord(entry)) {
      d.add("invalid-supersedes", at, "Expected a supersession record.");
      return;
    }
    if (entry.match === "hash") {
      if (!fields(d, entry, at, [...common, "contentSha256"], ["behaviourSha256"])) return;
    } else if (entry.match === "name+sourcePath") {
      if (!fields(d, entry, at, [...common, "name", "sourcePath"], identities)) return;
    } else if (entry.match === "split") {
      if (!fields(d, entry, at, common, identities)) return;
    } else {
      d.add("invalid-match", `${at}/match`, "Expected hash, name+sourcePath or split.");
      return;
    }
    if (!sha(entry.releaseSha256))
      d.add("invalid-sha256", `${at}/releaseSha256`, "Expected a bare lowercase SHA-256.");
    if (!isId(entry.itemId)) d.add("invalid-id", `${at}/itemId`, "Expected an identifier.");
    for (const key of ["itemSha256", ...identities]) {
      if (entry[key] !== undefined && !sha(entry[key]))
        d.add("invalid-sha256", `${at}/${key}`, "Expected a bare lowercase SHA-256.");
    }
    if ((entry.contentSha256 === undefined) !== (entry.behaviourSha256 === undefined)) {
      if (entry.match !== "hash")
        d.add(
          "identity-pair",
          at,
          "An earlier item's release 1.6 identities are recorded together.",
        );
    }
    const key = `${String(entry.releaseSha256)}\u0000${String(entry.itemId)}`;
    if (seen.has(key)) d.add("duplicate-supersedes", at, "An earlier item is superseded once.");
    seen.add(key);
    if (entry.match === "hash" && entry.contentSha256 !== item.contentSha256) {
      d.add(
        "supersedes-hash-mismatch",
        `${at}/contentSha256`,
        "A hash supersession names the survivor's own content identity.",
      );
    }
    if (entry.match === "name+sourcePath") {
      if (!text(entry.name, 256) || entry.name !== item.name) {
        d.add(
          "supersedes-name-mismatch",
          `${at}/name`,
          "A name+sourcePath supersession names the survivor's own name.",
        );
      }
      if (
        !safeMemberPath(entry.sourcePath) ||
        !content.some((member) => member.sourcePath === entry.sourcePath)
      ) {
        d.add(
          "supersedes-source-path-mismatch",
          `${at}/sourcePath`,
          "A name+sourcePath supersession names one of the survivor's content source paths.",
        );
      }
    }
  });
}

function checkDeclarations(
  d: DiagnosticCollector,
  item: Record<string, unknown>,
  path: string,
): void {
  for (const key of ["fallback", "variantOf"] as const) {
    const value = item[key];
    if (value === undefined) continue;
    if (fields(d, value, `${path}/${key}`, ["itemId"]) && !isId(value.itemId)) {
      d.add("invalid-id", `${path}/${key}/itemId`, "Expected an identifier.");
    }
  }
  if (item.fallback !== undefined && NATIVE_ONLY.has(String(item.kind))) {
    d.add(
      "fallback-native-only",
      `${path}/fallback`,
      "Agents and commands are delivered only natively; a fallback never stands in for them.",
    );
  }
  if (item.hints !== undefined && fields(d, item.hints, `${path}/hints`, ["tools"])) {
    const tools = item.hints.tools;
    if (
      !Array.isArray(tools) ||
      tools.length > 64 ||
      !ascendingUnique(tools) ||
      tools.some((tool) => !CLIENT_ID.test(tool as string))
    ) {
      d.add(
        "invalid-hints",
        `${path}/hints/tools`,
        "Expected ascending unique client ids; a tool is a display hint only.",
      );
    }
  }
}

function checkCrossReleaseIdentities(
  d: DiagnosticCollector,
  item: Record<string, unknown>,
  path: string,
): void {
  const dependencies = isRecord(item.dependencies) ? item.dependencies : {};
  for (const list of ["requires", "optional", "conflicts"] as const) {
    const refs = dependencies[list];
    if (!Array.isArray(refs)) continue;
    refs.forEach((ref, index) => {
      if (!isRecord(ref) || !Object.hasOwn(ref, "release")) return;
      const at = `${path}/dependencies/${list}/${index}`;
      for (const key of ["contentSha256", "behaviourSha256"]) {
        if (!sha(ref[key])) {
          d.add(
            "cross-release-identity-required",
            `${at}/${key}`,
            "A release 1.7 cross-release reference carries both identities.",
          );
        }
      }
    });
  }
}

/** Release 1.7 rules for one item, after its field set and 1.6 checks. */
export function checkItem17(d: DiagnosticCollector, item: Record<string, unknown>, path: string) {
  if (!(ITEM_KINDS as readonly string[]).includes(item.kind as string)) {
    d.add("unsupported-kind", `${path}/kind`, "The release 1.7 kind list is closed.", {
      encountered: typeof item.kind === "string" ? item.kind.slice(0, 64) : undefined,
      supported: ITEM_KINDS,
    });
  }
  if (item.role !== "choosable" && item.role !== "supporting") {
    d.add("invalid-role", `${path}/role`, "Expected role choosable or supporting.");
  }
  if (item.kind === "document" && isRecord(item.payload)) {
    if (!(DOCUMENT_PURPOSES as readonly string[]).includes(item.payload.purpose as string)) {
      d.add(
        "invalid-purpose",
        `${path}/payload/purpose`,
        "A document carries purpose notice, license, reference or guide.",
      );
    }
  }
  checkRecipeMap(d, item, path);
  checkSupersedes(d, item, path);
  checkDeclarations(d, item, path);
  checkCrossReleaseIdentities(d, item, path);
}

/** Release 1.7 retirement records: durable reasons and qualified replacements. */
export function checkRetired17(d: DiagnosticCollector, value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > MAX_LIST) {
    d.add("invalid-retired", "/retired", "Expected at most 4096 retirement records.");
    return;
  }
  const ids: string[] = [];
  value.forEach((entry, index) => {
    const at = `/retired/${index}`;
    if (!fields(d, entry, at, ["id", "reason", "replacedBy"])) return;
    if (isId(entry.id)) ids.push(entry.id);
    else d.add("invalid-id", `${at}/id`, "Expected an identifier.");
    if (!text(entry.reason)) {
      d.add(
        "invalid-text",
        `${at}/reason`,
        "Expected a retirement reason of 1 to 4096 characters.",
      );
    }
    if (!Array.isArray(entry.replacedBy) || entry.replacedBy.length > MAX_LIST) {
      d.add("invalid-replaced-by", `${at}/replacedBy`, "Expected qualified item references.");
      return;
    }
    entry.replacedBy.forEach((ref, refIndex) => {
      const atRef = `${at}/replacedBy/${refIndex}`;
      if (
        fields(d, ref, atRef, ["framework", "itemId"]) &&
        (!isId(ref.framework) || !isId(ref.itemId))
      )
        d.add("invalid-replaced-by", atRef, "Expected { framework, itemId } identifiers.");
    });
  });
  if (!ascendingUnique(ids))
    d.add("unordered-ids", "/retired", "Retirement records are sorted by unique id.");
}

/**
 * Release-level 1.7 rules once every item is individually valid: retired ids are
 * not live, same-release declarations resolve, and each split names several survivors.
 */
export function checkRelease17Items(
  d: DiagnosticCollector,
  items: readonly Record<string, unknown>[],
  retired: unknown,
): void {
  const ids = new Map(items.map((item, index) => [String(item.id), index]));
  if (Array.isArray(retired)) {
    retired.forEach((entry, index) => {
      if (isRecord(entry) && ids.has(String(entry.id)))
        d.add("retired-item-present", `/retired/${index}/id`, "A retired id is not a live item.");
    });
  }
  const splits = new Map<string, number[]>();
  const whole = new Set<string>();
  items.forEach((item, index) => {
    for (const key of ["fallback", "variantOf"] as const) {
      const ref = item[key];
      if (!isRecord(ref)) continue;
      const target = ids.get(String(ref.itemId));
      if (target === undefined || target === index) {
        d.add(
          "declaration-unresolved",
          `/items/${index}/${key}/itemId`,
          "A declaration names another item of this release.",
        );
      }
    }
    for (const entry of Array.isArray(item.supersedes) ? item.supersedes : []) {
      if (!isRecord(entry)) continue;
      const key = `${String(entry.releaseSha256)}\u0000${String(entry.itemId)}`;
      if (entry.match === "split") splits.set(key, [...(splits.get(key) ?? []), index]);
      else whole.add(key);
    }
  });
  for (const [key, survivors] of splits) {
    if (survivors.length < 2 || whole.has(key)) {
      d.add(
        "split-survivors",
        `/items/${survivors[0]}/supersedes`,
        "A split spreads one earlier item over at least two survivors and no other match.",
        { encountered: key.split("\u0000")[1] },
      );
    }
  }
}
