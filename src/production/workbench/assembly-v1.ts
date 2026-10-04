import { canonicalStrictJsonSha256V1 } from "../strict-json-v1.js";
import {
  assemblyRegistryForCompiledDeclarationsV1,
  type CatalogCompilerAssemblyInputV1,
  type CompiledDeclarationV1,
  compilerRegistrationForInputFormatV1,
  rejectTrustedCompilerEvidenceV1,
} from "./compiler-formats-v1.js";
import {
  type AuthoringAssetV1,
  type AuthoringCatalogBundleV1,
  assembleAuthoringAssetV1,
  authoringCatalogDigestV1,
  type CoreAuthoringCapabilityRegistryEntryV1,
  validateAuthoringCatalogBundleV1,
  verifyAuthoringCatalogBundleIntegrityV1,
} from "./contracts-v1.js";

/**
 * Assembles reviewed compiler outputs into one authoring catalog bundle.
 * Ported from Core 80120883 src/org-policy/workbench/assembly.ts, without the
 * fresh organization preparation path (a Core-only runtime concern).
 */
function mergeRecords<T>(label: string, records: readonly Record<string, T>[]): Record<string, T> {
  const merged: Record<string, T> = {};
  for (const item of records)
    for (const [id, value] of Object.entries(item)) {
      if (merged[id] !== undefined) throw new TypeError(`duplicate ${label} ${id}`);
      merged[id] = value;
    }
  return merged;
}

function requireUniqueDeclarations(declarations: readonly CompiledDeclarationV1[]): void {
  const ids = new Set<string>();
  for (const { declaration } of declarations) {
    if (ids.has(declaration.id)) throw new TypeError(`duplicate compiled asset ${declaration.id}`);
    ids.add(declaration.id);
  }
}

function requireUniqueRelations(relations: AuthoringCatalogBundleV1["relations"]): void {
  const endpoints = new Set<string>();
  for (const relation of relations) {
    const endpoint = `${relation.fromAssetId}\u0000${relation.toAssetId}`;
    if (endpoints.has(endpoint))
      throw new TypeError(
        `ambiguous catalog relation ${relation.fromAssetId} -> ${relation.toAssetId}`,
      );
    endpoints.add(endpoint);
  }
}

export function assembleCompilerOutputsV1(
  inputs: readonly CatalogCompilerAssemblyInputV1[],
  coreCapabilities: readonly CoreAuthoringCapabilityRegistryEntryV1[],
  governedTargets: readonly string[],
): AuthoringCatalogBundleV1 {
  rejectTrustedCompilerEvidenceV1(inputs);
  const declarations = inputs.flatMap((input) => input.declarations);
  requireUniqueDeclarations(declarations);
  const sources = mergeRecords(
    "source",
    inputs.map((input) => input.sources),
  );
  for (const { declaration, inputFormat } of declarations) {
    const source = sources[declaration.sourceId];
    if (source === undefined || source.revision.id !== declaration.sourceRevisionId)
      throw new TypeError(
        `compiled declaration has no matching immutable source ${declaration.id}`,
      );
    const registration = compilerRegistrationForInputFormatV1(inputFormat);
    if (
      source.inputFormat !== inputFormat ||
      source.compiler.id !== registration.id ||
      source.compiler.version !== registration.version
    )
      throw new TypeError(
        `compiled declaration has an unregistered source compiler ${declaration.id}`,
      );
  }
  const registry = assemblyRegistryForCompiledDeclarationsV1(declarations, coreCapabilities);
  const assets: Record<string, AuthoringAssetV1> = Object.fromEntries(
    declarations.map(({ declaration }) => {
      const asset = assembleAuthoringAssetV1(declaration, registry);
      return [asset.id, asset];
    }),
  );
  const detailBytes = mergeRecords(
    "detail chunk",
    inputs.map((input) => input.detailBytes),
  );
  const relations = inputs.flatMap((input) => input.relations ?? []);
  requireUniqueRelations(relations);
  const bareBundle = {
    version: "authoring-catalog-bundle/v1" as const,
    sources,
    assets,
    groups: mergeRecords(
      "group",
      inputs.map((input) => input.groups ?? {}),
    ),
    relations,
    templates: mergeRecords(
      "template",
      inputs.map((input) => input.templates ?? {}),
    ),
    evidence: mergeRecords(
      "evidence",
      inputs.map((input) => input.evidence ?? {}),
    ),
    detailChunks: Object.fromEntries(
      Object.entries(detailBytes).map(([id, bytes]) => [
        id,
        { bytes, digest: authoringCatalogDigestV1(bytes) },
      ]),
    ),
  };
  const bundle = validateAuthoringCatalogBundleV1(
    structuredClone({
      ...bareBundle,
      provenance: {
        bundleDigest: `sha256:${canonicalStrictJsonSha256V1({ ...bareBundle, provenance: {} })}`,
      },
    }),
    governedTargets,
  );
  verifyAuthoringCatalogBundleIntegrityV1(bundle);
  return bundle;
}
