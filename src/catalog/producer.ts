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
import { aiSetupProblems, MCP_SETTINGS, mcpSettingProblems } from "./internal/ai-setup.js";
import {
  BUNDLE_LAYOUT,
  type Bundle,
  isIncludePattern,
  matchesInclude,
  pathReferences,
} from "./internal/bundle.js";
import { cutDocument, cutFileName } from "./internal/cut.js";
import { decodeText } from "./internal/frontmatter.js";
import { behaviourSha256, contentSha256, installRelative } from "./internal/identity.js";
import { canonicalDocument, canonicalJson, deepFreeze } from "./internal/json.js";
import { readFields, readJson } from "./internal/kinds.js";
import {
  type Content,
  type ContentSource,
  type DiscoveredFile,
  type DiscoveredItem,
  type Edition,
  type FetchedSource,
  FRAMEWORK_ID,
  ID_SEGMENT,
  INPUT_NAME,
  INSTALL_NAME,
  type InputDeclaration,
  type Item,
  type ItemFile,
  NAMESPACED_NAME,
  NPM_PACKAGE,
  OBJECT_ID,
  type PluginFolder,
  type Requirements,
  type SourceFile,
} from "./internal/model.js";
import {
  compareCodeUnits,
  isSafeRelativePath,
  limitRefusal,
  quote,
  refused,
} from "./internal/paths.js";
import { sha256Hex } from "./internal/sha256.js";
import { EXACT_VERSION } from "./internal/source-link.js";
import { contentProblems } from "./internal/validate.js";
import { isNoticePath, noticeCovers } from "./source.js";

export type BuildContentResult =
  | {
      readonly status: "ok";
      readonly content: Content;
      /** Canonical bytes of the content document, as committed and read by `readContent`. */
      readonly bytes: Uint8Array;
      /** Files cut out of shared upstream files; none for skills and rules. */
      readonly generated: readonly GeneratedFile[];
    }
  | Refused
  | Invalid;

async function scanKeyFor(
  item: { readonly kind: string; readonly files: readonly ItemFile[] },
  bytesIn: (sourceId: string, path: string) => Uint8Array,
) {
  const result = await scanKeyOf(
    item.files.map((file) => ({
      path: installRelative(item, file),
      mode: file.executable ? ("100755" as const) : ("100644" as const),
      bytes: bytesIn(file.sourceId, file.sourcePath),
    })),
  );
  return result.status === "ok" ? result.scanKey : `scan key: ${result.reason}`;
}

type FileIndex = {
  readonly bytesOf: (sourceId: string, path: string) => Uint8Array;
  readonly has: (sourceId: string, path: string) => boolean;
  /** Adds a file Catalog generated (a cut-out) to the index. */
  readonly add: (sourceId: string, path: string, bytes: Uint8Array) => void;
  readonly problem?: Refused | Invalid;
};

const keyOf = (sourceId: string, path: string) => `${sourceId}\u0000${path}`;
/** The source a supplied file belongs to: its tag, else the call's own source. */
const sourceOf = (file: SourceFile, primary: string) => file.sourceId ?? primary;

/**
 * Indexes supplied files by source and path, checking safe paths, limits and bytes against
 * sha256. Untagged files belong to `primary`, the call's own source.
 */
function indexFiles(files: readonly SourceFile[], primary: string): FileIndex {
  const map = new Map<string, Uint8Array>();
  const fail = (problem: Refused | Invalid): FileIndex => ({
    bytesOf: () => new Uint8Array(),
    has: () => false,
    add: () => undefined,
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
    map.set(keyOf(sourceOf(file, primary), file.path), file.bytes);
  }
  return {
    bytesOf: (sourceId, path) => map.get(keyOf(sourceId, path)) as Uint8Array,
    has: (sourceId, path) => map.has(keyOf(sourceId, path)),
    add: (sourceId, path, bytes) => {
      map.set(keyOf(sourceId, path), bytes);
    },
  };
}

/**
 * Reads an item's files by path: each path resolves in the source the item's file names, so
 * one item may hold files from several sources (an upstream file beside a generated one). A
 * path both the item and an edition use (a second copy of the upstream) reads the item's own.
 */
function itemReader(item: DiscoveredItem, index: FileIndex) {
  const sources = new Map<string, string>();
  for (const file of [...allFiles(item)].reverse()) sources.set(file.sourcePath, file.sourceId);
  for (const file of [...(Array.isArray(item?.files) ? item.files : [])].reverse())
    sources.set(file.sourcePath, file.sourceId);
  return {
    bytesOf: (path: string) => index.bytesOf(sources.get(path) ?? "", path),
    bytesIn: (sourceId: string, path: string) => index.bytesOf(sourceId, path),
    has: (path: string) => sources.has(path) && index.has(sources.get(path) as string, path),
  };
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
    const { bytes: _bytes, ...rest } = file;
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
    ...(item.bundle !== undefined ? { bundle: item.bundle } : {}),
    ...(item.references
      ? { references: [...new Set(item.references.map((reference) => reference.name))] }
      : {}),
    ...(item.fetch === "upstream" ? { fetch: "upstream" as const } : {}),
    ...(item.kind === "ai-setup"
      ? { name: item.name, description: item.description, aiSetup: item.aiSetup }
      : {}),
    ...Object.fromEntries(
      MCP_SETTINGS.filter((key) => item[key] !== undefined).map((key) => [key, item[key]]),
    ),
  };
}

/** An AI setup's authored fields: its install name, description and record. */
function readAiSetup(
  item: DiscoveredItem,
): { fields: Record<string, unknown>; declared?: undefined; markers?: undefined } | Problem[] {
  const id = String(item.id);
  const problems: Problem[] = [];
  if (typeof item.name !== "string" || item.name.length > 64 || !INSTALL_NAME.test(item.name))
    problems.push({ path: `${id}/name`, message: "an AI setup names its install name" });
  if (
    typeof item.description !== "string" ||
    item.description.length === 0 ||
    item.description.length > 1024
  )
    problems.push({
      path: `${id}/description`,
      message: "an AI setup has a 1–1024 character description",
    });
  try {
    canonicalJson(item.aiSetup ?? null);
  } catch {
    return [{ path: `${id}/aiSetup`, message: "aiSetup must be plain JSON data" }];
  }
  problems.push(
    ...aiSetupProblems(
      item.aiSetup,
      `${id}/aiSetup`,
      item.files.map((file) => file.sourcePath),
    ),
  );
  if (problems.length > 0) return problems;
  return { fields: { name: item.name, description: item.description, aiSetup: item.aiSetup } };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The item files that mention each authored namespaced name, as a whole token. A name no file
 * mentions is a problem: the authored fact would contradict the bytes.
 */
function namespacedReferences(
  item: DiscoveredItem,
  bytesOf: (path: string) => Uint8Array,
): { name: string; sourcePath: string }[] | string | undefined {
  const names = item.references;
  if (names === undefined) return undefined;
  if (
    !Array.isArray(names) ||
    !names.every((name) => typeof name === "string" && NAMESPACED_NAME.test(name)) ||
    new Set(names).size !== names.length
  )
    return "references lists distinct <namespace>:<name> names";
  const found: { name: string; sourcePath: string }[] = [];
  for (const name of [...names].sort(compareCodeUnits)) {
    const token = new RegExp(`(?<![A-Za-z0-9_:-])${escapeRegExp(name)}(?![A-Za-z0-9_-])`);
    const files = item.files
      .filter((file) => token.test(textOf(bytesOf(file.sourcePath))))
      .map((file) => file.sourcePath)
      .sort(compareCodeUnits);
    if (files.length === 0) return `no file of the item mentions ${name}`;
    for (const sourcePath of files) found.push({ name, sourcePath });
  }
  return found;
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
  files: FileIndex,
  bundles: ReadonlyMap<string, Bundle>,
  primary: string,
): Promise<{ item: Item; compare: string[] } | Problem[]> {
  const id = String(item?.id);
  if (!(implementedKinds as readonly string[]).includes(item?.kind))
    return [{ path: id, message: `building ${String(item?.kind)} items is not implemented yet` }];
  const missing = allFiles(item).filter((file) => !files.has(file.sourceId, file.sourcePath));
  if (missing.length > 0)
    return missing.map((file) => ({
      path: `${id}/${file.sourcePath}`,
      message: "the file was not supplied with its bytes",
    }));
  const index = itemReader(item, files);
  const read = item.kind === "ai-setup" ? readAiSetup(item) : readFields(item, index.bytesOf);
  if (typeof read === "string") return [{ path: id, message: read }];
  if (Array.isArray(read)) return read;
  const record = (file: DiscoveredFile): ItemFile => ({
    ...(file.cli === undefined ? {} : { cli: file.cli }),
    sourceId: file.sourceId,
    sourcePath: file.sourcePath,
    sha256: file.sha256,
    bytes: index.bytesIn(file.sourceId, file.sourcePath).byteLength,
    executable: file.executable,
    role: file.role,
    ...(file.derivedFrom
      ? {
          derivedFrom: {
            sourcePath: file.derivedFrom.sourcePath,
            pointer: file.derivedFrom.pointer,
          },
        }
      : {}),
  });
  const itemFiles = item.files.map(record);
  // An AI setup records artifacts, not source files: it has a scan key only for files it writes.
  const scanKey =
    item.kind === "ai-setup" && itemFiles.length === 0
      ? undefined
      : await scanKeyFor({ kind: item.kind, files: itemFiles }, index.bytesIn);
  if (scanKey !== undefined && !scanKey.startsWith("git-")) return [{ path: id, message: scanKey }];
  if (item.fetch !== undefined && item.fetch !== "upstream")
    return [{ path: `${id}/fetch`, message: "fetch must be upstream" }];
  const fields: Record<string, unknown> = { ...read.fields };
  const settings = MCP_SETTINGS.filter((key) => item[key] !== undefined);
  if (settings.length > 0) {
    if (item.kind !== "mcp")
      return [{ path: `${id}/${settings[0]}`, message: "only an MCP item has MCP settings" }];
    const problems = mcpSettingProblems(item as never, id);
    if (problems.length > 0) return problems;
    const declared = Object.keys({ ...read.declared, ...item.requirements?.inputs });
    const secret = Object.keys(item.env ?? {}).find((name) => declared.includes(name));
    if (secret !== undefined)
      return [{ path: `${id}/env/${secret}`, message: "env never holds a declared input" }];
    for (const key of settings) fields[key] = item[key];
  }
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
      const key = await scanKeyFor({ kind: item.kind, files }, index.bytesIn);
      if (!key.startsWith("git-")) return [{ path: `${id}/editions/${cli}`, message: key }];
      editions[cli] = { files, scanKey: key };
    }
  }
  let bundle: Bundle | undefined;
  if (item.bundle !== undefined) {
    bundle = bundles.get(item.bundle);
    if (bundle === undefined) return [{ path: `${id}/bundle`, message: "names no bundle" }];
  }
  // A mention resolves in the file's own source; a cut-out's in the source it was cut from.
  const references = pathReferences(
    itemFiles,
    (path, file) => {
      const recorded = file as ItemFile;
      return files.has(recorded.derivedFrom ? primary : recorded.sourceId, path);
    },
    index.bytesOf,
  );
  const named = namespacedReferences(item, index.bytesOf);
  if (typeof named === "string") return [{ path: `${id}/references`, message: named }];
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
    ...(bundle ? { bundle: bundle.id } : {}),
    ...(references.length > 0 ? { pathReferences: references } : {}),
    ...(named ? { references: named } : {}),
    ...(item.fetch === "upstream" ? { fetch: "upstream" } : {}),
    contentSha256: contentSha256(itemFiles),
    behaviourSha256: behaviourSha256(base as never, bundle ? bundle.files : null),
    ...(scanKey !== undefined ? { scanKey } : {}),
  } as Item;
  const compare = [
    ...Object.keys(read.fields),
    "scanKey",
    "pathReferences",
    "references",
    ...(editions ? ["editions"] : []),
  ];
  if (item.requirements === undefined) compare.push("requirements");
  return { item: built, compare };
}

/** A plugin folder to record: a folder (`/` for the whole source), optionally an allowlist. */
export type PluginRequest =
  | string
  | {
      readonly path: string;
      readonly include?: readonly string[];
      /** The upstream plugin the allowlist describes, when several share the folder. */
      readonly plugin?: string;
    };

/** A runtime bundle to record: its id, skill layout and the allowlist of its root files. */
export interface BundleRequest {
  readonly id: string;
  readonly layout: string;
  readonly include: readonly string[];
}

const fileRecord = (file: SourceFile, sourceId: string, index: FileIndex) => ({
  sourcePath: file.path,
  sha256: file.sha256 as string,
  bytes: index.bytesOf(sourceId, file.path).byteLength,
  executable: file.mode === "100755",
});

const sortedPatterns = (include: readonly string[]) => [...include].sort(compareCodeUnits);

/**
 * Records one plugin folder of the source: every regular file under it (or, with `include`,
 * those the upstream's runtime allowlist names), and its scan key over folder-relative paths.
 * A link or special file among them is a problem: a copied plugin would silently lose it.
 */
async function pluginFolder(
  request: PluginRequest,
  sourceId: string,
  files: readonly SourceFile[],
  index: FileIndex,
): Promise<PluginFolder | Problem[]> {
  const folder = typeof request === "string" ? request : request?.path;
  const include = typeof request === "string" ? undefined : request?.include;
  const plugin = typeof request === "string" ? undefined : request?.plugin;
  const at = `plugins/${String(folder)}${plugin === undefined ? "" : `#${String(plugin)}`}`;
  if (
    plugin !== undefined &&
    (typeof plugin !== "string" || plugin.length > 64 || !INSTALL_NAME.test(plugin))
  )
    return [{ path: at, message: "a plugin name is kebab-case" }];
  if (folder !== "/" && !isSafeRelativePath(folder))
    return [{ path: at, message: "a plugin folder is / or a safe folder of the source" }];
  if (
    include !== undefined &&
    (!Array.isArray(include) ||
      include.length === 0 ||
      !include.every(isIncludePattern) ||
      new Set(include).size !== include.length)
  )
    return [{ path: `${at}/include`, message: "include lists distinct path patterns" }];
  const inside = (path: string) =>
    (folder === "/" || path.startsWith(`${folder}/`)) &&
    (include === undefined || include.some((pattern) => matchesInclude(pattern, path)));
  const entries = (Array.isArray(files) ? files : []).filter((file) => inside(file.path));
  const odd = entries.find((file) => file.mode !== "100644" && file.mode !== "100755");
  if (odd)
    return [{ path: `${at}/${odd.path}`, message: "a plugin folder holds a link or special file" }];
  if (entries.length === 0) return [{ path: at, message: "the plugin folder holds no files" }];
  const absent = entries.find((file) => !index.has(sourceId, file.path));
  if (absent)
    return [{ path: `${at}/${absent.path}`, message: "the file was not supplied with its bytes" }];
  const sorted = [...entries].sort((left, right) => compareCodeUnits(left.path, right.path));
  const relative = (path: string) => (folder === "/" ? path : path.slice(folder.length + 1));
  const key = await scanKeyOf(
    sorted.map((file) => ({
      path: relative(file.path),
      mode: file.mode as "100644" | "100755",
      bytes: index.bytesOf(sourceId, file.path),
    })),
  );
  if (key.status !== "ok") return [{ path: at, message: `scan key: ${key.reason}` }];
  // A native plugin install clones the whole folder, not the allowlist, so an allowlisted
  // record also keys every file under the folder: the key a `plugin` step names (D72).
  let folderScanKey: string | undefined;
  if (include !== undefined) {
    const whole = (Array.isArray(files) ? files : [])
      .filter((file) => folder === "/" || file.path.startsWith(`${folder}/`))
      .sort((left, right) => compareCodeUnits(left.path, right.path));
    const other = whole.find((file) => file.mode !== "100644" && file.mode !== "100755");
    if (other)
      return [
        { path: `${at}/${other.path}`, message: "a plugin folder holds a link or special file" },
      ];
    const missing = whole.find((file) => !index.has(sourceId, file.path));
    if (missing)
      return [
        { path: `${at}/${missing.path}`, message: "the file was not supplied with its bytes" },
      ];
    const wholeKey = await scanKeyOf(
      whole.map((file) => ({
        path: relative(file.path),
        mode: file.mode as "100644" | "100755",
        bytes: index.bytesOf(sourceId, file.path),
      })),
    );
    if (wholeKey.status !== "ok") return [{ path: at, message: `scan key: ${wholeKey.reason}` }];
    folderScanKey = wholeKey.scanKey;
  }
  return {
    sourceId,
    path: folder,
    ...(include !== undefined ? { include: sortedPatterns(include) } : {}),
    ...(plugin !== undefined ? { plugin } : {}),
    files: sorted.map((file) => fileRecord(file, sourceId, index)),
    scanKey: key.scanKey,
    ...(folderScanKey !== undefined ? { folderScanKey } : {}),
  };
}

/**
 * Records one runtime bundle: the regular files of the source its allowlist names, at their
 * upstream paths, and their scan key as one folder rooted at the source root.
 */
async function bundleRecord(
  request: BundleRequest,
  sourceId: string,
  files: readonly SourceFile[],
  index: FileIndex,
): Promise<Bundle | Problem[]> {
  const at = `bundles/${String(request?.id)}`;
  if (
    typeof request?.id !== "string" ||
    request.id.length > 512 ||
    !request.id.split(".").every((segment) => ID_SEGMENT.test(segment))
  )
    return [{ path: at, message: "a bundle needs an id of dot-separated segments" }];
  if (typeof request.layout !== "string" || !BUNDLE_LAYOUT.test(request.layout))
    return [{ path: `${at}/layout`, message: "layout is a folder path ending in <name>/" }];
  const include = request.include;
  if (
    !Array.isArray(include) ||
    include.length === 0 ||
    !include.every(isIncludePattern) ||
    new Set(include).size !== include.length
  )
    return [{ path: `${at}/include`, message: "include lists distinct path patterns" }];
  const entries = (Array.isArray(files) ? files : []).filter((file) =>
    include.some((pattern) => matchesInclude(pattern, file.path)),
  );
  const odd = entries.find((file) => file.mode !== "100644" && file.mode !== "100755");
  if (odd) return [{ path: `${at}/${odd.path}`, message: "a bundle holds a link or special file" }];
  if (entries.length === 0) return [{ path: at, message: "the bundle names no files" }];
  const absent = entries.find((file) => !index.has(sourceId, file.path));
  if (absent)
    return [{ path: `${at}/${absent.path}`, message: "the file was not supplied with its bytes" }];
  const sorted = [...entries].sort((left, right) => compareCodeUnits(left.path, right.path));
  const key = await scanKeyOf(
    sorted.map((file) => ({
      path: file.path,
      mode: file.mode as "100644" | "100755",
      bytes: index.bytesOf(sourceId, file.path),
    })),
  );
  if (key.status !== "ok") return [{ path: at, message: `scan key: ${key.reason}` }];
  return {
    id: request.id,
    sourceId,
    layout: request.layout,
    files: sorted.map((file) => fileRecord(file, sourceId, index)),
    scanKey: key.scanKey,
  };
}

type Pin = Omit<ContentSource, "id" | "notices">;

/**
 * The exact identity a content source records. A Git source needs its commit id and an npm
 * source its exact version: a branch, tag or range is never recorded. A local source records
 * no machine path.
 */
function sourcePin(source: FetchedSource | { readonly kind: "authored" }): Pin | string {
  switch (source?.kind) {
    case "local":
      return { kind: "local" };
    case "authored":
      return { kind: "authored" };
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
      return "the source must be local, git, npm or authored";
  }
}

/** A further source an item's files may name: another pin, or Catalog's own authored files. */
export interface ExtraSource {
  readonly id: string;
  readonly source: FetchedSource | { readonly kind: "authored" };
  /** The source's files, with their bytes; their paths are relative to that source. */
  readonly files: readonly SourceFile[];
  /** For a notice-only source: the items its notices cover. */
  readonly noticesFor?: readonly string[];
}

/** One file Catalog cut out of a shared upstream file, for `data/<framework>/generated/`. */
export interface GeneratedFile {
  readonly itemId: string;
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly executable: boolean;
}

/** The notices among one source's regular files, each covering its folder. */
function noticesOf(
  files: readonly SourceFile[],
  sourceId: string,
  index: FileIndex,
  problems: Problem[],
) {
  return files
    .filter((file) => (file.mode === "100644" || file.mode === "100755") && isNoticePath(file.path))
    .map((file) => {
      if (!index.has(sourceId, file.path))
        problems.push({ path: file.path, message: "the notice was not supplied with its bytes" });
      return {
        sourcePath: file.path,
        sha256: file.sha256 as string,
        covers: noticeCovers(file.path),
      };
    })
    .sort((left, right) => compareCodeUnits(left.sourcePath, right.sourcePath));
}

/**
 * Replaces every cut request among an item's files (and its editions' files) with the file
 * Catalog generates for it in `<framework>-generated`, recording where the entry came from.
 */
function cutItem(
  item: DiscoveredItem,
  primary: string,
  generatedId: string,
  index: FileIndex,
  out: GeneratedFile[],
): DiscoveredItem | Problem[] {
  const problems: Problem[] = [];
  const parsed = new Map<string, unknown>();
  // The same entry cut again (for an edition that is the upstream entry itself) shares a file.
  const done = new Map<string, DiscoveredFile>();
  const cut = (file: DiscoveredFile, cli?: string): DiscoveredFile => {
    const request = file.cut;
    if (request === undefined) return file;
    const same = canonicalJson({
      cut: request,
      path: file.sourcePath,
      role: file.role,
      cli: file.cli ?? null,
    });
    const earlier = done.get(same);
    if (earlier) return earlier;
    const at = `${String(item.id)}/${cli ? `editions/${cli}/` : ""}${file.sourcePath}`;
    if (file.sourceId !== primary) {
      problems.push({ path: at, message: "a cut-out comes from the content's own source" });
      return file;
    }
    if (!index.has(primary, file.sourcePath)) {
      problems.push({ path: at, message: "the file was not supplied with its bytes" });
      return file;
    }
    const bytes = index.bytesOf(primary, file.sourcePath);
    if (sha256Hex(bytes) !== file.sha256) {
      problems.push({ path: at, message: "the shared file's bytes differ from its sha256" });
      return file;
    }
    if (!parsed.has(file.sourcePath)) parsed.set(file.sourcePath, readJson(bytes));
    const document = parsed.get(file.sourcePath);
    if (document !== null && typeof document === "object" && "error" in (document as object)) {
      problems.push({ path: at, message: String((document as { error: string }).error) });
      return file;
    }
    const value = cutDocument(document, request);
    if (typeof value === "string") {
      problems.push({ path: `${at}#${String(request?.pointer)}`, message: value });
      return file;
    }
    const generated = new TextEncoder().encode(canonicalDocument(value));
    const path = `${item.id}/${cli ? `${cli}/` : ""}${cutFileName(request.as)}`;
    if (index.has(generatedId, path)) {
      problems.push({ path: at, message: "two cut-outs of the item would share one file" });
      return file;
    }
    index.add(generatedId, path, generated);
    const sha256 = sha256Hex(generated);
    out.push({ itemId: item.id, path, bytes: generated, sha256, executable: false });
    const made: DiscoveredFile = {
      sourceId: generatedId,
      sourcePath: path,
      sha256,
      executable: false,
      role: file.role,
      ...(file.cli === undefined ? {} : { cli: file.cli }),
      derivedFrom: { sourcePath: file.sourcePath, pointer: request.pointer },
    };
    done.set(same, made);
    return made;
  };
  const hasCut = allFiles(item).some((file) => file?.cut !== undefined);
  if (!hasCut) return item;
  const files = (Array.isArray(item.files) ? item.files : []).map((file) => cut(file));
  const editions =
    item.editions === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(item.editions).map(([cli, edition]) => [
            cli,
            { files: (edition?.files ?? []).map((file) => cut(file, cli)) },
          ]),
        );
  if (problems.length > 0) return problems;
  return { ...item, files, ...(editions ? { editions } : {}) };
}

/**
 * Builds one framework content document from a local, Git or npm source, its files and the items
 * `findItems` proposed. Every item file and notice must be supplied with bytes matching its
 * sha256; a changed byte is `refused` (`source-mismatch`). File-owned fields that the bytes
 * cannot support (no name, no description, malformed frontmatter) are `invalid`.
 *
 * Items may also name files of `sources` (further pins, or Catalog's authored files), and may
 * ask for an entry of a shared upstream file to be cut out (`cut` on a file): Catalog writes it
 * as its own canonical file in the authored source `<framework>-generated`, returned in
 * `generated` for committing under `data/<framework>/generated/`.
 */
export async function buildContent(
  source: FetchedSource | { readonly kind: "authored" },
  files: readonly SourceFile[],
  items: readonly DiscoveredItem[],
  options: {
    readonly framework: string | { readonly id: string; readonly name: string };
    readonly sourceId?: string;
    /**
     * Folders of the source (`/` for all of it) to record as upstream plugin folders, each
     * optionally narrowed to the upstream's runtime allowlist with `include`.
     */
    readonly plugins?: readonly PluginRequest[];
    /** Runtime bundles the items read (`bundle` on a discovered item names one). */
    readonly bundles?: readonly BundleRequest[];
    /** Further sources the items' files name. */
    readonly sources?: readonly ExtraSource[];
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
  const generatedId = `${framework.id}-generated`;
  const extras = options.sources ?? [];
  if (!Array.isArray(extras) || !Array.isArray(files))
    return {
      status: "invalid",
      problems: [{ path: "sources", message: "files and sources are lists" }],
    };
  const extraPins: ContentSource[] = [];
  const seenIds = new Set([sourceId, generatedId]);
  for (const [at, extra] of extras.entries()) {
    const where = `sources/${at}`;
    if (typeof extra?.id !== "string" || !FRAMEWORK_ID.test(extra.id) || seenIds.has(extra.id))
      return {
        status: "invalid",
        problems: [{ path: `${where}/id`, message: "a further source needs its own source id" }],
      };
    seenIds.add(extra.id);
    if (!Array.isArray(extra.files))
      return {
        status: "invalid",
        problems: [{ path: `${where}/files`, message: "files is a list" }],
      };
    const pin = sourcePin(extra.source);
    if (typeof pin === "string")
      return { status: "invalid", problems: [{ path: `${where}/source`, message: pin }] };
    extraPins.push({
      id: extra.id,
      ...pin,
      notices: [],
      ...(extra.noticesFor ? { noticesFor: [...extra.noticesFor].sort(compareCodeUnits) } : {}),
    });
  }
  const tagged: SourceFile[] = [
    ...files.map((file) => ({ ...file, sourceId: sourceId })),
    ...extras.flatMap((extra) =>
      extra.files.map((file: SourceFile) => ({ ...file, sourceId: extra.id })),
    ),
  ];
  const index = indexFiles(tagged, sourceId);
  if (index.problem) return index.problem;
  const problems: Problem[] = [];
  const notices = noticesOf(files, sourceId, index, problems);
  const sources: ContentSource[] = [
    { id: sourceId, ...pinned, notices },
    ...extraPins.map((pin, at) => ({
      ...pin,
      notices: noticesOf((extras[at] as ExtraSource).files, pin.id, index, problems),
    })),
  ];
  const bundles = new Map<string, Bundle>();
  const requested = options.bundles ?? [];
  if (!Array.isArray(requested)) problems.push({ path: "bundles", message: "bundles is a list" });
  else
    for (const request of requested) {
      const result = await bundleRecord(request, sourceId, files, index);
      if (Array.isArray(result)) problems.push(...result);
      else if (bundles.has(result.id))
        problems.push({ path: `bundles/${result.id}`, message: "the bundle id is used twice" });
      else bundles.set(result.id, result);
    }
  const generated: GeneratedFile[] = [];
  const built: Item[] = [];
  const proposed: readonly DiscoveredItem[] = Array.isArray(items) ? items : [];
  const known = new Set(seenIds);
  for (const proposal of proposed) {
    const item = cutItem(proposal, sourceId, generatedId, index, generated);
    if (Array.isArray(item)) {
      problems.push(...item);
      continue;
    }
    const wrongSource = allFiles(item).filter((file) => !known.has(file.sourceId));
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
        index.has(file.sourceId, file.sourcePath) &&
        sha256Hex(index.bytesOf(file.sourceId, file.sourcePath)) !== file.sha256,
    );
    if (mismatched)
      return refused(
        "source-mismatch",
        `the bytes of ${quote(mismatched.sourcePath)} differ from the item's sha256`,
      );
    const result = await assemble(item, index, bundles, sourceId);
    if (Array.isArray(result)) {
      problems.push(...result);
      continue;
    }
    built.push(result.item);
  }
  const plugins: PluginFolder[] = [];
  const folders = options.plugins ?? [];
  const folderOf = (request: PluginRequest) =>
    typeof request === "string" ? request : String(request?.path);
  const keyOf = (request: PluginRequest) =>
    `${folderOf(request)}\0${typeof request === "string" ? "" : (request?.plugin ?? "")}`;
  if (!Array.isArray(folders) || new Set(folders.map(keyOf)).size !== folders.length)
    problems.push({ path: "plugins", message: "plugins lists distinct folders" });
  else
    for (const folder of [...folders].sort((left, right) =>
      compareCodeUnits(keyOf(left), keyOf(right)),
    )) {
      const result = await pluginFolder(folder, sourceId, files, index);
      if (Array.isArray(result)) problems.push(...result);
      else plugins.push(result);
    }
  if (problems.length > 0) return { status: "invalid", problems };
  if (generated.length > 0) sources.push({ id: generatedId, kind: "authored", notices: [] });
  const content: Content = {
    schema: formats.content,
    framework: { id: framework.id, name: framework.name },
    sources,
    items: built.sort((left, right) => compareCodeUnits(left.id, right.id)),
    ...(bundles.size > 0
      ? {
          bundles: [...bundles.values()].sort((left, right) => compareCodeUnits(left.id, right.id)),
        }
      : {}),
    ...(plugins.length > 0 ? { plugins } : {}),
  };
  const shape = contentProblems(content);
  if (shape.length > 0) return { status: "invalid", problems: shape };
  const bytes = new TextEncoder().encode(canonicalDocument(content));
  if (bytes.byteLength > limits.contentFileBytes)
    return limitRefusal("contentFileBytes", "the content document");
  return {
    status: "ok",
    content: deepFreeze(content),
    bytes,
    generated: generated.sort((left, right) => compareCodeUnits(left.path, right.path)),
  };
}

export type CheckContentResult =
  | {
      readonly status: "ok";
      readonly problems: readonly [];
      readonly unscannedKeys?: readonly string[];
      /**
       * Paths items name outside their own files that their bundle does not provide (every
       * one, for an item with no bundle): they resolve only through a plugin route.
       */
      readonly pathReferences?: readonly {
        readonly item: string;
        readonly sourcePath: string;
        readonly path: string;
      }[];
    }
  | Invalid;

/**
 * Checks a content record. Without files it checks shape and record-derived digests only;
 * with files it also checks every item file's bytes, length, file-owned fields and scan key.
 * Files of a source other than the content's first are tagged with their `sourceId` (the
 * committed generated and authored copies, for example). With `scannedKeys` it lists the
 * item scan keys that have no matching scan.
 */
export async function checkContent(
  content: Content,
  files?: readonly SourceFile[],
  options: { readonly scannedKeys?: readonly string[] } = {},
): Promise<CheckContentResult> {
  const problems: Problem[] = [...contentProblems(content)];
  const primary = content?.sources?.[0]?.id ?? "";
  const ofSource = (sourceId: string) =>
    (files ?? []).filter((file) => sourceOf(file, primary) === sourceId);
  if (problems.length === 0 && files !== undefined) {
    const index = indexFiles(files, primary);
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
      const named = allFiles(view);
      const absent = named.filter((file) => !index.has(file.sourceId, file.sourcePath));
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
        const bytes = index.bytesOf(file.sourceId, file.sourcePath);
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
      const result = await assemble(
        view,
        index,
        new Map((content.bundles ?? []).map((bundle) => [bundle.id, bundle])),
        primary,
      );
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
    for (const [at, bundle] of (content.bundles ?? []).entries()) {
      const index = indexFiles(files, primary);
      const result = await bundleRecord(
        {
          id: bundle.id,
          layout: bundle.layout,
          include: bundle.files.map((file) => file.sourcePath),
        },
        bundle.sourceId,
        ofSource(bundle.sourceId),
        index,
      );
      if (Array.isArray(result) || canonicalJson(result) !== canonicalJson(bundle))
        problems.push({
          path: `bundles/${at}`,
          message: "the recorded bundle differs from the files",
        });
    }
  if (problems.length === 0 && files !== undefined)
    for (const [at, plugin] of (content.plugins ?? []).entries()) {
      const index = indexFiles(files, primary);
      const result = await pluginFolder(
        plugin.include || plugin.plugin
          ? {
              path: plugin.path,
              ...(plugin.include ? { include: plugin.include } : {}),
              ...(plugin.plugin ? { plugin: plugin.plugin } : {}),
            }
          : plugin.path,
        plugin.sourceId,
        ofSource(plugin.sourceId),
        index,
      );
      if (Array.isArray(result)) problems.push(...result);
      else if (canonicalJson(result) !== canonicalJson(plugin))
        problems.push({
          path: `plugins/${at}`,
          message: "the recorded plugin folder differs from the files",
        });
    }
  if (problems.length > 0) return { status: "invalid", problems };
  const bundleFiles = new Map(
    (content.bundles ?? []).map((bundle) => [
      bundle.id,
      new Set(bundle.files.map((file) => file.sourcePath)),
    ]),
  );
  const uncovered = content.items.flatMap((item) =>
    (item.pathReferences ?? [])
      .filter(
        (reference) =>
          item.bundle === undefined || !bundleFiles.get(item.bundle)?.has(reference.path),
      )
      .map((reference) => ({ item: item.id, ...reference })),
  );
  const paths = uncovered.length > 0 ? { pathReferences: uncovered } : {};
  if (options.scannedKeys === undefined) return { status: "ok", problems: [], ...paths };
  const scanned = new Set(options.scannedKeys);
  // Every item, edition and bundle has its own key: an item's scan covers neither its bundle
  // nor another edition.
  const unscannedKeys = [
    ...new Set(
      [
        // Upstream-only items are not scanned for now, so the gate leaves their keys out.
        ...content.items.flatMap((item) =>
          item.fetch === "upstream"
            ? []
            : [
                item.scanKey,
                ...Object.values(item.editions ?? {}).map((edition) => edition.scanKey),
              ],
        ),
        ...(content.bundles ?? []).map((bundle) => bundle.scanKey),
        // A recorded plugin folder is installed by a plugin or local-plugin route (D72).
        ...(content.plugins ?? []).flatMap((plugin) => [plugin.scanKey, plugin.folderScanKey]),
      ].flatMap((key) => (key && !scanned.has(key) ? [key] : [])),
    ),
  ].sort(compareCodeUnits);
  return { status: "ok", problems: [], unscannedKeys, ...paths };
}
