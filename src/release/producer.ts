/** Public supplied-byte producer. No acquisition, writes, execution or installation. */
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AuthoredAllowance } from "../producer/authored.js";
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

export const PRODUCER_DECLARATION_SCHEMA_ID =
  "urn:aihq:catalog:producer-declaration:3.0.0" as const;
export interface Discovery {
  readonly label: string;
  readonly description: string;
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
  readonly schema: typeof PRODUCER_DECLARATION_SCHEMA_ID;
  readonly format: "aihq-catalog-producer-declaration";
  readonly version: 3;
  readonly sources: readonly DeclaredSource[];
  readonly items: readonly ProducerItem[];
  readonly authored?: readonly AuthoredAllowance[];
  /** Independent producer identity; defaults to supplied-catalog@0.0.0, never AIHQ curation. */
  readonly package?: { readonly name: string; readonly version: string };
}
export interface SuppliedSourceFiles {
  readonly source: string;
  /** Caller-declared immutable Git source pin; byte provenance is independently computed. */
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
const failure = (path: string, message: string): AuthoringResult<never> => ({
  status: "refused",
  diagnostics: [{ code: "INPUT_INVALID", path, message }],
});

function donorProjection(declaration: ProducerDeclaration) {
  return {
    format: declaration.format,
    version: 2,
    sources: declaration.sources,
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
  if (isRecord(copy) && copy.schema !== PRODUCER_DECLARATION_SCHEMA_ID)
    return deepFreeze({
      status: "refused",
      diagnostics: [
        {
          code: "SCHEMA_UNSUPPORTED",
          path: "/schema",
          message:
            "Only producer-declaration:3.0.0 is supported; preserve the original and explicitly migrate older declarations.",
        },
      ],
    });
  if (!validate(copy))
    return deepFreeze({
      status: "refused",
      diagnostics: (validate.errors ?? []).slice(0, 256).map((error) => ({
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
      !COMMIT.test(input.revision) ||
      !isRecord(input.files)
    )
      return failure(at, "Expected source ID, full revision and regular-file byte map.");
    const source = declaration.sources.find((source) => source.id === input.source);
    if (!source || trees.has(input.source))
      return failure(`${at}/source`, "Supplied source must be declared exactly once.");
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
      repository: source.repository,
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
  const generated: GeneratedItem[] = [];
  try {
    for (const source of declaration.sources) {
      const tree = trees.get(source.id) as SourceTree;
      const mine = donor.items.filter((item) => item.source === source.id);
      const listed = pluginSkillPaths(tree, source, mine);
      if (listed && mine.some((item) => "skillPath" in item && !listed.has(item.skillPath)))
        return failure(
          "/declaration/items",
          "Declared skill is absent from the source's explicit plugin roster.",
        );
    }
    for (const [index, item] of declaration.items.entries()) {
      const source = declaration.sources.find(
        (source) => source.id === item.source,
      ) as DeclaredSource;
      const tree = trees.get(item.source) as SourceTree;
      const donorItem = donor.items.find((candidate) => candidate.id === item.id) as DeclaredItem;
      const output =
        "recipePath" in donorItem
          ? generateTemplateItem({ item: donorItem, source, sourceId: source.id, tree })
          : generateItem({
              item: donorItem,
              source,
              sourceId: source.id,
              revision: tree.commit,
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
      output.record.description = item.description;
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
        discovery: {
          label: item.label,
          description: item.description,
          kind: item.kind,
          clientCapabilities: item.clientCapabilities as unknown as Json,
          activation: item.activation as unknown as Json,
          configuration: item.configuration as unknown as Json,
        },
        suppliedSource: {
          source: source.id,
          revision: tree.commit,
          files: [...tree.inventory.paths].sort().map((path) => ({
            path,
            sha256: sha256Hex(tree.read(path)),
            byteLength: tree.read(path).byteLength,
          })),
        },
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
    return failure(
      "/sourceFiles",
      error instanceof ProducerRefusal
        ? error.message
        : "Required supplied source bytes are missing or invalid.",
    );
  }
  const schema = generated.some(
    (item) =>
      isRecord(item.record.recipe) && item.record.recipe.schema === "urn:aihq:core:recipe:1.3.0",
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
        origin: {
          kind: "git",
          repository: `https://github.com/${source.repository}`,
          revision: trees.get(source.id)?.commit,
        },
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
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
