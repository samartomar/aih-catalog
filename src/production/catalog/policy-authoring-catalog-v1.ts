import { readFileSync } from "node:fs";
import {
  assertEccHookControlsReviewedV1,
  ECC_DISABLE_ELIGIBLE_HOOK_IDS,
  ECC_HOOK_CONTROL_SOURCE_CONTENT_SHA256,
  ECC_HOOK_PROFILES,
  ECC_HOOK_SOURCES_FILE_V1,
  type EccHookControlCatalogEntry,
  eccHookControlCatalog,
} from "../ecc-hook-controls-v1.js";
import type { JsonRecord } from "../validate-v1.js";
import { eccBaselineCatalogV1, superpowersBaselineCatalogV1 } from "./baseline-catalogs-v1.js";
import { type BaselineEvidenceLockV1, parseBaselineEvidenceLockV1 } from "./baseline-lock-v1.js";
import { contentMetadataLookupV1, parseContentMetadataV1 } from "./content-metadata-v1.js";
import {
  type CoreProductDeclarationsV1,
  readCoreProductDeclarationsV1,
} from "./core-product-declarations-v1.js";
import { eccComponentModelV1 } from "./ecc-components-v1.js";
import {
  AIH_OWNED_ECC_MCP_EXCLUSIONS,
  type EccMcpCatalogEntry,
  type EccMcpCatalogProvenanceV1,
  eccExternalMcpCatalogV1,
  validateEccMcpCatalogInventoryV1,
} from "./ecc-mcp-inventory-v1.js";
import {
  type EccSkillCatalogEntryV1,
  type EccSkillCatalogProvenanceV1,
  eccSkillInventoryV1,
} from "./ecc-skill-inventory-v1.js";
import { parseEccModulesSnapshotV1, parseEccProfilesSnapshotV1 } from "./ecc-snapshots-v1.js";
import {
  eccEnterpriseCompositionV1,
  type PolicyAuthoringCompositionV1,
  type PolicyAuthoringFrameworkV1,
  prepareEccCatalogSourceV1,
  prepareSuperpowersCatalogSourceV1,
} from "./framework-catalogs-v1.js";
import {
  productionDataPathV1,
  readUpstreamInputsManifestV1,
  readVerifiedUpstreamInputV1,
  type UpstreamInputsManifestV1,
} from "./upstream-inputs-v1.js";

/**
 * First-party AIH capability packs the Catalog publishes. Ported from Core
 * 80120883 src/org-policy/catalog-providers/aih.ts.
 */
const FIRST_PARTY_CAPABILITY_PACKS = [
  {
    kind: "skill",
    id: "package:skill-pack/docs-quality",
    pack: "docs-quality",
    purpose:
      "Helps an agent write and review documentation against source evidence, checking claims and keeping the explanation clear.",
    description:
      "First-party claim-first, evidence-grounded documentation skill (BetterDoc) — edits, reviews, and creates source-grounded docs with a bounded anti-slop lint that never overrides source truth.",
    skills: ["aih-betterdoc"],
    sources: [
      {
        skill: "aih-betterdoc",
        path: "packs/docs-quality/aih-betterdoc",
        manifestIdentity: "local",
      },
    ],
  },
  {
    kind: "agent",
    id: "package:skill-pack/governance-quality",
    pack: "governance-quality",
    purpose:
      "Reviews an AIH setup for governance and adoption problems, then explains what needs attention. The review workflow is read-only.",
    description:
      "First-party read-only Governance Doctor agent workflow for isolated destination lifecycle review, backed by declarative Audit and Guide source material.",
    skills: ["aih-gov-doctor"],
    sources: [
      {
        skill: "aih-gov-doctor",
        path: "packs/governance-quality/aih-gov-doctor",
        manifestIdentity: "local",
      },
    ],
  },
  {
    kind: "agent",
    id: "package:skill-pack/review-quality",
    pack: "review-quality",
    purpose:
      "Reviews agents, skills, MCP tools, and workflows for bugs, security issues, and missing evidence.",
    description:
      "First-party isolated BUGBOUNTY agent workflow for high-coverage generated-agent, skill, MCP, workflow, and evidence review.",
    skills: ["aih-bugbounty"],
    sources: [
      {
        skill: "aih-bugbounty",
        path: "packs/review-quality/aih-bugbounty",
        manifestIdentity: "local",
      },
    ],
  },
] as const;

/** The Catalog repository that serves AIH capability content. */
export const AIH_CAPABILITY_CATALOG_V1 = {
  provider: "github",
  repository: "samartomar/aih-catalog",
} as const;

/** Components a third-party source ships to register its own hooks. */
const THIRD_PARTY_HOOK_COMPONENT_IDS = ["baseline:hooks", "module:hooks-runtime"] as const;

/** Gating controls ECC declares for its own hooks; AIH never enforces them. */
const DECLARED_THIRD_PARTY_HOOK_CONTROLS = [
  {
    name: "ECC_HOOK_PROFILE",
    owner: "ecc",
    enforcedByAih: false,
    detail:
      "AIH projects the selected profile through supported Claude settings environment intent. ECC executes and enforces it; AIH never rewrites ECC hook commands.",
  },
  {
    name: "ECC_DISABLED_HOOKS",
    owner: "ecc",
    enforcedByAih: false,
    detail:
      "AIH projects the disabled list through supported Claude settings environment intent. ECC evaluates it after process spawn, so a disabled hook still spawns one process and disabling does not erase spawn cost.",
  },
] as const;

export interface AihCatalogContentPackV1 {
  id: string;
  pack: string;
  description: string;
  purpose?: string;
  skills: string[];
  sources: { skill: string; path: string; manifestIdentity: string }[];
}

export interface PolicyAuthoringCatalogV1 {
  aihCapabilityCatalog: typeof AIH_CAPABILITY_CATALOG_V1;
  aihCapabilityPackage: { name: string; version: string };
  aihSkills: AihCatalogContentPackV1[];
  aihAgents: AihCatalogContentPackV1[];
  hosts: JsonRecord[];
  mcp: JsonRecord[];
  nonProjectableMcp: JsonRecord[];
  unavailableMcp: JsonRecord[];
  aihMcpRequestIds: readonly string[];
  eccMcpInventory: readonly EccMcpCatalogEntry[];
  externalMcp: readonly EccMcpCatalogEntry[];
  eccMcpProvenance: EccMcpCatalogProvenanceV1;
  eccSkills: readonly EccSkillCatalogEntryV1[];
  eccSkillsProvenance: EccSkillCatalogProvenanceV1;
  eccMcpApproval: { sourceContentSha256: string };
  eccHookControls: {
    sourceContentSha256: string;
    profiles: typeof ECC_HOOK_PROFILES;
    hooks: readonly EccHookControlCatalogEntry[];
    disabledHooks: { availability: "supported"; detail: string; eligibleIds: readonly string[] };
  };
  hooks: JsonRecord[];
  hookRegistry: {
    entries: JsonRecord[];
    declaredControls: JsonRecord[];
    registrations: JsonRecord[];
    overlaps: unknown[];
    spawnProjection: JsonRecord;
  };
  frameworks: PolicyAuthoringFrameworkV1[];
  enterpriseComposition: PolicyAuthoringCompositionV1;
}

/** Every true input the policy authoring catalog is generated from. */
export interface PolicyAuthoringCatalogInputsV1 {
  core: CoreProductDeclarationsV1;
  vendorLock: BaselineEvidenceLockV1;
  upstream: UpstreamInputsManifestV1;
  eccContentMetadata: unknown;
  eccSkillInventory: unknown;
  eccMcpInventory: unknown;
  eccModules: unknown;
  eccProfiles: unknown;
  eccHookSources: unknown;
  superpowersContentMetadata: unknown;
}

export function readPolicyAuthoringCatalogInputsV1(root: string): PolicyAuthoringCatalogInputsV1 {
  const upstream = readUpstreamInputsManifestV1(root);
  const verified = (file: string) => readVerifiedUpstreamInputV1(root, upstream, file).json;
  return {
    core: readCoreProductDeclarationsV1(root),
    vendorLock: parseBaselineEvidenceLockV1(
      JSON.parse(readFileSync(productionDataPathV1(root, "vendor-lock-v1.json"), "utf8")),
    ),
    upstream,
    eccContentMetadata: verified("ecc-content-metadata-v1.json"),
    eccSkillInventory: verified("ecc-skill-inventory-v1.json"),
    eccMcpInventory: verified("ecc-mcp-inventory-v1.json"),
    eccModules: verified("ecc-modules-v1.json"),
    eccProfiles: verified("ecc-profiles-v1.json"),
    eccHookSources: verified(ECC_HOOK_SOURCES_FILE_V1),
    superpowersContentMetadata: verified("superpowers-content-metadata-v1.json"),
  };
}

function firstPartyPacks(kind: "skill" | "agent"): AihCatalogContentPackV1[] {
  return FIRST_PARTY_CAPABILITY_PACKS.filter((pack) => pack.kind === kind).map(
    ({ kind: _, ...pack }) => ({
      ...pack,
      skills: [...pack.skills],
      sources: pack.sources.map((source) => ({ ...source })),
    }),
  );
}

function upstreamPin(
  upstream: UpstreamInputsManifestV1,
  file: string,
  pin: { repository: string; commit: string },
): { repository: string; commit: string } {
  const provenance = upstream.files[file];
  if (
    provenance === undefined ||
    provenance.repository !== pin.repository ||
    provenance.commit !== pin.commit
  )
    throw new TypeError(`upstream input ${file} was not fetched at the vetted pin`);
  return { repository: provenance.repository, commit: provenance.commit };
}

/** Ported from Core 80120883 `policyAuthoringCatalog` (src/org-policy/catalog.ts). */
export function policyAuthoringCatalogV1(
  inputs: PolicyAuthoringCatalogInputsV1,
): PolicyAuthoringCatalogV1 {
  const snapshots = new Map(inputs.vendorLock.sources.map((source) => [source.id, source]));
  const eccSnapshot = snapshots.get("ecc");
  const superpowersSnapshot = snapshots.get("superpowers");
  if (eccSnapshot === undefined || superpowersSnapshot === undefined)
    throw new TypeError("missing vetted framework source snapshot");
  const eccPin = {
    repository: `${eccSnapshot.owner}/${eccSnapshot.repo}`,
    commit: eccSnapshot.pinnedSha,
  };
  for (const file of [
    "ecc-content-metadata-v1.json",
    "ecc-skill-inventory-v1.json",
    "ecc-mcp-inventory-v1.json",
    "ecc-modules-v1.json",
    "ecc-profiles-v1.json",
    ECC_HOOK_SOURCES_FILE_V1,
  ])
    upstreamPin(inputs.upstream, file, eccPin);
  assertEccHookControlsReviewedV1(inputs.eccHookSources, eccPin.commit);
  const modules = parseEccModulesSnapshotV1(inputs.eccModules);
  const profiles = parseEccProfilesSnapshotV1(inputs.eccProfiles, modules);
  const model = eccComponentModelV1(modules, profiles);
  const eccMetadata = parseContentMetadataV1("ecc", inputs.eccContentMetadata, eccPin);
  const metadata = contentMetadataLookupV1(eccMetadata);
  const mcpRecord = inputs.upstream.files["ecc-mcp-inventory-v1.json"];
  const mcpPath = Object.keys(mcpRecord?.sources ?? {});
  if (mcpRecord === undefined || mcpPath.length !== 1 || mcpPath[0] === undefined)
    throw new TypeError("ECC MCP inventory must record exactly one upstream source file");
  if (mcpRecord.sources[mcpPath[0]] !== mcpRecord.sha256)
    throw new TypeError("ECC MCP inventory must be the exact upstream file bytes");
  const mcpProvenance: EccMcpCatalogProvenanceV1 = {
    repository: mcpRecord.repository,
    commit: mcpRecord.commit,
    path: mcpPath[0],
    contentSha256: mcpRecord.sha256,
  };
  const mcpInventory = validateEccMcpCatalogInventoryV1(inputs.eccMcpInventory);
  const externalMcp = eccExternalMcpCatalogV1(mcpInventory);
  const skillInventory = eccSkillInventoryV1(inputs.eccSkillInventory, eccPin, metadata);
  const ecc = prepareEccCatalogSourceV1({
    baseline: eccBaselineCatalogV1({ pin: eccSnapshot.pinnedSha, modules, profiles, model }),
    sourceSnapshot: eccSnapshot,
    model,
    contentMetadata: metadata,
    mcpProvenance,
    externalMcp,
    skillInventory,
  });
  const superpowersPin = {
    repository: `${superpowersSnapshot.owner}/${superpowersSnapshot.repo}`,
    commit: superpowersSnapshot.pinnedSha,
  };
  const frameworks = [
    ecc,
    prepareSuperpowersCatalogSourceV1({
      baseline: superpowersBaselineCatalogV1(superpowersSnapshot.pinnedSha),
      sourceSnapshot: superpowersSnapshot,
      contentMetadata: parseContentMetadataV1(
        "superpowers",
        inputs.superpowersContentMetadata,
        superpowersPin,
      ),
    }),
  ];
  const core = inputs.core;
  const thirdPartyHookEntries = frameworks.flatMap((framework) =>
    framework.assets
      .filter((asset) => (THIRD_PARTY_HOOK_COMPONENT_IDS as readonly string[]).includes(asset.id))
      .map((asset) => ({
        id: asset.id,
        owner: "third-party",
        ownerLabel: framework.id === "superpowers" ? "Superpowers" : "ECC",
        source: `${asset.source.repository}@${asset.source.commit.slice(0, 7)} ${asset.source.path}`,
        description: `Hook registrations ${framework.id} installs and runs. AIH registers and revokes them; ${framework.id} executes them.`,
        enforcement: "not-aih-enforced",
        selectable: true,
      })),
  );
  return {
    aihCapabilityCatalog: { ...AIH_CAPABILITY_CATALOG_V1 },
    aihCapabilityPackage: { name: core.source.package, version: core.source.version },
    aihSkills: firstPartyPacks("skill"),
    aihAgents: firstPartyPacks("agent"),
    hosts: structuredClone(core.hosts),
    eccMcpInventory: mcpInventory,
    externalMcp,
    eccMcpProvenance: mcpProvenance,
    eccSkills: skillInventory.entries,
    eccSkillsProvenance: skillInventory.provenance,
    eccMcpApproval: { sourceContentSha256: mcpProvenance.contentSha256 },
    eccHookControls: {
      sourceContentSha256: ECC_HOOK_CONTROL_SOURCE_CONTENT_SHA256,
      profiles: ECC_HOOK_PROFILES,
      hooks: eccHookControlCatalog,
      disabledHooks: {
        availability: "supported",
        detail:
          "ECC evaluates profile and disabled-hook choices after process spawn. AIH projects only the two supported Claude settings environment keys; ECC executes and enforces its hooks.",
        eligibleIds: ECC_DISABLE_ELIGIBLE_HOOK_IDS,
      },
    },
    hookRegistry: {
      entries: [...structuredClone(core.hookRegistry.entries), ...thirdPartyHookEntries],
      declaredControls: DECLARED_THIRD_PARTY_HOOK_CONTROLS.filter((control) =>
        frameworks.some((framework) => framework.id === control.owner),
      ).map((control) => ({ ...control })),
      registrations: structuredClone(core.hookRegistry.registrations),
      overlaps: structuredClone(core.hookRegistry.overlaps),
      spawnProjection: structuredClone(core.hookRegistry.spawnProjection),
    },
    enterpriseComposition: eccEnterpriseCompositionV1(ecc, model),
    nonProjectableMcp: structuredClone(core.nonProjectableMcp),
    unavailableMcp: structuredClone(core.unavailableMcp),
    aihMcpRequestIds: [...AIH_OWNED_ECC_MCP_EXCLUSIONS],
    mcp: structuredClone(core.mcp),
    hooks: structuredClone(core.hooks),
    frameworks,
  };
}
