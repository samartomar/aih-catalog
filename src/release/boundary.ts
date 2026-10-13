import { RELEASE_MAX_BYTES, RELEASE_MAX_DEPTH } from "./contracts.js";
import { assertStrictValues, canonicalJson } from "./json.js";

/** Admit bounded plain JSON data without invoking accessors or accepting class instances. */
export function copyJson(value: unknown): unknown {
  const seen = new Set<object>();
  let nodes = 0;
  const visit = (entry: unknown, depth: number): void => {
    if (++nodes > RELEASE_MAX_BYTES || depth > RELEASE_MAX_DEPTH) throw new TypeError("JSON bound");
    if (entry === null || ["string", "number", "boolean"].includes(typeof entry)) return;
    if (typeof entry !== "object") throw new TypeError("Expected JSON data");
    if (seen.has(entry)) throw new TypeError("Repeated/cyclic object");
    seen.add(entry);
    const array = Array.isArray(entry);
    const proto = Object.getPrototypeOf(entry);
    if (!array && proto !== Object.prototype && proto !== null)
      throw new TypeError("Expected plain object");
    const keys = Reflect.ownKeys(entry);
    if (array && keys.length !== entry.length + 1) throw new TypeError("Expected dense JSON array");
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (
        typeof key !== "string" ||
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      )
        throw new TypeError("Expected own JSON data property");
      if (key === "__proto__") throw new TypeError("Reserved JSON key");
      visit(descriptor.value, depth + 1);
    }
    seen.delete(entry);
  };
  visit(value, 0);
  assertStrictValues(value);
  const text = canonicalJson(value);
  if (new TextEncoder().encode(text).length > RELEASE_MAX_BYTES)
    throw new TypeError("JSON byte bound");
  return JSON.parse(text);
}

export function exactFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}
export const pointer = (value: string): string => value.replace(/~/g, "~0").replace(/\//g, "~1");

export function dataRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Expected object");
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) throw new TypeError("Expected plain object");
  const result: Record<string, unknown> = Object.create(null);
  for (const name of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      typeof name !== "string" ||
      !descriptor ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    )
      throw new TypeError("Expected own data properties");
    result[name] = descriptor.value;
  }
  return result;
}

/** Dense plain arrays of own data entries, inspected without invoking their iterator. */
export function dataArray(value: unknown): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw new TypeError("Expected dense plain array");
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      throw new TypeError("Expected own array data");
    result.push(descriptor.value);
  }
  return result;
}
