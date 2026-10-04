import { createHash } from "node:crypto";

/**
 * Shared plumbing for the named refusals of Catalog's public readers.
 *
 * Every reader has a `read…Result` function returning `{ state: "read", … }` or
 * `{ state: "refused", reason }` over that reader's own closed reason union, and
 * keeps its original `undefined`-returning function as a thin wrapper. A refusal
 * is a verdict about the bytes offered, never a repair of them.
 */

/** The longest `observed` value a refusal carries. Longer values are cut, never omitted. */
export const CATALOG_REFUSAL_OBSERVED_MAX_CHARS_V1 = 128;

export interface CatalogReadRefusedV1<Reason extends string> {
  readonly state: "refused";
  readonly reason: Reason;
  /**
   * For `unknown-format` and `unknown-version`: the value the document declared,
   * as JSON text, at most 128 characters. Absent for every other reason.
   */
  readonly observed?: string;
}

/** Internal: carries a reason out of nested validation. Never escapes a `…Result` function. */
export class CatalogReadRefusal extends Error {
  constructor(
    readonly reason: string,
    readonly observed?: string,
  ) {
    super(reason);
  }
}

export function refuse(reason: string): never {
  throw new CatalogReadRefusal(reason);
}

/** A declared value rendered as bounded JSON text, for an `observed` field. */
export function observedValue(value: unknown): string {
  let text: string;
  try {
    text = value === undefined ? "undefined" : (JSON.stringify(value) ?? String(value));
  } catch {
    text = String(value);
  }
  return text.length > CATALOG_REFUSAL_OBSERVED_MAX_CHARS_V1
    ? text.slice(0, CATALOG_REFUSAL_OBSERVED_MAX_CHARS_V1)
    : text;
}

export function refuseObserved(
  reason: "unknown-format" | "unknown-version",
  value: unknown,
): never {
  throw new CatalogReadRefusal(reason, observedValue(value));
}

/** Turns a thrown refusal into a result; anything else is a defect and propagates. */
export function refusedFrom<Reason extends string>(error: unknown): CatalogReadRefusedV1<Reason> {
  if (!(error instanceof CatalogReadRefusal)) throw error;
  return Object.freeze(
    error.observed === undefined
      ? { state: "refused" as const, reason: error.reason as Reason }
      : { state: "refused" as const, reason: error.reason as Reason, observed: error.observed },
  );
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The byte discipline every sidecar reader shares: non-empty bytes within the
 * cap, no byte order mark, exactly round-trippable UTF-8, an optional digest pin,
 * JSON that parses, and exactly the canonical serialization the publisher emits.
 * Returns the parsed value and the `sha256:` digest of the bytes read.
 */
export function readCanonicalDocument(request: {
  readonly bytes: unknown;
  readonly maxBytes: number;
  readonly expectedDigest?: unknown;
  readonly canonical: (value: unknown) => string;
}): { readonly value: Record<string, unknown>; readonly digest: string } {
  const { bytes } = request;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) refuse("malformed-bytes");
  if (bytes.byteLength > request.maxBytes) refuse("oversize-bytes");
  // A byte order mark changes the digest while leaving values equal.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) refuse("non-canonical-bytes");
  const text = Buffer.from(bytes).toString("utf8");
  if (!Buffer.from(text, "utf8").equals(Buffer.from(bytes))) refuse("malformed-bytes");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (request.expectedDigest !== undefined && request.expectedDigest !== digest) {
    refuse("digest-mismatch");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return refuse("malformed-bytes");
  }
  // A rewrite cannot honestly claim the published digest, so it is refused, not repaired.
  if (request.canonical(value) !== text) refuse("non-canonical-bytes");
  if (!isObject(value)) refuse("malformed-document");
  return { value, digest };
}

/** Exactly one format and one version; each unknown one is named with what was declared. */
export function requireFormatAndVersion(
  value: Record<string, unknown>,
  format: string,
  version: number,
): void {
  if (value.format !== format) refuseObserved("unknown-format", value.format);
  if (value.version !== version) refuseObserved("unknown-version", value.version);
}

/** Strictly ascending ids: an equal neighbour is a duplicate, a smaller one is out of order. */
export function requireAscending(previous: string | undefined, current: string): void {
  if (previous === undefined) return;
  if (previous === current) refuse("duplicate-entry");
  if (previous > current) refuse("unordered-entries");
}
