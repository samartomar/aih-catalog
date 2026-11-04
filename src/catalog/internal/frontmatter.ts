/**
 * Markdown frontmatter for skills and rules: bounded reading, and the only edits a render
 * may make: set top-level keys and reword `$ARGUMENTS` in the body. Every edit is
 * line-based so the rest of the upstream bytes, including unknown frontmatter, is kept.
 */
import { parseDocument } from "yaml";
import { canonicalJson } from "./json.js";

const fatalUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export interface Split {
  /** The YAML text between the fences, without the fence lines; null when there is none. */
  readonly yaml: string | null;
  /** Everything after the closing fence line (or the whole text without frontmatter). */
  readonly body: string;
  readonly eol: "\n" | "\r\n";
}

export type Frontmatter = Readonly<Record<string, unknown>>;

export function decodeText(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return null;
  try {
    return fatalUtf8.decode(bytes);
  } catch {
    return null;
  }
}

export function splitFrontmatter(text: string): Split {
  const eol = text.startsWith("---\r\n") ? "\r\n" : "\n";
  if (!text.startsWith(`---${eol}`)) return { yaml: null, body: text, eol };
  const rest = text.slice(3 + eol.length);
  const lines = rest.split(eol);
  let offset = 0;
  for (const line of lines) {
    if (line === "---" || line === "...") {
      const yaml = rest.slice(0, offset);
      const after = offset + line.length;
      const body = rest.slice(after).startsWith(eol)
        ? rest.slice(after + eol.length)
        : rest.slice(after);
      return { yaml: yaml.endsWith(eol) ? yaml.slice(0, -eol.length) : yaml, body, eol };
    }
    offset += line.length + eol.length;
  }
  return { yaml: null, body: text, eol };
}

/** Parses frontmatter YAML as one plain mapping: no aliases, tags or duplicate keys. */
export function parseFrontmatter(yaml: string | null): Frontmatter | string {
  if (yaml === null || yaml.trim() === "") return {};
  const document = parseDocument(yaml, {
    uniqueKeys: true,
    strict: true,
    prettyErrors: false,
    schema: "core",
  });
  if (document.errors.length > 0)
    return `frontmatter is not valid YAML: ${document.errors[0]?.message}`;
  if (document.warnings.length > 0)
    return `frontmatter YAML has warnings: ${document.warnings[0]?.message}`;
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    return `frontmatter cannot be read: ${(error as Error).message}`;
  }
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) return "frontmatter is not a mapping";
  try {
    canonicalJson(value);
  } catch {
    return "frontmatter holds values that are not plain data";
  }
  return value as Frontmatter;
}

const ARGUMENTS = "$ARGUMENTS";
export const REWORDED_ARGUMENTS = "the text the user typed after the command";

export const usesArguments = (body: string): boolean => body.includes(ARGUMENTS);
export const rewordArguments = (body: string): string =>
  body.replaceAll(ARGUMENTS, REWORDED_ARGUMENTS);

function scalar(value: unknown): string {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string" && /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(value)) {
    if (!/^(?:true|false|null|yes|no|on|off|~|[-+]?[0-9].*)$/i.test(value)) return value;
  }
  return JSON.stringify(value);
}

/** Replaces or appends top-level `key: value` lines in the YAML text, keeping every other line. */
function setKeys(yaml: string, eol: string, set: Frontmatter): string {
  const lines = yaml === "" ? [] : yaml.split(eol);
  for (const key of Object.keys(set).sort()) {
    const line = `${key}: ${scalar(set[key])}`;
    const start = lines.findIndex((candidate) => {
      if (!candidate.startsWith(key)) return false;
      return /^\s*:/.test(candidate.slice(key.length));
    });
    if (start === -1) {
      lines.push(line);
      continue;
    }
    let end = start + 1;
    while (end < lines.length && /^(?:[ \t]|$)/.test(lines[end] as string)) end += 1;
    while (end > start + 1 && (lines[end - 1] as string).trim() === "") end -= 1;
    lines.splice(start, end - start, line);
  }
  return lines.join(eol);
}

export type Edit = { readonly set: Frontmatter; readonly reword: boolean };

/**
 * Applies a render edit and checks the render guard on the result: the body equals the source
 * body (after the permitted `$ARGUMENTS` rewording) and the frontmatter equals the source
 * frontmatter with exactly the set keys changed. Returns the text or a reason.
 */
export function applyEdit(text: string, edit: Edit): { text: string } | { reason: string } {
  const split = splitFrontmatter(text);
  const before = parseFrontmatter(split.yaml);
  if (typeof before === "string") return { reason: before };
  const body = edit.reword ? rewordArguments(split.body) : split.body;
  const keys = Object.keys(edit.set);
  let output: string;
  if (keys.length === 0)
    output =
      split.yaml === null ? body : `---${split.eol}${split.yaml}${split.eol}---${split.eol}${body}`;
  else {
    const yaml = setKeys(split.yaml ?? "", split.eol, edit.set);
    output = `---${split.eol}${yaml}${split.eol}---${split.eol}${body}`;
  }
  if (keys.length === 0 && !edit.reword) output = text;
  const check = splitFrontmatter(output);
  const after = parseFrontmatter(check.yaml);
  if (typeof after === "string") return { reason: `render guard: ${after}` };
  if (check.body !== body)
    return { reason: "render guard: the body changed beyond the permitted rewording" };
  if (canonicalJson(after) !== canonicalJson({ ...before, ...edit.set })) {
    return { reason: "render guard: frontmatter changed beyond the set keys" };
  }
  return { text: output };
}
