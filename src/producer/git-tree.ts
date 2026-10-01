import { refuse } from "./errors.js";
import { COMMIT, type SourceTree } from "./tree.js";

/** Runs `git` with exactly `args` and returns stdout; throws on a non-zero exit. */
export type GitRunner = (args: readonly string[]) => Uint8Array;

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const ENTRY = /^(\d{6}) (\w+) [a-f0-9]+\t(.+)$/su;

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

  const paths = new Set<string>();
  const irregular = new Set<string>();
  const opaquePrefixes: string[] = [];
  for (const line of UTF8.decode(run("ls-tree", "-r", "-z", "--full-tree", commit))
    .split("\0")
    .filter(Boolean)) {
    const match = ENTRY.exec(line);
    if (match === null)
      return refuse("tree-unreadable", `unreadable tree entry ${line.slice(0, 80)}`);
    const [, mode, kind, path] = match as unknown as [string, string, string, string];
    if (kind === "blob" && (mode === "100644" || mode === "100755")) paths.add(path);
    else if (kind === "blob") irregular.add(path);
    else if (kind === "commit") opaquePrefixes.push(path);
  }
  return {
    repository,
    commit,
    inventory: { complete: true, paths, irregular, opaquePrefixes },
    read(path: string): Uint8Array {
      if (!paths.has(path)) {
        return refuse("source-file-unavailable", `upstream file ${path} is not a regular file`);
      }
      return run("cat-file", "blob", `${commit}:${path}`);
    },
  };
}
