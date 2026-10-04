import type { AihCatalogContentPackV1 } from "../catalog/policy-authoring-catalog-v1.js";
import { canonicalStrictJsonBytesV1, sha256HexV1 } from "../strict-json-v1.js";
import type { JsonRecord } from "../validate-v1.js";
import type { CompiledDeclarationV1 } from "./compiler-formats-v1.js";
import type {
  CompilerAssetDeclarationV1,
  CoreAuthoringCapabilityRegistryEntryV1,
} from "./contracts-v1.js";

/**
 * Compiles AIH's own declarations (its first-party packs and the Core product
 * controls it declares) into declaration-bound assets. Ported from Core 80120883
 * src/org-policy/workbench/compilers/built-in.ts. The digests bind the compiler
 * input manifest; they never claim to be upstream bytes or Scanner evidence.
 */
export interface BuiltInCatalogInputV1 {
  aihCapabilityPackage: { name: string; version: string };
  aihSkills: readonly AihCatalogContentPackV1[];
  aihAgents: readonly AihCatalogContentPackV1[];
  mcp: readonly JsonRecord[];
  hooks: readonly JsonRecord[];
  unavailableMcp: readonly JsonRecord[];
  nonProjectableMcp: readonly JsonRecord[];
}

interface ControlV1 {
  kind: string;
  targets: string[];
  projector: "mcp-managed-settings" | "usage-hook";
  source: { type: string; server?: string };
}

interface ServerDisclosureV1 {
  type: "stdio" | "http";
  description: string;
  egress: "none" | "local-only" | "vendor-incumbent" | "third-party";
  credentials: "none" | "oauth" | "token";
}

const EGRESS: Record<ServerDisclosureV1["egress"], string> = {
  none: "The source declares no network traffic from this server.",
  "local-only": "Network activity is directed by the user, such as sites visited in a browser.",
  "vendor-incumbent":
    "Connects to a vendor service. Review the source description for the destination and data involved.",
  "third-party":
    "Sends data to a third-party service. Review the provider and the information it receives.",
};

const CREDENTIALS: Record<ServerDisclosureV1["credentials"], string> = {
  none: "No required credential is declared.",
  oauth: "Uses sign-in authorization handled by the client.",
  token: "Requires a token or API key supplied separately.",
};

function control(value: unknown, label: string): ControlV1 {
  const candidate = value as Partial<ControlV1> | undefined;
  if (
    candidate === undefined ||
    typeof candidate.kind !== "string" ||
    !Array.isArray(candidate.targets) ||
    (candidate.projector !== "mcp-managed-settings" && candidate.projector !== "usage-hook") ||
    typeof candidate.source?.type !== "string"
  )
    throw new TypeError(`${label} has no valid control`);
  return candidate as ControlV1;
}

function server(value: unknown, label: string): ServerDisclosureV1 | undefined {
  if (value === undefined) return undefined;
  const candidate = value as Partial<ServerDisclosureV1>;
  if (
    (candidate.type !== "stdio" && candidate.type !== "http") ||
    typeof candidate.description !== "string" ||
    candidate.egress === undefined ||
    !Object.hasOwn(EGRESS, candidate.egress) ||
    candidate.credentials === undefined ||
    !Object.hasOwn(CREDENTIALS, candidate.credentials)
  )
    throw new TypeError(`${label} has an invalid server disclosure`);
  return candidate as ServerDisclosureV1;
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value !== undefined && typeof value !== "string")
    throw new TypeError(`${label} must be a string`);
  return value;
}

/** Only public disclosure fields enter the UI; never commands, headers or environment values. */
function mcpDecision(
  disclosure: ServerDisclosureV1 | undefined,
  description?: string,
): Record<string, string> {
  if (disclosure === undefined) return description === undefined ? {} : { purpose: description };
  return {
    purpose: description ?? disclosure.description,
    access: `${disclosure.type === "stdio" ? "Runs a local process." : "Connects to a service over HTTP."} ${EGRESS[disclosure.egress]} ${CREDENTIALS[disclosure.credentials]}`,
  };
}

function digest(bytes: Uint8Array | string): string {
  return `sha256:${sha256HexV1(bytes)}`;
}

export interface CompiledBuiltInCatalogV1 {
  source: { id: string; revisionId: string; contentDigest: string; locator: string };
  declarations: CompiledDeclarationV1[];
  coreCapabilities: CoreAuthoringCapabilityRegistryEntryV1[];
  detailBytes: Record<string, string>;
}

export function compileBuiltInCatalogV1(catalog: BuiltInCatalogInputV1): CompiledBuiltInCatalogV1 {
  const sourceId = "source:aih-core";
  const revisionId = `package:${catalog.aihCapabilityPackage.name}@${catalog.aihCapabilityPackage.version}`;
  const sourceManifest = canonicalStrictJsonBytesV1({
    version: "built-in-catalog-input/v1",
    package: catalog.aihCapabilityPackage,
    controls: catalog.mcp.map(({ id, control }) => ({ id, control })),
    unavailableMcp: catalog.unavailableMcp,
    nonProjectableMcp: catalog.nonProjectableMcp,
    hooks: catalog.hooks,
    skills: catalog.aihSkills,
    agents: catalog.aihAgents,
  });
  const detailBytes: Record<string, string> = {};
  const declarations: CompiledDeclarationV1[] = [];
  const coreCapabilities: CoreAuthoringCapabilityRegistryEntryV1[] = [];
  const add = (
    id: string,
    kind: string,
    label: string,
    originalPath: string,
    declarationInput: unknown,
    supportedTargets: readonly string[] = [],
    projectorId?: "mcp-managed-settings" | "usage-hook",
    decision?: Record<string, string>,
    runtimeIdentity?: string,
  ): void => {
    if (declarations.some((entry) => entry.declaration.id === id))
      throw new TypeError(`duplicate built-in catalog declaration ${id}`);
    const detailChunkId = `detail:${id}`;
    const contentDigest = digest(
      canonicalStrictJsonBytesV1({
        version: "built-in-declaration/v1",
        declaration: declarationInput,
      }),
    );
    detailBytes[detailChunkId] = canonicalStrictJsonBytesV1({
      version: "built-in-detail/v1",
      declaration: declarationInput,
      identity: { kind: "declaration", digest: contentDigest },
      ...(decision === undefined ? {} : { decision }),
    }).toString("utf8");
    const declaration: CompilerAssetDeclarationV1 = {
      id,
      sourceId,
      sourceRevisionId: revisionId,
      contentDigest,
      originalPath,
      derivation: "built-in",
      kind,
      label,
      detailChunkId,
      declaredHostCapabilities: [...supportedTargets],
      ...(runtimeIdentity === undefined ? {} : { runtimeIdentity }),
    };
    declarations.push({ declaration, inputFormat: "built-in/v1" });
    if (projectorId !== undefined)
      coreCapabilities.push({
        assetId: id,
        sourceId,
        sourceRevisionId: revisionId,
        contentDigest,
        action: "select-control",
        projectorId,
        supportedTargets: [...supportedTargets],
      });
  };
  for (const item of catalog.mcp) {
    const id = String(item.id);
    const description = optionalText(item.description, `AIH MCP ${id} description`);
    const itemControl = control(item.control, `AIH MCP ${id}`);
    add(
      `aih/${id}`,
      itemControl.kind,
      id,
      `core-control/${id}`,
      { id, description, control: item.control },
      itemControl.targets,
      itemControl.projector,
      mcpDecision(server(item.server, `AIH MCP ${id}`), description),
      itemControl.source.type === "mcp" ? `mcp:${String(itemControl.source.server)}` : undefined,
    );
  }
  for (const hook of catalog.hooks) {
    const id = String(hook.id);
    if (catalog.mcp.some((entry) => entry.id === id)) continue;
    const hookControl = control(hook.control, `AIH hook ${id}`);
    add(
      `aih/${id}`,
      hookControl.kind,
      id,
      `core-control/${id}`,
      hook,
      hookControl.targets,
      hookControl.projector,
    );
  }
  for (const item of catalog.unavailableMcp) {
    const { description, server: disclosure, ...declaration } = item;
    const id = String(item.id);
    add(
      `aih/${id}`,
      "mcp",
      id,
      `core-request/${id}`,
      declaration,
      [],
      undefined,
      mcpDecision(server(disclosure, `AIH MCP ${id}`), optionalText(description, id)),
      `mcp:${String(item.configuredIdentity)}`,
    );
  }
  for (const item of catalog.nonProjectableMcp) {
    const id = String(item.id);
    if (declarations.some((entry) => entry.declaration.id === `aih/${id}`)) continue;
    const { description, server: disclosure, ...declaration } = item;
    add(
      `aih/${id}`,
      "mcp",
      id,
      `core-request/${id}`,
      declaration,
      [],
      undefined,
      mcpDecision(server(disclosure, `AIH MCP ${id}`), optionalText(description, id)),
      `mcp:${id}`,
    );
  }
  for (const [kind, packs] of [
    ["skill", catalog.aihSkills],
    ["agent", catalog.aihAgents],
  ] as const)
    for (const pack of packs) {
      const { purpose, ...declaration } = pack;
      add(
        `aih/${pack.id}`,
        kind,
        pack.id,
        pack.sources[0]?.path ?? `packs/${pack.pack}`,
        declaration,
        [],
        undefined,
        purpose === undefined ? undefined : { purpose },
      );
    }
  return {
    source: {
      id: sourceId,
      revisionId,
      contentDigest: digest(sourceManifest),
      locator: catalog.aihCapabilityPackage.name,
    },
    declarations,
    coreCapabilities,
    detailBytes,
  };
}
