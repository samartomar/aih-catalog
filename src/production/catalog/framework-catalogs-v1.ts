import type { BaselineCatalogV1, BaselineSourceEvidenceV1 } from "./baseline-lock-v1.js";
import type { ContentMetadataEntryV1, ContentMetadataV1 } from "./content-metadata-v1.js";
import {
  CORE_ECC_COMPONENTS,
  ECC_DECLARATION_RIDERS,
  type EccComponentId,
  type EccComponentModelV1,
  type EccMcpComponentId,
} from "./ecc-components-v1.js";
import type { EccMcpCatalogEntry, EccMcpCatalogProvenanceV1 } from "./ecc-mcp-inventory-v1.js";
import type { EccSkillInventoryV1 } from "./ecc-skill-inventory-v1.js";

/** Ported from Core 80120883 src/org-policy/catalog-provider-types.ts. */
export const POLICY_AUTHORING_ASSET_KINDS = [
  "agent",
  "baseline",
  "capability",
  "framework",
  "lang",
  "mcp",
  "module",
  "runtime",
  "skill",
] as const;

export type PolicyAuthoringAssetKindV1 = (typeof POLICY_AUTHORING_ASSET_KINDS)[number];

export interface PolicyAuthoringVetV1 {
  /** Whether the vet reported findings: a label for the administrator, never a gate (D50). */
  verdict: "no-findings" | "has-findings";
  treeSha256: string;
  analyzers: { name: string; version: string }[];
  findings: { code: string; count?: number; detail: string }[];
  /** Problems with the evidence itself (a detector that did not run), kept apart from findings. */
  evidenceProblems: { code: string; count?: number; detail: string }[];
}

export interface PolicyAuthoringAssetV1 {
  kind: PolicyAuthoringAssetKindV1;
  id: string;
  curationKind?: "agent" | "skill" | "command";
  riders?: string[];
  dependencies?: string[];
  members?: string[];
  source: { repository: string; commit: string; path: string };
  sourcePaths: string[];
  runtimeIdentity?: string;
  vet?: PolicyAuthoringVetV1;
  metadata?: {
    title: string;
    summary: string;
    usageContext: string;
    allowedTools: readonly string[];
    sourcePath: string;
    sourceSha256: string;
  };
}

export interface PolicyAuthoringFrameworkV1 {
  id: "ecc" | "superpowers";
  repository: string;
  commit: string;
  assets: PolicyAuthoringAssetV1[];
}

export interface PolicyAuthoringCompositionV1 {
  framework: "ecc";
  parts: {
    id: string;
    label: string;
    rule: string;
    selection: "composed" | "additive";
    componentIds: string[];
  }[];
}

export function policyAuthoringAssetKindV1(id: string): PolicyAuthoringAssetKindV1 {
  const prefix = id.split(":", 1)[0];
  if (!POLICY_AUTHORING_ASSET_KINDS.includes(prefix as PolicyAuthoringAssetKindV1))
    throw new TypeError(`unsupported policy authoring asset kind ${id}`);
  return prefix as PolicyAuthoringAssetKindV1;
}

export function policyAuthoringCurationKindV1(id: string): PolicyAuthoringAssetV1["curationKind"] {
  const prefix = id.split(":", 1)[0];
  if (prefix === "agent" || prefix === "skill") return prefix;
  return id === "baseline:commands" || id === "module:commands-core" ? "command" : undefined;
}

/** Exact provenance paths, with the narrow adapter-owned rule and skill aliases. */
export function policyAuthoringSelectionSourcePathsV1(
  id: string,
  catalogPaths: readonly string[],
): string[] {
  const paths = new Set(catalogPaths);
  if (id === "baseline:rules") paths.add("rules");
  if (id.startsWith("skill:")) {
    const skillDirectory = `skills/${id.slice("skill:".length)}`;
    paths.add(skillDirectory);
    paths.add(`${skillDirectory}/SKILL.md`);
  }
  return [...paths];
}

export function policyAuthoringPreferredSelectionSourcePathV1(
  id: string,
  catalogPaths: readonly string[],
): string | undefined {
  if (id === "baseline:rules") return "rules";
  if (id.startsWith("skill:")) {
    const directSkill = `skills/${id.slice("skill:".length)}`;
    if (catalogPaths.includes(directSkill)) return directSkill;
  }
  return catalogPaths[0];
}

function assertVettedSource(
  name: string,
  baseline: BaselineCatalogV1,
  sourceSnapshot: BaselineSourceEvidenceV1,
): void {
  if (
    baseline.owner !== sourceSnapshot.owner ||
    baseline.repo !== sourceSnapshot.repo ||
    baseline.pinnedSha !== sourceSnapshot.pinnedSha ||
    sourceSnapshot.id !== baseline.id
  )
    throw new TypeError(`${name} baseline input does not match its vetted source snapshot`);
}

function vetEntryOf(entry: BaselineSourceEvidenceV1["components"][number]["findings"][number]): {
  code: string;
  count?: number;
  detail: string;
} {
  return {
    code: entry.code,
    ...(typeof entry.count === "number" ? { count: entry.count } : {}),
    detail: entry.detail,
  };
}

function vetOf(component: BaselineSourceEvidenceV1["components"][number]): PolicyAuthoringVetV1 {
  return {
    verdict: component.verdict,
    treeSha256: component.treeSha256,
    analyzers: component.analyzers.map((entry) => ({ name: entry.name, version: entry.version })),
    findings: component.findings.map(vetEntryOf),
    evidenceProblems: component.evidenceProblems.map(vetEntryOf),
  };
}

function metadataOf(metadata: ContentMetadataEntryV1): PolicyAuthoringAssetV1["metadata"] {
  return {
    title: metadata.title,
    summary: metadata.summary,
    usageContext: metadata.usageContext,
    allowedTools: metadata.allowedTools,
    sourcePath: metadata.path,
    sourceSha256: metadata.sourceSha256,
  };
}

export interface PrepareEccCatalogSourceInputV1 {
  baseline: BaselineCatalogV1;
  sourceSnapshot: BaselineSourceEvidenceV1;
  model: EccComponentModelV1;
  contentMetadata: (kind: "agent" | "skill", id: string) => ContentMetadataEntryV1 | undefined;
  mcpProvenance: EccMcpCatalogProvenanceV1;
  externalMcp: readonly EccMcpCatalogEntry[];
  skillInventory: EccSkillInventoryV1;
}

function externalEccMcpAssets(input: PrepareEccCatalogSourceInputV1): PolicyAuthoringAssetV1[] {
  const { baseline, mcpProvenance: provenance } = input;
  if (
    provenance.repository !== `${baseline.owner}/${baseline.repo}` ||
    provenance.commit !== baseline.pinnedSha
  ) {
    throw new TypeError(
      "source-locked ECC MCP inventory provenance does not match the policy catalog",
    );
  }
  const baselineIds = new Set(baseline.components.map((component) => component.id));
  return input.externalMcp.map((entry) => {
    const id = `mcp:${entry.id}`;
    if (baselineIds.has(id))
      throw new TypeError(`source-locked ECC MCP inventory duplicates baseline component ${id}`);
    return {
      id,
      kind: "mcp",
      source: {
        repository: provenance.repository,
        commit: provenance.commit,
        path: provenance.path,
      },
      sourcePaths: [provenance.path],
      runtimeIdentity: `mcp:${entry.id}`,
      metadata: {
        title: entry.id,
        summary: entry.description,
        usageContext: `ECC declares this as a ${entry.transport} MCP configuration.`,
        allowedTools: [],
        sourcePath: provenance.path,
        sourceSha256: provenance.contentSha256,
      },
    };
  });
}

/** Ported from Core 80120883 src/org-policy/catalog-providers/ecc.ts. */
export function prepareEccCatalogSourceV1(
  input: PrepareEccCatalogSourceInputV1,
): PolicyAuthoringFrameworkV1 {
  const { baseline, sourceSnapshot, model } = input;
  if (baseline.id !== "ecc") throw new TypeError("ECC baseline input has another identity");
  assertVettedSource("ECC", baseline, sourceSnapshot);
  const present = new Set(baseline.components.map((component) => component.id));
  const vetted = new Map(sourceSnapshot.components.map((component) => [component.id, component]));
  const assets: PolicyAuthoringAssetV1[] = baseline.components.map((component) => {
    const id = component.id;
    const kind = policyAuthoringAssetKindV1(id);
    const path = policyAuthoringPreferredSelectionSourcePathV1(id, component.paths);
    if (!path) throw new TypeError(`baseline component ${id} declares no path`);
    const rider: string[] = [...(ECC_DECLARATION_RIDERS[id] ?? [])];
    if (/^(?:lang|framework|capability):/u.test(id)) {
      const descriptor = model.eccComponentInstallDescriptor(id as EccComponentId);
      rider.push(...(descriptor.skills ?? []).map((name) => `skill:${name}`));
      for (const moduleId of descriptor.wholeModules ?? [])
        for (const member of model.eccModuleSelectableMemberIds(moduleId, [...present]))
          if (member.startsWith("skill:")) rider.push(member);
    }
    const riders = [...new Set(rider)].filter((value) => present.has(value));
    const dependencies = id.startsWith("runtime:")
      ? []
      : [
          ...new Set(
            model
              .eccComponentRequiredModuleRootIds(id as EccComponentId | EccMcpComponentId)
              .flatMap((moduleId) => [moduleId, ...model.eccModuleDependencyIds(moduleId)])
              .map((moduleId) => `module:${moduleId}`)
              .filter((value) => value !== id),
          ),
        ];
    for (const value of dependencies)
      if (!present.has(value))
        throw new TypeError(
          `baseline component ${id} requires ${value}, which the pinned catalog does not contain`,
        );
    const members = id.startsWith("module:")
      ? model.eccModuleSelectableMemberIds(id.slice("module:".length), [...present])
      : [];
    const metadata =
      kind === "agent" || kind === "skill"
        ? input.contentMetadata(kind, id.slice(id.indexOf(":") + 1))
        : undefined;
    if ((kind === "agent" || kind === "skill") && !metadata)
      throw new TypeError(`ECC ${kind} ${id} has no source-authored metadata`);
    const vet = vetted.get(id);
    const curationKind = policyAuthoringCurationKindV1(id);
    return {
      id,
      kind,
      ...(curationKind === undefined ? {} : { curationKind }),
      ...(riders.length ? { riders } : {}),
      ...(dependencies.length ? { dependencies } : {}),
      ...(members.length ? { members } : {}),
      ...(kind === "mcp" ? { runtimeIdentity: `mcp:${id.slice("mcp:".length)}` } : {}),
      ...(vet ? { vet: vetOf(vet) } : {}),
      ...(metadata ? { metadata: metadataOf(metadata) } : {}),
      source: {
        repository: `${baseline.owner}/${baseline.repo}`,
        commit: baseline.pinnedSha,
        path,
      },
      sourcePaths: policyAuthoringSelectionSourcePathsV1(id, component.paths),
    };
  });
  assets.push(...externalEccMcpAssets(input));
  const framework: PolicyAuthoringFrameworkV1 = {
    id: "ecc",
    repository: `${baseline.owner}/${baseline.repo}`,
    commit: baseline.pinnedSha,
    assets,
  };
  validateEccSkillCatalog(framework, input.skillInventory);
  return framework;
}

function validateEccSkillCatalog(
  ecc: PolicyAuthoringFrameworkV1,
  inventory: EccSkillInventoryV1,
): void {
  if (
    inventory.provenance.repository !== ecc.repository ||
    inventory.provenance.commit !== ecc.commit
  )
    throw new TypeError(
      "source-locked ECC skill inventory provenance does not match the policy catalog",
    );
  const byId = new Map(inventory.entries.map((skill) => [skill.id, skill]));
  for (const skill of inventory.entries)
    if (!skill.governable || !ecc.assets.some((asset) => asset.id === `skill:${skill.id}`))
      throw new TypeError(`ECC skill ${skill.id} is absent from the selectable policy catalog`);
  for (const asset of ecc.assets.filter((candidate) => candidate.kind === "skill")) {
    const name = asset.id.slice("skill:".length);
    if (!byId.get(name)?.governable)
      throw new TypeError(
        `policy skill ${asset.id} is absent or unavailable in the source-locked ECC inventory`,
      );
  }
}

/** Ported from Core 80120883 `eccEnterpriseCompositionV1`. */
export function eccEnterpriseCompositionV1(
  ecc: PolicyAuthoringFrameworkV1,
  model: EccComponentModelV1,
): PolicyAuthoringCompositionV1 {
  const core = model.eccProfileModuleIds("core").map((id) => `module:${id}`);
  const inCore = new Set(core);
  const parts: PolicyAuthoringCompositionV1["parts"] = [
    {
      id: "ecc-install-core",
      label: "ECC install profile: core",
      rule: 'ecc-profiles.json profile "core", dependency-closed by eccProfileModuleIds()',
      selection: "composed",
      componentIds: core,
    },
    {
      id: "aih-core-closure",
      label: "AIH's named ECC Core closure",
      rule: "CORE_ECC_COMPONENTS — AIH's own curation, not a set ECC declares",
      selection: "additive",
      componentIds: [...CORE_ECC_COMPONENTS],
    },
    {
      id: "language",
      label: "Language composition, additive on top of Core",
      rule: "every ECC component in the lang: namespace",
      selection: "additive",
      componentIds: ecc.assets.filter((asset) => asset.kind === "lang").map((asset) => asset.id),
    },
    {
      id: "security",
      label: "Security composition",
      rule: 'capability:security is what selectEccComponents() recommends at enterprise posture; module:security is what ECC\'s "security" profile adds over "core"',
      selection: "additive",
      componentIds: [
        "capability:security",
        ...model
          .eccProfileModuleIds("security")
          .map((id) => `module:${id}`)
          .filter((id) => !inCore.has(id)),
      ],
    },
  ];
  const owned = new Set(ecc.assets.map((asset) => asset.id));
  for (const part of parts)
    for (const id of part.componentIds)
      if (!owned.has(id))
        throw new TypeError(
          `enterprise composition part ${part.id} names ${id}, which the pinned ECC catalog does not contain`,
        );
  return { framework: "ecc", parts };
}

/** Ported from Core 80120883 src/org-policy/catalog-providers/superpowers.ts. */
export function prepareSuperpowersCatalogSourceV1(input: {
  baseline: BaselineCatalogV1;
  sourceSnapshot: BaselineSourceEvidenceV1;
  contentMetadata: ContentMetadataV1;
}): PolicyAuthoringFrameworkV1 {
  const { baseline, sourceSnapshot, contentMetadata } = input;
  if (baseline.id !== "superpowers")
    throw new TypeError("Superpowers baseline input has another identity");
  assertVettedSource("Superpowers", baseline, sourceSnapshot);
  if (
    contentMetadata.commit !== baseline.pinnedSha ||
    contentMetadata.repository !== `${baseline.owner}/${baseline.repo}`
  )
    throw new TypeError("Superpowers content metadata does not match its pinned source");
  const metadataById = new Map(
    contentMetadata.skills.map((entry): [string, ContentMetadataEntryV1] => [
      `skill:${entry.id}`,
      entry,
    ]),
  );
  const vetted = new Map(sourceSnapshot.components.map((component) => [component.id, component]));
  const componentIds = new Set(baseline.components.map((component) => component.id));
  if ([...metadataById.keys()].some((id) => !componentIds.has(id)))
    throw new TypeError("Superpowers content metadata names an item outside its pinned catalog");
  return {
    id: "superpowers",
    repository: `${baseline.owner}/${baseline.repo}`,
    commit: baseline.pinnedSha,
    assets: baseline.components.map((component) => {
      const vet = vetted.get(component.id);
      const metadata = metadataById.get(component.id);
      if (component.id.startsWith("skill:") && metadata === undefined)
        throw new TypeError(`Superpowers ${component.id} has no source-authored metadata`);
      const curationKind = policyAuthoringCurationKindV1(component.id);
      return {
        id: component.id,
        kind: policyAuthoringAssetKindV1(component.id),
        ...(metadata === undefined ? {} : { metadata: metadataOf(metadata) }),
        ...(curationKind === undefined ? {} : { curationKind }),
        source: {
          repository: `${baseline.owner}/${baseline.repo}`,
          commit: baseline.pinnedSha,
          path: policyAuthoringPreferredSelectionSourcePathV1(component.id, component.paths) ?? "",
        },
        sourcePaths: policyAuthoringSelectionSourcePathsV1(component.id, component.paths),
        ...(vet === undefined ? {} : { vet: vetOf(vet) }),
      };
    }),
  };
}
