import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALOG_FRAMEWORK_DESCRIPTOR_FORMAT_V1,
  CATALOG_FRAMEWORK_DESCRIPTOR_VERSION_V1,
  CATALOG_FRAMEWORK_PLUGINS_FORMAT_V1,
  CATALOG_FRAMEWORK_PLUGINS_VERSION_V1,
  type CatalogFrameworkDescriptorV1,
  type CatalogFrameworkPluginsV1,
} from "../content/catalog-framework-v1.js";
import {
  assertCandidateBaseSourcesV1,
  type CandidateFrameworkInputV1,
  type CatalogCandidateV1,
  candidateFrameworkSourceSectionsV1,
  candidatePackagedSourceDataV1,
} from "./candidate-inputs-v1.js";
import {
  ECC_PROFILE_SOURCES_FILE_V1,
  eccProfileEvidenceV1,
} from "./catalog/ecc-profile-evidence-v1.js";
import { reviewedSuperpowersHookControlInventoryV1 } from "./catalog/superpowers-hooks-v1.js";
import {
  readUpstreamInputsManifestV1,
  readVerifiedUpstreamInputV1,
} from "./catalog/upstream-inputs-v1.js";
import { type CatalogProductionRuntimeV1, catalogProductionRuntimeV1 } from "./collation-v1.js";
import { ECC_HOOK_SOURCES_FILE_V1, eccHookControlInventoryV1 } from "./ecc-hook-controls-v1.js";
import { canonicalJsonV1 } from "./strict-json-v1.js";
import {
  produceCatalogAuthoringBundleV1,
  readCollectionSnapshotV1,
} from "./workbench/authoring-bundle-v1.js";
import { compileAnthropicsSkillsProviderV1 } from "./workbench/catalog-providers-v1.js";
import { prepareMattPocockCollectionV1 } from "./workbench/mattpocock-provider-v1.js";
import {
  produceCatalogCoreQualificationV1,
  produceCatalogPublicBaselineV1,
  produceCatalogScannerEvidenceV1,
} from "./workbench-producers-v1.js";

type JsonRecord = Record<string, unknown>;

function readJson(root: string, name: string): unknown {
  return JSON.parse(readFileSync(resolve(root, "src", "production", "data", name), "utf8"));
}

function sealedDocument(root: string, name: string): { bytesBase64: string; sha256: string } {
  const bytes = readFileSync(resolve(root, "src", "production", "data", name));
  return {
    bytesBase64: bytes.toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function object(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function sealedRecords(root: string): JsonRecord[] {
  const wrappers = readJson(root, "packaged-source-data-v1.json");
  if (!Array.isArray(wrappers)) throw new TypeError("packaged source data must be an array");
  return wrappers.map((wrapper, index) => {
    const record = object(wrapper, `packaged source data wrapper ${index}`);
    if (typeof record.bytes !== "string" || typeof record.sha256 !== "string") {
      throw new TypeError(`packaged source data wrapper ${index} is malformed`);
    }
    return object(JSON.parse(record.bytes), `packaged source data record ${index}`);
  });
}

function recordFor(root: string, repository: string): JsonRecord {
  const record = sealedRecords(root).find((candidate) => {
    const source = candidate.source;
    return object(source, "packaged source").repository === repository;
  });
  if (record === undefined) throw new TypeError(`missing packaged source ${repository}`);
  return record;
}

function vendorSource(root: string, id: "ecc" | "superpowers"): JsonRecord {
  const lock = object(readJson(root, "vendor-lock-v1.json"), "vendor lock");
  if (!Array.isArray(lock.sources)) throw new TypeError("vendor lock sources must be an array");
  const source = lock.sources.find((candidate) => object(candidate, "vendor source").id === id);
  if (source === undefined) throw new TypeError(`missing vendor source ${id}`);
  return object(source, `vendor source ${id}`);
}

/**
 * A framework descriptor. A candidate build names the frameworks whose
 * packaged source record it must not read: their component definitions come
 * from the named T3 compiler input (or are omitted), with no packaged source.
 */
function frameworkDescriptor(
  root: string,
  frameworkId: "ecc" | "superpowers",
  candidate?: CandidateFrameworkInputV1,
): CatalogFrameworkDescriptorV1 {
  const repository = frameworkId === "ecc" ? "affaan-m/ECC" : "obra/Superpowers";
  const record = candidate === undefined ? recordFor(root, repository) : undefined;
  const sections: Record<string, unknown> = {
    contentMetadata: readJson(root, `${frameworkId}-content-metadata-v1.json`),
    ...(record === undefined
      ? candidateFrameworkSourceSectionsV1(frameworkId, candidate as CandidateFrameworkInputV1)
      : {
          componentDefinitions: object(record.compilerTemplate, `${frameworkId} compiler template`),
          packagedSource: object(record.source, `${frameworkId} packaged source`),
        }),
    vendorLock: vendorSource(root, frameworkId),
  };
  if (frameworkId === "ecc") {
    sections.vendorLockDocument = sealedDocument(root, "vendor-lock-v1.json");
    sections.mcpInventoryDocument = sealedDocument(root, "ecc-mcp-inventory-v1.json");
    sections.mcpInventory = readJson(root, "ecc-mcp-inventory-v1.json");
    sections.aihOwnedMcpExclusions = ["github", "sequential-thinking", "context7", "playwright"];
    sections.skillCatalog = readJson(root, "ecc-skill-inventory-v1.json");
    sections.hookControlInventory = eccHookControlInventoryV1(
      readVerifiedUpstreamInputV1(
        root,
        readUpstreamInputsManifestV1(root),
        ECC_HOOK_SOURCES_FILE_V1,
      ).json,
      sections.vendorLock,
    );
    sections.moduleGraph = readJson(root, "ecc-modules-v1.json");
    sections.profileGraph = readJson(root, "ecc-profiles-v1.json");
    sections.installPreview = readJson(root, "ecc-install-preview-v1.json");
    sections.profileEvidence = eccProfileEvidenceV1(
      readVerifiedUpstreamInputV1(
        root,
        readUpstreamInputsManifestV1(root),
        ECC_PROFILE_SOURCES_FILE_V1,
      ).json,
      sections.vendorLock,
    );
    if (record?.runtimeDescriptor !== undefined)
      sections.runtimeDescriptor = record.runtimeDescriptor;
  } else {
    sections.hookControlInventory = reviewedSuperpowersHookControlInventoryV1(
      readVerifiedUpstreamInputV1(
        root,
        readUpstreamInputsManifestV1(root),
        "superpowers-hook-sources-v1.json",
      ).json,
      sections.vendorLock,
    );
  }
  return {
    format: CATALOG_FRAMEWORK_DESCRIPTOR_FORMAT_V1,
    version: CATALOG_FRAMEWORK_DESCRIPTOR_VERSION_V1,
    frameworkId,
    sections,
  };
}

function frameworkPlugins(root: string): CatalogFrameworkPluginsV1 {
  const ecc = vendorSource(root, "ecc");
  const superpowers = vendorSource(root, "superpowers");
  const commit = (source: JsonRecord, id: string): string => {
    if (typeof source.pinnedSha !== "string" || !/^[0-9a-f]{40}$/.test(source.pinnedSha)) {
      throw new TypeError(`invalid ${id} vendor pin`);
    }
    return source.pinnedSha;
  };
  return {
    format: CATALOG_FRAMEWORK_PLUGINS_FORMAT_V1,
    version: CATALOG_FRAMEWORK_PLUGINS_VERSION_V1,
    entries: [
      {
        frameworkId: "ecc",
        packageName: "@aihq/framework-ecc",
        version: "0.1.0",
        contractVersion: 1,
        upstream: { repository: "affaan-m/ECC", commit: commit(ecc, "ecc") },
        supportedCore: ">=0.7.0 <0.8.0",
        supportedHosts: ["claude", "codex", "cursor", "kiro", "kimi", "opencode"],
        status: "candidate",
      },
      {
        frameworkId: "superpowers",
        packageName: "@aihq/framework-superpowers",
        version: "0.1.0",
        contractVersion: 1,
        upstream: { repository: "obra/Superpowers", commit: commit(superpowers, "superpowers") },
        supportedCore: ">=0.7.0 <0.8.0",
        supportedHosts: [
          "antigravity",
          "claude",
          "codex",
          "copilot",
          "cursor",
          "gemini",
          "kiro",
          "kimi",
          "opencode",
          "windsurf",
          "zed",
        ],
        status: "candidate",
      },
    ],
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

export function serializeCatalogDefaultV1(value: unknown): string {
  return `${canonical(value)}\n`;
}

/**
 * The providers a candidate adds for its named collections. ponytail's registered provider
 * already compiles the fetched snapshot, so its named input must be exactly that snapshot;
 * anthropics-skills has no registered provider and compiles from its named input.
 */
function candidateCollectionProvidersV1(root: string, candidate: CatalogCandidateV1) {
  const ponytail = candidate.collections?.ponytail;
  if (
    ponytail !== undefined &&
    canonicalJsonV1(ponytail.compilerInput) !==
      canonicalJsonV1(readCollectionSnapshotV1(root, "ponytail.snapshot.json"))
  )
    throw new TypeError(
      "the named ponytail compiler input is not the Catalog's fetched ponytail snapshot, the only input its provider compiles",
    );
  const anthropics = candidate.collections?.["anthropics-skills"];
  return anthropics === undefined
    ? []
    : [compileAnthropicsSkillsProviderV1(anthropics.compilerInput)];
}

export function buildCatalogFrameworkDefaultsV1(
  root: string,
  candidate?: CatalogCandidateV1,
): Readonly<Record<string, unknown>> {
  const vendorLock = readJson(root, "vendor-lock-v1.json");
  const sourceRecords =
    candidate === undefined
      ? readJson(root, "packaged-source-data-v1.json")
      : candidatePackagedSourceDataV1(
          readJson(root, "packaged-source-data-v1.json"),
          vendorLock,
          candidate,
        );
  const authoringBundle = produceCatalogAuthoringBundleV1(
    root,
    sourceRecords,
    candidate === undefined ? [] : candidateCollectionProvidersV1(root, candidate),
  );
  if (candidate !== undefined) assertCandidateBaseSourcesV1(authoringBundle, vendorLock, candidate);
  return {
    "defaults/catalog-scanner-providers-v1.json": {
      format: "aih-catalog-scanner-providers",
      version: 1,
      collections: {
        mattpocock: prepareMattPocockCollectionV1(
          readCollectionSnapshotV1(root, "mattpocock.snapshot.json"),
        ),
        // A named ponytail's record is never read: the candidate leaves its template out.
        ...(candidate?.collections?.ponytail === undefined
          ? { ponytail: recordFor(root, "DietrichGebert/ponytail").compilerTemplate }
          : {}),
      },
    },
    "defaults/catalog-authoring-bundle-v1.json": authoringBundle,
    "defaults/catalog-core-qualification-v1.json": produceCatalogCoreQualificationV1(root),
    "defaults/catalog-scanner-evidence-v1.json": produceCatalogScannerEvidenceV1(
      root,
      sourceRecords,
    ),
    "defaults/catalog-public-baseline-v1.json": produceCatalogPublicBaselineV1(root),
    "defaults/catalog-framework-ecc-v1.json": frameworkDescriptor(
      root,
      "ecc",
      candidate?.frameworks.ecc,
    ),
    "defaults/catalog-framework-superpowers-v1.json": frameworkDescriptor(
      root,
      "superpowers",
      candidate?.frameworks.superpowers,
    ),
    "defaults/catalog-framework-plugins-v1.json": frameworkPlugins(root),
  };
}

/** Why a regenerated default can differ: its text order follows the ICU collation runtime. */
export function staleCatalogDefaultMessageV1(
  relative: string,
  runtime: CatalogProductionRuntimeV1,
): string {
  return `${relative} is stale (regenerated under Node ${runtime.node}, ICU ${runtime.icu}, Unicode ${runtime.unicode}, CLDR ${runtime.cldr}; text order follows ICU English collation, and src/production/data/upstream-inputs-v1.json records the runtime of each input)`;
}

export function generateCatalogFrameworkDefaultsV1(root: string, check = false): void {
  const generated = buildCatalogFrameworkDefaultsV1(root);
  for (const [relative, value] of Object.entries(generated)) {
    const target = resolve(root, relative);
    const bytes = serializeCatalogDefaultV1(value);
    if (check) {
      if (readFileSync(target, "utf8") !== bytes)
        throw new Error(staleCatalogDefaultMessageV1(relative, catalogProductionRuntimeV1()));
    } else {
      writeFileSync(target, bytes, "utf8");
    }
  }
}

const entry = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (entry === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, "..", "..");
  generateCatalogFrameworkDefaultsV1(root, process.argv.includes("--check"));
}
