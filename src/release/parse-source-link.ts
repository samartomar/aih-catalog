/**
 * Portable source-link parsing for samartomar/aih-catalog#120.
 *
 * `parseSourceLink(text)` turns pasted text — a GitHub link, an install command
 * or an npm package name — into a candidate source description. Pasted text is
 * data here: this module never fetches, installs, executes, discovers the host
 * or starts a subprocess, and it performs no network or filesystem access. A
 * candidate is returned only when the source identity is derived from the text
 * itself; anything else is `unrecognised` with a diagnostic, never a guess.
 *
 * Limits are named and published: input above
 * `PARSE_SOURCE_LINK_MAX_CHARACTERS` (2,048 characters) is refused as
 * `input-too-long`. Mutable references (a branch, tag, `latest` or an implied
 * default branch) stay recognised but carry an explicit `reference-not-exact`
 * diagnostic; they are never silently resolved or pinned. Discovery surfaces —
 * an MCP directory page, or a `--skill` selector on an install command — are
 * reported as non-authoritative `discovery-note` entries and never change the
 * candidate.
 */
import { deepFreeze } from "./json.js";

/** Published input bound for `parseSourceLink`; exceeding it is `input-too-long`. */
export const PARSE_SOURCE_LINK_MAX_CHARACTERS = 2048;

/** Why a parse refused, why a reference is not exact, or what note was kept. */
export interface SourceLinkDiagnostic {
  readonly code: "input-too-long" | "reference-not-exact" | "discovery-note" | "unrecognised";
  readonly message: string;
}

/** A candidate source description; the same vocabulary the source-description schema uses. */
export interface SourceLinkCandidate {
  readonly kind: "git" | "npm" | "local";
  readonly repository?: string;
  readonly ref?: string;
  readonly package?: string;
  readonly version?: string;
}

export type ParseSourceLinkResult =
  | {
      readonly status: "recognised";
      readonly candidate: SourceLinkCandidate;
      readonly diagnostics: readonly SourceLinkDiagnostic[];
    }
  | {
      readonly status: "unrecognised";
      readonly diagnostics: readonly SourceLinkDiagnostic[];
    };

const EXACT_COMMIT = /^[a-f0-9]{40}$/;
const EXACT_VERSION =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const GITHUB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/;
const NPM_UNSCOPED = /^[a-z0-9][a-z0-9._-]*$/;
const NPM_SCOPED = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const MCP_DIRECTORY_REPOSITORY = "https://github.com/modelcontextprotocol/servers";

const UNRECOGNISED_MESSAGE =
  "The input is not a recognised source link or install command; no candidate is derived. " +
  "Supported shapes: a GitHub repository, tree or permalink link, an npm package page, " +
  "an npx install command, or an npm package name.";

const notExact = (reference: string): SourceLinkDiagnostic => ({
  code: "reference-not-exact",
  message: `The reference ${JSON.stringify(reference)} is a branch, tag or other mutable pointer; it is reported as not exact and is never silently pinned.`,
});

const discoveryNote = (message: string): SourceLinkDiagnostic => ({
  code: "discovery-note",
  message,
});

const MCP_DIRECTORY_NOTE =
  "The MCP servers directory is a discovery listing, not a source; a listed server's upstream is never derived from the directory.";

interface GitHubLink {
  readonly repository: string;
  readonly ref?: string;
}

function refusal(code: SourceLinkDiagnostic["code"], message: string): ParseSourceLinkResult {
  return deepFreeze({ status: "unrecognised", diagnostics: [{ code, message }] });
}

function unrecognised(): ParseSourceLinkResult {
  return refusal("unrecognised", UNRECOGNISED_MESSAGE);
}

/** A 40-hex lowercase commit is the only GitHub reference this parser treats as exact. */
function exactness(ref: string | undefined): SourceLinkDiagnostic | undefined {
  if (ref === undefined) return notExact("default branch");
  if (EXACT_COMMIT.test(ref)) return undefined;
  return notExact(ref);
}

function parseGitHubLink(text: string): GitHubLink | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.host !== "github.com") return undefined;
  let segments: string[];
  try {
    segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return undefined;
  }
  if (segments.length < 2) return undefined;
  const [owner, rawRepository] = segments;
  if (owner === undefined || rawRepository === undefined || !GITHUB_NAME.test(owner))
    return undefined;
  const repositoryName = rawRepository.endsWith(".git")
    ? rawRepository.slice(0, -4)
    : rawRepository;
  if (!GITHUB_NAME.test(repositoryName)) return undefined;
  if (segments.length === 2) return { repository: `https://github.com/${owner}/${repositoryName}` };
  const kind = segments[2];
  if (kind !== "tree" && kind !== "blob") return undefined;
  const named = segments[3];
  if (named === undefined || named === ".." || named.includes("\\") || !named.trim())
    return undefined;
  for (const extra of segments.slice(4)) {
    if (extra === ".." || extra.includes("\\")) return undefined;
  }
  return {
    repository: `https://github.com/${owner}/${repositoryName}`,
    ref: named,
  };
}

interface NpmPackage {
  readonly package: string;
  readonly version?: string;
}

function parseNpmPackagePage(text: string): NpmPackage | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.host !== "www.npmjs.com") return undefined;
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments[0] !== "package") return undefined;
  const rest = segments.slice(1);
  const head = rest[0];
  if (head === undefined) return undefined;
  let name: string;
  let versioned: string[];
  if (head.startsWith("@")) {
    if (rest.length < 2) return undefined;
    name = `${head}/${rest[1]}`;
    versioned = rest.slice(2);
  } else {
    name = head;
    versioned = rest.slice(1);
  }
  if (!NPM_UNSCOPED.test(name) && !NPM_SCOPED.test(name)) return undefined;
  if (versioned.length === 0) return { package: name };
  const version = versioned[1];
  if (
    versioned.length === 2 &&
    versioned[0] === "v" &&
    version !== undefined &&
    EXACT_VERSION.test(version)
  )
    return { package: name, version };
  return undefined;
}

/** Classify an npm version spec: only an exact version is usable as a pin. */
function versionOf(spec: string | undefined): { version?: string; mutable?: string } {
  if (spec === undefined) return { mutable: "latest" };
  if (EXACT_VERSION.test(spec)) return { version: spec };
  return { mutable: spec };
}

interface RecognisedParts {
  readonly candidate: SourceLinkCandidate;
  readonly diagnostics: SourceLinkDiagnostic[];
}

function recognised(candidate: SourceLinkCandidate, diagnostics: SourceLinkDiagnostic[]) {
  return { candidate, diagnostics };
}

function gitParts(link: GitHubLink): RecognisedParts {
  const diagnostics: SourceLinkDiagnostic[] = [];
  const inexact = exactness(link.ref);
  if (inexact) diagnostics.push(inexact);
  if (link.repository === MCP_DIRECTORY_REPOSITORY)
    diagnostics.push(discoveryNote(MCP_DIRECTORY_NOTE));
  return recognised(
    link.ref === undefined
      ? { kind: "git", repository: link.repository }
      : { kind: "git", repository: link.repository, ref: link.ref },
    diagnostics,
  );
}

function npmParts(name: string, spec: string | undefined): RecognisedParts {
  const { version, mutable } = versionOf(spec);
  const diagnostics: SourceLinkDiagnostic[] = [];
  if (mutable !== undefined) diagnostics.push(notExact(mutable));
  return recognised(
    version === undefined
      ? { kind: "npm", package: name }
      : { kind: "npm", package: name, version },
    diagnostics,
  );
}

function parseNpxCommand(text: string): RecognisedParts | undefined {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens[0] !== "npx") return undefined;
  if (tokens[1] === "skills" && tokens[2] === "add") {
    const target = tokens[3];
    if (target === undefined) return undefined;
    const link = parseGitHubLink(target);
    if (!link) return undefined;
    const selectors: string[] = [];
    for (let index = 4; index < tokens.length; index += 2) {
      if (tokens[index] !== "--skill") return undefined;
      const name = tokens[index + 1];
      if (name === undefined || name.startsWith("--")) return undefined;
      selectors.push(name);
    }
    const parts = gitParts(link);
    return recognised(parts.candidate, [
      ...parts.diagnostics,
      ...selectors.map((name) =>
        discoveryNote(
          `The selector "--skill ${name}" is a non-authoritative discovery note; it never changes the candidate source.`,
        ),
      ),
    ]);
  }
  const arguments_ = tokens.slice(1);
  while (arguments_[0] === "-y" || arguments_[0] === "--yes") arguments_.shift();
  if (arguments_.length !== 1) return undefined;
  const specification = arguments_[0];
  if (specification === undefined || specification.startsWith("-")) return undefined;
  const parsed = parsePackageSpec(specification);
  if (!parsed) return undefined;
  return npmParts(parsed.name, parsed.spec);
}

function parsePackageSpec(text: string): { name: string; spec?: string } | undefined {
  let name = text;
  let spec: string | undefined;
  const scoped = text.startsWith("@");
  const at = scoped ? text.indexOf("@", text.indexOf("/")) : text.indexOf("@");
  if (at >= 0) {
    name = text.slice(0, at);
    spec = text.slice(at + 1);
    if (!spec) return undefined;
  }
  if (!NPM_UNSCOPED.test(name) && !NPM_SCOPED.test(name)) return undefined;
  return { name, spec };
}

/**
 * Parse pasted text into a candidate source description, without effects.
 *
 * The text is never executed: an `npx` line is tokenised as data, never run.
 * Recognition is conservative — when the source identity cannot be derived
 * from the text alone, the result is `unrecognised` and carries no candidate.
 */
export function parseSourceLink(text: string): ParseSourceLinkResult {
  if (typeof text !== "string")
    throw new TypeError("parseSourceLink expects a single string of at most 2,048 characters.");
  if (text.length > PARSE_SOURCE_LINK_MAX_CHARACTERS)
    return refusal(
      "input-too-long",
      "Input exceeds the published limit of 2,048 characters for parseSourceLink; nothing was parsed.",
    );
  const input = text.trim();
  if (!input) return unrecognised();
  let parts: RecognisedParts | undefined;
  if (/^npx(?:\s|$)/.test(input)) {
    parts = parseNpxCommand(input);
  } else if (/^https:\/\//i.test(input)) {
    const link = parseGitHubLink(input);
    if (link) parts = gitParts(link);
    else {
      const page = parseNpmPackagePage(input);
      if (page) parts = npmParts(page.package, page.version);
    }
  } else {
    const specification = parsePackageSpec(input);
    if (specification) parts = npmParts(specification.name, specification.spec);
  }
  if (!parts) return unrecognised();
  return deepFreeze({
    status: "recognised",
    candidate: parts.candidate,
    diagnostics: parts.diagnostics,
  });
}
