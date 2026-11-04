/**
 * The named renders. One implementation serves the planner, which decides from the item and
 * profile alone whether a render applies and what it does, and `renderStep`, which produces
 * the bytes. A Markdown render only sets frontmatter keys and rewords `$ARGUMENTS`;
 * the generated files (Codex `openai.yaml`, native agent files, rule blocks) keep the
 * upstream body or prompt byte for byte.
 *
 * A user-only skill whose folder several clients share takes one combined render
 * (`shared-skill`, `shared-user-only-file`): the union of every sharing client's user-only
 * markers, with `$ARGUMENTS` reworded only when every sharing profile agrees. Clients
 * ignore markers that are not theirs, so the folder's bytes are the same for all of them.
 */
import { parseDocument, stringify } from "yaml";
import {
  applyEdit,
  decodeText,
  type Frontmatter,
  parseFrontmatter,
  splitFrontmatter,
} from "./frontmatter.js";
import { canonicalDocument, canonicalJson } from "./json.js";
import { skillFile } from "./kinds.js";
import type { Content, Item } from "./model.js";
import type { RuleScopeKey, Scope, ToolProfile, UserOnlyFallbackEntry } from "./profile.js";

export type { ToolProfile } from "./profile.js";

export type RenderName =
  | "skill"
  | "user-only-file"
  | "user-only-fallback"
  | "rule"
  | "rule-block"
  | "agent"
  | "shared-skill"
  | "shared-user-only-file"
  | "launcher";
export const renderNames: readonly RenderName[] = [
  "skill",
  "user-only-file",
  "user-only-fallback",
  "rule",
  "rule-block",
  "agent",
  "shared-skill",
  "shared-user-only-file",
  "launcher",
];
/** The combined renders, made from several sharing clients' profiles at once. */
export const sharedRenderNames: readonly RenderName[] = ["shared-skill", "shared-user-only-file"];

/** What a render does, computed without file bytes. Equal edits give equal bytes. */
export type Edit =
  | { readonly kind: "frontmatter"; readonly set: Frontmatter; readonly reword: boolean }
  | { readonly kind: "yaml"; readonly yaml: Readonly<Record<string, unknown>> }
  | { readonly kind: "body" }
  | {
      readonly kind: "agent";
      readonly format: "md" | "toml" | "json";
      readonly fields: Readonly<Record<string, string>>;
      readonly tools?: readonly string[];
    };

export interface RenderRequest {
  readonly name: RenderName;
  readonly entry?: string;
  readonly installName: string;
}

const fold = (text: string): string => text.replace(/\s*\r?\n\s*/g, " ").trim();

export function scopeKeyOf(item: Item): RuleScopeKey {
  const scope = item.scope;
  if (scope === "always" || scope === undefined) return "always";
  if (scope === "on-request") return "on-request";
  return "paths" in scope ? "paths" : "by-description";
}

/**
 * Keys a skill render sets: a former command or renamed skill gets its `name` (a fallback
 * file is named by its path instead), a former command its `description`, and Kiro a
 * folded description.
 */
function skillKeys(
  item: Item,
  profile: ToolProfile,
  installName: string,
  named = true,
): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  const command = skillFile(item.files)?.command === true;
  if (named && (command || installName !== item.name)) set.name = installName;
  if (command || profile.foldDescription) set.description = fold(item.description);
  return set;
}

/**
 * The tool names an agent takes on this profile. Where the client's agent file has no tool
 * list, or no evidenced native name for one of the agent's tools, the agent is written without
 * a tool list and `unrestricted` says why: the planner warns that the restriction is lost.
 */
export function agentTools(
  item: Item,
  profile: ToolProfile,
): { readonly tools?: readonly string[]; readonly unrestricted?: string } {
  const tools = item.agent?.tools;
  const policy = profile.agentFile?.tools;
  if (tools === undefined || tools.length === 0 || policy === "keep") return {};
  if (policy === "none" || policy === undefined)
    return { unrestricted: "the client's agent file has no tool list" };
  const unknown = tools.filter((tool) => policy[tool] === undefined);
  if (unknown.length > 0)
    return { unrestricted: `no evidenced native name for ${unknown.join(", ")}` };
  return { tools: tools.map((tool) => policy[tool] as string) };
}

/** The edit a render makes, or a reason the render does not apply to this item and profile. */
export function renderEdit(
  request: RenderRequest,
  item: Item,
  profile: ToolProfile,
  scope: Scope,
): Edit | { reason: string } {
  const { name, entry, installName } = request;
  if (sharedRenderNames.includes(name)) return { reason: "a shared render takes several profiles" };
  if (name === "skill") {
    if (item.kind !== "skill" || entry !== undefined) return { reason: "skills only" };
    const set: Record<string, unknown> = skillKeys(item, profile, installName);
    if (item.userOnly && profile.userOnly !== "none" && "frontmatter" in profile.userOnly)
      Object.assign(set, profile.userOnly.frontmatter);
    return {
      kind: "frontmatter",
      set,
      reword: item.arguments === true && profile.arguments === "chat-text",
    };
  }
  if (name === "user-only-file") {
    if (
      item.kind !== "skill" ||
      !item.userOnly ||
      profile.userOnly === "none" ||
      !("file" in profile.userOnly)
    )
      return { reason: "the profile marks user-only skills with no file" };
    return { kind: "yaml", yaml: profile.userOnly.file.yaml };
  }
  if (name === "user-only-fallback") {
    const fallback = profile.userOnlyFallback?.[scope]?.find((candidate) => candidate.id === entry);
    if (item.kind !== "skill" || !item.userOnly || fallback === undefined)
      return { reason: "no user-only fallback entry applies" };
    return {
      kind: "frontmatter",
      set: { ...skillKeys(item, profile, installName, false), ...(fallback.frontmatter ?? {}) },
      reword: item.arguments === true && fallback.arguments === "reworded",
    };
  }
  if (name === "rule") {
    const key = scopeKeyOf(item);
    const rule = profile.ruleScopes?.[key];
    if (item.kind !== "rule" || entry !== undefined || rule === undefined)
      return { reason: "no rule scope render applies" };
    const set: Record<string, unknown> = { ...rule.frontmatter };
    const scope = item.scope;
    if (rule.globs !== undefined && typeof scope === "object" && "paths" in scope) {
      const globs = scope.paths;
      set[rule.globs] =
        rule.form === "comma"
          ? globs.join(",")
          : rule.form === "single-or-list" && globs.length === 1
            ? globs[0]
            : [...globs];
    }
    for (const field of rule.describe ?? [])
      set[field] = field === "name" ? installName : fold(item.description);
    return { kind: "frontmatter", set, reword: false };
  }
  if (name === "rule-block") {
    if (item.kind !== "rule") return { reason: "rules only" };
    return { kind: "body" };
  }
  if (name === "agent") {
    const file = profile.agentFile;
    if (item.kind !== "agent" || file === undefined) return { reason: "no agent format applies" };
    if (file.format === "claude-md")
      return {
        kind: "frontmatter",
        set: installName === item.name ? {} : { name: installName },
        reword: false,
      };
    const tools = agentTools(item, profile);
    const fields: Record<string, string> = {};
    for (const field of file.format === "md"
      ? (file.fields ?? ["name", "description"])
      : ["name", "description"])
      fields[field] = field === "name" ? installName : item.description;
    return tools.tools
      ? { kind: "agent", format: file.format, fields, tools: tools.tools }
      : { kind: "agent", format: file.format, fields };
  }
  return { reason: "unknown render" };
}

/**
 * The edit of a render made from `profiles`: a shared render from every sharing client's
 * profile, any other render from exactly one.
 */
export function editFor(
  request: RenderRequest,
  item: Item,
  profiles: readonly ToolProfile[],
  scope: Scope,
): Edit | { reason: string } {
  if (!sharedRenderNames.includes(request.name)) {
    const [profile] = profiles;
    return profiles.length === 1 && profile !== undefined
      ? renderEdit(request, item, profile, scope)
      : { reason: "the render takes one profile" };
  }
  if (item.kind !== "skill" || !item.userOnly) return { reason: "user-only skills only" };
  if (profiles.length < 2) return { reason: "a shared render serves several clients" };
  const markers = profiles.map((profile) => profile.userOnly);
  if (markers.some((marker) => marker === "none"))
    return { reason: "every sharing client marks user-only skills" };
  if (request.name === "shared-user-only-file") {
    const files = markers.flatMap((marker) =>
      marker !== "none" && "file" in marker && marker.file.path === request.entry
        ? [marker.file.yaml]
        : [],
    );
    const [yaml] = files;
    if (yaml === undefined) return { reason: "no sharing client marks user-only with this file" };
    if (files.some((other) => canonicalJson(other) !== canonicalJson(yaml)))
      return { reason: "the sharing clients' user-only files conflict" };
    return { kind: "yaml", yaml };
  }
  if (request.entry !== undefined) return { reason: "the shared skill render has no entry" };
  const [first, ...rest] = profiles.map((profile) =>
    canonicalJson(skillKeys(item, profile, request.installName)),
  );
  if (rest.some((keys) => keys !== first))
    return { reason: "the sharing clients name or describe the skill differently" };
  const set: Record<string, unknown> = skillKeys(
    item,
    profiles[0] as ToolProfile,
    request.installName,
  );
  for (const marker of markers)
    if (marker !== "none" && "frontmatter" in marker)
      for (const [key, value] of Object.entries(marker.frontmatter)) {
        if (key in set && canonicalJson(set[key]) !== canonicalJson(value))
          return { reason: `the sharing clients set ${key} differently` };
        set[key] = value;
      }
  const rewords = profiles.map(
    (profile) => item.arguments === true && profile.arguments === "chat-text",
  );
  if (rewords.some((reword) => reword !== rewords[0]))
    return { reason: "the sharing clients disagree on rewording $ARGUMENTS" };
  return { kind: "frontmatter", set, reword: rewords[0] === true };
}

/** True when the edit can change bytes; the planner copies files whose edit is empty. */
export const changesBytes = (edit: Edit): boolean =>
  edit.kind !== "frontmatter" || edit.reword || Object.keys(edit.set).length > 0;

/** A stable text form of an edit, so placements with equal edits share one step. */
export const editKey = (edit: Edit): string => canonicalJson(edit);

const TOML_ESCAPES: Readonly<Record<string, string>> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r",
};

/** A TOML basic string that decodes to exactly `text`. */
export function tomlString(text: string): string {
  let out = '"';
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    const escaped = TOML_ESCAPES[char];
    if (escaped !== undefined) out += escaped;
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += char;
  }
  return `${out}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function merged(base: unknown, add: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = isRecord(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(add))
    out[key] = isRecord(value) ? merged(out[key], value) : value;
  return out;
}

function setPaths(
  prefix: string[],
  value: Readonly<Record<string, unknown>>,
): [string[], unknown][] {
  return Object.entries(value).flatMap(([key, entry]) =>
    isRecord(entry)
      ? setPaths([...prefix, key], entry)
      : [[[...prefix, key], entry] as [string[], unknown]],
  );
}

/**
 * The bytes of a render. `source` is the item file the step names; a generated file
 * without a source (a new `openai.yaml`) passes none.
 */
export function renderBytes(
  edit: Edit,
  source: Uint8Array | undefined,
): { bytes: Uint8Array } | { reason: string } {
  const encode = (text: string) => ({ bytes: new TextEncoder().encode(text) });
  if (edit.kind === "yaml") {
    if (source === undefined) return encode(stringify(edit.yaml));
    const text = decodeText(source);
    if (text === null) return { reason: "the source file is not UTF-8 text" };
    const document = parseDocument(text, { uniqueKeys: true, strict: true, schema: "core" });
    if (document.errors.length > 0) return { reason: "the source YAML is not valid" };
    const before = document.toJS({ maxAliasCount: 0 });
    if (before !== null && before !== undefined && !isRecord(before))
      return { reason: "the source YAML is not a mapping" };
    for (const [path, value] of setPaths([], edit.yaml)) document.setIn(path, value);
    const output = String(document);
    const after = parseDocument(output, { schema: "core" }).toJS();
    if (canonicalJson(after) !== canonicalJson(merged(before, edit.yaml)))
      return { reason: "render guard: the YAML changed beyond the set keys" };
    return encode(output);
  }
  if (source === undefined) return { reason: "the render needs its source file" };
  const text = decodeText(source);
  if (text === null) return { reason: "the source file is not UTF-8 text" };
  if (edit.kind === "frontmatter") {
    const result = applyEdit(text, edit);
    return "reason" in result ? result : encode(result.text);
  }
  const split = splitFrontmatter(text);
  if (typeof parseFrontmatter(split.yaml) === "string")
    return { reason: "the source frontmatter is not valid" };
  const body = split.body;
  if (edit.kind === "body") return encode(body);
  // Native agent files: generated fields, the prompt kept exactly.
  const { fields, tools } = edit;
  if (edit.format === "json") {
    const document: Record<string, unknown> = { ...fields, prompt: body };
    if (tools) document.tools = tools;
    return encode(canonicalDocument(document));
  }
  if (edit.format === "toml") {
    const lines = [
      `name = ${tomlString(fields.name as string)}`,
      `description = ${tomlString(fields.description as string)}`,
      `developer_instructions = ${tomlString(body)}`,
    ];
    return encode(`${lines.join("\n")}\n`);
  }
  const head = Object.entries(fields).map(([key, value]) => ({ [key]: value }));
  if (tools) head.push({ tools: [...tools] } as never);
  const yaml = head.map((entry) => stringify(entry, { lineWidth: 0 })).join("");
  const output = `---\n${yaml}---\n${body}`;
  if (splitFrontmatter(output).body !== body) return { reason: "render guard: the prompt changed" };
  return encode(output);
}

/** Frontmatter lines for a generated Markdown file; empty when no key is set. */
function frontmatterBlock(set: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(set);
  if (entries.length === 0) return "";
  const yaml = entries
    .map(([key, value]) => stringify({ [key]: value }, { lineWidth: 0 }))
    .join("");
  return `---\n${yaml}---\n`;
}

/** A path from the plan root as the text of an installed file names it (`~/` at user scope). */
const shown = (path: string, scope: Scope) => (scope === "user" ? `~/${path}` : path);

/**
 * A launcher: one line that tells the agent to read and follow the installed `SKILL.md`,
 * passing on the user's arguments where the fallback entry keeps them, with the entry's own
 * frontmatter (Kiro manual steering: `inclusion: manual`).
 */
export function launcherBytes(
  target: string,
  entry: UserOnlyFallbackEntry,
  scope: Scope,
): Uint8Array {
  const line =
    entry.arguments === "kept"
      ? `Read and follow \`${shown(target, scope)}\`. The user's argument: $ARGUMENTS\n`
      : `Read and follow \`${shown(target, scope)}\`.\n`;
  return new TextEncoder().encode(`${frontmatterBlock(entry.frontmatter ?? {})}${line}`);
}

/** One placed bundle, as the bundle-root rule names it. */
export interface NamedBundle {
  readonly framework: string;
  readonly layout: string;
  readonly root: string;
  readonly folders: readonly string[];
}

/**
 * The bundles a bundle-root render names, looked up in the supplied content: each one's
 * framework name, skill layout and root folders. Undefined when a bundle is not supplied.
 */
export function namedBundles(
  entries: readonly { readonly bundle: string; readonly root: string }[],
  contents: readonly Content[],
): NamedBundle[] | { readonly unknown: string } {
  const named: NamedBundle[] = [];
  for (const entry of entries) {
    const found = contents
      .map((content) => ({
        content,
        bundle: content.bundles?.find((bundle) => bundle.id === entry?.bundle),
      }))
      .find((candidate) => candidate.bundle !== undefined);
    if (found?.bundle === undefined || typeof entry.root !== "string")
      return { unknown: String(entry?.bundle) };
    named.push({
      framework: found.content.framework.name,
      layout: found.bundle.layout,
      root: entry.root,
      folders: [
        ...new Set(found.bundle.files.map((file) => file.sourcePath.split("/")[0] as string)),
      ].sort(),
    });
  }
  return named;
}

const listed = (names: readonly string[]): string => {
  const quoted = names.map((name) => `\`${name}\``);
  return quoted.length <= 1
    ? (quoted[0] ?? "")
    : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
};

/**
 * The bundle-root rule: no client resolves a bundle's relative paths from the skill
 * folder up to the bundle root, so an always-on rule names each placed bundle's root. A rule
 * file takes the profile's always-on frontmatter; a Markdown block (`frontmatter` undefined)
 * is the text alone.
 */
export function bundleRootBytes(
  bundles: readonly NamedBundle[],
  scope: Scope,
  frontmatter?: Readonly<Record<string, unknown>>,
): Uint8Array {
  const lines = bundles.map((bundle) => {
    const root = bundle.root === "" ? "the project root" : `\`${shown(bundle.root, scope)}\``;
    const skills = `${shown(bundle.root, scope)}${bundle.layout.replace(/<name>\/$/, "")}`;
    return `- ${bundle.framework}: its skills in \`${skills}\` and its agents read ${listed(bundle.folders.map((folder) => `${folder}/`))} relative to ${root}.`;
  });
  const text = [
    "# Bundle roots",
    "",
    "Some installed skills read shared files from a bundle root. Resolve those paths against the root named here.",
    "",
    ...lines,
    "",
  ].join("\n");
  return new TextEncoder().encode(`${frontmatterBlock(frontmatter ?? {})}${text}`);
}
