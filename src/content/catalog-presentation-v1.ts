import type { CatalogContentV1 } from "./catalog-content-v1.js";
import {
  type CatalogReadRefusedV1,
  isObject,
  readCanonicalDocument,
  refuse,
  refusedFrom,
  requireAscending,
  requireFormatAndVersion,
} from "./refusal-v1.js";

/**
 * Public, Catalog-owned reading of the presentation sidecar: each indexed item's
 * publisher title, description and category exactly as its upstream source file
 * declares them, with the path and sha256 of that file.
 *
 * It is additive and display-only. It never changes an entry's identity,
 * artifacts or evidence, and says nothing about scanning, qualification,
 * admission or policy. A value is either `published` (verbatim, with the field it
 * came from) or `unavailable` with a reason; nothing is inferred, classified or
 * summarized. Every index entry of a listed source is covered exactly once, so a
 * missing value is an explicit result, never a missing item.
 *
 * Text is upstream data: render it as text, never as markup or instructions.
 * Aih MCP availability is `available` or `request-only`; a request-only value
 * carries bounded declaration reason text. Management is `aih-managed` for
 * available local controls, `aih-owned-unavailable` for unavailable local
 * controls, or `developer-managed` for hosted services. The generator and
 * checker bind these fields to the digest-named Core declaration.
 * This reader performs no network access, executes nothing and writes nothing.
 * `readCatalogPresentationV1Result` names every refusal;
 * `readCatalogPresentationV1` returns `undefined` for each of them.
 */

export const CATALOG_PRESENTATION_FORMAT_V1 = "aih-catalog-presentation";
export const CATALOG_PRESENTATION_VERSION_V1 = 1;
/** Root-relative location of the sidecar inside the installed package. */
export const CATALOG_PRESENTATION_ROOT_URL = "defaults/catalog-presentation-v1.json";
/** Public subpath export carrying those bytes: `@aihq/catalog/catalog-presentation.json`. */
export const CATALOG_PRESENTATION_SUBPATH_V1 = "./catalog-presentation.json";
export const CATALOG_PRESENTATION_MAX_BYTES_V1 = 8 * 1024 * 1024;
export const CATALOG_PRESENTATION_MAX_TEXT_V1 = 4096;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const PREFIXED_SHA256 = /^sha256:[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PATH_SEGMENT = /^[A-Za-z0-9_.@+-]+$/;
const FIELD =
  /^(?:frontmatter\.[A-Za-z0-9_-]+|mcpServers\.[A-Za-z0-9_.@-]+\.description|coreMcp\.[A-Za-z0-9-]+\.description)$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused.
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const REASONS = [
  "not-declared",
  "unparsed",
  "no-source-file",
  "not-in-source-file",
  "license-restricted",
  "license-not-determined",
] as const;
const FIELDS = ["title", "description", "category"] as const;

export type CatalogPresentationUnavailableReasonV1 = (typeof REASONS)[number];
export type CatalogPresentationFieldNameV1 = (typeof FIELDS)[number];

export type CatalogPresentationValueV1 =
  | {
      readonly state: "published";
      /** Verbatim upstream text. Render as text only. */
      readonly value: string;
      /** Where in the source file it was read, e.g. `frontmatter.description`. */
      readonly field: string;
    }
  | {
      readonly state: "unavailable";
      readonly reason: CatalogPresentationUnavailableReasonV1;
      readonly message?: string;
    };

export interface CatalogPresentationEntryV1 {
  readonly entryId: string;
  readonly subjectDigest: string;
  /** The upstream file the values were read from, at the entry's own repository and commit. */
  readonly source: { readonly path: string; readonly sha256: string } | null;
  readonly title: CatalogPresentationValueV1;
  readonly description: CatalogPresentationValueV1;
  readonly category: CatalogPresentationValueV1;
  readonly availability?: "available" | "request-only";
  readonly availabilityReason?: string;
  readonly management?: "aih-managed" | "developer-managed" | "aih-owned-unavailable";
  readonly managementNote?: string;
}

export type CatalogPresentationSourceV1 =
  | { readonly type: "github"; readonly repository: string; readonly commit: string }
  | {
      readonly type: "aih";
      readonly release: string;
      readonly declarationPath: string;
      readonly declarationSha256: string;
    };

export interface CatalogPresentationV1 {
  readonly format: typeof CATALOG_PRESENTATION_FORMAT_V1;
  readonly version: typeof CATALOG_PRESENTATION_VERSION_V1;
  /** `sha256:<64 hex>` over the exact sidecar bytes read. */
  readonly digest: string;
  /** Upstream sources whose every indexed entry is covered. */
  readonly sources: readonly CatalogPresentationSourceV1[];
  readonly entries: readonly CatalogPresentationEntryV1[];
  /** Counted from `entries`: how many values are published versus unavailable. */
  readonly coverage: {
    readonly entries: number;
  } & Readonly<
    Record<
      CatalogPresentationFieldNameV1,
      { readonly published: number; readonly unavailable: number }
    >
  >;
}

export interface ReadCatalogPresentationV1Request {
  /** The exact sidecar bytes, normally read from the installed package root. */
  readonly bytes: Uint8Array;
  /** The index the entries must belong to, as returned by `readCatalogContentV1`. */
  readonly index: CatalogContentV1;
}

/** Every reason `readCatalogPresentationV1Result` can refuse with. A closed set. */
export const CATALOG_PRESENTATION_REFUSALS_V1 = [
  "malformed-request",
  "malformed-bytes",
  "oversize-bytes",
  "non-canonical-bytes",
  "malformed-document",
  "unknown-format",
  "unknown-version",
  "malformed-source",
  "index-mismatch",
  "malformed-entry",
  "unsafe-path",
  "duplicate-entry",
  "unordered-entries",
  "coverage-incomplete",
] as const;
export type CatalogPresentationRefusalV1 = (typeof CATALOG_PRESENTATION_REFUSALS_V1)[number];

export type CatalogPresentationV1Result =
  | { readonly state: "read"; readonly presentation: CatalogPresentationV1 }
  | CatalogReadRefusedV1<CatalogPresentationRefusalV1>;

const matches = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.test(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const present = Object.keys(value);
  return present.length === keys.length && present.every((key) => keys.includes(key));
};

function sourcePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) return false;
  return value
    .split("/")
    .every((segment) => segment !== "." && segment !== ".." && PATH_SEGMENT.test(segment));
}

function presentationValue(
  value: unknown,
  hasSource: boolean,
): CatalogPresentationValueV1 | undefined {
  if (!isObject(value)) return undefined;
  if (value.state === "unavailable") {
    if (!(REASONS as readonly unknown[]).includes(value.reason)) return undefined;
    const licensed =
      value.reason === "license-restricted" || value.reason === "license-not-determined";
    if (!exactKeys(value, licensed ? ["message", "reason", "state"] : ["reason", "state"]))
      return undefined;
    if (
      licensed &&
      (typeof value.message !== "string" ||
        value.message.length === 0 ||
        value.message.length > CATALOG_PRESENTATION_MAX_TEXT_V1 ||
        CONTROL.test(value.message))
    )
      return undefined;
    return Object.freeze({
      state: "unavailable",
      reason: value.reason as CatalogPresentationUnavailableReasonV1,
      ...(licensed ? { message: value.message as string } : {}),
    });
  }
  if (value.state !== "published" || !exactKeys(value, ["field", "state", "value"]))
    return undefined;
  // A published value always names the file it was read from.
  if (!hasSource || !matches(value.field, FIELD)) return undefined;
  const text = value.value;
  if (typeof text !== "string" || text.length === 0) return undefined;
  if (text.length > CATALOG_PRESENTATION_MAX_TEXT_V1 || CONTROL.test(text)) return undefined;
  return Object.freeze({ state: "published", value: text, field: value.field });
}

/**
 * Reads and validates the presentation sidecar against the index it describes,
 * naming why it refuses: `unknown-format` and `unknown-version` (each with the
 * declared value in `observed`), malformed, oversize or non-canonical bytes, a
 * source that is not a pinned github commit or is listed twice
 * (`malformed-source`), an entry absent from the index, of an unlisted source or
 * with a different subject digest (`index-mismatch`), a malformed record or
 * value, an unsafe source path, an entry listed twice or out of order, or an
 * indexed entry of a listed source left out (`coverage-incomplete`).
 */
export function readCatalogPresentationV1Result(
  request: ReadCatalogPresentationV1Request,
): CatalogPresentationV1Result {
  try {
    return Object.freeze({ state: "read" as const, presentation: readPresentation(request) });
  } catch (error) {
    return refusedFrom<CatalogPresentationRefusalV1>(error);
  }
}

/**
 * Reads and validates the presentation sidecar against the index it describes.
 * Returns `undefined` for every refusal: unknown format or version, malformed,
 * non-canonical or oversize bytes, an unknown field, a source that is not a
 * pinned github commit, an entry absent from the index or with a different
 * subject digest or source, an indexed entry of a listed source left out, an
 * entry listed twice or out of order, or a malformed value. Use
 * `readCatalogPresentationV1Result` to learn which.
 */
export function readCatalogPresentationV1(
  request: ReadCatalogPresentationV1Request,
): CatalogPresentationV1 | undefined {
  const result = readCatalogPresentationV1Result(request);
  return result.state === "read" ? result.presentation : undefined;
}

function readPresentation(request: ReadCatalogPresentationV1Request): CatalogPresentationV1 {
  if (!isObject(request)) return refuse("malformed-request");
  const { index } = request;
  if (!isObject(index) || !Array.isArray(index.entries)) return refuse("malformed-request");
  const { value, digest } = readCanonicalDocument({
    bytes: request.bytes,
    maxBytes: CATALOG_PRESENTATION_MAX_BYTES_V1,
    canonical,
  });
  requireFormatAndVersion(value, CATALOG_PRESENTATION_FORMAT_V1, CATALOG_PRESENTATION_VERSION_V1);
  if (!exactKeys(value, ["entries", "format", "sources", "version"])) {
    return refuse("malformed-document");
  }

  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    return refuse("malformed-document");
  }
  const sources: CatalogPresentationSourceV1[] = [];
  const sourceKeys = new Set<string>();
  for (const source of value.sources) {
    if (!isObject(source)) {
      return refuse("malformed-source");
    }
    let key: string;
    if (
      source.type === "github" &&
      exactKeys(source, ["commit", "repository", "type"]) &&
      matches(source.repository, REPOSITORY) &&
      matches(source.commit, GIT_COMMIT)
    ) {
      key = `github:${source.repository}@${source.commit}`;
      sources.push(
        Object.freeze({ type: "github", repository: source.repository, commit: source.commit }),
      );
    } else if (
      source.type === "aih" &&
      exactKeys(source, ["declarationPath", "declarationSha256", "release", "type"]) &&
      source.release === "0.7.0" &&
      source.declarationPath === "src/production/data/core-product-declarations-v1.json" &&
      matches(source.declarationSha256, SHA256_HEX)
    ) {
      key = `aih:${source.release}`;
      sources.push(
        Object.freeze({
          type: "aih",
          release: source.release,
          declarationPath: source.declarationPath,
          declarationSha256: source.declarationSha256,
        }),
      );
    } else return refuse("malformed-source");
    if (sourceKeys.has(key)) return refuse("malformed-source");
    sourceKeys.add(key);
  }

  const indexed = index.entries.filter((entry) => {
    const source = entry.subject.source;
    return source.type === "github"
      ? sourceKeys.has(`github:${source.repository}@${source.commit}`)
      : source.type === "aih" &&
          entry.subject.kind === "mcp" &&
          sourceKeys.has(`aih:${source.release}`);
  });
  const byId = new Map(indexed.map((entry) => [entry.entryId, entry]));

  if (!Array.isArray(value.entries)) return refuse("malformed-document");
  const entries: CatalogPresentationEntryV1[] = [];
  for (const raw of value.entries) {
    if (!isObject(raw)) return refuse("malformed-entry");
    const { entryId, subjectDigest } = raw;
    if (typeof entryId !== "string" || !matches(subjectDigest, PREFIXED_SHA256)) {
      return refuse("malformed-entry");
    }
    requireAscending(entries.at(-1)?.entryId, entryId);
    // Each record is that exact index entry, of a listed source.
    const entry = byId.get(entryId);
    if (entry === undefined || entry.subject.subjectDigest !== subjectDigest) {
      return refuse("index-mismatch");
    }
    const aih = entry.subject.source.type === "aih";
    const required = ["category", "description", "entryId", "source", "subjectDigest", "title"];
    const hosted = aih && (entry.subject.id === "github" || entry.subject.id === "context7");
    const requestOnly = aih && raw.availability === "request-only";
    if (aih) required.push("availability", "management");
    if (requestOnly) required.push("availabilityReason");
    if (hosted) required.push("managementNote");
    if (!exactKeys(raw, required)) return refuse("malformed-entry");

    let source: CatalogPresentationEntryV1["source"] = null;
    if (raw.source !== null) {
      const declared = raw.source;
      if (!isObject(declared) || !exactKeys(declared, ["path", "sha256"])) {
        return refuse("malformed-entry");
      }
      if (!matches(declared.sha256, SHA256_HEX)) return refuse("malformed-entry");
      if (!sourcePath(declared.path)) return refuse("unsafe-path");
      source = Object.freeze({ path: declared.path, sha256: declared.sha256 });
    }
    if (aih) {
      const listed = sources.find((candidate) => candidate.type === "aih");
      if (
        listed?.type !== "aih" ||
        source?.path !== listed.declarationPath ||
        source.sha256 !== listed.declarationSha256
      )
        return refuse("index-mismatch");
      if (
        (raw.availability !== "available" && raw.availability !== "request-only") ||
        raw.management !==
          (hosted ? "developer-managed" : requestOnly ? "aih-owned-unavailable" : "aih-managed")
      )
        return refuse("malformed-entry");
      if (
        requestOnly &&
        (typeof raw.availabilityReason !== "string" ||
          raw.availabilityReason.length === 0 ||
          raw.availabilityReason.length > CATALOG_PRESENTATION_MAX_TEXT_V1 ||
          CONTROL.test(raw.availabilityReason))
      )
        return refuse("malformed-entry");
      if (
        hosted &&
        raw.managementNote !==
          "hosted service; network egress; selecting records intent; aih does not run or project it"
      )
        return refuse("malformed-entry");
    }
    const title = presentationValue(raw.title, source !== null);
    const description = presentationValue(raw.description, source !== null);
    const category = presentationValue(raw.category, source !== null);
    if (title === undefined || description === undefined || category === undefined) {
      return refuse("malformed-entry");
    }
    entries.push(
      Object.freeze({
        entryId,
        subjectDigest,
        source,
        title,
        description,
        category,
        ...(aih
          ? {
              availability: raw.availability as "available" | "request-only",
              management: raw.management as
                | "aih-managed"
                | "developer-managed"
                | "aih-owned-unavailable",
              ...(raw.availabilityReason === undefined
                ? {}
                : { availabilityReason: raw.availabilityReason as string }),
              ...(raw.managementNote === undefined
                ? {}
                : { managementNote: raw.managementNote as string }),
            }
          : {}),
      }),
    );
  }
  // Every indexed entry of a listed source is covered.
  if (entries.length !== indexed.length) return refuse("coverage-incomplete");

  const count = (name: CatalogPresentationFieldNameV1) => {
    const published = entries.filter((entry) => entry[name].state === "published").length;
    return Object.freeze({ published, unavailable: entries.length - published });
  };
  return Object.freeze({
    format: CATALOG_PRESENTATION_FORMAT_V1,
    version: CATALOG_PRESENTATION_VERSION_V1,
    digest,
    sources: Object.freeze(sources),
    entries: Object.freeze(entries),
    coverage: Object.freeze({
      entries: entries.length,
      title: count("title"),
      description: count("description"),
      category: count("category"),
    }),
  });
}

function canonical(value: unknown): string {
  return `${serialize(value)}\n`;
}

function serialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => `${JSON.stringify(key)}:${serialize(object[key])}`)
    .join(",")}}`;
}
