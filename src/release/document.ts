/**
 * Structural and semantic checks for `urn:aihq:catalog:release:1.0.0`, matching
 * schemas/release/1.0.0.json plus the reader-only rules that schema documents.
 * Portable: no Node built-ins.
 */
import {
  type CatalogDiagnostic,
  type CatalogItem,
  CORE_RECIPE_SCHEMA_ID,
  type InputSpec,
  type Json,
  RELEASE_SCHEMA_ID,
} from "./contracts.js";
import { checkInputSpec } from "./inputs.js";
import { assertStrictValues, canonicalJson } from "./json.js";
import { sha256Hex } from "./sha256.js";

export const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const SHA256 = /^[0-9a-f]{64}$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const HTTPS_URL = /^https:\/\/[^\s/?#@]+(?:[/?][^\s#]*)?$/;
const GIT_REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SRI = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/;
const KIND = /^[a-z][a-z0-9-]{0,63}$/;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MEMBER_MAX = 16 * 1024 * 1024;
const RECIPE_MAX = 1_000_000;
const ARCHIVE_MAX = 64 * 1024 * 1024;
const encoder = new TextEncoder();

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

const isId = (value: unknown): value is string =>
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

/** Exact field set: unknown fields and missing required fields are both named. */
function fields(
  d: Diagnostics,
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

export function checkMaterialSource(d: Diagnostics, value: unknown, path: string): boolean {
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

function checkOrigin(d: Diagnostics, value: unknown, path: string): void {
  const bad = () =>
    d.add("invalid-origin", path, "Expected a pinned git, exact npm or authored origin.");
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
      !VERSION.test(value.version) ||
      typeof value.integrity !== "string" ||
      !SRI.test(value.integrity)
    ) {
      bad();
    }
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

function checkInputs(d: Diagnostics, value: unknown, path: string): void {
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

function checkDependencies(d: Diagnostics, value: unknown, path: string): void {
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

function checkItem(
  d: Diagnostics,
  value: unknown,
  path: string,
  sources: ReadonlySet<string>,
): void {
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
      ["description", "metadata"],
    )
  ) {
    return;
  }
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
    if (recipe.schema !== CORE_RECIPE_SCHEMA_ID) {
      d.add("unsupported-recipe-schema", `${path}/recipe/schema`, "Items use Core recipe 1.0.0.", {
        encountered: typeof recipe.schema === "string" ? recipe.schema.slice(0, 128) : undefined,
        supported: [CORE_RECIPE_SCHEMA_ID],
      });
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
      if (!fields(d, member, at, ["id", "path", "sha256", "byteLength"])) return;
      if (id(d, member.id, `${at}/id`)) ids.push(member.id);
      memberPath(d, member.path, `${at}/path`);
      sha(d, member.sha256, `${at}/sha256`);
      length(d, member.byteLength, `${at}/byteLength`, 0, MEMBER_MAX);
    });
    ascending(d, ids, `${path}/materials`);
  }
  checkDependencies(d, value.dependencies, `${path}/dependencies`);
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    d.add("invalid-metadata", `${path}/metadata`, "Metadata is a descriptive object.");
  }
}

/** Paths are package members: one path names one byte identity across the whole release. */
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
      const prior = seen.get(value.path as string);
      if (prior !== undefined && prior !== identity) {
        d.add("inconsistent-material-path", at, "One path is declared with different bytes.");
      }
      seen.set(value.path as string, identity);
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
  readonly package: { readonly name: string; readonly version: string };
  readonly sources: readonly Json[];
  readonly items: readonly CatalogItem[];
  readonly metadata?: Json;
}

/** Checks a canonical release value; returns the normalized items or diagnostics. */
export function checkReleaseDocument(value: unknown): {
  readonly diagnostics: readonly CatalogDiagnostic[];
  readonly document?: CheckedDocument;
} {
  const d = new Diagnostics();
  if (isRecord(value) && Object.hasOwn(value, "schema") && value.schema !== RELEASE_SCHEMA_ID) {
    d.list.push(
      Object.freeze({
        code: "SCHEMA_UNSUPPORTED",
        reason: "unsupported-schema",
        message: "This release format is not supported.",
        blocking: true,
        path: "/schema",
        encountered:
          typeof value.schema === "string" ? value.schema.slice(0, 128) : String(value.schema),
        supported: [RELEASE_SCHEMA_ID],
      }),
    );
    return { diagnostics: d.list };
  }
  if (!fields(d, value, "", ["schema", "package", "sources", "items"], ["metadata"])) {
    return { diagnostics: d.list };
  }
  const pkg = value.package;
  if (fields(d, pkg, "/package", ["name", "version"])) {
    if (typeof pkg.name !== "string" || pkg.name.length > 214 || !PACKAGE_NAME.test(pkg.name)) {
      d.add("invalid-package", "/package/name", "Expected an npm package name.");
    }
    if (typeof pkg.version !== "string" || pkg.version.length > 256 || !VERSION.test(pkg.version)) {
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
      if (!fields(d, source, at, ["id", "origin"])) return;
      if (id(d, source.id, `${at}/id`)) {
        ids.push(source.id);
        sourceIds.add(source.id);
      }
      checkOrigin(d, source.origin, `${at}/origin`);
    });
    ascending(d, ids, "/sources");
  }
  if (!Array.isArray(value.items)) d.add("invalid-type", "/items", "Expected an array.");
  else {
    for (const [index, item] of value.items.entries()) {
      checkItem(d, item, `/items/${index}`, sourceIds);
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
      package: pkg as { name: string; version: string },
      sources: value.sources as Json[],
      items: checked,
      ...(value.metadata === undefined ? {} : { metadata: value.metadata as Json }),
    },
  };
}
