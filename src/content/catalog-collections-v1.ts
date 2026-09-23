import {
  CATALOG_CONTENT_INDEX_ROOT_URL,
  type CatalogContentV1,
  type CatalogEntryV1,
} from "./catalog-content-v1.js";
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
 * Public, Catalog-owned reading of the published collection view.
 *
 * The content index carries each entry's source as type/release/revision. It
 * does not say which package owns a group of entries, or which release of that
 * group is current. The collection view states both, names every current member
 * by entry id and subject digest, and binds itself to the exact index bytes.
 *
 * A consumer uses it instead of inferring ownership from entry ids or comparing
 * unrelated versions. Entries of a collected source type that no collection
 * names remain addressable in the index for evidence and reference; they are
 * not current inventory. Collection membership is never organization admission,
 * qualification, installation or effect authority.
 *
 * This reader performs no network access, executes nothing and writes nothing.
 * `readCatalogCollectionsV1Result` names every refusal; `readCatalogCollectionsV1`
 * returns `undefined` for each of them.
 */

export const CATALOG_COLLECTIONS_FORMAT_V1 = "aih-catalog-collections";
export const CATALOG_COLLECTIONS_VERSION_V1 = 1;
/** Root-relative location of the collection view inside the installed package. */
export const CATALOG_COLLECTIONS_ROOT_URL = "defaults/catalog-collections-v1.json";
/** Public subpath export carrying those bytes: `@aihq/catalog/catalog-collections.json`. */
export const CATALOG_COLLECTIONS_SUBPATH_V1 = "./catalog-collections.json";
export const CATALOG_COLLECTIONS_MAX_BYTES_V1 = 1024 * 1024;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const PREFIXED_SHA256 = /^sha256:[0-9a-f]{64}$/;
const COLLECTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const RELEASE = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;

/** How the current release was identified when the Catalog update was prepared. */
export type CatalogCollectionOriginV1 =
  | {
      readonly kind: "npm-dist-tag";
      readonly name: string;
      readonly tag: string;
      readonly version: string;
    }
  | {
      readonly kind: "package-file";
      readonly name: string;
      readonly version: string;
      readonly sha256: string;
    }
  | { readonly kind: "catalog-authored" };

export interface CatalogCollectionMemberV1 {
  readonly entryId: string;
  readonly subjectDigest: string;
}

export interface CatalogCollectionV1 {
  readonly id: string;
  /** The package whose released content this collection indexes. */
  readonly owner: { readonly package: string };
  readonly sourceType: string;
  /** The content release this Catalog currently indexes, not a running package's version. */
  readonly current: { readonly release: string; readonly origin: CatalogCollectionOriginV1 };
  readonly members: readonly CatalogCollectionMemberV1[];
}

export interface CatalogCollectionsV1 {
  readonly format: typeof CATALOG_COLLECTIONS_FORMAT_V1;
  readonly version: typeof CATALOG_COLLECTIONS_VERSION_V1;
  /** `sha256:<64 hex>` over the exact collection bytes read. */
  readonly digest: string;
  /** The exact index these collections describe. */
  readonly index: { readonly path: string; readonly sha256: string };
  /** Source types whose current inventory is exactly the collections' members. */
  readonly collectedSourceTypes: readonly string[];
  readonly collections: readonly CatalogCollectionV1[];
}

export interface ReadCatalogCollectionsV1Request {
  /** The exact collection bytes, normally read from the installed package root. */
  readonly bytes: Uint8Array;
  /** The index these bytes must describe, as returned by `readCatalogContentV1`. */
  readonly index: CatalogContentV1;
  /**
   * The owner packages this consumer recognizes. When supplied, a collection
   * owned by any other package refuses `unknown-owner`. When absent, an owner is
   * read as data. Catalog holds no allowlist of its own: which owners to accept is
   * the consumer's policy, and third-party collections stay representable.
   */
  readonly knownOwners?: readonly string[];
}

/** Every reason `readCatalogCollectionsV1Result` can refuse with. A closed set. */
export const CATALOG_COLLECTIONS_REFUSALS_V1 = [
  "malformed-request",
  "malformed-bytes",
  "oversize-bytes",
  "non-canonical-bytes",
  "malformed-document",
  "unknown-format",
  "unknown-version",
  "index-mismatch",
  "malformed-collection",
  "duplicate-collection",
  "unknown-owner",
  "member-not-in-index",
  "member-not-current",
  "duplicate-entry",
  "unordered-entries",
] as const;
export type CatalogCollectionsRefusalV1 = (typeof CATALOG_COLLECTIONS_REFUSALS_V1)[number];

export type CatalogCollectionsV1Result =
  | { readonly state: "read"; readonly collections: CatalogCollectionsV1 }
  | CatalogReadRefusedV1<CatalogCollectionsRefusalV1>;

const matches = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.test(value);
const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

function origin(
  value: unknown,
  owner: string,
  release: string,
): CatalogCollectionOriginV1 | undefined {
  if (!isObject(value)) return undefined;
  if (value.kind === "catalog-authored") {
    return onlyKeys(value, ["kind"]) ? { kind: "catalog-authored" } : undefined;
  }
  if (!matches(value.name, PACKAGE_NAME) || value.name !== owner) return undefined;
  if (!matches(value.version, RELEASE) || value.version !== release) return undefined;
  if (value.kind === "npm-dist-tag") {
    if (!onlyKeys(value, ["kind", "name", "tag", "version"])) return undefined;
    if (!matches(value.tag, COLLECTION_ID)) return undefined;
    return { kind: "npm-dist-tag", name: value.name, tag: value.tag, version: value.version };
  }
  if (value.kind === "package-file") {
    if (!onlyKeys(value, ["kind", "name", "sha256", "version"])) return undefined;
    if (!matches(value.sha256, SHA256_HEX)) return undefined;
    return { kind: "package-file", name: value.name, version: value.version, sha256: value.sha256 };
  }
  return undefined;
}

function collection(
  value: unknown,
  knownOwners: readonly string[] | undefined,
  collected: readonly string[],
  entries: ReadonlyMap<string, CatalogEntryV1>,
  claimed: Set<string>,
): CatalogCollectionV1 {
  if (!isObject(value) || !onlyKeys(value, ["current", "id", "members", "owner", "sourceType"])) {
    return refuse("malformed-collection");
  }
  const { id, owner, sourceType, current, members } = value;
  if (!matches(id, COLLECTION_ID)) return refuse("malformed-collection");
  if (!isObject(owner) || !onlyKeys(owner, ["package"]) || !matches(owner.package, PACKAGE_NAME)) {
    return refuse("malformed-collection");
  }
  // Only the consumer's own stated owners, when it states them.
  if (knownOwners !== undefined && !knownOwners.includes(owner.package)) {
    return refuse("unknown-owner");
  }
  if (typeof sourceType !== "string" || !collected.includes(sourceType))
    return refuse("malformed-collection");
  if (!isObject(current) || !onlyKeys(current, ["origin", "release"]))
    return refuse("malformed-collection");
  if (!matches(current.release, RELEASE)) return refuse("malformed-collection");
  const currentOrigin = origin(current.origin, owner.package, current.release);
  if (currentOrigin === undefined) return refuse("malformed-collection");
  if (!Array.isArray(members) || members.length === 0) return refuse("malformed-collection");

  const parsed: CatalogCollectionMemberV1[] = [];
  for (const member of members) {
    if (!isObject(member) || !onlyKeys(member, ["entryId", "subjectDigest"])) {
      return refuse("malformed-collection");
    }
    const { entryId, subjectDigest } = member;
    if (typeof entryId !== "string" || !matches(subjectDigest, PREFIXED_SHA256)) {
      return refuse("malformed-collection");
    }
    // A member must be this exact index entry, of this source type and this release.
    const entry = entries.get(entryId);
    if (entry === undefined || entry.subject.subjectDigest !== subjectDigest) {
      return refuse("member-not-in-index");
    }
    if (entry.subject.source.type !== sourceType) return refuse("member-not-current");
    if (entry.subject.source.release !== current.release) return refuse("member-not-current");
    // No entry is current in two collections, and none is listed twice.
    if (claimed.has(entryId)) return refuse("duplicate-entry");
    claimed.add(entryId);
    requireAscending(parsed.at(-1)?.entryId, entryId);
    parsed.push(Object.freeze({ entryId, subjectDigest }));
  }
  return Object.freeze({
    id,
    owner: Object.freeze({ package: owner.package }),
    sourceType,
    current: Object.freeze({ release: current.release, origin: Object.freeze(currentOrigin) }),
    members: Object.freeze(parsed),
  });
}

/**
 * Reads and validates the published collection view against the index it
 * describes, naming why it refuses: `unknown-format` and `unknown-version` (each
 * with the declared value in `observed`), malformed, oversize or non-canonical
 * bytes, a view bound to a different index (`index-mismatch`), a malformed or
 * duplicate collection, an owner outside a supplied `knownOwners`
 * (`unknown-owner`), a member that is not that exact index entry
 * (`member-not-in-index`), a member of another source type or release than its
 * collection's current one (`member-not-current`), an entry claimed twice, or
 * members out of order.
 */
export function readCatalogCollectionsV1Result(
  request: ReadCatalogCollectionsV1Request,
): CatalogCollectionsV1Result {
  try {
    return Object.freeze({ state: "read" as const, collections: readCollections(request) });
  } catch (error) {
    return refusedFrom<CatalogCollectionsRefusalV1>(error);
  }
}

/**
 * Reads and validates the published collection view against the index it
 * describes. Returns `undefined` for every refusal: unknown format or version,
 * malformed, non-canonical or oversize bytes, a different index, an unknown
 * field, a member that is not that exact index entry, a member whose source type
 * or release differs from its collection's, or an entry claimed twice. Use
 * `readCatalogCollectionsV1Result` to learn which.
 */
export function readCatalogCollectionsV1(
  request: ReadCatalogCollectionsV1Request,
): CatalogCollectionsV1 | undefined {
  const result = readCatalogCollectionsV1Result(request);
  return result.state === "read" ? result.collections : undefined;
}

function readCollections(request: ReadCatalogCollectionsV1Request): CatalogCollectionsV1 {
  if (!isObject(request)) return refuse("malformed-request");
  const { index } = request;
  if (
    !isObject(index) ||
    !Array.isArray(index.entries) ||
    !matches(index.digest, PREFIXED_SHA256)
  ) {
    return refuse("malformed-request");
  }
  const { knownOwners } = request;
  if (
    knownOwners !== undefined &&
    (!Array.isArray(knownOwners) ||
      knownOwners.length === 0 ||
      !knownOwners.every((owner) => matches(owner, PACKAGE_NAME)))
  ) {
    return refuse("malformed-request");
  }
  const { value, digest } = readCanonicalDocument({
    bytes: request.bytes,
    maxBytes: CATALOG_COLLECTIONS_MAX_BYTES_V1,
    // The generator emits `JSON.stringify` of its own key order plus a newline.
    canonical: (parsed) => `${JSON.stringify(parsed)}\n`,
  });
  requireFormatAndVersion(value, CATALOG_COLLECTIONS_FORMAT_V1, CATALOG_COLLECTIONS_VERSION_V1);
  if (!onlyKeys(value, ["collectedSourceTypes", "collections", "format", "index", "version"])) {
    return refuse("malformed-document");
  }

  const boundIndex = value.index;
  if (!isObject(boundIndex) || !onlyKeys(boundIndex, ["path", "sha256"])) {
    return refuse("malformed-document");
  }
  if (!matches(boundIndex.sha256, SHA256_HEX)) return refuse("malformed-document");
  // The view describes exactly the index it was cut from, and no other.
  if (boundIndex.path !== CATALOG_CONTENT_INDEX_ROOT_URL) return refuse("index-mismatch");
  if (`sha256:${boundIndex.sha256}` !== index.digest) return refuse("index-mismatch");

  const collected = value.collectedSourceTypes;
  if (!Array.isArray(collected) || collected.length === 0) return refuse("malformed-document");
  if (!collected.every((type) => matches(type, COLLECTION_ID))) {
    return refuse("malformed-document");
  }
  if (new Set(collected).size !== collected.length) return refuse("malformed-document");

  if (!Array.isArray(value.collections) || value.collections.length === 0) {
    return refuse("malformed-document");
  }
  const entries = new Map(index.entries.map((entry) => [entry.entryId, entry]));
  const claimed = new Set<string>();
  const ids = new Set<string>();
  const collections: CatalogCollectionV1[] = [];
  for (const raw of value.collections) {
    const parsed = collection(raw, knownOwners, collected as string[], entries, claimed);
    if (ids.has(parsed.id)) return refuse("duplicate-collection");
    ids.add(parsed.id);
    collections.push(parsed);
  }

  return Object.freeze({
    format: CATALOG_COLLECTIONS_FORMAT_V1,
    version: CATALOG_COLLECTIONS_VERSION_V1,
    digest,
    index: Object.freeze({ path: boundIndex.path, sha256: boundIndex.sha256 }),
    collectedSourceTypes: Object.freeze([...(collected as string[])]),
    collections: Object.freeze(collections),
  });
}
