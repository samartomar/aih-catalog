/**
 * File-owned fields per kind: what the bytes of an item's files say. `buildContent`
 * records these values and `checkContent` compares them with the bytes again.
 */
import { parseDocument } from "yaml";
import {
  decodeText,
  type Frontmatter,
  parseFrontmatter,
  splitFrontmatter,
  usesArguments,
} from "./frontmatter.js";
import { canonicalJson } from "./json.js";
import {
  type DiscoveredItem,
  INPUT_NAME,
  INSTALL_NAME,
  type InputDeclaration,
  type RuleScope,
} from "./model.js";
import { basenameOf, dirnameOf, quote } from "./paths.js";
import { packageProblem } from "./server.js";

export type Fields = { name: string; description: string } & Record<string, unknown>;
/** Fields plus the inputs the files declare (MCP) and the markers they use. */
export interface Read {
  readonly fields: Fields;
  readonly declared?: Readonly<Record<string, InputDeclaration>>;
  readonly markers?: readonly string[];
}

type BytesOf = (path: string) => Uint8Array;

const descriptionOk = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 1024;

/** First Markdown heading, else first non-empty line. */
export function firstLine(body: string): string | undefined {
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const heading = lines.find((line) => /^#{1,6}\s+\S/.test(line));
  if (heading) return heading.replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "");
  return lines.find((line) => line.length > 0);
}

const badName = (path: string, name: unknown) =>
  `${path}: the name ${quote(String(name))} is not at most 64 characters of a-z0-9- with single inner hyphens`;
const nameOk = (name: unknown): name is string =>
  typeof name === "string" && name.length <= 64 && INSTALL_NAME.test(name);

function markdown(path: string, bytesOf: BytesOf) {
  const text = decodeText(bytesOf(path));
  if (text === null) return `${path} is not UTF-8 text`;
  const split = splitFrontmatter(text);
  const frontmatter = parseFrontmatter(split.yaml);
  if (typeof frontmatter === "string") return `${path}: ${frontmatter}`;
  return { split, frontmatter };
}

/** Strict JSON from an upstream file: UTF-8, no duplicate keys, plain data. */
export function readJson(bytes: Uint8Array): unknown | { readonly error: string } {
  const text = decodeText(bytes);
  if (text === null) return { error: "not UTF-8 text" };
  const document = parseDocument(text, { schema: "json", uniqueKeys: true, strict: true });
  if (document.errors.length > 0 || document.warnings.length > 0)
    return { error: `not valid JSON: ${(document.errors[0] ?? document.warnings[0])?.message}` };
  try {
    const value = document.toJS({ maxAliasCount: 0 });
    canonicalJson(value);
    return value;
  } catch (error) {
    return { error: `not plain JSON data: ${(error as Error).message}` };
  }
}

const isError = (value: unknown): value is { error: string } =>
  value !== null &&
  typeof value === "object" &&
  "error" in (value as object) &&
  Object.keys(value as object).length === 1;

function ruleScope(frontmatter: Frontmatter): RuleScope | { readonly error: string } {
  const paths = frontmatter.paths ?? frontmatter.globs;
  const list = typeof paths === "string" ? [paths] : paths;
  const globs = (value: unknown): value is string[] =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((glob) => typeof glob === "string" && glob.length > 0);
  if (frontmatter.inclusion !== undefined) {
    if (frontmatter.inclusion === "always") return "always";
    if (frontmatter.inclusion === "manual") return "on-request";
    if (frontmatter.inclusion === "auto") return { byDescription: true };
    if (frontmatter.inclusion === "fileMatch") {
      const match = frontmatter.fileMatchPattern;
      const patterns = typeof match === "string" ? [match] : match;
      return globs(patterns)
        ? { paths: patterns }
        : { error: "a fileMatch rule needs fileMatchPattern globs" };
    }
    return { error: `unknown inclusion ${quote(String(frontmatter.inclusion))}` };
  }
  if (frontmatter.trigger !== undefined) {
    if (frontmatter.trigger === "always_on") return "always";
    if (frontmatter.trigger === "manual") return "on-request";
    if (frontmatter.trigger === "model_decision") return { byDescription: true };
    if (frontmatter.trigger === "glob")
      return globs(list) ? { paths: list } : { error: "a glob rule needs globs" };
    return { error: `unknown trigger ${quote(String(frontmatter.trigger))}` };
  }
  if (frontmatter.alwaysApply === true) return "always";
  if (list !== undefined)
    return globs(list) ? { paths: list } : { error: "paths must be a list of globs" };
  return "always";
}

/**
 * The language folder a rule sits in: `rules/python/testing.md` gives `python`. Rules in
 * `rules/common/` (or directly in `rules/`) are language-neutral and record none.
 */
function languageOf(path: string): string | undefined {
  const [kind, folder, ...rest] = path.split("/");
  if (kind !== "rules" || folder === undefined || rest.length === 0 || folder === "common")
    return undefined;
  return /^[a-z0-9][a-z0-9_-]*$/.test(folder) ? folder : undefined;
}

/** The skill's `SKILL.md`, or for a former command its single Markdown file. */
export function skillFile(files: readonly { sourcePath: string; cli?: string }[]) {
  const general = files.filter((file) => file.cli === undefined);
  const skill = general
    .filter((file) => basenameOf(file.sourcePath) === "SKILL.md")
    .sort(
      (left, right) => left.sourcePath.split("/").length - right.sourcePath.split("/").length,
    )[0];
  if (skill) return { file: skill, command: false };
  const only = general.length === 1 ? general[0] : undefined;
  return only?.sourcePath.endsWith(".md") ? { file: only, command: true } : undefined;
}

function readSkill(item: DiscoveredItem, bytesOf: BytesOf): Read | string {
  const found = skillFile(item.files);
  if (found === undefined) return "a skill needs a SKILL.md, or one Markdown command file";
  const path = found.file.sourcePath;
  const read = markdown(path, bytesOf);
  if (typeof read === "string") return read;
  const { split, frontmatter } = read;
  if (!found.command && split.yaml === null) return `${path} has no frontmatter`;
  // A command's name is its file name; Claude ignores `name` there.
  const name = found.command
    ? basenameOf(path).replace(/\.md$/, "")
    : (frontmatter.name ?? basenameOf(dirnameOf(path)));
  if (!nameOk(name)) return badName(path, name);
  const description = found.command
    ? (frontmatter.description ?? firstLine(split.body))
    : frontmatter.description;
  if (!descriptionOk(description)) return `${path}: description must be 1–1024 characters`;
  const flag = frontmatter["disable-model-invocation"] ?? frontmatter.disableModelInvocation;
  if (flag !== undefined && typeof flag !== "boolean")
    return `${path}: disable-model-invocation must be a boolean`;
  return {
    fields: { name, description, userOnly: flag === true, arguments: usesArguments(split.body) },
  };
}

function readRule(item: DiscoveredItem, bytesOf: BytesOf): Read | string {
  const rule = item.files[0];
  if (rule === undefined || item.files.length !== 1) return "a rule is exactly one file";
  const read = markdown(rule.sourcePath, bytesOf);
  if (typeof read === "string") return read;
  const name = basenameOf(rule.sourcePath).replace(/\.md$/, "");
  if (!nameOk(name)) return badName(rule.sourcePath, name);
  const description = read.frontmatter.description ?? firstLine(read.split.body);
  if (!descriptionOk(description))
    return `${rule.sourcePath}: needs a description, heading or first line of 1–1024 characters`;
  const scope = ruleScope(read.frontmatter);
  if (typeof scope === "object" && "error" in scope) return `${rule.sourcePath}: ${scope.error}`;
  const language = languageOf(rule.sourcePath);
  return { fields: { name, description, scope, ...(language ? { language } : {}) } };
}

/** An agent is one Markdown file in Claude's format: frontmatter fields, the body is the prompt. */
function readAgent(item: DiscoveredItem, bytesOf: BytesOf): Read | string {
  const general = item.files.filter((file) => file.cli === undefined);
  const file = general[0];
  if (file === undefined || general.length !== 1 || !file.sourcePath.endsWith(".md"))
    return "an agent is one Markdown file";
  const read = markdown(file.sourcePath, bytesOf);
  if (typeof read === "string") return read;
  const { frontmatter } = read;
  if (!nameOk(frontmatter.name)) return badName(file.sourcePath, frontmatter.name);
  if (!descriptionOk(frontmatter.description))
    return `${file.sourcePath}: description must be 1–1024 characters`;
  const agent: Record<string, unknown> = { prompt: file.sourcePath };
  const tools = frontmatter.tools;
  if (tools !== undefined) {
    const list = typeof tools === "string" ? tools.split(",").map((tool) => tool.trim()) : tools;
    if (
      !Array.isArray(list) ||
      !list.every((tool) => typeof tool === "string" && /^[A-Za-z][A-Za-z0-9_:.()*-]*$/.test(tool))
    )
      return `${file.sourcePath}: tools must be a list of tool names`;
    agent.tools = list;
  }
  for (const key of ["model", "color"] as const) {
    const value = frontmatter[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length === 0 || value.length > 128)
      return `${file.sourcePath}: ${key} must be text`;
    agent[key] = value;
  }
  if (frontmatter.background !== undefined) {
    if (typeof frontmatter.background !== "boolean")
      return `${file.sourcePath}: background must be a boolean`;
    agent.background = frontmatter.background;
  }
  return { fields: { name: frontmatter.name, description: frontmatter.description, agent } };
}

const kebab = (event: string) => event.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** A hook item's file is a one-entry `hooks.json` in Claude's shape. */
function readHook(item: DiscoveredItem, bytesOf: BytesOf): Read | string {
  const general = item.files.filter((file) => file.cli === undefined);
  const file = general.find((candidate) => basenameOf(candidate.sourcePath) === "hooks.json");
  const kiro = general.find((candidate) => candidate.sourcePath.endsWith(".kiro.hook"));
  if (file === undefined && kiro !== undefined) return readKiroHook(item, kiro.sourcePath, bytesOf);
  if (file === undefined) return "a hook needs its one-entry hooks.json, or a Kiro hook file";
  const value = readJson(bytesOf(file.sourcePath));
  if (isError(value)) return `${file.sourcePath}: ${value.error}`;
  const hooks = (value as { hooks?: unknown })?.hooks;
  const events = hooks !== null && typeof hooks === "object" ? Object.entries(hooks) : [];
  const groups = events[0]?.[1];
  const group = Array.isArray(groups) && groups.length === 1 ? groups[0] : undefined;
  const handlers = group?.hooks;
  const handler = Array.isArray(handlers) && handlers.length === 1 ? handlers[0] : undefined;
  if (events.length !== 1 || group === undefined || typeof handler?.type !== "string")
    return `${file.sourcePath}: a hook file holds exactly one event, group and handler`;
  const [event] = events[0] as [string, unknown];
  if (!/^[A-Z][A-Za-z]*$/.test(event)) return `${file.sourcePath}: unknown event name`;
  const matcher = group.matcher;
  if (matcher !== undefined && (typeof matcher !== "string" || matcher.length > 256))
    return `${file.sourcePath}: matcher must be text`;
  const name = item.id.slice(item.id.lastIndexOf(".") + 1);
  if (!nameOk(name)) return badName(file.sourcePath, name);
  const fields: Fields = {
    name,
    description: `${event} hook${matcher ? ` for ${matcher}` : ""}`.slice(0, 1024),
    event: kebab(event),
    handler: { type: handler.type },
  };
  if (matcher !== undefined) fields.matcher = matcher;
  return { fields };
}

/**
 * A Kiro hook file (`*.kiro.hook`): JSON with `when` (the event and its file patterns) and
 * `then` (what runs). Kiro is the only client that reads it, so it is placed only as Kiro's
 * edition; its event names are Kiro's own.
 */
function readKiroHook(item: DiscoveredItem, path: string, bytesOf: BytesOf): Read | string {
  const value = readJson(bytesOf(path));
  if (isError(value)) return `${path}: ${value.error}`;
  const record = value as Record<string, unknown>;
  const when = record?.when as Record<string, unknown> | undefined;
  const then = record?.then as Record<string, unknown> | undefined;
  if (typeof when?.type !== "string" || !/^[a-z][A-Za-z]*$/.test(when.type))
    return `${path}: a Kiro hook needs when.type`;
  if (typeof then?.type !== "string") return `${path}: a Kiro hook needs then.type`;
  const name = item.id.slice(item.id.lastIndexOf(".") + 1);
  if (!nameOk(name)) return badName(path, name);
  const description =
    typeof record.description === "string" && descriptionOk(record.description)
      ? record.description
      : `${when.type} hook`;
  const patterns = when.patterns ?? when.toolTypes;
  if (
    patterns !== undefined &&
    !(Array.isArray(patterns) && patterns.every((entry) => typeof entry === "string"))
  )
    return `${path}: when.patterns must be a list of text`;
  const fields: Fields = {
    name,
    description,
    event: kebab(when.type),
    handler: { type: then.type },
  };
  if (Array.isArray(patterns) && patterns.length > 0) {
    const matcher = (patterns as string[]).join("|");
    if (matcher.length > 256) return `${path}: the patterns are too long`;
    fields.matcher = matcher;
  }
  return { fields };
}

const MARKER = /\{([A-Za-z_][A-Za-z0-9_-]*)\}/g;
const markersIn = (text: string): string[] =>
  [...text.matchAll(MARKER)].map((match) => match[1] as string);

function inputFrom(
  entry: Record<string, unknown>,
  at: string,
): [string, InputDeclaration] | string {
  const name = entry.name;
  if (typeof name !== "string" || !INPUT_NAME.test(name)) return `${at}: an input needs a name`;
  const isSecret = entry.isSecret === true;
  const declaration: Record<string, unknown> = {
    description:
      typeof entry.description === "string" && entry.description.length > 0
        ? entry.description.slice(0, 1024)
        : name,
    isRequired: entry.isRequired === true,
    isSecret,
  };
  const value = entry.default ?? entry.value;
  if (typeof value === "string" && markersIn(value).length === 0) {
    if (isSecret) return `${at}: a secret input never carries a value`;
    declaration.default = value;
  }
  return [name, declaration as unknown as InputDeclaration];
}

/** An MCP item's file is a Registry `server.json`: packages need exact versions. */
function readMcp(item: DiscoveredItem, bytesOf: BytesOf): Read | string {
  const general = item.files.filter((file) => file.cli === undefined);
  const file = general.find((candidate) => basenameOf(candidate.sourcePath) === "server.json");
  if (file === undefined) return "an MCP item needs its server.json";
  const at = file.sourcePath;
  const value = readJson(bytesOf(at));
  if (isError(value)) return `${at}: ${value.error}`;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return `${at}: server.json is an object`;
  const record = value as Record<string, unknown>;
  const serverName = record.name;
  if (typeof serverName !== "string" || serverName.length === 0 || serverName.length > 256)
    return `${at}: the server needs a name`;
  const name = serverName.slice(serverName.lastIndexOf("/") + 1);
  if (!nameOk(name)) return badName(at, name);
  if (!descriptionOk(record.description)) return `${at}: description must be 1–1024 characters`;
  const declared: Record<string, InputDeclaration> = {};
  const markers: string[] = [];
  const declare = (entries: unknown, where: string): string | undefined => {
    if (entries === undefined) return undefined;
    if (!Array.isArray(entries)) return `${where} must be a list`;
    for (const [index, entry] of entries.entries()) {
      if (entry === null || typeof entry !== "object") return `${where}/${index} must be an object`;
      const input = inputFrom(entry as Record<string, unknown>, `${where}/${index}`);
      if (typeof input === "string") return input;
      if (declared[input[0]] !== undefined)
        return `${where}: the input ${input[0]} is declared twice`;
      declared[input[0]] = input[1];
      if (typeof (entry as { value?: unknown }).value === "string")
        markers.push(...markersIn((entry as { value: string }).value));
    }
    return undefined;
  };
  const argumentsOf = (entries: unknown, where: string): string | undefined => {
    if (entries === undefined) return undefined;
    if (!Array.isArray(entries)) return `${where} must be a list`;
    for (const [index, entry] of entries.entries()) {
      const argument = entry as { type?: unknown; name?: unknown; value?: unknown };
      const ok =
        (argument?.type === "positional" && typeof argument.value === "string") ||
        (argument?.type === "named" &&
          typeof argument.name === "string" &&
          (argument.value === undefined || typeof argument.value === "string"));
      if (!ok) return `${where}/${index}: an argument is positional with a value, or named`;
      if (typeof argument.value === "string") markers.push(...markersIn(argument.value));
      const variables = (entry as { variables?: unknown }).variables;
      if (variables !== undefined) {
        if (variables === null || typeof variables !== "object" || Array.isArray(variables))
          return `${where}/${index}/variables must be an object`;
        const problem = declare(
          Object.entries(variables).map(([name, declaration]) => ({
            ...(declaration as Record<string, unknown>),
            name,
          })),
          `${where}/${index}/variables`,
        );
        if (problem) return problem;
      }
    }
    return undefined;
  };
  const server: Record<string, unknown> = { name: serverName, description: record.description };
  if (record.version !== undefined) {
    if (typeof record.version !== "string") return `${at}: version must be text`;
    server.version = record.version;
  }
  const packages = record.packages;
  if (packages !== undefined) {
    if (!Array.isArray(packages)) return `${at}: packages must be a list`;
    for (const [index, entry] of packages.entries()) {
      const where = `${at}/packages/${index}`;
      const pkg = entry as Record<string, unknown>;
      const problem = packageProblem(pkg);
      if (problem) return `${where}: ${problem}`;
      for (const problem of [
        declare(pkg.environmentVariables, `${where}/environmentVariables`),
        argumentsOf(pkg.runtimeArguments, `${where}/runtimeArguments`),
        argumentsOf(pkg.packageArguments, `${where}/packageArguments`),
      ])
        if (problem) return problem;
    }
    server.packages = packages;
  }
  const remotes = record.remotes;
  if (remotes !== undefined) {
    if (!Array.isArray(remotes)) return `${at}: remotes must be a list`;
    for (const [index, entry] of remotes.entries()) {
      const where = `${at}/remotes/${index}`;
      const remote = entry as Record<string, unknown>;
      if (remote?.type !== "streamable-http" && remote?.type !== "sse")
        return `${where}: a remote is streamable-http or sse`;
      if (typeof remote.url !== "string" || remote.url.length === 0)
        return `${where}: a remote needs its url`;
      markers.push(...markersIn(remote.url));
      const problem = declare(remote.headers, `${where}/headers`);
      if (problem) return problem;
    }
    server.remotes = remotes;
  }
  if (server.packages === undefined && server.remotes === undefined)
    return `${at}: a server needs packages or remotes`;
  return {
    fields: { name, description: record.description, server },
    declared,
    markers: [...new Set(markers)].sort(),
  };
}

function readDocument(item: DiscoveredItem, bytesOf: BytesOf): Read | string {
  const name = item.id.slice(item.id.lastIndexOf(".") + 1);
  if (!nameOk(name)) return badName(item.id, name);
  if (typeof item.purpose !== "string" || item.purpose.length === 0 || item.purpose.length > 256)
    return "a document needs its authored purpose";
  const text = item.files
    .filter((file) => /\.(?:md|txt)$/.test(file.sourcePath))
    .map((file) => decodeText(bytesOf(file.sourcePath)))[0];
  if (text === undefined || text === null) return "a document needs a Markdown or text file";
  const description = firstLine(splitFrontmatter(text).body);
  if (!descriptionOk(description)) return "a document needs a heading or first line";
  return { fields: { name, description, purpose: item.purpose } };
}

/** File-owned fields of one item, or a reason the bytes cannot support it. */
export function readFields(item: DiscoveredItem, bytesOf: BytesOf): Read | string {
  switch (item.kind) {
    case "skill":
      return readSkill(item, bytesOf);
    case "rule":
      return readRule(item, bytesOf);
    case "agent":
      return readAgent(item, bytesOf);
    case "hook":
      return readHook(item, bytesOf);
    case "mcp":
      return readMcp(item, bytesOf);
    case "document":
      return readDocument(item, bytesOf);
    default:
      return `building ${String(item.kind)} items is not implemented yet`;
  }
}

/** Markers `{NAME}` in an MCP value. */
export const inputMarkers = markersIn;
