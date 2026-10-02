import { ID, isRecord, safeMemberPath } from "../release/document.js";
import type { AuthoredAllowance } from "./authored.js";
import { refuse } from "./errors.js";
import { REPOSITORY } from "./tree.js";

/**
 * The maintainer-authored list of what the producer may carry. It names the
 * upstream repositories and the items built from them; it is data, never a
 * permission for an arbitrary author. Unknown keys are refused.
 */
export interface DeclaredSource {
  readonly id: string;
  /** `owner/name` on github.com. */
  readonly repository: string;
  readonly licensePath: string;
  /** SPDX identifier of the license text at `licensePath`. */
  readonly license: string;
}

export interface DeclaredItem {
  readonly id: string;
  readonly source: string;
  /** Directory that receives the skill: the name of the directory holding SKILL.md. */
  readonly entry: string;
  readonly label: string;
  readonly skillPath: string;
  /** Same-release required item ids. */
  readonly requires: readonly string[];
}

export interface ProducerDeclaration {
  readonly sources: readonly DeclaredSource[];
  readonly items: readonly DeclaredItem[];
  /** Declared allowances for Catalog-authored content; empty when the key is absent. */
  readonly authored: readonly AuthoredAllowance[];
  /**
   * Project-relative directory that receives the generated shared project context;
   * {@link DEFAULT_INSTRUCTION_DIRECTORY} when the key is absent.
   */
  readonly instructionDirectory: string;
}

export const DECLARATION_FORMAT = "aihq-catalog-producer-declaration";
const ENTRY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SPDX = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/;
const PLACEHOLDER_MAX = 64;

/** The instruction directory a release carries when the declaration names none. */
export const DEFAULT_INSTRUCTION_DIRECTORY = "ai-coding";
const INSTRUCTION_DIRECTORY_MAX = 128;
/**
 * Portable segment characters that stay literal inside Markdown code spans, YAML
 * frontmatter and Kiro `#[[file:...]]` references; a leading `-` reads as an option.
 */
const INSTRUCTION_SEGMENT = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;

/**
 * Why `value` cannot be the instruction directory, or undefined when it can: a safe
 * project-relative member path (no absolute, drive, backslash, empty, `.` or `..`
 * segment, trailing dot or space, control character, non-NFC text or reserved device
 * name), at most 128 characters of portable segment characters, never inside `.git`.
 */
export function instructionDirectoryProblem(value: unknown): string | undefined {
  if (typeof value !== "string") return "must be a string";
  if (value.length === 0 || value.length > INSTRUCTION_DIRECTORY_MAX) {
    return `must be 1-${INSTRUCTION_DIRECTORY_MAX} characters`;
  }
  if (!safeMemberPath(value)) {
    return "must be a safe project-relative path without absolute, drive, backslash, empty, '.' or '..' segments";
  }
  for (const segment of value.split("/")) {
    if (!INSTRUCTION_SEGMENT.test(segment)) {
      return `segment ${JSON.stringify(segment)} is unsupported: use letters, digits, '.', '_' and '-' (not leading)`;
    }
    if (segment.toLowerCase() === ".git") return "must not name a .git directory";
  }
  return undefined;
}

function keys(
  value: unknown,
  required: readonly string[],
  at: string,
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) return refuse("declaration-invalid", `${at} must be an object`);
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      refuse("declaration-invalid", `${at} has unknown key ${key}`);
    }
  }
  for (const key of required) {
    if (!(key in value)) refuse("declaration-invalid", `${at} lacks ${key}`);
  }
  return value;
}

function text(value: unknown, pattern: RegExp, at: string): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    return refuse("declaration-invalid", `${at} is malformed`);
  }
  return value;
}

function path(value: unknown, at: string): string {
  if (!safeMemberPath(value)) return refuse("declaration-invalid", `${at} is not a safe path`);
  return value;
}

/** The optional authored-content allowances, validated and ordered by source id. */
function parseAuthored(value: unknown): readonly AuthoredAllowance[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    return refuse("declaration-invalid", "declaration/authored must be an array");
  }
  const entries = value.map((raw, index): AuthoredAllowance => {
    const at = `authored/${index}`;
    const entry = keys(raw, ["source", "externalPaths", "templatePlaceholders"], at);
    const source = text(entry.source, ID, `${at}/source`);
    if (!Array.isArray(entry.externalPaths)) {
      refuse("declaration-invalid", `${at}/externalPaths must be an array`);
    }
    const externalPaths = (entry.externalPaths as unknown[]).map((item, position) =>
      path(item, `${at}/externalPaths/${position}`),
    );
    if (new Set(externalPaths).size !== externalPaths.length) {
      refuse("declaration-invalid", `${at}/externalPaths has duplicates`);
    }
    if (!Array.isArray(entry.templatePlaceholders)) {
      refuse("declaration-invalid", `${at}/templatePlaceholders must be an array`);
    }
    const templatePlaceholders = (entry.templatePlaceholders as unknown[]).map((item, position) => {
      if (
        typeof item !== "string" ||
        item.length === 0 ||
        item.length > PLACEHOLDER_MAX ||
        /\s/u.test(item)
      ) {
        return refuse("declaration-invalid", `${at}/templatePlaceholders/${position} is malformed`);
      }
      return item;
    });
    if (new Set(templatePlaceholders).size !== templatePlaceholders.length) {
      refuse("declaration-invalid", `${at}/templatePlaceholders has duplicates`);
    }
    return { source, externalPaths, templatePlaceholders };
  });
  if (new Set(entries.map((entry) => entry.source)).size !== entries.length) {
    refuse("declaration-invalid", "authored sources must be unique");
  }
  return [...entries].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
}

/** The optional instruction directory; the default when the key is absent. */
function parseInstructionDirectory(value: unknown): string {
  if (value === undefined) return DEFAULT_INSTRUCTION_DIRECTORY;
  const problem = instructionDirectoryProblem(value);
  if (problem !== undefined) {
    return refuse("declaration-invalid", `declaration/instructionDirectory ${problem}`);
  }
  return value as string;
}

/** Strictly parses declaration bytes (or an already parsed value). */
export function parseDeclaration(input: Uint8Array | unknown): ProducerDeclaration {
  let value: unknown = input;
  if (input instanceof Uint8Array) {
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input));
    } catch {
      return refuse("declaration-invalid", "the declaration is not UTF-8 JSON");
    }
  }
  const top = keys(value, ["format", "version", "sources", "items"], "declaration", [
    "authored",
    "instructionDirectory",
  ]);
  if (top.format !== DECLARATION_FORMAT || top.version !== 1) {
    return refuse("declaration-invalid", "unsupported declaration format or version");
  }
  if (!Array.isArray(top.sources) || !Array.isArray(top.items)) {
    return refuse("declaration-invalid", "sources and items must be arrays");
  }
  // Checked first: an allowance moved with an inadmissible directory is refused for it.
  const instructionDirectory = parseInstructionDirectory(top.instructionDirectory);
  const sources = top.sources.map((raw, index): DeclaredSource => {
    const at = `sources/${index}`;
    const source = keys(raw, ["id", "repository", "licensePath", "license"], at);
    return {
      id: text(source.id, ID, `${at}/id`),
      repository: text(source.repository, REPOSITORY, `${at}/repository`),
      licensePath: path(source.licensePath, `${at}/licensePath`),
      license: text(source.license, SPDX, `${at}/license`),
    };
  });
  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    refuse("declaration-invalid", "source ids must be unique");
  }
  if (new Set(sources.map((source) => source.repository.toLowerCase())).size !== sources.length) {
    refuse("declaration-invalid", "one source per repository");
  }
  const items = top.items.map((raw, index): DeclaredItem => {
    const at = `items/${index}`;
    const item = keys(raw, ["id", "source", "label", "skillPath", "requires"], at);
    if (!Array.isArray(item.requires)) refuse("declaration-invalid", `${at}/requires`);
    const requires = (item.requires as unknown[]).map((id, position) =>
      text(id, ID, `${at}/requires/${position}`),
    );
    if (new Set(requires).size !== requires.length) {
      refuse("declaration-invalid", `${at}/requires has duplicates`);
    }
    const label = item.label;
    if (typeof label !== "string" || label.length === 0 || label.length > 200) {
      refuse("declaration-invalid", `${at}/label`);
    }
    const skillPath = path(item.skillPath, `${at}/skillPath`);
    const segments = skillPath.split("/");
    const entry = segments[segments.length - 2] ?? "";
    if (segments[segments.length - 1] !== "SKILL.md" || !ENTRY.test(entry)) {
      refuse("declaration-invalid", `${at}/skillPath must be <dir>/SKILL.md`);
    }
    return {
      id: text(item.id, ID, `${at}/id`),
      source: text(item.source, ID, `${at}/source`),
      entry,
      label: label as string,
      skillPath,
      requires: [...requires].sort(),
    };
  });
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) refuse("declaration-invalid", "item ids must be unique");
  const known = new Set(sources.map((source) => source.id));
  for (const item of items) {
    if (!known.has(item.source)) {
      refuse("declaration-invalid", `item ${item.id} names unknown source ${item.source}`);
    }
    for (const required of item.requires) {
      if (required === item.id || !ids.has(required)) {
        refuse("declaration-invalid", `item ${item.id} requires unknown item ${required}`);
      }
    }
  }
  const entries = items.map((item) => `${item.source}/${item.entry}`);
  if (new Set(entries).size !== entries.length) {
    refuse("declaration-invalid", "two items would write the same skill directory");
  }
  assertAcyclic(items);
  return {
    sources,
    items: [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    authored: parseAuthored(top.authored),
    instructionDirectory,
  };
}

/** Throws unless the declared required-dependency graph is acyclic. */
export function assertAcyclic(items: readonly { id: string; requires: readonly string[] }[]): void {
  const edges = new Map(items.map((item) => [item.id, item.requires]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      refuse(
        "dependency-cycle",
        `required dependencies form a cycle: ${[...trail, id].join(" -> ")}`,
      );
    }
    state.set(id, "visiting");
    for (const next of edges.get(id) ?? []) visit(next, [...trail, id]);
    state.set(id, "done");
  };
  for (const id of edges.keys()) visit(id, []);
}
