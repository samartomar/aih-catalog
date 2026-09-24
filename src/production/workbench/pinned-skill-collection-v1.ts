import { Buffer } from "node:buffer";
import {
  assertSafeRelativePosixPathV1,
  assertStrictJsonValueV1,
  canonicalStrictJsonBytesV1,
  sha256HexV1,
} from "../strict-json-v1.js";
import { exactKeys, list, literal, record, text } from "../validate-v1.js";
import { parseYamlFrontmatterV1 } from "../yaml-frontmatter-v1.js";
import type { CompiledDeclarationV1 } from "./compiler-formats-v1.js";
import type { CompilerAssetDeclarationV1 } from "./contracts-v1.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SOURCE_ID = /^[a-z][a-z0-9-]*$/;
const REPOSITORY = /^https:\/\/[a-z0-9.-]+\/[A-Za-z0-9._/-]+$/;

export interface PinnedFileV1 {
  path: string;
  bytesBase64: string;
  sha256: string;
}
export interface PinnedSkillCollectionInputV1 {
  version: "pinned-skill-collection/v1";
  source: { id: string; repository: string; commit: string; version: string };
  license: PinnedFileV1;
  skills: { id: string; files: PinnedFileV1[] }[];
  collectionDigest: string;
}
export interface CompiledPinnedSkillCollectionV1 {
  source: {
    id: string;
    revisionId: string;
    contentDigest: string;
    repository: string;
    inputFormat: "pinned-skill-collection/v1";
  };
  declarations: CompiledDeclarationV1[];
  detailBytes: Record<string, string>;
}

function digest(bytes: Uint8Array | string): string {
  return `sha256:${sha256HexV1(bytes)}`;
}

/** Canonical base64 of valid UTF-8 bytes. */
export function canonicalUtf8Base64V1(value: string, label: string): Buffer {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) {
    throw new TypeError(`${label} must be canonical base64`);
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!Buffer.from(decoded, "utf8").equals(bytes)) throw new Error("non-canonical UTF-8");
  } catch {
    throw new TypeError(`${label} must contain valid UTF-8`);
  }
  return bytes;
}

function pinnedFile(value: unknown, label: string): PinnedFileV1 {
  const file = exactKeys(record(value, label), ["path", "bytesBase64", "sha256"], label);
  text(file.path, `${label} path`);
  text(file.bytesBase64, `${label} bytes`);
  text(file.sha256, `${label} sha256`);
  return file as unknown as PinnedFileV1;
}

function parseInput(value: unknown): PinnedSkillCollectionInputV1 {
  const input = exactKeys(
    record(value, "pinned skill collection input"),
    ["version", "source", "license", "skills", "collectionDigest"],
    "pinned skill collection input",
  );
  literal(input.version, "pinned-skill-collection/v1", "pinned skill collection version");
  const source = exactKeys(
    record(input.source, "pinned skill collection source"),
    ["id", "repository", "commit", "version"],
    "pinned skill collection source",
  );
  text(source.id, "source id", SOURCE_ID);
  text(source.repository, "source repository", REPOSITORY);
  text(source.commit, "source commit", COMMIT);
  text(source.version, "source version", /^\d+\.\d+\.\d+$/);
  pinnedFile(input.license, "license");
  for (const skill of list(input.skills, "skills", 1, 1_000)) {
    const item = exactKeys(record(skill, "skill"), ["id", "files"], "skill");
    text(item.id, "skill id", SOURCE_ID);
    for (const file of list(item.files, "skill files", 1)) pinnedFile(file, "skill file");
  }
  text(input.collectionDigest, "collection digest", SHA256);
  return input as unknown as PinnedSkillCollectionInputV1;
}

const byPath = (left: PinnedFileV1, right: PinnedFileV1) => left.path.localeCompare(right.path);

function recordDigest(skill: { id: string; files: readonly PinnedFileV1[] }): string {
  return digest(canonicalStrictJsonBytesV1({ id: skill.id, files: [...skill.files].sort(byPath) }));
}

export function pinnedSkillCollectionDigestV1(
  input: Omit<PinnedSkillCollectionInputV1, "collectionDigest">,
): string {
  return digest(
    canonicalStrictJsonBytesV1({
      ...input,
      skills: [...input.skills].sort((left, right) => left.id.localeCompare(right.id)),
    }),
  );
}

function validateFile(file: PinnedFileV1, label: string): void {
  assertSafeRelativePosixPathV1(file.path, `${label} path`);
  if (!SHA256.test(file.sha256)) throw new TypeError(`${label} has invalid SHA-256`);
  const bytes = canonicalUtf8Base64V1(file.bytesBase64, label);
  if (digest(bytes) !== file.sha256) throw new TypeError(`${label} digest mismatch`);
}

function entryForSkill(skillId: string, files: readonly PinnedFileV1[]): PinnedFileV1 {
  const entries = files.filter((file) => file.path.endsWith("/SKILL.md"));
  const entry = entries[0];
  if (entries.length !== 1 || entry === undefined) {
    throw new TypeError(`pinned skill ${skillId} must contain exactly one SKILL.md`);
  }
  const directory = entry.path.slice(0, -"/SKILL.md".length);
  if (!files.every((file) => file.path === entry.path || file.path.startsWith(`${directory}/`))) {
    throw new TypeError(`pinned skill ${skillId} has a resource outside its directory`);
  }
  return entry;
}

function frontmatterForSkill(source: string, label: string): { name: string; description: string } {
  const lines = source.split(/\r?\n/u);
  if (lines[0] !== "---") throw new TypeError(`${label} is missing YAML frontmatter`);
  const closing = lines.indexOf("---", 1);
  if (closing < 1) throw new TypeError(`${label} has unterminated YAML frontmatter`);
  const value = parseYamlFrontmatterV1(lines.slice(1, closing).join("\n"), label);
  if (
    typeof value.name !== "string" ||
    value.name.length === 0 ||
    typeof value.description !== "string" ||
    value.description.length === 0
  ) {
    throw new TypeError(`${label} frontmatter requires non-empty name and description`);
  }
  return { name: value.name, description: value.description };
}

/**
 * Compiles a closed, byte-pinned skill collection. Source identity is generic;
 * providers own any source-specific pins. This format declares no actions,
 * projectors, evidence, relations, groups, or templates.
 */
export function compilePinnedSkillCollectionV1(
  inputValue: unknown,
): CompiledPinnedSkillCollectionV1 {
  assertStrictJsonValueV1(inputValue, "pinned skill collection input");
  const input = parseInput(inputValue);
  const { collectionDigest, license, skills, source, version } = input;
  if (collectionDigest !== pinnedSkillCollectionDigestV1({ version, source, license, skills })) {
    throw new TypeError("pinned skill collection digest mismatch");
  }
  validateFile(license, "pinned skill collection license");
  if (license.path !== "LICENSE") {
    throw new TypeError("pinned skill collection license path must be LICENSE");
  }

  const ids = new Set<string>();
  const paths = new Set<string>([license.path]);
  const declarations: CompiledDeclarationV1[] = [];
  const detailBytes: Record<string, string> = {};
  for (const skill of skills) {
    if (ids.has(skill.id)) {
      throw new TypeError(`pinned skill collection duplicates skill ${skill.id}`);
    }
    ids.add(skill.id);
    const files = [...skill.files].sort(byPath);
    for (const file of files) {
      if (paths.has(file.path)) {
        throw new TypeError(`pinned skill collection duplicates file ${file.path}`);
      }
      paths.add(file.path);
      validateFile(file, `pinned skill ${skill.id}`);
    }
    const entry = entryForSkill(skill.id, files);
    const markdown = new TextDecoder("utf-8", { fatal: true }).decode(
      canonicalUtf8Base64V1(entry.bytesBase64, `pinned skill ${skill.id}`),
    );
    const frontmatter = frontmatterForSkill(markdown, `pinned skill ${skill.id}`);
    if (frontmatter.name !== skill.id) {
      throw new TypeError(`pinned skill ${skill.id} has mismatched frontmatter name`);
    }

    const contentDigest = recordDigest({ id: skill.id, files });
    const id = `${source.id}/skill:${skill.id}`;
    const detailChunkId = `detail:${id}`;
    detailBytes[detailChunkId] = canonicalStrictJsonBytesV1({
      version: "pinned-skill-collection-detail/v1",
      collectionDigest,
      source,
      skill: {
        id: skill.id,
        description: frontmatter.description,
        contentDigest,
        entryPath: entry.path,
        files: files.map((file) => ({
          path: file.path,
          sha256: file.sha256,
          sizeBytes: canonicalUtf8Base64V1(file.bytesBase64, `pinned skill ${skill.id}`).length,
        })),
      },
      license: {
        path: license.path,
        sha256: license.sha256,
        sizeBytes: canonicalUtf8Base64V1(license.bytesBase64, "pinned skill collection license")
          .length,
      },
    }).toString("utf8");
    const declaration: CompilerAssetDeclarationV1 = {
      id,
      sourceId: `source:${source.id}`,
      sourceRevisionId: source.commit,
      contentDigest,
      originalPath: entry.path,
      derivation: "upstream",
      kind: "skill",
      label: skill.id,
      detailChunkId,
      declaredHostCapabilities: [],
    };
    declarations.push({ declaration, inputFormat: version });
  }

  return {
    source: {
      id: `source:${source.id}`,
      revisionId: source.commit,
      contentDigest: collectionDigest,
      repository: source.repository,
      inputFormat: version,
    },
    declarations,
    detailBytes,
  };
}
