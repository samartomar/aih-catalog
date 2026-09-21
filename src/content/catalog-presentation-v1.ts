import { createHash } from "node:crypto";
import type { CatalogContentV1 } from "./catalog-content-v1.js";

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
 * This reader performs no network access, executes nothing and writes nothing.
 * Every refusal returns `undefined`.
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
const FIELD = /^(?:frontmatter\.[A-Za-z0-9_-]+|mcpServers\.[A-Za-z0-9_.@-]+\.description)$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused.
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const REASONS = ["not-declared", "unparsed", "no-source-file", "not-in-source-file"] as const;
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
  | { readonly state: "unavailable"; readonly reason: CatalogPresentationUnavailableReasonV1 };

export interface CatalogPresentationEntryV1 {
  readonly entryId: string;
  readonly subjectDigest: string;
  /** The upstream file the values were read from, at the entry's own repository and commit. */
  readonly source: { readonly path: string; readonly sha256: string } | null;
  readonly title: CatalogPresentationValueV1;
  readonly description: CatalogPresentationValueV1;
  readonly category: CatalogPresentationValueV1;
}

export interface CatalogPresentationSourceV1 {
  readonly type: "github";
  readonly repository: string;
  readonly commit: string;
}

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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
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
    if (!exactKeys(value, ["reason", "state"])) return undefined;
    if (!(REASONS as readonly unknown[]).includes(value.reason)) return undefined;
    return Object.freeze({
      state: "unavailable",
      reason: value.reason as CatalogPresentationUnavailableReasonV1,
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
 * Reads and validates the presentation sidecar against the index it describes.
 * Returns `undefined` for every refusal: unknown format or version, malformed,
 * non-canonical or oversize bytes, an unknown field, a source that is not a
 * pinned github commit, an entry absent from the index or with a different
 * subject digest or source, an indexed entry of a listed source left out, an
 * entry listed twice or out of order, or a malformed value.
 */
export function readCatalogPresentationV1(
  request: ReadCatalogPresentationV1Request,
): CatalogPresentationV1 | undefined {
  if (!isObject(request)) return undefined;
  const { bytes, index } = request;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return undefined;
  if (bytes.byteLength > CATALOG_PRESENTATION_MAX_BYTES_V1) return undefined;
  if (!isObject(index) || !Array.isArray(index.entries)) return undefined;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return undefined;
  const text = Buffer.from(bytes).toString("utf8");
  if (!Buffer.from(text, "utf8").equals(Buffer.from(bytes))) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  // The publisher emits one canonical serialization; a rewrite is refused.
  if (canonical(value) !== text) return undefined;
  if (!isObject(value) || !exactKeys(value, ["entries", "format", "sources", "version"])) {
    return undefined;
  }
  if (value.format !== CATALOG_PRESENTATION_FORMAT_V1) return undefined;
  if (value.version !== CATALOG_PRESENTATION_VERSION_V1) return undefined;

  if (!Array.isArray(value.sources) || value.sources.length === 0) return undefined;
  const sources: CatalogPresentationSourceV1[] = [];
  const sourceKeys = new Set<string>();
  for (const source of value.sources) {
    if (!isObject(source) || !exactKeys(source, ["commit", "repository", "type"])) return undefined;
    if (source.type !== "github" || !matches(source.repository, REPOSITORY)) return undefined;
    if (!matches(source.commit, GIT_COMMIT)) return undefined;
    const key = `${source.repository}@${source.commit}`;
    if (sourceKeys.has(key)) return undefined;
    sourceKeys.add(key);
    sources.push(
      Object.freeze({ type: "github", repository: source.repository, commit: source.commit }),
    );
  }

  const indexed = index.entries.filter((entry) => {
    const source = entry.subject.source;
    return source.type === "github" && sourceKeys.has(`${source.repository}@${source.commit}`);
  });
  const byId = new Map(indexed.map((entry) => [entry.entryId, entry]));

  if (!Array.isArray(value.entries)) return undefined;
  const entries: CatalogPresentationEntryV1[] = [];
  for (const raw of value.entries) {
    if (!isObject(raw)) return undefined;
    if (
      !exactKeys(raw, ["category", "description", "entryId", "source", "subjectDigest", "title"])
    ) {
      return undefined;
    }
    const { entryId, subjectDigest } = raw;
    if (typeof entryId !== "string" || !matches(subjectDigest, PREFIXED_SHA256)) return undefined;
    const previous = entries.at(-1);
    if (previous !== undefined && previous.entryId >= entryId) return undefined;
    // Each record is that exact index entry, of a listed source.
    const entry = byId.get(entryId);
    if (entry === undefined || entry.subject.subjectDigest !== subjectDigest) return undefined;

    let source: CatalogPresentationEntryV1["source"] = null;
    if (raw.source !== null) {
      const declared = raw.source;
      if (!isObject(declared) || !exactKeys(declared, ["path", "sha256"])) return undefined;
      if (!sourcePath(declared.path) || !matches(declared.sha256, SHA256_HEX)) return undefined;
      source = Object.freeze({ path: declared.path, sha256: declared.sha256 });
    }
    const title = presentationValue(raw.title, source !== null);
    const description = presentationValue(raw.description, source !== null);
    const category = presentationValue(raw.category, source !== null);
    if (title === undefined || description === undefined || category === undefined)
      return undefined;
    entries.push(Object.freeze({ entryId, subjectDigest, source, title, description, category }));
  }
  // Every indexed entry of a listed source is covered.
  if (entries.length !== indexed.length) return undefined;

  const count = (name: CatalogPresentationFieldNameV1) => {
    const published = entries.filter((entry) => entry[name].state === "published").length;
    return Object.freeze({ published, unavailable: entries.length - published });
  };
  return Object.freeze({
    format: CATALOG_PRESENTATION_FORMAT_V1,
    version: CATALOG_PRESENTATION_VERSION_V1,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
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
