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

export function assertStrictJsonValueV1<T>(
  value: T,
  label: string,
  requireNfc = true,
  active = new WeakSet<object>(),
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
    assertStrictJsonValueV1(dataValue(value, key, label), `${label}.${key}`, requireNfc, active);
  }
  active.delete(value);
  return value;
}

export function deepFreezeStrictJsonV1<T>(value: T, seen = new WeakSet<object>()): T {
  if (!isObject(value) || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      deepFreezeStrictJsonV1(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function serializeCanonicalValue(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0))
      throw new TypeError("canonical JSON numbers must be finite and not negative zero");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    assertPlainArray(value, "canonical JSON");
    const children: string[] = [];
    for (let index = 0; index < value.length; index += 1)
      children.push(serializeCanonicalValue(dataValue(value, String(index), "canonical JSON")));
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
          `${JSON.stringify(key)}:${serializeCanonicalValue(dataValue(value, key, "canonical JSON"))}`,
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

const JSON_WHITESPACE = /[ \t\n\r]*/y;
// biome-ignore lint/suspicious/noControlCharactersInRegex: JSON strings exclude raw control characters
const JSON_STRING = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
const JSON_NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const JSON_LITERAL = /true|false|null/y;
const JSON_MAX_DEPTH = 256;

/**
 * Read RFC 8259 JSON text as `JSON.parse` does, except that a key repeated in
 * one object (compared after unescaping) is refused instead of silently
 * keeping the last value, and every key, including `__proto__`, becomes an own
 * data property so a reader sees it and can refuse it as unknown.
 */
export function parseJsonTextRejectingDuplicateKeysV1(source: string, label: string): unknown {
  let index = 0;
  const fail = (problem: string): never => {
    throw new TypeError(`${label} is not strict JSON: ${problem} at offset ${String(index)}`);
  };
  const skip = () => {
    JSON_WHITESPACE.lastIndex = index;
    JSON_WHITESPACE.exec(source);
    index = JSON_WHITESPACE.lastIndex;
  };
  const token = (pattern: RegExp): string | undefined => {
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (match === null) return undefined;
    index = pattern.lastIndex;
    return match[0];
  };
  const expect = (character: string) => {
    skip();
    if (source[index] !== character) fail(`expected ${character}`);
    index += 1;
  };
  const value = (depth: number): unknown => {
    if (depth > JSON_MAX_DEPTH) fail("nesting too deep");
    skip();
    const next = source[index];
    if (next === "{") {
      index += 1;
      const result: Record<string, unknown> = {};
      skip();
      if (source[index] === "}") {
        index += 1;
        return result;
      }
      for (;;) {
        skip();
        const raw = token(JSON_STRING);
        if (raw === undefined) fail("expected a string key");
        const key = JSON.parse(raw as string) as string;
        if (Object.hasOwn(result, key)) fail(`duplicate key ${key}`);
        expect(":");
        Object.defineProperty(result, key, {
          value: value(depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
        skip();
        if (source[index] === ",") {
          index += 1;
          continue;
        }
        expect("}");
        return result;
      }
    }
    if (next === "[") {
      index += 1;
      const result: unknown[] = [];
      skip();
      if (source[index] === "]") {
        index += 1;
        return result;
      }
      for (;;) {
        result.push(value(depth + 1));
        skip();
        if (source[index] === ",") {
          index += 1;
          continue;
        }
        expect("]");
        return result;
      }
    }
    const scalar = token(JSON_STRING) ?? token(JSON_NUMBER) ?? token(JSON_LITERAL);
    if (scalar === undefined) return fail("expected a value");
    return JSON.parse(scalar);
  };
  const result = value(0);
  skip();
  if (index !== source.length) fail("unexpected text after the value");
  return result;
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
