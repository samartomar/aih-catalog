import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { ProducerRefusal } from "./errors.js";
import { assertWindowsCacheAcl } from "./windows-acl.js";

/**
 * The retained source-object cache lives in a per-user directory, never in a
 * shared, predictable temporary location another account could pre-populate.
 */
export function defaultCacheDir(input: {
  env: Readonly<Record<string, string | undefined>>;
  platform: string;
  home: string;
}): string {
  const { env, platform, home } = input;
  const base =
    platform === "win32"
      ? (env.LOCALAPPDATA ?? (home ? join(home, "AppData", "Local") : undefined))
      : env.XDG_CACHE_HOME || (home ? join(home, ".cache") : undefined);
  if (!base) {
    throw new ProducerRefusal(
      "cache-unsafe",
      "no per-user cache location is available; pass --cache-dir",
    );
  }
  return join(base, "aihq-catalog", "source-objects");
}

/**
 * Creates (or accepts) a private cache directory. A symlink, a non-directory, a
 * directory owned by someone else or one other users can write is refused: a
 * cache another account can alter is not a source of immutable bytes.
 */
export function ensureOwnedCacheDir(path: string): void {
  let created = false;
  try {
    mkdirSync(path, { mode: 0o700 });
    created = true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      try {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        mkdirSync(path, { mode: 0o700 });
        created = true;
      } catch (retryError) {
        if ((retryError as NodeJS.ErrnoException).code !== "EEXIST") {
          throw new ProducerRefusal(
            "cache-unsafe",
            "the source-object cache location cannot be created as a directory",
          );
        }
      }
    } else if (code !== "EEXIST") {
      throw new ProducerRefusal(
        "cache-unsafe",
        "the source-object cache location cannot be created as a directory",
      );
    }
  }
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch {
    throw new ProducerRefusal("cache-unsafe", "the source-object cache cannot be inspected");
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new ProducerRefusal(
      "cache-unsafe",
      "the source-object cache must be a plain directory, not a link or file",
    );
  }
  if (process.platform === "win32") {
    assertWindowsCacheAcl(path, created);
    return;
  }
  const uid = process.getuid?.();
  if (uid !== undefined && stat.uid !== uid) {
    throw new ProducerRefusal("cache-unsafe", "the source-object cache is owned by another user");
  }
  if ((stat.mode & 0o022) !== 0) {
    throw new ProducerRefusal("cache-unsafe", "the source-object cache is writable by other users");
  }
  chmodSync(path, 0o700);
}

/** Refuses non-regular or broadly writable retained cache evidence. */
export function assertOwnedCacheEntry(
  path: string,
  kind: "file" | "directory",
  provisionNewEntry = false,
): void {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch {
    throw new ProducerRefusal(
      "cache-unsafe",
      "a retained cache evidence entry cannot be inspected",
    );
  }
  if (stat.isSymbolicLink() || (kind === "directory" ? !stat.isDirectory() : !stat.isFile())) {
    throw new ProducerRefusal(
      "cache-unsafe",
      "a retained cache evidence entry has an unsafe file type",
    );
  }
  if (process.platform === "win32") assertWindowsCacheAcl(path, provisionNewEntry, kind);
}

/** Inspect every backing object, including loose blobs and pack/index files. */
export function assertCacheObjectPermissions(path: string): void {
  if (process.platform === "win32") assertWindowsCacheAcl(path, false, "directory", true);
}
