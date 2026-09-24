import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
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
import { dirname, join, resolve } from "node:path";
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
 * Every git invocation runs with --no-replace-objects and an environment with
 * every GIT_* variable removed, so an inherited GIT_DIR, GIT_WORK_TREE,
 * GIT_CONFIG* or a refs/replace substitute can never redirect a read, and -C
 * alone selects the repository. Before anything else, the checkout must be the
 * top level git reports for it.
 */
export const CANDIDATE_ROOT = "dist-candidate";
const CANDIDATE_FORMAT = "aih-catalog-candidate";

/** Every GIT_* name, whatever its case (Windows environment names are case-insensitive). */
const GIT_VARIABLE = /^GIT_/iu;

/**
 * The environment for every git invocation. Every inherited GIT_* variable is
 * dropped: git selects the repository, index, object store, alternates,
 * namespace, replace-ref base and extra configuration from them before -C
 * applies, and a denylist would rot as git adds more. Replacement objects are
 * also disabled here, and a prompt can never block.
 */
function gitEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && !GIT_VARIABLE.test(key)) env[key] = value;
  env.GIT_NO_REPLACE_OBJECTS = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

const run = (args, options = {}) => {
  const result = spawnSync("git", ["--no-replace-objects", ...args], {
    encoding: "utf8",
    env: gitEnv(),
    ...options,
  });
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
function assertCheckoutRoot(root) {
  const top = run(["-C", root, "rev-parse", "--show-toplevel"]).trim();
  if (!samePath(top, root))
    throw new Error(
      `${root} is not the top level of its checkout (git rev-parse --show-toplevel reports ${top}); the candidate is refused`,
    );
}

function headOf(root) {
  const head = run(["-C", root, "rev-parse", "--verify", "HEAD^{commit}"]).trim();
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
 * The commit's tree as raw entries. Only regular files (100644, 100755) can be
 * materialized; symlinks, gitlinks and anything else refuse the candidate. A
 * committed top-level dist/ or dist-candidate/ would collide with the build's
 * own output directories, so it refuses too.
 */
function listTreeEntries(root, commit) {
  const out = run(["-C", root, "ls-tree", "-r", "-z", "--full-tree", "-l", commit]);
  const entries = [];
  for (const record of out.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    const [mode, type, oid, sizeText] = record.slice(0, tab).split(/\s+/u);
    const path = record.slice(tab + 1);
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
    entries.push({ mode, oid, size: Number(sizeText), path });
  }
  return entries;
}

/** The raw bytes of every blob, in one batch read: no filters, attributes or eol conversion. */
function readBlobBytes(root, entries) {
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  const out = run(["-C", root, "cat-file", "--batch"], {
    encoding: null, // raw bytes; run() defaults to utf8 text
    input: `${entries.map((entry) => entry.oid).join("\n")}\n`,
    maxBuffer: total + entries.length * 128 + 1024 * 1024,
  });
  const bytes = new Map();
  let offset = 0;
  for (const entry of entries) {
    const headerEnd = out.indexOf(0x0a, offset);
    const [oid, type, sizeText] = out.subarray(offset, headerEnd).toString("utf8").split(" ");
    if (headerEnd < 0 || oid !== entry.oid || type !== "blob")
      throw new Error(`git cat-file could not read blob ${entry.oid}; the candidate is refused`);
    const size = Number(sizeText);
    const start = headerEnd + 1;
    bytes.set(entry.path, out.subarray(start, start + size));
    offset = start + size + 1; // the newline after each object
  }
  return bytes;
}

/** Write the commit's raw blobs to <tree>; returns the entries for later verification. */
function materializeCommit(root, commit, tree) {
  const entries = listTreeEntries(root, commit);
  const bytes = readBlobBytes(root, entries);
  mkdirSync(tree);
  for (const entry of entries) {
    const file = join(tree, ...entry.path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes.get(entry.path), { mode: entry.mode === "100755" ? 0o755 : 0o644 });
  }
  return entries;
}

function objectFormatOf(root) {
  const format = run(["-C", root, "rev-parse", "--show-object-format"]).trim();
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
 * change. Any changed, missing or extra file outside the build's own output
 * directories (top-level dist/ and dist-candidate/) refuses the candidate.
 */
function verifySnapshotBytes(tree, entries, format, commit) {
  const expected = new Map(entries.map((entry) => [entry.path, entry.oid]));
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
      const oid = expected.get(rel);
      if (oid === undefined) {
        problems.push(`${rel} (extra)`);
        continue;
      }
      expected.delete(rel);
      if (blobId(format, readFileSync(join(dir, item.name))) !== oid)
        problems.push(`${rel} (changed)`);
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
 * `<root>/dist-candidate`. Returns `{ catalogCommit, outRoot, result }`.
 *
 * Exposure is rollback-safe. An existing candidate root is first renamed into a
 * private quarantine inside the staging directory; the moved object is
 * validated there (a real directory, never a link or junction, carrying the
 * candidate marker) and moved back untouched if it is not an earlier candidate
 * root. The new output is then renamed into place and HEAD is checked. On any
 * failure after the quarantine move, including a thrown exception, the new
 * output is removed (only if it is still the candidate this build exposed) and
 * the quarantined previous candidate is restored. The quarantine is deleted
 * only after success.
 */
export async function buildCandidateFromCommitV1(checkout, step) {
  const root = resolve(checkout);
  assertCheckoutRoot(root);
  const markers = candidateMarkersV1(root);
  if (markers.length > 0) throw new Error(`${root} is a candidate root (${markers.join(", ")})`);
  const catalogCommit = headOf(root);
  const dirty = run(["-C", root, "status", "--porcelain", "--untracked-files=all"]).trim();
  if (dirty !== "")
    throw new Error(
      `the checkout has uncommitted changes; a candidate is built only at a recorded commit:\n${dirty}`,
    );
  const outRoot = join(root, CANDIDATE_ROOT);
  assertReplaceable(outRoot);

  const format = objectFormatOf(root);
  // Inside the checkout (gitignored) so the snapshot resolves its node_modules
  // by walking up, and so the finished output moves by a same-volume rename.
  const staging = mkdtempSync(join(root, ".candidate-build-"));
  const tree = join(staging, "tree");
  try {
    const entries = materializeCommit(root, catalogCommit, tree);

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
      const after = headOf(root);
      if (after !== catalogCommit)
        throw new Error(
          `the checkout's HEAD moved from ${catalogCommit} to ${after} during the build; the candidate is refused`,
        );
    } catch (error) {
      let rollbackError;
      try {
        if (exposed && isExposedCandidate(outRoot, catalogCommit))
          rmSync(outRoot, { recursive: true, force: true });
        if (quarantined !== undefined) renameSync(quarantined, outRoot);
      } catch (restore) {
        rollbackError = restore;
      }
      if (rollbackError !== undefined)
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; rolling back the earlier candidate also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      throw error;
    }
    if (quarantined !== undefined) rmSync(quarantined, { recursive: true, force: true });
    return { catalogCommit, outRoot, result };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
