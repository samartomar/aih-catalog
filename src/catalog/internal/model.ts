/** Shapes shared by the new Catalog entry points. */
import type { Kind, LeftOverReason } from "../contracts.js";
import type { Bundle, PathReference } from "./bundle.js";

export type { Bundle, BundleFile, PathReference } from "./bundle.js";

/** Git-style modes for regular files; links and special files are never read. */
export type SourceFileMode = "100644" | "100755" | "link" | "special-file";

/**
 * One entry of a source as read from a folder, Git tree or unpacked package. Regular files
 * carry their sha256 and, when read, their bytes; links and special files carry neither.
 */
export interface SourceFile {
  /**
   * The content source the file belongs to, when a call reads several sources (extra and
   * generated sources). Untagged files belong to the call's own (first) source.
   */
  readonly sourceId?: string;
  readonly path: string;
  readonly mode: SourceFileMode;
  readonly sha256?: string;
  readonly bytes?: Uint8Array;
}

export interface LocalSource {
  readonly kind: "local";
  readonly path: string;
}

/** A Git source at one exact commit; with a `subpath`, only that folder is the source. */
export interface GitSource {
  readonly kind: "git";
  readonly repository: string;
  readonly commit: string;
  readonly subpath?: string;
}

/** An npm source at one exact version. */
export interface NpmSource {
  readonly kind: "npm";
  readonly package: string;
  readonly version: string;
}

/** What `readLocalSource` and `fetchSource` read files from. */
export type FetchedSource = LocalSource | GitSource | NpmSource;

export interface ItemFile {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly executable: boolean;
  readonly role: "content" | "behaviour";
  readonly cli?: string;
  readonly derivedFrom?: { readonly sourcePath: string; readonly pointer: string };
}

export interface Notice {
  readonly sourcePath: string;
  readonly sha256: string;
  /** A folder of the source (no trailing slash), or `/` for all of it. */
  readonly covers: string;
}

export interface ContentSource {
  readonly id: string;
  readonly kind: "git" | "npm" | "local" | "authored";
  readonly repository?: string;
  readonly commit?: string;
  readonly package?: string;
  readonly version?: string;
  readonly subpath?: string;
  readonly notices: readonly Notice[];
  readonly noticesFor?: readonly string[];
}

export type RuleScope =
  | "always"
  | "on-request"
  | { readonly paths: readonly string[] }
  | { readonly byDescription: true };

export interface Item {
  readonly id: string;
  readonly kind: Kind;
  readonly name: string;
  readonly description: string;
  readonly files: readonly ItemFile[];
  readonly contentSha256: string;
  readonly behaviourSha256: string;
  readonly scanKey?: string;
  readonly userOnly?: boolean;
  readonly arguments?: boolean;
  readonly scope?: RuleScope;
  readonly language?: string;
  readonly requirements?: Requirements;
  readonly dependencies?: readonly string[];
  /** Plugin-namespaced names the item's files mention (authored names, files read from bytes). */
  readonly references?: readonly NamespacedReference[];
  readonly bundle?: string;
  /** Source files the item's text names outside its own files (read from the files). */
  readonly pathReferences?: readonly PathReference[];
  readonly supersedes?: readonly string[];
  readonly fetch?: "upstream";
  readonly editions?: Readonly<Record<string, Edition>>;
  readonly agent?: AgentRecord;
  readonly purpose?: string;
  readonly [field: string]: unknown;
}

/**
 * A name such as `ecc:security-reviewer` that the upstream's plugin would provide, and one item
 * file that mentions it. The names are authored; which files mention them is read from bytes.
 */
export interface NamespacedReference {
  readonly name: string;
  readonly sourcePath: string;
}

/** `<namespace>:<name>`, as a plugin namespaces its skills and agents. */
export const NAMESPACED_NAME = /^[a-z0-9][a-z0-9_-]*:[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** One file of a recorded plugin folder, addressed from its source's root. */
export interface PluginFile {
  readonly sourcePath: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly executable: boolean;
}

/**
 * An upstream plugin folder recorded at its source's pin: every regular file under `path`
 * (`/` for the whole source) with its bytes' identity, and the folder's scan key. A `plugin`
 * route checks it and a `local-plugin` route copies it as one unit.
 */
export interface PluginFolder {
  readonly sourceId: string;
  readonly path: string;
  /**
   * The upstream's runtime allowlist, when only part of the folder is the plugin: sorted
   * patterns over source paths, `*` within one segment, and a pattern ending in `/` takes every
   * file below that folder. Absent means every file under `path`.
   */
  readonly include?: readonly string[];
  /**
   * The upstream plugin this record's allowlist describes, when several plugins of one
   * marketplace share the folder; a recipe's plugin entry then matches it by name.
   */
  readonly plugin?: string;
  readonly files: readonly PluginFile[];
  /** The key of the recorded files: what a `local-plugin` route copies. */
  readonly scanKey: string;
  /**
   * With `include`: the key of every file under `path`, which is what a native plugin install
   * clones at the pin and so what a `plugin` step names. Absent when the record is the folder.
   */
  readonly folderScanKey?: string;
}

export interface Content {
  readonly schema: string;
  readonly framework: { readonly id: string; readonly name: string };
  readonly sources: readonly ContentSource[];
  readonly items: readonly Item[];
  readonly bundles?: readonly Bundle[];
  readonly plugins?: readonly PluginFolder[];
}

/**
 * One entry of a shared upstream file (an MCP config or a hooks file) to cut out as its own
 * item file. `pointer` is the JSON Pointer of the entry; `as` names the file it becomes.
 * For an MCP entry whose package carries no exact version, `version` is the exact version
 * Catalog pins (an authored fact recorded only in the generated `server.json`), and `inputs`
 * names literal placeholder text the entry uses, as the input that replaces it.
 */
export interface CutRequest {
  readonly pointer: string;
  readonly as: "hook" | "mcp";
  /** For an MCP entry that has no description of its own: the description Catalog authors. */
  readonly description?: string;
  readonly version?: string;
  readonly inputs?: Readonly<Record<string, string>>;
}

/** A file as discovery proposes it, before `buildContent` records its length. */
export interface DiscoveredFile {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly sha256: string;
  readonly executable: boolean;
  readonly role: "content" | "behaviour";
  readonly cli?: string;
  /** Cut this entry out of the shared file `sourcePath` names (sha256 is that file's). */
  readonly cut?: CutRequest;
  /** For a generated file already cut out: where its entry came from (provenance only). */
  readonly derivedFrom?: { readonly sourcePath: string; readonly pointer: string };
}

/** One declared input. A secret input never carries a value. */
export interface InputDeclaration {
  readonly description: string;
  readonly isRequired: boolean;
  readonly isSecret: boolean;
  readonly default?: string;
  /** A marker the installer replaces in one item file; the render keeps it. */
  readonly placeholder?: { readonly sourcePath: string; readonly marker: string };
}

export interface Requirements {
  readonly inputs: Readonly<Record<string, InputDeclaration>>;
  readonly tools?: readonly unknown[];
}

/** An upstream-authored variant of an item for one client. */
export interface Edition {
  readonly files: readonly ItemFile[];
  readonly scanKey: string;
}

/** A neutral agent record. `prompt` is the file whose body is the prompt. */
export interface AgentRecord {
  readonly prompt: string;
  readonly tools?: readonly string[];
  readonly model?: string;
  readonly color?: string;
  readonly background?: boolean;
}

/**
 * An item as discovery proposes it, before `buildContent` reads its file-owned fields. The
 * optional fields are authored (by Catalog, or by you for your own content), never read from
 * files: a former command's `userOnly`, editions, requirements, dependencies and a
 * document's purpose.
 */
export interface DiscoveredItem {
  readonly id: string;
  readonly kind: Kind;
  readonly files: readonly DiscoveredFile[];
  readonly userOnly?: true;
  readonly editions?: Readonly<Record<string, { readonly files: readonly DiscoveredFile[] }>>;
  readonly requirements?: Requirements;
  readonly dependencies?: readonly string[];
  readonly purpose?: string;
  /** The id of the content's bundle the item reads at run time. */
  readonly bundle?: string;
  /** Plugin-namespaced names the item's files mention, such as `ecc:security-reviewer`. */
  readonly references?: readonly string[];
  /** `upstream` when Catalog may not ship copies: the plan fetches the files at the pin. */
  readonly fetch?: "upstream";
  /** An AI setup's authored install name, description and record (`ai-setup` items only). */
  readonly name?: string;
  readonly description?: string;
  readonly aiSetup?: unknown;
  /** An MCP item's authored settings: tool lists, timeouts and non-secret env. */
  readonly enabledTools?: readonly string[];
  readonly disabledTools?: readonly string[];
  readonly startupSeconds?: number;
  readonly callSeconds?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export interface LeftOver {
  readonly path: string;
  readonly reason: LeftOverReason;
  /** For `not-implemented`: the kind (or `command`) the path looks like. */
  readonly kind?: string;
}

export const ID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const FRAMEWORK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const INPUT_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
export const INSTALL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SHA256 = /^[0-9a-f]{64}$/;
/** A Git object id: SHA-1 (40 hex) or SHA-256 (64 hex). */
export const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
export const NPM_PACKAGE = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
/** An exact semantic version (no leading zeroes, optional pre-release and build). */
export const EXACT_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
/** A Scan key: Git tree id of the item folder, SHA-1 or SHA-256 object format. */
export const SCAN_KEY = /^git-sha(?:1:[0-9a-f]{40}|256:[0-9a-f]{64})$/;
/** A version range as the upstream states it (`>=3.11,<3.15`); never empty or a wildcard. */
export const RANGE = /^(?:(?:>=|<=|==|~=|!=|>|<)\s*[0-9][0-9A-Za-z.+-]*\s*,?\s*)+$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
/** A wheel file name: binary-only closures hold wheels and nothing built from source. */
export const WHEEL = /^[A-Za-z0-9_.+-]+\.whl$/;
