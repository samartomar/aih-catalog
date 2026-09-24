import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  CandidateMarkerRefusalV1,
  candidateMarkersV1,
  readMarkerFileV1,
} from "./check-not-candidate.mjs";

/**
 * Binds a candidate Catalog root to the commit it names. The build step never
 * sees the live checkout: it gets a private snapshot of HEAD, materialized from
 * the commit's raw objects (ls-tree + cat-file, no filters, no attributes, no
 * eol conversion) into <root>/.candidate-build-* (gitignored), and writes its
 * output to <snapshot>/dist-candidate. That output is moved to
 * <root>/dist-candidate only if, after the build, the live HEAD is still the
 * recorded commit, every snapshot file still hashes to the commit's blob ids
 * (recomputed in Node, so git's normalized view cannot hide a change) and the
 * output's CANDIDATE.json names that commit. Anything else is refused and the
 * partial output is removed; an earlier candidate root is left as it was.
 *
 * The tree listing is decoded as strict UTF-8 with the BOM kept and a byte
 * round trip required: a path that is not UTF-8, a duplicate path, a path
 * segment that is not portable (D31: printable ASCII only, no Windows
 * punctuation, no trailing dot or space, no device name, no 8.3 shape), or
 * paths that alias on a case-insensitive or Unicode-normalizing file system —
 * as full paths or at any single component — refuse the candidate before the
 * worktree is consulted, and every written file is checked to stay inside the
 * snapshot. The batch read and the post-build
 * verification are bounded — per-file and aggregate limits with typed
 * refusals, files hashed by streaming fixed-size chunks — and the cat-file
 * batch read is framed
 * strictly: each header must name the requested blob and the listed size, the
 * content must end in its newline and no trailing bytes may remain.
 *
 * Every git invocation runs with --no-replace-objects and an environment with
 * every GIT_* variable removed, so an inherited GIT_DIR, GIT_WORK_TREE,
 * GIT_CONFIG* or a refs/replace substitute can never redirect a read, and -C
 * alone selects the repository. Repository configuration can never run code:
 * the system configuration is disabled, the global configuration is an empty
 * file in the staging area, and every invocation disables the fsmonitor and
 * the untracked cache and points core.hooksPath at an empty staging
 * directory; only plumbing reads (rev-parse, ls-tree, cat-file, ls-files,
 * diff-index) are used. Before anything else, the checkout must be the top
 * level git reports for it.
 */
export const CANDIDATE_ROOT = "dist-candidate";
const CANDIDATE_FORMAT = "aih-catalog-candidate";

/** A refusal with a stable code, so callers and tests can branch on the kind. */
export class CandidateBuildRefusalV1 extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CandidateBuildRefusalV1";
    this.code = code;
  }
}

const utf8Fatal = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const utf8Lossy = new TextDecoder("utf-8", { fatal: false });
const utf8Encode = new TextEncoder();

/**
 * The D20/D31 portable-segment rule, checked per path segment before anything
 * is materialized or built: printable ASCII (0x20-0x7e) only; none of
 * \ : < > " | ? *; no trailing dot or space; no Win32 device name (CON, PRN,
 * AUX, NUL, COM0-9, LPT0-9, in any case, with any extension); no 8.3
 * short-name shape (~ followed by a digit). A leading BOM survives the strict
 * decode (ignoreBOM) and is refused here, because U+FEFF is not ASCII.
 */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/iu;
function assertPortableSegmentsV1(commit, path) {
  for (const segment of path.split("/")) {
    if (
      segment === "" ||
      !/^[ -~]+$/u.test(segment) ||
      /[\\:<>"|?*]/u.test(segment) ||
      /[. ]$/u.test(segment) ||
      DEVICE_NAME.test(segment) ||
      /~[0-9]/u.test(segment)
    )
      throw new CandidateBuildRefusalV1(
        "candidate-path-not-portable",
        `the tree of ${commit} contains the non-portable path segment ${JSON.stringify(segment)} in ${JSON.stringify(path)} (printable ASCII only, no \\ : < > " | ? *, no trailing dot or space, no Win32 device name, no 8.3 short-name shape); the candidate is refused`,
      );
  }
}

/**
 * Size bounds for the batch read and the post-build verification. This
 * repository's largest tracked file is ~12 MiB and its tracked bytes total
 * ~90 MiB, so 64 MiB per file and 512 MiB in aggregate are comfortably above
 * it; both refusals name the file and the limit. Files are hashed by
 * streaming fixed-size chunks, never read whole without a bound.
 */
export const CANDIDATE_SNAPSHOT_LIMITS_V1 = Object.freeze({
  perFileBytes: 64 * 1024 * 1024,
  aggregateBytes: 512 * 1024 * 1024,
});
const HASH_CHUNK = 8 * 1024 * 1024;

/** Every GIT_* name, whatever its case (Windows environment names are case-insensitive). */
const GIT_VARIABLE = /^GIT_/iu;

/**
 * The environment for every git invocation. Every inherited GIT_* variable is
 * dropped: git selects the repository, index, object store, alternates,
 * namespace, replace-ref base and extra configuration from them before -C
 * applies, and a denylist would rot as git adds more. Replacement objects are
 * also disabled here, and a prompt can never block. The system configuration
 * is disabled and the global configuration is the build's own empty file, so
 * no machine or user configuration can add behavior.
 */
function gitEnv(emptyConfig) {
  const env = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && !GIT_VARIABLE.test(key)) env[key] = value;
  env.GIT_NO_REPLACE_OBJECTS = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = emptyConfig;
  // Never lazy-fetch from a promisor remote: a missing object must refuse,
  // never reach repository-controlled core.sshCommand or credential helpers.
  // (None of the git commands used here accepts a --no-lazy-fetch option; the
  // environment variable is the switch, and the build requires a git that
  // honors it — see gitDisablesLazyFetchV1.)
  env.GIT_NO_LAZY_FETCH = "1";
  return env;
}

/**
 * GIT_NO_LAZY_FETCH exists since git 2.47; older gits would silently ignore
 * it and could still be driven into a repository-configured fetch, so the
 * build requires a git new enough to honor it.
 */
export function gitDisablesLazyFetchV1(versionOutput) {
  const match = /git version ([0-9]+)\.([0-9]+)\.[0-9]+/u.exec(versionOutput);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 2 || (major === 2 && minor >= 47);
}

/** Refuse a git too old to disable lazy fetching, before any object read. */
function assertGitDisablesLazyFetch(context) {
  const version = run(context, ["version"]).trim();
  if (!gitDisablesLazyFetchV1(version))
    throw new CandidateBuildRefusalV1(
      "candidate-git-too-old",
      `the candidate build requires git 2.47 or newer so lazy fetching can be disabled (GIT_NO_LAZY_FETCH); ${version} is reported; the candidate is refused`,
    );
}

/**
 * Every git invocation also neutralizes the repository's own configuration
 * where it could run code or carry state: the fsmonitor and the untracked
 * cache are disabled and hooks resolve to an empty directory created in the
 * staging area. Command-line -c wins over every file, including includeIf
 * includes.
 */
const run = (context, args, options = {}) => {
  const result = spawnSync(
    "git",
    [
      "--no-replace-objects",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "-c",
      `core.hooksPath=${context.hooksDir}`,
      ...args,
    ],
    {
      encoding: "utf8",
      env: gitEnv(context.emptyConfig),
      // A full-tree ls-tree of a real repository is larger than the 1 MiB default.
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    },
  );
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr ?? "").toString().trim()}`);
  return result.stdout;
};

const samePath = (a, b) => {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
};

/** The checkout must be the top level of its repository, discovered through -C alone. */
function assertCheckoutRoot(context, root) {
  const top = run(context, ["-C", root, "rev-parse", "--show-toplevel"]).trim();
  if (!samePath(top, root))
    throw new Error(
      `${root} is not the top level of its checkout (git rev-parse --show-toplevel reports ${top}); the candidate is refused`,
    );
}

function headOf(context, root) {
  const head = run(context, ["-C", root, "rev-parse", "--verify", "HEAD^{commit}"]).trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(head))
    throw new Error(`HEAD ${head} is not a commit id`);
  return head;
}

/** True only for a real directory (never a link or junction) carrying the candidate marker. */
function isEarlierCandidateRoot(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
  try {
    return JSON.parse(readMarkerFileV1(join(path, "CANDIDATE.json")))?.format === CANDIDATE_FORMAT;
  } catch (error) {
    // A marker that exists but is not a bounded regular file refuses the
    // build; a missing or unparsable one means this is no candidate root.
    if (error instanceof CandidateMarkerRefusalV1) throw error;
    return false;
  }
}

/** True only for the candidate root this build just exposed (its marker names the commit). */
function isExposedCandidate(outRoot, catalogCommit) {
  try {
    if (!isEarlierCandidateRoot(outRoot)) return false;
    return (
      JSON.parse(readMarkerFileV1(join(outRoot, "CANDIDATE.json")))?.catalogCommit ===
      catalogCommit
    );
  } catch {
    // Best-effort ownership check during rollback: any unreadable marker
    // (including a typed marker refusal) means the output is not touched.
    return false;
  }
}

/** An existing output root may be replaced only if it is an earlier candidate root. */
function assertReplaceable(outRoot) {
  if (existsSync(outRoot) && !isEarlierCandidateRoot(outRoot))
    throw new Error(
      `${outRoot} exists but is not an earlier candidate root (no CANDIDATE.json); remove it yourself`,
    );
}

/**
 * The commit's tree as raw entries, decoded from the NUL-separated listing as
 * strict UTF-8 (BOM kept, byte round trip required). Only regular files
 * (100644, 100755) can be materialized; symlinks, gitlinks and anything else
 * refuse the candidate. A committed top-level dist/ or dist-candidate/ would
 * collide with the build's own output directories, so it refuses too. A path
 * that is not UTF-8, a duplicate path, a non-portable path segment (D31:
 * printable ASCII, no Windows punctuation, no trailing dot or space, no
 * device name, no 8.3 short-name shape), or two paths that alias on a
 * case-insensitive or Unicode-normalizing file system — as whole paths or at
 * any single component — also refuse: materialization and verification could
 * otherwise conflate distinct names.
 */
function listTreeEntries(context, root, commit, limits) {
  const out = run(context, ["-C", root, "ls-tree", "-r", "-z", "--full-tree", "-l", commit], {
    encoding: null, // raw bytes; path names must survive strict UTF-8 decoding
  });
  const entries = [];
  const seen = new Map(); // lowercased NFC form → the first path with that form
  const componentSeen = new Map(); // alias form of a path prefix → its first original form
  let total = 0;
  let offset = 0;
  while (offset < out.length) {
    const recordEnd = out.indexOf(0x00, offset);
    if (recordEnd < 0)
      throw new CandidateBuildRefusalV1(
        "candidate-listing-framing",
        `git ls-tree returned a record without its NUL terminator; the candidate is refused`,
      );
    const record = out.subarray(offset, recordEnd);
    const tab = record.indexOf(0x09);
    const header = tab < 0 ? [] : record.subarray(0, tab).toString("utf8").split(/\s+/u);
    const [mode, type, oid, sizeText] = header;
    if (header.length !== 4 || !/^[0-9a-f]{40,64}$/u.test(oid ?? ""))
      throw new CandidateBuildRefusalV1(
        "candidate-listing-framing",
        `git ls-tree returned a malformed record at byte offset ${offset}; the candidate is refused`,
      );
    const pathBytes = record.subarray(tab + 1);
    let path;
    try {
      path = utf8Fatal.decode(pathBytes);
    } catch {
      const lossy = utf8Lossy.decode(pathBytes);
      const within = utf8Encode.encode(lossy.slice(0, lossy.indexOf("\uFFFD"))).length;
      throw new CandidateBuildRefusalV1(
        "candidate-path-not-utf8",
        `the tree of ${commit} contains a path that is not UTF-8 (byte offset ${offset + tab + 1 + within} in the tree listing); the candidate is refused`,
      );
    }
    // Byte round trip: the decoded path re-encoded must equal the raw bytes,
    // so a leading BOM is kept (ignoreBOM) and then refused by the
    // portable-segment rule below instead of silently renaming the file.
    if (!Buffer.from(utf8Encode.encode(path)).equals(Buffer.from(pathBytes)))
      throw new CandidateBuildRefusalV1(
        "candidate-path-not-utf8",
        `the tree of ${commit} contains a path whose UTF-8 does not round trip (byte offset ${offset + tab + 1} in the tree listing); the candidate is refused`,
      );
    assertPortableSegmentsV1(commit, path);
    if ((mode !== "100644" && mode !== "100755") || type !== "blob")
      throw new Error(
        `the tree of ${commit} contains ${path} with mode ${mode} (${type}); only regular files (100644, 100755) can be materialized; the candidate is refused`,
      );
    // A blob whose size git cannot report (ls-tree prints "-" or "BAD") is not
    // in the local object store. Lazy fetching is disabled, so this refuses
    // instead of ever contacting a promisor remote.
    if (!/^[0-9]+$/u.test(sizeText))
      throw new CandidateBuildRefusalV1(
        "candidate-object-missing",
        `the object ${oid} (${path}) is not in the local object store (git ls-tree reports size ${sizeText}); the candidate is refused`,
      );
    if (path === "" || path.startsWith("/") || path.split("/").includes(".."))
      throw new Error(
        `the tree of ${commit} contains an unusable path ${JSON.stringify(path)}; the candidate is refused`,
      );
    const top = path.split("/")[0];
    if (top === "dist" || top === CANDIDATE_ROOT)
      throw new Error(
        `the tree of ${commit} contains ${top}/, which the build uses for its own output; the candidate is refused`,
      );
    // Uniqueness is required case-insensitively at every path component, not
    // only as full paths: "Dir/a" and "dir/b" collide at the first component.
    let aliasPrefix = "";
    let originalPrefix = "";
    for (const segment of path.split("/")) {
      const segmentAlias = segment.normalize("NFC").toLowerCase();
      aliasPrefix = aliasPrefix === "" ? segmentAlias : `${aliasPrefix}/${segmentAlias}`;
      originalPrefix = originalPrefix === "" ? segment : `${originalPrefix}/${segment}`;
      const earlierPrefix = componentSeen.get(aliasPrefix);
      if (earlierPrefix !== undefined && earlierPrefix !== originalPrefix)
        throw new CandidateBuildRefusalV1(
          "candidate-path-component-alias",
          `the tree of ${commit} contains path components that alias on a case-insensitive or Unicode-normalizing file system: ${earlierPrefix} and ${originalPrefix} (in ${path}); the candidate is refused`,
        );
      componentSeen.set(aliasPrefix, originalPrefix);
    }
    const alias = path.normalize("NFC").toLowerCase();
    const earlier = seen.get(alias);
    if (earlier !== undefined) {
      if (earlier === path)
        throw new CandidateBuildRefusalV1(
          "candidate-path-duplicate",
          `the tree of ${commit} contains duplicate path ${path}; the candidate is refused`,
        );
      throw new CandidateBuildRefusalV1(
        "candidate-path-alias",
        `the tree of ${commit} contains paths that alias on a case-insensitive or Unicode-normalizing file system: ${earlier} and ${path}; the candidate is refused`,
      );
    }
    seen.set(alias, path);
    const size = Number(sizeText);
    if (size > limits.perFileBytes)
      throw new CandidateBuildRefusalV1(
        "candidate-file-too-large",
        `the tree of ${commit} contains ${path} of ${size} bytes, over the per-file limit of ${limits.perFileBytes} bytes; the candidate is refused`,
      );
    total += size;
    if (total > limits.aggregateBytes)
      throw new CandidateBuildRefusalV1(
        "candidate-tree-too-large",
        `the tree of ${commit} totals over the aggregate limit of ${limits.aggregateBytes} bytes (at ${path}); the candidate is refused`,
      );
    entries.push({ mode, oid, size, path });
    offset = recordEnd + 1;
  }
  return entries;
}

/**
 * Parse the output of one `git cat-file --batch` read, frame by frame: each
 * header is exactly three space-separated fields (`<oid> <type> <size>`) and
 * must name the requested blob and the size the tree listing recorded, the
 * content must be exactly that long and end in its newline, and no trailing
 * bytes may remain. A `<oid> missing` frame refuses the candidate typed
 * (candidate-object-missing). Anything else refuses the candidate before the
 * build step runs.
 */
export function parseCatFileBatchV1(entries, output) {
  const bytes = new Map();
  let offset = 0;
  for (const entry of entries) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0)
      throw new CandidateBuildRefusalV1(
        "candidate-batch-framing",
        `git cat-file --batch returned a truncated header for ${entry.oid}; the candidate is refused`,
      );
    const fields = output.subarray(offset, headerEnd).toString("utf8").split(" ");
    const [oid, type, sizeText] = fields;
    if (fields.length === 2 && oid === entry.oid && type === "missing")
      throw new CandidateBuildRefusalV1(
        "candidate-object-missing",
        `git cat-file --batch reports the object ${entry.oid} (${entry.path}) missing from the local object store; the candidate is refused`,
      );
    if (
      fields.length !== 3 ||
      oid !== entry.oid ||
      type !== "blob" ||
      !/^[0-9]+$/u.test(sizeText) ||
      Number(sizeText) !== entry.size
    )
      throw new CandidateBuildRefusalV1(
        "candidate-batch-framing",
        `git cat-file --batch returned a header ${oid} ${type} size ${sizeText} where blob ${entry.oid} of ${entry.size} bytes was expected; the candidate is refused`,
      );
    const start = headerEnd + 1;
    const end = start + entry.size;
    if (end >= output.length || output[end] !== 0x0a)
      throw new CandidateBuildRefusalV1(
        "candidate-batch-framing",
        `git cat-file --batch returned ${entry.path} without its terminating newline; the candidate is refused`,
      );
    bytes.set(entry.path, output.subarray(start, end));
    offset = end + 1;
  }
  if (offset !== output.length)
    throw new CandidateBuildRefusalV1(
      "candidate-batch-framing",
      `git cat-file --batch returned ${output.length - offset} trailing bytes; the candidate is refused`,
    );
  return bytes;
}

/** The raw bytes of every blob, in one batch read: no filters, attributes or eol conversion. */
function readBlobBytes(context, root, entries) {
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  const out = run(context, ["-C", root, "cat-file", "--batch"], {
    encoding: null, // raw bytes; run() defaults to utf8 text
    input: `${entries.map((entry) => entry.oid).join("\n")}\n`,
    maxBuffer: total + entries.length * 128 + 1024 * 1024,
  });
  return parseCatFileBatchV1(entries, out);
}

/**
 * Write the commit's raw blobs to <tree>, every file contained inside it. On
 * POSIX a 100755 file gets its executable bits; on win32 there are none, and
 * verification reports modes as not verified.
 */
function materializeCommit(entries, bytes, tree) {
  const treeRoot = resolve(tree);
  mkdirSync(treeRoot);
  for (const entry of entries) {
    const file = resolve(treeRoot, ...entry.path.split("/"));
    if (!file.startsWith(`${treeRoot}${sep}`))
      throw new CandidateBuildRefusalV1(
        "candidate-path-containment",
        `the tree path ${entry.path} would be written outside the snapshot; the candidate is refused`,
      );
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes.get(entry.path), { mode: entry.mode === "100755" ? 0o755 : 0o644 });
    if (process.platform !== "win32" && entry.mode === "100755") chmodSync(file, 0o755);
  }
}

/**
 * The candidate build supports sha1 repositories only: a sha256 repository is
 * refused explicitly, before anything is built, rather than failing later in
 * the candidate writer.
 */
function objectFormatOf(context, root) {
  const format = run(context, ["-C", root, "rev-parse", "--show-object-format"]).trim();
  if (format === "sha256")
    throw new CandidateBuildRefusalV1(
      "candidate-object-format",
      `the checkout uses the sha256 object format; the candidate build supports sha1 repositories only, so the candidate is refused before building`,
    );
  if (format !== "sha1")
    throw new Error(`unsupported git object format ${format}; the candidate is refused`);
  return format;
}

/** The git blob id of a file, hashed by streaming fixed-size chunks. */
function blobIdOfFile(format, file, size) {
  const hash = createHash(format).update(`blob ${size}\0`);
  const fd = openSync(file, "r");
  try {
    const chunk = Buffer.allocUnsafe(Math.max(1, Math.min(HASH_CHUNK, size)));
    let count = readSync(fd, chunk, 0, chunk.length, null);
    while (count > 0) {
      hash.update(chunk.subarray(0, count));
      count = readSync(fd, chunk, 0, chunk.length, null);
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * The executable bits a materialized file must carry for its git mode.
 * Materialization sets 0o755 for 100755 (umask cannot add execute bits to a
 * 100644 write), so the full mask must match: clearing the owner bit (0645)
 * or adding only group/other bits (0654) both refuse.
 */
export function modeMatchesGitEntryV1(statMode, gitMode) {
  return (statMode & 0o111) === (gitMode === "100755" ? 0o111 : 0);
}

/**
 * Raw-byte equality with the commit's tree: every snapshot file's git blob id
 * is recomputed in Node and compared with the tree's ids, so checkout
 * transformations (smudge filters, attributes, eol conversion) cannot hide a
 * change. On POSIX the executable mask of every file is verified against the
 * tree's mode as well (100755 vs 100644, owner bit included); on win32 there
 * are no executable bits, so modes are not verified. Any changed, missing or
 * extra file outside the build's own output directories (top-level dist/ and
 * dist-candidate/) refuses the candidate.
 */
function verifySnapshotBytes(tree, entries, format, commit, limits) {
  const expected = new Map(entries.map((entry) => [entry.path, entry]));
  const problems = [];
  let verified = 0;
  const walk = (dir, prefix) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? item.name : `${prefix}/${item.name}`;
      if (prefix === "" && (item.name === "dist" || item.name === CANDIDATE_ROOT)) continue;
      if (item.isDirectory()) {
        walk(join(dir, item.name), rel);
        continue;
      }
      if (!item.isFile()) {
        problems.push(`${rel} (not a regular file)`);
        continue;
      }
      const entry = expected.get(rel);
      if (entry === undefined) {
        problems.push(`${rel} (extra)`);
        continue;
      }
      expected.delete(rel);
      const file = join(dir, item.name);
      // Bounds first: an arbitrarily enlarged tracked file is refused before
      // its bytes are read.
      const stat = lstatSync(file);
      if (stat.size > limits.perFileBytes)
        throw new CandidateBuildRefusalV1(
          "candidate-file-too-large",
          `${rel} is ${stat.size} bytes after the build, over the per-file limit of ${limits.perFileBytes} bytes; the candidate is refused`,
        );
      verified += stat.size;
      if (verified > limits.aggregateBytes)
        throw new CandidateBuildRefusalV1(
          "candidate-tree-too-large",
          `the snapshot totals over the aggregate limit of ${limits.aggregateBytes} bytes after the build (at ${rel}); the candidate is refused`,
        );
      if (blobIdOfFile(format, file, stat.size) !== entry.oid) problems.push(`${rel} (changed)`);
      // Git tracks only the executable bit: 100755 vs 100644. Compare the
      // exact executable mask (owner bit included), not "any execute bit".
      if (process.platform !== "win32" && !modeMatchesGitEntryV1(stat.mode, entry.mode))
        problems.push(`${rel} (mode changed)`);
    }
  };
  walk(tree, "");
  for (const rel of expected.keys()) problems.push(`${rel} (missing)`);
  if (problems.length > 0)
    throw new Error(
      `the build snapshot ${tree} no longer equals ${commit}; the candidate is refused:\n${problems.join("\n")}`,
    );
}

/**
 * Run `step({ root: snapshot, catalogCommit })` over a snapshot of the
 * checkout's HEAD and expose its `<snapshot>/dist-candidate` as
 * `<root>/dist-candidate`. Returns `{ catalogCommit, outRoot, result,
 * modesVerified }`; `modesVerified` is false on win32, where there are no
 * executable bits to verify.
 *
 * Exposure is rollback-safe. One build runs at a time per checkout: an
 * exclusive lock file (.candidate-build.lock, gitignored) is held for the
 * whole build and exposure and removed on success and on every failure; a
 * second build refuses and names the file. A process running as the same
 * user that races the checkout mid-build is outside the threat model
 * (coordinator D27, the same bound as D21/D22/D23); everything a
 * repository's own files or configuration can cause stays fail-closed.
 * An existing candidate root is first renamed into a
 * private quarantine inside the staging directory; the moved object is
 * validated there (a real directory, never a link or junction, carrying the
 * candidate marker) and moved back untouched if it is not an earlier candidate
 * root. The new output must be a real directory too: its marker is read only
 * after an lstat proves it is no link or junction, and after the rename its
 * identity (dev/ino) must still be the checked directory's — anything else is
 * refused and rolled back. The new output is then renamed into place and HEAD
 * is checked. On any
 * failure after the quarantine move, including a thrown exception, the new
 * output is removed (only if it is still the candidate this build exposed) and
 * the quarantined previous candidate is restored. The quarantine is deleted
 * only after success; if the rollback itself fails, the quarantine is kept
 * and the refusal (code candidate-rollback-failed) names its path to recover
 * from.
 */
export async function buildCandidateFromCommitV1(checkout, step, limits = CANDIDATE_SNAPSHOT_LIMITS_V1) {
  const root = resolve(checkout);
  // Inside the checkout (gitignored) so the snapshot resolves its node_modules
  // by walking up, and so the finished output moves by a same-volume rename.
  // Created before anything else: every git invocation points core.hooksPath
  // at an empty directory and GIT_CONFIG_GLOBAL at an empty file inside it.
  const staging = mkdtempSync(join(root, ".candidate-build-"));
  // Set when a rollback failure keeps the quarantine: staging then stays, so
  // the only copy of the earlier candidate is never deleted.
  let keepStaging = false;
  // One build at a time per checkout, for the whole build and exposure: the
  // lock is created exclusively and removed on success and on every failure.
  // A directory swap by another process running as the same user is outside
  // the threat model (coordinator D27).
  const lockPath = join(root, ".candidate-build.lock");
  let lockHeld = false;
  try {
    const context = { hooksDir: join(staging, "hooks"), emptyConfig: join(staging, "gitconfig") };
    mkdirSync(context.hooksDir);
    writeFileSync(context.emptyConfig, "");
    try {
      // Acquire exclusively, record ownership immediately, then write and
      // close: a write failure after creation (ENOSPC, ...) is reported as
      // itself and the outer finally removes OUR lock — it is never mistaken
      // for another build and never left behind.
      const lockFd = openSync(lockPath, "wx");
      lockHeld = true;
      try {
        writeFileSync(lockFd, `pid ${process.pid}\n`);
      } finally {
        closeSync(lockFd);
      }
    } catch (error) {
      if (lockHeld) throw error;
      throw new CandidateBuildRefusalV1(
        "candidate-build-locked",
        `another candidate build is running (lock file ${lockPath}); if no build is running, remove the stale lock file yourself`,
      );
    }
    assertCheckoutRoot(context, root);
    // Before any object read: this git must be able to disable lazy fetching,
    // so a missing object can never drive a repository-configured fetch.
    assertGitDisablesLazyFetch(context);
    const markers = candidateMarkersV1(root);
    if (markers.length > 0)
      throw new Error(`${root} is a candidate root (${markers.join(", ")})`);
    const catalogCommit = headOf(context, root);
    // A sha256 repository refuses before anything is built.
    const format = objectFormatOf(context, root);
    // The commit's tree is validated before the worktree is consulted: a tree
    // with unusable paths refuses even where no worktree could represent it.
    const entries = listTreeEntries(context, root, catalogCommit, limits);
    // Plumbing only: a porcelain status would read fsmonitor state. A file
    // differing from HEAD (staged or not) or an untracked file is dirty.
    const changed = run(context, ["-C", root, "diff-index", "--name-only", "-z", "HEAD", "--"]);
    const untracked = run(context, ["-C", root, "ls-files", "--others", "--exclude-standard", "-z"]);
    const dirty = `${untracked}${changed}`
      .split("\0")
      .filter((name) => name !== "");
    if (dirty.length > 0)
      throw new Error(
        `the checkout has uncommitted changes; a candidate is built only at a recorded commit:\n${dirty.join("\n")}`,
      );
    const outRoot = join(root, CANDIDATE_ROOT);
    assertReplaceable(outRoot);

    const tree = join(staging, "tree");
    materializeCommit(entries, readBlobBytes(context, root, entries), tree);

    const result = await step({ root: tree, catalogCommit });

    verifySnapshotBytes(tree, entries, format, catalogCommit, limits);
    // The marker is read only from a real directory: a link or junction as
    // the build output is refused, and the moved output must be the same
    // directory (dev/ino) that was checked.
    const built = join(tree, CANDIDATE_ROOT);
    let builtStat;
    try {
      builtStat = lstatSync(built);
    } catch {
      throw new Error(`the build wrote no readable ${CANDIDATE_ROOT}/CANDIDATE.json`);
    }
    if (builtStat.isSymbolicLink() || !builtStat.isDirectory())
      throw new CandidateBuildRefusalV1(
        "candidate-output-not-directory",
        `the build's ${CANDIDATE_ROOT} is not a real directory (a link or junction is refused); the candidate is refused`,
      );
    const identity = { dev: builtStat.dev, ino: builtStat.ino };
    let marker;
    try {
      marker = JSON.parse(readMarkerFileV1(join(built, "CANDIDATE.json")));
    } catch (error) {
      if (error instanceof CandidateMarkerRefusalV1) throw error;
      throw new Error(`the build wrote no readable ${CANDIDATE_ROOT}/CANDIDATE.json`);
    }
    if (marker?.format !== CANDIDATE_FORMAT || marker.catalogCommit !== catalogCommit)
      throw new Error(
        `the built CANDIDATE.json catalogCommit ${String(marker?.catalogCommit)} is not the snapshot commit ${catalogCommit}`,
      );

    let quarantined;
    let exposed = false;
    try {
      if (existsSync(outRoot)) {
        const target = join(mkdtempSync(join(staging, "quarantine-")), "previous");
        renameSync(outRoot, target);
        quarantined = target;
        if (!isEarlierCandidateRoot(quarantined))
          throw new Error(
            `${outRoot} is not an earlier candidate root (no CANDIDATE.json); it was left untouched`,
          );
      }
      renameSync(built, outRoot);
      exposed = true;
      const moved = lstatSync(outRoot);
      if (
        moved.isSymbolicLink() ||
        !moved.isDirectory() ||
        moved.dev !== identity.dev ||
        moved.ino !== identity.ino
      )
        throw new CandidateBuildRefusalV1(
          "candidate-output-not-directory",
          `the exposed ${CANDIDATE_ROOT} is not the real directory this build checked; the candidate is refused`,
        );
      const after = headOf(context, root);
      if (after !== catalogCommit)
        throw new Error(
          `the checkout's HEAD moved from ${catalogCommit} to ${after} during the build; the candidate is refused`,
        );
    } catch (error) {
      try {
        if (exposed && isExposedCandidate(outRoot, catalogCommit))
          rmSync(outRoot, { recursive: true, force: true });
        if (quarantined !== undefined) renameSync(quarantined, outRoot);
      } catch (restore) {
        const message = error instanceof Error ? error.message : String(error);
        const restoreMessage = restore instanceof Error ? restore.message : String(restore);
        if (quarantined !== undefined) {
          keepStaging = true;
          throw new CandidateBuildRefusalV1(
            "candidate-rollback-failed",
            `${message}; the rollback also failed: ${restoreMessage}; the quarantined previous candidate was kept at ${quarantined}; move it back to ${outRoot} yourself`,
          );
        }
        throw new Error(`${message}; rolling back the earlier candidate also failed: ${restoreMessage}`);
      }
      throw error;
    }
    if (quarantined !== undefined) rmSync(quarantined, { recursive: true, force: true });
    return { catalogCommit, outRoot, result, modesVerified: process.platform !== "win32" };
  } finally {
    if (lockHeld) rmSync(lockPath, { force: true });
    if (!keepStaging) rmSync(staging, { recursive: true, force: true });
  }
}
