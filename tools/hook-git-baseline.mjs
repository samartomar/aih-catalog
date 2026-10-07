import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const HOOK_RELEASE_PATH = "release/release-1.1.json";
const git = (root, args) => execFileSync("git", ["-C", root, ...args], { encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Read one immutable commit, or fail. Only a proven absent 1.1 document is a first release. */
export function committedHookBaseline(root, reference = "HEAD") {
  if (reference !== "HEAD" && !/^[0-9a-f]{40,64}$/u.test(reference)) {
    throw new Error("hook baseline must be HEAD or a full commit SHA");
  }
  let commit;
  try {
    commit = git(root, ["rev-parse", "--verify", `${reference}^{commit}`]).toString("utf8").trim();
  } catch {
    throw new Error(`hook baseline commit is unavailable: ${reference}`);
  }
  const paths = git(root, ["ls-tree", "--name-only", commit, "--", HOOK_RELEASE_PATH]).toString("utf8").trim();
  if (paths === "") return undefined;
  if (paths !== HOOK_RELEASE_PATH) throw new Error("hook baseline tree is ambiguous");
  const show = (path) => git(root, ["show", `${commit}:${path}`]);
  const documentBytes = show(HOOK_RELEASE_PATH);
  const document = JSON.parse(documentBytes.toString("utf8"));
  if (document.schema !== "urn:aihq:catalog:release:1.1.0" || !Array.isArray(document.items)) {
    throw new Error("hook baseline release is malformed");
  }
  const files = new Map([[HOOK_RELEASE_PATH, documentBytes]]);
  for (const item of document.items) {
    const recipe = item.recipe;
    if (typeof recipe?.path !== "string" || !/^release\/recipes\/[a-zA-Z0-9._-]+\.json$/u.test(recipe.path) ||
        typeof recipe.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(recipe.sha256) ||
        !Number.isSafeInteger(recipe.byteLength) || recipe.byteLength < 0) {
      throw new Error("hook baseline recipe reference is malformed");
    }
    const bytes = show(recipe.path);
    if (bytes.length !== recipe.byteLength || digest(bytes) !== recipe.sha256) {
      throw new Error(`hook baseline recipe is damaged: ${recipe.path}`);
    }
    files.set(recipe.path, bytes);
  }
  return files;
}
