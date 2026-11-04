/**
 * Lowering a Registry `server.json` to one client's MCP entry, using the field names its
 * profile describes. The entry never holds an input value: each declared input becomes a
 * binding to its typed destination, and the installer inserts the value or a native
 * reference.
 */
import type { AiSetupChange } from "./ai-setup.js";
import { inputMarkers } from "./kinds.js";
import type { Item } from "./model.js";
import type { Binding, RootPath } from "./plan.js";
import type { McpFields } from "./profile.js";
import type { ToolLaunch } from "./tools.js";

interface Argument {
  readonly type: "positional" | "named";
  readonly name?: string;
  readonly value?: string;
}
interface Package {
  readonly registryType: string;
  readonly identifier: string;
  readonly version: string;
  readonly runtimeHint?: string;
  readonly transport?: { readonly type?: string };
  readonly runtimeArguments?: readonly Argument[];
  readonly packageArguments?: readonly Argument[];
  readonly environmentVariables?: readonly { readonly name: string }[];
}
interface Remote {
  readonly type: "streamable-http" | "sse";
  readonly url: string;
  readonly headers?: readonly { readonly name: string }[];
}

/** The package runners the Registry names for npm and PyPI packages, with their pin form. */
const RUNNERS: Readonly<Record<string, { command: string; spec: (pkg: Package) => string }>> = {
  npm: { command: "npx", spec: (pkg) => `${pkg.identifier}@${pkg.version}` },
  pypi: { command: "uvx", spec: (pkg) => `${pkg.identifier}==${pkg.version}` },
};

const pointer = (...segments: string[]) =>
  segments.map((segment) => `/${segment.replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");

const argv = (entries: readonly Argument[] | undefined): string[] =>
  (entries ?? []).flatMap((entry) =>
    entry.type === "named"
      ? [entry.name as string, ...(entry.value === undefined ? [] : [entry.value])]
      : [entry.value as string],
  );

export function lowerServer(
  item: Item,
  fields: McpFields,
):
  | { readonly entry: Record<string, unknown>; readonly inputs: Binding[] }
  | { readonly reason: string } {
  const server = item.server as { packages?: readonly Package[]; remotes?: readonly Remote[] };
  const bind = (input: string, at: Binding["at"]): Binding => ({ item: item.id, input, at });
  const pkg = server.packages?.find(
    (candidate) =>
      RUNNERS[candidate.registryType] && (candidate.transport?.type ?? "stdio") === "stdio",
  );
  if (pkg !== undefined) {
    const stdio = fields.stdio;
    if (stdio === undefined) return { reason: "the client describes no local (stdio) server form" };
    const runner = RUNNERS[pkg.registryType] as (typeof RUNNERS)[string];
    const command = pkg.runtimeHint ?? runner.command;
    const args = [...argv(pkg.runtimeArguments), runner.spec(pkg), ...argv(pkg.packageArguments)];
    const entry: Record<string, unknown> = { ...(stdio.set ?? {}) };
    if (stdio.argv !== undefined) entry[stdio.argv] = [command, ...args];
    else {
      entry[stdio.command as string] = command;
      entry[stdio.args ?? "args"] = args;
    }
    const inputs: Binding[] = [];
    for (const [index, value] of [command, ...args].entries())
      for (const marker of inputMarkers(value)) inputs.push(bind(marker, { argv: index }));
    const variables = pkg.environmentVariables ?? [];
    if (variables.length > 0 && stdio.env === undefined)
      return { reason: "the client describes no environment field for the server's inputs" };
    for (const variable of variables)
      inputs.push(bind(variable.name, { pointer: pointer(stdio.env as string, variable.name) }));
    return { entry, inputs: sortBindings(inputs) };
  }
  const remote = server.remotes?.[0];
  if (remote === undefined)
    return { reason: "the server has no npm or PyPI stdio package and no remote" };
  const form = fields.remote?.[remote.type];
  if (form === undefined) return { reason: `the client describes no ${remote.type} remote form` };
  const entry: Record<string, unknown> = { ...(form.set ?? {}), [form.url]: remote.url };
  const inputs: Binding[] = inputMarkers(remote.url).map((marker) =>
    bind(marker, { pointer: pointer(form.url) }),
  );
  const headers = remote.headers ?? [];
  if (headers.length > 0 && form.headers === undefined)
    return { reason: "the client describes no header field for the server's inputs" };
  for (const header of headers)
    inputs.push(bind(header.name, { pointer: pointer(form.headers as string, header.name) }));
  return { entry, inputs: sortBindings(inputs) };
}

const destination = (binding: Binding) => JSON.stringify(binding.at);
function sortBindings(bindings: Binding[]): Binding[] {
  return bindings.sort((left, right) =>
    left.input < right.input
      ? -1
      : left.input > right.input
        ? 1
        : destination(left) < destination(right)
          ? -1
          : 1,
  );
}

/**
 * A managed AI setup's MCP entry: the acquired executable (a path from the user root, which the
 * installer writes as an absolute path) and the tool's launch arguments for this client. The
 * server's Registry package is not used: the tool is never fetched by a package runner.
 */
export function lowerTool(
  item: Item,
  launch: ToolLaunch,
  fields: McpFields,
  cli: string,
):
  | {
      readonly entry: Record<string, unknown>;
      readonly inputs: Binding[];
      readonly rootPaths: RootPath[];
    }
  | { readonly reason: string } {
  const stdio = fields.stdio;
  if (stdio === undefined) return { reason: "the client describes no local (stdio) server form" };
  const path = launch.path as string;
  const args = [...(launch.clis?.[cli] ?? launch.args)];
  const entry: Record<string, unknown> = { ...(stdio.set ?? {}) };
  let at: string;
  if (stdio.argv !== undefined) {
    entry[stdio.argv] = [path, ...args];
    at = pointer(stdio.argv, "0");
  } else {
    entry[stdio.command as string] = path;
    entry[stdio.args ?? "args"] = args;
    at = pointer(stdio.command as string);
  }
  const server = item.server as { packages?: readonly Package[] };
  const variables =
    server.packages?.find((candidate) => (candidate.transport?.type ?? "stdio") === "stdio")
      ?.environmentVariables ?? [];
  if (variables.length > 0 && stdio.env === undefined)
    return { reason: "the client describes no environment field for the server's inputs" };
  const inputs = variables.map((variable) => ({
    item: item.id,
    input: variable.name,
    at: { pointer: pointer(stdio.env as string, variable.name) },
  }));
  return {
    entry,
    inputs: sortBindings(inputs),
    rootPaths: [{ pointer: at, root: "user", path }],
  };
}

/** An MCP item's own settings, with a recipe's changes for its AI setup applied. */
export function serverSettings(item: Item, launch: ToolLaunch | undefined): AiSetupChange {
  const own: AiSetupChange = {
    ...(item.enabledTools !== undefined ? { enabledTools: item.enabledTools as string[] } : {}),
    ...(item.disabledTools !== undefined ? { disabledTools: item.disabledTools as string[] } : {}),
    ...(item.startupSeconds !== undefined ? { startupSeconds: item.startupSeconds as number } : {}),
    ...(item.callSeconds !== undefined ? { callSeconds: item.callSeconds as number } : {}),
    ...(item.env !== undefined ? { env: item.env as Record<string, string> } : {}),
  };
  const change = launch?.change;
  if (change === undefined) return own;
  const { settings: _settings, env, ...rest } = change;
  return {
    ...own,
    ...rest,
    ...(env !== undefined || own.env !== undefined ? { env: { ...own.env, ...env } } : {}),
  };
}

/**
 * Writes non-secret env and the tool lists the client can express into an entry. Lists the client
 * cannot express, and timeouts no profile describes, are left out; the planner warns about them.
 */
export function applySettings(
  entry: Record<string, unknown>,
  settings: AiSetupChange,
  fields: McpFields,
): { readonly entry: Record<string, unknown> } | { readonly reason: string } {
  const next: Record<string, unknown> = { ...entry };
  if (settings.env !== undefined && Object.keys(settings.env).length > 0) {
    const key = fields.stdio?.env;
    if (key === undefined || fields.stdio === undefined)
      return { reason: "the client describes no environment field for the server's settings" };
    const sorted = Object.fromEntries(
      Object.entries(settings.env).sort(([left], [right]) => (left < right ? -1 : 1)),
    );
    next[key] = { ...(next[key] as Record<string, unknown> | undefined), ...sorted };
  }
  const tools = fields.tools;
  if (settings.enabledTools !== undefined && tools?.enabled !== undefined)
    next[tools.enabled] = [...settings.enabledTools];
  if (settings.disabledTools !== undefined && tools?.disabled !== undefined)
    next[tools.disabled] = [...settings.disabledTools];
  return { entry: next };
}

/** Whether the client can restrict any tool list the settings state. */
export const restricts = (settings: AiSetupChange, fields: McpFields | undefined): boolean =>
  (settings.enabledTools !== undefined && fields?.tools?.enabled !== undefined) ||
  (settings.disabledTools !== undefined && fields?.tools?.disabled !== undefined);
