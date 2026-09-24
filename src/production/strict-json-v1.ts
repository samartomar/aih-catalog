import { createHash } from "node:crypto";

/** Canonical strict JSON shared by every Catalog production digest (ported from Core). */

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

export function codeUnitCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function assertWellFormedNfcV1(value: string, label: string, requireNfc = true): void {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: identifying the complete ASCII range
  if (!/[^\x00-\x7f]/u.test(value)) return;
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${label} contains malformed Unicode (a lone high surrogate)`);
      }
      index += 1;
      continue;
    }
    if (current >= 0xdc00 && current <= 0xdfff) {
      throw new TypeError(`${label} contains malformed Unicode (a lone low surrogate)`);
    }
  }
  if (requireNfc && value.normalize("NFC") !== value) {
    throw new TypeError(`${label} must already be NFC; normalization is not performed`);
  }
}

function assertPlainArray(value: unknown[], label: string): void {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} has an unsupported array prototype`);
  }
  if (
    Object.keys(value).some((key) => {
      const index = Number(key);
      return (
        !Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key
      );
    })
  ) {
    throw new TypeError(`${label} arrays cannot have extra enumerable string keys`);
  }
}

function dataValue(value: object, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError(`${label} must contain only own data properties and no holes`);
  }
  return descriptor.value;
}

/**
 * The own entries of a plain JSON object or array, read through their descriptors so a getter is
 * never invoked. Every own key is enumerated (`Reflect.ownKeys`), and a non-plain prototype, a
 * symbol key, a non-enumerable or accessor property, or, for an array, anything but its indices in
 * order (an extra key or a hole) is refused. The same checks as Core's `jsonOwnEntriesV1` (its
 * src/contract/strict-json-v1.ts), which Core's packaged evidence reader applies.
 */
export function jsonOwnEntriesV1(value: object, label: string): [string, unknown][] {
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
    throw new TypeError(`${label} has an unsupported ${array ? "array" : "object"} prototype`);
  const entries: [string, unknown][] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") throw new TypeError(`${label} must not contain symbol properties`);
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true)
      throw new TypeError(`${label} field ${key} must be an enumerable data property`);
    if (array && key !== String(entries.length))
      throw new TypeError(`${label} must contain only indexed elements, with no holes`);
    entries.push([key, descriptor.value]);
  }
  if (array && entries.length !== (value as unknown[]).length)
    throw new TypeError(`${label} must contain only indexed elements, with no holes`);
  return entries;
}

/**
 * Requires strict JSON data: well-formed NFC strings and keys, finite numbers other than negative
 * zero, plain acyclic own-data objects and arrays, nested at most `STRICT_JSON_MAX_DEPTH_V1`
 * levels (the root is level 1), so a deep caller-supplied value is refused before the walk
 * recurses far.
 */
export function assertStrictJsonValueV1<T>(
  value: T,
  label: string,
  requireNfc = true,
  active = new WeakSet<object>(),
  depth = 1,
): T {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    assertWellFormedNfcV1(value, label, requireNfc);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError(`${label} numbers must be finite and not negative zero`);
    }
    return value;
  }
  if (!isObject(value)) throw new TypeError(`${label} does not support ${typeof value}`);
  if (depth > STRICT_JSON_MAX_DEPTH_V1) throw nestedTooDeep(label, STRICT_JSON_MAX_DEPTH_V1);
  if (active.has(value)) throw new TypeError(`${label} must not contain a cycle`);
  active.add(value);
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${label} must not contain symbol properties`);
  }
  if (Array.isArray(value)) {
    assertPlainArray(value, label);
    for (let index = 0; index < value.length; index += 1) {
      assertStrictJsonValueV1(
        dataValue(value, String(index), label),
        `${label}[${String(index)}]`,
        requireNfc,
        active,
        depth + 1,
      );
    }
    active.delete(value);
    return value;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} has an unsupported object prototype`);
  }
  for (const key of Object.keys(value)) {
    assertWellFormedNfcV1(key, `${label} key`, requireNfc);
    assertStrictJsonValueV1(
      dataValue(value, key, label),
      `${label}.${key}`,
      requireNfc,
      active,
      depth + 1,
    );
  }
  active.delete(value);
  return value;
}

/**
 * The nesting bound of the strict JSON reader: far above any real record (packaged scanner
 * evidence nests seven levels). Core's packaged evidence reader uses the same
 * (`STRICT_JSON_MAX_DEPTH_V1` in Core's src/contract/strict-json-v1.ts).
 */
export const STRICT_JSON_MAX_DEPTH_V1 = 32;

function nestedTooDeep(label: string, maxDepth: number): TypeError {
  return new TypeError(`${label} nests deeper than ${String(maxDepth)} levels`);
}

/**
 * Refuses JSON text whose objects and arrays nest deeper than `maxDepth` (the root is level 1).
 * An iterative scan that skips string contents, so it runs before any recursive parser does;
 * the same scan as Core's `assertJsonTextDepthV1`.
 */
export function assertJsonTextDepthV1(text: string, label: string, maxDepth: number): void {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") {
      depth += 1;
      if (depth > maxDepth) throw nestedTooDeep(label, maxDepth);
    } else if (char === "}" || char === "]") depth -= 1;
  }
}

const JSON_NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const JSON_HEX4 = /^[0-9a-fA-F]{4}$/;
const JSON_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/**
 * Core's strict JSON reader (`parseStrictJsonObjectV1` in Core's src/contract/strict-json-v1.ts,
 * jsonc-parser without comments or trailing commas), without a runtime dependency: well-formed
 * NFC text nested at most `STRICT_JSON_MAX_DEPTH_V1` levels (checked first, without recursion);
 * RFC 8259 grammar only (no byte order mark, comments, trailing commas or trailing
 * data; JSON whitespace only); no duplicate object keys; an object root; then every string, key
 * and number strict (`assertStrictJsonValueV1`). A `__proto__` member is refused by name: no JSON
 * parse preserves one (Core's reader makes it the prototype or drops it), so Core's packaged
 * evidence reader refuses it from the parse tree the same way.
 */
export function parseStrictJsonObjectV1(text: string, label: string): Record<string, unknown> {
  assertJsonTextDepthV1(text, label, STRICT_JSON_MAX_DEPTH_V1);
  assertWellFormedNfcV1(text, `${label} JSON text`);
  let index = 0;
  const fail = (expected: string): never => {
    throw new TypeError(`invalid JSON ${label}: ${expected} at offset ${String(index)}`);
  };
  const space = () => {
    while (index < text.length && " \t\n\r".includes(text.charAt(index))) index += 1;
  };
  const string = (): string => {
    index += 1;
    let result = "";
    for (;;) {
      if (index >= text.length) return fail("closing quote");
      const char = text.charAt(index);
      if (char === '"') {
        index += 1;
        return result;
      }
      if (text.charCodeAt(index) < 0x20) return fail("escaped control character");
      if (char !== "\\") {
        result += char;
        index += 1;
        continue;
      }
      const escaped = text.charAt(index + 1);
      if (escaped === "u") {
        const hex = text.slice(index + 2, index + 6);
        if (!JSON_HEX4.test(hex)) return fail("four hex digits");
        result += String.fromCharCode(Number.parseInt(hex, 16));
        index += 6;
        continue;
      }
      const simple = Object.hasOwn(JSON_ESCAPES, escaped) ? JSON_ESCAPES[escaped] : undefined;
      if (simple === undefined) return fail("escape character");
      result += simple;
      index += 2;
    }
  };
  const value = (): unknown => {
    space();
    const char = text.charAt(index);
    if (char === "{") {
      index += 1;
      const result: Record<string, unknown> = {};
      const keys = new Set<string>();
      space();
      if (text.charAt(index) === "}") {
        index += 1;
        return result;
      }
      for (;;) {
        space();
        if (text.charAt(index) !== '"') return fail("property name");
        const key = string();
        if (key === "__proto__") throw new TypeError(`${label} has an unsupported field __proto__`);
        if (keys.has(key)) throw new TypeError(`duplicate JSON object key: ${key}`);
        keys.add(key);
        space();
        if (text.charAt(index) !== ":") return fail("colon");
        index += 1;
        Object.defineProperty(result, key, {
          configurable: true,
          enumerable: true,
          value: value(),
          writable: true,
        });
        space();
        if (text.charAt(index) === ",") {
          index += 1;
          continue;
        }
        if (text.charAt(index) === "}") {
          index += 1;
          return result;
        }
        return fail("comma or closing brace");
      }
    }
    if (char === "[") {
      index += 1;
      const result: unknown[] = [];
      space();
      if (text.charAt(index) === "]") {
        index += 1;
        return result;
      }
      for (;;) {
        result.push(value());
        space();
        if (text.charAt(index) === ",") {
          index += 1;
          continue;
        }
        if (text.charAt(index) === "]") {
          index += 1;
          return result;
        }
        return fail("comma or closing bracket");
      }
    }
    if (char === '"') return string();
    for (const [word, literal] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(word, index)) {
        index += word.length;
        return literal;
      }
    }
    JSON_NUMBER.lastIndex = index;
    const number = JSON_NUMBER.exec(text);
    if (number === null) return fail("value");
    index += number[0].length;
    return Number(number[0]);
  };
  space();
  if (text.charAt(index) !== "{") return fail("object root");
  const parsed = value();
  space();
  if (index !== text.length) return fail("end of text");
  return assertStrictJsonValueV1(parsed as Record<string, unknown>, label);
}

/** Freezes a value and everything it holds, at any depth: iteratively, never recursing. */
export function deepFreezeStrictJsonV1<T>(value: T, seen = new WeakSet<object>()): T {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const item = pending.pop();
    if (!isObject(item) || seen.has(item)) continue;
    seen.add(item);
    for (const key of Object.keys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (descriptor !== undefined && "value" in descriptor) pending.push(descriptor.value);
    }
    Object.freeze(item);
  }
  return value;
}

/** Canonical JSON text, nested at most `STRICT_JSON_MAX_DEPTH_V1` levels (the root is level 1). */
function serializeCanonicalValue(value: unknown, depth = 1): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0))
      throw new TypeError("canonical JSON numbers must be finite and not negative zero");
    return JSON.stringify(value);
  }
  if (typeof value === "object" && depth > STRICT_JSON_MAX_DEPTH_V1)
    throw nestedTooDeep("canonical JSON", STRICT_JSON_MAX_DEPTH_V1);
  if (Array.isArray(value)) {
    assertPlainArray(value, "canonical JSON");
    const children: string[] = [];
    for (let index = 0; index < value.length; index += 1)
      children.push(
        serializeCanonicalValue(dataValue(value, String(index), "canonical JSON"), depth + 1),
      );
    return `[${children.join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError("canonical JSON does not support this object prototype");
    if (Object.getOwnPropertySymbols(value).length > 0)
      throw new TypeError("canonical JSON does not support symbol keys");
    return `{${Object.keys(value)
      .sort(codeUnitCompare)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${serializeCanonicalValue(dataValue(value, key, "canonical JSON"), depth + 1)}`,
      )
      .join(",")}}`;
  }
  throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

export function canonicalJsonV1(value: unknown): string {
  return serializeCanonicalValue(value);
}

export function canonicalStrictJsonBytesV1(value: unknown): Buffer {
  assertStrictJsonValueV1(value, "canonical JSON");
  return Buffer.from(serializeCanonicalValue(value), "utf8");
}

export function canonicalStrictJsonSha256V1(value: unknown): string {
  return createHash("sha256").update(canonicalStrictJsonBytesV1(value)).digest("hex");
}

/** `sha256:<hex>` of the canonical strict JSON bytes. */
export function canonicalDigestV1(value: unknown): string {
  return `sha256:${canonicalStrictJsonSha256V1(value)}`;
}

export function sha256HexV1(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertSafeRelativePosixPathV1(path: string, label: string): string {
  assertWellFormedNfcV1(path, label);
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    /[\\%?#:]/.test(path) ||
    hasControlCharacter(path) ||
    path.endsWith("/")
  ) {
    throw new TypeError(`${label} must be a safe relative POSIX path`);
  }
  if (
    path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new TypeError(`${label} must be a safe relative POSIX path`);
  }
  return path;
}
