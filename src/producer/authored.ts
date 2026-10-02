import type { CatalogItem, CatalogRelease, Json } from "../release/contracts.js";

/**
 * Allowances for one Catalog-authored source, declared by the maintainer:
 * author-owned paths the content may reference but Catalog never delivers, and
 * the template tokens the author is expected to fill in. Nothing here widens an
 * upstream item; only content a release source marks `authored` is checked.
 */
export interface AuthoredAllowance {
  readonly source: string;
  readonly externalPaths: readonly string[];
  readonly templatePlaceholders: readonly string[];
}

/** One unresolved reference or placeholder residue, located in one checked text. */
export interface AuthoredFinding {
  readonly itemId: string;
  /** Material id, or `operation:<id>` for a text.block literal. */
  readonly member: string;
  /** Installed project path of the text (wildcard segments shown as `*`). */
  readonly target: string;
  /** 1-based line of the match within the text. */
  readonly line: number;
  /** The reference destination or the placeholder token exactly as written. */
  readonly text: string;
}

export interface AuthoredContentResult {
  readonly references: readonly AuthoredFinding[];
  readonly placeholders: readonly AuthoredFinding[];
}

/** The stable one-line rendering of a finding: `itemId member target:line -> text`. */
export const describeFinding: (finding: AuthoredFinding) => string = (finding) =>
  `${finding.itemId} ${finding.member} ${finding.target}:${finding.line} -> ${finding.text}`;

type Record_ = { [key: string]: Json };
/** One path segment part: a literal, or a single-segment wildcard (`[^/]+`). */
type Part = { readonly literal: string } | { readonly any: true };
/** A whole path as segments, each a sequence of literal and wildcard parts. */
type Path = readonly (readonly Part[])[];
/** One installed target: single-part segments plus the display path for findings. */
interface Target {
  readonly segments: readonly Part[];
  readonly path: string;
}

interface Mention {
  /** The reference exactly as written, for the finding. */
  readonly text: string;
  /** The path portion after stripping a `#fragment` or `?query`. */
  readonly path: string;
  /** Project-root relative (a leading `/`, Kiro and inline-code mentions). */
  readonly absolute: boolean;
  readonly line: number;
}

interface ExaminedText {
  readonly member: string;
  readonly target: Target;
  readonly text: string;
}

const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });

const asRecord = (value: Json | undefined): Record_ | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record_)
    : undefined;

const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Markdown inline links and images; the destination is the first token in the parentheses. */
const MARKDOWN_LINK = /!?\[[^\]\n]*\]\(\s*([^\s)]+)/gu;
/** Kiro file references, always project-root relative. */
const KIRO_FILE = /#\[\[file:([^\]\s]+)\]\]/gu;
/** Inline code spans; only plainly path-like ones count as mentions. */
const INLINE_CODE = /`([^`\n]+)`/gu;
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const PATH_LIKE_EXCLUDED = /[*?[\]{}()$|]/u;
const UPPER_ANGLE = /<[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*>/gu;

/**
 * Placeholder residue patterns, matched anywhere in a text (inline code and HTML
 * comments included). An occurrence equal to a declared template placeholder
 * token of the item's authored source is allowed.
 */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /\$\{[^\n]*?\}/gu,
  /\{\{[^\n]*?\}\}/gu,
  /\{%[^\n]*?%\}/gu,
  /<%[^\n]*?%>/gu,
  /\[object Object\]/gu,
  /\bundefined\b/gu,
  /<[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+>/gu,
  UPPER_ANGLE,
  /__[A-Z][A-Z0-9_]*__/gu,
];

/** 1-based line of a character index within the text. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (text.charCodeAt(position) === 10) line += 1;
  }
  return line;
}

/** `[start, stop)` spans of inline code. */
function codeSpans(text: string): readonly (readonly [number, number])[] {
  return [...text.matchAll(INLINE_CODE)].map((match) => {
    const start = match.index ?? 0;
    return [start, start + match[0].length] as const;
  });
}

/** Inline code is a path-like mention only when it plainly names one. */
function isPathLike(span: string): boolean {
  return (
    !/\s/u.test(span) &&
    span.includes("/") &&
    !PATH_LIKE_EXCLUDED.test(span) &&
    !span.includes("://") &&
    !span.startsWith("-")
  );
}

const stripDotSlash = (span: string): string => (span.startsWith("./") ? span.slice(2) : span);

/**
 * The references a text makes. Link and Kiro syntax inside inline code is quoted
 * (for example `#[[file:...]]` describing the syntax) and is not a reference;
 * inline code itself counts only when it plainly names a path.
 */
function mentionsOf(text: string): readonly Mention[] {
  const mentions: Mention[] = [];
  const code = codeSpans(text);
  const quoted = (index: number) => code.some(([start, stop]) => index >= start && index < stop);
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    if (quoted(match.index ?? 0)) continue;
    const destination = match[1] as string;
    if (destination.startsWith("#") || URI_SCHEME.test(destination)) continue;
    const path = destination.split(/[#?]/u)[0] as string;
    if (path.length === 0) continue;
    mentions.push({
      text: destination,
      path,
      absolute: path.startsWith("/"),
      line: lineAt(text, match.index ?? 0),
    });
  }
  for (const match of text.matchAll(KIRO_FILE)) {
    if (quoted(match.index ?? 0)) continue;
    const path = match[1] as string;
    mentions.push({ text: path, path, absolute: true, line: lineAt(text, match.index ?? 0) });
  }
  for (const match of text.matchAll(INLINE_CODE)) {
    const span = match[1] as string;
    if (!isPathLike(span)) continue;
    mentions.push({
      text: span,
      path: stripDotSlash(span),
      absolute: true,
      line: lineAt(text, match.index ?? 0),
    });
  }
  return mentions;
}

function placeholderMatches(
  text: string,
): readonly { readonly token: string; readonly index: number }[] {
  const found: { token: string; index: number }[] = [];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      // Upper-snake angle tokens are reported only when at least two characters wide.
      if (pattern === UPPER_ANGLE && match[0].length < 4) continue;
      found.push({ token: match[0], index: match.index ?? 0 });
    }
  }
  return found;
}

/** The reference path split around declared placeholders, each replaced by a wildcard. */
function splitPlaceholders(path: string, tokens: readonly string[]): readonly (string | "*")[] {
  if (tokens.length === 0) return [path];
  const pattern = new RegExp(tokens.map(escapeRegExp).join("|"), "gu");
  const pieces: (string | "*")[] = [];
  let last = 0;
  for (const match of path.matchAll(pattern)) {
    const index = match.index ?? 0;
    pieces.push(path.slice(last, index), "*");
    last = index + match[0].length;
  }
  pieces.push(path.slice(last));
  return pieces;
}

/**
 * Resolves one mention against the directory of the text's own installed target
 * (or the project root), collapsing `.`/`..`. Returns undefined when it escapes
 * the project root. A trailing `/` is dropped for comparison; directory
 * references already resolve through the prefix rule.
 */
function normalize(
  mention: Mention,
  base: readonly Part[],
  tokens: readonly string[],
): Path | undefined {
  const pieces = splitPlaceholders(mention.path, tokens);
  const segments: Part[][] = [[]];
  for (const piece of pieces) {
    if (piece === "*") {
      (segments[segments.length - 1] as Part[]).push({ any: true });
      continue;
    }
    for (const [index, text] of piece.split("/").entries()) {
      if (index > 0) segments.push([]);
      if (text !== "") (segments[segments.length - 1] as Part[]).push({ literal: text });
    }
  }
  const normalized: Part[][] = mention.absolute ? [] : base.map((part) => [part]);
  for (const segment of segments) {
    if (segment.length === 0) continue;
    const head = segment[0];
    if (segment.length === 1 && head !== undefined && "literal" in head) {
      if (head.literal === ".") continue;
      if (head.literal === "..") {
        if (normalized.length === 0) return undefined;
        normalized.pop();
        continue;
      }
    }
    normalized.push(segment);
  }
  return normalized;
}

const sourceOf = (reference: readonly Part[]): string =>
  reference.map((part) => ("any" in part ? "[^/]+" : escapeRegExp(part.literal))).join("");

/** Whether a reference segment can match one installed target segment. */
function segmentMatches(reference: readonly Part[], target: Part): boolean {
  if ("any" in target) return reference.some((part) => "any" in part || part.literal.length > 0);
  return new RegExp(`^(?:${sourceOf(reference)})$`, "u").test(target.literal);
}

function equals(target: Target, path: Path): boolean {
  if (path.length !== target.segments.length) return false;
  return target.segments.every((segment, index) => {
    const reference = path[index];
    return reference !== undefined && segmentMatches(reference, segment);
  });
}

function prefixes(target: Target, path: Path): boolean {
  if (path.length >= target.segments.length) return false;
  return path.every((reference, index) => {
    const segment = target.segments[index];
    return segment !== undefined && segmentMatches(reference, segment);
  });
}

const displayPath = (segments: readonly Part[]): string =>
  segments.map((part) => ("any" in part ? "*" : part.literal)).join("/");

const externalTarget = (path: string): Target => {
  const segments = path.split("/").map((segment): Part => ({ literal: segment }));
  return { segments, path: displayPath(segments) };
};

/** The installed target of an operation, plus whether it lives in the project scope. */
function installedTarget(
  operation: Record_,
  inputs: Record_,
): { readonly target: Target; readonly project: boolean } {
  const descriptor = asRecord(operation.target);
  const project = descriptor?.root === "project";
  const raw = descriptor?.segments;
  const unknown: { target: Target; project: false } = {
    target: { segments: [], path: "" },
    project: false,
  };
  if (!Array.isArray(raw)) return unknown;
  const segments: Part[] = [];
  for (const entry of raw) {
    const segment = asRecord(entry);
    if (segment === undefined) return unknown;
    if (typeof segment.literal === "string") {
      segments.push({ literal: segment.literal });
      continue;
    }
    if (typeof segment.input === "string") {
      const spec = asRecord(inputs[segment.input]);
      segments.push(typeof spec?.default === "string" ? { literal: spec.default } : { any: true });
      continue;
    }
    return unknown;
  }
  return { target: { segments, path: displayPath(segments) }, project };
}

/** Every project target and every readable text an authored item's recipe declares. */
function examineRecipe(
  recipe: Record_,
  item: CatalogItem,
  files: ReadonlyMap<string, Uint8Array>,
): { readonly targets: readonly Target[]; readonly texts: readonly ExaminedText[] } {
  const inputs = asRecord(recipe.inputs) ?? {};
  const operations = Array.isArray(recipe.operations) ? recipe.operations : [];
  const materials = new Map(item.materials.map((member) => [member.id, member]));
  const targets: Target[] = [];
  const texts: ExaminedText[] = [];
  for (const raw of operations) {
    const operation = asRecord(raw);
    if (operation === undefined) continue;
    if (operation.kind !== "file.write" && operation.kind !== "text.block") continue;
    const installed = installedTarget(operation, inputs);
    if (installed.project) targets.push(installed.target);
    if (operation.kind === "file.write") {
      const id = operation.material;
      if (typeof id !== "string") continue;
      const member = materials.get(id);
      if (member === undefined) continue;
      const bytes = files.get(member.path);
      if (bytes === undefined) continue;
      let text: string;
      try {
        text = fatalUtf8.decode(bytes);
      } catch {
        continue;
      }
      texts.push({ member: id, target: installed.target, text });
      continue;
    }
    const content = asRecord(operation.content);
    if (content === undefined || typeof content.literal !== "string") continue;
    const id = typeof operation.id === "string" ? operation.id : "";
    texts.push({ member: `operation:${id}`, target: installed.target, text: content.literal });
  }
  return { targets, texts };
}

/** The recipe document of an authored item, `"unreadable"` when it cannot be parsed. */
function readRecipe(
  item: CatalogItem,
  files: ReadonlyMap<string, Uint8Array>,
): Record_ | "unreadable" | undefined {
  const bytes = files.get(item.recipe.path);
  if (bytes === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(fatalUtf8.decode(bytes));
  } catch {
    return "unreadable";
  }
  return asRecord(value as Json) ?? "unreadable";
}

function referenceFindings(
  itemId: string,
  member: string,
  target: Target,
  text: string,
  boundaries: readonly Target[],
  externals: readonly Target[],
  tokens: readonly string[],
): readonly AuthoredFinding[] {
  const base = target.segments.slice(0, -1);
  const findings: AuthoredFinding[] = [];
  for (const mention of mentionsOf(text)) {
    const pattern = normalize(mention, base, tokens);
    const literal = tokens.length === 0 ? pattern : normalize(mention, base, []);
    const resolves =
      pattern !== undefined &&
      (boundaries.some((candidate) => equals(candidate, pattern) || prefixes(candidate, pattern)) ||
        (literal !== undefined && externals.some((external) => equals(external, literal))));
    if (!resolves) {
      findings.push({
        itemId,
        member,
        target: target.path,
        line: mention.line,
        text: mention.text,
      });
    }
  }
  return findings;
}

function placeholderFindings(
  itemId: string,
  member: string,
  target: Target,
  text: string,
  allowed: ReadonlySet<string>,
): readonly AuthoredFinding[] {
  const findings: AuthoredFinding[] = [];
  for (const { token, index } of placeholderMatches(text)) {
    if (allowed.has(token)) continue;
    findings.push({ itemId, member, target: target.path, line: lineAt(text, index), text: token });
  }
  return findings;
}

const sortFindings = (findings: AuthoredFinding[]): readonly AuthoredFinding[] =>
  findings.sort(
    (left, right) =>
      compare(left.itemId, right.itemId) ||
      compare(left.member, right.member) ||
      left.line - right.line ||
      compare(left.text, right.text),
  );

/**
 * Checks the texts of every Catalog-authored item in a complete release: internal
 * references must resolve inside the boundary of the authored source they belong
 * to (or a declared external path), and no placeholder residue may remain outside
 * the source's declared template tokens. Upstream `git` items are not examined.
 *
 * The content boundary of an authored source is the set of installed project
 * targets delivered by all release items carrying that source. Reference and
 * placeholder findings are reported with their item, member, target and line; a
 * recipe that cannot be parsed is reported, never thrown. Pure: no fs, clock or
 * network.
 */
export function checkAuthoredContent(
  release: CatalogRelease,
  files: ReadonlyMap<string, Uint8Array>,
  allowances: readonly AuthoredAllowance[],
): AuthoredContentResult {
  const authoredSources = new Set(
    release.sources
      .filter((source) => source.origin.kind === "authored")
      .map((source) => source.id),
  );
  const declared = new Map<string, AuthoredAllowance>();
  for (const allowance of allowances) {
    if (authoredSources.has(allowance.source)) declared.set(allowance.source, allowance);
  }
  const boundaries = new Map<string, Target[]>();
  for (const id of authoredSources) boundaries.set(id, []);
  const references: AuthoredFinding[] = [];
  const placeholders: AuthoredFinding[] = [];
  const examined: {
    readonly item: CatalogItem;
    readonly sources: readonly string[];
    readonly texts: readonly ExaminedText[];
  }[] = [];

  for (const item of release.items) {
    const sources = item.sourceIds.filter((id) => authoredSources.has(id));
    if (sources.length === 0) continue;
    const recipe = readRecipe(item, files);
    if (recipe === undefined) continue;
    if (recipe === "unreadable") {
      references.push({
        itemId: item.id,
        member: "recipe",
        target: "",
        line: 0,
        text: "recipe unreadable",
      });
      continue;
    }
    const { targets, texts } = examineRecipe(recipe, item, files);
    for (const id of sources) {
      for (const target of targets) boundaries.get(id)?.push(target);
    }
    examined.push({ item, sources, texts });
  }

  for (const { item, sources, texts } of examined) {
    const itemAllowances = sources
      .map((id) => declared.get(id))
      .filter((entry): entry is AuthoredAllowance => entry !== undefined);
    const tokens = [...new Set(itemAllowances.flatMap((entry) => entry.templatePlaceholders))];
    const allowed = new Set(tokens);
    const targets = sources.flatMap((id) => boundaries.get(id) ?? []);
    const externals = itemAllowances.flatMap((entry) => entry.externalPaths.map(externalTarget));
    for (const { member, target, text } of texts) {
      references.push(
        ...referenceFindings(item.id, member, target, text, targets, externals, tokens),
      );
      placeholders.push(...placeholderFindings(item.id, member, target, text, allowed));
    }
  }
  return { references: sortFindings(references), placeholders: sortFindings(placeholders) };
}
