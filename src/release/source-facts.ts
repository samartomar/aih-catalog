/** Source text is data. This portable interpretation never executes or acquires it. */
import { parseDocument } from "yaml";
import { copyJson } from "./boundary.js";
import type { Json } from "./contracts.js";
import { isRecord, safeMemberPath } from "./document.js";
import { deepFreeze } from "./json.js";
import { sha256Hex } from "./sha256.js";
import { readUpstreamObject } from "./upstream-json.js";

export type SourceProfile =
  | "agent-skills"
  | "claude-skill"
  | "claude-agent"
  | "claude-command"
  | "markdown"
  | "claude-hooks"
  | "claude-mcp-registration";
export interface SourceDiscovery {
  readonly profile: SourceProfile;
  readonly path: string;
  /** Native registration key, never the identity of an individual MCP tool. */
  readonly key?: string;
}
/** Which fallback level produced a display value; recorded as the published basis. */
export type SourceFieldBasis = "authored" | "first-heading" | "key" | "file-name";
export type SourceField =
  | {
      readonly state: "authored";
      readonly value: string;
      readonly locator: string;
      readonly basis: SourceFieldBasis;
    }
  | { readonly state: "absent" | "invalid"; readonly required: boolean; readonly locator: string };
export interface SourceFacts {
  readonly profile: string;
  readonly status: "valid" | "profile-error" | "malformed" | "unsupported";
  readonly identifier: string;
  /** Whether the identifier came from a registration key or the file path. */
  readonly identifierBasis: "key" | "file-name";
  readonly provenance: {
    readonly path: string;
    readonly revision: string;
    readonly sha256: string;
  };
  readonly name: SourceField;
  readonly description: SourceField;
  /** Original source material retains the entire body and extensions; this view retains parsed facts. */
  readonly native: Json;
  /** Known credential-bearing configuration was withheld from the general view. */
  readonly redactions?: readonly { readonly path: string; readonly reason: string }[];
  readonly diagnostics: readonly { readonly field: string; readonly message: string }[];
}

const profiles = new Set<string>([
  "agent-skills",
  "claude-skill",
  "claude-agent",
  "claude-command",
  "markdown",
  "claude-hooks",
  "claude-mcp-registration",
]);

/** A safe general view, not a sanitizer for arbitrary source commands or prose. */
function projectNative(value: Json): {
  native: Json;
  redactions: { path: string; reason: string }[];
} {
  const redactions: { path: string; reason: string }[] = [];
  const withheld = (path: string, reason: string): Json => {
    redactions.push({ path, reason });
    return "[withheld]";
  };
  const visit = (entry: Json, path: string): Json => {
    if (Array.isArray(entry)) return entry.map((child, index) => visit(child, `${path}/${index}`));
    if (!isRecord(entry)) return entry;
    const sensitive = entry.sensitive === true;
    return Object.fromEntries(
      Object.entries(entry).map(([key, child]) => {
        const at = `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
        const field = key.toLowerCase().replace(/[-_]/g, "");
        if (["env", "headers", "httpheaders"].includes(field) && isRecord(child))
          return [
            key,
            Object.fromEntries(
              Object.keys(child).map((name) => [
                name,
                withheld(
                  `${at}/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`,
                  "credential-bearing-map",
                ),
              ]),
            ),
          ];
        if (
          [
            "authorization",
            "proxyauthorization",
            "password",
            "token",
            "accesstoken",
            "refreshtoken",
            "secret",
            "clientsecret",
            "apikey",
            "bearertoken",
          ].includes(field) ||
          (sensitive && ["default", "value", "values", "example", "examples"].includes(field))
        )
          return [key, withheld(at, "sensitive-configuration")];
        if (field === "url" && typeof child === "string") {
          try {
            const url = new URL(child);
            if (!["https:", "http:"].includes(url.protocol))
              return [key, withheld(at, "unsupported-url-scheme")];
            if (url.username || url.password) {
              url.username = "";
              url.password = "";
              redactions.push({ path: at, reason: "url-userinfo" });
            }
            if (url.search) {
              const names = [...url.searchParams.keys()];
              url.search = "";
              for (const name of names) url.searchParams.append(name, "[withheld]");
              redactions.push({ path: at, reason: "url-query-values" });
            }
            if (url.hash) {
              url.hash = "";
              redactions.push({ path: at, reason: "url-fragment" });
            }
            return [key, url.href];
          } catch {
            return [key, withheld(at, "unparsed-url")];
          }
        }
        return [key, visit(child as Json, at)];
      }),
    );
  };
  return { native: visit(value, "/native"), redactions };
}

/** Shared by Catalog compilation and personal intake; supplied bytes and provenance only. */
export function extractSourceFacts(input: {
  readonly profile: string;
  readonly path: string;
  readonly revision: string;
  readonly bytes: Uint8Array;
  readonly key?: string;
}): SourceFacts {
  if (
    !safeMemberPath(input.path) ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.revision) ||
    !(input.bytes instanceof Uint8Array) ||
    input.bytes.byteLength > 1024 * 1024
  )
    throw new TypeError(
      "Source facts require a safe path, immutable revision and at most 1 MiB of bytes.",
    );
  const diagnostics: { field: string; message: string }[] = [];
  const requiredName = input.profile === "agent-skills" || input.profile === "claude-agent";
  const requiredDescription = requiredName;
  let status: SourceFacts["status"] = "valid";
  let native: Json = {};
  let values: Record<string, unknown> = {};
  let prefix = "frontmatter.";
  let nameLocator: string | undefined;
  const field = (key: string, required: boolean, limit: number): SourceField => {
    const locator = key === "name" && nameLocator ? nameLocator : `${prefix}${key}`;
    const value = values[key];
    if (value === undefined) {
      if (required) diagnostics.push({ field: locator, message: "Required value is missing." });
      return { state: "absent", required, locator };
    }
    if (typeof value !== "string" || !value.trim() || value.length > limit) {
      diagnostics.push({
        field: locator,
        message: `Expected a nonempty string of at most ${limit} characters.`,
      });
      return { state: "invalid", required, locator };
    }
    return {
      state: "authored",
      value,
      locator,
      basis: key === "name" && nameLocator === "markdown.heading[1]" ? "first-heading" : "authored",
    };
  };
  try {
    if (!profiles.has(input.profile)) status = "unsupported";
    else {
      const text = new TextDecoder("utf-8", { fatal: true })
        .decode(input.bytes)
        .replace(/\r\n/g, "\n");
      if (input.profile === "claude-mcp-registration" || input.profile === "claude-hooks") {
        const document = readUpstreamObject(input.bytes);
        if (!isRecord(document)) throw new TypeError("Expected a JSON object.");
        if (input.profile === "claude-mcp-registration") {
          if (
            !isRecord(document.mcpServers) ||
            !input.key ||
            !isRecord(document.mcpServers[input.key])
          )
            throw new TypeError("Expected the selected mcpServers registration.");
          values = document.mcpServers[input.key] as Record<string, unknown>;
          prefix = `/mcpServers/${input.key.replace(/~/g, "~0").replace(/\//g, "~1")}/`;
          // Credentials stay in original material, never in the general discovery view.
          native = {
            object: "server-registration",
            key: input.key,
            ...Object.fromEntries(
              ["command", "args", "url", "type"]
                .filter((k) => values[k] !== undefined)
                .map((k) => [k, values[k] as Json]),
            ),
            environmentNames: isRecord(values.env) ? Object.keys(values.env).sort() : [],
            headerNames: isRecord(values.headers) ? Object.keys(values.headers).sort() : [],
          };
          if (
            !(typeof values.command === "string" && values.command.trim()) &&
            !(typeof values.url === "string" && values.url.trim())
          )
            diagnostics.push({
              field: prefix,
              message: "A server registration requires command or URL.",
            });
        } else {
          if (!isRecord(document.hooks)) throw new TypeError("Expected a hooks event map.");
          native = { object: "hook-configuration", events: document.hooks as Json };
          prefix = "/";
          for (const [event, groups] of Object.entries(document.hooks)) {
            if (!Array.isArray(groups)) {
              diagnostics.push({ field: `/hooks/${event}`, message: "Expected matcher groups." });
              continue;
            }
            for (const group of groups) {
              if (!isRecord(group) || !Array.isArray(group.hooks)) {
                diagnostics.push({
                  field: `/hooks/${event}`,
                  message: "Expected a hooks handler array.",
                });
                continue;
              }
              for (const handler of group.hooks) {
                const required: Record<string, readonly string[]> = {
                  command: ["command"],
                  http: ["url"],
                  prompt: ["prompt"],
                  agent: ["prompt"],
                  "mcp-tool": ["server", "tool"],
                };
                if (
                  !isRecord(handler) ||
                  typeof handler.type !== "string" ||
                  !required[handler.type] ||
                  required[handler.type]?.some(
                    (key) => typeof handler[key] !== "string" || !(handler[key] as string).trim(),
                  )
                )
                  diagnostics.push({
                    field: `/hooks/${event}`,
                    message: "Handler requires its supported type and type-specific fields.",
                  });
              }
            }
          }
        }
      } else {
        if (text.startsWith("---\n")) {
          const end = text.indexOf("\n---", 3);
          if (end < 0 || !/^\n---(?:\n|$)/.test(text.slice(end)))
            throw new TypeError("Unterminated frontmatter.");
          const document = parseDocument(text.slice(4, end), { schema: "core", uniqueKeys: true });
          if (document.errors.length || document.warnings.length)
            throw new TypeError("Malformed or unsupported YAML frontmatter.");
          const parsed: unknown = document.toJS({ maxAliasCount: 100 });
          if (parsed !== null && !isRecord(parsed))
            throw new TypeError("Expected frontmatter mapping.");
          values = copyJson(parsed ?? {}) as Record<string, unknown>;
          native = values as Json;
        } else if (input.profile === "agent-skills")
          diagnostics.push({
            field: "frontmatter",
            message: "Agent Skills requires YAML frontmatter.",
          });
        if (input.profile === "markdown") {
          const heading = /^# (.+)$/m.exec(text)?.[1];
          if (values.name === undefined && heading) {
            values.name = heading;
            nameLocator = "markdown.heading[1]";
          }
        }
      }
    }
  } catch (error) {
    status = "malformed";
    diagnostics.push({
      field: input.path,
      message: error instanceof Error ? error.message : "Malformed source.",
    });
  }
  const name = field("name", requiredName, input.profile === "agent-skills" ? 64 : 256);
  const description = field(
    "description",
    requiredDescription,
    input.profile === "agent-skills" ? 1024 : 4096,
  );
  if (
    input.profile === "agent-skills" &&
    name.state === "authored" &&
    (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name.value) || input.path.split("/").at(-2) !== name.value)
  )
    diagnostics.push({
      field: "frontmatter.name",
      message: "Agent Skills name must be lowercase kebab case and match its directory.",
    });
  if (input.profile === "agent-skills") {
    for (const key of ["license", "compatibility", "allowed-tools"]) {
      const value = values[key];
      if (
        value !== undefined &&
        (typeof value !== "string" ||
          !value.trim() ||
          (key === "compatibility" && value.length > 500))
      )
        diagnostics.push({
          field: `frontmatter.${key}`,
          message: "Expected a nonempty source string within the profile's bound.",
        });
    }
    if (
      values.metadata !== undefined &&
      (!isRecord(values.metadata) ||
        Object.values(values.metadata).some((value) => typeof value !== "string"))
    )
      diagnostics.push({
        field: "frontmatter.metadata",
        message: "Agent Skills metadata must map string keys to string values.",
      });
  }
  if (status === "valid" && diagnostics.length) status = "profile-error";
  const projected = projectNative(native);
  return deepFreeze({
    profile: input.profile,
    status,
    identifier: input.key ?? input.path,
    identifierBasis: input.key !== undefined ? "key" : "file-name",
    provenance: { path: input.path, revision: input.revision, sha256: sha256Hex(input.bytes) },
    name,
    description,
    native: projected.native,
    ...(projected.redactions.length ? { redactions: projected.redactions } : {}),
    diagnostics,
  });
}
