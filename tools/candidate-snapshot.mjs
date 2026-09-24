import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { candidateMarkersV1 } from "./check-not-candidate.mjs";

/**
 * Binds a candidate Catalog root to the commit it names. The build step never
 * sees the live checkout: it gets a private snapshot of HEAD, checked out
 * from git into <root>/.candidate-build-* (gitignored) through a private
 * index, and writes its output to <snapshot>/dist-candidate. That output is
 * moved to <root>/dist-candidate only if, after the build, the live HEAD is
 * still the recorded commit, the snapshot still equals that commit's tree and
 * the output's CANDIDATE.json names that commit. Anything else is refused and
 * the partial output is removed; an earlier candidate root is left as it was.
 */
export const CANDIDATE_ROOT = "dist-candidate";
const CANDIDATE_FORMAT = "aih-catalog-candidate";

const run = (args, options = {}) => {
  const result = spawnSync("git", args, { encoding: "utf8", ...options });
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr ?? "").trim()}`);
  return result.stdout;
};

function headOf(root) {
  const head = run(["-C", root, "rev-parse", "--verify", "HEAD^{commit}"]).trim();
  if (!/^[0-9a-f]{40}$/u.test(head)) throw new Error(`HEAD ${head} is not a commit id`);
  return head;
}

/** An existing output root may be replaced only if it is an earlier candidate root. */
function assertReplaceable(outRoot) {
  if (!existsSync(outRoot)) return;
  let format;
  try {
    if (!lstatSync(outRoot).isDirectory()) throw new Error("not a directory");
    format = JSON.parse(readFileSync(join(outRoot, "CANDIDATE.json"), "utf8"))?.format;
  } catch {
    format = undefined;
  }
  if (format !== CANDIDATE_FORMAT)
    throw new Error(
      `${outRoot} exists but is not an earlier candidate root (no CANDIDATE.json); remove it yourself`,
    );
}

/**
 * Run `step({ root: snapshot, catalogCommit })` over a snapshot of the
 * checkout's HEAD and expose its `<snapshot>/dist-candidate` as
 * `<root>/dist-candidate`. Returns `{ catalogCommit, outRoot, result }`.
 */
export async function buildCandidateFromCommitV1(checkout, step) {
  const root = resolve(checkout);
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

  const gitDir = run(["-C", root, "rev-parse", "--absolute-git-dir"]).trim();
  // Inside the checkout (gitignored) so the snapshot resolves its node_modules
  // by walking up, and so the finished output moves by a same-volume rename.
  const staging = mkdtempSync(join(root, ".candidate-build-"));
  const tree = join(staging, "tree");
  const env = { ...process.env, GIT_INDEX_FILE: join(staging, "index") };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  const snapshotGit = (...args) =>
    run(["--git-dir", gitDir, "--work-tree", tree, ...args], { cwd: tree, env });
  try {
    mkdirSync(tree);
    snapshotGit("read-tree", catalogCommit);
    snapshotGit("checkout-index", "--all", "--force");

    const result = await step({ root: tree, catalogCommit });

    const moved = headOf(root);
    if (moved !== catalogCommit)
      throw new Error(
        `the checkout's HEAD moved from ${catalogCommit} to ${moved} during the build; the candidate is refused`,
      );
    snapshotGit("update-index", "-q", "--refresh");
    const changed = [
      ...snapshotGit("diff-files", "--name-only").split("\n"),
      ...snapshotGit("ls-files", "--others", "--exclude-standard").split("\n"),
    ].filter((line) => line !== "");
    const treeOf = snapshotGit("write-tree").trim();
    const committedTree = run(["-C", root, "rev-parse", `${catalogCommit}^{tree}`]).trim();
    if (changed.length > 0 || treeOf !== committedTree)
      throw new Error(
        `the build snapshot ${tree} no longer equals ${catalogCommit}; the candidate is refused:\n${changed.join("\n")}`,
      );
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

    assertReplaceable(outRoot);
    rmSync(outRoot, { recursive: true, force: true });
    renameSync(built, outRoot);
    const after = headOf(root);
    if (after !== catalogCommit) {
      rmSync(outRoot, { recursive: true, force: true });
      throw new Error(
        `the checkout's HEAD moved from ${catalogCommit} to ${after} during the build; the candidate is refused`,
      );
    }
    return { catalogCommit, outRoot, result };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
