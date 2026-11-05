/**
 * `@aihq/catalog/node` (new model): reading local folders and content files. Reads bytes
 * only; never follows links, runs hooks or executes anything it reads.
 */
import { createHash } from "node:crypto";
import {
  type BigIntStats,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { type Invalid, limits, type Refused } from "./contracts.js";
import {
  acquireGit,
  acquireNpm,
  type Bounds,
  boundsProblem,
  LOCAL_ONLY_FROM_USER,
  type Skipped,
} from "./internal/acquire.js";
import type { GitSource, LocalSource, NpmSource, SourceFile } from "./internal/model.js";
import { compareCodeUnits, limitRefusal, quote, refused } from "./internal/paths.js";
import { isGitMetadataName, type SourceCandidate } from "./internal/source-link.js";
import { type ReadContentResult, readContent } from "./reader.js";

export type { Skipped } from "./internal/acquire.js";
export type {
  FetchedSource,
  GitSource,
  LocalSource,
  NpmSource,
  SourceFile,
} from "./internal/model.js";

export type ReadLocalSourceResult =
  | {
      readonly status: "ok";
      readonly source: LocalSource;
      readonly files: readonly SourceFile[];
      /** Entries deliberately not read: Git metadata (`.git` in any case, at any depth). */
      readonly skipped: readonly { readonly path: string; readonly reason: "vcs-metadata" }[];
    }
  | Refused;

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** A file system object's identity, compared to notice an entry replaced while it is read. */
type Identity = { readonly dev: bigint; readonly ino: bigint };
const sameObject = (left: Identity, right: Identity): boolean =>
  left.dev === right.dev && left.ino === right.ino;

/** True when the real path `real` is the folder `root` or inside it. */
const isUnder = (real: string, root: string): boolean =>
  real === root || real.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

/**
 * Reads one regular file without following a link, holding it to `maxBytes`. The file opened
 * must be the one at `path` before and after it is opened and, with `realRoot`, really be inside
 * that folder: an entry or a folder above it replaced by a link while it is read is "changed".
 */
function readRegular(
  path: string,
  maxBytes: number,
  realRoot?: string,
): Buffer | "changed" | "too-large" {
  const before = lstatSync(path, { bigint: true });
  if (!before.isFile()) return "changed";
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stats = fstatSync(descriptor, { bigint: true });
    if (!stats.isFile() || stats.nlink > 1n || !sameObject(before, stats)) return "changed";
    if (realRoot !== undefined && !isUnder(realpathSync.native(path), realRoot)) return "changed";
    if (!sameObject(lstatSync(path, { bigint: true }), stats)) return "changed";
    if (stats.size > BigInt(maxBytes)) return "too-large";
    const size = Number(stats.size);
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const count = readSync(descriptor, buffer, offset, size - offset, offset);
      if (count === 0) return "changed";
      offset += count;
    }
    if (readSync(descriptor, Buffer.alloc(1), 0, 1, offset) !== 0) return "changed";
    return buffer;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Lists one folder of a local read, refusing when the folder at `absolute` is not the one found
 * earlier, before or after it is listed, or is not really inside the root.
 */
function listFolder(
  absolute: string,
  expected: Identity,
  realRoot: string,
): string[] | "changed" | "unreadable" {
  const unchanged = (): boolean => {
    const stats = lstatSync(absolute, { bigint: true });
    return stats.isDirectory() && sameObject(stats, expected);
  };
  try {
    if (!unchanged() || !isUnder(realpathSync.native(absolute), realRoot)) return "changed";
    const names = readdirSync(absolute);
    if (!unchanged()) return "changed";
    return names.sort(compareCodeUnits);
  } catch {
    return "unreadable";
  }
}

/**
 * Reads every entry under a local folder. Regular files are read with
 * their bytes, sha256 and executable bit. Symlinks and hard links are listed as `link`,
 * devices, FIFOs and sockets as `special-file`; neither is followed or read. Git metadata (a
 * `.git` folder or file at any depth, in any case) is skipped and reported. An entry replaced
 * while it is read refuses the read, as does any limit breach.
 */
export function readLocalSource(path: string): ReadLocalSourceResult {
  if (typeof path !== "string" || path.length === 0)
    return refused("not-found", "no local path was given");
  let rootStats: BigIntStats;
  let realRoot: string;
  try {
    rootStats = lstatSync(path, { bigint: true });
  } catch {
    return refused("not-found", "the local path does not exist");
  }
  if (rootStats.isSymbolicLink()) return refused("link", "the local path is a link");
  if (!rootStats.isDirectory()) return refused("not-a-directory", "the local path is not a folder");
  try {
    realRoot = realpathSync.native(path);
  } catch {
    return refused("unreadable", "the local path cannot be read");
  }

  const files: SourceFile[] = [];
  const skipped: { path: string; reason: "vcs-metadata" }[] = [];
  let entries = 0;
  let regularFiles = 0;
  let totalBytes = 0;
  const pending: { relative: string; identity: Identity }[] = [
    { relative: "", identity: rootStats },
  ];
  while (pending.length > 0) {
    const { relative, identity } = pending.pop() as (typeof pending)[number];
    const names = listFolder(join(path, relative), identity, realRoot);
    if (names === "unreadable")
      return refused("unreadable", `the folder ${quote(relative || ".")} cannot be read`);
    if (names === "changed")
      return refused(
        "source-mismatch",
        `the folder ${quote(relative || ".")} changed while it was read`,
      );
    const folders: { relative: string; identity: Identity }[] = [];
    for (const name of names) {
      const entry = relative === "" ? name : `${relative}/${name}`;
      if (name.includes("\\") || name.includes("\0")) {
        return refused("path-escape", `the entry ${quote(entry)} is not a safe relative path`);
      }
      entries += 1;
      if (entries > limits.sourceEntries)
        return limitRefusal("sourceEntries", "the source entry count");
      if (isGitMetadataName(name)) {
        skipped.push({ path: entry, reason: "vcs-metadata" });
        continue;
      }
      const absolute = join(path, entry);
      let stats: BigIntStats;
      try {
        stats = lstatSync(absolute, { bigint: true });
      } catch {
        return refused("unreadable", `the entry ${quote(entry)} cannot be read`);
      }
      if (stats.isSymbolicLink()) files.push({ path: entry, mode: "link" });
      else if (stats.isDirectory()) folders.push({ relative: entry, identity: stats });
      else if (!stats.isFile()) files.push({ path: entry, mode: "special-file" });
      else if (stats.nlink > 1n) files.push({ path: entry, mode: "link" });
      else {
        regularFiles += 1;
        if (regularFiles > limits.sourceFiles)
          return limitRefusal("sourceFiles", "the source file count");
        if (stats.size > BigInt(limits.sourceFileBytes))
          return limitRefusal("sourceFileBytes", `the file ${quote(entry)}`);
        let bytes: Buffer | "changed" | "too-large";
        try {
          bytes = readRegular(absolute, limits.sourceFileBytes, realRoot);
        } catch {
          return refused("unreadable", `the file ${quote(entry)} cannot be read`);
        }
        if (bytes === "too-large")
          return limitRefusal("sourceFileBytes", `the file ${quote(entry)}`);
        if (bytes === "changed")
          return refused("source-mismatch", `the file ${quote(entry)} changed while it was read`);
        totalBytes += bytes.byteLength;
        if (totalBytes > limits.sourceBytes)
          return limitRefusal("sourceBytes", "the source byte total");
        files.push({
          path: entry,
          mode: (stats.mode & 0o100n) !== 0n ? "100755" : "100644",
          sha256: sha256(bytes),
          bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        });
      }
    }
    for (const folder of folders.reverse()) pending.push(folder);
  }
  files.sort((left, right) => compareCodeUnits(left.path, right.path));
  return { status: "ok", source: { kind: "local", path }, files, skipped };
}

/** Reads a content document from disk within the content-file limit, then `readContent`. */
export function readContentFile(path: string): ReadContentResult | Refused {
  let stats: Stats;
  try {
    stats = lstatSync(path);
  } catch {
    return refused("not-found", "the content file does not exist");
  }
  if (stats.isSymbolicLink()) return refused("link", "the content file is a link");
  if (!stats.isFile()) return refused("not-a-file", "the content file is not a regular file");
  if (stats.size > limits.contentFileBytes)
    return limitRefusal("contentFileBytes", "the content file");
  let bytes: Buffer | "changed" | "too-large";
  try {
    bytes = readRegular(path, limits.contentFileBytes);
  } catch {
    return refused("unreadable", "the content file cannot be read");
  }
  if (bytes === "too-large") return limitRefusal("contentFileBytes", "the content file");
  if (bytes === "changed")
    return refused("source-mismatch", "the content file changed while it was read");
  return readContent(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

export type FetchSourceResult =
  | {
      readonly status: "ok";
      readonly source: LocalSource | GitSource | NpmSource;
      readonly files: readonly SourceFile[];
      /** Entries deliberately not read: VCS metadata and Git submodules. */
      readonly skipped: readonly Skipped[];
      /** For npm: the tarball's sha512 integrity, checked against what npm verified. */
      readonly integrity?: string;
    }
  | Refused
  | Invalid;

export interface FetchSourceOptions extends Bounds {
  /** The folder fetch work happens in; each fetch uses a new folder inside it and removes it. */
  readonly outDir: string;
  /** The npm registry: an https URL, or plain http on a loopback address. */
  readonly registry?: string;
  /** For npm: the sha512 integrity the tarball must have. */
  readonly integrity?: string;
  /**
   * For npm: the path of an npm config file the caller chose, such as one holding a private
   * registry's token. Without it npm reads no user config; global, project and environment
   * config are never read. Every registry it names must pass the same rule as `registry`.
   */
  readonly npmConfig?: string;
  /**
   * True when the candidate comes from text the user typed or pasted. Only then is a folder or
   * Git repository on this machine (a path or `file:` URL) read.
   */
  readonly fromUser?: boolean;
  /** A shorter limit than the default of 10 minutes on the whole fetch's running time. */
  readonly timeoutMs?: number;
  /** A lower limit than the default of four times `sourceBytes` on the fetch's disk use. */
  readonly diskBytes?: number;
}

/**
 * Reads the source a `parseSourceLink` candidate names. A local folder is read with
 * `readLocalSource` (a leading `~` is the home folder). A Git candidate is fetched at its
 * ref (a branch or tag is pinned to the commit it names now; no ref means the default
 * branch) without hooks, checkout or user configuration; with a `subpath` only that folder
 * is the source. An npm candidate is resolved to one exact version and its tarball unpacked
 * as files only, with lifecycle scripts disabled. Working files go in a new folder inside
 * `outDir`; `registry` overrides the npm registry. Every source limit applies.
 */
export async function fetchSource(
  candidate: SourceCandidate,
  options: FetchSourceOptions,
): Promise<FetchSourceResult> {
  const problem = boundsProblem(options);
  if (problem !== null) return { status: "invalid", problems: [problem] };
  switch (candidate?.kind) {
    case "local": {
      const path = candidate.path;
      if (typeof path !== "string") return refused("not-found", "no local path was given");
      if (options?.fromUser !== true)
        return {
          status: "invalid",
          problems: [{ path: "candidate", message: LOCAL_ONLY_FROM_USER }],
        };
      const expanded =
        path === "~" ? homedir() : /^~[\\/]/.test(path) ? join(homedir(), path.slice(2)) : path;
      return readLocalSource(expanded);
    }
    case "git":
      return acquireGit(candidate, options?.outDir, {
        fromUser: options?.fromUser === true,
        ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options?.diskBytes === undefined ? {} : { diskBytes: options.diskBytes }),
      });
    case "npm":
      return acquireNpm(candidate, options);
    default:
      return {
        status: "invalid",
        problems: [{ path: "candidate", message: "the candidate kind must be local, git or npm" }],
      };
  }
}
