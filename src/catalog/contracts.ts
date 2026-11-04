/**
 * `@aihq/catalog/contracts` (new model): format identities, kinds, published limits and
 * refusal codes. Pure data; importing it performs no host work.
 */

export const formats = {
  content: "urn:aihq:catalog:content:0.1.0",
  toolProfile: "urn:aihq:catalog:tool-profile:0.1.0",
} as const;

/** Every item kind the content format names. */
export const kinds = ["skill", "agent", "rule", "hook", "mcp", "document", "ai-setup"] as const;
export type Kind = (typeof kinds)[number];

/**
 * Kinds this implementation discovers, builds and plans today. Other kinds stay explicit:
 * discovery lists their files as `not-implemented` leftovers and planning reports them
 * `unavailable` with reason `not-implemented`.
 */
export const implementedKinds = ["skill", "rule"] as const satisfies readonly Kind[];

const MiB = 1024 * 1024;

/** Published limits. Exceeding one is `refused` with code `limit` and the limit's name. */
export const limits = {
  /** `parseSourceLink` input characters. */
  sourceLinkCharacters: 2048,
  /** One content document. */
  contentFileBytes: 64 * MiB,
  /** One source file. */
  sourceFileBytes: 16 * MiB,
  /** All files of one source. */
  sourceBytes: 256 * MiB,
  /** Regular files in one source. */
  sourceFiles: 65_536,
  /** Entries of any type (files, folders, links, special files) in one source. */
  sourceEntries: 100_000,
  /** Characters of input quoted in a refusal reason. */
  refusalQuoteCharacters: 128,
  /** JSON nesting depth of a content document or tool profile. */
  documentDepth: 64,
  /** One tool profile document. */
  toolProfileBytes: 1 * MiB,
} as const;
export type LimitName = keyof typeof limits;

/** Codes a `refused` result can carry. */
export const refusalCodes = [
  /** An entry path is absolute, uses `..`, a backslash or an empty segment. */
  "path-escape",
  /** A published limit was exceeded; the result names it in `limit`. */
  "limit",
  /** Supplied bytes differ from the recorded sha256 (a changed or wrong file). */
  "source-mismatch",
  /** A render step names a profile version other than the one supplied. */
  "profile-mismatch",
  /** A selected or referenced item id is not in the supplied content. */
  "unknown-item",
  /** The local path does not exist. */
  "not-found",
  /** The local path is not a folder. */
  "not-a-directory",
  /** The local path is not a regular file. */
  "not-a-file",
  /** The local root itself is a link; links are never followed. */
  "link",
  /** The local path could not be read. */
  "unreadable",
  /** The request needs behavior this implementation does not provide yet. */
  "not-implemented",
] as const;
export type RefusalCode = (typeof refusalCodes)[number];

/** Why a discovered entry did not become part of an item or notice. */
export const leftOverReasons = [
  /** A symlink or hard link; never followed or copied. */
  "link",
  /** A device, FIFO or socket; never read. */
  "special-file",
  /** A file of a known kind whose discovery is not implemented yet (see `kind`). */
  "not-implemented",
  /** A path that cannot form an item id. */
  "unrepresentable-id",
  /** A `SKILL.md` at the source root or inside another skill's folder. */
  "ambiguous-skill",
  /** Any other file. */
  "unrecognised",
] as const;
export type LeftOverReason = (typeof leftOverReasons)[number];

export interface Problem {
  readonly path: string;
  readonly message: string;
}

export type Refused = {
  readonly status: "refused";
  readonly code: RefusalCode;
  readonly reason: string;
  readonly limit?: LimitName;
};
export type Invalid = { readonly status: "invalid"; readonly problems: readonly Problem[] };
export type UnsupportedVersion = {
  readonly status: "unsupported-version";
  readonly schema: string;
};
