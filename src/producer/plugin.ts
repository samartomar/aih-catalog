import { isRecord, safeMemberPath } from "../release/document.js";
import { JsonAdmissionError } from "../release/json.js";
import {
  type DeclaredItem,
  type DeclaredSkillItem,
  type DeclaredSource,
  isTemplateItem,
} from "./declaration.js";
import { refuse } from "./errors.js";
import { readUpstreamObject } from "./json.js";
import { readPresent, type SourceTree } from "./tree.js";

/** Reads the upstream plugin's explicit inclusion list, when this source declares one. */
export function pluginSkillPaths(
  tree: SourceTree,
  source: DeclaredSource,
  declared: readonly DeclaredItem[],
): ReadonlySet<string> | undefined {
  const manifestPath = source.pluginManifestPath;
  if (manifestPath === undefined) return undefined;
  let manifest: unknown;
  try {
    manifest = readUpstreamObject(readPresent(tree, manifestPath));
  } catch (error) {
    if (error instanceof TypeError || error instanceof JsonAdmissionError) {
      return refuse("plugin-manifest-invalid", `${manifestPath} is not valid UTF-8 JSON`);
    }
    throw error;
  }
  if (!isRecord(manifest) || !Array.isArray(manifest.skills)) {
    return refuse("plugin-manifest-invalid", `${manifestPath} has no skills array`);
  }
  const paths = new Set<string>();
  for (const [index, value] of manifest.skills.entries()) {
    if (typeof value !== "string") {
      return refuse("plugin-manifest-invalid", `${manifestPath} skills/${index} is not a path`);
    }
    const directory = value.startsWith("./") ? value.slice(2) : value;
    if (
      !safeMemberPath(directory) ||
      !directory.startsWith("skills/") ||
      directory.endsWith("/SKILL.md")
    ) {
      return refuse("plugin-manifest-invalid", `${manifestPath} skills/${index} is unsafe`);
    }
    const skillPath = `${directory}/SKILL.md`;
    if (paths.has(skillPath)) {
      return refuse("plugin-manifest-invalid", `${manifestPath} lists ${directory} more than once`);
    }
    paths.add(skillPath);
  }
  const declaredPaths = new Set(
    declared
      .filter((item): item is DeclaredSkillItem => !isTemplateItem(item))
      .map((item) => item.skillPath),
  );
  const undeclared = [...paths].filter((path) => !declaredPaths.has(path)).sort();
  if (undeclared.length > 0) {
    return refuse(
      "plugin-skill-undeclared",
      `${manifestPath} lists undeclared skill(s): ${undeclared.join(", ")}`,
      { paths: undeclared },
    );
  }
  return paths;
}
