/**
 * Runtime bundles and path references. A bundle is a set of root files an upstream's items
 * read at run time, chosen by the upstream's own runtime allowlist. A path reference is a file
 * of the source that an item's text names but that is not one of the item's own files, so it
 * resolves only when something else (a placed bundle, a plugin) puts it where the item looks.
 */
import { decodeText } from "./frontmatter.js";
import { compareCodeUnits, dirnameOf, isSafeRelativePath } from "./paths.js";

/** A file of a recorded bundle, addressed from its source's root (its upstream path). */
export interface BundleFile {
  readonly sourcePath: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly executable: boolean;
}

/**
 * A runtime bundle: the root files its items read, the layout the items expect relative to
 * the bundle root (`skills/<name>/`), and the scan key of the root files as one folder.
 */
export interface Bundle {
  readonly id: string;
  readonly sourceId: string;
  readonly layout: string;
  readonly files: readonly BundleFile[];
  readonly scanKey: string;
}

/** One file an item names outside its own files: `path` from the source root. */
export interface PathReference {
  readonly sourcePath: string;
  readonly path: string;
}

/** The layouts Catalog places: a skill folder below the root. */
export const BUNDLE_LAYOUT = /^(?:[a-z0-9][a-z0-9_-]*\/)*<name>\/$/;

const segmentPattern = (pattern: string): RegExp =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*")}$`);

/** A pattern is a relative path whose segments may use `*` inside one segment (no `**`). */
export const isIncludePattern = (pattern: unknown): pattern is string =>
  typeof pattern === "string" &&
  pattern.length <= 512 &&
  !pattern.includes("**") &&
  isSafeRelativePath(pattern.replaceAll("*", "x"));

/** True when `path` matches the pattern: same depth, and each segment matches its own. */
export function matchesInclude(pattern: string, path: string): boolean {
  const want = pattern.split("/");
  const have = path.split("/");
  return (
    want.length === have.length &&
    want.every((part, index) => segmentPattern(part).test(have[index] as string))
  );
}

const MENTION =
  /(?<![A-Za-z0-9_./$}-])(\$\{CLAUDE_PLUGIN_ROOT\}\/)?((?:\.\.?\/)*[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*)/g;

/** `a/./b/../c` as `a/c`; null when it climbs above the root. */
function normalise(path: string): string | null {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(segment);
  }
  return out.join("/");
}

const join = (folder: string, path: string): string => (folder === "" ? path : `${folder}/${path}`);

/**
 * The source files an item's text files name outside the item's own files. A mention is a
 * relative path in the text: `${CLAUDE_PLUGIN_ROOT}/…` from the source root, `./` or `../`
 * from the file's folder, and a bare `a/b` from the file's folder when that file exists, else
 * from the source root. Only mentions that name an existing regular file of the source count,
 * so prose and paths in the user's own project are not taken for references.
 */
export function pathReferences(
  itemFiles: readonly { readonly sourcePath: string }[],
  exists: (path: string) => boolean,
  bytesOf: (path: string) => Uint8Array,
): PathReference[] {
  const own = new Set(itemFiles.map((file) => file.sourcePath));
  const found = new Map<string, PathReference>();
  for (const file of itemFiles) {
    const text = decodeText(bytesOf(file.sourcePath));
    if (text === null) continue;
    const folder = dirnameOf(file.sourcePath);
    for (const match of text.matchAll(MENTION)) {
      const pluginRoot = match[1] !== undefined;
      const mention = match[2] as string;
      if (!pluginRoot && !mention.includes("/")) continue;
      let target: string | null;
      if (pluginRoot) target = normalise(mention);
      else if (mention.startsWith("./") || mention.startsWith("../"))
        target = normalise(join(folder, mention));
      else {
        const local = normalise(join(folder, mention));
        target = local !== null && exists(local) ? local : normalise(mention);
      }
      if (target === null || target === "" || own.has(target) || !exists(target)) continue;
      found.set(`${file.sourcePath}\0${target}`, { sourcePath: file.sourcePath, path: target });
    }
  }
  return [...found.values()].sort(
    (left, right) =>
      compareCodeUnits(left.sourcePath, right.sourcePath) ||
      compareCodeUnits(left.path, right.path),
  );
}
