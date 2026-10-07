import { createHash } from "node:crypto";
import { refuse } from "./errors.js";
import { COMMIT, type SourceTree } from "./tree.js";

/** Runs `git` with exactly `args` and returns stdout; throws on a non-zero exit. */
export type GitRunner = (args: readonly string[]) => Uint8Array;

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const ENTRY = /^(\d{6}) (\w+) ([a-f0-9]{40})\t(.+)$/su;

function objectId(type: "blob" | "tree" | "commit", bytes: Uint8Array): string {
  return createHash("sha1")
    .update(`${type} ${bytes.byteLength}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}

/**
 * Reads one commit's whole tree from a git object database. Enumeration is
 * `ls-tree -r`, so it is complete for every blob; submodule (gitlink) entries
 * become opaque prefixes and symlinks become irregular paths. `run` receives
 * the git arguments after any `-C <dir>`/config prefix the caller supplies.
 */
export function readCommitTree(input: {
  repository: string;
  commit: string;
  run: (...args: string[]) => Uint8Array;
}): SourceTree {
  const { repository, commit, run } = input;
  if (!COMMIT.test(commit))
    return refuse("commit-invalid", "a full 40-character commit is required");
  const head = UTF8.decode(run("rev-parse", "--verify", `${commit}^{commit}`)).trim();
  if (head !== commit)
    return refuse("commit-mismatch", `resolved ${head}, not the requested ${commit}`);
  const type = UTF8.decode(run("cat-file", "-t", commit)).trim();
  if (type !== "commit") return refuse("commit-invalid", `${commit} is a ${type}, not a commit`);

  const commitBytes = run("cat-file", "commit", commit);
  if (objectId("commit", commitBytes) !== commit) {
    return refuse("cache-object-invalid", "the pinned commit object does not match its object id");
  }
  const rootTree = /^tree ([a-f0-9]{40})$/mu.exec(UTF8.decode(commitBytes))?.[1];
  if (rootTree === undefined) {
    return refuse("tree-unreadable", "the pinned commit has no valid root tree id");
  }

  const paths = new Set<string>();
  const irregular = new Set<string>();
  const opaquePrefixes: string[] = [];
  const treeIds = new Set([rootTree]);
  const blobIds = new Map<string, string>();
  for (const line of UTF8.decode(run("ls-tree", "-r", "-t", "-z", "--full-tree", commit))
    .split("\0")
    .filter(Boolean)) {
    const match = ENTRY.exec(line);
    if (match === null)
      return refuse("tree-unreadable", `unreadable tree entry ${line.slice(0, 80)}`);
    const [, mode, kind, oid, path] = match as unknown as [string, string, string, string, string];
    if (kind === "tree") treeIds.add(oid);
    else if (kind === "blob" && (mode === "100644" || mode === "100755")) {
      paths.add(path);
      blobIds.set(path, oid);
    } else if (kind === "blob") irregular.add(path);
    else if (kind === "commit") opaquePrefixes.push(path);
  }
  for (const oid of treeIds) {
    const treeBytes = run("cat-file", "tree", oid);
    if (objectId("tree", treeBytes) !== oid) {
      return refuse("cache-object-invalid", `tree object ${oid} does not match its object id`);
    }
  }
  return {
    repository,
    commit,
    inventory: { complete: true, paths, irregular, opaquePrefixes },
    read(path: string): Uint8Array {
      if (!paths.has(path)) {
        return refuse("source-file-unavailable", `upstream file ${path} is not a regular file`);
      }
      const oid = blobIds.get(path);
      if (oid === undefined)
        return refuse("tree-unreadable", `upstream file ${path} has no blob id`);
      const bytes = run("cat-file", "blob", oid);
      if (objectId("blob", bytes) !== oid) {
        return refuse("cache-object-invalid", `blob object ${oid} does not match its object id`);
      }
      return bytes;
    },
  };
}
