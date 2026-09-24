import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { candidateMarkersV1 } from "./check-not-candidate.mjs";

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
 * The tree listing is decoded as strict UTF-8: a path that is not UTF-8, a
 * duplicate path, or paths that alias on a case-insensitive or
 * Unicode-normalizing file system (same lowercased NFC form) refuse the
 * candidate before the worktree is consulted, and every written file is
 * checked to stay inside the snapshot. The cat-file batch read is framed
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

const utf8Fatal = new TextDecoder("utf-8", { fatal: true });
const utf8Lossy = new TextDecoder("utf-8", { fatal: false });
const utf8Encode = new TextEncoder();

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
  return env;
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
    return (
      JSON.parse(readFileSync(join(path, "CANDIDATE.json"), "utf8"))?.format === CANDIDATE_FORMAT
    );
  } catch {
    return false;
  }
}

/** True only for the candidate root this build just exposed (its marker names the commit). */
function isExposedCandidate(outRoot, catalogCommit) {
  try {
    if (!isEarlierCandidateRoot(outRoot)) return false;
    return (
      JSON.parse(readFileSync(join(outRoot, "CANDIDATE.json"), "utf8"))?.catalogCommit ===
      catalogCommit
    );
  } catch {
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
 * strict UTF-8. Only regular files (100644, 100755) can be materialized;
 * symlinks, gitlinks and anything else refuse the candidate. A committed
 * top-level dist/ or dist-candidate/ would collide with the build's own output
 * directories, so it refuses too. A path that is not UTF-8, a duplicate path,
 * or two paths that alias on a case-insensitive or Unicode-normalizing file
 * system (same lowercased NFC form) also refuse: materialization and
 * verification could otherwise conflate distinct names.
 */
function listTreeEntries(context, root, commit) {
  const out = run(context, ["-C", root, "ls-tree", "-r", "-z", "--full-tree", "-l", commit], {
    encoding: null, // raw bytes; path names must survive strict UTF-8 decoding
  });
  const entries = [];
  const seen = new Map(); // lowercased NFC form → the first path with that form
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
    if (header.length !== 4 || !/^[0-9a-f]{40,64}$/u.test(oid ?? "") || !/^(?:[0-9]+|-)$/u.test(sizeText ?? ""))
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
    if ((mode !== "100644" && mode !== "100755") || type !== "blob")
      throw new Error(
        `the tree of ${commit} contains ${path} with mode ${mode} (${type}); only regular files (100644, 100755) can be materialized; the candidate is refused`,
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
    entries.push({ mode, oid, size: Number(sizeText), path });
    offset = recordEnd + 1;
  }
  return entries;
}

/**
 * Parse the output of one `git cat-file --batch` read, frame by frame: each
 * header must name the requested blob and the size the tree listing recorded,
 * the content must be exactly that long and end in its newline, and no
 * trailing bytes may remain. Anything else refuses the candidate before the
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
    const [oid, type, sizeText] = output.subarray(offset, headerEnd).toString("utf8").split(" ");
    if (oid !== entry.oid || type !== "blob" || !/^[0-9]+$/u.test(sizeText) || Number(sizeText) !== entry.size)
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

function objectFormatOf(context, root) {
  const format = run(context, ["-C", root, "rev-parse", "--show-object-format"]).trim();
  if (format !== "sha1" && format !== "sha256")
    throw new Error(`unsupported git object format ${format}; the candidate is refused`);
  return format;
}

const blobId = (format, bytes) =>
  createHash(format).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

/**
 * Raw-byte equality with the commit's tree: every snapshot file's git blob id
 * is recomputed in Node and compared with the tree's ids, so checkout
 * transformations (smudge filters, attributes, eol conversion) cannot hide a
 * change. On POSIX the executable bit of every file is verified against the
 * tree's mode as well (100755 vs 100644); on win32 there are no executable
 * bits, so modes are not verified. Any changed, missing or extra file outside
 * the build's own output directories (top-level dist/ and dist-candidate/)
 * refuses the candidate.
 */
function verifySnapshotBytes(tree, entries, format, commit) {
  const expected = new Map(entries.map((entry) => [entry.path, entry]));
  const problems = [];
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
      if (blobId(format, readFileSync(file)) !== entry.oid) problems.push(`${rel} (changed)`);
      // Git tracks only the executable bit: 100755 vs 100644.
      const executable = (lstatSync(file).mode & 0o111) !== 0;
      if (process.platform !== "win32" && executable !== (entry.mode === "100755"))
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
 * root. The new output is then renamed into place and HEAD is checked. On any
 * failure after the quarantine move, including a thrown exception, the new
 * output is removed (only if it is still the candidate this build exposed) and
 * the quarantined previous candidate is restored. The quarantine is deleted
 * only after success; if the rollback itself fails, the quarantine is kept
 * and the refusal (code candidate-rollback-failed) names its path to recover
 * from.
 */
export async function buildCandidateFromCommitV1(checkout, step) {
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
      writeFileSync(lockPath, `pid ${process.pid}\n`, { flag: "wx" });
      lockHeld = true;
    } catch {
      throw new CandidateBuildRefusalV1(
        "candidate-build-locked",
        `another candidate build is running (lock file ${lockPath}); if no build is running, remove the stale lock file yourself`,
      );
    }
    assertCheckoutRoot(context, root);
    const markers = candidateMarkersV1(root);
    if (markers.length > 0)
      throw new Error(`${root} is a candidate root (${markers.join(", ")})`);
    const catalogCommit = headOf(context, root);
    // The commit's tree is validated before the worktree is consulted: a tree
    // with unusable paths refuses even where no worktree could represent it.
    const entries = listTreeEntries(context, root, catalogCommit);
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

    const format = objectFormatOf(context, root);
    const tree = join(staging, "tree");
    materializeCommit(entries, readBlobBytes(context, root, entries), tree);

    const result = await step({ root: tree, catalogCommit });

    verifySnapshotBytes(tree, entries, format, catalogCommit);
    const built = join(tree, CANDIDATE_ROOT);
    let marker;
    try {
      marker = JSON.parse(readFileSync(join(built, "CANDIDATE.json"), "utf8"));
    } catch {
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
