import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { refuse } from "./errors.js";

/**
 * Identity of a measured workspace. A cold measurement copies exactly the bytes of one
 * commit (never the live tree), so the commit it records is the code it ran. A retained
 * measurement is only meaningful for the same workspace, so it re-derives that identity
 * and refuses on any difference before claiming anything.
 */
export interface WorkspaceSnapshot {
  readonly schema: "aihq-catalog-workspace-snapshot";
  readonly version: 1;
  readonly commit: string;
  readonly tree: string;
  /** Committed path → sha256 of its committed bytes. */
  readonly files: Readonly<Record<string, string>>;
  readonly manifestSha256: string;
  readonly lockSha256: string;
  /** sha256 over commit, tree and every committed path with its digest. */
  readonly snapshotSha256: string;
  readonly dist?: { readonly sha256: string; readonly files: number };
  /** sha256 of npm's hidden lockfile describing what is actually installed. */
  readonly installedSha256?: string;
}

export const SNAPSHOT_FILE = ".aih-measure-snapshot.json";
const RESERVED_TOP = new Set(["node_modules", "dist", SNAPSHOT_FILE]);
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function git(root: string, args: string[], input?: Buffer): Buffer {
  const result = spawnSync("git", ["-C", root, "--no-replace-objects", ...args], {
    ...(input ? { input } : {}),
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1" },
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return refuse("git-failed", `git ${args[0]} failed: ${String(result.stderr).slice(0, 300)}`);
  }
  return result.stdout;
}

/** Refuses unless every tracked file equals what HEAD records (untracked files are irrelevant). */
export function assertCleanTracked(root: string): void {
  const status = git(root, ["status", "--porcelain", "--untracked-files=no"])
    .toString("utf8")
    .trim();
  if (status !== "") {
    refuse(
      "source-dirty",
      "tracked files differ from HEAD; commit them first: a measurement records a commit, not a working tree",
      { changed: status.split("\n").slice(0, 20) },
    );
  }
}

export interface CommittedFile {
  readonly mode: "100644" | "100755";
  readonly bytes: Buffer;
}

/** Every blob of the commit's tree, read from git objects (never from the working tree). */
export function readCommittedFiles(
  root: string,
  commit = "HEAD",
): { commit: string; tree: string; files: Map<string, CommittedFile> } {
  const resolved = git(root, ["rev-parse", "--verify", `${commit}^{commit}`])
    .toString("utf8")
    .trim();
  const tree = git(root, ["rev-parse", "--verify", `${resolved}^{tree}`])
    .toString("utf8")
    .trim();
  const entries = git(root, ["ls-tree", "-r", "-z", "--full-tree", resolved])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const match = /^(\d{6}) (\w+) ([0-9a-f]{40,64})\t(.+)$/su.exec(line);
      if (match === null)
        return refuse("tree-unreadable", `unreadable tree entry ${line.slice(0, 80)}`);
      return {
        mode: match[1] as string,
        kind: match[2] as string,
        oid: match[3] as string,
        path: match[4] as string,
      };
    });
  for (const entry of entries) {
    if (entry.kind !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) {
      refuse(
        "snapshot-unsupported-entry",
        `${entry.path} is a ${entry.kind} (${entry.mode}); only plain files are copied`,
      );
    }
  }
  const batch = git(
    root,
    ["cat-file", "--batch"],
    Buffer.from(`${entries.map((e) => e.oid).join("\n")}\n`),
  );
  const files = new Map<string, CommittedFile>();
  let offset = 0;
  for (const entry of entries) {
    const end = batch.indexOf(0x0a, offset);
    const [oid, type, size] = batch.subarray(offset, end).toString("utf8").split(" ");
    if (oid !== entry.oid || type !== "blob" || size === undefined) {
      return refuse("tree-unreadable", `unexpected git object for ${entry.path}`);
    }
    const start = end + 1;
    const bytes = Buffer.from(batch.subarray(start, start + Number(size)));
    offset = start + Number(size) + 1;
    files.set(entry.path, { mode: entry.mode as "100644" | "100755", bytes });
  }
  return { commit: resolved, tree, files };
}

/** Writes committed files into a new workspace directory. */
export function writeCommittedFiles(dir: string, files: ReadonlyMap<string, CommittedFile>): void {
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    refuse("workspace-not-empty", "a cold measurement needs a new or empty workspace directory");
  }
  for (const [path, file] of files) {
    const target = join(dir, ...path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.bytes, { mode: file.mode === "100755" ? 0o755 : 0o644 });
  }
}

export function snapshotOf(committed: {
  commit: string;
  tree: string;
  files: ReadonlyMap<string, CommittedFile>;
}): WorkspaceSnapshot {
  const files = Object.fromEntries(
    [...committed.files]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, file]) => [path, sha(file.bytes)]),
  );
  const need = (path: string) => {
    const file = committed.files.get(path);
    return file === undefined
      ? refuse("snapshot-incomplete", `${path} is not committed`)
      : sha(file.bytes);
  };
  return {
    schema: "aihq-catalog-workspace-snapshot",
    version: 1,
    commit: committed.commit,
    tree: committed.tree,
    files,
    manifestSha256: need("package.json"),
    lockSha256: need("package-lock.json"),
    snapshotSha256: sha(JSON.stringify({ commit: committed.commit, tree: committed.tree, files })),
  };
}

/** Digest of every file below a directory (paths and bytes), refusing links. */
export function hashDirectory(dir: string): { sha256: string; files: number } {
  const lines: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) refuse("workspace-unsafe", `${prefix}${name} is a link`);
      if (stat.isDirectory()) walk(path, `${prefix}${name}/`);
      else lines.push(`${prefix}${name}\0${sha(readFileSync(path))}`);
    }
  };
  walk(dir, "");
  return { sha256: sha(lines.join("\n")), files: lines.length };
}

/** Adds what the cold run built and installed to the snapshot. */
export function withBuild(snapshot: WorkspaceSnapshot, workspace: string): WorkspaceSnapshot {
  const hidden = join(workspace, "node_modules", ".package-lock.json");
  if (!existsSync(hidden) || !existsSync(join(workspace, "dist"))) {
    return refuse(
      "workspace-incomplete",
      "the cold run left no installed dependencies or build output",
    );
  }
  return {
    ...snapshot,
    dist: hashDirectory(join(workspace, "dist")),
    installedSha256: sha(readFileSync(hidden)),
  };
}

export function writeSnapshot(workspace: string, snapshot: WorkspaceSnapshot): void {
  writeFileSync(join(workspace, SNAPSHOT_FILE), `${JSON.stringify(snapshot, null, 2)}\n`);
}

export function readSnapshot(workspace: string): WorkspaceSnapshot {
  const file = join(workspace, SNAPSHOT_FILE);
  if (!existsSync(file)) {
    return refuse("workspace-unrecorded", "the workspace has no recorded cold-install snapshot");
  }
  const value = JSON.parse(readFileSync(file, "utf8")) as WorkspaceSnapshot;
  if (value.schema !== "aihq-catalog-workspace-snapshot" || value.version !== 1) {
    return refuse("workspace-unrecorded", "unsupported workspace snapshot");
  }
  return value;
}

/**
 * Compares a workspace with its recorded snapshot: the same committed bytes, no extra
 * files, the same build output and the same installed dependencies. Returns problems
 * rather than throwing so the caller can name them all before refusing.
 */
export function verifyWorkspace(workspace: string, snapshot: WorkspaceSnapshot): string[] {
  const problems: string[] = [];
  for (const [path, digest] of Object.entries(snapshot.files)) {
    const file = join(workspace, ...path.split("/"));
    try {
      if (sha(readFileSync(file)) !== digest) problems.push(`changed: ${path}`);
    } catch {
      problems.push(`missing: ${path}`);
    }
  }
  const known = new Set(Object.keys(snapshot.files));
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      if (prefix === "" && RESERVED_TOP.has(name)) continue;
      const stat = lstatSync(join(dir, name));
      if (stat.isDirectory()) walk(join(dir, name), `${prefix}${name}/`);
      else if (!known.has(`${prefix}${name}`)) problems.push(`unexpected: ${prefix}${name}`);
    }
  };
  walk(workspace, "");
  if (snapshot.dist === undefined || snapshot.installedSha256 === undefined) {
    problems.push("snapshot lacks build or installed-dependency identity");
    return problems;
  }
  try {
    const dist = hashDirectory(join(workspace, "dist"));
    if (dist.sha256 !== snapshot.dist.sha256)
      problems.push("build output (dist) differs from the cold run");
  } catch {
    problems.push("build output (dist) is missing");
  }
  const hidden = join(workspace, "node_modules", ".package-lock.json");
  if (!existsSync(hidden)) problems.push("installed dependencies (node_modules) are missing");
  else if (sha(readFileSync(hidden)) !== snapshot.installedSha256) {
    problems.push("installed dependencies differ from the cold run");
  }
  return problems;
}
