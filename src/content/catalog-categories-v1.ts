import { createHash } from "node:crypto";
import type { CatalogContentV1 } from "./catalog-content-v1.js";

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
 * access, executes nothing and writes nothing. Every refusal returns `undefined`.
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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const present = Object.keys(value);
  return present.length === keys.length && present.every((key) => keys.includes(key));
};
const boundedText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && !CONTROL.test(value);

/**
 * Reads and validates the curated category dataset against the index it
 * describes. Returns `undefined` for every refusal: a byte order mark, bytes
 * that are not exactly round-trippable UTF-8, non-canonical or oversize bytes, a
 * pin mismatch, an unknown format, version, basis or member, a malformed or
 * unsorted taxonomy, an entry absent from the index or with a different subject
 * digest, an entry listed twice or out of order, an index entry left out, a
 * category outside the taxonomy, or a rationale that is missing, present on a
 * `null` category, oversize or carries control characters.
 */
export function readCatalogCategoriesV1(
  request: ReadCatalogCategoriesV1Request,
): CatalogCategoriesV1 | undefined {
  if (!isObject(request)) return undefined;
  const { bytes, index } = request;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return undefined;
  if (bytes.byteLength > CATALOG_CATEGORIES_MAX_BYTES_V1) return undefined;
  if (!isObject(index) || !Array.isArray(index.entries)) return undefined;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return undefined;
  const text = Buffer.from(bytes).toString("utf8");
  if (!Buffer.from(text, "utf8").equals(Buffer.from(bytes))) return undefined;
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (request.expectedDigest !== undefined && request.expectedDigest !== digest) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  // The publisher emits one canonical serialization; a rewrite is refused.
  if (canonical(value) !== text) return undefined;
  if (
    !isObject(value) ||
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
    return undefined;
  }
  if (value.format !== CATALOG_CATEGORIES_FORMAT_V1) return undefined;
  if (value.version !== CATALOG_CATEGORIES_VERSION_V1) return undefined;
  if (value.basis !== "curated") return undefined;
  if (!boundedText(value.curatedBy, 128)) return undefined;
  if (typeof value.curatedAt !== "string" || !INSTANT.test(value.curatedAt)) return undefined;

  if (!Array.isArray(value.taxonomy) || value.taxonomy.length === 0) return undefined;
  if (value.taxonomy.length > CATALOG_CATEGORIES_MAX_TAXONOMY_V1) return undefined;
  const taxonomy: CatalogCategoryV1[] = [];
  for (const raw of value.taxonomy) {
    if (!isObject(raw) || !exactKeys(raw, ["description", "id", "label"])) return undefined;
    if (typeof raw.id !== "string" || !TAXONOMY_ID.test(raw.id)) return undefined;
    if (!boundedText(raw.label, 64) || !boundedText(raw.description, 512)) return undefined;
    const previous = taxonomy.at(-1);
    if (previous !== undefined && previous.id >= raw.id) return undefined;
    taxonomy.push(Object.freeze({ id: raw.id, label: raw.label, description: raw.description }));
  }
  const known = new Set(taxonomy.map((item) => item.id));

  if (!Array.isArray(value.entries)) return undefined;
  const indexed = new Map(index.entries.map((entry) => [entry.entryId, entry]));
  const entries: CatalogCategoryEntryV1[] = [];
  const byCategory: Record<string, number> = Object.fromEntries(taxonomy.map(({ id }) => [id, 0]));
  for (const raw of value.entries) {
    if (!isObject(raw) || !exactKeys(raw, ["category", "entryId", "rationale", "subjectDigest"])) {
      return undefined;
    }
    const { entryId, subjectDigest, category, rationale } = raw;
    if (typeof entryId !== "string" || typeof subjectDigest !== "string") return undefined;
    if (!PREFIXED_SHA256.test(subjectDigest)) return undefined;
    const previous = entries.at(-1);
    if (previous !== undefined && previous.entryId >= entryId) return undefined;
    // Each record is that exact index entry.
    if (indexed.get(entryId)?.subject.subjectDigest !== subjectDigest) return undefined;
    if (category === null) {
      if (rationale !== null) return undefined;
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
    if (typeof category !== "string" || !known.has(category)) return undefined;
    if (!boundedText(rationale, 512)) return undefined;
    byCategory[category] = (byCategory[category] ?? 0) + 1;
    entries.push(Object.freeze({ entryId, subjectDigest, reason: "curated", category, rationale }));
  }
  // Total coverage: every index entry appears exactly once.
  if (entries.length !== index.entries.length) return undefined;

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
