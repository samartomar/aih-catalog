/** Public supplied-byte producer. No acquisition, writes, execution or installation. */
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AuthoredAllowance } from "../producer/authored.js";
import { parseBaseRelease } from "../producer/base.js";
import { buildCandidate, type CandidateReport } from "../producer/candidate.js";
import {
  type DeclaredItem,
  type DeclaredSource,
  parseDeclaration,
} from "../producer/declaration.js";
import { ProducerRefusal } from "../producer/errors.js";
import {
  documentBytes,
  type GeneratedItem,
  type GeneratedMember,
  generateItem,
  sha256Hex,
  supportMaterialId,
} from "../producer/generate.js";
import { pluginSkillPaths } from "../producer/plugin.js";
import { generateTemplateItem } from "../producer/template.js";
import { COMMIT, readPresent, type SourceTree } from "../producer/tree.js";
import { copyJson, dataArray, dataRecord, exactFields, pointer } from "./boundary.js";
import type {
  AuthoringResult,
  CatalogDiagnostic,
  CatalogItem,
  CatalogRelease,
  DependencyRef,
  InputSpec,
  Json,
  NameBasis,
} from "./contracts.js";
import {
  bytewiseCompare,
  checkDependencies,
  checkInputs,
  Diagnostics,
  isRecord,
  memberPackagePath,
  safeMemberPath,
} from "./document.js";
import { canonicalJson, deepFreeze } from "./json.js";
import { readRelease, readReleaseContent } from "./reader.js";
import { checkRecipeAgreement } from "./recipe-agreement.js";
import { extractSourceFacts, type SourceDiscovery } from "./source-facts.js";
import { isSpdxLicenseId } from "./spdx.js";

export const PRODUCER_DECLARATION_SCHEMA_ID =
  "urn:aihq:catalog:producer-declaration:3.0.0" as const;
export const PRODUCER_DECLARATION_SCHEMA_ID_3_1 =
  "urn:aihq:catalog:producer-declaration:3.1.0" as const;
/** Declaration 3.2 writes release 1.6 behaviour files, identities, payloads and provenance. */
export const PRODUCER_DECLARATION_SCHEMA_ID_3_2 =
  "urn:aihq:catalog:producer-declaration:3.2.0" as const;
/** Local identity is a source ID, never a host path or a fabricated repository. */
export type ProducerSource =
  | DeclaredSource
  | {
      readonly id: string;
      readonly origin: { readonly kind: "local" };
      readonly licensePath: string;
      readonly license: string;
      readonly pluginManifestPath?: string;
    };
export interface Discovery {
  readonly label: string;
  readonly description: string;
  readonly sourceDiscovery?: SourceDiscovery;
  readonly kind: string;
  readonly clientCapabilities: readonly {
    readonly client: string;
    readonly surface: string;
    readonly capability: string;
    readonly support: "supported" | "unsupported" | "unknown";
    readonly reason?: string;
  }[];
  readonly activation: readonly {
    readonly client: string;
    readonly surface: string;
    readonly instructions: string;
  }[];
  readonly configuration: Readonly<
    Record<string, InputSpec & { readonly label?: string; readonly help?: string }>
  >;
}
export type ProducerItem = Discovery & {
  readonly id: string;
  readonly source: string;
  readonly requires: readonly DependencyRef[];
  readonly optional: readonly DependencyRef[];
  readonly conflicts: readonly DependencyRef[];
  /** Release 1.6 typed payload; derived for skill and files kinds when absent. */
  readonly payload?: Json;
  /** Release 1.6 server-introduced inputs (MCP environment values). */
  readonly requirements?: { readonly inputs?: Readonly<Record<string, InputSpec>> };
  /** Release 1.6 true provenance; source defaults to the declared source repository. */
  readonly provenance?: {
    readonly source?: string;
    readonly selectedBy?: string;
    readonly derivedFrom?: readonly {
      readonly itemId: string;
      readonly releaseSha256?: string;
      readonly status: "verified" | "declared";
      readonly proof?: {
        readonly materials: readonly { readonly relPath: string; readonly sha256: string }[];
      };
    }[];
  };
  /** Release 1.6 display name and its recorded basis. */
  readonly name?: string;
  readonly nameBasis?: "authored" | "first-heading" | "key" | "file-name" | "publisher";
} & (
    | {
        readonly recipePath: string;
        readonly materials: readonly { readonly id: string; readonly path: string }[];
      }
    | { readonly skillPath: string; readonly supportPaths?: readonly string[] }
  );
export interface ProducerDeclaration {
  readonly schema:
    | typeof PRODUCER_DECLARATION_SCHEMA_ID
    | typeof PRODUCER_DECLARATION_SCHEMA_ID_3_1
    | typeof PRODUCER_DECLARATION_SCHEMA_ID_3_2;
  readonly format: "aihq-catalog-producer-declaration";
  readonly version: 3;
  readonly sources: readonly ProducerSource[];
  readonly items: readonly ProducerItem[];
  readonly authored?: readonly AuthoredAllowance[];
  /** Release 1.6 published framework identity; required by declaration 3.2. */
  readonly framework?: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description: string;
  };
  /** Independent producer identity; defaults to supplied-catalog@0.0.0, never AIHQ curation. */
  readonly package?: { readonly name: string; readonly version: string };
}
export interface SuppliedSourceFiles {
  readonly source: string;
  /** Caller-declared immutable revision (40-character Git pin or 64-character local snapshot hash). */
  readonly revision: string;
  readonly files: Readonly<Record<string, Uint8Array>>;
  /**
   * Optional verified regular-file modes (0o644 or 0o755) keyed by source-relative
   * path. Release 1.6 executable states are read from these modes at preparation,
   * before the inventory is frozen; absent modes freeze as "unknown", never guessed.
   */
  readonly modes?: Readonly<Record<string, number>>;
}
export interface CompiledProducerDeclaration {
  readonly release: CatalogRelease;
  readonly releaseBytes: Uint8Array;
  readonly releaseSha256: string;
  /** Recipes and source material, ready for caller-owned staging. */
  readonly materials: readonly {
    readonly path: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
    readonly byteLength: number;
  }[];
}
const schemaRoot = new URL("../../schemas/", import.meta.url);
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(JSON.parse(readFileSync(new URL("release/1.2.0.json", schemaRoot), "utf8")));
const validate = ajv.compile(
  JSON.parse(readFileSync(new URL("producer-declaration/3.0.0.json", schemaRoot), "utf8")),
);
const validateLocal = ajv.compile(
  JSON.parse(readFileSync(new URL("producer-declaration/3.1.0.json", schemaRoot), "utf8")),
);
const validate16 = ajv.compile(
  JSON.parse(readFileSync(new URL("producer-declaration/3.2.0.json", schemaRoot), "utf8")),
);
const failure = (path: string, message: string): AuthoringResult<never> => ({
  status: "refused",
  diagnostics: [{ code: "INPUT_INVALID", path, message }],
});

function donorProjection(declaration: ProducerDeclaration) {
  // Donor repository keys only validate item/license semantics. Reserve a
  // disjoint adapter namespace so a real Git owner named local cannot collide.
  const repositories = new Set(
    declaration.sources.flatMap((source) =>
      "repository" in source ? [source.repository.toLowerCase()] : [],
    ),
  );
  let namespace = "local";
  let collision = 0;
  while (
    declaration.sources.some(
      (source) => "origin" in source && repositories.has(`${namespace}/${source.id}`.toLowerCase()),
    )
  ) {
    namespace = `local-${++collision}`;
  }
  return {
    format: declaration.format,
    version: 2,
    // Adapter keys never become output provenance or local material addresses.
    sources: declaration.sources.map((source) =>
      "repository" in source
        ? source
        : {
            id: source.id,
            repository: `${namespace}/${source.id}`,
            licensePath: source.licensePath,
            license: source.license,
            ...(source.pluginManifestPath ? { pluginManifestPath: source.pluginManifestPath } : {}),
          },
    ),
    ...(declaration.authored ? { authored: declaration.authored } : {}),
    items: declaration.items.map((item) => ({
      id: item.id,
      source: item.source,
      label: item.label,
      ...("recipePath" in item
        ? { kind: item.kind, recipePath: item.recipePath, materials: item.materials }
        : {
            skillPath: item.skillPath,
            ...(item.supportPaths ? { supportPaths: item.supportPaths } : {}),
          }),
      requires: item.requires.filter((ref) => !("release" in ref)).map((ref) => ref.itemId),
    })),
  };
}

/** V2 is deliberately refused; migration requires the author's explicit discovery facts. */
export function checkProducerDeclaration(value: unknown): AuthoringResult<ProducerDeclaration> {
  let copy: unknown;
  try {
    copy = copyJson(value);
  } catch {
    return failure("", "Declaration must be bounded plain JSON data.");
  }
  if (
    isRecord(copy) &&
    copy.schema !== PRODUCER_DECLARATION_SCHEMA_ID &&
    copy.schema !== PRODUCER_DECLARATION_SCHEMA_ID_3_1 &&
    copy.schema !== PRODUCER_DECLARATION_SCHEMA_ID_3_2
  )
    return deepFreeze({
      status: "refused",
      diagnostics: [
        {
          code: "SCHEMA_UNSUPPORTED",
          path: "/schema",
          message:
            "Only producer-declaration:3.0.0, 3.1.0 and 3.2.0 are supported; preserve the original and explicitly migrate older declarations.",
        },
      ],
    });
  const validator =
    isRecord(copy) && copy.schema === PRODUCER_DECLARATION_SCHEMA_ID_3_1
      ? validateLocal
      : isRecord(copy) && copy.schema === PRODUCER_DECLARATION_SCHEMA_ID_3_2
        ? validate16
        : validate;
  if (!validator(copy))
    return deepFreeze({
      status: "refused",
      diagnostics: (validator.errors ?? []).slice(0, 256).map((error) => ({
        code: "INPUT_INVALID",
        path: `${error.instancePath}${error.keyword === "required" ? `/${pointer(String(error.params.missingProperty))}` : error.keyword === "additionalProperties" ? `/${pointer(String(error.params.additionalProperty))}` : ""}`,
        message: `Declaration ${error.message ?? "is invalid"}.`,
      })),
    });
  const declaration = copy as ProducerDeclaration;
  for (const [index, source] of declaration.sources.entries()) {
    if (!isSpdxLicenseId(source.license)) {
      return failure(
        `/sources/${index}/license`,
        "Expected an SPDX licence identifier or expression from the embedded SPDX License List.",
      );
    }
  }
  const diagnostics = new Diagnostics();
  for (const [index, item] of declaration.items.entries()) {
    checkInputs(
      diagnostics,
      Object.fromEntries(
        Object.entries(item.configuration).map(
          ([name, { label: _label, help: _help, ...spec }]) => [name, spec],
        ),
      ),
      `/items/${index}/configuration`,
    );
    checkDependencies(
      diagnostics,
      { requires: item.requires, optional: item.optional, conflicts: item.conflicts },
      `/items/${index}`,
    );
    for (const list of ["requires", "optional", "conflicts"] as const) {
      const seen = new Set<string>();
      item[list].forEach((ref, position) => {
        const at = `/items/${index}/${list}/${position}`;
        const identity = canonicalJson(ref);
        if (seen.has(identity))
          diagnostics.add("duplicate-reference", at, "Duplicate declared relationship.");
        seen.add(identity);
        if (
          !("release" in ref) &&
          (!declaration.items.some((candidate) => candidate.id === ref.itemId) ||
            ref.itemId === item.id)
        )
          diagnostics.add(
            "unknown-item",
            at,
            "Relationship must name another declared same-release item.",
          );
      });
    }
  }
  if (diagnostics.list.length)
    return deepFreeze({
      status: "refused",
      diagnostics: [
        {
          code: "INPUT_INVALID",
          path: "/items",
          message: "Invalid declared relationships.",
          details: { owner: "catalog", diagnostics: diagnostics.list },
        },
      ],
    });
  try {
    parseDeclaration(donorProjection(declaration));
  } catch (error) {
    return failure(
      "",
      error instanceof ProducerRefusal ? error.message : "Declaration is invalid.",
    );
  }
  return deepFreeze({ status: "ok", value: declaration, diagnostics: [] });
}

/**
 * Release 1.6 projection for one compiled item: extended materials with measured
 * sizes and executable states, the synthesised behaviour file and both identities.
 * `addresses` maps every generated member id to its upstream source path and the
 * item-relative path. Returns a refusal or undefined on success (record mutated).
 */
function projectItemTo16(args: {
  output: GeneratedItem;
  item: ProducerItem;
  source: ProducerSource;
  tree: SourceTree;
  entry?: string;
  /** The display values and their recorded fallback bases, when publishable. */
  display: {
    readonly name?: { readonly value: string; readonly basis: NameBasis };
    readonly description?: { readonly value: string; readonly basis: NameBasis };
  };
  frameworkId: string;
  addresses: ReadonlyMap<string, { readonly sourcePath: string; readonly relPath: string }>;
}): AuthoringResult<never> | undefined {
  const { output, item, source, tree, addresses } = args;
  const record = output.record;
  const id = String(record.id);
  const fail = (path: string, message: string): AuthoringResult<never> => ({
    status: "refused",
    diagnostics: [{ code: "INPUT_INVALID", path, message }],
  });
  const relPaths = new Set<string>();
  const contentMembers = output.members.map((member) => {
    const address = addresses.get(member.id);
    if (address === undefined) {
      throw new ProducerRefusal(
        `member-address-missing`,
        `${id}: no source address for material ${member.id}`,
      );
    }
    if (relPaths.has(address.relPath)) {
      throw new ProducerRefusal(
        "duplicate-rel-path",
        `${id}: two materials share the item-relative path ${address.relPath}`,
      );
    }
    relPaths.add(address.relPath);
    const mode = tree.mode?.(address.sourcePath);
    const executable: boolean | "unknown" = mode === undefined ? "unknown" : (mode & 0o111) !== 0;
    return {
      member,
      address,
      executable,
      extended: {
        id: member.id,
        relPath: address.relPath,
        sourcePath: address.sourcePath,
        packagePath: member.path,
        sha256: member.sha256,
        byteLength: member.byteLength,
        executable,
        sourceId: args.source.id,
        role: "content",
        size: measureMaterial(member.bytes),
      } as Json,
    };
  });
  const derivedExecutable: Record<string, true | false | "unknown"> = {};
  for (const { extended, executable } of contentMembers) {
    derivedExecutable[String((extended as Record<string, Json>).relPath)] = executable;
  }
  const contentIds = contentMembers.map(({ member }) => member.id);
  const payload =
    item.payload !== undefined
      ? item.payload
      : record.kind === "skill"
        ? {
            dirName: args.entry ?? id,
            invocation: "user-only",
            invocationBasis: "producer default: a skill runs only when invoked",
          }
        : record.kind === "agent" || record.kind === "command" || record.kind === "document"
          ? { files: contentIds }
          : undefined;
  if (payload === undefined) {
    return fail(
      `/declaration/items/${id}/payload`,
      `Declaration 3.2.0 item ${id} of kind ${String(record.kind)} declares no payload; rule, hook and mcp-server payloads cannot be derived.`,
    );
  }
  const requirements = { inputs: (item.requirements?.inputs ?? {}) as unknown as Json };
  const behaviourValue = {
    kind: record.kind,
    payload,
    requirements,
    dependencies: record.dependencies,
    executable: derivedExecutable,
  };
  const behaviourBytes = documentBytes(behaviourValue);
  const behaviourMember = {
    id: "behaviour",
    relPath: BEHAVIOUR_REL_PATH,
    sourcePath: null,
    packagePath: `${itemPackageFolder16(id)}/${BEHAVIOUR_REL_PATH}`,
    sha256: sha256Hex(behaviourBytes),
    byteLength: behaviourBytes.length,
    executable: false,
    sourceId: args.frameworkId,
    role: "behaviour",
    size: measureMaterial(behaviourBytes),
  } as unknown as Json;
  const lines = (members: readonly Json[]) =>
    members
      .map((member) => {
        const value = member as Record<string, Json>;
        return `${String(value.relPath)}\t${String(value.sha256)}\n`;
      })
      .sort(bytewiseCompare);
  const byMemberId = (a: Json, b: Json): number => {
    const left = String((a as Record<string, Json>).id);
    const right = String((b as Record<string, Json>).id);
    return left < right ? -1 : left > right ? 1 : 0;
  };
  const extendedMaterials = [
    ...contentMembers.map(({ extended }) => extended),
    behaviourMember,
  ].sort(byMemberId);
  record.materials = extendedMaterials;
  record.payload = payload;
  record.requirements = requirements;
  record.executable = derivedExecutable;
  record.contentSha256 = sha256Hex(
    Buffer.from(lines(contentMembers.map(({ extended }) => extended)).join(""), "utf8"),
  );
  record.behaviourSha256 = sha256Hex(Buffer.from(lines(extendedMaterials).join(""), "utf8"));
  const provenance = item.provenance;
  const sourceIdentity =
    provenance?.source ??
    ("repository" in source ? `https://github.com/${source.repository}` : source.id);
  record.source = sourceIdentity;
  if (provenance?.selectedBy !== undefined) record.selectedBy = provenance.selectedBy;
  if (provenance?.derivedFrom !== undefined) {
    record.derivedFrom = provenance.derivedFrom as unknown as Json;
  }
  if (args.display.name !== undefined) {
    record.name = args.display.name.value;
    record.nameBasis = args.display.name.basis;
  }
  if (args.display.description !== undefined) {
    record.descriptionBasis = args.display.description.basis;
  }
  record.size = { parts: partSizes(record, contentMembers), status: "measured" };
  (output.members as GeneratedMember[]).push({
    id: "behaviour",
    path: String((behaviourMember as Record<string, Json>).packagePath),
    sha256: String((behaviourMember as Record<string, Json>).sha256),
    byteLength: behaviourBytes.length,
    bytes: behaviourBytes,
  });
  return undefined;
}

const BEHAVIOUR_REL_PATH = "aih-behaviour.json";
const itemPackageFolder16 = (itemId: string): string => `release/items/${itemId}`;

const utf8Lossy = new TextDecoder("utf-8");

function measureMaterial(bytes: Uint8Array): Json {
  return { bytes: bytes.length, chars: utf8Lossy.decode(bytes).length, status: "measured" };
}

function partSizes(
  record: Record<string, Json>,
  contentMembers: readonly { member: { id: string; bytes: Uint8Array }; extended: Json }[],
): Json {
  const label = typeof record.label === "string" ? record.label : "";
  const displayName = typeof record.name === "string" ? record.name : label;
  const parts: Json[] = [
    { part: "name", bytes: Buffer.byteLength(displayName, "utf8"), chars: displayName.length },
  ];
  if (typeof record.description === "string") {
    parts.push({
      part: "description",
      bytes: Buffer.byteLength(record.description, "utf8"),
      chars: record.description.length,
    });
  }
  const skill = contentMembers.find(({ member }) => member.id === "skill");
  if (skill !== undefined) {
    const text = utf8Lossy.decode(skill.member.bytes);
    const split = /^---\n([\s\S]*?)\n---\n?/u.exec(text);
    const frontmatter = split?.[1] ?? "";
    const body = split === null ? text : text.slice(split[0].length);
    parts.push({
      part: "frontmatter",
      bytes: Buffer.byteLength(frontmatter, "utf8"),
      chars: frontmatter.length,
    });
    parts.push({ part: "body", bytes: Buffer.byteLength(body, "utf8"), chars: body.length });
  }
  const carried = contentMembers.filter(({ member }) => member.id !== "skill");
  const fileBytes = carried.reduce((total, { member }) => total + member.bytes.length, 0);
  const fileChars = carried.reduce(
    (total, { member }) => total + utf8Lossy.decode(member.bytes).length,
    0,
  );
  parts.push({ part: "files", bytes: fileBytes, chars: fileChars });
  return parts;
}

export function compileProducerDeclaration(request: {
  readonly declaration: unknown;
  readonly sourceFiles: readonly SuppliedSourceFiles[];
}): AuthoringResult<CompiledProducerDeclaration> {
  try {
    const top = dataRecord(request);
    const snapshots = dataArray(top.sourceFiles);
    if (snapshots.length > 4096) throw new TypeError("Source count bound");
    const sourceFiles = snapshots.map((value) => {
      const snapshot = dataRecord(value);
      return { ...snapshot, files: dataRecord(snapshot.files) };
    });
    request = { ...top, sourceFiles } as unknown as typeof request;
  } catch {
    return failure(
      "/sourceFiles",
      "Expected plain byte-bearing snapshot envelopes and own data entries.",
    );
  }
  if (
    !exactFields(request, ["declaration", "sourceFiles"]) ||
    Object.values(Object.getOwnPropertyDescriptors(request)).some((d) => !("value" in d))
  )
    return failure("", "Expected own declaration and sourceFiles data fields.");
  const checked = checkProducerDeclaration(request.declaration);
  if (checked.status !== "ok") return checked;
  const declaration = checked.value;
  if (!Array.isArray(request.sourceFiles))
    return failure("/sourceFiles", "Expected supplied source snapshots.");
  const trees = new Map<string, SourceTree>();
  let total = 0;
  for (const [index, input] of request.sourceFiles.entries()) {
    const at = `/sourceFiles/${index}`;
    if (
      (!exactFields(input, ["source", "revision", "files"]) &&
        !exactFields(input, ["source", "revision", "files", "modes"])) ||
      Object.values(Object.getOwnPropertyDescriptors(input)).some((d) => !("value" in d)) ||
      typeof input.source !== "string" ||
      typeof input.revision !== "string" ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(input.revision) ||
      !isRecord(input.files)
    )
      return failure(
        at,
        "Expected source ID, lowercase 40-character Git pin or 64-character snapshot hash, and regular-file byte map.",
      );
    if (input.modes !== undefined) {
      if (!isRecord(input.modes)) return failure(`${at}/modes`, "Expected a path mode map.");
      for (const [path, mode] of Object.entries(input.modes)) {
        if (!safeMemberPath(path) || (mode !== 0o644 && mode !== 0o755)) {
          return failure(
            `${at}/modes`,
            "Expected verified regular-file modes 0o644 or 0o755 keyed by source-relative path.",
          );
        }
      }
    }
    const source = declaration.sources.find((source) => source.id === input.source);
    if (!source || trees.has(input.source))
      return failure(`${at}/source`, "Supplied source must be declared exactly once.");
    if ("repository" in source && !COMMIT.test(input.revision))
      return failure(
        `${at}/revision`,
        "Git sources require a full lowercase 40-character Git pin.",
      );
    const files = new Map<string, Uint8Array>();
    const folded = new Set<string>();
    for (const name of Reflect.ownKeys(input.files)) {
      const descriptor = Object.getOwnPropertyDescriptor(input.files, name);
      if (
        typeof name !== "string" ||
        !safeMemberPath(name) ||
        !descriptor ||
        !("value" in descriptor) ||
        !(descriptor.value instanceof Uint8Array) ||
        folded.has(name.toLowerCase()) ||
        descriptor.value.byteLength > 16 * 1024 * 1024
      )
        return failure(
          `${at}/files`,
          "Expected safe unique regular-file paths with bounded Uint8Array bytes.",
        );
      total += descriptor.value.byteLength;
      if (total > 256 * 1024 * 1024 || files.size >= 65_536)
        return failure(at, "Supplied snapshots exceed their byte/file bounds.");
      folded.add(name.toLowerCase());
      files.set(name, new Uint8Array(descriptor.value));
    }
    trees.set(input.source, {
      repository: "repository" in source ? source.repository : source.id,
      commit: input.revision,
      inventory: {
        complete: true,
        paths: new Set(files.keys()),
        irregular: new Set(),
        opaquePrefixes: [],
      },
      mode: (path) => (input.modes as Readonly<Record<string, number>> | undefined)?.[path],
      read: (path) => {
        const bytes = files.get(path);
        if (!bytes) throw new TypeError("missing supplied bytes");
        return bytes;
      },
    });
  }
  for (const source of declaration.sources)
    if (!trees.has(source.id))
      return failure("/sourceFiles", `Missing source snapshot ${source.id}.`);
  // Notices at the exact pinned snapshot must ship with the pins actually used:
  // refuse any discovered NOTICE file that no declared item carries.
  for (const source of declaration.sources) {
    const tree = trees.get(source.id) as SourceTree;
    const carried = new Set<string>();
    for (const item of declaration.items) {
      if (item.source !== source.id) continue;
      if ("recipePath" in item) {
        for (const member of item.materials) carried.add(member.path);
      } else {
        carried.add(item.skillPath);
        carried.add(source.licensePath);
        const directory = item.skillPath.split("/").slice(0, -1).join("/");
        for (const supportPath of item.supportPaths ?? []) {
          carried.add(directory === "" ? supportPath : `${directory}/${supportPath}`);
        }
      }
    }
    for (const path of tree.inventory.paths) {
      if (!/^NOTICE(?:\.md|\.txt)?$/i.test(path.split("/").pop() ?? "")) continue;
      if (!carried.has(path)) {
        return failure(
          "/declaration/sources",
          `Source ${source.id} pins ${path} at revision ${tree.commit} and no declared item carries it; carry the pinned notice or remove it from the snapshot.`,
        );
      }
    }
  }
  const donor = parseDeclaration(donorProjection(declaration));
  // Large inventories retain full descriptive byte provenance once, rather than
  // multiplying it by every item. Small declarations keep their existing bytes.
  const sourceInventories = new Map(
    declaration.sources.map((source) => {
      const tree = trees.get(source.id) as SourceTree;
      const inventory = {
        source: source.id,
        revision: tree.commit,
        files: [...tree.inventory.paths].sort().map((path) => ({
          path,
          sha256: sha256Hex(tree.read(path)),
          byteLength: tree.read(path).byteLength,
        })),
      };
      return [source.id, inventory] as const;
    }),
  );
  const sharedInventories = new Map(
    [...sourceInventories].filter(
      ([id, inventory]) =>
        documentBytes(inventory).byteLength *
          declaration.items.filter((item) => item.source === id).length >
        8 * 1024 * 1024,
    ),
  );
  const generated: GeneratedItem[] = [];
  let generationPath = "/sourceFiles";
  const schema16 = declaration.schema === PRODUCER_DECLARATION_SCHEMA_ID_3_2;
  if (schema16 && declaration.framework === undefined) {
    return failure("/framework", "Declaration 3.2.0 publishes the release 1.6 framework identity.");
  }
  try {
    for (const source of declaration.sources) {
      const tree = trees.get(source.id) as SourceTree;
      const mine = donor.items.filter((item) => item.source === source.id);
      const listed = pluginSkillPaths(
        tree,
        donor.sources.find((entry) => entry.id === source.id) as DeclaredSource,
        mine,
      );
      if (listed && mine.some((item) => "skillPath" in item && !listed.has(item.skillPath)))
        return failure(
          "/declaration/items",
          "Declared skill is absent from the source's explicit plugin roster.",
        );
    }
    for (const [index, item] of declaration.items.entries()) {
      generationPath = `/declaration/items/${index}/${"recipePath" in item ? "recipePath" : "skillPath"}`;
      const source = declaration.sources.find(
        (source) => source.id === item.source,
      ) as ProducerSource;
      const tree = trees.get(item.source) as SourceTree;
      const donorItem = donor.items.find((candidate) => candidate.id === item.id) as DeclaredItem;
      const donorSource = donor.sources.find((entry) => entry.id === source.id) as DeclaredSource;
      const localAddress =
        "origin" in source
          ? {
              memberPath: (path: string) =>
                `release/materials/local/${source.id}/${tree.commit}/${path}`,
              sourceLabel: `local source ${source.id}`,
            }
          : {};
      const sourcePaths =
        "recipePath" in donorItem
          ? donorItem.materials.map((material) => material.path)
          : [
              donorItem.skillPath,
              source.licensePath,
              ...donorItem.supportPaths.map((path) => `${donorItem.directory}/${path}`),
            ];
      if (item.sourceDiscovery && !sourcePaths.includes(item.sourceDiscovery.path))
        return failure(
          `/items/${index}/sourceDiscovery`,
          "Source discovery must refer to the exact delivered source-relative material path.",
        );
      const sourceFacts = item.sourceDiscovery
        ? extractSourceFacts({
            ...item.sourceDiscovery,
            bytes: readPresent(tree, item.sourceDiscovery.path),
            revision: tree.commit,
          })
        : undefined;
      const output =
        "recipePath" in donorItem
          ? generateTemplateItem({
              item: donorItem,
              source: donorSource,
              sourceId: source.id,
              tree,
              ...localAddress,
            })
          : generateItem({
              item: donorItem,
              source: donorSource,
              ...localAddress,
              sourceId: source.id,
              revision: tree.commit,
              ...(sourceFacts
                ? {
                    description:
                      sourceFacts.description.state === "authored"
                        ? sourceFacts.description.value
                        : "",
                  }
                : {}),
              skill: Buffer.from(readPresent(tree, donorItem.skillPath)),
              license: Buffer.from(readPresent(tree, source.licensePath)),
              supportFiles: donorItem.supportPaths.map((path) => ({
                path,
                bytes: Buffer.from(readPresent(tree, `${donorItem.directory}/${path}`)),
              })),
            });
      const inputs = Object.fromEntries(
        Object.entries(item.configuration).map(
          ([name, { label: _label, help: _help, ...spec }]) => [name, spec],
        ),
      );
      if (canonicalJson(inputs) !== canonicalJson(output.record.inputs))
        return failure(
          `/items/${index}/configuration`,
          "Declared configuration must mirror the recipe's existing input specs; labels/help are display-only.",
        );
      // The published display name follows the ordered fallback (authored, first
      // heading, key or file name, publisher overlay) and records its basis. The
      // file-name level uses the basename; a full path is never published as a name.
      // The legacy label and description behavior stays byte-stable for existing content.
      const identifierBasis: NameBasis =
        item.sourceDiscovery?.key !== undefined ? "key" : "file-name";
      const identifierName =
        sourceFacts === undefined
          ? undefined
          : identifierBasis === "key"
            ? sourceFacts.identifier
            : (sourceFacts.identifier.split("/").pop() ?? sourceFacts.identifier);
      const nameBasis: NameBasis | undefined =
        item.name !== undefined
          ? (item.nameBasis ?? "publisher")
          : sourceFacts?.name.state === "authored"
            ? sourceFacts.name.basis
            : sourceFacts
              ? identifierBasis
              : undefined;
      const displayName =
        item.name ??
        (sourceFacts?.name.state === "authored"
          ? sourceFacts.name.value
          : nameBasis === "key"
            ? (sourceFacts?.identifier ?? item.id)
            : nameBasis === "file-name"
              ? identifierName !== undefined && identifierName.length <= 256
                ? identifierName
                : item.id
              : item.label);
      const descriptionBasis: NameBasis | undefined =
        sourceFacts?.description.state === "authored"
          ? sourceFacts.description.basis
          : sourceFacts === undefined && item.description
            ? "publisher"
            : undefined;
      output.record.label = sourceFacts
        ? sourceFacts.name.state === "authored"
          ? sourceFacts.name.value
          : sourceFacts.identifier.length <= 256
            ? sourceFacts.identifier
            : item.id
        : item.label;
      output.record.description = sourceFacts
        ? sourceFacts.description.state === "authored"
          ? sourceFacts.description.value
          : ""
        : item.description;
      output.record.kind = item.kind;
      output.record.dependencies = {
        requires: item.requires as unknown as Json,
        optional: item.optional as unknown as Json,
        conflicts: item.conflicts as unknown as Json,
      };
      output.record.metadata = {
        suppliedDeclaration: {
          schema: declaration.schema,
          sha256: sha256Hex(documentBytes(declaration)),
        },
        ...(output.record.metadata as Record<string, Json>),
        ...(sourceFacts
          ? {
              // The basis discriminator is producer machinery; stored source facts
              // keep the original source shape for byte-stable releases.
              sourceFacts: {
                ...sourceFacts,
                name:
                  sourceFacts.name.state === "authored"
                    ? (({ basis: _nameBasis, ...rest }) => rest)(sourceFacts.name)
                    : sourceFacts.name,
                description:
                  sourceFacts.description.state === "authored"
                    ? (({ basis: _descriptionBasis, ...rest }) => rest)(sourceFacts.description)
                    : sourceFacts.description,
              } as unknown as Json,
            }
          : {}),
        discovery: {
          label: output.record.label,
          description: output.record.description,
          kind: item.kind,
          clientCapabilities: item.clientCapabilities as unknown as Json,
          activation: item.activation as unknown as Json,
          configuration: item.configuration as unknown as Json,
        },
        suppliedSource: sharedInventories.has(source.id)
          ? {
              source: source.id,
              revision: tree.commit,
              inventorySha256: sha256Hex(documentBytes(sourceInventories.get(source.id))),
            }
          : (sourceInventories.get(source.id) as unknown as Json),
      };
      const agreement = checkRecipeAgreement(
        output.record as unknown as CatalogItem,
        output.recipeBytes,
      );
      if (agreement.length)
        return deepFreeze({
          status: "refused",
          diagnostics: [
            {
              code: "INPUT_INVALID",
              path: `/items/${index}`,
              message: "Recipe agreement failed.",
              details: { owner: "catalog", diagnostics: agreement },
            },
          ],
        });
      if (schema16) {
        const addresses = new Map<string, { sourcePath: string; relPath: string }>();
        if ("recipePath" in donorItem) {
          for (const member of donorItem.materials) {
            addresses.set(member.id, { sourcePath: member.path, relPath: member.path });
          }
        } else {
          addresses.set("license", { sourcePath: source.licensePath, relPath: "LICENSE" });
          addresses.set("skill", { sourcePath: donorItem.skillPath, relPath: "SKILL.md" });
          for (const supportPath of donorItem.supportPaths) {
            addresses.set(supportMaterialId(supportPath), {
              sourcePath: `${donorItem.directory}/${supportPath}`,
              relPath: supportPath,
            });
          }
        }
        const projected = projectItemTo16({
          output,
          item,
          source,
          tree,
          ...("skillPath" in donorItem ? { entry: donorItem.entry } : {}),
          display: {
            name:
              nameBasis === undefined
                ? undefined
                : { value: String(displayName), basis: nameBasis },
            description:
              descriptionBasis === undefined
                ? undefined
                : { value: String(output.record.description), basis: descriptionBasis },
          },
          frameworkId: (declaration.framework as { id: string }).id,
          addresses,
        });
        if (projected) return projected;
      }
      generated.push(output);
    }
  } catch (error) {
    if (error instanceof ProducerRefusal && Array.isArray(error.details.diagnostics)) {
      return deepFreeze({
        status: "refused",
        diagnostics: [
          {
            code: "INPUT_INVALID",
            path: generationPath,
            message: "Supplied recipe was refused by its owning agreement check.",
            details: {
              owner: "catalog",
              diagnostics: error.details.diagnostics as CatalogDiagnostic[],
            },
          },
        ],
      });
    }
    return failure(
      generationPath,
      error instanceof ProducerRefusal
        ? error.message
        : "Required supplied source bytes are missing or invalid.",
    );
  }
  const schema = schema16
    ? "urn:aihq:catalog:release:1.6.0"
    : declaration.sources.some((source) => "origin" in source)
      ? "urn:aihq:catalog:release:1.3.0"
      : generated.some(
            (item) =>
              isRecord(item.record.recipe) &&
              item.record.recipe.schema === "urn:aihq:core:recipe:1.3.0",
          )
        ? "urn:aihq:catalog:release:1.2.0"
        : generated.some(
              (item) =>
                isRecord(item.record.recipe) &&
                item.record.recipe.schema === "urn:aihq:core:recipe:1.1.0",
            )
          ? "urn:aihq:catalog:release:1.1.0"
          : "urn:aihq:catalog:release:1.0.0";
  const bytes = documentBytes({
    schema,
    package: declaration.package ?? { name: "supplied-catalog", version: "0.0.0" },
    sources: declaration.sources
      .map((source) => ({
        id: source.id,
        ...(schema16 ? { license: source.license } : {}),
        origin:
          "repository" in source
            ? {
                kind: "git",
                repository: `https://github.com/${source.repository}`,
                revision: trees.get(source.id)?.commit,
              }
            : { kind: "local", revision: trees.get(source.id)?.commit },
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    ...(schema16 && declaration.framework !== undefined
      ? { framework: declaration.framework as Json }
      : {}),
    ...(sharedInventories.size === 0
      ? {}
      : {
          metadata: {
            suppliedSources: [...sharedInventories.values()].sort((a, b) =>
              a.source < b.source ? -1 : a.source > b.source ? 1 : 0,
            ),
          },
        }),
    items: generated
      .map((item) => item.record)
      .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)),
  });
  const releaseSha256 = sha256Hex(bytes);
  // Release 1.6 is compiled as pre-baseline content; release preparation binds
  // the assessment. The content admission is the owning reader at this stage.
  const read = schema16
    ? readReleaseContent(bytes, { expectedSha256: releaseSha256 })
    : readRelease(bytes, { expectedSha256: releaseSha256 });
  if (!read.valid)
    return deepFreeze({
      status: "refused",
      diagnostics: [
        {
          code: "INPUT_INVALID",
          path: "/declaration",
          message: "Compiled release failed its owning reader.",
          details: { owner: "catalog", diagnostics: read.diagnostics },
        },
      ],
    });
  const outputs = new Map<string, Uint8Array>();
  for (const item of generated) {
    outputs.set(item.recipePath, item.recipeBytes);
    for (const member of item.members) {
      const prior = outputs.get(member.path);
      if (prior && sha256Hex(prior) !== member.sha256)
        return failure("/sourceFiles", "Inconsistent output bytes at one material path.");
      outputs.set(member.path, member.bytes);
    }
  }
  return {
    status: "ok",
    diagnostics: [],
    value: {
      release: read.release,
      releaseBytes: new Uint8Array(bytes),
      releaseSha256,
      materials: [...outputs]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([path, bytes]) => ({
          path,
          bytes: new Uint8Array(bytes),
          sha256: sha256Hex(bytes),
          byteLength: bytes.byteLength,
        })),
    },
  };
}

/**
 * Refresh one explicitly acquired source through the existing delta builder.
 * The previous checked closure is retained for unchanged items; no installation,
 * acquisition, baseline qualification or release activation occurs here.
 */
export function prepareSourceRefresh(request: {
  readonly declaration: unknown;
  readonly source: string;
  readonly sourceFiles: readonly SuppliedSourceFiles[];
  /** Acquisition must explicitly attest complete enumeration; incomplete is never removal. */
  readonly inventoryComplete: boolean;
  readonly previous: {
    readonly releaseBytes: Uint8Array;
    readonly materials: readonly { readonly path: string; readonly bytes: Uint8Array }[];
  };
}): AuthoringResult<CompiledProducerDeclaration & { readonly report: CandidateReport }> {
  try {
    const top = dataRecord(request);
    const sourceFiles = dataArray(top.sourceFiles).map((value) => {
      const snapshot = dataRecord(value);
      return { ...snapshot, files: dataRecord(snapshot.files) };
    });
    return prepareSourceRefreshData({ ...top, sourceFiles } as unknown as Parameters<
      typeof prepareSourceRefreshData
    >[0]);
  } catch {
    return failure(
      "/refresh",
      "Expected bounded plain refresh data and a verified previous material closure.",
    );
  }
}

function prepareSourceRefreshData(request: {
  readonly declaration: unknown;
  readonly source: string;
  readonly inventoryComplete: boolean;
  readonly sourceFiles: readonly SuppliedSourceFiles[];
  readonly previous: {
    readonly releaseBytes: Uint8Array;
    readonly materials: readonly { readonly path: string; readonly bytes: Uint8Array }[];
  };
}): AuthoringResult<CompiledProducerDeclaration & { readonly report: CandidateReport }> {
  if (request.inventoryComplete !== true)
    return failure(
      "/inventoryComplete",
      "A complete acquired source inventory is required; incomplete is never removal.",
    );
  const checked = checkProducerDeclaration(request.declaration);
  if (checked.status !== "ok") return checked;
  const declaration = checked.value;
  const source = declaration.sources.find((source) => source.id === request.source);
  const snapshot = request.sourceFiles.find((files) => files.source === request.source);
  if (!source || !("repository" in source) || !snapshot)
    return failure(
      "/source",
      "Refresh requires one declared repository source and its acquired snapshot.",
    );
  // Only an explicitly declared primary source file absent from the complete
  // acquired snapshot is removal. Missing support/license bytes remain errors.
  const removed = new Set(
    declaration.items
      .filter(
        (item) =>
          item.source === source.id &&
          item.sourceDiscovery &&
          !Object.hasOwn(snapshot.files, item.sourceDiscovery.path),
      )
      .map((item) => item.id),
  );
  const retained = {
    ...declaration,
    items: declaration.items.filter((item) => !removed.has(item.id)),
  };
  const compiled = compileProducerDeclaration({
    declaration: retained,
    sourceFiles: request.sourceFiles,
  });
  if (compiled.status !== "ok") return compiled;
  try {
    const files = new Map(request.previous.materials.map((file) => [file.path, file.bytes]));
    files.set("release/release.json", request.previous.releaseBytes);
    const base = parseBaseRelease(files);
    const outputs = new Map(compiled.value.materials.map((file) => [file.path, file]));
    const templates = new Map<string, GeneratedItem>();
    for (const item of compiled.value.release.items) {
      const recipe = outputs.get(item.recipe.path);
      if (!recipe) throw new TypeError("Compiled recipe missing.");
      const { itemSha256: _itemSha256, ...record } = item;
      templates.set(item.id, {
        record: record as unknown as { [key: string]: Json },
        recipePath: item.recipe.path,
        recipeBytes: Buffer.from(recipe.bytes),
        members: item.materials.map(
          (member) =>
            ({
              ...member,
              path: String(memberPackagePath(member as unknown as Record<string, unknown>)),
              bytes: Buffer.from(
                outputs.get(String(memberPackagePath(member as unknown as Record<string, unknown>)))
                  ?.bytes ?? [],
              ),
            }) as unknown as GeneratedMember,
        ),
      });
    }
    const paths = new Set(Object.keys(snapshot.files));
    for (const item of declaration.items)
      if (removed.has(item.id) && "recipePath" in item) paths.delete(item.recipePath);
    const previousMetadata =
      base.metadata && typeof base.metadata === "object" && !Array.isArray(base.metadata)
        ? base.metadata
        : {};
    const nextMetadata = isRecord(compiled.value.release.metadata)
      ? compiled.value.release.metadata
      : {};
    const inventories = [
      ...(Array.isArray(previousMetadata.suppliedSources) ? previousMetadata.suppliedSources : []),
      ...(Array.isArray(nextMetadata.suppliedSources) ? nextMetadata.suppliedSources : []),
    ];
    const metadata = {
      ...previousMetadata,
      ...nextMetadata,
      ...(inventories.length
        ? {
            suppliedSources: [
              ...new Map(inventories.map((value) => [canonicalJson(value), value])).values(),
            ],
          }
        : {}),
    };
    const built = buildCandidate({
      declaration: parseDeclaration(donorProjection(declaration)),
      tree: {
        repository: source.repository,
        commit: snapshot.revision,
        inventory: { complete: true, paths, irregular: new Set(), opaquePrefixes: [] },
        read: (path) => {
          const bytes = snapshot.files[path];
          if (!bytes) throw new TypeError("Missing acquired source bytes.");
          return bytes;
        },
      },
      base,
      package: declaration.package ?? base.checked.package,
      templates,
      metadata,
    });
    const releaseBytes = built.files.get("release/release.json") as Buffer;
    const releaseSha256 = sha256Hex(releaseBytes);
    const read =
      declaration.schema === PRODUCER_DECLARATION_SCHEMA_ID_3_2
        ? readReleaseContent(releaseBytes, { expectedSha256: releaseSha256 })
        : readRelease(releaseBytes, { expectedSha256: releaseSha256 });
    if (!read.valid) return failure("/previous", "Refreshed release failed its public reader.");
    return {
      status: "ok",
      diagnostics: [],
      value: {
        release: read.release,
        releaseBytes: new Uint8Array(releaseBytes),
        releaseSha256,
        report: built.report,
        materials: [...built.files]
          .filter(([path]) => path !== "release/release.json")
          .map(([path, bytes]) => ({
            path,
            bytes: new Uint8Array(bytes),
            sha256: sha256Hex(bytes),
            byteLength: bytes.byteLength,
          })),
      },
    };
  } catch (error) {
    return failure(
      "/refresh",
      error instanceof ProducerRefusal
        ? `${error.message}: ${JSON.stringify(error.details)}`
        : error instanceof Error
          ? error.message
          : "Source refresh failed.",
    );
  }
}
