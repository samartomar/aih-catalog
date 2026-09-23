import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CATALOG_COLLECTIONS_ROOT_URL,
  readCatalogCollectionsV1,
} from "./catalog-collections-v1.js";
import {
  CATALOG_CONTENT_INDEX_ROOT_URL,
  type CatalogDescriptorV1,
  type CatalogSubjectKindV1,
  readCatalogContentV1,
  resolveCatalogContentPathV1,
} from "./catalog-content-v1.js";

/**
 * Public, Catalog-owned supply of a current collection member's original source
 * files: the exact upstream bytes at their original relative paths.
 *
 * Three representations stay separate. The entry's assessment artifacts (the
 * profile among them) describe the source closure; they are not its bytes. The
 * original files are shipped under `defaults/sources/<host>/<owner>/<repo>/<revision>/`
 * and served here only when each one hashes to the digest its profile declares.
 * Presentation metadata is not read here at all.
 *
 * The member is resolved through the published collection view, never by
 * comparing versions. Its profile is read only after its bytes match the digest
 * the index declares, and it alone states the file list, digests and source
 * revision; this module never adds, renames or reconstructs a file.
 *
 * The declared tree digest is carried as the profile states it. Catalog does not
 * recompute a tree hash over a newly staged snapshot.
 *
 * Supplying source bytes is not a scan, qualification, admission or effect
 * authority. This reader performs no network access, executes nothing and writes
 * nothing.
 */

export const CATALOG_SOURCE_CLOSURE_FORMAT_V1 = "aih-catalog-source-closure";
export const CATALOG_SOURCE_CLOSURE_VERSION_V1 = 1;
/** Package-root-relative directory holding original source files by origin and revision. */
export const CATALOG_SOURCE_ROOT_URL = "defaults/sources";
export const CATALOG_SOURCE_FILE_MAX_BYTES_V1 = 16 * 1024 * 1024;

/** This module sits at `<package>/dist/content/`; the package root is two levels up. */
const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
/**
 * Mirrors Core's `ASSESSMENT_MATERIAL_FORMAT_V1` and its `version: 1` literal.
 * `tools/verify-core-v2-lock.mjs` fails if the pinned Core commit declares either
 * differently.
 */
export const CATALOG_ASSESSMENT_PROFILE_FORMAT_V1 = "aih-first-party-qualification-profile";
export const CATALOG_ASSESSMENT_PROFILE_VERSION_V1 = 1;
const PROFILE_FORMAT = CATALOG_ASSESSMENT_PROFILE_FORMAT_V1;
const SKILL_MARKER = "SKILL.md";
const PREFIXED_SHA256 = /^sha256:[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const GITHUB_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const PATH_SEGMENT = /^[A-Za-z0-9_.@+-]+$/;

export type CatalogSourceClosureRefusalV1 =
  | "index-unreadable"
  | "collections-unreadable"
  | "collection-unknown"
  | "member-unknown"
  | "member-ambiguous"
  | "profile-unverified"
  | "profile-invalid"
  | "profile-unknown-version"
  | "material-not-source-files"
  | "source-file-absent"
  | "source-file-digest-mismatch";

export interface CatalogSourceFileV1 {
  /** Original upstream path, relative to the closure root. */
  readonly path: string;
  /** Bare 64-hex sha256 of `bytes`, equal to the profile's declared digest. */
  readonly sha256: string;
  readonly byteLength: number;
  readonly bytes: Uint8Array;
}

/**
 * A directory a detector may be pointed at. `closure` is the complete declared
 * file set. A `skill` root is a declared directory holding `SKILL.md`; `excludes`
 * names every closure file outside it, so a scan of that root alone never covers
 * the whole closure.
 */
export type CatalogSourceMaterialRootV1 =
  | {
      readonly kind: "closure";
      readonly path: ".";
      readonly files: readonly string[];
      readonly excludes: readonly string[];
    }
  | {
      readonly kind: "skill";
      readonly path: string;
      readonly marker: typeof SKILL_MARKER;
      readonly files: readonly string[];
      readonly excludes: readonly string[];
    };

export interface CatalogSourceClosureV1 {
  readonly format: typeof CATALOG_SOURCE_CLOSURE_FORMAT_V1;
  readonly version: typeof CATALOG_SOURCE_CLOSURE_VERSION_V1;
  readonly collection: { readonly id: string; readonly release: string };
  /** The index's own entry identity, verbatim. */
  readonly entry: {
    readonly entryId: string;
    readonly subject: {
      readonly id: string;
      readonly kind: CatalogSubjectKindV1;
      readonly sourceDigest: string;
      readonly subjectDigest: string;
    };
  };
  /** The asset the profile identifies; may differ from the index's subject kind label. */
  readonly asset: { readonly assetId: string; readonly sourceRevisionId: string };
  /** The assessment artifact that declared this closure. Not source material. */
  readonly assessment: { readonly profile: CatalogDescriptorV1 };
  readonly source: {
    readonly host: "github.com";
    readonly repository: string;
    readonly revision: string;
  };
  /** Package-root-relative directory where the original relative paths begin. */
  readonly root: string;
  readonly files: readonly CatalogSourceFileV1[];
  readonly materialRoots: readonly CatalogSourceMaterialRootV1[];
  /** The profile's recorded tree digest, carried as declared and not recomputed here. */
  readonly declaredTreeDigest: string;
}

export type CatalogSourceClosureResultV1 =
  | { readonly state: "verified"; readonly closure: CatalogSourceClosureV1 }
  | {
      readonly state: "refused";
      readonly reason: CatalogSourceClosureRefusalV1;
      /** The original relative path, for a file refusal. */
      readonly path?: string;
    };

export interface ReadCatalogSourceClosureV1Request {
  /** Package root to read from; defaults to this installed `@aihq/catalog` package. */
  readonly root?: string;
  readonly collectionId: string;
  /** The member's `subject.id`; the collection names at most one current entry for it. */
  readonly subjectId: string;
  /** Optional byte access by package-root-relative path. `undefined` means absent. */
  readonly readFile?: (path: string) => Uint8Array | undefined;
}

interface DeclaredClosure {
  readonly assetId: string;
  readonly sourceRevisionId: string;
  readonly owner: string;
  readonly repository: string;
  readonly revision: string;
  readonly treeDigest: string;
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
}

const refuse = (
  reason: CatalogSourceClosureRefusalV1,
  path?: string,
): CatalogSourceClosureResultV1 =>
  Object.freeze(
    path === undefined ? { state: "refused", reason } : { state: "refused", reason, path },
  );
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const matches = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.test(value);
const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));
const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Canonical relative POSIX path: no absolute form, traversal, empty or dot segment. */
function sourcePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) return undefined;
  const segments = value.split("/");
  if (
    segments.some((segment) => segment === "." || segment === ".." || !PATH_SEGMENT.test(segment))
  ) {
    return undefined;
  }
  return value;
}

function githubName(value: unknown): string | undefined {
  return matches(value, GITHUB_NAME) && value !== "." && value !== ".." ? value : undefined;
}

/** The closure the verified profile declares, or `undefined` when it is malformed. */
function declaredClosure(
  profile: unknown,
  subjectId: string,
): DeclaredClosure | "material-not-source-files" | "profile-unknown-version" | undefined {
  if (!isObject(profile) || profile.format !== PROFILE_FORMAT) return undefined;
  // The same profile format at a version this reader does not know is named as such.
  if (profile.version !== CATALOG_ASSESSMENT_PROFILE_VERSION_V1) return "profile-unknown-version";
  if (!isObject(profile.subject) || profile.subject.id !== subjectId) return undefined;
  const { asset, material, scanner } = profile;
  if (!isObject(asset) || typeof asset.assetId !== "string" || asset.assetId.length === 0) {
    return undefined;
  }
  if (typeof asset.sourceRevisionId !== "string" || asset.sourceRevisionId.length === 0) {
    return undefined;
  }
  if (!isObject(material)) return undefined;
  if (material.kind !== "source-files") return "material-not-source-files";
  if (!matches(material.treeDigest, PREFIXED_SHA256)) return undefined;
  if (!Array.isArray(material.files) || material.files.length === 0) return undefined;

  const files: { path: string; sha256: string }[] = [];
  for (const file of material.files) {
    if (!isObject(file) || !onlyKeys(file, ["digest", "path"])) return undefined;
    const path = sourcePath(file.path);
    if (path === undefined || !matches(file.digest, PREFIXED_SHA256)) return undefined;
    const previous = files.at(-1);
    // Declared once each, in code-unit order: a duplicate or reorder is a rewrite.
    if (previous !== undefined && previous.path >= path) return undefined;
    files.push({ path, sha256: file.digest.slice("sha256:".length) });
  }

  if (!isObject(scanner) || !isObject(scanner.catalog)) return undefined;
  const owner = githubName(scanner.catalog.owner);
  const repository = githubName(scanner.catalog.repository);
  if (owner === undefined || repository === undefined) return undefined;
  if (!matches(scanner.catalog.pinnedCommit, GIT_COMMIT)) return undefined;

  return {
    assetId: asset.assetId,
    sourceRevisionId: asset.sourceRevisionId,
    owner,
    repository,
    revision: scanner.catalog.pinnedCommit,
    treeDigest: material.treeDigest,
    files,
  };
}

function materialRoots(paths: readonly string[]): CatalogSourceMaterialRootV1[] {
  const roots: CatalogSourceMaterialRootV1[] = [
    Object.freeze({
      kind: "closure",
      path: ".",
      files: Object.freeze([...paths]),
      excludes: Object.freeze([]),
    }),
  ];
  const skillDirectories = paths
    .filter((path) => path === SKILL_MARKER || path.endsWith(`/${SKILL_MARKER}`))
    .map((path) => (path === SKILL_MARKER ? "." : path.slice(0, -(SKILL_MARKER.length + 1))));
  for (const directory of skillDirectories) {
    const inside = (path: string) => directory === "." || path.startsWith(`${directory}/`);
    roots.push(
      Object.freeze({
        kind: "skill",
        path: directory,
        marker: SKILL_MARKER,
        files: Object.freeze(paths.filter(inside)),
        excludes: Object.freeze(paths.filter((path) => !inside(path))),
      }),
    );
  }
  return roots;
}

function defaultReader(root: string): (path: string) => Uint8Array | undefined {
  return (path) => {
    const target = resolveCatalogContentPathV1(root, path);
    if (target === undefined) return undefined;
    try {
      return readFileSync(target);
    } catch {
      return undefined;
    }
  };
}

/**
 * Supplies the exact original source closure for one current collection member.
 *
 * Refuses, naming the reason, when the index or collection view is not the
 * published one, the collection or member is unknown, the profile does not match
 * its index digest or is malformed, the material is not a source-file closure, or
 * any declared file is absent, oversize or hashes differently.
 */
export function readCatalogSourceClosureV1(
  request: ReadCatalogSourceClosureV1Request,
): CatalogSourceClosureResultV1 {
  if (!isObject(request)) return refuse("index-unreadable");
  const { collectionId, subjectId } = request;
  if (request.root !== undefined && typeof request.root !== "string") {
    return refuse("index-unreadable");
  }
  const read = request.readFile ?? defaultReader(request.root ?? PACKAGE_ROOT);
  const bytesAt = (path: string): Uint8Array | undefined => {
    try {
      const bytes = read(path);
      return bytes instanceof Uint8Array ? bytes : undefined;
    } catch {
      return undefined;
    }
  };

  const indexBytes = bytesAt(CATALOG_CONTENT_INDEX_ROOT_URL);
  const index = indexBytes === undefined ? undefined : readCatalogContentV1({ bytes: indexBytes });
  if (index === undefined) return refuse("index-unreadable");
  const collectionBytes = bytesAt(CATALOG_COLLECTIONS_ROOT_URL);
  const collections =
    collectionBytes === undefined
      ? undefined
      : readCatalogCollectionsV1({ bytes: collectionBytes, index });
  if (collections === undefined) return refuse("collections-unreadable");

  const collection = collections.collections.find((candidate) => candidate.id === collectionId);
  if (collection === undefined) return refuse("collection-unknown");
  const entries = new Map(index.entries.map((entry) => [entry.entryId, entry]));
  const members = collection.members
    .map((member) => entries.get(member.entryId))
    .filter((entry) => entry !== undefined && entry.subject.id === subjectId);
  if (members.length === 0) return refuse("member-unknown");
  if (members.length > 1) return refuse("member-ambiguous");
  const entry = members[0];
  if (entry === undefined) return refuse("member-unknown");

  const profileDescriptor = entry.artifacts.profile;
  if (profileDescriptor === undefined) return refuse("profile-unverified");
  const profileBytes = bytesAt(profileDescriptor.path);
  if (profileBytes === undefined || sha256Hex(profileBytes) !== profileDescriptor.sha256) {
    return refuse("profile-unverified");
  }
  let profile: unknown;
  try {
    profile = JSON.parse(Buffer.from(profileBytes).toString("utf8"));
  } catch {
    return refuse("profile-invalid");
  }
  const declared = declaredClosure(profile, entry.subject.id);
  if (declared === undefined) return refuse("profile-invalid");
  if (declared === "material-not-source-files") return refuse("material-not-source-files");
  if (declared === "profile-unknown-version") return refuse("profile-unknown-version");

  const root = `${CATALOG_SOURCE_ROOT_URL}/github.com/${declared.owner}/${declared.repository}/${declared.revision}`;
  const files: CatalogSourceFileV1[] = [];
  for (const file of declared.files) {
    const bytes = bytesAt(`${root}/${file.path}`);
    if (bytes === undefined) return refuse("source-file-absent", file.path);
    if (bytes.byteLength > CATALOG_SOURCE_FILE_MAX_BYTES_V1 || sha256Hex(bytes) !== file.sha256) {
      return refuse("source-file-digest-mismatch", file.path);
    }
    const copy = Uint8Array.from(bytes);
    files.push(
      Object.freeze({
        path: file.path,
        sha256: file.sha256,
        byteLength: copy.byteLength,
        bytes: copy,
      }),
    );
  }

  return Object.freeze({
    state: "verified",
    closure: Object.freeze({
      format: CATALOG_SOURCE_CLOSURE_FORMAT_V1,
      version: CATALOG_SOURCE_CLOSURE_VERSION_V1,
      collection: Object.freeze({ id: collection.id, release: collection.current.release }),
      entry: Object.freeze({
        entryId: entry.entryId,
        subject: Object.freeze({
          id: entry.subject.id,
          kind: entry.subject.kind,
          sourceDigest: entry.subject.sourceDigest,
          subjectDigest: entry.subject.subjectDigest,
        }),
      }),
      asset: Object.freeze({
        assetId: declared.assetId,
        sourceRevisionId: declared.sourceRevisionId,
      }),
      assessment: Object.freeze({
        profile: Object.freeze({ path: profileDescriptor.path, sha256: profileDescriptor.sha256 }),
      }),
      source: Object.freeze({
        host: "github.com",
        repository: `${declared.owner}/${declared.repository}`,
        revision: declared.revision,
      }),
      root,
      files: Object.freeze(files),
      materialRoots: Object.freeze(materialRoots(files.map((file) => file.path))),
      declaredTreeDigest: declared.treeDigest,
    }),
  });
}
