import type { BaselineSourceEvidenceV1 } from "../catalog/baseline-lock-v1.js";
import type {
  PolicyAuthoringCompositionV1,
  PolicyAuthoringFrameworkV1,
} from "../catalog/framework-catalogs-v1.js";
import type { PolicyAuthoringCatalogV1 } from "../catalog/policy-authoring-catalog-v1.js";
import { canonicalStrictJsonSha256V1 } from "../strict-json-v1.js";
import { compileAnthropicsSkillsComponentCollectionV1 } from "./anthropics-skills-provider-v1.js";
import { type BuiltInCatalogInputV1, compileBuiltInCatalogV1 } from "./built-in-v1.js";
import {
  type CatalogCompilerAssemblyInputV1,
  compilerRegistrationForInputFormatV1,
} from "./compiler-formats-v1.js";
import type {
  AuthoringCatalogBundleV1,
  CoreAuthoringCapabilityRegistryEntryV1,
} from "./contracts-v1.js";
import {
  compileMattPocockSkillCollectionV1,
  prepareMattPocockCollectionV1,
} from "./mattpocock-provider-v1.js";
import { compilePinnedBaselineV1 } from "./pinned-baseline-v1.js";
import { compilePonytailComponentCollectionV1 } from "./ponytail-provider-v1.js";
import {
  type CatalogProviderCompilationV1,
  compileCatalogProviderV1,
} from "./provider-compilation-v1.js";

/**
 * The registered Catalog content providers, in Core's reviewed enrollment order
 * (ecc, superpowers, aih, mattpocock, ponytail). Ported from Core 80120883
 * src/org-policy/workbench/providers/{registry,pinned,ecc,superpowers,aih}.ts.
 */
type TemplateV1 = AuthoringCatalogBundleV1["templates"][string];
type TemplateDefinitionV1 = Omit<TemplateV1, "digest">;

function compileTemplateDefinitionsV1(
  definitions: readonly TemplateDefinitionV1[],
): AuthoringCatalogBundleV1["templates"] {
  return Object.fromEntries(
    definitions.map((template) => {
      const roots = [...template.roots].sort((a, b) =>
        a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0,
      );
      return [
        template.id,
        {
          ...template,
          roots,
          digest: `sha256:${canonicalStrictJsonSha256V1({ ...template, roots })}`,
        },
      ];
    }),
  );
}

function methodologyTemplateV1(framework: PolicyAuthoringFrameworkV1): TemplateDefinitionV1 {
  return {
    id: `template:${framework.id}/methodology`,
    label: `${framework.repository.split("/").at(-1)} methodology`,
    roots: [
      {
        assetId: `${framework.id}/profile:methodology`,
        mode: "select",
        includeOptionalMembers: false,
      },
    ],
    exclusions: [],
  };
}

export interface PinnedProviderInputV1 {
  framework: PolicyAuthoringFrameworkV1;
  source: BaselineSourceEvidenceV1;
}

export interface EccProviderInputV1 extends PinnedProviderInputV1 {
  composition: PolicyAuthoringCompositionV1;
}

function compilePinnedProviderV1(
  input: PinnedProviderInputV1,
  templates: readonly TemplateDefinitionV1[],
): CatalogCompilerAssemblyInputV1 {
  const result = compilePinnedBaselineV1(input.framework, input.source);
  return {
    sources: {
      [result.source.id]: {
        id: result.source.id,
        distributor: { kind: "aih", locator: "@aihq/core" },
        upstreamOrigin: { kind: "git", locator: result.source.repository },
        inputFormat: "pinned-baseline/v1",
        revision: { id: result.source.revisionId, contentDigest: result.source.contentDigest },
        compiler: compilerRegistrationForInputFormatV1("pinned-baseline/v1"),
      },
    },
    declarations: result.declarations,
    relations: result.relations,
    groups: result.groups,
    evidence: result.evidence,
    detailBytes: result.detailBytes,
    templates: compileTemplateDefinitionsV1(templates),
  };
}

export function compileEccProviderV1(input: EccProviderInputV1): CatalogCompilerAssemblyInputV1[] {
  if (input.framework.id !== "ecc") throw new TypeError("ECC provider requires its exact source");
  const templates = input.composition.parts.map(
    (part): TemplateDefinitionV1 => ({
      id: `template:ecc/${part.id}`,
      label: part.label,
      roots: part.componentIds.map((id) => ({
        assetId: `ecc/${id}`,
        mode: "select",
        includeOptionalMembers: false,
      })),
      exclusions: [],
    }),
  );
  return [compilePinnedProviderV1(input, [...templates, methodologyTemplateV1(input.framework)])];
}

export function compileSuperpowersProviderV1(
  input: PinnedProviderInputV1,
): CatalogCompilerAssemblyInputV1[] {
  if (input.framework.id !== "superpowers")
    throw new TypeError("Superpowers provider requires its exact source");
  return [compilePinnedProviderV1(input, [methodologyTemplateV1(input.framework)])];
}

export function builtInAssemblyInputV1(
  result: ReturnType<typeof compileBuiltInCatalogV1>,
): CatalogCompilerAssemblyInputV1 {
  return {
    sources: {
      [result.source.id]: {
        id: result.source.id,
        distributor: { kind: "aih", locator: "@aihq/core" },
        upstreamOrigin: { kind: "aih", locator: result.source.locator },
        inputFormat: "built-in/v1",
        revision: { id: result.source.revisionId, contentDigest: result.source.contentDigest },
        compiler: compilerRegistrationForInputFormatV1("built-in/v1"),
      },
    },
    declarations: result.declarations,
    groups: {},
    detailBytes: result.detailBytes,
  };
}

export interface CompiledCatalogProvidersV1 {
  providers: CatalogProviderCompilationV1[];
  coreCapabilities: CoreAuthoringCapabilityRegistryEntryV1[];
}

export function builtInCatalogInputV1(catalog: PolicyAuthoringCatalogV1): BuiltInCatalogInputV1 {
  return {
    aihCapabilityPackage: catalog.aihCapabilityPackage,
    aihSkills: catalog.aihSkills,
    aihAgents: catalog.aihAgents,
    mcp: catalog.mcp,
    hooks: catalog.hooks,
    unavailableMcp: catalog.unavailableMcp,
    nonProjectableMcp: catalog.nonProjectableMcp,
  };
}

/** The Matt Pocock collection provider: it compiles from the fetched snapshot alone. */
export function compileMattPocockProviderV1(snapshot: unknown): CatalogProviderCompilationV1 {
  return compileCatalogProviderV1(
    "mattpocock",
    (value: ReturnType<typeof prepareMattPocockCollectionV1>) => [
      compileMattPocockSkillCollectionV1(value),
    ],
    prepareMattPocockCollectionV1(snapshot),
  );
}

/** The Ponytail collection provider: it compiles from the fetched snapshot alone. */
export function compilePonytailProviderV1(snapshot: unknown): CatalogProviderCompilationV1 {
  return compileCatalogProviderV1(
    "ponytail",
    (value: unknown) => [compilePonytailComponentCollectionV1(value)],
    snapshot,
  );
}

/**
 * The anthropics/skills collection provider. It is not a registered provider: the full build
 * carries anthropics/skills only as its sealed packaged source record. It compiles a named T3
 * compiler input where no record may stand in (a new pin, before T3 produces the record).
 */
export function compileAnthropicsSkillsProviderV1(
  compilerInput: unknown,
): CatalogProviderCompilationV1 {
  return compileCatalogProviderV1(
    "anthropics-skills",
    (value: unknown) => [compileAnthropicsSkillsComponentCollectionV1(value)],
    compilerInput,
  );
}

/** Compiles every registered provider from the catalog and its true inputs. */
export function compileCatalogProvidersV1(input: {
  catalog: PolicyAuthoringCatalogV1;
  vendorSources: readonly BaselineSourceEvidenceV1[];
  mattpocockSnapshot: unknown;
  ponytailSnapshot: unknown;
}): CompiledCatalogProvidersV1 {
  const { catalog } = input;
  const pinned = (id: "ecc" | "superpowers"): PinnedProviderInputV1 => {
    const framework = catalog.frameworks.find((entry) => entry.id === id);
    const source = input.vendorSources.find((entry) => entry.id === id);
    if (framework === undefined || source === undefined)
      throw new TypeError(`missing pinned provider source ${id}`);
    return { framework, source };
  };
  const builtIn = builtInCatalogInputV1(catalog);
  return {
    providers: [
      compileCatalogProviderV1("ecc", compileEccProviderV1, {
        ...pinned("ecc"),
        composition: catalog.enterpriseComposition,
      }),
      compileCatalogProviderV1("superpowers", compileSuperpowersProviderV1, pinned("superpowers")),
      compileCatalogProviderV1(
        "aih",
        (value: BuiltInCatalogInputV1) => [builtInAssemblyInputV1(compileBuiltInCatalogV1(value))],
        builtIn,
      ),
      compileMattPocockProviderV1(input.mattpocockSnapshot),
      compilePonytailProviderV1(input.ponytailSnapshot),
    ],
    coreCapabilities: compileBuiltInCatalogV1(builtIn).coreCapabilities,
  };
}
