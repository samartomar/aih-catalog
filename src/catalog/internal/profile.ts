/**
 * Tool profiles: pure data describing where each kind lands for one client, how it is
 * serialized and which native mechanisms exist. Nothing here is executable; the planner and
 * the renders read these values. A section a client lacks is left out (not described) or
 * listed in `unsupported` with the reason, never invented.
 */
import { formats, kinds, type Problem } from "../contracts.js";
import { isRecord, isText, Problems, TEXT_LIMITS } from "./check.js";
import type { Frontmatter } from "./frontmatter.js";
import { FRAMEWORK_ID } from "./model.js";
import { isSafeRelativePath } from "./paths.js";

export type Scope = "project" | "user";
export const SCOPES: readonly Scope[] = ["project", "user"];

/** A folder or file template with `<name>`, or a place shared with other clients when planned. */
export type Place = string | { readonly reuse: readonly string[]; readonly otherwise: string };

/** A rule lands as its own file, or as an owned block in a shared Markdown file. */
export type RulePlace =
  | string
  | { readonly merge: "markdown"; readonly file: string; readonly limitBytes?: number };

export const RULE_SCOPE_KEYS = ["always", "paths", "on-request", "by-description"] as const;
export type RuleScopeKey = (typeof RULE_SCOPE_KEYS)[number];

export interface McpPlace {
  readonly file: string;
  readonly format: "json" | "toml";
  /** A JSON Pointer (json) or dotted table name (toml) with `<name>`. */
  readonly key: string;
}

export interface UserOnlyFallbackEntry {
  readonly id: string;
  readonly path: string;
  readonly frontmatter?: Frontmatter;
  readonly arguments: "kept" | "reworded";
}

/** How the client's MCP entry spells each server.json concept; absent means unsupported. */
export interface McpFields {
  readonly stdio?: {
    readonly command?: string;
    readonly args?: string;
    /** One array holding the command and its arguments (OpenCode). */
    readonly argv?: string;
    readonly env?: string;
    readonly set?: Readonly<Record<string, string>>;
  };
  /**
   * The entry fields that restrict a server's tools: an allow list (`enabled`) and a deny list
   * (`disabled`). Absent where the client documents neither.
   */
  readonly tools?: { readonly enabled?: string; readonly disabled?: string };
  readonly remote?: Readonly<
    Partial<
      Record<
        "streamable-http" | "sse",
        {
          readonly url: string;
          readonly headers?: string;
          readonly set?: Readonly<Record<string, string>>;
        }
      >
    >
  >;
}

/** Native input-reference support per destination surface. */
export type InputReference = "none" | "unknown" | { readonly syntax: string };
export const INPUT_SURFACES = ["file", "mcp-argv", "mcp-env", "mcp-header"] as const;
export type InputSurface = (typeof INPUT_SURFACES)[number];

/** A reliable presence check for an installed plugin (argv and expected readback), or none. */
export type PluginVerify = "none" | { readonly argv: readonly string[]; readonly expect: string };

/**
 * How the client installs a native plugin at a pinned commit. `pin` says whether that commit
 * survives the client's own update; only `holds` with an unattended `install` gives a `plugin`
 * route. `pinForm` is how the pin is written: through the marketplace the step names
 * (`marketplace`), through a local marketplace the plan writes at `marketplaceFolder`
 * (`local-marketplace`), or in the plugin spec itself (`spec`). `install` and `remove` are
 * argv templates for the installer (`<plugin>`, `<marketplace>`, `<marketplace-name>`,
 * `<repository>`, `<commit>`, `<scope>`); Catalog runs none of them.
 */
export interface PluginInstall {
  readonly pin: "holds" | "drops-on-update" | "none";
  readonly scopes?: readonly Scope[];
  readonly pinForm?: "marketplace" | "local-marketplace" | "spec";
  readonly marketplaceFolder?: string;
  readonly install?: readonly (readonly string[])[];
  readonly remove?: readonly (readonly string[])[];
  readonly verify: PluginVerify;
  /** Warning codes every plugin route on this client carries (Copilot: `cli-only-plugin`). */
  readonly warnings?: readonly string[];
}

/**
 * Where the client loads a plugin from a folder at one scope: the folder (`<framework>`,
 * `<plugin>`), the manifest files the copied plugin must hold (any one of them), the
 * structured entries that register it (`<marketplace>`, `<plugin>`, `<folder>`), and the
 * warnings the route carries.
 */
export interface LocalPluginPlace {
  readonly folder: string;
  readonly manifests: readonly string[];
  readonly register?: readonly {
    readonly file: string;
    readonly format: "json";
    readonly key: string;
    readonly entry: unknown;
  }[];
  readonly warnings?: readonly string[];
}

/** Kinds a client's built-ins are listed under; commands share the skill namespace. */
export const PROVIDED_KINDS = ["skill", "command", "agent"] as const;
export type ProvidedKind = (typeof PROVIDED_KINDS)[number];

/**
 * How a client switches off a built-in that a recipe override replaces: `sameName` when a
 * placed item of the built-in's name replaces it, a keyed `setting` entry (`<name>` is the
 * built-in) that turns a provided skill off, a `manual` mechanism a plan cannot own as one
 * entry, and the warnings every override on the client carries.
 */
export type DisableBuiltIn =
  | "not-documented"
  | {
      readonly sameName?: "replaces";
      readonly setting?: {
        readonly root: Scope;
        readonly file: string;
        readonly format: "json";
        readonly key: string;
        readonly entry: unknown;
      };
      readonly manual?: string;
      readonly warnings?: readonly string[];
    };

export interface ToolProfile {
  readonly schema: string;
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly checkedWith: readonly {
    readonly app: string;
    readonly version: string;
    readonly date: string;
  }[];
  readonly places: {
    readonly skill?: Readonly<Partial<Record<Scope, Place>>>;
    readonly agent?: Readonly<Partial<Record<Scope, Place>>>;
    readonly rule?: Readonly<
      Partial<Record<Scope, Readonly<Partial<Record<RuleScopeKey, RulePlace>>>>>
    >;
    readonly mcp?: Readonly<Partial<Record<Scope, McpPlace>>>;
    readonly document?: Readonly<Partial<Record<Scope, string>>>;
  };
  /** Folders that take an upstream edition's files as they are, by kind and scope. */
  readonly editionPlaces?: Readonly<
    Partial<Record<"agent" | "rule" | "hook", Readonly<Partial<Record<Scope, string>>>>>
  >;
  /** Kinds the client cannot take as files, with the reason. */
  readonly unsupported?: Readonly<Partial<Record<string, string>>>;
  readonly links: { readonly skill: "documented" | "not-documented" };
  readonly userOnly:
    | "none"
    | { readonly frontmatter: Frontmatter }
    | {
        readonly file: { readonly path: string; readonly yaml: Readonly<Record<string, unknown>> };
      };
  readonly userOnlyFallback?: Readonly<Partial<Record<Scope, readonly UserOnlyFallbackEntry[]>>>;
  readonly arguments: "substituted" | "chat-text";
  /** Kiro shows a YAML block-scalar description literally, so renders fold it to one line. */
  readonly foldDescription?: true;
  readonly agentFile?: {
    readonly format: "claude-md" | "md" | "toml" | "json";
    /** For `md`: the record fields written as frontmatter, in this order. */
    readonly fields?: readonly ("name" | "description")[];
    /** `keep` (Claude names), `none` (no tool field) or neutral → native names. */
    readonly tools: "keep" | "none" | Readonly<Record<string, string>>;
    readonly model: "keep" | "drop";
  };
  readonly ruleScopes?: Readonly<
    Partial<
      Record<
        RuleScopeKey,
        {
          readonly frontmatter: Frontmatter;
          readonly globs?: string;
          readonly form?: "list" | "comma" | "single-or-list";
          readonly describe?: readonly ("name" | "description")[];
        }
      >
    >
  >;
  /** Neutral hook events to the client's names; used to check editions only. */
  readonly hookEvents?: Readonly<Record<string, string>>;
  readonly mcpFile?: McpFields;
  readonly inputReferences: Readonly<Record<InputSurface, InputReference>>;
  readonly plugins?: PluginInstall;
  readonly localPlugins?: Readonly<Partial<Record<Scope, LocalPluginPlace>>>;
  /**
   * Where a runtime bundle's root goes when it is not the parent of the client's skills folder
   * (`<framework>`): Kiro, which auto-loads every `.kiro/skills` folder and ignores the user-only
   * flag, keeps bundles in `.kiro/aih/<framework>/`, started only through launchers.
   */
  readonly bundleRoot?: Readonly<Partial<Record<Scope, string>>>;
  /**
   * Configuration files and folders (ending in `/`) the client reads that no other section
   * names, such as a user-wide MCP file: nothing Catalog places ever lands on them.
   */
  readonly configFiles?: Readonly<Partial<Record<Scope, readonly string[]>>>;
  /** Warning codes a plan carries when it places a bundle for this client. */
  readonly bundleWarnings?: readonly string[];
  /** Copilot: when both shared skill folders are planned, VS Code is told to read one. */
  readonly skillFolderOverlap?: {
    readonly folders: readonly string[];
    readonly merge: {
      readonly file: string;
      readonly format: "json";
      readonly key: string;
      readonly entry: unknown;
    };
    readonly warnings: readonly string[];
  };
  /** What the client already supplies, by name: built-in skills, commands and agents. */
  readonly provides?: Readonly<Partial<Record<ProvidedKind, readonly string[]>>>;
  readonly disableBuiltIn?: DisableBuiltIn;
}

const isString = (value: unknown, max: number = TEXT_LIMITS.profile): value is string =>
  isText(value, max);
const SCALAR = (value: unknown): boolean =>
  typeof value === "boolean" || typeof value === "number" || isString(value, 256);
const KEY = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const frontmatterOk = (value: unknown): boolean =>
  isRecord(value) && Object.entries(value).every(([key, entry]) => KEY.test(key) && SCALAR(entry));

/** A safe relative template; `name` requires `<name>`, `folder` requires a trailing slash. */
function template(value: unknown, folder: boolean, name = true): boolean {
  if (!isString(value)) return false;
  if (name && !value.includes("<name>")) return false;
  if (folder !== value.endsWith("/")) return false;
  const filled = value.replaceAll("<name>", "x");
  return isSafeRelativePath(folder ? filled.slice(0, -1) : filled);
}

const TOP = [
  "schema",
  "id",
  "name",
  "version",
  "checkedWith",
  "places",
  "editionPlaces",
  "unsupported",
  "links",
  "userOnly",
  "userOnlyFallback",
  "arguments",
  "foldDescription",
  "agentFile",
  "ruleScopes",
  "hookEvents",
  "mcpFile",
  "inputReferences",
  "plugins",
  "localPlugins",
  "bundleRoot",
  "configFiles",
  "bundleWarnings",
  "skillFolderOverlap",
  "provides",
  "disableBuiltIn",
];

const PLACEHOLDERS = ["<framework>", "<plugin>", "<marketplace>", "<folder>"];
/** A safe relative template; placeholders count as one segment each. */
function routeTemplate(value: unknown, folder: boolean): boolean {
  if (!isString(value)) return false;
  if (folder !== value.endsWith("/")) return false;
  let filled = folder ? value.slice(0, -1) : value;
  for (const placeholder of PLACEHOLDERS) filled = filled.replaceAll(placeholder, "x");
  return !filled.includes("<") && isSafeRelativePath(filled);
}
const argvList = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (argv) => Array.isArray(argv) && argv.length > 0 && argv.every((entry) => isString(entry, 512)),
  );
const warningList = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) && value.every((code) => isString(code, 64) && /^[a-z0-9-]+$/.test(code)));

function checkPlugins(value: unknown, problems: Problems): void {
  if (!isRecord(value)) {
    problems.add("/plugins", "must be an object");
    return;
  }
  problems.keys(
    value,
    "/plugins",
    ["pin", "scopes", "pinForm", "marketplaceFolder", "install", "remove", "verify", "warnings"],
    ["pin", "verify"],
  );
  problems.check(
    ["holds", "drops-on-update", "none"].includes(value.pin as string),
    "/plugins/pin",
    "holds, drops-on-update or none",
  );
  if (value.scopes !== undefined)
    problems.check(
      Array.isArray(value.scopes) &&
        value.scopes.length > 0 &&
        value.scopes.every((scope) => scope === "project" || scope === "user") &&
        new Set(value.scopes).size === value.scopes.length,
      "/plugins/scopes",
      "a list of project and user",
    );
  if (value.pinForm !== undefined)
    problems.check(
      ["marketplace", "local-marketplace", "spec"].includes(value.pinForm as string),
      "/plugins/pinForm",
      "marketplace, local-marketplace or spec",
    );
  problems.check(
    (value.pinForm === "local-marketplace") === (value.marketplaceFolder !== undefined),
    "/plugins/marketplaceFolder",
    "a local-marketplace pin names its folder, and only it",
  );
  if (value.marketplaceFolder !== undefined)
    problems.check(
      routeTemplate(value.marketplaceFolder, true),
      "/plugins/marketplaceFolder",
      "a safe folder template ending in /",
    );
  for (const key of ["install", "remove"])
    if (value[key] !== undefined)
      problems.check(argvList(value[key]), `/plugins/${key}`, "a list of argv templates");
  if (value.pin === "holds")
    problems.check(
      value.scopes !== undefined && value.pinForm !== undefined && value.install !== undefined,
      "/plugins",
      "a holding pin names its scopes, pin form and install",
    );
  const verify = value.verify;
  problems.check(
    verify === "none" ||
      (isRecord(verify) &&
        Object.keys(verify).sort().join() === "argv,expect" &&
        argvList([verify.argv]) &&
        isString(verify.expect, 512)),
    "/plugins/verify",
    "none or { argv, expect }",
  );
  problems.check(warningList(value.warnings), "/plugins/warnings", "a list of warning codes");
}

function checkLocalPlugins(value: unknown, problems: Problems): void {
  byScope(value, "/localPlugins", problems, (entry, path) => {
    if (!isRecord(entry)) {
      problems.add(path, "a local-plugin place is { folder, manifests, register?, warnings? }");
      return;
    }
    problems.keys(
      entry,
      path,
      ["folder", "manifests", "register", "warnings"],
      ["folder", "manifests"],
    );
    problems.check(routeTemplate(entry.folder, true), `${path}/folder`, "a safe folder template");
    problems.check(
      Array.isArray(entry.manifests) &&
        entry.manifests.length > 0 &&
        entry.manifests.every((manifest) => isSafeRelativePath(manifest)),
      `${path}/manifests`,
      "the manifest paths a copied plugin holds",
    );
    if (entry.register !== undefined)
      problems.check(
        Array.isArray(entry.register) &&
          entry.register.every(
            (merge) =>
              isRecord(merge) &&
              Object.keys(merge).sort().join() === "entry,file,format,key" &&
              routeTemplate(merge.file, false) &&
              merge.format === "json" &&
              isString(merge.key) &&
              merge.key.startsWith("/"),
          ),
        `${path}/register`,
        "register lists { file, format: json, key, entry }",
      );
    problems.check(warningList(entry.warnings), `${path}/warnings`, "a list of warning codes");
  });
}

function checkPlace(place: unknown, folder: boolean, path: string, problems: Problems): void {
  if (typeof place === "string") {
    problems.check(template(place, folder), path, "not a safe template with <name>");
    return;
  }
  if (!isRecord(place)) {
    problems.add(path, "a place is a template or { reuse, otherwise }");
    return;
  }
  problems.keys(place, path, ["reuse", "otherwise"], ["reuse", "otherwise"]);
  problems.check(
    Array.isArray(place.reuse) &&
      place.reuse.length > 0 &&
      place.reuse.every((entry) => template(entry, folder)),
    `${path}/reuse`,
    "reuse lists safe templates",
  );
  problems.check(template(place.otherwise, folder), `${path}/otherwise`, "unsafe template");
}

function byScope(
  value: unknown,
  path: string,
  problems: Problems,
  each: (v: unknown, p: string) => void,
) {
  if (!isRecord(value)) {
    problems.add(path, "must map project or user to a place");
    return;
  }
  for (const [scope, entry] of Object.entries(value)) {
    if (scope !== "project" && scope !== "user") problems.add(`${path}/${scope}`, "unknown scope");
    else each(entry, `${path}/${scope}`);
  }
}

/** Shape problems of a tool profile; unknown sections are invalid. */
export function profileProblems(value: unknown): Problem[] {
  const problems = new Problems();
  if (!isRecord(value)) return [{ path: "", message: "a tool profile must be an object" }];
  problems.keys(value, "", TOP, [
    "schema",
    "id",
    "name",
    "version",
    "checkedWith",
    "places",
    "links",
    "userOnly",
    "arguments",
    "inputReferences",
  ]);
  problems.check(
    value.schema === formats.toolProfile,
    "/schema",
    `schema must be ${formats.toolProfile}`,
  );
  problems.check(
    isString(value.id, 64) && FRAMEWORK_ID.test(value.id),
    "/id",
    "invalid profile id",
  );
  problems.check(isString(value.name, 200), "/name", "name must be 1–200 characters");
  problems.check(
    Number.isSafeInteger(value.version) && (value.version as number) >= 1,
    "/version",
    "version must be a positive integer",
  );
  problems.check(
    Array.isArray(value.checkedWith) &&
      value.checkedWith.length > 0 &&
      value.checkedWith.every(
        (entry) =>
          isRecord(entry) &&
          Object.keys(entry).sort().join() === "app,date,version" &&
          isString(entry.app, 64) &&
          isString(entry.version, 64) &&
          typeof entry.date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(entry.date),
      ),
    "/checkedWith",
    "checkedWith lists { app, version, date }",
  );

  const places = value.places;
  if (!isRecord(places)) problems.add("/places", "places must be an object");
  else {
    problems.keys(places, "/places", ["skill", "agent", "rule", "mcp", "document"]);
    if (places.skill !== undefined)
      byScope(places.skill, "/places/skill", problems, (entry, path) =>
        checkPlace(entry, true, path, problems),
      );
    if (places.agent !== undefined)
      byScope(places.agent, "/places/agent", problems, (entry, path) =>
        checkPlace(entry, false, path, problems),
      );
    if (places.document !== undefined)
      byScope(places.document, "/places/document", problems, (entry, path) =>
        problems.check(template(entry, true), path, "a document place is a folder template"),
      );
    if (places.rule !== undefined)
      byScope(places.rule, "/places/rule", problems, (entry, path) => {
        if (!isRecord(entry)) {
          problems.add(path, "rule places map rule scopes to places");
          return;
        }
        for (const [scope, place] of Object.entries(entry)) {
          const at = `${path}/${scope}`;
          if (!(RULE_SCOPE_KEYS as readonly string[]).includes(scope)) {
            problems.add(at, "unknown rule scope");
            continue;
          }
          if (typeof place === "string") {
            problems.check(template(place, false), at, "not a safe file template with <name>");
            continue;
          }
          if (!isRecord(place)) {
            problems.add(at, "a rule place is a file template or a markdown merge");
            continue;
          }
          problems.keys(place, at, ["merge", "file", "limitBytes"], ["merge", "file"]);
          problems.check(place.merge === "markdown", `${at}/merge`, "merge is markdown");
          problems.check(template(place.file, false, false), `${at}/file`, "unsafe file");
          if (place.limitBytes !== undefined)
            problems.check(
              Number.isSafeInteger(place.limitBytes) && (place.limitBytes as number) > 0,
              `${at}/limitBytes`,
              "a positive byte count",
            );
        }
      });
    if (places.mcp !== undefined)
      byScope(places.mcp, "/places/mcp", problems, (entry, path) => {
        if (!isRecord(entry)) {
          problems.add(path, "an MCP place is { file, format, key }");
          return;
        }
        problems.keys(entry, path, ["file", "format", "key"], ["file", "format", "key"]);
        problems.check(template(entry.file, false, false), `${path}/file`, "unsafe file");
        problems.check(
          entry.format === "json" || entry.format === "toml",
          `${path}/format`,
          "json or toml",
        );
        problems.check(
          isString(entry.key) &&
            entry.key.includes("<name>") &&
            (entry.format === "json"
              ? entry.key.startsWith("/")
              : /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_<>-]+)*$/.test(entry.key)),
          `${path}/key`,
          "a JSON Pointer or table name with <name>",
        );
      });
  }

  if (value.editionPlaces !== undefined) {
    const editions = value.editionPlaces;
    if (!isRecord(editions)) problems.add("/editionPlaces", "must be an object");
    else
      for (const [kind, entry] of Object.entries(editions)) {
        if (!["agent", "rule", "hook"].includes(kind))
          problems.add(`/editionPlaces/${kind}`, "editions place agents, rules or hooks");
        else
          byScope(entry, `/editionPlaces/${kind}`, problems, (folder, path) =>
            problems.check(template(folder, true, false), path, "a safe folder ending in /"),
          );
      }
  }
  if (value.unsupported !== undefined) {
    const unsupported = value.unsupported;
    problems.check(
      isRecord(unsupported) &&
        Object.entries(unsupported).every(
          ([kind, reason]) => (kinds as readonly string[]).includes(kind) && isString(reason, 256),
        ),
      "/unsupported",
      "unsupported maps kinds to reasons",
    );
    if (isRecord(unsupported) && isRecord(places))
      for (const kind of Object.keys(unsupported))
        if (places[kind] !== undefined)
          problems.add(`/places/${kind}`, "a kind is either placed or unsupported");
  }
  const links = value.links;
  problems.check(
    isRecord(links) &&
      Object.keys(links).join() === "skill" &&
      (links.skill === "documented" || links.skill === "not-documented"),
    "/links",
    "links is { skill: documented | not-documented }",
  );

  const userOnly = value.userOnly;
  const userOnlyOk =
    userOnly === "none" ||
    (isRecord(userOnly) &&
      Object.keys(userOnly).join() === "frontmatter" &&
      frontmatterOk(userOnly.frontmatter)) ||
    (isRecord(userOnly) &&
      Object.keys(userOnly).join() === "file" &&
      isRecord(userOnly.file) &&
      Object.keys(userOnly.file).sort().join() === "path,yaml" &&
      template(userOnly.file.path, false, false) &&
      isRecord(userOnly.file.yaml));
  problems.check(userOnlyOk, "/userOnly", "userOnly is none, { frontmatter } or { file }");
  if (value.userOnlyFallback !== undefined)
    byScope(value.userOnlyFallback, "/userOnlyFallback", problems, (entries, path) => {
      const ids = new Set<string>();
      problems.check(
        Array.isArray(entries) &&
          entries.length > 0 &&
          entries.every((entry) => {
            if (!isRecord(entry) || !isString(entry.id, 64) || ids.has(entry.id)) return false;
            ids.add(entry.id);
            return (
              Object.keys(entry).every((key) =>
                ["id", "path", "frontmatter", "arguments"].includes(key),
              ) &&
              template(entry.path, false) &&
              (entry.frontmatter === undefined || frontmatterOk(entry.frontmatter)) &&
              (entry.arguments === "kept" || entry.arguments === "reworded")
            );
          }),
        path,
        "fallback entries are { id, path, frontmatter?, arguments: kept | reworded }",
      );
    });
  problems.check(
    value.arguments === "substituted" || value.arguments === "chat-text",
    "/arguments",
    "arguments is substituted or chat-text",
  );
  if (value.foldDescription !== undefined)
    problems.check(value.foldDescription === true, "/foldDescription", "only true");

  if (value.agentFile !== undefined) {
    const agent = value.agentFile;
    if (!isRecord(agent)) problems.add("/agentFile", "must be an object");
    else {
      problems.keys(
        agent,
        "/agentFile",
        ["format", "fields", "tools", "model"],
        ["format", "tools", "model"],
      );
      problems.check(
        ["claude-md", "md", "toml", "json"].includes(agent.format as string),
        "/agentFile/format",
        "claude-md, md, toml or json",
      );
      if (agent.fields !== undefined)
        problems.check(
          Array.isArray(agent.fields) &&
            agent.fields.length > 0 &&
            agent.fields.every((field) => field === "name" || field === "description"),
          "/agentFile/fields",
          "fields lists name and description",
        );
      problems.check(
        agent.tools === "keep" ||
          agent.tools === "none" ||
          (isRecord(agent.tools) &&
            Object.values(agent.tools).every((name) => isString(name, 128))),
        "/agentFile/tools",
        "tools is keep, none or a name map",
      );
      problems.check(
        agent.model === "keep" || agent.model === "drop",
        "/agentFile/model",
        "keep or drop",
      );
    }
  }
  if (value.ruleScopes !== undefined) {
    const scopes = value.ruleScopes;
    if (!isRecord(scopes)) problems.add("/ruleScopes", "must be an object");
    else
      for (const [scope, entry] of Object.entries(scopes)) {
        const path = `/ruleScopes/${scope}`;
        if (!(RULE_SCOPE_KEYS as readonly string[]).includes(scope) || !isRecord(entry)) {
          problems.add(path, "unknown rule scope");
          continue;
        }
        problems.keys(entry, path, ["frontmatter", "globs", "form", "describe"], ["frontmatter"]);
        problems.check(
          frontmatterOk(entry.frontmatter),
          `${path}/frontmatter`,
          "scalar frontmatter",
        );
        problems.check(
          (scope === "paths") === (entry.globs !== undefined && entry.form !== undefined),
          path,
          "a paths scope names its globs key and form, and only it",
        );
        if (entry.globs !== undefined)
          problems.check(
            isString(entry.globs, 64) && KEY.test(entry.globs),
            `${path}/globs`,
            "a key",
          );
        if (entry.form !== undefined)
          problems.check(
            ["list", "comma", "single-or-list"].includes(entry.form as string),
            `${path}/form`,
            "list, comma or single-or-list",
          );
        if (entry.describe !== undefined)
          problems.check(
            Array.isArray(entry.describe) &&
              entry.describe.every((field) => field === "name" || field === "description"),
            `${path}/describe`,
            "describe lists name and description",
          );
      }
  }
  if (value.hookEvents !== undefined)
    problems.check(
      isRecord(value.hookEvents) &&
        Object.entries(value.hookEvents).every(
          ([neutral, native]) => /^[a-z]+(?:-[a-z]+)*$/.test(neutral) && isString(native, 64),
        ),
      "/hookEvents",
      "hookEvents maps neutral kebab-case events to native names",
    );
  if (value.mcpFile !== undefined) checkMcpFields(value.mcpFile, problems);
  const references = value.inputReferences;
  if (!isRecord(references)) problems.add("/inputReferences", "must be an object");
  else {
    problems.keys(references, "/inputReferences", INPUT_SURFACES, INPUT_SURFACES);
    for (const [surface, reference] of Object.entries(references))
      problems.check(
        reference === "none" ||
          reference === "unknown" ||
          (isRecord(reference) &&
            Object.keys(reference).join() === "syntax" &&
            isString(reference.syntax, 64) &&
            reference.syntax.includes("<name>")),
        `/inputReferences/${surface}`,
        "none, unknown or { syntax } with <name>",
      );
  }
  if (value.plugins !== undefined) checkPlugins(value.plugins, problems);
  if (value.localPlugins !== undefined) checkLocalPlugins(value.localPlugins, problems);
  if (value.bundleRoot !== undefined)
    byScope(value.bundleRoot, "/bundleRoot", problems, (entry, path) =>
      problems.check(
        routeTemplate(entry, true) && String(entry).includes("<framework>"),
        path,
        "a folder template with <framework>",
      ),
    );
  if (value.configFiles !== undefined)
    byScope(value.configFiles, "/configFiles", problems, (entry, path) =>
      problems.check(
        Array.isArray(entry) &&
          entry.length > 0 &&
          entry.every((file) => isSafeRelativePath(String(file).replace(/[/]$/, ""))),
        path,
        "a list of safe file or folder paths",
      ),
    );
  if (value.bundleWarnings !== undefined)
    problems.check(
      Array.isArray(value.bundleWarnings) &&
        value.bundleWarnings.every((warning) => isString(warning, 64)),
      "/bundleWarnings",
      "a list of warning codes",
    );
  if (value.skillFolderOverlap !== undefined) {
    const overlap = value.skillFolderOverlap;
    const ok =
      isRecord(overlap) &&
      Object.keys(overlap).sort().join() === "folders,merge,warnings" &&
      Array.isArray(overlap.folders) &&
      overlap.folders.length === 2 &&
      overlap.folders.every((folder) => template(folder, true, false)) &&
      isRecord(overlap.merge) &&
      Object.keys(overlap.merge).sort().join() === "entry,file,format,key" &&
      template(overlap.merge.file, false, false) &&
      overlap.merge.format === "json" &&
      isString(overlap.merge.key) &&
      overlap.merge.key.startsWith("/") &&
      Array.isArray(overlap.warnings) &&
      overlap.warnings.every((warning) => isString(warning, 64));
    problems.check(
      ok,
      "/skillFolderOverlap",
      "{ folders: [2], merge: { file, format, key, entry }, warnings }",
    );
  }
  if (value.provides !== undefined) checkProvides(value.provides, problems);
  if (value.disableBuiltIn !== undefined) checkDisableBuiltIn(value.disableBuiltIn, problems);
  return problems.list;
}

function checkProvides(value: unknown, problems: Problems): void {
  if (!isRecord(value)) {
    problems.add("/provides", "provides maps skill, command and agent to names");
    return;
  }
  problems.keys(value, "/provides", PROVIDED_KINDS);
  for (const [kind, names] of Object.entries(value))
    problems.check(
      Array.isArray(names) &&
        names.length > 0 &&
        names.every((name) => isString(name, 128)) &&
        new Set(names).size === names.length,
      `/provides/${kind}`,
      "a list of distinct built-in names",
    );
}

function checkDisableBuiltIn(value: unknown, problems: Problems): void {
  if (value === "not-documented") return;
  if (!isRecord(value)) {
    problems.add(
      "/disableBuiltIn",
      "not-documented or { sameName?, setting?, manual?, warnings? }",
    );
    return;
  }
  problems.keys(value, "/disableBuiltIn", ["sameName", "setting", "manual", "warnings"]);
  if (value.sameName !== undefined)
    problems.check(value.sameName === "replaces", "/disableBuiltIn/sameName", "only replaces");
  const setting = value.setting;
  if (setting !== undefined)
    problems.check(
      isRecord(setting) &&
        Object.keys(setting).sort().join() === "entry,file,format,key,root" &&
        (setting.root === "project" || setting.root === "user") &&
        template(setting.file, false, false) &&
        setting.format === "json" &&
        isString(setting.key) &&
        setting.key.startsWith("/") &&
        setting.key.includes("<name>"),
      "/disableBuiltIn/setting",
      "{ root, file, format: json, key with <name>, entry }",
    );
  if (value.manual !== undefined)
    problems.check(isString(value.manual, 512), "/disableBuiltIn/manual", "a description");
  problems.check(
    warningList(value.warnings),
    "/disableBuiltIn/warnings",
    "a list of warning codes",
  );
}

function checkMcpFields(value: unknown, problems: Problems): void {
  if (!isRecord(value)) {
    problems.add("/mcpFile", "must be an object");
    return;
  }
  problems.keys(value, "/mcpFile", ["stdio", "remote", "tools"]);
  const field = (entry: unknown) => entry === undefined || (isString(entry, 64) && KEY.test(entry));
  if (value.tools !== undefined)
    problems.check(
      isRecord(value.tools) &&
        Object.keys(value.tools).length > 0 &&
        Object.keys(value.tools).every((key) => key === "enabled" || key === "disabled") &&
        field(value.tools.enabled) &&
        field(value.tools.disabled),
      "/mcpFile/tools",
      "tools names the entry's allow-list (enabled) and deny-list (disabled) fields",
    );
  const set = (entry: unknown) =>
    entry === undefined ||
    (isRecord(entry) && Object.values(entry).every((item) => isString(item, 64)));
  if (value.stdio !== undefined) {
    const stdio = value.stdio;
    if (!isRecord(stdio)) problems.add("/mcpFile/stdio", "must be an object");
    else {
      problems.keys(stdio, "/mcpFile/stdio", ["command", "args", "argv", "env", "set"]);
      problems.check(
        (stdio.argv !== undefined) !== (stdio.command !== undefined) &&
          (stdio.argv === undefined || stdio.args === undefined) &&
          field(stdio.command) &&
          field(stdio.args) &&
          field(stdio.argv) &&
          field(stdio.env) &&
          set(stdio.set),
        "/mcpFile/stdio",
        "stdio names command (and args) or argv, env and constant set fields",
      );
    }
  }
  if (value.remote !== undefined) {
    const remote = value.remote;
    if (!isRecord(remote)) {
      problems.add("/mcpFile/remote", "must be an object");
      return;
    }
    for (const [transport, entry] of Object.entries(remote)) {
      const path = `/mcpFile/remote/${transport}`;
      if (transport !== "streamable-http" && transport !== "sse") {
        problems.add(path, "unknown transport");
        continue;
      }
      problems.check(
        isRecord(entry) &&
          Object.keys(entry).every((key) => ["url", "headers", "set"].includes(key)) &&
          isString(entry.url, 64) &&
          field(entry.headers) &&
          set(entry.set),
        path,
        "a remote names url, optional headers and constant set fields",
      );
    }
  }
}
