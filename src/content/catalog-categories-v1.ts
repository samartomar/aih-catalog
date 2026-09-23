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
 * Public, Catalog-owned reading of the curated category dataset: one category
 * from a small published taxonomy, or an explicit `null`, for every index entry.
 *
 * This is curation by the AIH catalog maintainers, who edit it through a
 * committed rules file. It is not an upstream declaration (the presentation
 * sidecar carries what upstream declares) and not a classification made by any
 * UI. Every assignment carries a one-sentence rationale naming the upstream
 * evidence and the rule used. `category: null` with `reason: "not-curated"`
 * means no rule assigned one; it is an explicit result, never a missing item.
 *
 * A category is display and navigation data only. It says nothing about
 * scanning, qualification, admission or policy. This reader performs no network
 * access, executes nothing and writes nothing. `readCatalogCategoriesV1Result`
 * names every refusal; `readCatalogCategoriesV1` returns `undefined` for each.
 */

export const CATALOG_CATEGORIES_FORMAT_V1 = "aih-catalog-categories";
export const CATALOG_CATEGORIES_VERSION_V1 = 1;
/** Root-relative location of the dataset inside the installed package. */
export const CATALOG_CATEGORIES_ROOT_URL = "defaults/catalog-categories-v1.json";
/** Public subpath export carrying those bytes: `@aihq/catalog/catalog-categories.json`. */
export const CATALOG_CATEGORIES_SUBPATH_V1 = "./catalog-categories.json";
export const CATALOG_CATEGORIES_MAX_BYTES_V1 = 4 * 1024 * 1024;
export const CATALOG_CATEGORIES_MAX_TAXONOMY_V1 = 32;

const PREFIXED_SHA256 = /^sha256:[0-9a-f]{64}$/;
const TAXONOMY_ID = /^[a-z][a-z0-9-]{0,31}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused.
const CONTROL = /[\u0000-\u001f\u007f]/;

export interface CatalogCategoryV1 {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export type CatalogCategoryEntryV1 =
  | {
      readonly entryId: string;
      readonly subjectDigest: string;
      readonly reason: "curated";
      /** A taxonomy id. */
      readonly category: string;
      /** One sentence naming the upstream evidence and the rule used. */
      readonly rationale: string;
    }
  | {
      readonly entryId: string;
      readonly subjectDigest: string;
      readonly reason: "not-curated";
      readonly category: null;
      readonly rationale: null;
    };

export interface CatalogCategoriesV1 {
  readonly format: typeof CATALOG_CATEGORIES_FORMAT_V1;
  readonly version: typeof CATALOG_CATEGORIES_VERSION_V1;
  /** `sha256:<64 hex>` over the exact bytes read. */
  readonly digest: string;
  /** Always `"curated"`: maintainers' curation, never an upstream declaration. */
  readonly basis: "curated";
  readonly curatedBy: string;
  readonly curatedAt: string;
  readonly taxonomy: readonly CatalogCategoryV1[];
  readonly entries: readonly CatalogCategoryEntryV1[];
  readonly coverage: {
    readonly entries: number;
    readonly curated: number;
    readonly notCurated: number;
    readonly byCategory: Readonly<Record<string, number>>;
  };
}

export interface ReadCatalogCategoriesV1Request {
  readonly bytes: Uint8Array;
  /** The index every entry must belong to, as returned by `readCatalogContentV1`. */
  readonly index: CatalogContentV1;
  /** Optional pin. A mismatch is a refusal, never a repair. */
  readonly expectedDigest?: string;
}

/** Every reason `readCatalogCategoriesV1Result` can refuse with. A closed set. */
export const CATALOG_CATEGORIES_REFUSALS_V1 = [
  "malformed-request",
  "malformed-bytes",
  "oversize-bytes",
  "non-canonical-bytes",
  "digest-mismatch",
  "malformed-document",
  "unknown-format",
  "unknown-version",
  "malformed-taxonomy",
  "malformed-entry",
  "index-mismatch",
  "unknown-category",
  "duplicate-entry",
  "unordered-entries",
  "coverage-incomplete",
] as const;
export type CatalogCategoriesRefusalV1 = (typeof CATALOG_CATEGORIES_REFUSALS_V1)[number];

export type CatalogCategoriesV1Result =
  | { readonly state: "read"; readonly categories: CatalogCategoriesV1 }
  | CatalogReadRefusedV1<CatalogCategoriesRefusalV1>;

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const present = Object.keys(value);
  return present.length === keys.length && present.every((key) => keys.includes(key));
};
const boundedText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && !CONTROL.test(value);

/**
 * Reads and validates the curated category dataset against the index it
 * describes, naming why it refuses: `unknown-format` and `unknown-version` (each
 * with the declared value in `observed`), malformed, oversize or non-canonical
 * bytes, a digest pin mismatch, a malformed document (an unknown member, a basis
 * other than `curated`, a malformed curator or instant), a malformed or unsorted
 * taxonomy, a malformed record or rationale, an entry absent from the index or
 * with a different subject digest (`index-mismatch`), a category outside the
 * taxonomy, an entry listed twice or out of order, or an index entry left out
 * (`coverage-incomplete`).
 */
export function readCatalogCategoriesV1Result(
  request: ReadCatalogCategoriesV1Request,
): CatalogCategoriesV1Result {
  try {
    return Object.freeze({ state: "read" as const, categories: readCategories(request) });
  } catch (error) {
    return refusedFrom<CatalogCategoriesRefusalV1>(error);
  }
}

/**
 * Reads and validates the curated category dataset against the index it
 * describes. Returns `undefined` for every refusal `readCatalogCategoriesV1Result`
 * names.
 */
export function readCatalogCategoriesV1(
  request: ReadCatalogCategoriesV1Request,
): CatalogCategoriesV1 | undefined {
  const result = readCatalogCategoriesV1Result(request);
  return result.state === "read" ? result.categories : undefined;
}

function readCategories(request: ReadCatalogCategoriesV1Request): CatalogCategoriesV1 {
  if (!isObject(request)) return refuse("malformed-request");
  const { index } = request;
  if (!isObject(index) || !Array.isArray(index.entries)) return refuse("malformed-request");
  const { value, digest } = readCanonicalDocument({
    bytes: request.bytes,
    maxBytes: CATALOG_CATEGORIES_MAX_BYTES_V1,
    expectedDigest: request.expectedDigest,
    canonical,
  });
  requireFormatAndVersion(value, CATALOG_CATEGORIES_FORMAT_V1, CATALOG_CATEGORIES_VERSION_V1);
  if (
    !exactKeys(value, [
      "basis",
      "curatedAt",
      "curatedBy",
      "entries",
      "format",
      "taxonomy",
      "version",
    ])
  ) {
    return refuse("malformed-document");
  }
  if (value.basis !== "curated") return refuse("malformed-document");
  if (!boundedText(value.curatedBy, 128)) return refuse("malformed-document");
  if (typeof value.curatedAt !== "string" || !INSTANT.test(value.curatedAt)) {
    return refuse("malformed-document");
  }

  if (!Array.isArray(value.taxonomy) || value.taxonomy.length === 0) {
    return refuse("malformed-taxonomy");
  }
  if (value.taxonomy.length > CATALOG_CATEGORIES_MAX_TAXONOMY_V1) {
    return refuse("malformed-taxonomy");
  }
  const taxonomy: CatalogCategoryV1[] = [];
  for (const raw of value.taxonomy) {
    if (!isObject(raw) || !exactKeys(raw, ["description", "id", "label"])) {
      return refuse("malformed-taxonomy");
    }
    if (typeof raw.id !== "string" || !TAXONOMY_ID.test(raw.id)) {
      return refuse("malformed-taxonomy");
    }
    if (!boundedText(raw.label, 64) || !boundedText(raw.description, 512)) {
      return refuse("malformed-taxonomy");
    }
    const previous = taxonomy.at(-1);
    if (previous !== undefined && previous.id >= raw.id) return refuse("malformed-taxonomy");
    taxonomy.push(Object.freeze({ id: raw.id, label: raw.label, description: raw.description }));
  }
  const known = new Set(taxonomy.map((item) => item.id));

  if (!Array.isArray(value.entries)) return refuse("malformed-document");
  const indexed = new Map(index.entries.map((entry) => [entry.entryId, entry]));
  const entries: CatalogCategoryEntryV1[] = [];
  const byCategory: Record<string, number> = Object.fromEntries(taxonomy.map(({ id }) => [id, 0]));
  for (const raw of value.entries) {
    if (!isObject(raw) || !exactKeys(raw, ["category", "entryId", "rationale", "subjectDigest"])) {
      return refuse("malformed-entry");
    }
    const { entryId, subjectDigest, category, rationale } = raw;
    if (typeof entryId !== "string" || typeof subjectDigest !== "string") {
      return refuse("malformed-entry");
    }
    if (!PREFIXED_SHA256.test(subjectDigest)) return refuse("malformed-entry");
    requireAscending(entries.at(-1)?.entryId, entryId);
    // Each record is that exact index entry.
    if (indexed.get(entryId)?.subject.subjectDigest !== subjectDigest) {
      return refuse("index-mismatch");
    }
    if (category === null) {
      if (rationale !== null) return refuse("malformed-entry");
      entries.push(
        Object.freeze({
          entryId,
          subjectDigest,
          reason: "not-curated",
          category: null,
          rationale: null,
        }),
      );
      continue;
    }
    if (typeof category !== "string" || !known.has(category)) return refuse("unknown-category");
    if (!boundedText(rationale, 512)) return refuse("malformed-entry");
    byCategory[category] = (byCategory[category] ?? 0) + 1;
    entries.push(Object.freeze({ entryId, subjectDigest, reason: "curated", category, rationale }));
  }
  // Total coverage: every index entry appears exactly once.
  if (entries.length !== index.entries.length) return refuse("coverage-incomplete");

  const curated = entries.filter((entry) => entry.category !== null).length;
  return Object.freeze({
    format: CATALOG_CATEGORIES_FORMAT_V1,
    version: CATALOG_CATEGORIES_VERSION_V1,
    digest,
    basis: "curated",
    curatedBy: value.curatedBy,
    curatedAt: value.curatedAt,
    taxonomy: Object.freeze(taxonomy),
    entries: Object.freeze(entries),
    coverage: Object.freeze({
      entries: entries.length,
      curated,
      notCurated: entries.length - curated,
      byCategory: Object.freeze(byCategory),
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
