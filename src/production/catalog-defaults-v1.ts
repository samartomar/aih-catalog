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
import { superpowersHookControlInventoryV1 } from "./catalog/superpowers-hooks-v1.js";
import {
  readUpstreamInputsManifestV1,
  readVerifiedUpstreamInputV1,
} from "./catalog/upstream-inputs-v1.js";
import {
  ECC_HOOK_CONTROL_PROVENANCE,
  ECC_HOOK_PROFILES,
  eccHookControlCatalog,
} from "./ecc-hook-controls-v1.js";
import {
  produceCatalogAuthoringBundleV1,
  readCollectionSnapshotV1,
} from "./workbench/authoring-bundle-v1.js";
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

function frameworkDescriptor(
  root: string,
  frameworkId: "ecc" | "superpowers",
): CatalogFrameworkDescriptorV1 {
  const repository = frameworkId === "ecc" ? "affaan-m/ECC" : "obra/Superpowers";
  const record = recordFor(root, repository);
  const sections: Record<string, unknown> = {
    contentMetadata: readJson(root, `${frameworkId}-content-metadata-v1.json`),
    componentDefinitions: object(record.compilerTemplate, `${frameworkId} compiler template`),
    packagedSource: object(record.source, `${frameworkId} packaged source`),
    vendorLock: vendorSource(root, frameworkId),
  };
  if (frameworkId === "ecc") {
    sections.vendorLockDocument = sealedDocument(root, "vendor-lock-v1.json");
    sections.mcpInventoryDocument = sealedDocument(root, "ecc-mcp-inventory-v1.json");
    sections.mcpInventory = readJson(root, "ecc-mcp-inventory-v1.json");
    sections.aihOwnedMcpExclusions = ["github", "sequential-thinking", "context7", "playwright"];
    sections.skillCatalog = readJson(root, "ecc-skill-inventory-v1.json");
    sections.hookControlInventory = {
      provenance: ECC_HOOK_CONTROL_PROVENANCE,
      profiles: ECC_HOOK_PROFILES,
      hooks: eccHookControlCatalog,
    };
    sections.moduleGraph = readJson(root, "ecc-modules-v1.json");
    sections.profileGraph = readJson(root, "ecc-profiles-v1.json");
    sections.installPreview = readJson(root, "ecc-install-preview-v1.json");
    if (record.runtimeDescriptor !== undefined)
      sections.runtimeDescriptor = record.runtimeDescriptor;
  } else {
    sections.hookControlInventory = superpowersHookControlInventoryV1(
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

export function buildCatalogFrameworkDefaultsV1(root: string): Readonly<Record<string, unknown>> {
  return {
    "defaults/catalog-scanner-providers-v1.json": {
      format: "aih-catalog-scanner-providers",
      version: 1,
      collections: {
        mattpocock: prepareMattPocockCollectionV1(
          readCollectionSnapshotV1(root, "mattpocock.snapshot.json"),
        ),
        ponytail: recordFor(root, "DietrichGebert/ponytail").compilerTemplate,
      },
    },
    "defaults/catalog-authoring-bundle-v1.json": produceCatalogAuthoringBundleV1(root),
    "defaults/catalog-core-qualification-v1.json": produceCatalogCoreQualificationV1(root),
    "defaults/catalog-scanner-evidence-v1.json": produceCatalogScannerEvidenceV1(root),
    "defaults/catalog-public-baseline-v1.json": produceCatalogPublicBaselineV1(root),
    "defaults/catalog-framework-ecc-v1.json": frameworkDescriptor(root, "ecc"),
    "defaults/catalog-framework-superpowers-v1.json": frameworkDescriptor(root, "superpowers"),
    "defaults/catalog-framework-plugins-v1.json": frameworkPlugins(root),
  };
}

export function generateCatalogFrameworkDefaultsV1(root: string, check = false): void {
  const generated = buildCatalogFrameworkDefaultsV1(root);
  for (const [relative, value] of Object.entries(generated)) {
    const target = resolve(root, relative);
    const bytes = serializeCatalogDefaultV1(value);
    if (check) {
      if (readFileSync(target, "utf8") !== bytes) throw new Error(`${relative} is stale`);
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
