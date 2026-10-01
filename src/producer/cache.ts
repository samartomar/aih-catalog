import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { refuse } from "./errors.js";

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
    return refuse("cache-unsafe", "no per-user cache location is available; pass --cache-dir");
  }
  return join(base, "aihq-catalog", "source-objects");
}

/**
 * Creates (or accepts) a private cache directory. A symlink, a non-directory, a
 * directory owned by someone else or one other users can write is refused: a
 * cache another account can alter is not a source of immutable bytes.
 */
export function ensureOwnedCacheDir(path: string): void {
  try {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  } catch {
    refuse("cache-unsafe", "the source-object cache location cannot be created as a directory");
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    refuse("cache-unsafe", "the source-object cache must be a plain directory, not a link or file");
  }
  if (process.platform !== "win32") {
    const uid = process.getuid?.();
    if (uid !== undefined && stat.uid !== uid) {
      refuse("cache-unsafe", "the source-object cache is owned by another user");
    }
    if ((stat.mode & 0o022) !== 0) {
      refuse("cache-unsafe", "the source-object cache is writable by other users");
    }
    chmodSync(path, 0o700);
  }
}
