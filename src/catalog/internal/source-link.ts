/**
 * `parseSourceLink`: pasted text read as data only. Nothing here fetches, runs, resolves or
 * touches the host. A candidate is returned only when the text itself names the source;
 * anything else is `unrecognised` with a reason, never a guess.
 */
import { formats, limits, type Refused } from "../contracts.js";
import { deepFreeze } from "./json.js";
import { EXACT_VERSION, NPM_PACKAGE } from "./model.js";

export { EXACT_VERSION };

import { isSafeRelativePath, limitRefusal, quote } from "./paths.js";

/** A local folder, as written (a leading `~` is expanded only when it is read). */
export interface LocalCandidate {
  readonly kind: "local";
  readonly path: string;
}

/** A Git repository; `ref` is a branch, tag or commit, `subpath` a folder inside it. */
export interface GitCandidate {
  readonly kind: "git";
  readonly repository: string;
  readonly ref?: string;
  readonly subpath?: string;
}

/** An npm package; `version` when the text names an exact version, `range` otherwise. */
export interface NpmCandidate {
  readonly kind: "npm";
  readonly package: string;
  readonly version?: string;
  readonly range?: string;
}

export type SourceCandidate = LocalCandidate | GitCandidate | NpmCandidate;

export type ParseSourceLinkResult =
  | {
      readonly schema: typeof formats.sourceLink;
      readonly status: "recognised";
      readonly candidate: SourceCandidate;
    }
  | {
      readonly schema: typeof formats.sourceLink;
      readonly status: "unrecognised";
      readonly reason: string;
    }
  | ({ readonly schema: typeof formats.sourceLink } & Refused);

const NPM_NAME = NPM_PACKAGE;
const NPM_SPECIFIER = /^[0-9A-Za-z.^~<>=|*+_-]+$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const SEGMENT = /^[A-Za-z0-9_.-]+$/;
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$/;
const NPM_HOSTS = new Set(["www.npmjs.com", "npmjs.com"]);

type Parsed = SourceCandidate | { readonly unrecognised: string };
const no = (reason: string): Parsed => ({ unrecognised: reason });
const isCandidate = (parsed: Parsed): parsed is SourceCandidate => "kind" in parsed;

const repoSegment = (segment: string | undefined): segment is string =>
  segment !== undefined && SEGMENT.test(segment) && segment !== "." && segment !== "..";
const stripGit = (name: string): string => (name.endsWith(".git") ? name.slice(0, -4) : name);

/** An npm package spec: `name`, `name@1.2.3`, `name@^1`, `@scope/name@tag`. */
export function npmSpec(text: string): Parsed {
  const at = text.indexOf("@", 1);
  const name = at === -1 ? text : text.slice(0, at);
  const specifier = at === -1 ? undefined : text.slice(at + 1);
  if (name.length > 214 || !NPM_NAME.test(name))
    return no(`${quote(text)} is not an npm package name`);
  if (specifier === undefined) return { kind: "npm", package: name };
  if (specifier.length === 0 || !NPM_SPECIFIER.test(specifier))
    return no(`${quote(text)} has no usable npm version or range`);
  return EXACT_VERSION.test(specifier)
    ? { kind: "npm", package: name, version: specifier }
    : { kind: "npm", package: name, range: specifier };
}

function localPath(text: string): Parsed | null {
  if (text.startsWith("file:")) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return no(`${quote(text)} is not a file URL`);
    }
    if (url.host !== "" && url.host !== "localhost")
      return no(`the file URL ${quote(text)} names another host`);
    if (url.search !== "" || url.hash !== "")
      return no(`the file URL ${quote(text)} has a query or fragment`);
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return no(`the file URL ${quote(text)} is not decodable`);
    }
    if (path.includes("\0")) return no("the file URL holds a NUL character");
    return { kind: "local", path: /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path };
  }
  if (
    text === "." ||
    text === ".." ||
    text === "~" ||
    /^(?:\.{1,2}|~)[\\/]/.test(text) ||
    text.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(text)
  ) {
    return text.includes("\0")
      ? no("the path holds a NUL character")
      : { kind: "local", path: text };
  }
  return null;
}

/** `tree|blob/<ref>[/<path>]` after a repository's path segments. */
function treeOrBlob(repository: string, rest: readonly string[], text: string): Parsed {
  const [view, ref, ...path] = rest;
  if (view !== "tree" && view !== "blob")
    return no(`${quote(text)} is not a repository, tree or blob link`);
  if (ref === undefined || ref.length === 0) return no(`${quote(text)} names no ref`);
  if (path.length === 0) {
    return view === "blob"
      ? no(`the blob link ${quote(text)} names no file`)
      : { kind: "git", repository, ref };
  }
  const subpath = path.join("/");
  if (!isSafeRelativePath(subpath)) return no(`the subpath of ${quote(text)} is not safe`);
  return { kind: "git", repository, ref, subpath };
}

function httpsLink(text: string): Parsed {
  // URL parsing would silently resolve dot segments; a link holding them is never read.
  if (/\/\.{1,2}(?:[/?#]|$)/.test(text.replace(/^[a-z]+:\/\//i, "")))
    return no(`${quote(text)} holds a . or .. path segment`);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return no(`${quote(text)} is not a URL`);
  }
  if (url.protocol === "http:") return no("plain http links are not read; use https");
  if (url.protocol !== "https:") return no(`the ${url.protocol} scheme is not a source link`);
  if (url.username !== "" || url.password !== "")
    return no("a link carrying credentials is not read");
  if (url.search !== "" || url.hash !== "")
    return no(`${quote(text)} has a query or fragment, which is never guessed at`);
  if (!HOST.test(url.host)) return no(`${quote(text)} has an unusable host`);
  let segments: string[];
  try {
    segments = url.pathname
      .split("/")
      .filter((segment) => segment !== "")
      .map(decodeURIComponent);
  } catch {
    return no(`${quote(text)} is not decodable`);
  }
  const host = url.host.toLowerCase();
  if (NPM_HOSTS.has(host)) {
    if (segments[0] !== "package") return no(`${quote(text)} is not an npm package page`);
    const scoped = segments[1]?.startsWith("@") === true;
    const name = (scoped ? segments.slice(1, 3) : segments.slice(1, 2)).join("/");
    const rest = segments.slice(scoped ? 3 : 2);
    if (rest.length === 0) return npmSpec(name);
    if (rest.length === 2 && rest[0] === "v" && EXACT_VERSION.test(rest[1] as string))
      return npmSpec(`${name}@${rest[1]}`);
    return no(`${quote(text)} is not an npm package page`);
  }
  const dash = segments.indexOf("-");
  const repoSegments = dash !== -1 ? segments.slice(0, dash) : segments.slice(0, 2);
  const rest = dash !== -1 ? segments.slice(dash + 1) : segments.slice(2);
  if (repoSegments.length < 2 || !repoSegments.every(repoSegment))
    return no(`${quote(text)} does not name an owner and repository`);
  if (dash === -1 && rest.length > 0 && rest[0] !== "tree" && rest[0] !== "blob") {
    const last = segments[segments.length - 1] as string;
    if (!last.endsWith(".git") || !segments.every(repoSegment))
      return no(`${quote(text)} is not a repository, tree or blob link`);
    return {
      kind: "git",
      repository: `https://${host}/${[...segments.slice(0, -1), stripGit(last)].join("/")}`,
    };
  }
  const names = [...repoSegments.slice(0, -1), stripGit(repoSegments.at(-1) as string)];
  const repository = `https://${host}/${names.join("/")}`;
  if (!repoSegment(names.at(-1))) return no(`${quote(text)} names no repository`);
  return rest.length === 0 ? { kind: "git", repository } : treeOrBlob(repository, rest, text);
}

function sshLink(text: string): Parsed | null {
  const scp = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):([^\s:]+)$/.exec(text);
  const url = /^ssh:\/\/([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+(?::\d{1,5})?)\/([^\s]+)$/.exec(text);
  const match = scp ?? url;
  if (match === null)
    return text.startsWith("ssh:") ? no(`${quote(text)} is not an SSH link`) : null;
  const [, user, host, path] = match as unknown as [string, string, string, string];
  const segments = path.replace(/\/$/, "").split("/");
  if (segments.length < 2 || !segments.every(repoSegment))
    return no(`${quote(text)} does not name an owner and repository`);
  const joined = segments.join("/");
  return {
    kind: "git",
    repository: scp ? `${user}@${host}:${joined}` : `ssh://${user}@${host}/${joined}`,
  };
}

/** One token: a local path, a Git link, GitHub shorthand or an npm spec. */
function single(text: string, allowNpm: boolean): Parsed {
  const local = localPath(text);
  if (local !== null) return local;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text)) {
    if (text.startsWith("ssh://")) return sshLink(text) as Parsed;
    return httpsLink(text);
  }
  const ssh = sshLink(text);
  if (ssh !== null) return ssh;
  const shorthand = /^([^/@]+)\/([^/]+)$/.exec(text);
  if (shorthand !== null) {
    const [, owner, name] = shorthand as unknown as [string, string, string];
    const repository = stripGit(name);
    if (!OWNER.test(owner) || !repoSegment(repository))
      return no(`${quote(text)} is not a GitHub owner/repo`);
    return { kind: "git", repository: `https://github.com/${owner}/${repository}` };
  }
  if (!allowNpm) return no(`${quote(text)} is not a local path or Git repository`);
  if (text.includes(":")) return no(`${quote(text)} is not a recognised source link`);
  return npmSpec(text);
}

const NPX_FLAGS = new Set(["-y", "--yes"]);

/** `npx [-y] <spec>`, `npx [-y] skills add <source>` and `git clone [-b <ref>] <url>`. */
function command(tokens: readonly string[]): Parsed {
  const [program, ...rest] = tokens;
  if (program === "npx") {
    const args = [...rest];
    while (args.length > 0 && NPX_FLAGS.has(args[0] as string)) args.shift();
    const [spec, ...after] = args;
    if (spec === undefined) return no("npx names no package");
    if (spec === "skills" || spec.startsWith("skills@")) {
      if (after[0] !== "add") return no("only `npx skills add <source>` is read");
      const source = after[1];
      if (source === undefined || source.startsWith("-"))
        return no("`npx skills add` names no source");
      return single(source, false);
    }
    if (spec.startsWith("-")) return no(`the npx option ${quote(spec)} is not read`);
    const parsed = npmSpec(spec);
    return isCandidate(parsed)
      ? parsed
      : no(`npx names ${quote(spec)}, which is not an npm package`);
  }
  if (program === "git" && rest[0] === "clone") {
    let ref: string | undefined;
    const positional: string[] = [];
    for (let index = 1; index < rest.length; index += 1) {
      const token = rest[index] as string;
      if (token === "-b" || token === "--branch") {
        ref = rest[index + 1];
        index += 1;
      } else if (token.startsWith("--branch=")) ref = token.slice("--branch=".length);
      else if (token === "--depth") index += 1;
      else if (token.startsWith("-")) {
        if (!/^(?:-q|--quiet|--single-branch|--depth=\d+)$/.test(token))
          return no(`the git clone option ${quote(token)} is not read`);
      } else positional.push(token);
    }
    const url = positional[0];
    if (url === undefined || positional.length > 2)
      return no("git clone names no single repository");
    // Git clones a local path or file URL as a repository, so here it names a Git source.
    const local = localPath(url);
    const parsed: Parsed =
      local !== null && isCandidate(local) && local.kind === "local"
        ? { kind: "git", repository: url.startsWith("file:") ? url : local.path }
        : single(url, false);
    if (!isCandidate(parsed) || parsed.kind !== "git")
      return no(`git clone names ${quote(url)}, which is not a Git link`);
    if (ref === undefined) return parsed;
    if (ref.length === 0 || ref.startsWith("-")) return no("git clone names an unusable branch");
    if (parsed.ref !== undefined) return no("git clone names two refs");
    return { ...parsed, ref };
  }
  return no(`${quote(tokens.join(" "))} is not a recognised source link or installer command`);
}

/**
 * Reads text as a source link: a local path or file URL, a Git link (any HTTPS host, SSH,
 * GitHub `owner/repo` shorthand, GitHub/GitLab tree and blob links with their subpath), an
 * npm spec or package page, or a known installer command naming one of those.
 */
export function parseSourceLink(text: string): ParseSourceLinkResult {
  const schema = formats.sourceLink;
  if (typeof text !== "string")
    return deepFreeze({ schema, status: "unrecognised", reason: "the input is not text" });
  if ([...text].length > limits.sourceLinkCharacters)
    return deepFreeze({ schema, ...limitRefusal("sourceLinkCharacters", "the source link") });
  const trimmed = text.trim();
  const tokens = trimmed.split(/\s+/).filter((token) => token !== "");
  if (tokens.length === 0)
    return deepFreeze({ schema, status: "unrecognised", reason: "the input is empty" });
  // A local path may hold spaces; it is never a command.
  const parsed =
    localPath(trimmed) ??
    (tokens.length === 1 ? single(tokens[0] as string, true) : command(tokens));
  return deepFreeze(
    isCandidate(parsed)
      ? { schema, status: "recognised", candidate: parsed }
      : { schema, status: "unrecognised", reason: parsed.unrecognised },
  );
}
