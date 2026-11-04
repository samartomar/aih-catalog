/** Shapes shared by the new Catalog entry points. */
import type { Kind, LeftOverReason } from "../contracts.js";

/** Git-style modes for regular files; links and special files are never read. */
export type SourceFileMode = "100644" | "100755" | "link" | "special-file";

/**
 * One entry of a source as read from a folder, Git tree or unpacked package. Regular files
 * carry their sha256 and, when read, their bytes; links and special files carry neither.
 */
export interface SourceFile {
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
  readonly references?: readonly string[];
  readonly bundle?: string;
  readonly supersedes?: readonly string[];
  readonly fetch?: "upstream";
  readonly editions?: Readonly<Record<string, Edition>>;
  readonly agent?: AgentRecord;
  readonly purpose?: string;
  readonly [field: string]: unknown;
}

export interface Content {
  readonly schema: string;
  readonly framework: { readonly id: string; readonly name: string };
  readonly sources: readonly ContentSource[];
  readonly items: readonly Item[];
  readonly bundles?: readonly unknown[];
}

/** A file as discovery proposes it, before `buildContent` records its length. */
export interface DiscoveredFile {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly sha256: string;
  readonly executable: boolean;
  readonly role: "content" | "behaviour";
  readonly cli?: string;
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
