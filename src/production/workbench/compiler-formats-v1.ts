import type {
  AuthoringActionV1,
  AuthoringCatalogBundleV1,
  CompilerAssetDeclarationV1,
  CoreAuthoringCapabilityRegistryEntryV1,
} from "./contracts-v1.js";

export interface CompilerFormatRegistrationV1 {
  readonly id: string;
  readonly version: string;
  readonly inputFormat: string;
  /** Reviewed format/kind policy; compiler input cannot nominate a projector. */
  readonly actions: Readonly<Record<string, AuthoringActionV1>>;
}

/**
 * Reviewed enrollment of every build-time input format. The organization-manifest
 * format stays enrolled because Core compiles organization manifests against this
 * same registration identity (its digest is part of the preassembly admission).
 */
export const compilerFormatRegistrationsV1 = [
  {
    id: "pinned-baseline",
    version: "1",
    inputFormat: "pinned-baseline/v1",
    actions: { "*": "record-selection" },
  },
  {
    id: "built-in",
    version: "1",
    inputFormat: "built-in/v1",
    actions: {
      mcp: "record-request",
      hook: "record-request",
      skill: "record-selection",
      agent: "record-selection",
    },
  },
  {
    id: "pinned-skill-collection",
    version: "1",
    inputFormat: "pinned-skill-collection/v1",
    actions: { skill: "record-selection" },
  },
  {
    id: "pinned-component-collection",
    version: "1",
    inputFormat: "pinned-component-collection/v1",
    actions: {
      hook: "record-request",
      mcp: "record-request",
      profile: "record-selection",
      skill: "record-selection",
    },
  },
  {
    id: "organization-manifest",
    version: "1",
    inputFormat: "organization-authoring-manifest/v1",
    actions: {
      mcp: "record-request",
      skill: "record-selection",
      agent: "record-selection",
    },
  },
] as const satisfies readonly CompilerFormatRegistrationV1[];

export interface CompiledDeclarationV1 {
  declaration: CompilerAssetDeclarationV1;
  /** A registered format identity, never an action chosen by compiler input. */
  inputFormat: string;
}

/** A source-neutral compiler result accepted by the bundle assembler. */
export interface CatalogCompilerAssemblyInputV1 {
  sources: AuthoringCatalogBundleV1["sources"];
  declarations: readonly CompiledDeclarationV1[];
  relations?: AuthoringCatalogBundleV1["relations"];
  groups?: AuthoringCatalogBundleV1["groups"];
  templates?: AuthoringCatalogBundleV1["templates"];
  evidence?: AuthoringCatalogBundleV1["evidence"];
  detailBytes: Record<string, string>;
}

export function compilerRegistrationForInputFormatV1(
  inputFormat: string,
): Readonly<{ id: string; version: string }> {
  const registration = compilerFormatRegistrationsV1.find(
    (candidate) => candidate.inputFormat === inputFormat,
  );
  if (registration === undefined)
    throw new TypeError(`unregistered compiler input format ${inputFormat}`);
  return { id: registration.id, version: registration.version };
}

export function actionForCompilerDeclarationV1(
  inputFormat: string,
  kind: string,
): AuthoringActionV1 {
  const registration = compilerFormatRegistrationsV1.find(
    (candidate) => candidate.inputFormat === inputFormat,
  );
  const actions = registration?.actions as Readonly<Record<string, AuthoringActionV1>> | undefined;
  const action = actions?.[kind] ?? actions?.["*"];
  if (action === undefined) {
    throw new TypeError(`unsupported compiler declaration kind ${kind} for ${inputFormat}`);
  }
  return action;
}

function identityKey(
  entry: Pick<
    CoreAuthoringCapabilityRegistryEntryV1,
    "assetId" | "sourceId" | "sourceRevisionId" | "contentDigest"
  >,
): string {
  return `${entry.assetId}\u0000${entry.sourceId}\u0000${entry.sourceRevisionId}\u0000${entry.contentDigest}`;
}

/** Core capability matches may elevate only exact first-party controls. */
export function assemblyRegistryForCompiledDeclarationsV1(
  declarations: readonly CompiledDeclarationV1[],
  coreCapabilities: readonly CoreAuthoringCapabilityRegistryEntryV1[],
): CoreAuthoringCapabilityRegistryEntryV1[] {
  const exactCapabilities = new Map<string, CoreAuthoringCapabilityRegistryEntryV1>();
  for (const capability of coreCapabilities) {
    const key = identityKey(capability);
    if (exactCapabilities.has(key)) throw new Error("ambiguous Core authoring capability");
    exactCapabilities.set(key, capability);
  }
  const seenDeclarations = new Set<string>();
  return declarations.map(({ declaration, inputFormat }) => {
    const key = identityKey({ ...declaration, assetId: declaration.id });
    if (seenDeclarations.has(key)) throw new Error("duplicate compiled authoring declaration");
    seenDeclarations.add(key);
    const core = exactCapabilities.get(key);
    if (core !== undefined) return core;
    return {
      assetId: declaration.id,
      sourceId: declaration.sourceId,
      sourceRevisionId: declaration.sourceRevisionId,
      contentDigest: declaration.contentDigest,
      action: actionForCompilerDeclarationV1(inputFormat, declaration.kind),
      supportedTargets: [],
    };
  });
}

/** Generic compiler output cannot claim Scanner/Core custody or qualification. */
export function rejectTrustedCompilerEvidenceV1(
  inputs: readonly CatalogCompilerAssemblyInputV1[],
): void {
  for (const input of inputs) {
    if (Object.hasOwn(input, "qualifications"))
      throw new Error("untrusted compiler input claims Core Catalog qualification");
    for (const evidence of Object.values(input.evidence ?? {})) {
      if (
        evidence.verification.state === "verified" ||
        evidence.qualification.state === "qualified"
      ) {
        throw new Error(
          `untrusted compiler evidence claims Core verification or qualification: ${evidence.id}`,
        );
      }
    }
  }
}
