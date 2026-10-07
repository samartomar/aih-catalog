import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { refuse } from "./errors.js";

const LIMITS = { files: 4096, bytes: 256 * 1024 * 1024 };

/**
 * Reads a release tree (`release/**`) as package-relative files. Bounded, and it
 * refuses symlinks or other non-regular entries rather than following them.
 */
export function readReleaseDirectory(packageRoot: string, dir = "release"): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let total = 0;
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        refuse(
          "release-entry-unsafe",
          `${relative(packageRoot, path)} is not a regular file or directory`,
        );
      }
      if (stat.isDirectory()) {
        walk(path);
        continue;
      }
      total += stat.size;
      if (files.size + 1 > LIMITS.files || total > LIMITS.bytes) {
        refuse("release-too-large", "the release tree exceeds the producer's file or byte bound");
      }
      files.set(relative(packageRoot, path).replaceAll("\\", "/"), readFileSync(path));
    }
  };
  const start = join(packageRoot, dir);
  if (!existsSync(start)) refuse("base-invalid", `${dir} does not exist under the package root`);
  walk(start);
  return files;
}

export interface InstallOptions {
  readonly root: string;
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly dir?: string;
  /** Test seam: runs after the new tree is fully written and read back, before the swap. */
  readonly beforeSwap?: () => void;
  /**
   * Runs against the swapped-in tree. If it throws, the previous release is put back
   * before the error propagates, so a refusal never leaves a rejected candidate live.
   */
  readonly verifyInstalled?: () => void;
}

/** Existence without following links, so a dangling link still counts as occupied. */
const occupied = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

/**
 * Replaces the published `release/` with a verified candidate without ever
 * leaving a half-written tree: the candidate is written beside it, read back,
 * and only then swapped by rename. A failure at any step restores the original.
 */
export function installCandidate(options: InstallOptions): void {
  const { root, files, dir = "release" } = options;
  const live = join(root, dir);
  const next = join(root, `${dir}.next`);
  const previous = join(root, `${dir}.previous`);
  const rejected = join(root, `${dir}.rejected`);
  if (occupied(next) || occupied(previous) || occupied(rejected)) {
    refuse(
      "install-leftover",
      `${dir}.next, ${dir}.previous or ${dir}.rejected already exists; inspect and remove it`,
    );
  }
  try {
    for (const [path, bytes] of files) {
      if (!path.startsWith(`${dir}/`)) refuse("install-path", `${path} is outside ${dir}/`);
      const target = join(next, ...path.slice(dir.length + 1).split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: "wx" });
    }
    const written = readReleaseDirectory(root, `${dir}.next`);
    const expected = new Map(
      [...files].map(([path, bytes]) => [path.slice(dir.length + 1), Buffer.from(bytes)]),
    );
    const actual = new Map(
      [...written].map(([path, bytes]) => [path.slice(dir.length + 6), bytes]),
    );
    if (
      actual.size !== expected.size ||
      [...expected].some(([path, bytes]) => !actual.get(path)?.equals(bytes))
    ) {
      refuse("install-readback", "the written candidate does not read back identically");
    }
    options.beforeSwap?.();
  } catch (error) {
    rmSync(next, { recursive: true, force: true });
    throw error;
  }
  let moved = false;
  try {
    if (existsSync(live)) {
      renameSync(live, previous);
      moved = true;
    }
    renameSync(next, live);
  } catch (error) {
    if (moved && !existsSync(live)) renameSync(previous, live);
    rmSync(next, { recursive: true, force: true });
    throw error;
  }
  try {
    options.verifyInstalled?.();
  } catch (error) {
    // Put the previous release back; every directory touched here was created by this call.
    renameSync(live, rejected);
    if (moved) renameSync(previous, live);
    rmSync(rejected, { recursive: true, force: true });
    throw error;
  }
  if (moved) rmSync(previous, { recursive: true, force: true });
}
