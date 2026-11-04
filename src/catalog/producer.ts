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
import { decodeText } from "./internal/frontmatter.js";
import { behaviourSha256, contentSha256, installRelative } from "./internal/identity.js";
import { canonicalDocument, canonicalJson, deepFreeze } from "./internal/json.js";
import { readFields } from "./internal/kinds.js";
import {
  type Content,
  type ContentSource,
  type DiscoveredFile,
  type DiscoveredItem,
  type Edition,
  type FetchedSource,
  FRAMEWORK_ID,
  INPUT_NAME,
  type InputDeclaration,
  type Item,
  type ItemFile,
  NPM_PACKAGE,
  OBJECT_ID,
  type PluginFolder,
  type Requirements,
  type SourceFile,
} from "./internal/model.js";
import {
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

async function scanKeyFor(
  item: { readonly kind: string; readonly files: readonly ItemFile[] },
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

const canonical = (value: unknown): string => (value === undefined ? "" : canonicalJson(value));

/** Every file an item names: its own and its editions'. */
function allFiles(item: DiscoveredItem): DiscoveredFile[] {
  return [
    ...(Array.isArray(item?.files) ? item.files : []),
    ...Object.values(item?.editions ?? {}).flatMap((edition) =>
      Array.isArray(edition?.files) ? edition.files : [],
    ),
  ];
}

/** A recorded item seen as discovery would propose it, with its authored fields. */
function discovered(item: Item): DiscoveredItem {
  const strip = (file: ItemFile): DiscoveredFile => {
    const { bytes: _bytes, derivedFrom: _derived, ...rest } = file;
    return rest;
  };
  return {
    id: item.id,
    kind: item.kind,
    files: item.files.map(strip),
    ...(item.userOnly === true ? { userOnly: true as const } : {}),
    ...(item.editions
      ? {
          editions: Object.fromEntries(
            Object.entries(item.editions).map(([cli, edition]) => [
              cli,
              { files: edition.files.map(strip) },
            ]),
          ),
        }
      : {}),
    ...(item.requirements ? { requirements: item.requirements } : {}),
    ...(item.dependencies ? { dependencies: item.dependencies } : {}),
    ...(item.purpose !== undefined ? { purpose: item.purpose } : {}),
  };
}

const textOf = (bytes: Uint8Array): string => decodeText(bytes) ?? "";

/** Checks authored inputs against what the files declare and use. */
function requirementsFor(
  item: DiscoveredItem,
  declared: Readonly<Record<string, InputDeclaration>>,
  markers: readonly string[],
  bytesOf: (path: string) => Uint8Array,
): Requirements | undefined | string {
  const authored = item.requirements;
  const inputs = authored?.inputs ?? declared;
  if (authored !== undefined) {
    if (authored === null || typeof authored !== "object" || typeof authored.inputs !== "object")
      return "requirements must be { inputs }";
    for (const [name, declaration] of Object.entries(declared)) {
      const entry = authored.inputs[name];
      if (entry === undefined) return `requirements.inputs must cover the file's input ${name}`;
      if (declaration.isSecret && entry.isSecret !== true)
        return `the input ${name} is secret in the file`;
    }
  }
  for (const marker of markers)
    if (inputs[marker] === undefined) return `the marker {${marker}} names no declared input`;
  for (const [name, entry] of Object.entries(inputs)) {
    if (!INPUT_NAME.test(name)) return `the input name ${quote(name)} is not valid`;
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.description !== "string" ||
      entry.description.length === 0 ||
      entry.description.length > 1024 ||
      typeof entry.isRequired !== "boolean" ||
      typeof entry.isSecret !== "boolean" ||
      (entry.default !== undefined && typeof entry.default !== "string")
    )
      return `the input ${name} needs description, isRequired and isSecret`;
    if (entry.isSecret && entry.default !== undefined)
      return `the secret input ${name} carries a value`;
    if (entry.placeholder !== undefined) {
      const { sourcePath, marker } = entry.placeholder;
      if (typeof marker !== "string" || marker.length < 3 || marker.length > 128)
        return `the input ${name} needs a placeholder marker of 3–128 characters`;
      if (!item.files.some((file) => file.sourcePath === sourcePath))
        return `the placeholder of ${name} names no file of the item`;
      if (!textOf(bytesOf(sourcePath)).includes(marker))
        return `the placeholder of ${name} does not occur in ${sourcePath}`;
    }
  }
  if (Object.keys(inputs).length === 0 && authored === undefined) return undefined;
  return authored ?? { inputs };
}

/**
 * Builds one item record from its proposed files and authored fields, or lists its problems.
 * `compare` names the values the bytes own, which `checkContent` compares with the record.
 */
async function assemble(
  item: DiscoveredItem,
  index: FileIndex,
): Promise<{ item: Item; compare: string[] } | Problem[]> {
  const id = String(item?.id);
  if (!(implementedKinds as readonly string[]).includes(item?.kind))
    return [{ path: id, message: `building ${String(item?.kind)} items is not implemented yet` }];
  const missing = allFiles(item).filter((file) => !index.has(file.sourcePath));
  if (missing.length > 0)
    return missing.map((file) => ({
      path: `${id}/${file.sourcePath}`,
      message: "the file was not supplied with its bytes",
    }));
  const read = readFields(item, index.bytesOf);
  if (typeof read === "string") return [{ path: id, message: read }];
  const record = (file: DiscoveredFile): ItemFile => ({
    ...(file.cli === undefined ? {} : { cli: file.cli }),
    sourceId: file.sourceId,
    sourcePath: file.sourcePath,
    sha256: file.sha256,
    bytes: index.bytesOf(file.sourcePath).byteLength,
    executable: file.executable,
    role: file.role,
  });
  const itemFiles = item.files.map(record);
  const scanKey = await scanKeyFor({ kind: item.kind, files: itemFiles }, index.bytesOf);
  if (!scanKey.startsWith("git-")) return [{ path: id, message: scanKey }];
  const fields: Record<string, unknown> = { ...read.fields };
  if (item.userOnly !== undefined) {
    if (item.userOnly !== true || item.kind !== "skill")
      return [{ path: `${id}/userOnly`, message: "only a skill can be tightened to user-only" }];
    fields.userOnly = true;
  }
  const requirements = requirementsFor(
    item,
    read.declared ?? {},
    read.markers ?? [],
    index.bytesOf,
  );
  if (typeof requirements === "string")
    return [{ path: `${id}/requirements`, message: requirements }];
  let editions: Record<string, Edition> | undefined;
  if (item.editions !== undefined) {
    editions = {};
    for (const cli of Object.keys(item.editions).sort(compareCodeUnits)) {
      const files = (item.editions[cli]?.files ?? []).map(record);
      if (!FRAMEWORK_ID.test(cli) || files.length === 0)
        return [
          { path: `${id}/editions/${cli}`, message: "an edition names a client and its files" },
        ];
      const key = await scanKeyFor({ kind: item.kind, files }, index.bytesOf);
      if (!key.startsWith("git-")) return [{ path: `${id}/editions/${cli}`, message: key }];
      editions[cli] = { files, scanKey: key };
    }
  }
  const base: Record<string, unknown> = {
    kind: item.kind,
    files: itemFiles,
    ...fields,
    ...(requirements ? { requirements } : {}),
    ...(item.dependencies ? { dependencies: item.dependencies } : {}),
    ...(editions ? { editions } : {}),
  };
  const built = {
    id: item.id,
    ...base,
    contentSha256: contentSha256(itemFiles),
    behaviourSha256: behaviourSha256(base as never, null),
    scanKey,
  } as Item;
  const compare = [...Object.keys(read.fields), "scanKey", ...(editions ? ["editions"] : [])];
  if (item.requirements === undefined) compare.push("requirements");
  return { item: built, compare };
}

/**
 * Records one plugin folder of the source: every regular file under it, and its scan key over
 * folder-relative paths. A link or special file inside the folder is a problem: a copied
 * plugin would silently lose it.
 */
async function pluginFolder(
  folder: string,
  sourceId: string,
  files: readonly SourceFile[],
  index: FileIndex,
): Promise<PluginFolder | Problem[]> {
  const at = `plugins/${folder}`;
  if (folder !== "/" && !isSafeRelativePath(folder))
    return [{ path: at, message: "a plugin folder is / or a safe folder of the source" }];
  const inside = (path: string) => folder === "/" || path.startsWith(`${folder}/`);
  const entries = (Array.isArray(files) ? files : []).filter((file) => inside(file.path));
  const odd = entries.find((file) => file.mode !== "100644" && file.mode !== "100755");
  if (odd)
    return [{ path: `${at}/${odd.path}`, message: "a plugin folder holds a link or special file" }];
  if (entries.length === 0) return [{ path: at, message: "the plugin folder holds no files" }];
  const absent = entries.find((file) => !index.has(file.path));
  if (absent)
    return [{ path: `${at}/${absent.path}`, message: "the file was not supplied with its bytes" }];
  const sorted = [...entries].sort((left, right) => compareCodeUnits(left.path, right.path));
  const relative = (path: string) => (folder === "/" ? path : path.slice(folder.length + 1));
  const key = await scanKeyOf(
    sorted.map((file) => ({
      path: relative(file.path),
      mode: file.mode as "100644" | "100755",
      bytes: index.bytesOf(file.path),
    })),
  );
  if (key.status !== "ok") return [{ path: at, message: `scan key: ${key.reason}` }];
  return {
    sourceId,
    path: folder,
    files: sorted.map((file) => ({
      sourcePath: file.path,
      sha256: file.sha256 as string,
      bytes: index.bytesOf(file.path).byteLength,
      executable: file.mode === "100755",
    })),
    scanKey: key.scanKey,
  };
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
    /** Folders of the source (`/` for all of it) to record as upstream plugin folders. */
    readonly plugins?: readonly string[];
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
    const wrongSource = allFiles(item).filter((file) => file.sourceId !== sourceId);
    if (wrongSource.length > 0) {
      for (const file of wrongSource)
        problems.push({
          path: `${item.id}/${file.sourcePath}`,
          message: "the file was not supplied with its bytes",
        });
      continue;
    }
    const mismatched = allFiles(item).find(
      (file) =>
        index.has(file.sourcePath) && sha256Hex(index.bytesOf(file.sourcePath)) !== file.sha256,
    );
    if (mismatched)
      return refused(
        "source-mismatch",
        `the bytes of ${quote(mismatched.sourcePath)} differ from the item's sha256`,
      );
    const result = await assemble(item, index);
    if (Array.isArray(result)) {
      problems.push(...result);
      continue;
    }
    built.push(result.item);
  }
  const plugins: PluginFolder[] = [];
  const folders = options.plugins ?? [];
  if (!Array.isArray(folders) || new Set(folders).size !== folders.length)
    problems.push({ path: "plugins", message: "plugins lists distinct folders" });
  else
    for (const folder of [...folders].sort(compareCodeUnits)) {
      const result = await pluginFolder(folder, sourceId, files, index);
      if (Array.isArray(result)) problems.push(...result);
      else plugins.push(result);
    }
  if (problems.length > 0) return { status: "invalid", problems };
  const contentSource: ContentSource = { id: sourceId, ...pinned, notices };
  const content: Content = {
    schema: formats.content,
    framework: { id: framework.id, name: framework.name },
    sources: [contentSource],
    items: built.sort((left, right) => compareCodeUnits(left.id, right.id)),
    ...(plugins.length > 0 ? { plugins } : {}),
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
      const view = discovered(item);
      const files = allFiles(view);
      const absent = files.filter((file) => !index.has(file.sourcePath));
      if (absent.length > 0) {
        for (const file of absent)
          problems.push({
            path: `${item.id}/${file.sourcePath}`,
            message: "the file was not supplied",
          });
        continue;
      }
      const recordedFiles = [
        ...item.files,
        ...Object.values(item.editions ?? {}).flatMap((edition) => edition.files),
      ];
      for (const file of recordedFiles) {
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
      const result = await assemble(view, index);
      if (Array.isArray(result)) {
        problems.push(...result);
        continue;
      }
      for (const key of result.compare) {
        const recorded = item[key];
        const value = result.item[key];
        // userOnly may be tightened to true where the file does not set it, never weakened.
        if (key === "userOnly" && recorded === true) continue;
        if (canonical(recorded) !== canonical(value)) {
          problems.push({
            path: `${item.id}/${key}`,
            message:
              key === "scanKey"
                ? "the scan key differs from the files"
                : "the recorded value differs from what the file says",
          });
        }
      }
    }
  }
  if (problems.length === 0 && files !== undefined)
    for (const [at, plugin] of (content.plugins ?? []).entries()) {
      const index = indexFiles(files);
      const result = await pluginFolder(plugin.path, plugin.sourceId, files, index);
      if (Array.isArray(result)) problems.push(...result);
      else if (canonicalJson(result) !== canonicalJson(plugin))
        problems.push({
          path: `plugins/${at}`,
          message: "the recorded plugin folder differs from the files",
        });
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
