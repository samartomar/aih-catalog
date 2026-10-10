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

/**
 * The declared allowance for the authored native-fixture source: the pinned Core recorder program
 * contains the word `undefined`. A fixture declaration that packs the committed native documents
 * must declare it, as the committed declaration does.
 */
export const NATIVE_FIXTURE_ALLOWANCE = {
  source: "aihq-native-fixtures",
  externalPaths: [],
  templatePlaceholders: ["undefined"],
};

export const REPOSITORY = "mattpocock/skills";
export const PINNED_REVISION = "d81f3a183412e71a5b1e84ca21bc1a35eea03a60";
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
  // The upstream manifest is an admission input, not an installed release member.
  files[".claude-plugin/plugin.json"] = readFileSync(
    resolve(root, "tests/producer/fixtures/mattpocock-plugin-v1-3.json"),
  );
  return files;
}

/** Adds the committed 1.1 hook release and its members to a candidate that lacks them. */
export function withHookRelease(files: ReadonlyMap<string, Buffer>): Map<string, Buffer> {
  const next = new Map(files);
  for (const [path, bytes] of committedRelease()) {
    if (
      path === "release/release-1.1.json" ||
      path.includes("/client-hooks/") ||
      path.includes("aihq.hook.")
    ) {
      next.set(path, bytes);
    }
  }
  return next;
}

/**
 * Adds the committed native-fixture releases (the graph-fixture item and the bundle that pins it)
 * with their recipes and members to a candidate that lacks them.
 */
export function withNativeFixtureRelease(files: ReadonlyMap<string, Buffer>): Map<string, Buffer> {
  const next = new Map(files);
  for (const [path, bytes] of committedRelease()) {
    if (
      path === "release/release-native-fixture.json" ||
      path === "release/release-native-bundles.json" ||
      path.includes("/native-fixtures/") ||
      path.includes("/native-bundles/") ||
      path.includes("aihq.mcp.claude.graph-fixture") ||
      path.includes("aihq.native-bundle.")
    ) {
      next.set(path, bytes);
    }
  }
  return next;
}

/** A disposable package root: the real manifest and built entries, with `release/` seeded from `release`. */
export function makePackageRoot(
  dir: string,
  release: ReadonlyMap<string, Uint8Array>,
  extra: string[] = [],
): string {
  for (const entry of [
    "package.json",
    "package-lock.json",
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    "dist/release",
    "schemas",
    ...extra,
  ]) {
    cpSync(join(root, entry), join(dir, entry), { recursive: true });
  }
  // The manifest exports the 1.1 release, so a package root always carries it beside the 1.0 release.
  const seeded = withNativeFixtureRelease(
    release.has("release/release-1.1.json")
      ? (release as never)
      : withHookRelease(release as never),
  );
  for (const [path, bytes] of seeded) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
  return dir;
}
