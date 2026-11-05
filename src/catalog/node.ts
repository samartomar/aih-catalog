/**
 * `@aihq/catalog/node` (new model): reading local folders and content files. Reads bytes
 * only; never follows links, runs hooks or executes anything it reads.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Invalid, limits, type Refused } from "./contracts.js";
import { acquireGit, acquireNpm, type Skipped } from "./internal/acquire.js";
import type { GitSource, LocalSource, NpmSource, SourceFile } from "./internal/model.js";
import { compareCodeUnits, limitRefusal, quote, refused } from "./internal/paths.js";
import type { SourceCandidate } from "./internal/source-link.js";
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
      /** Folders deliberately not read: the root `.git` metadata folder. */
      readonly skipped: readonly { readonly path: string; readonly reason: "vcs-metadata" }[];
    }
  | Refused;

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Reads one regular file without following a link, holding it to `maxBytes`. */
function readRegular(path: string, maxBytes: number): Buffer | "changed" | "too-large" {
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.nlink > 1) return "changed";
    if (stats.size > maxBytes) return "too-large";
    const buffer = Buffer.alloc(stats.size);
    let offset = 0;
    while (offset < stats.size) {
      const count = readSync(descriptor, buffer, offset, stats.size - offset, offset);
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
 * Reads every entry under a local folder. Regular files are read with
 * their bytes, sha256 and executable bit. Symlinks and hard links are listed as `link`,
 * devices, FIFOs and sockets as `special-file`; neither is followed or read. A root `.git`
 * folder is skipped and reported. Any limit breach refuses the whole read.
 */
export function readLocalSource(path: string): ReadLocalSourceResult {
  if (typeof path !== "string" || path.length === 0)
    return refused("not-found", "no local path was given");
  let rootStats: Stats;
  try {
    rootStats = lstatSync(path);
  } catch {
    return refused("not-found", "the local path does not exist");
  }
  if (rootStats.isSymbolicLink()) return refused("link", "the local path is a link");
  if (!rootStats.isDirectory()) return refused("not-a-directory", "the local path is not a folder");

  const files: SourceFile[] = [];
  const skipped: { path: string; reason: "vcs-metadata" }[] = [];
  let entries = 0;
  let regularFiles = 0;
  let totalBytes = 0;
  const pending: string[] = [""];
  while (pending.length > 0) {
    const relative = pending.pop() as string;
    let names: string[];
    try {
      names = readdirSync(join(path, relative)).sort(compareCodeUnits);
    } catch {
      return refused("unreadable", `the folder ${quote(relative || ".")} cannot be read`);
    }
    const folders: string[] = [];
    for (const name of names) {
      const entry = relative === "" ? name : `${relative}/${name}`;
      if (name.includes("\\") || name.includes("\0")) {
        return refused("path-escape", `the entry ${quote(entry)} is not a safe relative path`);
      }
      entries += 1;
      if (entries > limits.sourceEntries)
        return limitRefusal("sourceEntries", "the source entry count");
      const absolute = join(path, entry);
      let stats: Stats;
      try {
        stats = lstatSync(absolute);
      } catch {
        return refused("unreadable", `the entry ${quote(entry)} cannot be read`);
      }
      if (stats.isSymbolicLink()) files.push({ path: entry, mode: "link" });
      else if (stats.isDirectory()) {
        if (relative === "" && name === ".git")
          skipped.push({ path: entry, reason: "vcs-metadata" });
        else folders.push(entry);
      } else if (!stats.isFile()) files.push({ path: entry, mode: "special-file" });
      else if (stats.nlink > 1) files.push({ path: entry, mode: "link" });
      else {
        regularFiles += 1;
        if (regularFiles > limits.sourceFiles)
          return limitRefusal("sourceFiles", "the source file count");
        if (stats.size > limits.sourceFileBytes)
          return limitRefusal("sourceFileBytes", `the file ${quote(entry)}`);
        let bytes: Buffer | "changed" | "too-large";
        try {
          bytes = readRegular(absolute, limits.sourceFileBytes);
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
          mode: (stats.mode & 0o100) !== 0 ? "100755" : "100644",
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

export interface FetchSourceOptions {
  /** The folder fetch work happens in; each fetch uses a new folder inside it and removes it. */
  readonly outDir: string;
  /** The npm registry: an https URL, or plain http on a loopback address. */
  readonly registry?: string;
  /** For npm: the sha512 integrity the tarball must have. */
  readonly integrity?: string;
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
  switch (candidate?.kind) {
    case "local": {
      const path = candidate.path;
      if (typeof path !== "string") return refused("not-found", "no local path was given");
      const expanded =
        path === "~" ? homedir() : /^~[\\/]/.test(path) ? join(homedir(), path.slice(2)) : path;
      return readLocalSource(expanded);
    }
    case "git":
      return acquireGit(candidate, options?.outDir);
    case "npm":
      return acquireNpm(candidate, options);
    default:
      return {
        status: "invalid",
        problems: [{ path: "candidate", message: "the candidate kind must be local, git or npm" }],
      };
  }
}
