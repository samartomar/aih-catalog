/**
 * `@aihq/catalog/producer` (new model): building a content document from a source's files
 * and discovered items, and checking content against files. The file bytes own every
 * file-derived field; Scan's `scanKeyOf` gives each item's scan key.
 */
import { scanKeyOf } from "@aihq/scan/contracts";
import {
  formats,
  type Invalid,
  implementedKinds,
  limits,
  type Problem,
  type Refused,
} from "./contracts.js";
import {
  decodeText,
  type Frontmatter,
  parseFrontmatter,
  splitFrontmatter,
  usesArguments,
} from "./internal/frontmatter.js";
import { behaviourSha256, contentSha256, installRelative } from "./internal/identity.js";
import { canonicalDocument, deepFreeze } from "./internal/json.js";
import {
  type Content,
  type ContentSource,
  type DiscoveredItem,
  type FetchedSource,
  FRAMEWORK_ID,
  INSTALL_NAME,
  type Item,
  type ItemFile,
  NPM_PACKAGE,
  OBJECT_ID,
  type RuleScope,
  type SourceFile,
} from "./internal/model.js";
import {
  basenameOf,
  compareCodeUnits,
  dirnameOf,
  isSafeRelativePath,
  limitRefusal,
  quote,
  refused,
} from "./internal/paths.js";
import { sha256Hex } from "./internal/sha256.js";
import { EXACT_VERSION } from "./internal/source-link.js";
import { contentProblems } from "./internal/validate.js";
import { isNoticePath } from "./source.js";

export type BuildContentResult =
  | {
      readonly status: "ok";
      readonly content: Content;
      /** Canonical bytes of the content document, as committed and read by `readContent`. */
      readonly bytes: Uint8Array;
      /** Files cut out of shared upstream files; none for skills and rules. */
      readonly generated: readonly {
        readonly itemId: string;
        readonly path: string;
        readonly bytes: Uint8Array;
        readonly sha256: string;
        readonly executable: boolean;
      }[];
    }
  | Refused
  | Invalid;

type Fields = { name: string; description: string } & Record<string, unknown>;

const descriptionOk = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 1024;

/** First Markdown heading, else first non-empty line, of a rule body. */
function firstLine(body: string): string | undefined {
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const heading = lines.find((line) => /^#{1,6}\s+\S/.test(line));
  if (heading) return heading.replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "");
  return lines.find((line) => line.length > 0);
}

function ruleScope(frontmatter: Frontmatter): RuleScope | { readonly error: string } {
  const paths = frontmatter.paths ?? frontmatter.globs;
  const list = typeof paths === "string" ? [paths] : paths;
  const globs = (value: unknown): value is string[] =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((glob) => typeof glob === "string" && glob.length > 0);
  if (frontmatter.inclusion !== undefined) {
    if (frontmatter.inclusion === "always") return "always";
    if (frontmatter.inclusion === "manual") return "on-request";
    if (frontmatter.inclusion === "auto") return { byDescription: true };
    if (frontmatter.inclusion === "fileMatch") {
      const match = frontmatter.fileMatchPattern;
      const patterns = typeof match === "string" ? [match] : match;
      return globs(patterns)
        ? { paths: patterns }
        : { error: "a fileMatch rule needs fileMatchPattern globs" };
    }
    return { error: `unknown inclusion ${quote(String(frontmatter.inclusion))}` };
  }
  if (frontmatter.trigger !== undefined) {
    if (frontmatter.trigger === "always_on") return "always";
    if (frontmatter.trigger === "manual") return "on-request";
    if (frontmatter.trigger === "model_decision") return { byDescription: true };
    if (frontmatter.trigger === "glob")
      return globs(list) ? { paths: list } : { error: "a glob rule needs globs" };
    return { error: `unknown trigger ${quote(String(frontmatter.trigger))}` };
  }
  if (frontmatter.alwaysApply === true) return "always";
  if (list !== undefined)
    return globs(list) ? { paths: list } : { error: "paths must be a list of globs" };
  return "always";
}

/** The file-owned fields of one item, read from its bytes. */
function readFields(item: DiscoveredItem, bytesOf: (path: string) => Uint8Array): Fields | string {
  if (item.kind === "skill") {
    const skill = item.files.find((file) => basenameOf(file.sourcePath) === "SKILL.md");
    if (skill === undefined) return "a skill needs a SKILL.md";
    const text = decodeText(bytesOf(skill.sourcePath));
    if (text === null) return `${skill.sourcePath} is not UTF-8 text`;
    const split = splitFrontmatter(text);
    if (split.yaml === null) return `${skill.sourcePath} has no frontmatter`;
    const frontmatter = parseFrontmatter(split.yaml);
    if (typeof frontmatter === "string") return `${skill.sourcePath}: ${frontmatter}`;
    const folderName = basenameOf(dirnameOf(skill.sourcePath));
    const name = frontmatter.name ?? folderName;
    if (typeof name !== "string" || name.length > 64 || !INSTALL_NAME.test(name)) {
      return `${skill.sourcePath}: the name ${quote(String(name))} is not at most 64 characters of a-z0-9- with single inner hyphens`;
    }
    if (!descriptionOk(frontmatter.description))
      return `${skill.sourcePath}: description must be 1–1024 characters`;
    const flag = frontmatter["disable-model-invocation"] ?? frontmatter.disableModelInvocation;
    if (flag !== undefined && typeof flag !== "boolean")
      return `${skill.sourcePath}: disable-model-invocation must be a boolean`;
    return {
      name,
      description: frontmatter.description,
      userOnly: flag === true,
      arguments: usesArguments(split.body),
    };
  }
  const rule = item.files[0];
  if (rule === undefined || item.files.length !== 1) return "a rule is exactly one file";
  const text = decodeText(bytesOf(rule.sourcePath));
  if (text === null) return `${rule.sourcePath} is not UTF-8 text`;
  const split = splitFrontmatter(text);
  const frontmatter = parseFrontmatter(split.yaml);
  if (typeof frontmatter === "string") return `${rule.sourcePath}: ${frontmatter}`;
  const name = basenameOf(rule.sourcePath).replace(/\.md$/, "");
  if (name.length > 64 || !INSTALL_NAME.test(name)) {
    return `${rule.sourcePath}: the file name ${quote(name)} is not at most 64 characters of a-z0-9- with single inner hyphens`;
  }
  const description = frontmatter.description ?? firstLine(split.body);
  if (!descriptionOk(description))
    return `${rule.sourcePath}: needs a description, heading or first line of 1–1024 characters`;
  const scope = ruleScope(frontmatter);
  if (typeof scope === "object" && "error" in scope) return `${rule.sourcePath}: ${scope.error}`;
  return { name, description, scope };
}

async function scanKeyFor(
  item: Pick<Item, "kind" | "files">,
  bytesOf: (path: string) => Uint8Array,
) {
  const result = await scanKeyOf(
    item.files.map((file) => ({
      path: installRelative(item, file),
      mode: file.executable ? ("100755" as const) : ("100644" as const),
      bytes: bytesOf(file.sourcePath),
    })),
  );
  return result.status === "ok" ? result.scanKey : `scan key: ${result.reason}`;
}

type FileIndex = {
  readonly bytesOf: (path: string) => Uint8Array;
  readonly has: (path: string) => boolean;
  readonly problem?: Refused | Invalid;
};

/** Indexes supplied files by path, checking safe paths, limits and bytes against sha256. */
function indexFiles(files: readonly SourceFile[]): FileIndex {
  const map = new Map<string, Uint8Array>();
  const fail = (problem: Refused | Invalid): FileIndex => ({
    bytesOf: () => new Uint8Array(),
    has: () => false,
    problem,
  });
  if (!Array.isArray(files))
    return fail({
      status: "invalid",
      problems: [{ path: "files", message: "files must be a list" }],
    });
  if (files.length > limits.sourceEntries)
    return fail(limitRefusal("sourceEntries", "the source entry count"));
  let total = 0;
  for (const file of files) {
    if (!isSafeRelativePath(file?.path))
      return fail(
        refused(
          "path-escape",
          `the entry path ${quote(String(file?.path))} is not a safe relative path`,
        ),
      );
    if (file.mode !== "100644" && file.mode !== "100755") continue;
    if (!(file.bytes instanceof Uint8Array)) continue;
    if (file.bytes.byteLength > limits.sourceFileBytes)
      return fail(limitRefusal("sourceFileBytes", `the file ${quote(file.path)}`));
    total += file.bytes.byteLength;
    if (total > limits.sourceBytes)
      return fail(limitRefusal("sourceBytes", "the source byte total"));
    if (sha256Hex(file.bytes) !== file.sha256) {
      return fail(
        refused(
          "source-mismatch",
          `the bytes of ${quote(file.path)} differ from its recorded sha256`,
        ),
      );
    }
    map.set(file.path, file.bytes);
  }
  return { bytesOf: (path) => map.get(path) as Uint8Array, has: (path) => map.has(path) };
}

type Pin = Omit<ContentSource, "id" | "notices">;

/**
 * The exact identity a content source records. A Git source needs its commit id and an npm
 * source its exact version: a branch, tag or range is never recorded. A local source records
 * no machine path.
 */
function sourcePin(source: FetchedSource): Pin | string {
  switch (source?.kind) {
    case "local":
      return { kind: "local" };
    case "git": {
      const { repository, commit, subpath } = source;
      if (typeof repository !== "string" || repository.length === 0 || repository.length > 2048)
        return "a git source needs its repository";
      if (typeof commit !== "string" || !OBJECT_ID.test(commit))
        return "a git source needs the exact commit id it was read at, not a branch or tag";
      if (subpath !== undefined && !isSafeRelativePath(subpath)) return "the subpath is not safe";
      return subpath === undefined
        ? { kind: "git", repository, commit }
        : { kind: "git", repository, commit, subpath };
    }
    case "npm": {
      const { package: name, version } = source;
      if (typeof name !== "string" || !NPM_PACKAGE.test(name))
        return "an npm source needs its package name";
      if (typeof version !== "string" || !EXACT_VERSION.test(version))
        return "an npm source needs the exact version it was read at, not a range or tag";
      return { kind: "npm", package: name, version };
    }
    default:
      return "the source must be local, git or npm";
  }
}

/**
 * Builds one framework content document from a local, Git or npm source, its files and the items
 * `findItems` proposed. Every item file and notice must be supplied with bytes matching its
 * sha256; a changed byte is `refused` (`source-mismatch`). File-owned fields that the bytes
 * cannot support (no name, no description, malformed frontmatter) are `invalid`.
 */
export async function buildContent(
  source: FetchedSource,
  files: readonly SourceFile[],
  items: readonly DiscoveredItem[],
  options: {
    readonly framework: string | { readonly id: string; readonly name: string };
    readonly sourceId?: string;
  },
): Promise<BuildContentResult> {
  const framework =
    typeof options?.framework === "string"
      ? { id: options.framework, name: options.framework }
      : options?.framework;
  if (
    !framework ||
    typeof framework.id !== "string" ||
    !FRAMEWORK_ID.test(framework.id) ||
    typeof framework.name !== "string"
  ) {
    return {
      status: "invalid",
      problems: [{ path: "framework", message: "a framework id (and optional name) is required" }],
    };
  }
  const pinned = sourcePin(source);
  if (typeof pinned === "string")
    return { status: "invalid", problems: [{ path: "source", message: pinned }] };
  const sourceId = options.sourceId ?? framework.id;
  const index = indexFiles(files);
  if (index.problem) return index.problem;
  const problems: Problem[] = [];
  const notices = files
    .filter((file) => (file.mode === "100644" || file.mode === "100755") && isNoticePath(file.path))
    .map((file) => {
      if (!index.has(file.path))
        problems.push({ path: file.path, message: "the notice was not supplied with its bytes" });
      const folder = dirnameOf(file.path);
      return {
        sourcePath: file.path,
        sha256: file.sha256 as string,
        covers: folder === "" ? "/" : folder,
      };
    })
    .sort((left, right) => compareCodeUnits(left.sourcePath, right.sourcePath));
  const built: Item[] = [];
  const proposed: readonly DiscoveredItem[] = Array.isArray(items) ? items : [];
  for (const item of proposed) {
    if (!(implementedKinds as readonly string[]).includes(item?.kind)) {
      problems.push({
        path: String(item?.id),
        message: `building ${String(item?.kind)} items is not implemented yet`,
      });
      continue;
    }
    const missing = item.files.filter(
      (file) => file.sourceId !== sourceId || !index.has(file.sourcePath),
    );
    if (missing.length > 0) {
      for (const file of missing)
        problems.push({
          path: `${item.id}/${file.sourcePath}`,
          message: "the file was not supplied with its bytes",
        });
      continue;
    }
    const mismatched = item.files.find(
      (file) => sha256Hex(index.bytesOf(file.sourcePath)) !== file.sha256,
    );
    if (mismatched)
      return refused(
        "source-mismatch",
        `the bytes of ${quote(mismatched.sourcePath)} differ from the item's sha256`,
      );
    const fields = readFields(item, index.bytesOf);
    if (typeof fields === "string") {
      problems.push({ path: item.id, message: fields });
      continue;
    }
    const itemFiles: ItemFile[] = item.files.map((file) => ({
      sourceId: file.sourceId,
      sourcePath: file.sourcePath,
      sha256: file.sha256,
      bytes: index.bytesOf(file.sourcePath).byteLength,
      executable: file.executable,
      role: file.role,
    }));
    const scanKey = await scanKeyFor({ kind: item.kind, files: itemFiles }, index.bytesOf);
    if (!scanKey.startsWith("git-")) {
      problems.push({ path: item.id, message: scanKey });
      continue;
    }
    const base = { kind: item.kind, files: itemFiles, ...fields };
    built.push({
      id: item.id,
      ...base,
      contentSha256: contentSha256(itemFiles),
      behaviourSha256: behaviourSha256(base, null),
      scanKey,
    } as Item);
  }
  if (problems.length > 0) return { status: "invalid", problems };
  const contentSource: ContentSource = { id: sourceId, ...pinned, notices };
  const content: Content = {
    schema: formats.content,
    framework: { id: framework.id, name: framework.name },
    sources: [contentSource],
    items: built.sort((left, right) => compareCodeUnits(left.id, right.id)),
  };
  const shape = contentProblems(content);
  if (shape.length > 0) return { status: "invalid", problems: shape };
  const bytes = new TextEncoder().encode(canonicalDocument(content));
  if (bytes.byteLength > limits.contentFileBytes)
    return limitRefusal("contentFileBytes", "the content document");
  return { status: "ok", content: deepFreeze(content), bytes, generated: [] };
}

export type CheckContentResult =
  | {
      readonly status: "ok";
      readonly problems: readonly [];
      readonly unscannedKeys?: readonly string[];
    }
  | Invalid;

/**
 * Checks a content record. Without files it checks shape and record-derived digests only;
 * with files it also checks every item file's bytes, length, file-owned fields and scan key.
 * With `scannedKeys` it lists the item scan keys that have no matching scan.
 */
export async function checkContent(
  content: Content,
  files?: readonly SourceFile[],
  options: { readonly scannedKeys?: readonly string[] } = {},
): Promise<CheckContentResult> {
  const problems: Problem[] = [...contentProblems(content)];
  if (problems.length === 0 && files !== undefined) {
    const index = indexFiles(files);
    if (index.problem) {
      const problem = index.problem;
      return {
        status: "invalid",
        problems:
          problem.status === "invalid"
            ? problem.problems
            : [{ path: "files", message: problem.reason }],
      };
    }
    for (const item of content.items) {
      const absent = item.files.filter((file) => !index.has(file.sourcePath));
      if (absent.length > 0) {
        for (const file of absent)
          problems.push({
            path: `${item.id}/${file.sourcePath}`,
            message: "the file was not supplied",
          });
        continue;
      }
      for (const file of item.files) {
        const bytes = index.bytesOf(file.sourcePath);
        if (sha256Hex(bytes) !== file.sha256)
          problems.push({
            path: `${item.id}/${file.sourcePath}`,
            message: "sha256 differs from the bytes",
          });
        else if (bytes.byteLength !== file.bytes)
          problems.push({
            path: `${item.id}/${file.sourcePath}`,
            message: "bytes differs from the file length",
          });
      }
      if (!(implementedKinds as readonly string[]).includes(item.kind)) continue;
      const fields = readFields(item as unknown as DiscoveredItem, index.bytesOf);
      if (typeof fields === "string") {
        problems.push({ path: item.id, message: fields });
        continue;
      }
      for (const [key, value] of Object.entries(fields)) {
        const recorded = item[key];
        // userOnly may be tightened to true where the file does not set it (a former command), never weakened.
        if (key === "userOnly" && recorded === true && value === false) continue;
        if (JSON.stringify(recorded) !== JSON.stringify(value)) {
          problems.push({
            path: `${item.id}/${key}`,
            message: "the recorded value differs from what the file says",
          });
        }
      }
      const scanKey = await scanKeyFor(item, index.bytesOf);
      if (item.scanKey !== scanKey)
        problems.push({
          path: `${item.id}/scanKey`,
          message: "the scan key differs from the files",
        });
    }
  }
  if (problems.length > 0) return { status: "invalid", problems };
  if (options.scannedKeys === undefined) return { status: "ok", problems: [] };
  const scanned = new Set(options.scannedKeys);
  const unscannedKeys = [
    ...new Set(
      content.items.flatMap((item) =>
        item.scanKey && !scanned.has(item.scanKey) ? [item.scanKey] : [],
      ),
    ),
  ].sort(compareCodeUnits);
  return { status: "ok", problems: [], unscannedKeys };
}
