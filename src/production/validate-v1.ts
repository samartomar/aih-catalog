/** Minimal fail-closed structural checks for production inputs (Catalog has no runtime deps). */

import { jsonOwnEntriesV1 } from "./strict-json-v1.js";

export type JsonRecord = Record<string, unknown>;

/**
 * A plain JSON object: every own key (`Reflect.ownKeys`) an enumerable data property, read
 * through its descriptor so a getter is never invoked (`jsonOwnEntriesV1`).
 */
export function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  jsonOwnEntriesV1(value, label);
  return value as JsonRecord;
}

export function exactKeys(
  value: JsonRecord,
  required: readonly string[],
  label: string,
  optional: readonly string[] = [],
): JsonRecord {
  const keys = jsonOwnEntriesV1(value, label).map(([key]) => key);
  for (const key of required)
    if (!keys.includes(key)) throw new TypeError(`${label} is missing ${key}`);
  for (const key of keys)
    if (!required.includes(key) && !optional.includes(key))
      throw new TypeError(`${label} has unsupported field ${key}`);
  return value;
}

export function text(value: unknown, label: string, pattern?: RegExp): string {
  if (typeof value !== "string" || (pattern !== undefined && !pattern.test(value))) {
    throw new TypeError(`${label} must be a valid string`);
  }
  return value;
}

export function nonEmptyText(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER) {
  const result = text(value, label);
  if (result.length === 0 || result.length > max) throw new TypeError(`${label} is out of bounds`);
  return result;
}

export function list(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new TypeError(`${label} must be an array of ${String(min)}..${String(max)} items`);
  }
  // A plain array of indexed data elements: no hole, extra key or getter.
  jsonOwnEntriesV1(value, label);
  return value as unknown[];
}

export function textList(value: unknown, label: string, pattern?: RegExp): string[] {
  return list(value, label).map((item, index) => text(item, `${label}[${String(index)}]`, pattern));
}

export function integer(value: unknown, label: string, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    throw new TypeError(`${label} must be an integer >= ${String(min)}`);
  }
  return value;
}

export function literal<T extends string | number | boolean>(
  value: unknown,
  expected: T,
  label: string,
): T {
  if (value !== expected) throw new TypeError(`${label} must be ${String(expected)}`);
  return expected;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new TypeError(`${label} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

export const SHA256_HEX = /^[a-f0-9]{64}$/;
export const QUALIFIED_SHA256 = /^sha256:[a-f0-9]{64}$/;
export const COMMIT_SHA = /^[a-f0-9]{40}$/;
