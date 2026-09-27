import { readFileSync } from "node:fs";
import { readCoreProductDeclarationsV1 } from "../catalog/core-product-declarations-v1.js";
import {
  type PolicyAuthoringCatalogInputsV1,
  policyAuthoringCatalogV1,
  readPolicyAuthoringCatalogInputsV1,
} from "../catalog/policy-authoring-catalog-v1.js";
import {
  productionDataPathV1,
  readUpstreamInputsManifestV1,
  readVerifiedUpstreamInputV1,
} from "../catalog/upstream-inputs-v1.js";
import { canonicalDigestV1, sha256HexV1 } from "../strict-json-v1.js";
import { assembleCompilerOutputsV1 } from "./assembly-v1.js";
import { compileCatalogProvidersV1 } from "./catalog-providers-v1.js";
import { compilerFormatRegistrationsV1 } from "./compiler-formats-v1.js";
import type {
  AuthoringCatalogBundleV1,
  CoreAuthoringCapabilityRegistryEntryV1,
} from "./contracts-v1.js";
import { parsePackagedScannerCollectionEvidenceV1 } from "./packaged-evidence-v1.js";
import {
  applyPackagedSourceBundlesV1,
  parsePackagedSourceRecordsV1,
} from "./packaged-source-overlay-v1.js";
import type { CatalogProviderCompilationV1 } from "./provider-compilation-v1.js";

export const PACKAGED_SOURCE_DATA_FILE_V1 = "packaged-source-data-v1.json";
export const PACKAGED_COLLECTION_EVIDENCE_FILE_V1 = "packaged-collection-evidence-v1.json";

function readData(root: string, file: string): unknown {
  return JSON.parse(readFileSync(productionDataPathV1(root, file), "utf8"));
}

/**
 * Reads a fetched collection snapshot, verified against the upstream inputs
 * manifest, and refuses one whose own pin is not the commit it was fetched at.
 */
export function readCollectionSnapshotV1(root: string, file: "mattpocock.snapshot.json"): unknown {
  const { provenance, json } = readVerifiedUpstreamInputV1(
    root,
    readUpstreamInputsManifestV1(root),
    file,
  );
  const snapshot = json as { upstream?: { pin?: unknown }; source?: { commit?: unknown } };
  const pin = snapshot.upstream?.pin;
  if (pin !== provenance.commit)
    throw new TypeError(`${file} pins ${String(pin)} but was fetched at ${provenance.commit}`);
  return json;
}

/** The hosts the Core product declarations mark as governed policy targets. */
export function governedTargetsV1(core: PolicyAuthoringCatalogInputsV1["core"]): string[] {
  return core.hosts.filter((host) => host.policyTarget === true).map((host) => String(host.id));
}

/**
 * Assemble → packaged overlay: the stages after provider compilation, shared by the full
 * authoring bundle and the single-source bundle (single-source-bundle-v1.ts). The overlay
 * replaces each packaged source and projects the sealed Scanner collection evidence onto the
 * replaced sources only (packaged-source-overlay-v1.ts replaceSource): a source no record
 * replaces is exactly its compiled assembly.
 */
export function assembleCatalogAuthoringBundleV1(
  root: string,
  providers: readonly CatalogProviderCompilationV1[],
  coreCapabilities: readonly CoreAuthoringCapabilityRegistryEntryV1[],
  sourceRecords: unknown = readData(root, PACKAGED_SOURCE_DATA_FILE_V1),
  collectionEvidence: unknown = readData(root, PACKAGED_COLLECTION_EVIDENCE_FILE_V1),
): {
  bundle: AuthoringCatalogBundleV1;
  seals: ReturnType<typeof parsePackagedSourceRecordsV1>["seals"];
} {
  const governedTargets = governedTargetsV1(readCoreProductDeclarationsV1(root));
  const base = assembleCompilerOutputsV1(
    providers.flatMap((provider) => provider.inputs),
    coreCapabilities,
    governedTargets,
  );
  const packaged = parsePackagedSourceRecordsV1(sourceRecords, governedTargets);
  const evidence = parsePackagedScannerCollectionEvidenceV1(collectionEvidence);
  return {
    bundle: applyPackagedSourceBundlesV1(base, packaged.records, evidence, governedTargets),
    seals: packaged.seals,
  };
}

/** Every registered provider, compiled from the policy authoring catalog and its true inputs. */
export function compileAuthoringProvidersV1(root: string, inputs: PolicyAuthoringCatalogInputsV1) {
  const catalog = policyAuthoringCatalogV1(inputs);
  const compiled = compileCatalogProvidersV1({
    catalog,
    vendorSources: inputs.vendorLock.sources,
    mattpocockSnapshot: readCollectionSnapshotV1(root, "mattpocock.snapshot.json"),
  });
  return { catalog, compiled };
}

/**
 * Generates `defaults/catalog-authoring-bundle-v1.json` from the true inputs:
 * the policy authoring catalog inputs, the Matt Pocock snapshot,
 * the sealed packaged source records and the sealed Scanner collection
 * evidence. This is Core 80120883's compile → packaged overlay → admission
 * pipeline, with bindings left empty: Core derives bindings from what it admits.
 * A candidate build passes the packaged source records it may overlay, and the
 * provider of a named collection no registered provider compiles (anthropics-skills).
 */
export function produceCatalogAuthoringBundleV1(
  root: string,
  sourceRecords: unknown = readData(root, PACKAGED_SOURCE_DATA_FILE_V1),
  candidateProviders: readonly CatalogProviderCompilationV1[] = [],
): Record<string, unknown> {
  const inputs = readPolicyAuthoringCatalogInputsV1(root);
  const { catalog, compiled } = compileAuthoringProvidersV1(root, inputs);
  const providers = [...compiled.providers, ...candidateProviders];
  const { bundle, seals } = assembleCatalogAuthoringBundleV1(
    root,
    providers,
    compiled.coreCapabilities,
    sourceRecords,
  );
  const prepared = { catalog, bundle, bindings: {}, sourceInputs: {} };
  const admission = {
    coreVersion: inputs.core.source.version,
    catalogDigest: canonicalDigestV1(catalog),
    vendorLockDigest: `sha256:${sha256HexV1(readFileSync(productionDataPathV1(root, "vendor-lock-v1.json")))}`,
    providerRegistrations: providers.map(({ providerId, providerVersion }) => ({
      providerId,
      providerVersion,
    })),
    compilerRegistrationsDigest: canonicalDigestV1(compilerFormatRegistrationsV1),
    coreCapabilitiesDigest: canonicalDigestV1(compiled.coreCapabilities),
    sourceRecordSeals: seals,
    providerAdmissions: providers.map((provider) => ({
      providerId: provider.providerId,
      providerVersion: provider.providerVersion,
      inputDigest: provider.inputDigest,
      compilerInputsDigest: canonicalDigestV1(provider.inputs),
    })),
  };
  return {
    format: "aih-catalog-authoring-bundle",
    version: 1,
    prepared,
    production: {
      admission,
      output: {
        bundleDigest: bundle.provenance.bundleDigest,
        preparedDigest: canonicalDigestV1(prepared),
        bindingsDigest: canonicalDigestV1(prepared.bindings),
        sourceInputsDigest: canonicalDigestV1(prepared.sourceInputs),
      },
    },
    sourceRecords,
  };
}
