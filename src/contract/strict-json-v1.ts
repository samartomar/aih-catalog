import { createHash } from "node:crypto";
import {
  type Node as JsonNode,
  type ParseError,
  parse as parseJson,
  parseTree,
  printParseErrorCode,
} from "jsonc-parser";

const MAX_TEXT_BYTES = 1_048_576;
const MAX_STRING_CODE_UNITS = 131_072;
const MAX_OBJECT_MEMBERS = 4_096;
const MAX_ARRAY_MEMBERS = 4_096;

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function ownDataValue(object: object, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError(`${label} must be an own data property`);
  }
  return descriptor.value;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

export function assertWellFormedNfcV1(value: string, label: string, requireNfc = true): void {
  if (value.length > MAX_STRING_CODE_UNITS)
    throw new TypeError(`${label} exceeds the string bound`);
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${label} contains malformed Unicode`);
      }
      index += 1;
      continue;
    }
    if (current >= 0xdc00 && current <= 0xdfff) {
      throw new TypeError(`${label} contains malformed Unicode`);
    }
  }
  if (requireNfc && value.normalize("NFC") !== value) {
    throw new TypeError(`${label} must already be NFC`);
  }
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
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_ARRAY_MEMBERS) {
      throw new TypeError(`${label} has an unsupported array shape`);
    }
    if (
      Object.keys(value).some((key) => {
        const index = Number(key);
        return (
          !Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key
        );
      })
    ) {
      throw new TypeError(`${label} arrays cannot have extra enumerable keys`);
    }
    for (let index = 0; index < value.length; index += 1) {
      assertStrictJsonValueV1(
        ownDataValue(value, String(index), label),
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
  const keys = Object.keys(value);
  if (keys.length > MAX_OBJECT_MEMBERS) throw new TypeError(`${label} exceeds the object bound`);
  for (const key of keys) {
    assertWellFormedNfcV1(key, `${label} key`, requireNfc);
    assertStrictJsonValueV1(
      ownDataValue(value, key, `${label}.${key}`),
      `${label}.${key}`,
      requireNfc,
      active,
    );
  }
  active.delete(value);
  return value;
}

export function deepFreezeStrictJsonV1<T>(value: T, seen = new WeakSet<object>()): T {
  if (!isObject(value) || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor)
      deepFreezeStrictJsonV1(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function assertNoDuplicateKeys(node: JsonNode): void {
  if (node.type === "object") {
    const seen = new Set<string>();
    for (const property of node.children ?? []) {
      const key = property.children?.[0]?.value;
      if (typeof key === "string") {
        if (seen.has(key)) throw new TypeError(`duplicate JSON object key: ${key}`);
        seen.add(key);
      }
      const child = property.children?.[1];
      if (child !== undefined) assertNoDuplicateKeys(child);
    }
  } else if (node.type === "array") {
    for (const child of node.children ?? []) assertNoDuplicateKeys(child);
  }
}

export function parseStrictJsonObjectV1(text: string, label: string): Record<string, unknown> {
  assertWellFormedNfcV1(text, `${label} JSON text`);
  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES)
    throw new TypeError(`${label} exceeds JSON bound`);
  const options = { allowTrailingComma: false, disallowComments: true } as const;
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, options);
  if (errors.length > 0 || tree === undefined) {
    const detail = errors.map((error) => printParseErrorCode(error.error)).join("; ");
    throw new TypeError(`invalid JSON ${label}${detail.length > 0 ? `: ${detail}` : ""}`);
  }
  if (tree.type !== "object") throw new TypeError(`${label} JSON root must be an object`);
  assertNoDuplicateKeys(tree);
  const parseErrors: ParseError[] = [];
  const parsed = parseJson(text, parseErrors, options);
  if (parseErrors.length > 0 || !isObject(parsed) || Array.isArray(parsed)) {
    throw new TypeError(`invalid JSON ${label}`);
  }
  return assertStrictJsonValueV1(parsed, label) as Record<string, unknown>;
}

export function parseStrictJsonUtf8ObjectV1(bytes: Buffer, label: string): Record<string, unknown> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${label} must be well-formed UTF-8`);
  }
  return parseStrictJsonObjectV1(text, label);
}

function codeUnitCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function serializeCanonical(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError("value is not JSON serializable");
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map((child) => serializeCanonical(child)).join(",")}]`;
  if (!isObject(value)) throw new TypeError(`canonical JSON does not support ${typeof value}`);
  return `{${Object.keys(value)
    .sort(codeUnitCompare)
    .map(
      (key) =>
        `${JSON.stringify(key)}:${serializeCanonical(ownDataValue(value, key, "canonical JSON"))}`,
    )
    .join(",")}}`;
}

export function canonicalStrictJsonBytesV1(value: unknown): Buffer {
  assertStrictJsonValueV1(value, "canonical JSON");
  return Buffer.from(serializeCanonical(value), "utf8");
}

export function canonicalStrictJsonSha256V1(value: unknown): string {
  return createHash("sha256").update(canonicalStrictJsonBytesV1(value)).digest("hex");
}

export function parseCanonicalStrictJsonObjectV1(
  text: string,
  label: string,
): Record<string, unknown> {
  const parsed = parseStrictJsonObjectV1(text, label);
  if (!canonicalStrictJsonBytesV1(parsed).equals(Buffer.from(text, "utf8"))) {
    throw new TypeError(`${label} must use canonical JSON bytes`);
  }
  return parsed;
}

export function assertSafeRelativePosixPathV1(path: string, label: string): string {
  assertWellFormedNfcV1(path, label);
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    /[\\%?#:]/.test(path) ||
    hasControlCharacter(path) ||
    path.endsWith("/") ||
    path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new TypeError(`${label} must be a safe relative POSIX path`);
  }
  return path;
}
