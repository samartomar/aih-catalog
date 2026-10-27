// Read-only adapter for the exact CBM 0.12.1 native store. CLI freshness only
// compares mtime/size; these native SHA256 records also detect preserved-mtime edits.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);
const fileLimit = 10_000;
const byteLimit = 256 * 1024 * 1024;

function contained(root, path) {
  const delta = relative(root, path);
  return delta !== "" && delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta);
}

// Point-in-time inspection: cap descriptor reads, reject symlink substitution,
// and detect mutation/replacement while reading. This is not an OS sandbox.
function boundedDigest(path, limit, prefix = null) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || realpathSync(`/proc/self/fd/${descriptor}`) !== path || before.size > BigInt(limit))
      throw new Error("CBM input is not a regular confined file or exceeds bounded inspection");
    const hash = createHash("sha256");
    if (prefix !== null) hash.update(`cbm-userconfig-source-v1\0${before.size ? "present" : "empty"}\0`);
    const buffer = Buffer.alloc(Math.min(limit + 1, 65536));
    let bytes = 0;
    for (;;) {
      const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, limit - bytes + 1), null);
      if (!count) break;
      bytes += count;
      if (bytes > limit) throw new Error("CBM input grew beyond bounded inspection");
      hash.update(buffer.subarray(0, count));
    }
    const after = fstatSync(descriptor, { bigint: true });
    const current = lstatSync(path, { bigint: true });
    const stable = ["dev", "ino", "size", "mtimeNs", "ctimeNs"];
    if (!current.isFile() || realpathSync(path) !== path || bytes !== Number(before.size) ||
        stable.some((key) => before[key] !== after[key] || after[key] !== current[key]))
      throw new Error("CBM input changed during bounded inspection");
    return { digest: hash.digest("hex"), bytes };
  } finally {
    closeSync(descriptor);
  }
}

// Match the versioned native semantic-manifest domains byte for byte, including
// their C-string terminators (pipeline_incremental.c and discover/userconfig.c).
function semanticDigests(root, git) {
  if (!git || git.is_git !== true || git.root_exists !== true || realpathSync(git.canonical_root) !== root)
    throw new Error("CBM native Git context is unknown or foreign");
  const hash = createHash("sha256").update("cbm-semantic-git-context-v1\0");
  for (const key of ["is_git", "is_worktree", "is_detached", "root_exists"]) {
    if (typeof git[key] !== "boolean") throw new Error("CBM native Git context is incomplete");
    hash.update(`${key}\0`).update(git[key] ? "1" : "0");
  }
  for (const key of ["branch", "branch_slug", "head_sha", "base_sha"]) {
    if (git[key] !== null && typeof git[key] !== "string") throw new Error("CBM native Git context is incomplete");
    hash.update(`${key}\0`).update(`${git[key] || ""}\0`);
  }
  const configRoot = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  if (!isAbsolute(configRoot)) throw new Error("CBM global configuration root is ambiguous");
  function configDigest(path) {
    // An absent file is the native missing-config digest; all other failures
    // remain refusals, including unreadable/replaced files.
    try { lstatSync(path); } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return createHash("sha256").update("cbm-userconfig-source-v1\0missing-or-unreadable\0").digest("hex");
    }
    return boundedDigest(path, 65536, true).digest;
  }
  return new Map([
    [".codebase-memory/.semantic-input/git-context-v1", hash.digest("hex")],
    [".codebase-memory/.semantic-input/global-extension-config-v1", configDigest(join(configRoot, "codebase-memory-mcp", "config.json"))],
    [".codebase-memory/.semantic-input/project-extension-config-v1", configDigest(join(root, ".codebase-memory.json"))],
  ]);
}

export function inspectMemoryFiles({ cacheDir, project, nativeStatus }) {
  const root = realpathSync(project.rootPath);
  const databasePath = join(cacheDir, `${project.name}.db`);
  if (lstatSync(databasePath).isSymbolicLink() || !contained(realpathSync(cacheDir), realpathSync(databasePath)))
    throw new Error("CBM native database routing is ambiguous");
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(databasePath, { readOnly: true, timeout: 2000 });
  try {
    database.exec("PRAGMA query_only=ON; BEGIN");
    const identity = database.prepare("SELECT root_path, indexed_at FROM projects WHERE name = ?").get(project.name);
    if (!identity || realpathSync(identity.root_path) !== root || identity.indexed_at !== nativeStatus.indexed_at)
      throw new Error("CBM native database project/root/generation differs from native status");
    const metadata = database.prepare("SELECT coverage_version, index_mode, generation, recording_status, hash_records_complete FROM index_coverage_meta WHERE project = ?").get(project.name);
    if (!metadata || metadata.coverage_version !== 9 || metadata.index_mode !== "full" || nativeStatus.doc_links?.status !== "ok" || metadata.generation !== identity.indexed_at || metadata.recording_status !== "complete" || metadata.hash_records_complete !== 1)
      return { freshness: "unverified", readiness: false, reason: "native digest format/mode, document links or generation is unsupported or incomplete" };
    const records = database.prepare("SELECT rel_path, sha256, size FROM file_hashes WHERE project = ? LIMIT ?").all(project.name, fileLimit + 1);
    if (!records.length || records.length > fileLimit)
      return { freshness: "unverified", readiness: false, reason: "native digest inventory absent or exceeds bounded inspection" };
    const inventory = spawnSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "--no-optional-locks", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 10_000, windowsHide: true,
    });
    if (inventory.error || inventory.status !== 0) throw new Error("CBM Git-visible file inventory is unavailable");
    const visible = new Set(inventory.stdout.split("\0").filter(Boolean));
    const expectedSemantic = semanticDigests(root, nativeStatus.git);
    const seenSemantic = new Set();
    const indexed = new Set();
    const changed = [];
    let bytes = 0;
    for (const record of records) {
      if (typeof record.rel_path !== "string" || isAbsolute(record.rel_path) || record.rel_path.split(/[\\/]/).some((part) => part === ".." || part === ".") || !/^[a-f0-9]{64}$/.test(record.sha256))
        throw new Error("CBM native digest record is ambiguous");
      if (record.rel_path.startsWith(".codebase-memory/.semantic-input/")) {
        if (!expectedSemantic.has(record.rel_path) || existsSync(resolve(root, record.rel_path)))
          throw new Error("CBM native semantic input is unknown or shadowed by a source file");
        seenSemantic.add(record.rel_path);
        if (expectedSemantic.get(record.rel_path) !== record.sha256) changed.push(record.rel_path);
        continue;
      }
      indexed.add(record.rel_path);
      const path = resolve(root, record.rel_path);
      if (!contained(root, path)) throw new Error("CBM native digest path is outside the selected root");
      let information;
      try { information = lstatSync(path); } catch { changed.push(record.rel_path); continue; }
      if (!information.isFile() || information.isSymbolicLink() || realpathSync(path) !== path)
        throw new Error("CBM native digest path is not a regular confined file");
      const inspected = boundedDigest(path, Math.min(16 * 1024 * 1024, byteLimit - bytes));
      bytes += inspected.bytes;
      if (inspected.bytes !== record.size || inspected.digest !== record.sha256 || !visible.has(record.rel_path)) changed.push(record.rel_path);
    }
    for (const path of expectedSemantic.keys()) if (!seenSemantic.has(path)) changed.push(path);
    const unrecorded = [...visible].filter((path) => !indexed.has(path));
    const storedGaps = database.prepare("SELECT kind, count(*) AS count FROM index_coverage WHERE project = ? GROUP BY kind").all(project.name);
    const partial = storedGaps.some((row) => row.kind !== "not_indexed_file" && row.kind !== "not_indexed_dir") || ["parse_partial", "parse_unusable", "skipped"].some((key) => !Number.isSafeInteger(nativeStatus[key]?.count) || nativeStatus[key].count !== 0);
    const current = !changed.length && !unrecorded.length;
    return {
      freshness: current ? "current" : "stale", readiness: current && !partial,
      reason: partial ? "native parse/skip coverage is partial or unknown" : current ? "native SHA256 inventory matches Git-visible source bytes" : "source differs from native digest inventory",
      database: databasePath, generation: identity.indexed_at, checkedFiles: indexed.size, checkedSemanticInputs: seenSemantic.size,
      checkedBytes: bytes, changed: changed.slice(0, 50), unrecorded: unrecorded.slice(0, 50),
      mismatchCount: changed.length + unrecorded.length, coverage: "native best-effort; not executed test coverage",
    };
  } finally {
    database.close();
  }
}
