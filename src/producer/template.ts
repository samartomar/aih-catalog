import type { CatalogItem, Json } from "../release/contracts.js";
import { isRecord } from "../release/document.js";
import { canonicalJson } from "../release/json.js";
import { checkRecipeAgreement } from "../release/recipe-agreement.js";
import type { Record_ } from "./base.js";
import type { DeclaredSource, DeclaredTemplateItem } from "./declaration.js";
import type { PreparedSourceTree } from "./derived.js";
import { refuse } from "./errors.js";
import { documentBytes, type GeneratedItem, materialPath, sha256Hex } from "./generate.js";
import { readUpstreamObject } from "./json.js";
import { readPresent } from "./tree.js";

/** Bind a supplied recipe to its complete pinned material closure; never execute it. */
export function generateTemplateItem(args: {
  item: DeclaredTemplateItem;
  source: DeclaredSource;
  sourceId: string;
  tree: PreparedSourceTree;
}): GeneratedItem {
  const { item, source, sourceId, tree } = args;
  const templateBytes = readPresent(tree, item.recipePath);
  let recipe: Record_;
  try {
    recipe = readUpstreamObject(templateBytes) as Record_;
  } catch (error) {
    return refuse(
      "template-invalid",
      `${item.id}: cannot read recipe ${item.recipePath}: ${String(error)}`,
    );
  }
  if (recipe.id !== item.id || !Array.isArray(recipe.materials) || recipe.materials.length !== 0) {
    return refuse("template-invalid", `${item.id}: recipe id must match and materials must be []`);
  }
  if (!item.materials.some((member) => member.path === source.licensePath)) {
    return refuse(
      "template-license-missing",
      `${item.id}: materials must include ${source.licensePath}`,
    );
  }
  const members = item.materials.map(({ id, path }) => {
    const bytes = readPresent(tree, path);
    const memberPath =
      tree.derivedMetadata === undefined
        ? materialPath(source.repository, tree.commit, path)
        : `release/materials/authored/${source.repository}/${tree.derivedMetadata.outputSha256}/${path}`;
    return { id, path: memberPath, sha256: sha256Hex(bytes), byteLength: bytes.length, bytes };
  });
  const byId = new Map(members.map((member) => [member.id, member]));
  const referenced = new Set<string>();
  if (!Array.isArray(recipe.operations) || !Array.isArray(recipe.checks)) {
    return refuse("template-invalid", `${item.id}: operations and checks must be arrays`);
  }
  for (const operation of recipe.operations) {
    if (isRecord(operation) && typeof operation.material === "string")
      referenced.add(operation.material);
  }
  for (const step of [...recipe.operations, ...recipe.checks]) {
    if (
      isRecord(step) &&
      isRecord(step.executable) &&
      typeof step.executable.material === "string"
    ) {
      referenced.add(step.executable.material);
    }
  }
  if (referenced.size !== byId.size || [...referenced].some((id) => !byId.has(id))) {
    return refuse(
      "template-material-closure",
      `${item.id}: declared materials must exactly match operation material references`,
    );
  }
  for (const check of recipe.checks) {
    if (!isRecord(check) || !isRecord(check.sha256)) continue;
    const binding = check.sha256;
    if (
      check.kind !== "file.sha256" ||
      Object.keys(binding).join() !== "materialSha256" ||
      typeof binding.materialSha256 !== "string" ||
      !byId.has(binding.materialSha256)
    ) {
      return refuse("template-material-binding", `${item.id}: invalid materialSha256 binding`);
    }
    check.sha256 = byId.get(binding.materialSha256)?.sha256 as string;
  }
  recipe.materials = members.map(({ id, sha256, byteLength }) => ({ id, sha256, byteLength }));
  const recipePath = `release/recipes/${item.id}.json`;
  let recipeBytes: Buffer;
  try {
    recipeBytes = documentBytes(recipe);
  } catch {
    return refuse("template-invalid", `${item.id}: recipe contains values outside strict JSON`);
  }
  const record: Record_ = {
    id: item.id,
    label: item.label,
    description: recipe.description as Json,
    kind: item.kind,
    sourceIds: [sourceId],
    targets: recipe.prerequisites as Json,
    scopes: recipe.targets as Json,
    inputs: recipe.inputs as Json,
    recipe: {
      id: item.id,
      schema: recipe.schema as Json,
      path: recipePath,
      sha256: sha256Hex(recipeBytes),
      byteLength: recipeBytes.length,
    },
    materials: members.map(({ id, path, sha256, byteLength }) => ({
      id,
      path,
      sha256,
      byteLength,
    })),
    dependencies: {
      requires: item.requires.map((itemId) => ({ itemId })),
      optional: [],
      conflicts: [],
    },
    metadata: {
      upstream: {
        path: item.recipePath,
        templateSha256: sha256Hex(templateBytes),
        license: source.license,
        ...(tree.derivedMetadata === undefined
          ? {}
          : {
              source: source.id,
              repository: `https://github.com/${source.repository}`,
              revision: tree.commit,
              derivation: tree.derivedMetadata,
            }),
        materialPaths: item.materials.map(({ id, path }) => ({ id, path })),
      },
    },
  };
  const diagnostics = checkRecipeAgreement(record as unknown as CatalogItem, recipeBytes);
  if (diagnostics.length > 0) {
    return refuse(
      "template-recipe-invalid",
      `${item.id}: ${diagnostics.map((entry) => `${entry.reason} ${entry.path ?? ""}`).join(", ")}`,
    );
  }
  return { record, recipePath, recipeBytes, members };
}

/** Compare behavior without pin-addressed locations; source moves are provenance only. */
export function templateBehavior(record: Record_, recipeBytes: Uint8Array): string {
  const { sourceIds: _sourceIds, metadata: _metadata, materials, recipe, ...rest } = record;
  const descriptor = recipe as Record_;
  return canonicalJson({
    ...rest,
    recipe: {
      id: descriptor.id,
      schema: descriptor.schema,
      body: JSON.parse(Buffer.from(recipeBytes).toString("utf8")) as Json,
    },
    materials: (materials as Record_[]).map(({ path: _path, ...member }) => member),
  });
}
