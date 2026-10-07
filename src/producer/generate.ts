import { createHash } from "node:crypto";
import type { Json } from "../release/contracts.js";
import { canonicalJson } from "../release/json.js";
import type { DeclaredItem, DeclaredSource } from "./declaration.js";
import { refuse } from "./errors.js";

export const OUTPUT_ROOT = "release";
export const RELEASE_PATH = `${OUTPUT_ROOT}/release.json`;
/** The optional 1.1 release of Core recipe 1.1 items, published beside the 1.0 release. */
export const HOOK_RELEASE_PATH = `${OUTPUT_ROOT}/release-1.1.json`;
const RECIPE_SCHEMA = "urn:aihq:core:recipe:1.0.0";
const utf8 = new TextDecoder("utf-8", { fatal: true });

export const sha256Hex = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Canonical JSON plus the single LF terminator that release and recipe documents carry. */
export const documentBytes = (value: unknown): Buffer =>
  Buffer.from(`${canonicalJson(value)}\n`, "utf8");

const AGENT_DIRECTORY_INPUT: Json = {
  type: "string",
  required: true,
  default: ".claude",
  minLength: 1,
  maxLength: 64,
  description: "Project directory that receives skills/<name>/ (Claude Code reads .claude).",
};

/** Stable, collision-resistant recipe member id derived from one declared support path. */
export const supportMaterialId = (path: string): string => `support-${sha256Hex(path)}`;

export interface GeneratedSupportFile {
  readonly path: string;
  readonly bytes: Buffer;
}

export interface GeneratedMember {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly bytes: Buffer;
}

export interface GeneratedItem {
  /** The item record exactly as it appears in the release document. */
  readonly record: { [key: string]: Json };
  readonly recipePath: string;
  readonly recipeBytes: Buffer;
  readonly members: readonly GeneratedMember[];
}

/** Material location: addressed by repository, revision and upstream path. */
export const materialPath = (repository: string, revision: string, path: string): string =>
  `${OUTPUT_ROOT}/materials/github.com/${repository}/${revision}/${path}`;

/** The leading `---` frontmatter block of a Markdown skill file. */
export function leadingFrontmatter(markdown: string, path: string): string {
  const lines = markdown.split(/\r?\n/u);
  if (lines[0] !== "---") return refuse("skill-frontmatter", `${path} lacks frontmatter`);
  const closing = lines.indexOf("---", 1);
  if (closing < 1) return refuse("skill-frontmatter", `${path} has unterminated frontmatter`);
  return lines.slice(1, closing).join("\n");
}

function describe(skill: Buffer, path: string): string {
  let markdown: string;
  try {
    markdown = utf8.decode(skill);
  } catch {
    return refuse("skill-not-utf8", `${path} is not valid UTF-8`);
  }
  const description = /^description: (.+)$/m.exec(leadingFrontmatter(markdown, path))?.[1];
  if (description === undefined) {
    return refuse("skill-description", `${path} frontmatter has no description`);
  }
  return description;
}

const target = (name: string, file: string): Json => ({
  root: "project",
  segments: [
    { input: "agentDirectory" },
    { literal: "skills" },
    { literal: name },
    ...file.split("/").map((segment) => ({ literal: segment })),
  ],
});

/**
 * Builds one item (record, Core recipe and its two material members) from the
 * exact upstream bytes at one revision. Pure: no clock, network or filesystem.
 */
export function generateItem(args: {
  item: DeclaredItem;
  source: DeclaredSource;
  sourceId: string;
  revision: string;
  skill: Buffer;
  license: Buffer;
  supportFiles: readonly GeneratedSupportFile[];
}): GeneratedItem {
  const { item, source, sourceId, revision, skill, license, supportFiles } = args;
  const members: GeneratedMember[] = [
    {
      id: "license",
      path: materialPath(source.repository, revision, source.licensePath),
      sha256: sha256Hex(license),
      byteLength: license.length,
      bytes: license,
    },
    {
      id: "skill",
      path: materialPath(source.repository, revision, item.skillPath),
      sha256: sha256Hex(skill),
      byteLength: skill.length,
      bytes: skill,
    },
    ...supportFiles.map(
      ({ path, bytes }): GeneratedMember => ({
        id: supportMaterialId(path),
        path: materialPath(source.repository, revision, `${item.directory}/${path}`),
        sha256: sha256Hex(bytes),
        byteLength: bytes.length,
        bytes,
      }),
    ),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sha = (id: string) =>
    (members.find((member) => member.id === id) as GeneratedMember).sha256;
  const deliver = [
    { material: "skill", file: "SKILL.md", purpose: `Write the pinned ${item.entry} SKILL.md` },
    {
      material: "license",
      file: "LICENSE",
      purpose: `Write the upstream ${source.license} license notice beside the skill`,
    },
    ...supportFiles.map(({ path }): { material: string; file: string; purpose: string } => ({
      material: supportMaterialId(path),
      file: path,
      purpose: `Write the referenced ${item.entry} support file ${path}`,
    })),
  ];
  const recipe = {
    schema: RECIPE_SCHEMA,
    id: item.id,
    description: `Install the ${item.entry} skill from ${source.repository} at ${revision} with its ${source.license} license notice.`,
    inputs: { agentDirectory: AGENT_DIRECTORY_INPUT },
    materials: members
      .map(({ id, sha256, byteLength }) => ({ id, sha256, byteLength }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    targets: ["project"],
    prerequisites: [],
    operations: deliver.map((step) => ({
      id: `write-${step.material}`,
      purpose: step.purpose,
      kind: "file.write",
      scope: "project",
      target: target(item.entry, step.file),
      material: step.material,
      requires: [],
      checks: [`${step.material}-sha256`],
    })),
    checks: deliver.map((step) => ({
      id: `${step.material}-sha256`,
      purpose: `The installed ${step.file} has the pinned bytes`,
      kind: "file.sha256",
      target: target(item.entry, step.file),
      sha256: sha(step.material),
    })),
  };
  const recipePath = `${OUTPUT_ROOT}/recipes/${item.id}.json`;
  const recipeBytes = documentBytes(recipe);
  const record: { [key: string]: Json } = {
    id: item.id,
    label: item.label,
    description: describe(skill, item.skillPath),
    kind: "skill",
    sourceIds: [sourceId],
    targets: [],
    scopes: ["project"],
    inputs: { agentDirectory: AGENT_DIRECTORY_INPUT },
    recipe: {
      id: item.id,
      schema: RECIPE_SCHEMA,
      path: recipePath,
      sha256: sha256Hex(recipeBytes),
      byteLength: recipeBytes.length,
    },
    materials: members.map(({ id, path, sha256, byteLength }) => ({
      id,
      path,
      sha256,
      byteLength,
    })),
    dependencies: {
      requires: item.requires.map((itemId) => ({ itemId })),
      optional: [],
      conflicts: [],
    },
    metadata: {
      upstream: {
        path: item.skillPath,
        license: source.license,
        supportPaths: [...item.supportPaths],
      },
    },
  };
  return { record, recipePath, recipeBytes, members };
}
