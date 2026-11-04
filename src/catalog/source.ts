/**
 * `@aihq/catalog/source` (new model, browser-safe): discovery over files already read.
 * Nothing here touches the host, the network or runs any input.
 */
import { type Invalid, limits, type Refused } from "./contracts.js";
import {
  type DiscoveredItem,
  FRAMEWORK_ID,
  ID_SEGMENT,
  type LeftOver,
  type Notice,
  SHA256,
  type SourceFile,
} from "./internal/model.js";
import {
  basenameOf,
  compareCodeUnits,
  dirnameOf,
  isSafeRelativePath,
  isUnder,
  limitRefusal,
  quote,
  refused,
} from "./internal/paths.js";

export type { DiscoveredItem, LeftOver, Notice, SourceFile } from "./internal/model.js";
export {
  type GitCandidate,
  type LocalCandidate,
  type NpmCandidate,
  type ParseSourceLinkResult,
  parseSourceLink,
  type SourceCandidate,
} from "./internal/source-link.js";

export type FindItemsResult =
  | {
      readonly status: "ok";
      readonly items: readonly DiscoveredItem[];
      readonly notices: readonly Notice[];
      readonly leftOver: readonly LeftOver[];
    }
  | Refused
  | Invalid;

const NOTICE = /^(?:LICEN[CS]E|COPYING|NOTICE)(?:[-_.][A-Za-z0-9._-]*)?$/i;

/** True for a licence or notice file; notices are never item files. */
export const isNoticePath = (path: string): boolean => NOTICE.test(basenameOf(path));

/** Paths of kinds that exist in the contract but whose discovery here is not implemented. */
function unimplementedKind(path: string): string | null {
  const first = path.split("/")[0];
  if (first === "hooks" || basenameOf(path) === "hooks.json") return "hook";
  const name = basenameOf(path);
  if (name === ".mcp.json" || name === "mcp.json" || first === "mcp-configs") return "mcp";
  return null;
}

const idPath = (segments: readonly string[]): string | null =>
  segments.length > 0 && segments.every((segment) => ID_SEGMENT.test(segment))
    ? segments.join(".")
    : null;

/**
 * Finds skill and rule items in a source's files (ids are `<framework>.<kind>.<path>`, the
 * path without its kind folder). A skill is the folder holding a `SKILL.md`; a rule is a
 * Markdown file under `rules/`. Licence and notice files become notices covering their folder.
 * Every other entry is listed in `leftOver` with its reason; nothing is dropped silently.
 */
export function findItems(
  files: readonly SourceFile[],
  options: { readonly framework: string; readonly sourceId?: string },
): FindItemsResult {
  const framework = options?.framework;
  if (typeof framework !== "string" || !FRAMEWORK_ID.test(framework)) {
    return invalid(
      "framework",
      "the framework id must be lowercase letters, digits and single hyphens",
    );
  }
  const sourceId = options.sourceId ?? framework;
  if (!FRAMEWORK_ID.test(sourceId))
    return invalid(
      "sourceId",
      "the source id must be lowercase letters, digits and single hyphens",
    );
  if (!Array.isArray(files)) return invalid("files", "files must be an array");
  if (files.length > limits.sourceEntries)
    return limitRefusal("sourceEntries", "the source entry count");

  const regular: SourceFile[] = [];
  const leftOver: LeftOver[] = [];
  const seen = new Set<string>();
  let fileCount = 0;
  for (const file of files) {
    const path = file?.path;
    if (!isSafeRelativePath(path)) {
      return refused(
        "path-escape",
        `the entry path ${quote(String(path))} is not a safe relative path`,
      );
    }
    if (seen.has(path)) return invalid(path, "the path is listed twice");
    seen.add(path);
    if (file.mode === "link" || file.mode === "special-file") {
      leftOver.push({ path, reason: file.mode });
      continue;
    }
    if (file.mode !== "100644" && file.mode !== "100755") return invalid(path, "unknown file mode");
    if (typeof file.sha256 !== "string" || !SHA256.test(file.sha256)) {
      return invalid(path, "a regular file needs its lowercase hex sha256");
    }
    fileCount += 1;
    if (fileCount > limits.sourceFiles) return limitRefusal("sourceFiles", "the source file count");
    regular.push(file);
  }
  for (const path of seen) {
    for (let parent = dirnameOf(path); parent !== ""; parent = dirnameOf(parent)) {
      if (seen.has(parent)) return invalid(path, "the path is both a file and a folder");
    }
  }

  const notices: Notice[] = [];
  const candidates = regular.filter((file) => {
    if (!isNoticePath(file.path)) return true;
    const folder = dirnameOf(file.path);
    notices.push({
      sourcePath: file.path,
      sha256: file.sha256 as string,
      covers: folder === "" ? "/" : folder,
    });
    return false;
  });

  // Skill folders: the folder of each SKILL.md. One inside another is ambiguous.
  const skillFolders = candidates
    .filter((file) => basenameOf(file.path) === "SKILL.md")
    .map((file) => dirnameOf(file.path))
    .sort(compareCodeUnits);
  const ambiguous = new Set<string>();
  for (const folder of skillFolders) {
    if (folder === "") ambiguous.add(folder);
    else if (
      skillFolders.some((other) => other !== folder && other !== "" && isUnder(folder, other))
    ) {
      ambiguous.add(folder);
    }
  }
  const owned = new Map<string, string>();
  const items = new Map<string, DiscoveredItem>();
  const add = (
    id: string,
    kind: "skill" | "rule" | "agent" | "mcp",
    members: readonly SourceFile[],
    userOnly?: true,
  ) => {
    items.set(id, {
      id,
      kind,
      ...(userOnly ? { userOnly } : {}),
      files: members
        .map((file) => ({
          sourceId,
          sourcePath: file.path,
          sha256: file.sha256 as string,
          executable: file.mode === "100755",
          role: "content" as const,
        }))
        .sort((left, right) => compareCodeUnits(left.sourcePath, right.sourcePath)),
    });
  };
  const duplicates: string[] = [];
  for (const folder of skillFolders) {
    if (ambiguous.has(folder)) continue;
    const segments = folder.split("/");
    const path = idPath(segments[0] === "skills" ? segments.slice(1) : segments);
    const members = candidates.filter(
      (file) =>
        isUnder(file.path, folder) &&
        ![...ambiguous].some((inner) => inner !== "" && isUnder(file.path, inner)),
    );
    if (path === null) {
      for (const file of members) owned.set(file.path, "unrepresentable-id");
      continue;
    }
    const id = `${framework}.skill.${path}`;
    if (items.has(id)) duplicates.push(id);
    for (const file of members) owned.set(file.path, id);
    add(id, "skill", members);
  }
  const shadowed = new Set<string>();
  for (const file of candidates) {
    if (owned.has(file.path)) continue;
    const segments = file.path.split("/");
    const last = segments.length - 1;
    const stem = (segments[last] as string).replace(/\.md$/, "");
    const single = (kind: "rule" | "agent" | "skill", userOnly?: true) => {
      const path = idPath([...segments.slice(1, last), stem]);
      if (path === null) {
        owned.set(file.path, "unrepresentable-id");
        return;
      }
      const id = `${framework}.${kind}.${path}`;
      // A command and a skill with one name: the skill wins.
      if (kind === "skill" && items.has(id)) {
        shadowed.add(file.path);
        return;
      }
      if (items.has(id)) duplicates.push(id);
      owned.set(file.path, id);
      add(id, kind, [file], userOnly);
    };
    if (segments.length < 2 || !file.path.endsWith(".md")) continue;
    if (segments[0] === "rules") single("rule");
    else if (segments[0] === "agents") single("agent");
    else if (segments[0] === "commands") single("skill", true);
  }
  // MCP servers: each Registry server.json outside a skill folder.
  for (const file of candidates) {
    if (owned.has(file.path) || basenameOf(file.path) !== "server.json") continue;
    const segments = dirnameOf(file.path)
      .split("/")
      .filter((segment) => segment !== "");
    let path = idPath(segments[0] === "mcp" ? segments.slice(1) : segments);
    if (segments.length === 0 && file.bytes instanceof Uint8Array) {
      try {
        const name = JSON.parse(new TextDecoder().decode(file.bytes))?.name;
        if (typeof name === "string") path = idPath([name.slice(name.lastIndexOf("/") + 1)]);
      } catch {
        path = null;
      }
    }
    if (path === null) {
      owned.set(file.path, "unrepresentable-id");
      continue;
    }
    const id = `${framework}.mcp.${path}`;
    if (items.has(id)) duplicates.push(id);
    owned.set(file.path, id);
    add(id, "mcp", [file]);
  }
  if (duplicates.length > 0) {
    return {
      status: "invalid",
      problems: duplicates
        .sort(compareCodeUnits)
        .map((id) => ({ path: id, message: "two items would have the same id" })),
    };
  }

  for (const file of candidates) {
    const owner = owned.get(file.path);
    if (owner === "unrepresentable-id")
      leftOver.push({ path: file.path, reason: "unrepresentable-id" });
    else if (shadowed.has(file.path))
      leftOver.push({ path: file.path, reason: "shadowed-by-skill" });
    else if (owner !== undefined) continue;
    else if (
      [...ambiguous].some((folder) =>
        folder === "" ? file.path === "SKILL.md" : isUnder(file.path, folder),
      )
    ) {
      leftOver.push({ path: file.path, reason: "ambiguous-skill" });
    } else {
      const kind = unimplementedKind(file.path);
      leftOver.push(
        kind
          ? { path: file.path, reason: "not-implemented", kind }
          : { path: file.path, reason: "unrecognised" },
      );
    }
  }

  return {
    status: "ok",
    items: [...items.values()].sort((left, right) => compareCodeUnits(left.id, right.id)),
    notices: notices.sort((left, right) => compareCodeUnits(left.sourcePath, right.sourcePath)),
    leftOver: leftOver.sort((left, right) => compareCodeUnits(left.path, right.path)),
  };
}

function invalid(path: string, message: string): Invalid {
  return { status: "invalid", problems: [{ path, message }] };
}
