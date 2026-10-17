/**
 * Translation of one MCP server object, in the project `.mcp.json` shape, into structured TOML
 * `config.entries` for the Codex user configuration (`mcp_servers.<key>`), using only keys
 * Codex documents: `command`, `args`, `env`, `env_vars`, `url`, `bearer_token_env_var`,
 * `http_headers` and `env_http_headers`. Codex documents no `${VAR}` expansion in `args`, `env`
 * values or URLs, so a server is translated only when each reference maps exactly onto a
 * documented environment-forwarding key. Anything else is reported as unsupported with a
 * specific reason; nothing is approximated or dropped.
 * Portable: no Node built-ins.
 */

export interface CodexMcpEntry {
  readonly action: "set";
  readonly path: readonly string[];
  readonly value: { readonly literal: string | readonly string[] };
}

export interface CodexMcpPrerequisite {
  readonly kind: "executable";
  readonly name: string;
}

export type CodexMcpTranslation =
  | {
      readonly supported: true;
      readonly entries: readonly CodexMcpEntry[];
      readonly prerequisites: readonly CodexMcpPrerequisite[];
    }
  | { readonly supported: false; readonly reason: string };

const STDIO_KEYS = new Set(["type", "command", "args", "env"]);
const HTTP_KEYS = new Set(["type", "url", "headers"]);
const REFERENCE_OPEN = "${";
const NAME = "[A-Za-z_][A-Za-z0-9_]*";
/** `${NAME}` or `${NAME:-}` (an empty default), matched as the whole value. */
const FORWARDED_REFERENCE = new RegExp(`^\\$\\{(${NAME})(?::-)?\\}$`);
/** `${NAME}` alone, matched as the whole value. */
const HEADER_REFERENCE = new RegExp(`^\\$\\{(${NAME})\\}$`);
const BEARER_REFERENCE = new RegExp(`^Bearer \\$\\{(${NAME})\\}$`);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const unsupported = (reason: string): CodexMcpTranslation => ({ supported: false, reason });

const entry = (
  key: string,
  path: readonly string[],
  literal: string | readonly string[],
): CodexMcpEntry => ({
  action: "set",
  path: ["mcp_servers", key, ...path],
  value: { literal },
});

function translateStdio(key: string, server: Record<string, unknown>): CodexMcpTranslation {
  if (!isNonEmptyString(server.command)) return unsupported("command-shape");
  const entries: CodexMcpEntry[] = [entry(key, ["command"], server.command)];
  if (server.args !== undefined) {
    const args = server.args;
    if (
      !Array.isArray(args) ||
      args.length === 0 ||
      !args.every((arg) => typeof arg === "string")
    ) {
      return unsupported("args-shape");
    }
    if (args.some((arg) => arg.includes(REFERENCE_OPEN))) {
      return unsupported(`args-placeholder: Codex documents no \${...} expansion in args`);
    }
    entries.push(entry(key, ["args"], [...(args as string[])]));
  }
  if (server.env !== undefined) {
    if (!isObject(server.env) || Object.keys(server.env).length === 0) {
      return unsupported("env-shape");
    }
    const forwarded: string[] = [];
    const literals: CodexMcpEntry[] = [];
    for (const [name, value] of Object.entries(server.env)) {
      if (typeof value !== "string") return unsupported(`env-value ${name}`);
      if (!value.includes(REFERENCE_OPEN)) {
        literals.push(entry(key, ["env", name], value));
        continue;
      }
      const reference = FORWARDED_REFERENCE.exec(value);
      if (reference === null) {
        return unsupported(`env-placeholder ${name}: only \${NAME} or \${NAME:-} is forwardable`);
      }
      if (reference[1] !== name) {
        return unsupported(
          `env-reference-name-mismatch ${name}: env_vars forwards a variable under its own name`,
        );
      }
      forwarded.push(name);
    }
    if (forwarded.length > 0) entries.push(entry(key, ["env_vars"], forwarded));
    entries.push(...literals);
  }
  return {
    supported: true,
    entries,
    prerequisites: [{ kind: "executable", name: server.command }],
  };
}

function translateHttp(key: string, server: Record<string, unknown>): CodexMcpTranslation {
  if (!isNonEmptyString(server.url)) return unsupported("url-shape");
  if (server.url.includes(REFERENCE_OPEN)) {
    return unsupported(`url-placeholder: Codex documents no \${...} expansion in url`);
  }
  const entries: CodexMcpEntry[] = [entry(key, ["url"], server.url)];
  if (server.headers !== undefined) {
    if (!isObject(server.headers) || Object.keys(server.headers).length === 0) {
      return unsupported("headers-shape");
    }
    let bearer: CodexMcpEntry | undefined;
    const literals: CodexMcpEntry[] = [];
    const referenced: CodexMcpEntry[] = [];
    for (const [header, value] of Object.entries(server.headers)) {
      if (typeof value !== "string") return unsupported(`header-value ${header}`);
      if (!value.includes(REFERENCE_OPEN)) {
        literals.push(entry(key, ["http_headers", header], value));
        continue;
      }
      const token = header === "Authorization" ? BEARER_REFERENCE.exec(value) : null;
      const reference = HEADER_REFERENCE.exec(value);
      if (token !== null) {
        bearer = entry(key, ["bearer_token_env_var"], token[1] as string);
      } else if (reference !== null) {
        referenced.push(entry(key, ["env_http_headers", header], reference[1] as string));
      } else {
        return unsupported(
          `header-placeholder ${header}: only Authorization "Bearer \${NAME}" or an exact \${NAME} value is supported`,
        );
      }
    }
    if (bearer !== undefined) entries.push(bearer);
    entries.push(...literals, ...referenced);
  }
  return { supported: true, entries, prerequisites: [] };
}

/**
 * Translates `server` (the offered `.mcp.json` server object for `sourceKey`) into Codex
 * entries and the executables its registration assumes. Pure and deterministic; entry order
 * is command, args, env_vars, env.*, then url, bearer_token_env_var, http_headers.*,
 * env_http_headers.*.
 */
export function translateCodexMcpServer(sourceKey: string, server: unknown): CodexMcpTranslation {
  if (!isNonEmptyString(sourceKey)) return unsupported("source-key-shape");
  if (!isObject(server)) return unsupported("server-shape");
  const type = server.type;
  if (type !== undefined && type !== "stdio" && type !== "http") {
    return unsupported(`unsupported-type ${String(type)}`);
  }
  const transport = type ?? ("command" in server ? "stdio" : undefined);
  if (transport === undefined) return unsupported("transport-unknown");
  const allowed = transport === "stdio" ? STDIO_KEYS : HTTP_KEYS;
  const extra = Object.keys(server).find((name) => !allowed.has(name));
  if (extra !== undefined) return unsupported(`unsupported-key ${extra}`);
  return transport === "stdio"
    ? translateStdio(sourceKey, server)
    : translateHttp(sourceKey, server);
}
