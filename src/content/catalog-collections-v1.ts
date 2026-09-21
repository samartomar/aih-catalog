import { createHash } from "node:crypto";
import {
  CATALOG_CONTENT_INDEX_ROOT_URL,
  type CatalogContentV1,
  type CatalogEntryV1,
} from "./catalog-content-v1.js";

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
 * Every refusal returns `undefined`.
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
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
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
  collected: readonly string[],
  entries: ReadonlyMap<string, CatalogEntryV1>,
  claimed: Set<string>,
): CatalogCollectionV1 | undefined {
  if (!isObject(value) || !onlyKeys(value, ["current", "id", "members", "owner", "sourceType"])) {
    return undefined;
  }
  const { id, owner, sourceType, current, members } = value;
  if (!matches(id, COLLECTION_ID)) return undefined;
  if (!isObject(owner) || !onlyKeys(owner, ["package"]) || !matches(owner.package, PACKAGE_NAME)) {
    return undefined;
  }
  if (typeof sourceType !== "string" || !collected.includes(sourceType)) return undefined;
  if (!isObject(current) || !onlyKeys(current, ["origin", "release"])) return undefined;
  if (!matches(current.release, RELEASE)) return undefined;
  const currentOrigin = origin(current.origin, owner.package, current.release);
  if (currentOrigin === undefined) return undefined;
  if (!Array.isArray(members) || members.length === 0) return undefined;

  const parsed: CatalogCollectionMemberV1[] = [];
  for (const member of members) {
    if (!isObject(member) || !onlyKeys(member, ["entryId", "subjectDigest"])) return undefined;
    const { entryId, subjectDigest } = member;
    if (typeof entryId !== "string" || !matches(subjectDigest, PREFIXED_SHA256)) return undefined;
    // A member must be this exact index entry, of this source type and this release.
    const entry = entries.get(entryId);
    if (entry === undefined || entry.subject.subjectDigest !== subjectDigest) return undefined;
    if (entry.subject.source.type !== sourceType) return undefined;
    if (entry.subject.source.release !== current.release) return undefined;
    // No entry is current in two collections, and none is listed twice.
    if (claimed.has(entryId)) return undefined;
    claimed.add(entryId);
    parsed.push(Object.freeze({ entryId, subjectDigest }));
  }
  for (let index = 1; index < parsed.length; index += 1) {
    if ((parsed[index - 1]?.entryId ?? "") >= (parsed[index]?.entryId ?? "")) return undefined;
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
 * describes. Returns `undefined` for every refusal: unknown format or version,
 * malformed, non-canonical or oversize bytes, a different index, an unknown
 * field, a member that is not that exact index entry, a member whose source type
 * or release differs from its collection's, or an entry claimed twice.
 */
export function readCatalogCollectionsV1(
  request: ReadCatalogCollectionsV1Request,
): CatalogCollectionsV1 | undefined {
  if (!isObject(request)) return undefined;
  const { bytes, index } = request;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return undefined;
  if (bytes.byteLength > CATALOG_COLLECTIONS_MAX_BYTES_V1) return undefined;
  if (
    !isObject(index) ||
    !Array.isArray(index.entries) ||
    !matches(index.digest, PREFIXED_SHA256)
  ) {
    return undefined;
  }
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
  if (`${JSON.stringify(value)}\n` !== text) return undefined;
  if (!isObject(value)) return undefined;
  if (!onlyKeys(value, ["collectedSourceTypes", "collections", "format", "index", "version"])) {
    return undefined;
  }
  if (value.format !== CATALOG_COLLECTIONS_FORMAT_V1) return undefined;
  if (value.version !== CATALOG_COLLECTIONS_VERSION_V1) return undefined;

  const boundIndex = value.index;
  if (!isObject(boundIndex) || !onlyKeys(boundIndex, ["path", "sha256"])) return undefined;
  if (boundIndex.path !== CATALOG_CONTENT_INDEX_ROOT_URL) return undefined;
  if (!matches(boundIndex.sha256, SHA256_HEX)) return undefined;
  if (`sha256:${boundIndex.sha256}` !== index.digest) return undefined;

  const collected = value.collectedSourceTypes;
  if (!Array.isArray(collected) || collected.length === 0) return undefined;
  if (!collected.every((type) => matches(type, COLLECTION_ID))) return undefined;
  if (new Set(collected).size !== collected.length) return undefined;

  if (!Array.isArray(value.collections) || value.collections.length === 0) return undefined;
  const entries = new Map(index.entries.map((entry) => [entry.entryId, entry]));
  const claimed = new Set<string>();
  const ids = new Set<string>();
  const collections: CatalogCollectionV1[] = [];
  for (const raw of value.collections) {
    const parsed = collection(raw, collected as string[], entries, claimed);
    if (parsed === undefined || ids.has(parsed.id)) return undefined;
    ids.add(parsed.id);
    collections.push(parsed);
  }

  return Object.freeze({
    format: CATALOG_COLLECTIONS_FORMAT_V1,
    version: CATALOG_COLLECTIONS_VERSION_V1,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    index: Object.freeze({ path: boundIndex.path, sha256: boundIndex.sha256 }),
    collectedSourceTypes: Object.freeze([...(collected as string[])]),
    collections: Object.freeze(collections),
  });
}
