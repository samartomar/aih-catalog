/**
 * The recipe format (`urn:aihq:catalog:recipe:0.1.0`) and the Agent Plugins metadata of the
 * Git plugin that carries it. A recipe is a one-click choice: one route per client, the items
 * it installs and the choice groups a user picks from, the prefixes and overrides it applies,
 * and the Catalog data commit it was written against. Pure data; shape checks only.
 */
import { formats, kinds, type Problem } from "../contracts.js";
import { type AiSetupChange, aiSetupChangeProblems, CELLS } from "./ai-setup.js";
import { isRecord, isText, Problems, type Record_, TEXT_LIMITS } from "./check.js";
import { FRAMEWORK_ID, INSTALL_NAME, OBJECT_ID, SHA256 } from "./model.js";
import { isSafeRelativePath } from "./paths.js";
import { isMarketplaceAddress, isRepositoryAddress } from "./repository.js";

export const ROUTES = ["plugin", "local-plugin", "setup", "items"] as const;
export type Route = (typeof ROUTES)[number];
export const RECIPE_KINDS = ["base", "add-on", "combination"] as const;

/** A pin: a repository and the exact commit. */
export interface Pin {
  readonly repository: string;
  readonly commit: string;
}

/**
 * The upstream plugin a `plugin` or `local-plugin` route installs: the plugin folder `path`
 * (`/` for the whole source) of content source `source` at `commit`, and the plugin's name.
 * `marketplace` is where a native install finds it (a URL or repository) or, for a local
 * plugin, the name of the marketplace the copied folder declares. `marketplaceName` is the name
 * that marketplace declares, for a client that installs `<plugin>@<marketplace-name>`.
 */
export interface RecipePlugin {
  readonly source: string;
  readonly path: string;
  readonly plugin: string;
  readonly commit: string;
  readonly marketplace?: string;
  readonly marketplaceName?: string;
}

/** An upstream setup program, run by the installer only after the user approves it. */
export interface RecipeSetup {
  readonly repository: string;
  readonly commit: string;
  /** Where the installer clones the repository, relative to the plan's root. */
  readonly into: string;
  /** The exact argv run inside `into`; never a shell string. */
  readonly command: readonly string[];
  /** What the command needs on the machine, as the upstream states it (`bun>=1.4.2`). */
  readonly needs: readonly string[];
}

export interface RecipeMember {
  readonly item: string;
  readonly preTicked: boolean;
}

/** A choice group: the user picks one (or none) or several of its items. */
export interface RecipeOption {
  readonly id: string;
  readonly pick: "one" | "several";
  readonly items: readonly RecipeMember[];
}

export interface Recipe {
  readonly schema: string;
  readonly id: string;
  readonly kind: (typeof RECIPE_KINDS)[number];
  /** The framework of a base or add-on recipe. */
  readonly framework?: string;
  /** The frameworks a combination recipe chooses together. */
  readonly frameworks?: readonly string[];
  /** The upstream content pin (base, add-on), or one per framework (combination). */
  readonly content: Pin | Readonly<Record<string, Pin>>;
  readonly routes: Readonly<Record<string, Route>>;
  readonly plugins?: Readonly<Record<string, RecipePlugin>>;
  readonly setup?: Readonly<Record<string, RecipeSetup>>;
  /** For an `items` route: the kinds the upstream installs on that client (all when absent). */
  readonly clis?: Readonly<Record<string, readonly string[]>>;
  readonly members: readonly RecipeMember[];
  readonly options?: readonly RecipeOption[];
  /** Install-name prefixes, keyed by kind or by client (one form per recipe). */
  readonly namePrefix?: Readonly<Record<string, string>>;
  readonly overrides?: readonly { readonly item: string; readonly replaces: string }[];
  readonly requires?: readonly string[];
  /** Per AI setup id: only what this recipe changes from the tool's standalone setup. */
  readonly aiSetup?: Readonly<Record<string, AiSetupChange>>;
  readonly qualifications?: Readonly<Record<string, string>>;
  readonly data: Pin;
}

/** The Agent Plugins `plugin.json` that makes the recipe folder a Git plugin. */
export interface PluginMetadata {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author:
    | string
    | { readonly name: string; readonly email?: string; readonly url?: string };
  readonly license: string;
  readonly keywords: readonly string[];
  readonly homepage?: string;
  readonly repository?: unknown;
  readonly extensions?: unknown;
}

const isString = (value: unknown, max: number = TEXT_LIMITS.recipe): value is string =>
  isText(value, max);
const isId = (value: unknown): value is string => isString(value, 128) && FRAMEWORK_ID.test(value);
const isItemId = (value: unknown): value is string => isString(value, 512);
const isStringList = (value: unknown, max = 4096): value is string[] =>
  Array.isArray(value) && value.every((entry) => isString(entry, max));
export const isFolder = (value: unknown): value is string =>
  value === "/" || isSafeRelativePath(value);

function checkPin(value: unknown, path: string, problems: Problems, commit = OBJECT_ID): void {
  if (!isRecord(value)) {
    problems.add(path, "a pin is { repository, commit }");
    return;
  }
  problems.keys(value, path, ["repository", "commit"], ["repository", "commit"]);
  problems.check(
    isRepositoryAddress(value.repository),
    `${path}/repository`,
    "an https repository address is required",
  );
  problems.check(
    typeof value.commit === "string" && commit.test(value.commit),
    `${path}/commit`,
    "an exact commit id is required",
  );
}

function checkMember(value: unknown, path: string, problems: Problems, seen: Set<string>): void {
  if (!isRecord(value)) {
    problems.add(path, "a member is { item, preTicked }");
    return;
  }
  problems.keys(value, path, ["item", "preTicked"], ["item", "preTicked"]);
  if (!isItemId(value.item)) problems.add(`${path}/item`, "an item id is required");
  else if (seen.has(value.item)) problems.add(`${path}/item`, "an item is listed twice");
  else seen.add(value.item);
  problems.check(typeof value.preTicked === "boolean", `${path}/preTicked`, "a boolean");
}

const TOP = [
  "schema",
  "id",
  "kind",
  "framework",
  "frameworks",
  "content",
  "routes",
  "plugins",
  "setup",
  "clis",
  "members",
  "options",
  "namePrefix",
  "overrides",
  "requires",
  "aiSetup",
  "qualifications",
  "data",
];

/** Shape problems of a recipe document; empty when it is well formed. */
export function recipeProblems(value: unknown): Problem[] {
  const problems = new Problems();
  if (!isRecord(value)) return [{ path: "", message: "a recipe must be an object" }];
  problems.keys(value, "", TOP, ["schema", "id", "kind", "content", "routes", "members", "data"]);
  problems.check(value.schema === formats.recipe, "/schema", `schema must be ${formats.recipe}`);
  problems.check(isId(value.id), "/id", "a recipe id is kebab-case");
  const kind = value.kind;
  problems.check(
    (RECIPE_KINDS as readonly string[]).includes(kind as string),
    "/kind",
    "kind is base, add-on or combination",
  );
  if (kind === "combination") {
    problems.check(value.framework === undefined, "/framework", "a combination names frameworks");
    const frameworks = value.frameworks;
    const ok =
      Array.isArray(frameworks) &&
      frameworks.length >= 2 &&
      frameworks.every(isId) &&
      new Set(frameworks).size === frameworks.length;
    problems.check(ok, "/frameworks", "a combination names two or more frameworks");
    if (!isRecord(value.content)) problems.add("/content", "one pin per framework");
    else {
      if (ok)
        problems.check(
          Object.keys(value.content).sort().join() === [...(frameworks as string[])].sort().join(),
          "/content",
          "one pin per framework",
        );
      for (const [framework, pin] of Object.entries(value.content))
        checkPin(pin, `/content/${framework}`, problems);
    }
  } else {
    problems.check(isId(value.framework), "/framework", "a framework id is required");
    problems.check(value.frameworks === undefined, "/frameworks", "only a combination has it");
    checkPin(value.content, "/content", problems);
    problems.check(
      value.qualifications === undefined,
      "/qualifications",
      "only a combination has qualifications",
    );
  }
  if (kind === "add-on")
    problems.check(
      isStringList(value.requires, 128) && value.requires.length > 0,
      "/requires",
      "an add-on lists the recipes it requires",
    );
  else if (value.requires !== undefined)
    problems.check(
      Array.isArray(value.requires) && value.requires.length === 0,
      "/requires",
      "only an add-on requires recipes",
    );

  const routes = isRecord(value.routes) ? value.routes : undefined;
  if (routes === undefined) problems.add("/routes", "routes maps clients to routes");
  else
    for (const [cli, route] of Object.entries(routes)) {
      problems.check(isId(cli), `/routes/${cli}`, "a client id");
      problems.check(
        (ROUTES as readonly string[]).includes(route as string),
        `/routes/${cli}`,
        "plugin, local-plugin, setup or items",
      );
    }
  const routeOf = (cli: string) => routes?.[cli];

  if (value.plugins !== undefined) {
    if (!isRecord(value.plugins)) problems.add("/plugins", "plugins maps clients to plugins");
    else
      for (const [cli, entry] of Object.entries(value.plugins)) {
        const path = `/plugins/${cli}`;
        problems.check(
          routeOf(cli) === "plugin" || routeOf(cli) === "local-plugin",
          path,
          "only a plugin or local-plugin route names a plugin",
        );
        if (!isRecord(entry)) {
          problems.add(
            path,
            "a plugin is { source, path, plugin, commit, marketplace?, marketplaceName? }",
          );
          continue;
        }
        problems.keys(
          entry,
          path,
          ["source", "path", "plugin", "commit", "marketplace", "marketplaceName"],
          ["source", "path", "plugin", "commit"],
        );
        problems.check(isId(entry.source), `${path}/source`, "a content source id");
        problems.check(isFolder(entry.path), `${path}/path`, "/ or a safe folder");
        problems.check(
          isString(entry.plugin, 64) && INSTALL_NAME.test(entry.plugin),
          `${path}/plugin`,
          "a kebab-case plugin name",
        );
        problems.check(
          typeof entry.commit === "string" && OBJECT_ID.test(entry.commit),
          `${path}/commit`,
          "an exact commit id is required",
        );
        // A native install reads its marketplace from an address; a local plugin registers
        // the name its copied folder declares.
        if (entry.marketplace !== undefined)
          problems.check(
            routeOf(cli) === "local-plugin"
              ? isString(entry.marketplace, 64) && INSTALL_NAME.test(entry.marketplace)
              : isMarketplaceAddress(entry.marketplace),
            `${path}/marketplace`,
            routeOf(cli) === "local-plugin"
              ? "a kebab-case marketplace name"
              : "an https URL or owner/repo",
          );
        if (entry.marketplaceName !== undefined) {
          problems.check(
            isString(entry.marketplaceName, 64) && INSTALL_NAME.test(entry.marketplaceName),
            `${path}/marketplaceName`,
            "a kebab-case marketplace name",
          );
          problems.check(
            routeOf(cli) === "plugin",
            `${path}/marketplaceName`,
            "only a plugin route installs from a named marketplace",
          );
        }
      }
  }
  if (value.setup !== undefined) {
    if (!isRecord(value.setup)) problems.add("/setup", "setup maps clients to setup programs");
    else
      for (const [cli, entry] of Object.entries(value.setup)) {
        const path = `/setup/${cli}`;
        problems.check(routeOf(cli) === "setup", path, "only a setup route names a setup");
        if (!isRecord(entry)) {
          problems.add(path, "a setup is { repository, commit, into, command, needs }");
          continue;
        }
        problems.keys(
          entry,
          path,
          ["repository", "commit", "into", "command", "needs"],
          ["repository", "commit", "into", "command", "needs"],
        );
        checkPin({ repository: entry.repository, commit: entry.commit }, path, problems);
        problems.check(isSafeRelativePath(entry.into), `${path}/into`, "a safe relative folder");
        problems.check(
          isStringList(entry.command) && entry.command.length > 0,
          `${path}/command`,
          "an argv list",
        );
        problems.check(isStringList(entry.needs, 256), `${path}/needs`, "a list of requirements");
      }
  }
  if (routes !== undefined)
    for (const [cli, route] of Object.entries(routes)) {
      if (
        (route === "plugin" || route === "local-plugin") &&
        !isRecord((value.plugins as Record_ | undefined)?.[cli])
      )
        problems.add(`/plugins/${cli}`, `a ${route} route names its plugin`);
      if (route === "setup" && !isRecord((value.setup as Record_ | undefined)?.[cli]))
        problems.add(`/setup/${cli}`, "a setup route names its setup");
    }
  if (value.clis !== undefined)
    problems.check(
      isRecord(value.clis) &&
        Object.entries(value.clis).every(
          ([cli, list]) =>
            isId(cli) &&
            Array.isArray(list) &&
            list.length > 0 &&
            list.every((entry) => (kinds as readonly string[]).includes(entry)) &&
            new Set(list).size === list.length,
        ),
      "/clis",
      "clis maps clients to the kinds their items route installs",
    );

  const seen = new Set<string>();
  if (!Array.isArray(value.members)) problems.add("/members", "members is a list");
  else
    for (const [at, member] of value.members.entries())
      checkMember(member, `/members/${at}`, problems, seen);
  if (value.options !== undefined) {
    if (!Array.isArray(value.options)) problems.add("/options", "options is a list");
    else {
      const ids = new Set<string>();
      value.options.forEach((option, at) => {
        const path = `/options/${at}`;
        if (!isRecord(option)) {
          problems.add(path, "an option is { id, pick, items }");
          return;
        }
        problems.keys(option, path, ["id", "pick", "items"], ["id", "pick", "items"]);
        if (!isId(option.id) || ids.has(option.id))
          problems.add(`${path}/id`, "a unique kebab-case id");
        else ids.add(option.id);
        problems.check(
          option.pick === "one" || option.pick === "several",
          `${path}/pick`,
          "one or several",
        );
        if (!Array.isArray(option.items) || option.items.length === 0)
          problems.add(`${path}/items`, "a choice group lists its items");
        else
          for (const [index, member] of option.items.entries())
            checkMember(member, `${path}/items/${index}`, problems, seen);
        if (
          option.pick === "one" &&
          Array.isArray(option.items) &&
          option.items.filter((member) => isRecord(member) && member.preTicked === true).length > 1
        )
          problems.add(`${path}/items`, "a pick-one group pre-ticks at most one item");
      });
    }
  }
  if (value.namePrefix !== undefined) {
    const prefix = value.namePrefix;
    if (!isRecord(prefix)) problems.add("/namePrefix", "namePrefix maps kinds or clients");
    else {
      const keys = Object.keys(prefix);
      const byKind = keys.filter((key) => (kinds as readonly string[]).includes(key));
      problems.check(
        byKind.length === 0 || byKind.length === keys.length,
        "/namePrefix",
        "namePrefix is keyed by kind or by client, not both",
      );
      for (const [key, entry] of Object.entries(prefix)) {
        problems.check(isId(key), `/namePrefix/${key}`, "a kind or client id");
        problems.check(
          typeof entry === "string" && entry.length <= 32 && /^(?:[a-z0-9]+-)*$/.test(entry),
          `/namePrefix/${key}`,
          "a prefix is empty or kebab-case ending in -",
        );
      }
    }
  }
  if (value.overrides !== undefined)
    problems.check(
      Array.isArray(value.overrides) &&
        value.overrides.every(
          (entry) =>
            isRecord(entry) &&
            Object.keys(entry).sort().join() === "item,replaces" &&
            isItemId(entry.item) &&
            isString(entry.replaces, 128),
        ),
      "/overrides",
      "overrides lists { item, replaces }",
    );
  if (value.aiSetup !== undefined) {
    if (!isRecord(value.aiSetup)) problems.add("/aiSetup", "aiSetup maps AI setup ids to changes");
    else
      for (const [id, change] of Object.entries(value.aiSetup)) {
        problems.check(isItemId(id), `/aiSetup/${id}`, "an AI setup id");
        for (const problem of aiSetupChangeProblems(change, `/aiSetup/${id}`))
          problems.add(problem.path, problem.message);
      }
  }
  if (value.qualifications !== undefined)
    problems.check(
      isRecord(value.qualifications) &&
        Object.entries(value.qualifications).every(
          ([cell, entry]) =>
            (CELLS as readonly string[]).includes(cell) &&
            typeof entry === "string" &&
            SHA256.test(entry),
        ),
      "/qualifications",
      "qualifications maps cells to qualification sha256",
    );
  checkPin(value.data, "/data", problems, /^[0-9a-f]{40}$/);
  return problems.list;
}

const PLUGIN_FIELDS = [
  "name",
  "version",
  "description",
  "author",
  "license",
  "keywords",
  "homepage",
  "repository",
  "extensions",
];

/** Shape problems of the recipe plugin's Agent Plugins `plugin.json`. */
export function pluginMetadataProblems(value: unknown): Problem[] {
  const problems = new Problems();
  const at = "plugin.json";
  if (!isRecord(value)) return [{ path: at, message: "plugin.json must be an object" }];
  problems.keys(value, at, PLUGIN_FIELDS, [
    "name",
    "version",
    "description",
    "author",
    "license",
    "keywords",
  ]);
  problems.check(
    isString(value.name, 64) && INSTALL_NAME.test(value.name),
    `${at}/name`,
    "a kebab-case name",
  );
  problems.check(isString(value.version, 64), `${at}/version`, "a version");
  problems.check(isString(value.description, 1024), `${at}/description`, "1–1024 characters");
  const author = value.author;
  problems.check(
    isString(author, 256) ||
      (isRecord(author) &&
        isString(author.name, 256) &&
        Object.keys(author).every((key) => ["name", "email", "url"].includes(key)) &&
        (author.email === undefined || isString(author.email, 256)) &&
        (author.url === undefined || isString(author.url))),
    `${at}/author`,
    "an author name or { name, email?, url? }",
  );
  problems.check(isString(value.license, 256), `${at}/license`, "a licence");
  problems.check(isStringList(value.keywords, 64), `${at}/keywords`, "a list of keywords");
  if (value.homepage !== undefined)
    problems.check(isString(value.homepage), `${at}/homepage`, "a string");
  return problems.list;
}
