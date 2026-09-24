/**
 * Reads the hook declarations an OpenCode plugin file exports, without running
 * it. OpenCode calls each exported plugin function and registers the members of
 * the object it returns as hooks, so the reading is: every export is either a
 * plugin function whose body returns exactly one object literal, inert text, or
 * a default export that only aliases a plugin already read; every member of the
 * returned object is a named function. Anything else fails closed: a hook this
 * reader cannot interpret is never dropped.
 */

export interface OpenCodePluginHookV1 {
  /** The export that returns the hook, for example `SuperpowersPlugin`. */
  plugin: string;
  /** The hook name OpenCode registers, for example `config`. */
  hook: string;
}

type TokenKind = "name" | "string" | "template" | "number" | "regex" | "punct";

interface Token {
  kind: TokenKind;
  /** Names, punctuators and numbers verbatim; strings decoded; templates and regexes raw. */
  value: string;
  offset: number;
}

type Fail = (reason: string) => never;

const REGEX_AFTER_WORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);
const PUNCTUATORS = ["...", "=>", "?."];
const OPEN = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);
const CLOSE = new Set([")", "]", "}"]);
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

function isNameStart(char: string): boolean {
  return /[\p{ID_Start}$_]/u.test(char);
}

function isNamePart(char: string): boolean {
  return /[\p{ID_Continue}$\u200c\u200d]/u.test(char);
}

/** The value of a quoted string literal's body (without its quotes). */
function decodeString(raw: string, fail: Fail): string {
  let value = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index] as string;
    if (char !== "\\") {
      value += char;
      continue;
    }
    index += 1;
    const next = raw[index] ?? "";
    if (Object.hasOwn(SIMPLE_ESCAPES, next)) value += SIMPLE_ESCAPES[next];
    else if (next === "0" && !/[0-9]/u.test(raw[index + 1] ?? "")) value += "\0";
    else if (next === "x" || next === "u") {
      const braced = next === "u" && raw[index + 1] === "{";
      const width = next === "x" ? 2 : 4;
      const digits = braced
        ? raw.slice(index + 2, raw.indexOf("}", index))
        : raw.slice(index + 1, index + 1 + width);
      if (!/^[0-9a-fA-F]+$/u.test(digits) || (!braced && digits.length !== width))
        fail(`a malformed \\${next} escape in a string literal`);
      const codePoint = Number.parseInt(digits, 16);
      if (codePoint > 0x10ffff) fail("an out-of-range escape in a string literal");
      value += String.fromCodePoint(codePoint);
      index += braced ? digits.length + 2 : digits.length;
    } else if (/[1-9]/u.test(next)) fail("a legacy octal escape in a string literal");
    else if (next === "\r") index += raw[index + 1] === "\n" ? 1 : 0;
    else if (next !== "\n" && next !== "\u2028" && next !== "\u2029") value += next;
  }
  return value;
}

/** A minimal ECMAScript tokenizer: enough to keep comments, strings, templates and regexes opaque. */
function tokenize(source: string, fail: Fail): Token[] {
  const skipQuoted = (start: number, quote: string): number => {
    let cursor = start + 1;
    while (cursor < source.length) {
      const char = source[cursor] as string;
      if (char === "\\") cursor += source.startsWith("\r\n", cursor + 1) ? 3 : 2;
      else if (char === quote) return cursor + 1;
      else if (char === "\n" || char === "\r") break;
      else cursor += 1;
    }
    return fail(`an unterminated string at offset ${start}`);
  };

  const skipTemplate = (start: number): number => {
    let cursor = start + 1;
    while (cursor < source.length) {
      const char = source[cursor] as string;
      if (char === "\\") cursor += 2;
      else if (char === "`") return cursor + 1;
      else if (char === "$" && source[cursor + 1] === "{") {
        // A substitution is ordinary code up to its matching brace; its tokens stay private.
        cursor = scan(cursor + 2, [], "}");
      } else cursor += 1;
    }
    return fail(`an unterminated template at offset ${start}`);
  };

  const skipRegex = (start: number): number => {
    let cursor = start + 1;
    let inClass = false;
    while (cursor < source.length) {
      const char = source[cursor] as string;
      if (char === "\\") cursor += 2;
      else if (char === "\n" || char === "\r") break;
      else if (inClass) {
        if (char === "]") inClass = false;
        cursor += 1;
      } else if (char === "[") {
        inClass = true;
        cursor += 1;
      } else if (char === "/") {
        cursor += 1;
        while (cursor < source.length && isNamePart(source[cursor] as string)) cursor += 1;
        return cursor;
      } else cursor += 1;
    }
    return fail(`an unterminated regular expression at offset ${start}`);
  };

  /** Tokenizes into `out` from `start`; with `until`, stops after the bracket that closes the region. */
  function scan(start: number, out: Token[], until?: string): number {
    const stack: string[] = [];
    const regexAllowed = (): boolean => {
      const previous = out.at(-1);
      if (previous === undefined) return true;
      if (previous.kind === "name") return REGEX_AFTER_WORDS.has(previous.value);
      if (previous.kind === "punct") return !CLOSE.has(previous.value);
      return false;
    };
    let cursor = start;
    while (cursor < source.length) {
      const char = source[cursor] as string;
      const next = source[cursor + 1];
      if (/\s/u.test(char)) {
        cursor += 1;
      } else if (char === "/" && next === "/") {
        const end = source.indexOf("\n", cursor);
        cursor = end === -1 ? source.length : end;
      } else if (char === "/" && next === "*") {
        const end = source.indexOf("*/", cursor + 2);
        if (end === -1) fail(`an unterminated comment at offset ${cursor}`);
        cursor = end + 2;
      } else if (char === "'" || char === '"') {
        const end = skipQuoted(cursor, char);
        const value = decodeString(source.slice(cursor + 1, end - 1), fail);
        out.push({ kind: "string", value, offset: cursor });
        cursor = end;
      } else if (char === "`") {
        const end = skipTemplate(cursor);
        out.push({ kind: "template", value: source.slice(cursor, end), offset: cursor });
        cursor = end;
      } else if (char === "/" && regexAllowed()) {
        const end = skipRegex(cursor);
        out.push({ kind: "regex", value: source.slice(cursor, end), offset: cursor });
        cursor = end;
      } else if (isNameStart(char) || (char === "#" && next !== undefined && isNameStart(next))) {
        let end = cursor + 1;
        while (end < source.length && isNamePart(source[end] as string)) end += 1;
        out.push({ kind: "name", value: source.slice(cursor, end), offset: cursor });
        cursor = end;
      } else if (
        /[0-9]/u.test(char) ||
        (char === "." && next !== undefined && /[0-9]/u.test(next))
      ) {
        let end = cursor + 1;
        while (end < source.length && /[\w.]/u.test(source[end] as string)) end += 1;
        out.push({ kind: "number", value: source.slice(cursor, end), offset: cursor });
        cursor = end;
      } else {
        const punctuator =
          PUNCTUATORS.find((candidate) => source.startsWith(candidate, cursor)) ?? char;
        if (OPEN.has(punctuator)) stack.push(OPEN.get(punctuator) as string);
        else if (CLOSE.has(punctuator)) {
          if (stack.length === 0 && until === punctuator) return cursor + 1;
          if (stack.pop() !== punctuator) fail(`an unbalanced ${punctuator} at offset ${cursor}`);
        }
        out.push({ kind: "punct", value: punctuator, offset: cursor });
        cursor += punctuator.length;
      }
    }
    if (until !== undefined) fail(`an unterminated template substitution before offset ${start}`);
    if (stack.length !== 0) fail(`an unclosed ${stack.at(-1)} at the end of the file`);
    return cursor;
  }

  const tokens: Token[] = [];
  scan(source.startsWith("#!") ? source.indexOf("\n") + 1 || source.length : 0, tokens);
  return tokens;
}

export function readOpenCodePluginHooksV1(source: string, path: string): OpenCodePluginHookV1[] {
  const fail: Fail = (reason) => {
    throw new TypeError(`${path}: this Catalog cannot interpret ${reason}`);
  };
  const tokens = tokenize(source, fail);
  const at = (index: number): Token | undefined => tokens[index];
  const is = (index: number, value: string, kind: TokenKind = "punct") =>
    at(index)?.kind === kind && at(index)?.value === value;
  const isOpen = (index: number) => at(index)?.kind === "punct" && OPEN.has(at(index)?.value ?? "");

  /** Index of the token that closes the bracket opened at `open` (the tokenizer checked balance). */
  const matching = (open: number): number => {
    let depth = 0;
    for (let index = open; index < tokens.length; index += 1) {
      const token = tokens[index] as Token;
      if (token.kind !== "punct") continue;
      if (OPEN.has(token.value)) depth += 1;
      else if (CLOSE.has(token.value)) {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return fail(`an unclosed bracket at offset ${at(open)?.offset}`);
  };

  /**
   * The function expression starting at `start` — `async? (params) =>`, `async? name =>`
   * or `async? function*? name? (params) {` — as its body's first token and the token
   * after it; undefined when `start` is not one.
   */
  const functionAt = (start: number): { body: number; end: number } | undefined => {
    let cursor = is(start, "async", "name") && !is(start + 1, "=>") ? start + 1 : start;
    if (is(cursor, "function", "name")) {
      cursor += 1;
      if (is(cursor, "*")) cursor += 1;
      if (at(cursor)?.kind === "name") cursor += 1;
      if (!is(cursor, "(")) return undefined;
      const body = matching(cursor) + 1;
      if (!is(body, "{")) return undefined;
      return { body, end: matching(body) + 1 };
    }
    if (is(cursor, "(")) cursor = matching(cursor) + 1;
    else if (at(cursor)?.kind === "name") cursor += 1;
    else return undefined;
    if (!is(cursor, "=>")) return undefined;
    const body = cursor + 1;
    if (is(body, "{") || is(body, "(")) return { body, end: matching(body) + 1 };
    return undefined;
  };

  /** The members of the object literal at `open` as token index ranges, split at top-level commas. */
  const members = (open: number): { start: number; end: number }[] => {
    const close = matching(open);
    const result: { start: number; end: number }[] = [];
    let start = open + 1;
    for (let index = open + 1; index <= close; index += 1) {
      if (index < close && isOpen(index)) index = matching(index);
      else if (index === close || is(index, ",")) {
        // Only the position before the closing brace may be empty (a trailing comma or `{}`).
        if (index > start) result.push({ start, end: index });
        else if (index !== close)
          fail(`an empty member in the object at offset ${at(open)?.offset}`);
        start = index + 1;
      }
    }
    return result;
  };

  const keyAt = (index: number): string | undefined => {
    const token = at(index);
    return token !== undefined && (token.kind === "name" || token.kind === "string")
      ? token.value
      : undefined;
  };

  /** The hook names of the object literal a plugin returns. */
  const hookObject = (open: number, plugin: string): OpenCodePluginHookV1[] =>
    members(open).map(({ start, end }) => {
      const describe = () => `the member at offset ${at(start)?.offset} of ${plugin}'s hooks`;
      // Method shorthand: `name(...) { }` or `async name(...) { }`.
      const method =
        is(start, "async", "name") && keyAt(start + 1) !== undefined && is(start + 2, "(") ? 1 : 0;
      const key = keyAt(start + method);
      if (key === undefined) return fail(describe());
      const after = start + method + 1;
      if (is(after, "(")) {
        const body = matching(after) + 1;
        if (!is(body, "{") || matching(body) !== end - 1) return fail(describe());
        return { plugin, hook: key };
      }
      if (method !== 0 || !is(after, ":")) return fail(describe());
      const fn = functionAt(after + 1);
      if (fn === undefined || fn.end !== end) return fail(describe());
      return { plugin, hook: key };
    });

  /** The single object literal a plugin function's body returns. */
  const pluginHooks = (
    plugin: string,
    fn: { body: number; end: number },
  ): OpenCodePluginHookV1[] => {
    if (is(fn.body, "(")) {
      if (!is(fn.body + 1, "{") || matching(fn.body + 1) !== fn.end - 2)
        return fail(`${plugin}, whose concise body is not an object literal`);
      return hookObject(fn.body + 1, plugin);
    }
    const returns: number[] = [];
    for (let index = fn.body + 1; index < fn.end - 1; index += 1) {
      if (is(index, "return", "name")) returns.push(index);
      else if (isOpen(index)) index = matching(index);
    }
    const [only] = returns;
    if (returns.length !== 1 || only === undefined || !is(only + 1, "{"))
      return fail(`${plugin}, whose body does not return exactly one object literal`);
    return hookObject(only + 1, plugin);
  };

  const plugins = new Map<string, OpenCodePluginHookV1[]>();
  const statementEnds = (index: number) =>
    at(index) === undefined || is(index, ";") || is(index, "export", "name");

  for (let index = 0; index < tokens.length; index += 1) {
    if (isOpen(index)) {
      index = matching(index);
      continue;
    }
    if (!is(index, "export", "name")) continue;
    const where = `the export at offset ${at(index)?.offset}`;
    const declares = ["const", "let", "var"].some((word) => is(index + 1, word, "name"));
    if (declares && at(index + 2)?.kind === "name" && is(index + 3, "=")) {
      const name = at(index + 2)?.value as string;
      const value = index + 4;
      const kind = at(value)?.kind;
      if ((kind === "string" || kind === "template") && statementEnds(value + 1)) {
        index = value;
        continue;
      }
      const fn = functionAt(value);
      if (fn === undefined || !statementEnds(fn.end)) return fail(where);
      plugins.set(name, pluginHooks(name, fn));
      index = fn.end - 1;
      continue;
    }
    const keyword = is(index + 1, "async", "name") ? index + 2 : index + 1;
    if (is(keyword, "function", "name") && at(keyword + 1)?.kind === "name") {
      const name = at(keyword + 1)?.value as string;
      const fn = functionAt(index + 1);
      if (fn === undefined) return fail(where);
      plugins.set(name, pluginHooks(name, fn));
      index = fn.end - 1;
      continue;
    }
    if (is(index + 1, "default", "name")) {
      const alias = at(index + 2);
      if (alias?.kind === "name" && plugins.has(alias.value) && statementEnds(index + 3)) {
        index += 2;
        continue;
      }
      if (!is(index + 2, "{")) return fail(where);
      for (const { start, end } of members(index + 2)) {
        const key = keyAt(start);
        const value = at(start + 2);
        const simple = end === start + 3 && is(start + 1, ":");
        if (simple && key === "id" && value?.kind === "string") continue;
        if (simple && key === "server" && value?.kind === "name" && plugins.has(value.value))
          continue;
        fail(
          `the default export member ${key ?? `at offset ${at(start)?.offset}`}: it has no reviewed reading (OpenCode V2 setup registrations have no representation in the hook inventory)`,
        );
      }
      index = matching(index + 2);
      continue;
    }
    fail(where);
  }
  if (plugins.size === 0) fail("a plugin file that exports no plugin function");
  return [...plugins.values()].flat();
}
