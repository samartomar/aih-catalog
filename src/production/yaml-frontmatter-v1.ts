/**
 * A strict subset of YAML 1.2 for upstream Markdown frontmatter. Catalog has no
 * runtime dependencies, so production parses only the shapes pinned upstream
 * sources actually use and fails closed on anything else (anchors, tags, nested
 * mappings, flow mappings, tabs, duplicate keys).
 */

export type YamlScalarV1 = string | number | boolean | null;
export type YamlValueV1 = YamlScalarV1 | YamlScalarV1[];

const KEY = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)[ ]*:(?:[ ]+(.*))?$/u;
const RESERVED_PLAIN_START = /^[&*!{}|>%@`,\]]/u;

function fail(label: string, detail: string): never {
  throw new TypeError(`${label} has unsupported YAML frontmatter: ${detail}`);
}

function indentation(line: string): number {
  return line.length - line.trimStart().length;
}

function stripComment(value: string): string {
  const index = value.search(/[ ]#/u);
  return (index === -1 ? value : value.slice(0, index)).trimEnd();
}

function resolvePlain(value: string): YamlScalarV1 {
  if (/^(?:null|Null|NULL|~)?$/u.test(value)) return null;
  if (/^(?:true|True|TRUE)$/u.test(value)) return true;
  if (/^(?:false|False|FALSE)$/u.test(value)) return false;
  if (/^[-+]?[0-9]+$/u.test(value)) return Number.parseInt(value, 10);
  if (/^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/u.test(value))
    return Number.parseFloat(value);
  return value;
}

const ESCAPES: Readonly<Record<string, string>> = {
  "0": "\0",
  a: "\x07",
  b: "\b",
  t: "\t",
  "\t": "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1b",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  N: "\u0085",
  _: String.fromCharCode(0xa0),
  L: String.fromCharCode(0x2028),
  P: String.fromCharCode(0x2029),
};

function foldQuotedLines(lines: readonly string[]): string {
  let result = "";
  let pendingBreaks = 0;
  lines.forEach((raw, index) => {
    const line =
      index === 0 ? raw.trimEnd() : index === lines.length - 1 ? raw.trimStart() : raw.trim();
    if (index > 0 && line === "" && index < lines.length - 1) {
      pendingBreaks += 1;
      return;
    }
    if (index > 0) result += pendingBreaks > 0 ? "\n".repeat(pendingBreaks) : " ";
    pendingBreaks = 0;
    result += line;
  });
  return result;
}

function doubleQuoted(body: string, label: string): string {
  let result = "";
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] as string;
    if (character !== "\\") {
      result += character;
      continue;
    }
    const next = body[index + 1];
    if (next === undefined) fail(label, "dangling escape");
    const hex = next === "x" ? 2 : next === "u" ? 4 : next === "U" ? 8 : 0;
    if (hex > 0) {
      const digits = body.slice(index + 2, index + 2 + hex);
      if (!/^[0-9A-Fa-f]+$/u.test(digits) || digits.length !== hex) fail(label, "bad escape");
      result += String.fromCodePoint(Number.parseInt(digits, 16));
      index += 1 + hex;
      continue;
    }
    const escaped = ESCAPES[next];
    if (escaped === undefined) fail(label, `unknown escape \\${next}`);
    result += escaped;
    index += 1;
  }
  return result;
}

/** Collect a quoted scalar that may continue on following lines. */
function quotedScalar(
  first: string,
  rest: readonly string[],
  quote: '"' | "'",
  label: string,
): { value: string; consumed: number; trailing: string } {
  const lines = [first.slice(1)];
  let consumed = 0;
  for (;;) {
    const joined = lines.join("\n");
    const end = findClosingQuote(joined, quote);
    if (end !== -1) {
      const trailing = stripComment(joined.slice(end + 1)).trim();
      const bodyLines = joined.slice(0, end).split("\n");
      const folded = foldQuotedLines(bodyLines);
      const value = quote === '"' ? doubleQuoted(folded, label) : folded.replaceAll("''", "'");
      return { value, consumed, trailing };
    }
    const next = rest[consumed];
    if (next === undefined) fail(label, "unterminated quoted scalar");
    lines.push(next);
    consumed += 1;
  }
}

function findClosingQuote(value: string, quote: '"' | "'"): number {
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"' && character === "\\") {
      index += 1;
      continue;
    }
    if (character !== quote) continue;
    if (quote === "'" && value[index + 1] === "'") {
      index += 1;
      continue;
    }
    return index;
  }
  return -1;
}

function scalarItem(raw: string, label: string): YamlScalarV1 {
  const value = raw.trim();
  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0] as '"' | "'";
    const parsed = quotedScalar(value, [], quote, label);
    if (parsed.trailing !== "") fail(label, "text after quoted scalar");
    return parsed.value;
  }
  if (RESERVED_PLAIN_START.test(value) || value.startsWith("[") || /:(?: |$)/u.test(value))
    fail(label, `unsupported scalar ${value}`);
  return resolvePlain(stripComment(value));
}

function flowSequence(raw: string, label: string): YamlScalarV1[] {
  const value = stripComment(raw);
  if (!value.endsWith("]")) fail(label, "unterminated flow sequence");
  const body = value.slice(1, -1).trim();
  if (body === "") return [];
  const items: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] as string;
    if (quote !== undefined) {
      current += character;
      if (quote === '"' && character === "\\") {
        current += body[index + 1] ?? "";
        index += 1;
      } else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    if (character === "[" || character === "{") fail(label, "nested flow collection");
    if (character === ",") {
      items.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (quote !== undefined) fail(label, "unterminated quoted flow item");
  if (current.trim() !== "") items.push(current);
  return items.map((item) => scalarItem(item, label));
}

function blockScalar(header: string, rest: readonly string[], label: string) {
  const match = /^([|>])([-+]?)$/u.exec(stripComment(header));
  if (match === null) fail(label, `unsupported block scalar header ${header}`);
  const [, style, chomp] = match;
  let consumed = 0;
  const lines: string[] = [];
  let indent: number | undefined;
  while (consumed < rest.length) {
    const line = rest[consumed] as string;
    if (line.trim() === "") {
      lines.push("");
      consumed += 1;
      continue;
    }
    const current = indentation(line);
    if (current === 0) break;
    indent ??= current;
    if (current < indent) fail(label, "under-indented block scalar");
    lines.push(line.slice(indent));
    consumed += 1;
  }
  let trailingBlank = 0;
  while (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
    trailingBlank += 1;
  }
  let value: string;
  if (style === "|") value = lines.join("\n");
  else {
    value = "";
    lines.forEach((line, index) => {
      if (index === 0) value = line;
      else if (line === "" || lines[index - 1] === "") value += `\n${line}`;
      else if (line.startsWith(" ") || (lines[index - 1] ?? "").startsWith(" "))
        value += `\n${line}`;
      else value += ` ${line}`;
    });
  }
  if (chomp === "-") return { value, consumed };
  if (chomp === "+") return { value: `${value}\n${"\n".repeat(trailingBlank)}`, consumed };
  return { value: lines.length === 0 ? "" : `${value}\n`, consumed };
}

/**
 * Record a mapping entry as an own data property: plain assignment would send
 * `__proto__` to the prototype setter and lose the key, so a reader could not
 * see it and refuse it as unknown.
 */
function setOwn(result: Record<string, YamlValueV1>, key: string, value: YamlValueV1): void {
  Object.defineProperty(result, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Parse frontmatter text (without the `---` fences) into a flat mapping. */
export function parseYamlFrontmatterV1(source: string, label: string): Record<string, YamlValueV1> {
  if (source.includes("\t")) fail(label, "tab character");
  const lines = source.split(/\r?\n/u);
  const result: Record<string, YamlValueV1> = {};
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as string;
    index += 1;
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (indentation(line) !== 0) fail(label, "unexpected indentation");
    const match = KEY.exec(line.trimEnd());
    if (match === null) fail(label, `unsupported line ${line}`);
    const key = match[1] as string;
    if (Object.hasOwn(result, key)) fail(label, `duplicate key ${key}`);
    const raw = (match[2] ?? "").trim();
    const rest = lines.slice(index);
    if (raw === "" || raw.startsWith("#")) {
      const items: YamlScalarV1[] = [];
      let sawItem = false;
      while (index < lines.length) {
        const next = lines[index] as string;
        if (next.trim() === "") {
          index += 1;
          continue;
        }
        const item = /^([ ]*)-(?:[ ]+(.*))?$/u.exec(next);
        if (item === null) break;
        sawItem = true;
        items.push(scalarItem(item[2] ?? "", label));
        index += 1;
      }
      if (!sawItem && index < lines.length && indentation(lines[index] as string) > 0)
        fail(label, `nested mapping under ${key}`);
      setOwn(result, key, sawItem ? items : null);
      continue;
    }
    if (raw.startsWith('"') || raw.startsWith("'")) {
      const parsed = quotedScalar(raw, rest, raw[0] as '"' | "'", label);
      if (parsed.trailing !== "") fail(label, `text after quoted scalar for ${key}`);
      setOwn(result, key, parsed.value);
      index += parsed.consumed;
      continue;
    }
    if (raw.startsWith("[")) {
      setOwn(result, key, flowSequence(raw, label));
      continue;
    }
    if (raw.startsWith("|") || raw.startsWith(">")) {
      const parsed = blockScalar(raw, rest, label);
      setOwn(result, key, parsed.value);
      index += parsed.consumed;
      continue;
    }
    if (RESERVED_PLAIN_START.test(raw) || raw.startsWith("- ") || raw === "-")
      fail(label, `unsupported value for ${key}`);
    const parts = [stripComment(raw)];
    let comment = raw !== parts[0] && /[ ]#/u.test(raw);
    while (index < lines.length) {
      const next = lines[index] as string;
      if (next.trim() !== "" && indentation(next) === 0) break;
      if (
        next.trim() === "" &&
        !lines.slice(index).some((l) => l.trim() !== "" && indentation(l) > 0)
      )
        break;
      if (comment && next.trim() !== "") fail(label, `comment inside plain scalar ${key}`);
      parts.push(next.trim() === "" ? "" : stripComment(next.trim()));
      if (/[ ]#/u.test(next.trim())) comment = true;
      index += 1;
    }
    for (const part of parts)
      if (/:(?: |$)/u.test(part)) fail(label, `mapping indicator inside plain scalar ${key}`);
    let value = "";
    parts.forEach((part, partIndex) => {
      if (partIndex === 0) value = part;
      else if (part === "") value += "\n";
      else value += value.endsWith("\n") ? part : ` ${part}`;
    });
    setOwn(result, key, parts.length === 1 ? resolvePlain(value) : value);
  }
  return result;
}

/** Split a Markdown document into its leading frontmatter text and body. */
export function markdownFrontmatterV1(
  markdown: string,
  label: string,
): { frontmatter: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(markdown);
  if (match === null) throw new TypeError(`${label} has no YAML frontmatter`);
  return { frontmatter: match[1] as string, body: markdown.slice(match[0].length) };
}
