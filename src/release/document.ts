/**
 * Structural and semantic checks for `urn:aihq:catalog:release:1.0.0`, matching
 * schemas/release/1.0.0.json plus the reader-only rules that schema documents.
 * Portable: no Node built-ins.
 */

import type { ScanBaseline } from "./baseline-contracts.js";
import { SCAN_BASELINE_SCHEMA_ID } from "./baseline-contracts.js";
import { baselineMatchesContent, validBaseline } from "./baseline-wire.js";
import {
  type CatalogDiagnostic,
  type CatalogItem,
  type InputSpec,
  type Json,
  RELEASE_RECIPE_SCHEMAS,
  RELEASE_SCHEMA_ID_1_3,
  RELEASE_SCHEMA_ID_1_4,
  RELEASE_SCHEMA_ID_1_5,
  RELEASE_SCHEMA_ID_1_6,
  type RecipeSchemaId,
  type ReleaseSchemaId,
} from "./contracts.js";
import { checkInputSpec } from "./inputs.js";
import { assertStrictValues, canonicalJson } from "./json.js";
import { sha256Hex } from "./sha256.js";
import { EXACT_VERSION } from "./version.js";

/** The fixed member prefix of a Catalog package archive. */
export const ARCHIVE_PACKAGE_PREFIX = "package/" as const;
export const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const SHA256 = /^[0-9a-f]{64}$/;
export const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const HTTPS_URL = /^https:\/\/[^\s/?#@]+(?:[/?][^\s#]*)?$/;
const GIT_REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SRI = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/;
const KIND = /^[a-z][a-z0-9-]{0,63}$/;
/** Core's client-id form; the reader checks form only, never membership. */
export const CLIENT_ID = /^[a-z][a-z0-9-]{0,63}$/;
const CLIENT_ADAPTER = "client-adapter";
/** Release formats whose local source origin is a pinned snapshot revision. */
const LOCAL_ORIGIN_SCHEMAS: readonly string[] = [
  RELEASE_SCHEMA_ID_1_3,
  RELEASE_SCHEMA_ID_1_4,
  RELEASE_SCHEMA_ID_1_5,
  RELEASE_SCHEMA_ID_1_6,
];
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MEMBER_MAX = 16 * 1024 * 1024;
const RECIPE_MAX = 1_000_000;
const ARCHIVE_MAX = 64 * 1024 * 1024;
const encoder = new TextEncoder();
/** Release 1.6 reserved item-relative path of the synthesised behaviour file. */
export const BEHAVIOUR_REL_PATH = "aih-behaviour.json" as const;
/** Release 1.6 package folder holding one item's behaviour file. */
export const itemPackageFolder = (itemId: string): string => `release/items/${itemId}`;
/** SPDX license identifier form, shared with the producer declaration source license. */
const SPDX_ID = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/;
/** Closed hook placeholder list; anything else fails the build. */
const HOOK_PLACEHOLDER = /^\{(projectDir|homeDir|itemDir|pluginRoot)\}$/;
/** Shape of a display name that is really a path; names are never paths. */
const PATH_SHAPED_NAME = /[\\/]|^\.\.?$|^[a-zA-Z]:/;
/** A literal that must instead arrive as an input reference. */
const SECRET_NAME = /token|secret|password|credential|auth|api[-_]?key/i;

/** Core's material member path rule, so Catalog never advertises a path Core refuses. */
export function safeMemberPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (encoder.encode(value).byteLength > 4096 || value.startsWith("/")) return false;
  const segments = value.split("/");
  return (
    segments.length <= 64 &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        !segment.includes("\\") &&
        !segment.includes(":") &&
        !/[. ]$/u.test(segment) &&
        !/\p{C}/u.test(segment) &&
        segment.normalize("NFC") === segment &&
        !RESERVED.test(segment),
    )
  );
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const httpsUrl = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 2048 && HTTPS_URL.test(value);

/** Core's archive URL rule, shared by portable mapping and Node acquisition. */
export function coreArchiveUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    assertStrictValues(value);
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname !== "" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      (url.port === "" || url.port === "443")
    );
  } catch {
    return false;
  }
}

export const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 128 && ID.test(value);
/** Collects diagnostics for one document; reasons are stable, messages are human text. */
export class Diagnostics {
  readonly list: CatalogDiagnostic[] = [];
  add(
    reason: string,
    path: string,
    message: string,
    extra: Partial<CatalogDiagnostic> = {},
  ): false {
    if (this.list.length < 256) {
      this.list.push(
        Object.freeze({ code: "INPUT_INVALID", reason, message, blocking: true, path, ...extra }),
      );
    }
    return false;
  }
}

/** Optional structured detail shared by diagnostic collectors. */
export interface DiagnosticDetail {
  readonly blocking?: boolean;
  readonly encountered?: string;
  readonly supported?: readonly string[];
}

/** Any collector the shared field checkers can report into. */
export interface DiagnosticCollector {
  add(reason: string, path: string, message: string, extra?: DiagnosticDetail): false;
}

/** Exact field set: unknown fields and missing required fields are both named. */
export function fields(
  d: DiagnosticCollector,
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!isRecord(value)) return d.add("invalid-type", path, "Expected an object.");
  let ok = true;
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      ok = d.add(
        "unknown-field",
        `${path}/${key}`,
        "This field is not part of the release format.",
      );
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key))
      ok = d.add("missing-field", `${path}/${key}`, "Required field.");
  }
  return ok;
}

function id(d: Diagnostics, value: unknown, path: string): value is string {
  return isId(value) || d.add("invalid-id", path, "Expected an identifier.");
}

function sha(d: Diagnostics, value: unknown, path: string): value is string {
  return (
    (typeof value === "string" && SHA256.test(value)) ||
    d.add("invalid-sha256", path, "Expected a bare lowercase SHA-256.")
  );
}

function length(d: Diagnostics, value: unknown, path: string, min: number, max: number): boolean {
  return (
    (typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max) ||
    d.add("invalid-length", path, `Expected an integer byte length from ${min} to ${max}.`)
  );
}

function memberPath(d: Diagnostics, value: unknown, path: string): value is string {
  return (
    safeMemberPath(value) || d.add("unsafe-path", path, "Expected a safe package-relative path.")
  );
}

/** Strictly ascending identifiers; an equal neighbour is a duplicate. */
function ascending(d: Diagnostics, ids: readonly string[], path: string): void {
  const seen = new Set<string>();
  ids.forEach((current, index) => {
    const previous = ids[index - 1];
    if (seen.has(current)) d.add("duplicate-id", `${path}/${index}`, "Duplicate identifier.");
    else if (previous !== undefined && previous > current) {
      d.add("unordered-ids", `${path}/${index}`, "Identifiers must be sorted.");
    }
    seen.add(current);
  });
}

export function checkMaterialSource(d: DiagnosticCollector, value: unknown, path: string): boolean {
  if (isRecord(value) && value.kind === "local") {
    return fields(d, value, path, ["kind", "input"]) && isId(value.input)
      ? true
      : d.add("invalid-source", path, "Expected {kind:'local',input}.");
  }
  if (isRecord(value) && value.kind === "archive") {
    const ok =
      fields(d, value, path, ["kind", "url", "sha256", "byteLength"]) &&
      coreArchiveUrl(value.url) &&
      typeof value.sha256 === "string" &&
      SHA256.test(value.sha256) &&
      typeof value.byteLength === "number" &&
      Number.isSafeInteger(value.byteLength) &&
      value.byteLength >= 1 &&
      value.byteLength <= ARCHIVE_MAX;
    return ok || d.add("invalid-source", path, "Expected an HTTPS archive with sha256 and length.");
  }
  return d.add("invalid-source", path, "Expected a local or archive material source.");
}

function checkOrigin(d: Diagnostics, value: unknown, path: string, schema: ReleaseSchemaId): void {
  const bad = () =>
    d.add(
      "invalid-origin",
      path,
      "Expected a pinned git, exact npm, authored or version-supported local origin.",
    );
  if (!isRecord(value)) return void bad();
  if (value.kind === "git") {
    if (
      !fields(d, value, path, ["kind", "repository", "revision"]) ||
      !httpsUrl(value.repository) ||
      typeof value.revision !== "string" ||
      !GIT_REVISION.test(value.revision)
    ) {
      bad();
    }
  } else if (value.kind === "npm") {
    if (
      !fields(d, value, path, ["kind", "registry", "package", "version", "integrity"]) ||
      !httpsUrl(value.registry) ||
      typeof value.package !== "string" ||
      !PACKAGE_NAME.test(value.package) ||
      typeof value.version !== "string" ||
      !EXACT_VERSION.test(value.version) ||
      typeof value.integrity !== "string" ||
      !SRI.test(value.integrity)
    ) {
      bad();
    }
  } else if (value.kind === "local" && LOCAL_ORIGIN_SCHEMAS.includes(schema)) {
    if (
      !fields(d, value, path, ["kind", "revision"]) ||
      typeof value.revision !== "string" ||
      !GIT_REVISION.test(value.revision)
    )
      bad();
  } else if (value.kind === "authored") {
    fields(d, value, path, ["kind"]);
  } else bad();
}

function checkPrerequisite(d: Diagnostics, value: unknown, path: string): void {
  const bad = () =>
    d.add("invalid-target", path, "Expected a Core platform or executable prerequisite.");
  if (!isRecord(value)) return void bad();
  if (value.kind === "platform") {
    const arch = value.architectures;
    if (
      !fields(d, value, path, ["kind", "os", "architectures"]) ||
      !["win32", "darwin", "linux"].includes(value.os as string) ||
      !Array.isArray(arch) ||
      arch.length === 0 ||
      new Set(arch).size !== arch.length ||
      arch.some((a) => a !== "x64" && a !== "arm64")
    ) {
      bad();
    }
  } else if (value.kind === "executable") {
    if (
      !fields(d, value, path, ["kind", "name"]) ||
      typeof value.name !== "string" ||
      value.name.length === 0 ||
      value.name.length > 256
    ) {
      bad();
    }
  } else bad();
}

const INPUT_FIELDS = [
  "default",
  "enum",
  "description",
  "sensitive",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
] as const;

export function checkInputs(d: Diagnostics, value: unknown, path: string): void {
  if (!isRecord(value))
    return void d.add("invalid-input", path, "Expected named input definitions.");
  for (const [name, spec] of Object.entries(value)) {
    const at = `${path}/${name}`;
    if (!isId(name)) d.add("invalid-input", at, "Input names are identifiers.");
    if (!fields(d, spec, at, ["type", "required"], INPUT_FIELDS)) continue;
    const scalar = (v: unknown) => ["string", "boolean", "number"].includes(typeof v);
    const nonNegative = (v: unknown) =>
      v === undefined || (Number.isSafeInteger(v) && (v as number) >= 0);
    const finite = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v));
    if (
      !["string", "boolean", "integer", "number"].includes(spec.type as string) ||
      typeof spec.required !== "boolean" ||
      (spec.default !== undefined && !scalar(spec.default)) ||
      (spec.enum !== undefined &&
        (!Array.isArray(spec.enum) ||
          spec.enum.length === 0 ||
          !spec.enum.every(scalar) ||
          new Set(spec.enum.map((v) => canonicalJson(v))).size !== spec.enum.length)) ||
      (spec.description !== undefined &&
        (typeof spec.description !== "string" || spec.description.length > 4096)) ||
      (spec.sensitive !== undefined && typeof spec.sensitive !== "boolean") ||
      !nonNegative(spec.minLength) ||
      !nonNegative(spec.maxLength) ||
      !finite(spec.minimum) ||
      !finite(spec.maximum)
    ) {
      d.add("invalid-input", at, "Expected a Core scalar InputSpec.");
      continue;
    }
    for (const reason of checkInputSpec(spec as unknown as InputSpec)) {
      d.add(reason, at, "The input definition is not internally consistent.");
    }
  }
}

export function checkDependencies(d: Diagnostics, value: unknown, path: string): void {
  if (!fields(d, value, path, [], ["requires", "optional", "conflicts"])) return;
  for (const list of ["requires", "optional", "conflicts"] as const) {
    const refs = value[list];
    if (refs === undefined) continue;
    if (!Array.isArray(refs)) {
      d.add("invalid-dependency", `${path}/${list}`, "Expected an array of item references.");
      continue;
    }
    refs.forEach((ref, index) => {
      const at = `${path}/${list}/${index}`;
      if (isRecord(ref) && Object.hasOwn(ref, "release")) {
        if (!fields(d, ref, at, ["release", "itemId", "itemSha256"])) return;
        id(d, ref.itemId, `${at}/itemId`);
        sha(d, ref.itemSha256, `${at}/itemSha256`);
        if (!fields(d, ref.release, `${at}/release`, ["source", "manifest"])) return;
        checkMaterialSource(d, ref.release.source, `${at}/release/source`);
        const manifest = ref.release.manifest;
        if (!fields(d, manifest, `${at}/release/manifest`, ["path", "sha256", "byteLength"]))
          return;
        memberPath(d, manifest.path, `${at}/release/manifest/path`);
        sha(d, manifest.sha256, `${at}/release/manifest/sha256`);
        length(d, manifest.byteLength, `${at}/release/manifest/byteLength`, 1, MEMBER_MAX);
      } else if (fields(d, ref, at, ["itemId"])) id(d, ref.itemId, `${at}/itemId`);
    });
  }
}

const normalizeDependencies = (value: Record<string, unknown>) =>
  ({
    requires: (value.requires as Json[] | undefined) ?? [],
    optional: (value.optional as Json[] | undefined) ?? [],
    conflicts: (value.conflicts as Json[] | undefined) ?? [],
  }) as unknown as CatalogItem["dependencies"];

/** Release 1.4: `clientId` is required on client-adapter items and refused on every other kind. */
function checkClientId(d: Diagnostics, item: Record<string, unknown>, path: string): void {
  const present = Object.hasOwn(item, "clientId");
  if (item.kind !== CLIENT_ADAPTER) {
    if (present) {
      d.add(
        "unexpected-client-id",
        `${path}/clientId`,
        "Only client-adapter items declare a target client.",
      );
    }
  } else if (!present) {
    d.add("missing-field", `${path}/clientId`, "Required field.");
  } else if (typeof item.clientId !== "string" || !CLIENT_ID.test(item.clientId)) {
    d.add("invalid-client-id", `${path}/clientId`, "Expected a lowercase client identifier.");
  }
}

const ITEM16_OPTIONAL = [
  "description",
  "metadata",
  "clientId",
  "name",
  "nameBasis",
  "descriptionBasis",
  "payload",
  "requirements",
  "executable",
  "contentSha256",
  "behaviourSha256",
  "source",
  "selectedBy",
  "derivedFrom",
  "size",
] as const;

function checkItem(
  d: Diagnostics,
  value: unknown,
  path: string,
  sources: ReadonlySet<string>,
  recipeSchemas: readonly RecipeSchemaId[],
  schema: ReleaseSchemaId,
): void {
  const clientIds =
    schema === RELEASE_SCHEMA_ID_1_4 ||
    schema === RELEASE_SCHEMA_ID_1_5 ||
    schema === RELEASE_SCHEMA_ID_1_6;
  const optional =
    schema === RELEASE_SCHEMA_ID_1_6
      ? ITEM16_OPTIONAL
      : clientIds
        ? ["description", "metadata", "clientId"]
        : ["description", "metadata"];
  if (
    !fields(
      d,
      value,
      path,
      [
        "id",
        "label",
        "kind",
        "sourceIds",
        "targets",
        "scopes",
        "inputs",
        "recipe",
        "materials",
        "dependencies",
      ],
      optional,
    )
  ) {
    return;
  }
  if (clientIds) checkClientId(d, value, path);
  id(d, value.id, `${path}/id`);
  if (typeof value.label !== "string" || value.label.length === 0 || value.label.length > 256) {
    d.add("invalid-text", `${path}/label`, "Expected a label of 1 to 256 characters.");
  }
  if (
    value.description !== undefined &&
    (typeof value.description !== "string" || value.description.length > 4096)
  ) {
    d.add(
      "invalid-text",
      `${path}/description`,
      "Expected a description of at most 4096 characters.",
    );
  }
  if (typeof value.kind !== "string" || !KIND.test(value.kind)) {
    d.add("invalid-kind", `${path}/kind`, "Expected a short lowercase descriptive kind.");
  }
  if (
    !Array.isArray(value.sourceIds) ||
    value.sourceIds.length === 0 ||
    new Set(value.sourceIds).size !== value.sourceIds.length
  ) {
    d.add("invalid-source-ids", `${path}/sourceIds`, "Expected unique source identifiers.");
  } else {
    value.sourceIds.forEach((sourceId, index) => {
      if (id(d, sourceId, `${path}/sourceIds/${index}`) && !sources.has(sourceId)) {
        d.add(
          "unknown-source",
          `${path}/sourceIds/${index}`,
          "No release source has this identifier.",
        );
      }
    });
  }
  if (!Array.isArray(value.targets))
    d.add("invalid-target", `${path}/targets`, "Expected an array.");
  else {
    for (const [index, target] of value.targets.entries()) {
      checkPrerequisite(d, target, `${path}/targets/${index}`);
    }
  }
  const scopes = value.scopes;
  if (
    !Array.isArray(scopes) ||
    scopes.length === 0 ||
    new Set(scopes).size !== scopes.length ||
    scopes.some((scope) => scope !== "project" && scope !== "user")
  ) {
    d.add("invalid-scope", `${path}/scopes`, "Expected a nonempty unique subset of project/user.");
  }
  checkInputs(d, value.inputs, `${path}/inputs`);
  const recipe = value.recipe;
  if (fields(d, recipe, `${path}/recipe`, ["id", "schema", "path", "sha256", "byteLength"])) {
    id(d, recipe.id, `${path}/recipe/id`);
    if (!recipeSchemas.includes(recipe.schema as RecipeSchemaId)) {
      d.add(
        "unsupported-recipe-schema",
        `${path}/recipe/schema`,
        "This release format does not admit that Core recipe format.",
        {
          encountered: typeof recipe.schema === "string" ? recipe.schema.slice(0, 128) : undefined,
          supported: recipeSchemas,
        },
      );
    }
    memberPath(d, recipe.path, `${path}/recipe/path`);
    sha(d, recipe.sha256, `${path}/recipe/sha256`);
    length(d, recipe.byteLength, `${path}/recipe/byteLength`, 1, RECIPE_MAX);
  }
  if (!Array.isArray(value.materials) || value.materials.length > 4096) {
    d.add("invalid-materials", `${path}/materials`, "Expected at most 4096 material members.");
  } else {
    const ids: string[] = [];
    value.materials.forEach((member, index) => {
      const at = `${path}/materials/${index}`;
      if (isRecord(member) && !Object.hasOwn(member, "path")) {
        checkExtendedMember(d, member, at, sources, schema);
      } else {
        if (!fields(d, member, at, ["id", "path", "sha256", "byteLength"])) return;
        memberPath(d, member.path, `${at}/path`);
        sha(d, member.sha256, `${at}/sha256`);
        length(d, member.byteLength, `${at}/byteLength`, 0, MEMBER_MAX);
      }
      if (isRecord(member) && id(d, member.id, `${at}/id`)) ids.push(member.id);
    });
    ascending(d, ids, `${path}/materials`);
  }
  checkDependencies(d, value.dependencies, `${path}/dependencies`);
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    d.add("invalid-metadata", `${path}/metadata`, "Metadata is a descriptive object.");
  }
  if (schema === RELEASE_SCHEMA_ID_1_6) checkItem16(d, value, path);
}

const ITEM16_FIELDS = [
  "payload",
  "requirements",
  "executable",
  "contentSha256",
  "behaviourSha256",
  "name",
  "nameBasis",
  "descriptionBasis",
  "source",
  "selectedBy",
  "derivedFrom",
  "size",
] as const;

export const bytewiseCompare = (a: string, b: string): number => {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return (left[index] as number) - (right[index] as number);
  }
  return left.length - right.length;
};

/** UTF-8 byte length and digest of canonical text; identities are byte identities. */
export function canonicalBytes(text: string): { readonly bytes: Uint8Array; readonly sha256: string } {
  const bytes = encoder.encode(text);
  return { bytes, sha256: sha256Hex(bytes) };
}

/** One extended release 1.6 material member. */
function checkExtendedMember(
  d: Diagnostics,
  member: Record<string, unknown>,
  at: string,
  sources: ReadonlySet<string>,
  schema: ReleaseSchemaId,
): void {
  if (schema !== RELEASE_SCHEMA_ID_1_6) {
    d.add("invalid-material", at, "Extended materials require release format 1.6.0.");
    return;
  }
  if (
    !fields(
      d,
      member,
      at,
      ["id", "relPath", "packagePath", "sha256", "byteLength", "executable", "sourceId"],
      ["sourcePath", "role", "upstream", "size"],
    )
  ) {
    return;
  }
  memberPath(d, member.relPath, `${at}/relPath`);
  memberPath(d, member.packagePath, `${at}/packagePath`);
  sha(d, member.sha256, `${at}/sha256`);
  length(d, member.byteLength, `${at}/byteLength`, 0, MEMBER_MAX);
  if (
    member.sourcePath !== undefined &&
    member.sourcePath !== null &&
    (typeof member.sourcePath !== "string" ||
      member.sourcePath.length > 4096 ||
      !safeMemberPath(member.sourcePath))
  ) {
    d.add(
      "invalid-source-path",
      `${at}/sourcePath`,
      "Expected a safe source-relative path or null.",
    );
  }
  if (
    member.executable !== true &&
    member.executable !== false &&
    member.executable !== "unknown"
  ) {
    d.add("invalid-executable", `${at}/executable`, "Expected true, false or unknown.");
  }
  if (id(d, member.sourceId, `${at}/sourceId`)) {
    // The behaviour file's sourceId is the publishing framework, not a content source.
    if (member.role === "behaviour") {
      if (typeof member.sourceId !== "string") {
        d.add("invalid-source", `${at}/sourceId`, "Expected the publishing framework identifier.");
      }
    } else if (!sources.has(member.sourceId)) {
      d.add("unknown-source", `${at}/sourceId`, "No release source has this identifier.");
    }
  }
  if (member.role !== undefined && member.role !== "content" && member.role !== "behaviour") {
    d.add("invalid-role", `${at}/role`, "Expected role content or behaviour.");
  }
  if (member.upstream !== undefined) {
    const atUpstream = `${at}/upstream`;
    if (
      fields(d, member.upstream, atUpstream, ["sourceId", "path", "gitBlob", "transform"]) &&
      id(d, member.upstream.sourceId, `${atUpstream}/sourceId`) &&
      memberPath(d, member.upstream.path, `${atUpstream}/path`)
    ) {
      if (!sources.has(member.upstream.sourceId as string)) {
        d.add("unknown-source", `${atUpstream}/sourceId`, "No release source has this identifier.");
      }
      if (
        typeof member.upstream.gitBlob !== "string" ||
        !GIT_REVISION.test(member.upstream.gitBlob)
      ) {
        d.add(
          "invalid-git-blob",
          `${atUpstream}/gitBlob`,
          "Expected a full lowercase Git blob id.",
        );
      }
      if (member.upstream.transform !== "identical" && member.upstream.transform !== "edited") {
        d.add("invalid-transform", `${atUpstream}/transform`, "Expected identical or edited.");
      }
    }
  }
  if (member.size !== undefined) {
    const atSize = `${at}/size`;
    if (fields(d, member.size, atSize, ["bytes", "chars", "status"])) {
      const nonNegative = (value: unknown) =>
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
      if (!nonNegative(member.size.bytes) || !nonNegative(member.size.chars)) {
        d.add("invalid-size", atSize, "Expected non-negative integer byte and character counts.");
      }
      if (member.size.status !== "measured" && member.size.status !== "unknown") {
        d.add("invalid-size", `${atSize}/status`, "Expected measured or unknown.");
      }
    }
  }
}

function checkPlaceholders(d: Diagnostics, text: string, at: string): void {
  for (const match of text.matchAll(/\{[^{}]*\}/g)) {
    if (!HOOK_PLACEHOLDER.test(match[0])) {
      d.add(
        "unknown-placeholder",
        at,
        `Unknown placeholder ${match[0]}; the closed list is {projectDir}, {homeDir}, {itemDir} and {pluginRoot}.`,
      );
    }
  }
}

function checkMcpEntries(
  d: Diagnostics,
  entries: unknown,
  at: string,
  requirementInputs: Record<string, unknown>,
): void {
  if (entries === undefined) return;
  if (!isRecord(entries)) {
    d.add("invalid-env", at, "Expected a record of named entries.");
    return;
  }
  for (const [key, entry] of Object.entries(entries)) {
    const atEntry = `${at}/${key}`;
    if (!isRecord(entry)) {
      d.add("invalid-env-entry", atEntry, "Expected an input or value entry.");
      continue;
    }
    if ("input" in entry) {
      if (!fields(d, entry, atEntry, ["input"])) continue;
    } else if (!fields(d, entry, atEntry, ["value"])) {
      continue;
    }
    if ("value" in entry) {
      if (SECRET_NAME.test(key)) {
        d.add(
          "secret-literal",
          atEntry,
          "A secret-bearing entry must be an input reference, never a literal.",
        );
      }
    } else if (typeof entry.input !== "string" || !Object.hasOwn(requirementInputs, entry.input)) {
      d.add(
        "unknown-input",
        atEntry,
        "An environment input must name a requirements.inputs entry the server introduces.",
      );
    }
  }
}

function checkPayload16(
  d: Diagnostics,
  item: Record<string, unknown>,
  path: string,
  content: readonly Record<string, unknown>[],
  requirementInputs: Record<string, unknown>,
): void {
  const payload = item.payload;
  if (payload === undefined || payload === null) return;
  if (!isRecord(payload)) {
    d.add("invalid-payload", `${path}/payload`, "Expected a typed payload object.");
    return;
  }
  const contentIds = new Set(content.map((member) => String(member.id)));
  const nonEmptyString = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= 4096;
  if (item.kind === "skill") {
    if (!fields(d, payload, `${path}/payload`, ["dirName", "invocation", "invocationBasis"], ["namespace"])) {
      return;
    }
    if (!nonEmptyString(payload.dirName)) {
      d.add("invalid-payload", `${path}/payload/dirName`, "Expected the installed directory name.");
    }
    if (payload.invocation !== "user-only" && payload.invocation !== "model-allowed") {
      d.add(
        "invalid-payload",
        `${path}/payload/invocation`,
        "Expected invocation user-only or model-allowed.",
      );
    }
    if (!nonEmptyString(payload.invocationBasis)) {
      d.add(
        "invalid-payload",
        `${path}/payload/invocationBasis`,
        "Expected the recorded invocation basis.",
      );
    }
  } else if (item.kind === "rule") {
    if (!fields(d, payload, `${path}/payload`, ["applyTo", "applyToBasis"], ["namespace", "inclusion", "placement"])) {
      return;
    }
    if (
      !Array.isArray(payload.applyTo) ||
      payload.applyTo.length === 0 ||
      payload.applyTo.some((entry) => !nonEmptyString(entry))
    ) {
      d.add("invalid-payload", `${path}/payload/applyTo`, "Expected a nonempty applyTo list.");
    }
    if (!nonEmptyString(payload.applyToBasis)) {
      d.add(
        "invalid-payload",
        `${path}/payload/applyToBasis`,
        "Expected the recorded applyTo basis.",
      );
    }
    if (
      payload.inclusion !== undefined &&
      !["always", "fileMatch", "manual"].includes(payload.inclusion as string)
    ) {
      d.add(
        "invalid-payload",
        `${path}/payload/inclusion`,
        "Expected always, fileMatch or manual.",
      );
    }
    if (
      payload.placement !== undefined &&
      !["file", "entry-block", "project-folder"].includes(payload.placement as string)
    ) {
      d.add(
        "invalid-payload",
        `${path}/payload/placement`,
        "Expected file, entry-block or project-folder.",
      );
    }
  } else if (item.kind === "hook") {
    if (!fields(d, payload, `${path}/payload`, ["event", "protocol", "command"], ["matcher", "timeoutSec"])) {
      return;
    }
    if (payload.protocol !== "claude-code-hooks") {
      d.add(
        "unsupported-protocol",
        `${path}/payload/protocol`,
        "The hook protocol list is closed; claude-code-hooks is the only entry.",
        {
          encountered:
            typeof payload.protocol === "string" ? payload.protocol.slice(0, 128) : undefined,
          supported: ["claude-code-hooks"],
        },
      );
    }
    if (!nonEmptyString(payload.event)) {
      d.add("invalid-payload", `${path}/payload/event`, "Expected the hook event name.");
    }
    if (payload.matcher !== undefined && !nonEmptyString(payload.matcher)) {
      d.add("invalid-payload", `${path}/payload/matcher`, "Expected a matcher pattern.");
    }
    if (
      payload.timeoutSec !== undefined &&
      (typeof payload.timeoutSec !== "number" ||
        !Number.isSafeInteger(payload.timeoutSec) ||
        (payload.timeoutSec as number) < 1 ||
        (payload.timeoutSec as number) > 86400)
    ) {
      d.add("invalid-payload", `${path}/payload/timeoutSec`, "Expected an integer second bound.");
    }
    const command = isRecord(payload.command) ? payload.command : undefined;
    if (command === undefined) {
      d.add("invalid-payload", `${path}/payload/command`, "A hook payload carries its command.");
      return;
    }
    if (!fields(d, command, `${path}/payload/command`, ["script"], ["program", "interpreter", "args"])) {
      return;
    }
    if (typeof command.script !== "string" || !contentIds.has(command.script)) {
      d.add(
        "unknown-material",
        `${path}/payload/command/script`,
        "The hook script must name one of the item's content materials.",
      );
    }
    if (
      command.interpreter !== undefined &&
      !["node", "bash", "python", "pwsh"].includes(command.interpreter as string)
    ) {
      d.add(
        "invalid-payload",
        `${path}/payload/command/interpreter`,
        "Expected node, bash, python or pwsh.",
      );
    }
    if (command.program !== undefined) {
      if (!nonEmptyString(command.program)) {
        d.add("invalid-payload", `${path}/payload/command/program`, "Expected a program name.");
      } else {
        checkPlaceholders(d, command.program, `${path}/payload/command/program`);
      }
    }
    if (command.args !== undefined) {
      if (!Array.isArray(command.args)) {
        d.add("invalid-payload", `${path}/payload/command/args`, "Expected an argument list.");
      } else {
        command.args.forEach((arg, index) => {
          const at = `${path}/payload/command/args/${index}`;
          if (isRecord(arg)) {
            if (!fields(d, arg, at, ["material"])) return;
            if (typeof arg.material !== "string" || !contentIds.has(arg.material)) {
              d.add("unknown-material", at, "An argument material must name a content material.");
            }
          } else if (typeof arg === "string") {
            checkPlaceholders(d, arg, at);
          } else {
            d.add("invalid-payload", at, "Expected a string or material argument.");
          }
        });
      }
    }
  } else if (item.kind === "mcp-server") {
    if (
      !fields(d, payload, `${path}/payload`, ["key", "transport"], [
        "command",
        "args",
        "url",
        "env",
        "headers",
        "derivation",
      ])
    ) {
      return;
    }
    if (!nonEmptyString(payload.key)) {
      d.add("invalid-payload", `${path}/payload/key`, "Expected the server key.");
    }
    if (
      payload.transport !== "stdio" &&
      payload.transport !== "http" &&
      payload.transport !== "sse"
    ) {
      d.add("invalid-transport", `${path}/payload/transport`, "Expected stdio, http or sse.");
    } else if (payload.transport === "stdio") {
      if (!nonEmptyString(payload.command)) {
        d.add(
          "mcp-command-required",
          `${path}/payload/command`,
          "An MCP stdio transport carries its command.",
        );
      }
    } else if (!nonEmptyString(payload.url)) {
      d.add(
        "mcp-url-required",
        `${path}/payload/url`,
        "An MCP http or sse transport carries its url.",
      );
    }
    if (payload.command !== undefined && !nonEmptyString(payload.command)) {
      d.add("invalid-payload", `${path}/payload/command`, "Expected the server command.");
    }
    if (payload.url !== undefined && !nonEmptyString(payload.url)) {
      d.add("invalid-payload", `${path}/payload/url`, "Expected the server url.");
    }
    if (
      payload.args !== undefined &&
      (!Array.isArray(payload.args) || payload.args.some((arg) => !nonEmptyString(arg)))
    ) {
      d.add("invalid-payload", `${path}/payload/args`, "Expected server argument strings.");
    }
    checkMcpEntries(d, payload.env, `${path}/payload/env`, requirementInputs);
    checkMcpEntries(d, payload.headers, `${path}/payload/headers`, requirementInputs);
    if (payload.derivation !== undefined) {
      const at = `${path}/payload/derivation`;
      if (!isRecord(payload.derivation)) {
        d.add("invalid-payload", at, "Expected a derivation record.");
      } else {
        if (
          !fields(d, payload.derivation, at, ["sourceMaterial", "pointer", "transform"], ["editsSha256"])
        ) {
          return;
        }
        if (!nonEmptyString(payload.derivation.sourceMaterial)) {
          d.add("invalid-payload", `${at}/sourceMaterial`, "Expected the source material id.");
        }
        if (!nonEmptyString(payload.derivation.pointer)) {
          d.add("invalid-payload", `${at}/pointer`, "Expected the upstream pointer.");
        }
        if (
          payload.derivation.transform !== "identical" &&
          payload.derivation.transform !== "edited"
        ) {
          d.add("invalid-payload", `${at}/transform`, "Expected identical or edited.");
        } else if (
          payload.derivation.transform === "edited" &&
          (typeof payload.derivation.editsSha256 !== "string" ||
            !SHA256.test(payload.derivation.editsSha256))
        ) {
          d.add(
            "invalid-payload",
            `${at}/editsSha256`,
            "An edited derivation carries its edits digest.",
          );
        }
      }
    }
  } else if (item.kind === "agent" || item.kind === "command" || item.kind === "document") {
    if (!fields(d, payload, `${path}/payload`, ["files"])) {
      return;
    }
    if (!Array.isArray(payload.files)) {
      d.add("invalid-payload", `${path}/payload/files`, "Expected the carried file material ids.");
    } else {
      payload.files.forEach((file, index) => {
        if (typeof file !== "string" || !contentIds.has(file)) {
          d.add(
            "unknown-material",
            `${path}/payload/files/${index}`,
            "A carried file must name a content material.",
          );
        }
      });
    }
  }
}

function checkProvenance16(
  d: Diagnostics,
  item: Record<string, unknown>,
  path: string,
  content: readonly Record<string, unknown>[],
): void {
  const derived = item.derivedFrom;
  if (derived === undefined) return;
  if (!Array.isArray(derived)) {
    d.add("invalid-derived-from", `${path}/derivedFrom`, "Expected an array of derivations.");
    return;
  }
  const contentRelPaths = new Set(content.map((member) => String(member.relPath)));
  derived.forEach((entry, index) => {
    const at = `${path}/derivedFrom/${index}`;
    if (!isRecord(entry)) {
      d.add("invalid-derived-from", at, "Expected a derivation record.");
      return;
    }
    if (
      !fields(d, entry, at, ["itemId", "status"], ["releaseSha256", "proof"])
    ) {
      return;
    }
    id(d, entry.itemId, `${at}/itemId`);
    if (entry.status !== "verified" && entry.status !== "declared") {
      d.add("invalid-derived-from", `${at}/status`, "Expected verified or declared.");
      return;
    }
    if (
      entry.releaseSha256 !== undefined &&
      (typeof entry.releaseSha256 !== "string" || !SHA256.test(entry.releaseSha256))
    ) {
      d.add("invalid-derived-from", `${at}/releaseSha256`, "Expected a lowercase SHA-256.");
    }
    if (entry.status === "verified") {
      const proof = entry.proof;
      if (!isRecord(proof) || !Array.isArray(proof.materials) || proof.materials.length === 0) {
        d.add("unverified-derivation", at, "A verified derivation carries per-material proof.");
        return;
      }
      if (!fields(d, proof, `${at}/proof`, ["materials"])) return;
      const seenRelPaths = new Set<string>();
      proof.materials.forEach((proofMember, proofIndex) => {
        const atProof = `${at}/proof/materials/${proofIndex}`;
        if (!isRecord(proofMember) || !fields(d, proofMember, atProof, ["relPath", "sha256"])) {
          d.add("invalid-proof", atProof, "Expected a relPath and sha256 pair.");
          return;
        }
        if (!safeMemberPath(proofMember.relPath)) {
          d.add("invalid-proof", `${atProof}/relPath`, "Expected a safe item-relative path.");
          return;
        }
        // Proof names this item's materials; the recorded digest is the derived-from
        // source's hash at that path, which the reader cannot recompute without the
        // source release, so admission checks shape and membership, not equality.
        if (!contentRelPaths.has(String(proofMember.relPath))) {
          d.add(
            "unverified-derivation",
            atProof,
            "Proof names a relPath this item does not carry.",
          );
          return;
        }
        if (seenRelPaths.has(String(proofMember.relPath))) {
          d.add("invalid-proof", atProof, "Duplicate proof relPath.");
          return;
        }
        seenRelPaths.add(String(proofMember.relPath));
        if (typeof proofMember.sha256 !== "string" || !SHA256.test(proofMember.sha256)) {
          d.add("invalid-proof", `${atProof}/sha256`, "Expected a lowercase SHA-256.");
        }
      });
    } else if (entry.proof !== undefined) {
      d.add("unexpected-proof", at, "Only verified derivations carry proof.");
    }
  });
}

/**
 * Release 1.6 semantic checks for one item carrying the new fields: the behaviour
 * file agreement, both recomputed identities, typed payload rules and provenance.
 * Items without any new field are read exactly as release 1.5 items.
 */
function checkItem16(d: Diagnostics, item: Record<string, unknown>, path: string): void {
  const materials = (Array.isArray(item.materials) ? item.materials : []).filter(isRecord);
  const extended = materials.filter((member) => !Object.hasOwn(member, "path"));
  const legacy = materials.filter((member) => Object.hasOwn(member, "path"));
  const carries = ITEM16_FIELDS.some((field) => Object.hasOwn(item, field)) || extended.length > 0;
  if (!carries) return;
  if (Object.hasOwn(item, "payload") && !isRecord(item.payload)) {
    d.add("invalid-payload", `${path}/payload`, "Expected a typed payload object.");
  }
  if (item.size !== undefined) {
    const atSize = `${path}/size`;
    if (fields(d, item.size, atSize, ["parts"], ["status"])) {
      if (
        item.size.status !== undefined &&
        item.size.status !== "measured" &&
        item.size.status !== "unknown"
      ) {
        d.add("invalid-size", `${atSize}/status`, "Expected measured or unknown.");
      }
      if (Array.isArray(item.size.parts)) {
        item.size.parts.forEach((part, index) => {
          const atPart = `${atSize}/parts/${index}`;
          if (!fields(d, part, atPart, ["part", "bytes", "chars"])) return;
          if (
            part.part !== "name" &&
            part.part !== "description" &&
            part.part !== "frontmatter" &&
            part.part !== "body" &&
            part.part !== "files"
          ) {
            d.add("invalid-size", `${atPart}/part`, "Expected a named content part.");
          }
          const nonNegative = (value: unknown) =>
            typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
          if (!nonNegative(part.bytes) || !nonNegative(part.chars)) {
            d.add("invalid-size", atPart, "Expected non-negative integer byte and character counts.");
          }
        });
      }
    }
  }
  if (
    item.name !== undefined &&
    (typeof item.name !== "string" || PATH_SHAPED_NAME.test(item.name))
  ) {
    d.add("path-shaped-name", `${path}/name`, "A display name must never be path-shaped.");
  }
  if (legacy.length > 0) {
    d.add(
      "mixed-material-forms",
      `${path}/materials`,
      "An item carrying release 1.6 fields uses the extended material form throughout.",
    );
  }
  const behaviour = extended.filter((member) => member.role === "behaviour");
  const content = extended.filter((member) => member.role !== "behaviour");
  if (behaviour.length !== 1) {
    d.add(
      "behaviour-count",
      `${path}/materials`,
      "An item carrying release 1.6 fields has exactly one role behaviour material.",
    );
    return;
  }
  const behaviourMaterial = behaviour[0] as Record<string, unknown>;
  if (behaviourMaterial.relPath !== BEHAVIOUR_REL_PATH) {
    d.add(
      "behaviour-path",
      `${path}/materials`,
      `The behaviour file lives at the reserved item-relative path ${BEHAVIOUR_REL_PATH}.`,
    );
  }
  if (behaviourMaterial.sourcePath !== null) {
    d.add(
      "behaviour-source-path",
      `${path}/materials`,
      "The behaviour file is synthesised by the publisher; its sourcePath is null.",
    );
  }
  if (behaviourMaterial.executable !== false) {
    d.add(
      "behaviour-executable",
      `${path}/materials`,
      "The behaviour file is data, never executable.",
    );
  }
  if (
    behaviourMaterial.packagePath !== `${itemPackageFolder(String(item.id))}/${BEHAVIOUR_REL_PATH}`
  ) {
    d.add(
      "behaviour-package-path",
      `${path}/materials`,
      "The behaviour file's packagePath sits under the item's package folder.",
    );
  }
  for (const member of content) {
    if (member.relPath === BEHAVIOUR_REL_PATH) {
      d.add(
        "reserved-behaviour-path",
        `${path}/materials`,
        `${BEHAVIOUR_REL_PATH} is reserved for the behaviour file.`,
      );
    }
  }
  const derivedExecutable: Record<string, true | false | "unknown"> = {};
  for (const member of content) {
    derivedExecutable[String(member.relPath)] = member.executable as true | false | "unknown";
  }
  if (item.executable !== undefined) {
    if (!isRecord(item.executable)) {
      d.add("invalid-executable-map", `${path}/executable`, "Expected a relPath executable map.");
    } else if (canonicalJson(item.executable) !== canonicalJson(derivedExecutable)) {
      d.add(
        "executable-map-mismatch",
        `${path}/executable`,
        "The item executable map must equal the content materials' executable states.",
      );
    }
  }
  let requirementInputs: Record<string, unknown> = {};
  if (item.requirements !== undefined) {
    if (fields(d, item.requirements, `${path}/requirements`, [], ["inputs"])) {
      if (isRecord(item.requirements.inputs)) {
        checkInputs(d, item.requirements.inputs, `${path}/requirements/inputs`);
        requirementInputs = item.requirements.inputs;
      } else if (item.requirements.inputs !== undefined) {
        d.add("invalid-input", `${path}/requirements/inputs`, "Expected named input definitions.");
      }
    }
  }
  const identity = computeBehaviourIdentity(item);
  if (identity === undefined) return;
  if (
    behaviourMaterial.sha256 !== sha256Hex(identity.behaviourBytes) ||
    behaviourMaterial.byteLength !== identity.behaviourBytes.length
  ) {
    d.add(
      "behaviour-mismatch",
      `${path}/materials`,
      "The declared kind, payload, requirements, dependencies or executable state differ from the behaviour file.",
      { itemId: String(item.id) },
    );
    return;
  }
  if (item.contentSha256 !== identity.contentSha256) {
    d.add(
      "content-hash-mismatch",
      `${path}/contentSha256`,
      "The declared contentSha256 does not match the content materials.",
      { itemId: String(item.id) },
    );
  }
  if (item.behaviourSha256 !== identity.behaviourSha256) {
    d.add(
      "behaviour-hash-mismatch",
      `${path}/behaviourSha256`,
      "The declared behaviourSha256 does not match all materials including the behaviour file.",
      { itemId: String(item.id) },
    );
  }
  checkPayload16(d, item, path, content, requirementInputs);
  checkProvenance16(d, item, path, content);
}

/** The recomputed behaviour bytes and both identities for one checked 1.6 item. */
export interface ItemBehaviourIdentity {
  readonly behaviourBytes: Uint8Array;
  readonly contentSha256: string;
  readonly behaviourSha256: string;
  readonly executable: Readonly<Record<string, true | false | "unknown">>;
}

/**
 * Recomputes the synthesised behaviour bytes and both identities exactly as the
 * reader does. Returns undefined when the item carries no release 1.6 material.
 */
export function computeBehaviourIdentity(item: Record<string, unknown>): ItemBehaviourIdentity | undefined {
  const materials = (Array.isArray(item.materials) ? item.materials : []).filter(isRecord);
  const extended = materials.filter((member) => !Object.hasOwn(member, "path"));
  if (extended.length === 0) return undefined;
  const content = extended.filter((member) => member.role !== "behaviour");
  const derivedExecutable: Record<string, true | false | "unknown"> = {};
  for (const member of content) {
    derivedExecutable[String(member.relPath)] = member.executable as true | false | "unknown";
  }
  const requirementInputs =
    isRecord(item.requirements) && isRecord(item.requirements.inputs)
      ? item.requirements.inputs
      : {};
  const behaviourValue = {
    kind: item.kind,
    payload: item.payload ?? null,
    requirements: { inputs: requirementInputs },
    dependencies: normalizeDependencies(item.dependencies as Record<string, unknown>),
    executable: derivedExecutable,
  };
  const identity = canonicalBytes(`${canonicalJson(behaviourValue)}\n`);
  const lines = (members: readonly Record<string, unknown>[]) =>
    members
      .map((member) => `${String(member.relPath)}\t${String(member.sha256)}\n`)
      .sort(bytewiseCompare);
  return {
    behaviourBytes: identity.bytes,
    contentSha256: sha256Hex(encoder.encode(lines(content).join(""))),
    behaviourSha256: sha256Hex(encoder.encode(lines(extended).join(""))),
    executable: derivedExecutable,
  };
}

/** Paths are package members: one path names one byte identity across the whole release. */
export function memberPackagePath(member: Record<string, unknown>): unknown {
  return Object.hasOwn(member, "path") ? member.path : member.packagePath;
}

function checkPathIdentities(d: Diagnostics, items: readonly Record<string, unknown>[]): void {
  const seen = new Map<string, string>();
  items.forEach((item, itemIndex) => {
    const recipe = item.recipe as Record<string, unknown>;
    const members = [
      { at: `/items/${itemIndex}/recipe`, value: recipe },
      ...(item.materials as Record<string, unknown>[]).map((value, index) => ({
        at: `/items/${itemIndex}/materials/${index}`,
        value,
      })),
    ];
    for (const { at, value } of members) {
      const identity = `${value.sha256}:${value.byteLength}`;
      const packagePath = memberPackagePath(value);
      const prior = seen.get(String(packagePath));
      if (prior !== undefined && prior !== identity) {
        d.add("inconsistent-material-path", at, "One path is declared with different bytes.");
      }
      seen.set(String(packagePath), identity);
    }
  });
}

function checkRequiredClosure(d: Diagnostics, items: readonly Record<string, unknown>[]): void {
  const known = new Set(items.map((item) => item.id as string));
  const edges = new Map<string, string[]>();
  items.forEach((item, index) => {
    const dependencies = normalizeDependencies(item.dependencies as Record<string, unknown>);
    const local: string[] = [];
    for (const list of ["requires", "optional", "conflicts"] as const) {
      dependencies[list].forEach((ref, refIndex) => {
        if ("release" in ref) return;
        const at = `/items/${index}/dependencies/${list}/${refIndex}`;
        if (ref.itemId === item.id)
          d.add("self-dependency", at, "An item cannot reference itself.");
        else if (!known.has(ref.itemId))
          d.add("unknown-item", at, "No item in this release has this ID.");
        else if (list === "requires") local.push(ref.itemId);
      });
    }
    edges.set(item.id as string, local);
  });
  // Iterative three-colour walk over same-release required edges.
  const state = new Map<string, 1 | 2>();
  for (const start of edges.keys()) {
    if (state.has(start)) continue;
    const stack: [string, number][] = [[start, 0]];
    state.set(start, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as [string, number];
      const next = (edges.get(frame[0]) ?? [])[frame[1]++];
      if (next === undefined) {
        state.set(frame[0], 2);
        stack.pop();
      } else if (state.get(next) === 1) {
        d.add("dependency-cycle", `/items`, "Required dependencies form a cycle.", {
          itemId: next,
        });
        return;
      } else if (!state.has(next)) {
        state.set(next, 1);
        stack.push([next, 0]);
      }
    }
  }
}

export interface CheckedDocument {
  readonly schema: ReleaseSchemaId;
  readonly package: { readonly name: string; readonly version: string };
  readonly sources: readonly Json[];
  readonly items: readonly CatalogItem[];
  readonly metadata?: Json;
  readonly baseline?: ScanBaseline;
}

/** Release-level release 1.6 fields: framework identity, retirement, routes, names. */
function checkRelease16Fields(d: Diagnostics, value: Record<string, unknown>): void {
  const framework = value.framework;
  let frameworkId: string | undefined;
  if (framework !== undefined) {
    if (fields(d, framework, "/framework", ["id", "name", "version", "description"])) {
      if (id(d, framework.id, "/framework/id")) frameworkId = framework.id;
      if (
        typeof framework.name !== "string" ||
        framework.name.length === 0 ||
        framework.name.length > 256
      ) {
        d.add(
          "invalid-text",
          "/framework/name",
          "Expected a framework name of 1 to 256 characters.",
        );
      }
      if (
        typeof framework.version !== "string" ||
        framework.version.length > 256 ||
        !EXACT_VERSION.test(framework.version)
      ) {
        d.add("invalid-version", "/framework/version", "Expected one exact version.");
      }
      if (
        typeof framework.description !== "string" ||
        framework.description.length === 0 ||
        framework.description.length > 4096
      ) {
        d.add(
          "invalid-text",
          "/framework/description",
          "Expected a framework description of 1 to 4096 characters.",
        );
      }
    }
  }
  if (value.retired !== undefined) {
    if (!Array.isArray(value.retired) || value.retired.length > 4096) {
      d.add("invalid-retired", "/retired", "Expected at most 4096 retirement records.");
    } else {
      value.retired.forEach((entry, index) => {
        const at = `/retired/${index}`;
        if (!fields(d, entry, at, ["id", "reason"], ["replacedBy"])) return;
        id(d, entry.id, `${at}/id`);
        if (
          typeof entry.reason !== "string" ||
          entry.reason.length === 0 ||
          entry.reason.length > 4096
        ) {
          d.add(
            "invalid-text",
            `${at}/reason`,
            "Expected a retirement reason of 1 to 4096 characters.",
          );
        }
        if (
          entry.replacedBy !== undefined &&
          (!Array.isArray(entry.replacedBy) ||
            entry.replacedBy.length > 4096 ||
            entry.replacedBy.some((item) => !isId(item)))
        ) {
          d.add("invalid-replaced-by", `${at}/replacedBy`, "Expected item identifiers.");
        }
      });
    }
  }
  if (value.nativeRoutes !== undefined) {
    if (
      !Array.isArray(value.nativeRoutes) ||
      value.nativeRoutes.length > 4096 ||
      value.nativeRoutes.some(
        (route) => typeof route !== "string" || route.length === 0 || route.length > 4096,
      )
    ) {
      d.add("invalid-native-routes", "/nativeRoutes", "Expected display-only route lines.");
    }
  }
  const items = (Array.isArray(value.items) ? value.items : []).filter(isRecord);
  const carrying = items.filter(
    (item) =>
      (Array.isArray(item.materials) ? item.materials : []).some(
        (member) => isRecord(member) && !Object.hasOwn(member, "path"),
      ) || ITEM16_FIELDS.some((field) => Object.hasOwn(item, field)),
  );
  const publishesIdentity = framework !== undefined || carrying.length > 0;
  if (carrying.length > 0 && frameworkId === undefined) {
    d.add(
      "framework-required",
      "/framework",
      "A release whose items carry behaviour files publishes the framework identity.",
    );
  }
  if (publishesIdentity) {
    (Array.isArray(value.sources) ? value.sources : []).forEach((source, index) => {
      if (!isRecord(source)) return;
      if (typeof source.license !== "string" || !SPDX_ID.test(source.license)) {
        d.add(
          "missing-license",
          `/sources/${index}/license`,
          "Each source hop carries an SPDX license identifier once the framework identity is published.",
        );
      }
    });
  }
  if (frameworkId !== undefined) {
    items.forEach((item, itemIndex) => {
      const materials = (Array.isArray(item.materials) ? item.materials : []).filter(isRecord);
      materials.forEach((member, memberIndex) => {
        if (
          !Object.hasOwn(member, "path") &&
          member.role === "behaviour" &&
          member.sourceId !== frameworkId
        ) {
          d.add(
            "behaviour-source-id",
            `/items/${itemIndex}/materials/${memberIndex}/sourceId`,
            "The behaviour file's sourceId is the publishing framework.",
          );
        }
      });
    });
  }
  const seen = new Map<string, string>();
  items.forEach((item, itemIndex) => {
    if (typeof item.name !== "string") return;
    const namespace =
      isRecord(item.payload) && typeof item.payload.namespace === "string"
        ? item.payload.namespace
        : "";
    const key = `${String(item.kind)}\u0000${namespace}\u0000${item.name.toLowerCase()}`;
    const prior = seen.get(key);
    if (prior !== undefined) {
      d.add(
        "duplicate-name",
        `/items/${itemIndex}/name`,
        `Duplicate display name within one framework, kind and namespace (first at ${prior}).`,
      );
    } else {
      seen.set(key, `/items/${itemIndex}/name`);
    }
  });
}

/** Checks a canonical release value; returns the normalized items or diagnostics. */
export function checkReleaseDocument(
  value: unknown,
  options: { readonly contentOnly?: boolean } = {},
): {
  readonly diagnostics: readonly CatalogDiagnostic[];
  readonly document?: CheckedDocument;
} {
  const d = new Diagnostics();
  const supportedSchemas = Object.keys(RELEASE_RECIPE_SCHEMAS) as ReleaseSchemaId[];
  if (
    isRecord(value) &&
    Object.hasOwn(value, "schema") &&
    !supportedSchemas.includes(value.schema as ReleaseSchemaId)
  ) {
    d.list.push(
      Object.freeze({
        code: "SCHEMA_UNSUPPORTED",
        reason: "unsupported-schema",
        message: "This release format is not supported.",
        blocking: true,
        path: "/schema",
        encountered:
          typeof value.schema === "string" ? value.schema.slice(0, 128) : String(value.schema),
        supported: supportedSchemas,
      }),
    );
    return { diagnostics: d.list };
  }
  const baselineFormat =
    isRecord(value) &&
    (value.schema === RELEASE_SCHEMA_ID_1_5 || value.schema === RELEASE_SCHEMA_ID_1_6);
  if (
    !fields(
      d,
      value,
      "",
      ["schema", "package", "sources", "items"],
      baselineFormat
        ? value.schema === RELEASE_SCHEMA_ID_1_6
          ? ["metadata", "baseline", "framework", "retired", "nativeRoutes"]
          : ["metadata", "baseline"]
        : ["metadata"],
    )
  ) {
    return { diagnostics: d.list };
  }
  if (isRecord(value) && value.schema === RELEASE_SCHEMA_ID_1_6) {
    checkRelease16Fields(d, value);
  }
  const pkg = value.package;
  if (fields(d, pkg, "/package", ["name", "version"])) {
    if (typeof pkg.name !== "string" || pkg.name.length > 214 || !PACKAGE_NAME.test(pkg.name)) {
      d.add("invalid-package", "/package/name", "Expected an npm package name.");
    }
    if (
      typeof pkg.version !== "string" ||
      pkg.version.length > 256 ||
      !EXACT_VERSION.test(pkg.version)
    ) {
      d.add(
        "invalid-version",
        "/package/version",
        "Expected one exact version, not a range or tag.",
      );
    }
  }
  const sourceIds = new Set<string>();
  if (!Array.isArray(value.sources)) d.add("invalid-type", "/sources", "Expected an array.");
  else {
    const ids: string[] = [];
    value.sources.forEach((source, index) => {
      const at = `/sources/${index}`;
      const schema = value.schema as ReleaseSchemaId;
      if (
        !fields(
          d,
          source,
          at,
          ["id", "origin"],
          schema === RELEASE_SCHEMA_ID_1_6 ? ["license"] : [],
        )
      ) {
        return;
      }
      if (id(d, source.id, `${at}/id`)) {
        ids.push(source.id);
        sourceIds.add(source.id);
      }
      if (
        source.license !== undefined &&
        (typeof source.license !== "string" || !SPDX_ID.test(source.license))
      ) {
        d.add("invalid-license", `${at}/license`, "Expected an SPDX license identifier.");
      }
      checkOrigin(d, source.origin, `${at}/origin`, schema);
    });
    ascending(d, ids, "/sources");
  }
  if (!Array.isArray(value.items)) d.add("invalid-type", "/items", "Expected an array.");
  else {
    for (const [index, item] of value.items.entries()) {
      checkItem(
        d,
        item,
        `/items/${index}`,
        sourceIds,
        RELEASE_RECIPE_SCHEMAS[value.schema as ReleaseSchemaId] ?? [],
        value.schema as ReleaseSchemaId,
      );
    }
    ascending(
      d,
      value.items.map((item) => (isRecord(item) && typeof item.id === "string" ? item.id : "")),
      "/items",
    );
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    d.add("invalid-metadata", "/metadata", "Metadata is a descriptive object.");
  }
  if (d.list.length > 0) return { diagnostics: d.list };
  if (baselineFormat && !options.contentOnly) {
    if (isRecord(value.baseline) && value.baseline.schema !== SCAN_BASELINE_SCHEMA_ID) {
      d.list.push({
        code: "SCHEMA_UNSUPPORTED",
        reason: "unsupported-baseline",
        message: "The baseline contract is unsupported.",
        blocking: true,
        path: "/baseline/schema",
      });
      return { diagnostics: d.list };
    }
    if (!validBaseline(value.baseline))
      d.add(
        "baseline-invalid",
        "/baseline",
        "Release 1.5 and 1.6 require a supported, bounded baseline binding.",
      );
    else if (!baselineMatchesContent(value, value.baseline))
      d.add(
        "baseline-content-mismatch",
        "/baseline/inventory",
        "The baseline inventory differs from the complete release content projection.",
      );
    else {
      const reserved = [
        value.baseline.inventory.path,
        ...(value.baseline.artifact.location.kind === "package"
          ? [value.baseline.artifact.location.path]
          : []),
      ];
      for (const item of value.items as Record<string, unknown>[]) {
        for (const member of [item.recipe, ...(item.materials as unknown[])]) {
          if (
            isRecord(member) &&
            reserved.some(
              (path) => path.toLowerCase() === String(memberPackagePath(member)).toLowerCase(),
            )
          )
            d.add(
              "baseline-path-collision",
              "/baseline",
              "Inventory and evidence paths cannot overwrite declared content.",
            );
        }
      }
    }
  }
  if (d.list.length > 0) return { diagnostics: d.list };
  const items = value.items as Record<string, unknown>[];
  checkPathIdentities(d, items);
  checkRequiredClosure(d, items);
  if (d.list.length > 0) return { diagnostics: d.list };

  const checked = items.map((item) => {
    const { dependencies, ...rest } = item;
    return {
      ...rest,
      itemSha256: sha256Hex(encoder.encode(canonicalJson(item))),
      dependencies: normalizeDependencies(dependencies as Record<string, unknown>),
    } as unknown as CatalogItem;
  });
  return {
    diagnostics: [],
    document: {
      schema: value.schema as ReleaseSchemaId,
      package: pkg as { name: string; version: string },
      sources: value.sources as Json[],
      items: checked,
      ...(value.metadata === undefined ? {} : { metadata: value.metadata as Json }),
      ...(baselineFormat && !options.contentOnly
        ? { baseline: value.baseline as ScanBaseline }
        : {}),
      ...(value.framework === undefined ? {} : { framework: value.framework as Json }),
      ...(value.retired === undefined ? {} : { retired: value.retired as Json[] }),
      ...(value.nativeRoutes === undefined ? {} : { nativeRoutes: value.nativeRoutes as Json[] }),
    },
  };
}
