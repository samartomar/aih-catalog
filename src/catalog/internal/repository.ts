/**
 * Repository addresses Catalog records and hands to installers: content Git sources, recipe and
 * data pins, and native plugin marketplaces. One grammar for all of them, so no recorded address
 * can be read as a Git option, a remote helper, a local path or a URL carrying credentials.
 */

/** A DNS host name in lowercase, with an optional port. */
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d{1,5})?$/;

/** One owner, group or repository segment: never empty, never an option, never `.`/`..`. */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/**
 * True for an https repository on a named host, `https://<host>/<owner>/<repo>` or any other
 * path of plain segments (a host may serve a repository at its root or nest groups): no
 * credentials, query, fragment, whitespace, trailing slash or segment read as an option.
 */
export function isRepositoryAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  const match = /^https:\/\/([^/]+)\/(.+)$/.exec(value);
  if (match === null) return false;
  const [, host, path] = match as unknown as [string, string, string];
  if (!HOST.test(host)) return false;
  const segments = path.split("/");
  return (
    segments.length >= 1 && segments.length <= 16 && segments.every((part) => SEGMENT.test(part))
  );
}

/** True for `owner/repo`, the short form a client's marketplace command accepts. */
export const isOwnerRepo = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 256 &&
  value.split("/").length === 2 &&
  value.split("/").every((part) => SEGMENT.test(part));

/**
 * True for a marketplace a native plugin install reads: an https URL with no credentials,
 * query, fragment or whitespace, or `owner/repo`. Never anything a command reads as an option.
 */
export function isMarketplaceAddress(value: unknown): value is string {
  if (isOwnerRepo(value)) return true;
  if (typeof value !== "string" || value.length > 2048 || /\s/.test(value)) return false;
  const match = /^https:\/\/([^/?#@]+)(\/[^?#@]*)?$/.exec(value);
  return match !== null && HOST.test(match[1] as string);
}
