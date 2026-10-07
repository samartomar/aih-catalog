import { readCoreProductDeclarationsV1 } from "../catalog/core-product-declarations-v1.js";
import { readPolicyAuthoringCatalogInputsV1 } from "../catalog/policy-authoring-catalog-v1.js";
import { canonicalStrictJsonBytesV1, canonicalStrictJsonSha256V1 } from "../strict-json-v1.js";
import {
  assembleCatalogAuthoringBundleV1,
  compileAuthoringProvidersV1,
  governedTargetsV1,
  readCollectionSnapshotV1,
} from "./authoring-bundle-v1.js";
import {
  compileAnthropicsSkillsProviderV1,
  compileMattPocockProviderV1,
} from "./catalog-providers-v1.js";
import {
  type AuthoringCatalogBundleV1,
  type CoreAuthoringCapabilityRegistryEntryV1,
  validateAuthoringCatalogBundleV1,
  verifyAuthoringCatalogBundleIntegrityV1,
} from "./contracts-v1.js";
import type { CatalogProviderCompilationV1 } from "./provider-compilation-v1.js";

/**
 * The single-source AuthoringCatalogBundleV1 that Core's definition route reads as
 * `--source-bundle` at a pin the installed Catalog does not carry (Core
 * src/baseline-evidence/scanner-definition.ts prepareDefinitionScannerCoverageV1 and
 * scanner-catalog-consumer.ts admittedSourceFromCandidateBundleV1): one sealed source, at the
 * definition's pin, with its compiled assets.
 *
 * It runs the full authoring bundle's own stages and keeps one source:
 * - a framework source (ecc, superpowers) is compiled with every provider from the policy
 *   authoring catalog, whose vetted-pin checks bind the framework's upstream inputs to the
 *   vendor lock. Before runbook step 8.1 copies the assembled lock into src/production/data,
 *   that lock is named explicitly (`vendorLock`); a lock at another pin is refused exactly as
 *   the build refuses it;
 * - a collection source (mattpocock) is compiled by its own provider from its
 *   fetched snapshot alone (catalog-providers-v1.ts), so no framework pin enters it. The
 *   built-in Core capabilities are left out: each names source:aih-core (built-in-v1.ts:113,
 *   169-171) and the assembly matches a capability by its source identity
 *   (compiler-formats-v1.ts:111-118), so none can apply to a collection's declarations.
 *
 * Both then run assemble → packaged overlay (assembleCatalogAuthoringBundleV1) and the
 * projection below. The emitted source must be the requested pin: a packaged source record at
 * another commit that the overlay applies makes the emission refuse, never relabel.
 *
 * The new-pin route (`newPin`) builds a source at a pin no packaged record carries yet: T3 is
 * about to produce that record from this bundle. It runs the same stages, with no packaged
 * source record and no collection evidence entering the overlay. That leaves the named source
 * exactly as the full overlay would: a record replaces only its own source, and the collection
 * evidence is projected only onto a replaced source (packaged-source-overlay-v1.ts
 * replaceSource), so neither can reach a source whose own record is left out. The records of
 * other sources are therefore not read at all, and a stale one (in a format the readers no
 * longer admit) cannot stand in. The vetted-pin checks stay: a framework source still binds its
 * upstream inputs to the vendor lock, a collection snapshot to its fetch pin, and the emitted
 * revision must be the requested pin.
 *
 * anthropics-skills has no snapshot and no provider in the Catalog; only the new-pin route
 * emits it, compiled from its named T3 compiler input (tools/emit-compiler-input.mjs).
 */
export const SINGLE_SOURCE_SUBJECTS_V1 = {
  ecc: "framework",
  superpowers: "framework",
  mattpocock: "collection",
  "anthropics-skills": "compiler-input",
} as const;
export type SingleSourceSubjectV1 = keyof typeof SINGLE_SOURCE_SUBJECTS_V1;

function fail(message: string): never {
  throw new TypeError(`single-source bundle: ${message}`);
}

function keep<T>(
  records: Readonly<Record<string, T>>,
  predicate: (value: T, key: string) => boolean,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(records).filter(([key, value]) => predicate(value, key)),
  );
}

/**
 * The one-source part of an assembled bundle, resealed. A group, template, relation or
 * evidence summary that mixes this source's assets with another source's is a cross-source
 * closure one source cannot carry: it refuses.
 */
export function projectAuthoringBundleSourceV1(
  root: string,
  bundle: AuthoringCatalogBundleV1,
  sourceId: string,
): AuthoringCatalogBundleV1 {
  const source = bundle.sources[sourceId];
  if (source === undefined) fail(`the assembled bundle carries no ${sourceId}`);
  const kept = new Set(
    Object.values(bundle.assets)
      .filter((asset) => asset.sourceId === sourceId)
      .map((asset) => asset.id),
  );
  const inside = (ids: readonly string[], label: string): boolean => {
    const count = ids.filter((id) => kept.has(id)).length;
    if (count > 0 && count < ids.length) fail(`${sourceId} has a cross-source ${label}`);
    return count > 0;
  };
  const assets = keep(bundle.assets, (asset) => kept.has(asset.id));
  const chunks = new Set(Object.values(assets).map((asset) => asset.detailChunkId));
  const projected = {
    version: bundle.version,
    sources: { [sourceId]: source },
    assets,
    groups: keep(bundle.groups, (group) => inside(group.assetIds, `group ${group.id}`)),
    relations: bundle.relations.filter((relation) =>
      inside(
        [relation.fromAssetId, relation.toAssetId],
        `relation ${relation.fromAssetId} -> ${relation.toAssetId}`,
      ),
    ),
    templates: keep(bundle.templates, (template) =>
      inside(
        [...template.roots.map((root) => root.assetId), ...template.exclusions],
        `template ${template.id}`,
      ),
    ),
    evidence: keep(bundle.evidence, (evidence) =>
      inside(
        evidence.subjects.map((subject) => subject.assetId),
        `evidence ${evidence.id}`,
      ),
    ),
    ...(bundle.qualifications === undefined
      ? {}
      : { qualifications: keep(bundle.qualifications, (item) => kept.has(item.assetId)) }),
    detailChunks: keep(bundle.detailChunks, (_chunk, id) => chunks.has(id)),
  };
  const sealed = validateAuthoringCatalogBundleV1(
    {
      ...projected,
      provenance: {
        bundleDigest: `sha256:${canonicalStrictJsonSha256V1({ ...projected, provenance: {} })}`,
      },
    },
    governedTargetsV1(readCoreProductDeclarationsV1(root)),
  );
  verifyAuthoringCatalogBundleIntegrityV1(sealed);
  return sealed;
}

export interface SingleSourceOptionsV1 {
  /** ecc and superpowers: the assembled vetted lock, before step 8.1 copies it into the data. */
  readonly vendorLock?: unknown;
  /** The new-pin route: no packaged source record and no collection evidence is overlaid. */
  readonly newPin?: boolean;
  /** anthropics-skills (new-pin route only): its named T3 compiler input. */
  readonly compilerInput?: unknown;
}

/** Emits `source:<id>` at `commit` from the Catalog's production inputs (see above). */
export function produceSingleSourceAuthoringBundleV1(
  root: string,
  id: SingleSourceSubjectV1,
  commit: string,
  options: SingleSourceOptionsV1 = {},
): AuthoringCatalogBundleV1 {
  if (!Object.hasOwn(SINGLE_SOURCE_SUBJECTS_V1, id)) fail(`no single-source subject ${id}`);
  if (!/^[0-9a-f]{40}$/.test(commit)) fail("the pin must be a 40-character lowercase commit");
  const kind = SINGLE_SOURCE_SUBJECTS_V1[id];
  const newPin = options.newPin === true;
  if (kind !== "framework" && options.vendorLock !== undefined)
    fail("a vendor lock applies only to ecc and superpowers");
  if (kind !== "compiler-input" && options.compilerInput !== undefined)
    fail("a compiler input applies only to anthropics-skills");
  if (kind === "compiler-input" && !newPin)
    fail(
      `${id} is emitted only by the new-pin route: the Catalog compiles it from its named compiler input alone`,
    );
  if (kind === "compiler-input" && options.compilerInput === undefined)
    fail(`${id} needs its named compiler input`);
  let providers: CatalogProviderCompilationV1[];
  let coreCapabilities: CoreAuthoringCapabilityRegistryEntryV1[] = [];
  if (kind === "framework") {
    const inputs =
      options.vendorLock === undefined
        ? readPolicyAuthoringCatalogInputsV1(root)
        : readPolicyAuthoringCatalogInputsV1(root, options.vendorLock);
    const { compiled } = compileAuthoringProvidersV1(root, inputs);
    providers = compiled.providers;
    coreCapabilities = compiled.coreCapabilities;
  } else if (kind === "compiler-input") {
    providers = [compileAnthropicsSkillsProviderV1(options.compilerInput)];
  } else {
    providers = [
      compileMattPocockProviderV1(readCollectionSnapshotV1(root, "mattpocock.snapshot.json")),
    ];
  }
  const assembled = (
    newPin
      ? assembleCatalogAuthoringBundleV1(root, providers, coreCapabilities, [], [])
      : assembleCatalogAuthoringBundleV1(root, providers, coreCapabilities)
  ).bundle;
  const sourceId = `source:${id}`;
  const bundle = projectAuthoringBundleSourceV1(root, assembled, sourceId);
  const revision = bundle.sources[sourceId]?.revision.id;
  if (revision !== commit)
    fail(
      `the Catalog emits ${sourceId}@${revision}, not ${commit}${newPin ? "" : "; a packaged source record stands in for the source, and the new-pin route builds it without one"}`,
    );
  return bundle;
}

/** The emitted file: canonical strict JSON and a final newline. */
export function serializeSingleSourceBundleV1(bundle: AuthoringCatalogBundleV1): string {
  return `${canonicalStrictJsonBytesV1(bundle).toString("utf8")}\n`;
}
