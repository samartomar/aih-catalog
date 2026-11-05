/**
 * The shared pieces of every document validator: the record test, bounded text, and the
 * problem list. A validator reports at most one problem per path, so a missing required field
 * is not also reported as malformed.
 */
import type { Problem } from "../contracts.js";

export type Record_ = Record<string, unknown>;

export const isRecord = (value: unknown): value is Record_ =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Longest text each validator admits in one field, in UTF-16 code units. */
export const TEXT_LIMITS = {
  /** An id segment list, a framework id or a short label. */
  id: 128,
  /** A tool profile field: a template, a key, a command argument or a warning code. */
  profile: 512,
  /** A recipe field: a repository, an install command argument or a choice. */
  recipe: 2048,
  /** A content or qualification field: a description, a reason or a file path. */
  document: 4096,
} as const;

/** Non-empty text of at most `max` code units. */
export const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

export class Problems {
  readonly list: Problem[] = [];
  /** One problem per path: the first one found is kept. */
  add(path: string, message: string): void {
    if (!this.list.some((problem) => problem.path === path)) this.list.push({ path, message });
  }
  check(ok: boolean, path: string, message: string): void {
    if (!ok) this.add(path, message);
  }
  /** Unknown fields and missing required ones, by path. */
  keys(
    value: Record_,
    path: string,
    allowed: readonly string[],
    required: readonly string[] = [],
  ): void {
    for (const key of Object.keys(value))
      if (!allowed.includes(key)) this.add(`${path}/${key}`, "unknown field");
    for (const key of required)
      if (value[key] === undefined) this.add(`${path}/${key}`, "required field is missing");
  }
}

/**
 * The value a record holds under its own `key`, never one inherited from `Object.prototype`
 * (`constructor`, `toString`, `__proto__`): lookups by names from content, recipes or profiles.
 */
export const ownValue = <Value>(
  record: Readonly<Record<string, Value>> | undefined | null,
  key: string,
): Value | undefined =>
  record !== undefined && record !== null && Object.hasOwn(record, key) ? record[key] : undefined;
