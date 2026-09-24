import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { assertSafeRelativePosixPathV1, codeUnitCompare } from "../strict-json-v1.js";
import {
  BASELINE_DEFINITION_SUBJECTS_V1,
  type BaselineDefinitionSubjectV1,
} from "./baseline-definitions-v1.js";

/**
 * The disjoint whole-repository Scanner inventory: the BaselineCatalog Scan's request-set
 * route accepts (its component paths never overlap) and Core's `scanner-cli --definition`
 * consumes. It reproduces the partition of the installed inventories (Catalog
 * `scannerProof.publishedCatalog`, Core `.github/baseline-candidates/*.inventory.json`),
 * whose producer was never committed:
 *
 * - input: the commit's tracked tree; symbolic links are excluded from every component;
 * - skill: every directory holding a `SKILL.md` is one component, `skillContent: true`;
 * - runtime: a top-level directory without a skill is one component; a top-level directory
 *   with a skill contributes each of its remaining regular files by path; the top-level
 *   regular files form one component keyed `root`;
 * - id: `<skill|runtime>:<slug(key)>-<sha256(key) first 12 hex>`, key = the skill directory,
 *   the top-level directory name or `root`; slug = lowercase, each run of [^a-z0-9] as `-`,
 *   trimmed;
 * - order: components by id, paths by code unit (Scan's normalized order); object keys sorted.
 *
 * Anything that rule does not partition (a root SKILL.md, a skill inside a skill, a link
 * inside a directory component, a submodule, a repeated id) is refused, never guessed.
 */
export interface GitTreeEntryV1 {
  readonly mode: string;
  readonly type: string;
  readonly path: string;
}

export interface BaselineInventoryComponentV1 {
  id: string;
  paths: string[];
  skillContent?: true;
}

export interface BaselineInventoryV1 {
  components: BaselineInventoryComponentV1[];
  id: string;
  owner: string;
  pinnedSha: string;
  repo: string;
}

const COMMIT = /^[0-9a-f]{40}$/u;
const REGULAR = new Set(["100644", "100755"]);

function fail(message: string): never {
  throw new TypeError(`baseline inventory: ${message}`);
}

function componentId(kind: "skill" | "runtime", key: string): string {
  const slug = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (slug === "") fail(`empty component slug for ${JSON.stringify(key)}`);
  return `${kind}:${slug}-${createHash("sha256").update(key, "utf8").digest("hex").slice(0, 12)}`;
}

function subjectOf(name: string): BaselineDefinitionSubjectV1 {
  if (!Object.hasOwn(BASELINE_DEFINITION_SUBJECTS_V1, name))
    fail(`unknown subject ${JSON.stringify(name)}`);
  return name as BaselineDefinitionSubjectV1;
}

const within = (path: string, directory: string) => path.startsWith(`${directory}/`);

/** Partitions one commit's tracked tree into the disjoint whole-repository inventory. */
export function baselineInventoryFromTreeV1(
  name: string,
  commit: string,
  entries: readonly GitTreeEntryV1[],
): BaselineInventoryV1 {
  const subject = subjectOf(name);
  if (!COMMIT.test(commit)) fail("commit must be a full 40-character lowercase sha");
  const files: string[] = [];
  const links: string[] = [];
  for (const entry of entries) {
    try {
      assertSafeRelativePosixPathV1(entry.path, "tree path");
    } catch {
      fail(`unsafe tree path ${JSON.stringify(entry.path)}`);
    }
    if (entry.type === "blob" && REGULAR.has(entry.mode)) files.push(entry.path);
    else if (entry.type === "blob" && entry.mode === "120000") links.push(entry.path);
    else fail(`unsupported tree entry ${entry.mode} ${entry.type} ${entry.path}`);
  }
  if (files.length === 0) fail("the tree holds no regular file");
  const regular = new Set(files);

  const skills = files
    .filter((path) => path === "SKILL.md" || path.endsWith("/SKILL.md"))
    .map((path) => {
      if (path === "SKILL.md") fail("a SKILL.md at the repository root has no skill directory");
      return path.slice(0, -"/SKILL.md".length);
    })
    .sort(codeUnitCompare);
  for (const skill of skills)
    for (const outer of skills)
      if (within(skill, outer)) fail(`skill ${skill} is inside skill ${outer}`);

  // Components by kind and origin; the id key alone may repeat (a top-level directory named
  // "root" beside the top-level files, whose origin "/" no tree path can equal) and is
  // refused below rather than merged.
  const byKey = new Map<string, { kind: "skill" | "runtime"; key: string; paths: Set<string> }>();
  const add = (kind: "skill" | "runtime", key: string, path: string, origin = key) => {
    const slot = `${kind}:${origin}`;
    const component = byKey.get(slot) ?? { kind, key, paths: new Set<string>() };
    component.paths.add(path);
    byKey.set(slot, component);
  };
  const topLevelWithSkills = new Set(skills.map((skill) => skill.split("/")[0] as string));
  for (const path of files) {
    const skill = skills.find((candidate) => within(path, candidate));
    if (skill !== undefined) {
      add("skill", skill, skill);
      continue;
    }
    const slash = path.indexOf("/");
    if (slash < 0) {
      add("runtime", "root", path, "/");
      continue;
    }
    const top = path.slice(0, slash);
    add("runtime", top, topLevelWithSkills.has(top) ? path : top);
  }
  // A directory component would carry any link beneath it into Scan's component hash.
  const directories = [...byKey.values()].flatMap((component) =>
    [...component.paths].filter((path) => !regular.has(path)),
  );
  for (const link of links)
    for (const directory of directories)
      if (within(link, directory))
        fail(`${link} is a symbolic link inside component directory ${directory}`);

  const ids = new Set<string>();
  const components = [...byKey.values()].map((component) => {
    const id = componentId(component.kind, component.key);
    if (ids.has(id)) fail(`the inventory repeats component id ${id}`);
    ids.add(id);
    return {
      id,
      paths: [...component.paths].sort(codeUnitCompare),
      ...(component.kind === "skill" ? { skillContent: true as const } : {}),
    };
  });
  components.sort((left, right) => codeUnitCompare(left.id, right.id));
  const [owner, repo] = BASELINE_DEFINITION_SUBJECTS_V1[subject].split("/") as [string, string];
  return { components, id: subject, owner, pinnedSha: commit, repo };
}

function runGit(checkout: string, args: readonly string[]): Buffer {
  try {
    return execFileSync("git", ["-C", checkout, ...args], {
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch {
    return fail(`git ${args[0]} failed in ${checkout}`);
  }
}

/**
 * Reads the tracked tree of `commit` from a checkout of the subject's repository (its
 * `origin` must name that GitHub repository) and returns the whole-repository inventory.
 * Only the commit's tree is read: the working tree, its line endings and untracked files
 * play no part.
 */
export function emitBaselineInventoryV1(
  name: string,
  commit: string,
  checkout: string,
): BaselineInventoryV1 {
  const subject = subjectOf(name);
  if (!COMMIT.test(commit)) fail("commit must be a full 40-character lowercase sha");
  const repository = BASELINE_DEFINITION_SUBJECTS_V1[subject];
  const origin = runGit(checkout, ["remote", "get-url", "origin"]).toString("utf8").trim();
  const named = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/u.exec(origin)?.[1];
  if (named === undefined || named.toLowerCase() !== repository.toLowerCase())
    fail(`checkout origin is ${origin}, not ${repository}`);
  let resolved: string;
  try {
    resolved = execFileSync(
      "git",
      ["-C", checkout, "rev-parse", "--verify", `${commit}^{commit}`],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    ).trim();
  } catch {
    return fail(`checkout ${checkout} does not hold commit ${commit}`);
  }
  if (resolved !== commit) fail(`checkout ${checkout} does not hold commit ${commit}`);
  let listing: string;
  try {
    listing = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      runGit(checkout, ["ls-tree", "-r", "-z", "--full-tree", commit]),
    );
  } catch {
    return fail("the tree listing is not UTF-8");
  }
  const entries = listing
    .split("\0")
    .filter((record) => record.length > 0)
    .map((record) => {
      const tab = record.indexOf("\t");
      const [mode, type, object] = tab < 0 ? [] : record.slice(0, tab).split(" ");
      if (mode === undefined || type === undefined || object === undefined)
        fail("malformed tree listing");
      return { mode, type, path: record.slice(tab + 1) };
    });
  return baselineInventoryFromTreeV1(subject, commit, entries);
}
