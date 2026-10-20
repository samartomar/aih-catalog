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
  generateItem,
  sha256Hex,
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
} from "./contracts.js";
import {
  checkDependencies,
  checkInputs,
  Diagnostics,
  isRecord,
  safeMemberPath,
} from "./document.js";
import { canonicalJson, deepFreeze } from "./json.js";
import { readRelease } from "./reader.js";
import { checkRecipeAgreement } from "./recipe-agreement.js";
import { extractSourceFacts, type SourceDiscovery } from "./source-facts.js";

export const PRODUCER_DECLARATION_SCHEMA_ID =
  "urn:aihq:catalog:producer-declaration:3.0.0" as const;
export const PRODUCER_DECLARATION_SCHEMA_ID_3_1 =
  "urn:aihq:catalog:producer-declaration:3.1.0" as const;
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
    | typeof PRODUCER_DECLARATION_SCHEMA_ID_3_1;
  readonly format: "aihq-catalog-producer-declaration";
  readonly version: 3;
  readonly sources: readonly ProducerSource[];
  readonly items: readonly ProducerItem[];
  readonly authored?: readonly AuthoredAllowance[];
  /** Independent producer identity; defaults to supplied-catalog@0.0.0, never AIHQ curation. */
  readonly package?: { readonly name: string; readonly version: string };
}
export interface SuppliedSourceFiles {
  readonly source: string;
  /** Caller-declared immutable revision (40-character Git pin or 64-character local snapshot hash). */
  readonly revision: string;
  readonly files: Readonly<Record<string, Uint8Array>>;
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
    copy.schema !== PRODUCER_DECLARATION_SCHEMA_ID_3_1
  )
    return deepFreeze({
      status: "refused",
      diagnostics: [
        {
          code: "SCHEMA_UNSUPPORTED",
          path: "/schema",
          message:
            "Only producer-declaration:3.0.0 and 3.1.0 are supported; preserve the original and explicitly migrate older declarations.",
        },
      ],
    });
  const validator =
    isRecord(copy) && copy.schema === PRODUCER_DECLARATION_SCHEMA_ID_3_1 ? validateLocal : validate;
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
      !exactFields(input, ["source", "revision", "files"]) ||
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
        ...(sourceFacts ? { sourceFacts: sourceFacts as unknown as Json } : {}),
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
  const schema = declaration.sources.some((source) => "origin" in source)
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
  const read = readRelease(bytes, { expectedSha256: releaseSha256 });
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
        members: item.materials.map((member) => ({
          ...member,
          bytes: Buffer.from(outputs.get(member.path)?.bytes ?? []),
        })),
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
    const read = readRelease(releaseBytes, { expectedSha256: releaseSha256 });
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
