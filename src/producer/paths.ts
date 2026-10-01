import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { refuse } from "./errors.js";

/**
 * Real location of a path that may not exist yet: the real path of its nearest
 * existing ancestor (resolving symlinks, junctions and aliases) plus the rest.
 */
export function resolveReal(path: string): string {
  const absolute = resolve(path);
  const rest: string[] = [];
  let current = absolute;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return absolute;
    rest.unshift(basename(current));
    current = parent;
  }
  return resolve(realpathSync.native(current), ...rest);
}

const fold = (path: string) =>
  process.platform === "win32" || process.platform === "darwin" ? path.toLowerCase() : path;

/** True when `inner` is `outer` or below it, comparing real locations. */
export function isWithin(outer: string, inner: string): boolean {
  const from = fold(resolveReal(outer));
  const to = fold(resolveReal(inner));
  const step = relative(from, to);
  return (
    step === "" || (!step.startsWith("..") && !isAbsolute(step) && step.split(sep)[0] !== "..")
  );
}

/** Refuses when two locations are the same or one contains the other. */
export function assertDisjoint(
  first: { label: string; path: string },
  second: { label: string; path: string },
  reason: string,
): void {
  if (isWithin(first.path, second.path) || isWithin(second.path, first.path)) {
    refuse(reason, `${first.label} and ${second.label} overlap; refusing to write there`, {
      first: first.label,
      second: second.label,
    });
  }
}

/** A missing directory, or an existing empty real directory, is fresh. */
export function assertFreshDirectory(path: string, reason: string, label: string): void {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    refuse(reason, `${label} exists and is not a plain directory`);
  }
  if (readdirSync(path).length > 0) {
    refuse(
      reason,
      `${label} already holds files; the producer only writes into a new or empty directory`,
    );
  }
}

/**
 * The producer writes reports, a staged package and the packed artifact into
 * the output directory and deletes nothing it did not create. The output must
 * therefore be new or empty and must not overlap the package being prepared.
 */
export function assertFreshOutput(input: { sourceRoot: string; outDir: string }): void {
  assertDisjoint(
    { label: "the output directory", path: input.outDir },
    { label: "the package root", path: input.sourceRoot },
    "out-overlap",
  );
  assertFreshDirectory(input.outDir, "out-not-empty", "the output directory");
}
