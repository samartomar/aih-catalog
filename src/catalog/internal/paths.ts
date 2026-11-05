import { type LimitName, limits, type RefusalCode, type Refused } from "../contracts.js";

/** Characters Windows reserves in a file name. */
const RESERVED = /[\\:<>"|?*]/;

/** True when the text holds a control character (C0 or DEL). */
const hasControl = (text: string): boolean => {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

/** Names Windows reserves for devices, with or without an extension. */
const DEVICE = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i;

/** True for a segment every supported file system can hold under that exact name. */
const isPortableSegment = (segment: string): boolean =>
  segment !== "" &&
  segment !== "." &&
  segment !== ".." &&
  !RESERVED.test(segment) &&
  !hasControl(segment) &&
  !segment.endsWith(".") &&
  !segment.endsWith(" ") &&
  !DEVICE.test(segment) &&
  // A Git folder at any depth, in any case, and a Windows 8.3 short name, which can alias
  // another name (Git's core.protectNTFS rule).
  segment.toLowerCase() !== ".git" &&
  !/~[0-9]/.test(segment);

/**
 * True for a canonical, portable source-relative POSIX path: non-empty segments, no `.`, `..`
 * or `.git` segment, no leading slash, and no segment that some supported file system would
 * refuse or read as another name (a backslash, drive colon, `<>"|?*`, a control character, a
 * trailing dot or space, a Windows device name or an 8.3 short name such as `PROGRA~1`).
 * Anything else is a `path-escape`.
 */
export function isSafeRelativePath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096) return false;
  return path.split("/").every(isPortableSegment);
}

/**
 * The key two paths clash under on a case-insensitive or normalising file system: Unicode
 * NFC, then case-folded.
 */
export const clashKey = (path: string): string => path.normalize("NFC").toUpperCase().toLowerCase();

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
