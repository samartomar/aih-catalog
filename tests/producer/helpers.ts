import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseDeclaration } from "../../src/producer/declaration.js";
import type { SourceTree } from "../../src/producer/tree.js";

export const root = resolve(import.meta.dirname, "../..");
export const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

/** The committed, hand-authored producer declaration. */
export const declaration = () =>
  parseDeclaration(readFileSync(resolve(root, "producer/declaration.json")));

export const packageIdentity = () => {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  return { name: pkg.name as string, version: pkg.version as string };
};

/** Every file below a directory, package-relative with `/` separators. */
export function readTree(dir: string, base = dir): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [key, value] of readTree(path, base)) files.set(key, value);
    } else {
      files.set(relative(base, path).replaceAll("\\", "/"), readFileSync(path));
    }
  }
  return files;
}

/** The committed `release/**` files keyed by package-relative path. */
export const committedRelease = (): Map<string, Buffer> => {
  const files = new Map<string, Buffer>();
  for (const [path, bytes] of readTree(resolve(root, "release"), root)) files.set(path, bytes);
  return files;
};

export const REPOSITORY = "mattpocock/skills";
export const PINNED_REVISION = "c55ee46073ed923f86ce59a5eb3b6d895095d1b7";
export const SKILL_ME = "skills/productivity/grill-me/SKILL.md";
export const SKILL_GRILLING = "skills/productivity/grilling/SKILL.md";

/** A complete in-memory upstream tree. */
export function memoryTree(
  commit: string,
  files: Record<string, string | Uint8Array>,
  options: {
    repository?: string;
    complete?: boolean;
    opaquePrefixes?: string[];
    irregular?: string[];
  } = {},
): SourceTree {
  const entries = new Map(
    Object.entries(files).map(([path, value]) => [
      path,
      typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value),
    ]),
  );
  return {
    repository: options.repository ?? REPOSITORY,
    commit,
    inventory: {
      complete: options.complete ?? true,
      paths: new Set(entries.keys()),
      irregular: new Set(options.irregular ?? []),
      opaquePrefixes: options.opaquePrefixes ?? [],
    },
    read(path) {
      const bytes = entries.get(path);
      if (bytes === undefined) throw new Error(`upstream file ${path} is absent`);
      return bytes;
    },
  };
}

/** The upstream files the committed release was built from, recovered from its own material. */
export function pinnedUpstreamFiles(): Record<string, Buffer> {
  const prefix = `release/materials/github.com/${REPOSITORY}/${PINNED_REVISION}/`;
  const files: Record<string, Buffer> = {};
  for (const [path, bytes] of committedRelease()) {
    if (path.startsWith(prefix)) files[path.slice(prefix.length)] = bytes;
  }
  return files;
}

/** A disposable package root: the real manifest and built entries, with `release/` seeded from `release`. */
export function makePackageRoot(
  dir: string,
  release: ReadonlyMap<string, Uint8Array>,
  extra: string[] = [],
): string {
  for (const entry of [
    "package.json",
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    "dist/release",
    "schemas",
    ...extra,
  ]) {
    cpSync(join(root, entry), join(dir, entry), { recursive: true });
  }
  for (const [path, bytes] of release) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
  return dir;
}
