/**
 * Portable strict JSON for Catalog release data: canonical serialization and
 * canonical-byte admission. Canonical form is the restricted AIHQ profile: UTF-8,
 * no whitespace, object keys sorted by UTF-16 code units, authored array order.
 * A release document is that serialization plus exactly one LF.
 */
import type { Json } from "./contracts.js";

const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0))
      throw new TypeError("non-canonical number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort(compare)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

export class JsonAdmissionError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

const fatalUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Deepest container nesting of JSON text, scanning iteratively; the root is level 1. */
function textDepth(text: string): number {
  let depth = 0;
  let deepest = 0;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charCodeAt(index);
    if (inString) {
      if (char === 0x5c) index += 1;
      else if (char === 0x22) inString = false;
    } else if (char === 0x22) inString = true;
    else if (char === 0x7b || char === 0x5b) deepest = Math.max(deepest, ++depth);
    else if (char === 0x7d || char === 0x5d) depth -= 1;
  }
  return deepest;
}

function assertString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new JsonAdmissionError("malformed-unicode");
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new JsonAdmissionError("malformed-unicode");
    }
  }
  if (value.normalize("NFC") !== value) throw new JsonAdmissionError("non-nfc-string");
}

/** Well-formed NFC strings and keys, safe integers; walked iteratively. */
function assertStrictValues(root: unknown): void {
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      assertString(value);
    } else if (typeof value === "number") {
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        throw new JsonAdmissionError("unsafe-integer");
      }
    } else if (Array.isArray(value)) {
      for (const child of value) pending.push(child);
    } else if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        assertString(key);
        pending.push(child);
      }
    }
  }
}

/**
 * Admits exactly canonical bytes plus one LF, within the byte and depth bounds.
 * Duplicate keys, whitespace, key order, number spelling and escapes all fail
 * the canonical round trip rather than being repaired.
 */
export function readCanonicalBytes(
  bytes: Uint8Array,
  limits: { readonly maxBytes: number; readonly maxDepth: number },
): Json {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new JsonAdmissionError("malformed-bytes");
  }
  if (bytes.byteLength > limits.maxBytes) throw new JsonAdmissionError("byte-limit");
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new JsonAdmissionError("non-canonical-bytes");
  }
  let text: string;
  try {
    text = fatalUtf8.decode(bytes);
  } catch {
    throw new JsonAdmissionError("malformed-utf8");
  }
  if (!text.endsWith("\n") || text.endsWith("\n\n")) {
    throw new JsonAdmissionError("non-canonical-bytes");
  }
  const body = text.slice(0, -1);
  if (textDepth(body) > limits.maxDepth) throw new JsonAdmissionError("depth-limit");
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new JsonAdmissionError("malformed-json");
  }
  let rendered: string;
  try {
    rendered = canonicalJson(value);
  } catch {
    throw new JsonAdmissionError("non-canonical-bytes");
  }
  if (rendered !== body) throw new JsonAdmissionError("non-canonical-bytes");
  assertStrictValues(value);
  return value as Json;
}

/** Deep-freezes a JSON value iteratively. */
export function deepFreeze<T>(value: T): T {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const item = pending.pop();
    if (item === null || typeof item !== "object" || Object.isFrozen(item)) continue;
    Object.freeze(item);
    for (const child of Object.values(item)) pending.push(child);
  }
  return value;
}
