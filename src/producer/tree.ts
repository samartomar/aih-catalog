import { safeMemberPath } from "../release/document.js";
import { refuse } from "./errors.js";

/**
 * What the producer is told about one immutable upstream commit. `complete`
 * means the enumeration covered the whole commit: only then does a missing path
 * mean "removed". Gitlink (submodule) prefixes and non-regular entries are
 * carried separately so they can never be mistaken for absence.
 */
export interface SourceInventory {
  readonly complete: boolean;
  /** Regular-file paths. */
  readonly paths: ReadonlySet<string>;
  /** Paths that exist but are not regular files (symlinks). */
  readonly irregular: ReadonlySet<string>;
  /** Directory prefixes the enumeration could not see into (submodules). */
  readonly opaquePrefixes: readonly string[];
}

export interface SourceTree {
  /** `owner/name`. */
  readonly repository: string;
  /** Full lowercase commit id. */
  readonly commit: string;
  readonly inventory: SourceInventory;
  /** Bytes of a regular file in the inventory; throws for anything else. */
  read(path: string): Uint8Array;
}

export type PathStatus = "present" | "absent" | "unknown" | "irregular";

/** The shared material-member ceiling (16 MiB), applied before anything is carried. */
export const MEMBER_MAX_BYTES = 16 * 1024 * 1024;
export const COMMIT = /^[0-9a-f]{40}$/;
export const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Presence of one path. "absent" is only ever answered for a complete
 * enumeration; an incomplete one, or a path below an opaque prefix, is "unknown".
 */
export function pathStatus(tree: SourceTree, path: string): PathStatus {
  if (!safeMemberPath(path)) return refuse("unsafe-path", `upstream path ${path} is not safe`);
  const { inventory } = tree;
  if (inventory.paths.has(path)) return "present";
  if (inventory.irregular.has(path)) return "irregular";
  if (!inventory.complete) return "unknown";
  if (inventory.opaquePrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return "unknown";
  }
  return "absent";
}

/** Reads a present regular file, or refuses with the path's real status. */
export function readPresent(tree: SourceTree, path: string): Buffer {
  const status = pathStatus(tree, path);
  if (status !== "present") {
    return refuse("source-file-unavailable", `upstream file ${path} is ${status}`, {
      path,
      status,
    });
  }
  const bytes = Buffer.from(tree.read(path));
  if (bytes.length > MEMBER_MAX_BYTES) {
    return refuse(
      "source-file-too-large",
      `upstream file ${path} exceeds the ${MEMBER_MAX_BYTES}-byte material member ceiling`,
      { path },
    );
  }
  return bytes;
}
