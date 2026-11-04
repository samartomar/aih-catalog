/**
 * Cut-outs: one entry of a shared upstream file becomes its own item file. A hook
 * group of a Claude-shape `hooks.json` becomes a one-entry `hooks.json`; an entry of a
 * client MCP config (`mcpServers.<name>`) becomes a Registry `server.json`. The result is plain
 * data that `buildContent` writes as canonical JSON in the framework's generated source.
 */
import type { CutRequest } from "./model.js";
import { quote } from "./paths.js";
import { EXACT_VERSION } from "./source-link.js";

type Json = unknown;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** RFC 6901 JSON Pointer segments, or null for a malformed pointer. */
export function pointerSegments(pointer: string): string[] | null {
  if (typeof pointer !== "string" || !pointer.startsWith("/") || pointer.length > 512) return null;
  const segments = pointer.slice(1).split("/");
  if (segments.some((segment) => /~(?![01])/.test(segment))) return null;
  return segments.map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function resolve(document: Json, segments: readonly string[]): Json | undefined {
  let at: Json = document;
  for (const segment of segments) {
    if (Array.isArray(at)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(segment)) return undefined;
      at = at[Number(segment)];
    } else if (isRecord(at)) {
      if (!Object.hasOwn(at, segment)) return undefined;
      at = at[segment];
    } else return undefined;
  }
  return at;
}

/** The generated file's name for a cut. */
export const cutFileName = (as: CutRequest["as"]): string =>
  as === "hook" ? "hooks.json" : "server.json";

/** The generated document for one cut, or why the entry cannot be cut. */
export function cutDocument(document: Json, request: CutRequest): Json | string {
  const segments = pointerSegments(request?.pointer);
  if (segments === null) return "the cut needs a JSON Pointer";
  if (request.as === "hook") return hookDocument(document, segments);
  if (request.as === "mcp") return serverDocument(document, segments, request);
  return "a cut is a hook or an mcp entry";
}

function hookDocument(document: Json, segments: readonly string[]): Json | string {
  const [root, event] = segments;
  if (segments.length !== 3 || root !== "hooks" || !/^[A-Z][A-Za-z]*$/.test(String(event)))
    return "a hook cut points at /hooks/<Event>/<index>";
  const group = resolve(document, segments);
  if (!isRecord(group) || !Array.isArray(group.hooks))
    return `${quote(`/${segments.join("/")}`)} is not a hook group`;
  return { hooks: { [event as string]: [group] } };
}

/** `YOUR_X_HERE` or `YOUR_X`: an upstream placeholder for a value the user supplies. */
const PLACEHOLDER = /YOUR_([A-Z0-9]+(?:_[A-Z0-9]+)*?)(?:_HERE)?(?![A-Z0-9_])/g;
const hasPlaceholder = (text: string) => new RegExp(PLACEHOLDER.source).test(text);

interface Variable {
  description: string;
  isRequired: boolean;
  isSecret: boolean;
}

/** An argument value with each placeholder replaced by an `{INPUT}` marker it declares. */
function argument(
  text: string,
  inputs: Readonly<Record<string, string>>,
): { type: "positional"; value: string; variables?: Record<string, Variable> } {
  const variables: Record<string, Variable> = {};
  let value = text;
  for (const [literal, name] of Object.entries(inputs))
    if (value.includes(literal)) {
      value = value.replaceAll(literal, `{${name}}`);
      variables[name] = { description: `Replaces ${literal}`, isRequired: true, isSecret: false };
    }
  value = value.replace(PLACEHOLDER, (_match, name: string) => {
    variables[name] = { description: name, isRequired: true, isSecret: true };
    return `{${name}}`;
  });
  return Object.keys(variables).length > 0
    ? { type: "positional", value, variables }
    : { type: "positional", value };
}

/** npm `name`, `name@version`, `@scope/name@version`. */
function npmSpec(spec: string): { identifier: string; version?: string } {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return { identifier: spec };
  return { identifier: spec.slice(0, at), version: spec.slice(at + 1) };
}

function serverDocument(
  document: Json,
  segments: readonly string[],
  request: CutRequest,
): Json | string {
  if (segments.length !== 2 || segments[0] !== "mcpServers")
    return "an MCP cut points at /mcpServers/<name>";
  const name = segments[1] as string;
  const entry = resolve(document, segments);
  if (!isRecord(entry)) return `${quote(name)} is not an MCP server entry`;
  // An entry without its own description takes the authored one; the entry's own always wins.
  const description = entry.description ?? request.description;
  if (typeof description !== "string" || description.length === 0 || description.length > 1024)
    return `${quote(name)} has no description`;
  const inputs = request.inputs ?? {};
  if (!isRecord(inputs) || !Object.values(inputs).every((value) => typeof value === "string"))
    return "inputs maps literal text to input names";
  if (request.version !== undefined && !EXACT_VERSION.test(request.version))
    return "the pinned version must be exact";
  const server: Record<string, unknown> = { name, description };

  if (typeof entry.url === "string") {
    const type = entry.type === "sse" ? "sse" : "streamable-http";
    if (entry.type !== undefined && entry.type !== "http" && entry.type !== "sse")
      return `${quote(name)} has an unknown remote type`;
    const remote: Record<string, unknown> = { type, url: entry.url };
    if (entry.headers !== undefined) {
      if (!isRecord(entry.headers)) return `${quote(name)} headers must be an object`;
      remote.headers = Object.entries(entry.headers).map(([header, value]) => {
        const text = String(value);
        return hasPlaceholder(text)
          ? {
              name: header,
              description: `The ${header} header: ${text.replace(PLACEHOLDER, (_m, input: string) => `<${input}>`)}`,
              isRequired: true,
              isSecret: true,
            }
          : { name: header, description: header, isRequired: true, isSecret: false, value: text };
      });
    }
    server.remotes = [remote];
    return server;
  }

  const command = entry.command;
  const args = entry.args ?? [];
  if (
    typeof command !== "string" ||
    !Array.isArray(args) ||
    !args.every((a) => typeof a === "string")
  )
    return `${quote(name)} needs a command and string args`;
  const runner = command === "npx" ? "npm" : command === "uvx" ? "pypi" : null;
  if (runner === null)
    return `${quote(name)} starts ${quote(command)}, which has no Registry package form`;
  const flags: string[] = [];
  let index = 0;
  while (index < args.length && /^-/.test(args[index] as string)) {
    flags.push(args[index] as string);
    index += 1;
  }
  const spec = args[index];
  if (spec === undefined) return `${quote(name)} names no package`;
  let identifier: string;
  let pinned: string | undefined;
  if (runner === "npm") {
    const parsed = npmSpec(spec);
    identifier = parsed.identifier;
    pinned = parsed.version;
  } else {
    const [base, version] = spec.split("==");
    identifier = base as string;
    pinned = version;
  }
  if (!/^(?:@[a-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/.test(identifier))
    return `${quote(name)} names an unusual package ${quote(identifier)}`;
  const exact = pinned !== undefined && EXACT_VERSION.test(pinned) ? pinned : undefined;
  if (exact !== undefined && request.version !== undefined && exact !== request.version)
    return `${quote(name)} already pins ${exact}`;
  const version = exact ?? request.version;
  if (version === undefined)
    return `${quote(name)}: the package ${quote(identifier)} has no exact version`;
  const pkg: Record<string, unknown> = {
    registryType: runner,
    identifier,
    version,
    runtimeHint: command,
    transport: { type: "stdio" },
  };
  if (flags.length > 0) pkg.runtimeArguments = flags.map((flag) => argument(flag, inputs));
  const rest = args.slice(index + 1) as string[];
  if (rest.length > 0) pkg.packageArguments = rest.map((value) => argument(value, inputs));
  if (entry.env !== undefined) {
    if (!isRecord(entry.env)) return `${quote(name)} env must be an object`;
    pkg.environmentVariables = Object.entries(entry.env).map(([variable, value]) => {
      const text = String(value);
      return hasPlaceholder(text)
        ? { name: variable, description: variable, isRequired: true, isSecret: true }
        : {
            name: variable,
            description: variable,
            isRequired: true,
            isSecret: false,
            default: text,
          };
    });
  }
  server.packages = [pkg];
  return server;
}
