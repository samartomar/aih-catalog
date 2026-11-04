import { type LimitName, limits, type RefusalCode, type Refused } from "../contracts.js";

/**
 * True for a canonical source-relative POSIX path: non-empty segments, no `.`/`..`, no
 * leading slash, no backslash, drive letter or NUL. Anything else is a `path-escape`.
 */
export function isSafeRelativePath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096) return false;
  if (path.includes("\\") || path.includes("\0") || /^[A-Za-z]:/.test(path)) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** Input quoted in a reason, cut at the published bound. */
export function quote(text: string): string {
  const max = limits.refusalQuoteCharacters;
  const cut = [...text];
  return JSON.stringify(cut.length > max ? `${cut.slice(0, max).join("")}…` : text);
}

export function refused(code: RefusalCode, reason: string, limit?: LimitName): Refused {
  return limit === undefined
    ? { status: "refused", code, reason }
    : { status: "refused", code, reason, limit };
}

export function limitRefusal(limit: LimitName, what: string): Refused {
  return refused("limit", `${what} exceeds the ${limit} limit of ${limits[limit]}`, limit);
}

export const dirnameOf = (path: string): string => {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
};

export const basenameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** True when `path` is `folder` itself or inside it; `/` covers everything. */
export const isUnder = (path: string, folder: string): boolean =>
  folder === "/" || folder === "" || path === folder || path.startsWith(`${folder}/`);

export const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
