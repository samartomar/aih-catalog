/**
 * `planRecipe`: a recipe's choices planned through each client's route. A client whose
 * recipe route is `plugin` gets a pinned native plugin step, `local-plugin` the upstream
 * plugin folder copied and registered, `setup` an approval-requiring upstream setup step, and
 * `items` (or a client the recipe gives no route) the chosen items through `planInstall`'s
 * placements. A route the client cannot honour at the chosen scope warns and falls back to
 * `local-plugin` where the profile has one, else `items`; the scope never changes.
 */
import type { Problem } from "../contracts.js";
import { canonicalDocument } from "./json.js";
import { type Content, type ContentSource, INSTALL_NAME, type Item, OBJECT_ID } from "./model.js";
import { compareCodeUnits, isUnder, quote, refused } from "./paths.js";
import {
  type Extras,
  inputProblems,
  isDataPin,
  type MarketplaceRender,
  type MergeStep,
  type Missing,
  type PlanResult,
  type PluginStep,
  planCore,
  type SetupStep,
  sharedOptionProblems,
  type Warning,
  type WriteStep,
} from "./plan.js";
import type { Scope, ToolProfile } from "./profile.js";
import {
  type Pin,
  type Recipe,
  type RecipeMember,
  type RecipePlugin,
  type Route,
  recipeProblems,
} from "./recipe.js";
import { sha256Hex } from "./sha256.js";

export interface RecipePlanOptions {
  readonly scope: Scope;
  /** Where the recipe was read: its repository and exact commit. Required (origin). */
  readonly source: Pin;
  /** The Catalog data the contents were read from; defaults to the recipe's, and must equal it. */
  readonly data?: Pin;
  readonly copy?: boolean;
  readonly names?: Readonly<Record<string, string>>;
}

/** The user's picks per option group; an omitted group takes its pre-ticked items. */
export type RecipeChoices = Readonly<Record<string, readonly string[]>>;

const OPTION_KEYS = ["scope", "source", "data", "copy", "names"];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`<${key}>`, value),
    template,
  );
const fillDeep = (value: unknown, values: Readonly<Record<string, string>>): unknown =>
  typeof value === "string"
    ? fill(value, values)
    : Array.isArray(value)
      ? value.map((entry) => fillDeep(entry, values))
      : isRecord(value)
        ? Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [
              fill(key, values),
              fillDeep(entry, values),
            ]),
          )
        : value;
const placeholders = (value: unknown): string[] =>
  [...JSON.stringify(value).matchAll(/<([a-z-]+)>/g)].map((match) => match[1] as string);

/** The bytes of a pinned local marketplace (Claude marketplace format): one plugin, by `sha`. */
export function marketplaceBytes(render: MarketplaceRender): Uint8Array | { reason: string } {
  const strings = [render.marketplace, render.plugin, render.repository, render.commit];
  if (!strings.every((entry) => typeof entry === "string" && entry.length > 0))
    return {
      reason: "the marketplace render names its marketplace, plugin, repository and commit",
    };
  if (!INSTALL_NAME.test(render.plugin) || !OBJECT_ID.test(render.commit))
    return { reason: "the marketplace render needs a plugin name and an exact commit" };
  const github = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/.exec(
    render.repository,
  );
  const source = github
    ? { source: "github", repo: github[1], sha: render.commit }
    : { source: "url", url: render.repository, sha: render.commit };
  return new TextEncoder().encode(
    canonicalDocument({
      name: render.marketplace,
      owner: { name: "aihq" },
      plugins: [{ name: render.plugin, source }],
    }),
  );
}

/** The items whose files all lie inside a recorded plugin folder. */
function containedIn(content: Content, sourceId: string, path: string): string[] {
  return content.items
    .filter(
      (item) =>
        item.files.length > 0 &&
        item.files.every((file) => file.sourceId === sourceId && isUnder(file.sourcePath, path)),
    )
    .map((item) => item.id)
    .sort(compareCodeUnits);
}

interface Lowered {
  readonly writes: WriteStep[];
  readonly merges: MergeStep[];
  readonly plugins: PluginStep[];
  readonly setups: SetupStep[];
  readonly warnings: Warning[];
  readonly missing: Missing[];
  readonly served: { item: string; cli: string }[];
  readonly problems: Problem[];
}

export function planRecipe(
  recipe: Recipe,
  contents: readonly Content[],
  profiles: readonly ToolProfile[],
  choices: RecipeChoices,
  options: RecipePlanOptions,
): PlanResult {
  const problems: Problem[] = recipeProblems(recipe).map((problem) => ({
    path: `recipe${problem.path}`,
    message: problem.message,
  }));
  problems.push(...inputProblems(contents, profiles));
  if (!isRecord(options)) problems.push({ path: "options", message: "options is an object" });
  else {
    problems.push(...sharedOptionProblems(options as never, OPTION_KEYS, () => true));
    const source = options.source as unknown;
    if (
      !isRecord(source) ||
      Object.keys(source).sort().join() !== "commit,repository" ||
      typeof source.repository !== "string" ||
      source.repository.length === 0 ||
      typeof source.commit !== "string" ||
      !OBJECT_ID.test(source.commit)
    )
      problems.push({
        path: "options/source",
        message: "source is the { repository, commit } the recipe was read from",
      });
    if (options.data !== undefined && !isDataPin(options.data))
      problems.push({ path: "options/data", message: "data is { repository, commit }" });
  }
  if (!isRecord(choices)) problems.push({ path: "choices", message: "choices maps option ids" });
  if (problems.length > 0) return { status: "invalid", problems };

  if (
    recipe.kind === "combination" ||
    Object.keys(recipe.aiSetup ?? {}).length > 0 ||
    recipe.qualifications !== undefined
  )
    return refused(
      "not-implemented",
      "combination recipes and AI setup changes are not implemented yet",
    );
  if (
    options.data !== undefined &&
    (options.data.repository !== recipe.data.repository ||
      options.data.commit !== recipe.data.commit)
  )
    return refused(
      "data-mismatch",
      `the recipe was written against data commit ${recipe.data.commit}, not ${options.data.commit}`,
    );
  const framework = recipe.framework as string;
  const pin = recipe.content as Pin;
  const content = contents.find((candidate) => candidate.framework.id === framework);
  if (content === undefined)
    return refused(
      "content-mismatch",
      `no content for the framework ${quote(framework)} was supplied`,
    );
  const pinned = (repository: string, commit: string) =>
    content.sources.find(
      (source) =>
        source.kind === "git" && source.repository === repository && source.commit === commit,
    );
  if (pinned(pin.repository, pin.commit) === undefined)
    return refused(
      "content-mismatch",
      `the ${framework} content is not read at the recipe's pin ${pin.commit}`,
    );

  // The selection: every member, plus each option group's picks (or its pre-ticked items).
  const options_ = recipe.options ?? [];
  for (const [id, picks] of Object.entries(choices)) {
    const group = options_.find((option) => option.id === id);
    if (group === undefined) {
      problems.push({ path: `choices/${id}`, message: "names no option group of the recipe" });
      continue;
    }
    if (
      !Array.isArray(picks) ||
      !picks.every((pick) => group.items.some((member) => member.item === pick)) ||
      new Set(picks).size !== picks.length
    )
      problems.push({ path: `choices/${id}`, message: "picks are distinct items of the group" });
    else if (group.pick === "one" && picks.length > 1)
      problems.push({ path: `choices/${id}`, message: "the group takes at most one pick" });
  }
  if (problems.length > 0) return { status: "invalid", problems };
  const ticked = (members: readonly RecipeMember[]) =>
    members.filter((member) => member.preTicked).map((member) => member.item);
  const selection = [
    ...recipe.members.map((member) => member.item),
    ...options_.flatMap((option) => choices[option.id] ?? ticked(option.items)),
  ];
  const items = new Map<string, Item>();
  for (const candidate of contents)
    for (const item of candidate.items) if (!items.has(item.id)) items.set(item.id, item);
  for (const id of selection)
    if (!items.has(id))
      return refused(
        "unknown-item",
        `the recipe's item ${quote(id)} is not in the supplied content`,
      );
  for (const member of [...recipe.members, ...options_.flatMap((option) => option.items)])
    if (member.preTicked && items.get(member.item)?.kind === "hook")
      problems.push({ path: `recipe/${member.item}`, message: "a hook is never pre-ticked" });
  for (const id of Object.keys(options.names ?? {}))
    if (!selection.includes(id))
      problems.push({ path: `options/names/${id}`, message: "names an unselected item" });
  const offered = new Set([
    ...recipe.members.map((member) => member.item),
    ...options_.flatMap((option) => option.items.map((member) => member.item)),
  ]);
  for (const [index, override] of (recipe.overrides ?? []).entries())
    if (!offered.has(override.item))
      problems.push({
        path: `recipe/overrides/${index}`,
        message: "an override names an item the recipe installs",
      });
  if (problems.length > 0) return { status: "invalid", problems };

  // Each client's route, lowered; a route the client cannot honour falls back.
  const scope = options.scope;
  const sorted = [...profiles].sort((left, right) => compareCodeUnits(left.id, right.id));
  const lowered: Lowered = {
    writes: [],
    merges: [],
    plugins: [],
    setups: [],
    warnings: [],
    missing: [],
    served: [],
    problems: [],
  };
  const itemsRoute = new Set<string>();
  const used = new Map<string, Route>();
  for (const profile of sorted) {
    const asked: Route = recipe.routes[profile.id] ?? "items";
    const route = routeFor(asked, profile, scope, recipe, content);
    used.set(profile.id, route);
    if (route !== asked)
      lowered.warnings.push({
        code: fallbackCode(asked, profile, scope),
        cli: profile.id,
        items: plugged(recipe, content, profile.id),
        framework,
        route: { from: asked, to: route },
      });
  }
  // A local plugin and another client's items in the same skills folder would load the same
  // skills twice on this client: it keeps the shared items layout (with any bundle) instead.
  for (const profile of sorted) {
    if (used.get(profile.id) !== "local-plugin") continue;
    const own = skillTemplate(profile, scope);
    const skills = plugged(recipe, content, profile.id).filter(
      (id) => selection.includes(id) && items.get(id)?.kind === "skill",
    );
    const shared = sorted.some(
      (other) =>
        other.id !== profile.id &&
        used.get(other.id) === "items" &&
        own !== undefined &&
        skillTemplate(other, scope) === own,
    );
    if (skills.length === 0 || !shared) continue;
    used.set(profile.id, "items");
    lowered.warnings.push({
      code: "local-plugin-overlap",
      cli: profile.id,
      items: plugged(recipe, content, profile.id),
      framework,
      route: { from: "local-plugin", to: "items" },
    });
  }
  for (const profile of sorted) {
    const route = used.get(profile.id) as Route;
    if (route === "items") itemsRoute.add(profile.id);
    else if (route === "setup") {
      const result = lowerSetup(recipe, content, profile.id, scope, pinned);
      if ("status" in result) return result;
      lowered.setups.push(result);
    } else {
      const entry = recipe.plugins?.[profile.id] as RecipePlugin;
      const source = content.sources.find((candidate) => candidate.id === entry.source);
      if (source?.kind !== "git" || source.commit !== entry.commit)
        return refused(
          "content-mismatch",
          `the ${profile.id} plugin's source ${quote(entry.source)} is not read at ${entry.commit}`,
        );
      if (route === "plugin") lowerPlugin(entry, source, content, profile, scope, lowered);
      else lowerLocalPlugin(entry, content, profile, scope, lowered);
    }
  }
  if (lowered.problems.length > 0) return { status: "invalid", problems: lowered.problems };

  // Install names on the items route: the caller's names, else the recipe's prefix.
  const prefix = recipe.namePrefix ?? {};
  const installName = (item: Item, profile: ToolProfile): string | undefined => {
    if (!itemsRoute.has(profile.id)) return undefined;
    const kinds = recipe.clis?.[profile.id];
    if (kinds !== undefined && !kinds.includes(item.kind)) return undefined;
    return (
      options.names?.[item.id] ?? `${prefix[profile.id] ?? prefix[item.kind] ?? ""}${item.name}`
    );
  };
  for (const profile of sorted)
    for (const id of selection) {
      const name = installName(items.get(id) as Item, profile);
      if (name !== undefined && (name.length > 64 || !INSTALL_NAME.test(name)))
        problems.push({
          path: `recipe/namePrefix`,
          message: `the install name ${quote(name)} is not 64 characters of a-z0-9-`,
        });
    }
  if (problems.length > 0) return { status: "invalid", problems };

  const extras: Extras = lowered;
  const result = planCore({
    selection,
    contents,
    profiles,
    scope,
    data: { repository: recipe.data.repository, commit: recipe.data.commit },
    ...(options.copy !== undefined ? { copy: options.copy } : {}),
    installName,
    extras,
    overrides: (recipe.overrides ?? []).filter((override) => selection.includes(override.item)),
  });
  if (result.status !== "ok" && result.status !== "incomplete") return result;
  const { status, ...rest } = result;
  return {
    status,
    recipe: {
      id: recipe.id,
      sha256: sha256Hex(new TextEncoder().encode(canonicalDocument(recipe))),
      repository: options.source.repository,
      commit: options.source.commit,
    },
    ...rest,
  };
}

/** The route a client takes: the recipe's, or its fallback at this scope. */
function routeFor(
  asked: Route,
  profile: ToolProfile,
  scope: Scope,
  recipe: Recipe,
  content: Content,
): Route {
  if (asked === "items" || asked === "setup") return asked;
  const plugins = profile.plugins;
  if (
    asked === "plugin" &&
    plugins?.pin === "holds" &&
    plugins.install !== undefined &&
    plugins.scopes?.includes(scope)
  )
    return "plugin";
  const place = profile.localPlugins?.[scope];
  if (asked === "local-plugin") return place === undefined ? "items" : "local-plugin";
  // A native plugin falls back to a local plugin only when it can be copied whole here.
  const entry = recipe.plugins?.[profile.id];
  const folder = content.plugins?.find(
    (candidate) => candidate.sourceId === entry?.source && candidate.path === entry?.path,
  );
  const manifest = place?.manifests.some((path) =>
    folder?.files.some((file) => file.sourcePath === join(folder.path, path)),
  );
  // A native plugin entry names no local marketplace, so a registration that needs one is out.
  const named = placeholders(place?.register ?? []).includes("marketplace");
  return place !== undefined && manifest && !named ? "local-plugin" : "items";
}

/** The client's own skill folder template at this scope (the fallback of a shared place). */
function skillTemplate(profile: ToolProfile, scope: Scope): string | undefined {
  const place = profile.places.skill?.[scope];
  return place === undefined ? undefined : typeof place === "string" ? place : place.otherwise;
}

/** `scope-fallback` when the client has the route at another scope, else `route-unavailable`. */
function fallbackCode(asked: Route, profile: ToolProfile, scope: Scope): string {
  const other: Scope = scope === "project" ? "user" : "project";
  const elsewhere =
    asked === "plugin"
      ? profile.plugins?.pin === "holds" &&
        profile.plugins.install !== undefined &&
        profile.plugins.scopes?.includes(other) === true
      : profile.localPlugins?.[other] !== undefined;
  return elsewhere ? "scope-fallback" : "route-unavailable";
}

/** The items of the plugin a client's recipe entry names, for warnings about it. */
function plugged(recipe: Recipe, content: Content, cli: string): string[] {
  const entry = recipe.plugins?.[cli];
  return entry ? containedIn(content, entry.source, entry.path) : [];
}

const join = (folder: string, path: string) => (folder === "/" ? path : `${folder}/${path}`);
const relative = (folder: string, path: string) =>
  folder === "/" ? path : path.slice(folder.length + 1);

function recordOf(entry: RecipePlugin, content: Content) {
  return content.plugins?.find(
    (candidate) => candidate.sourceId === entry.source && candidate.path === entry.path,
  );
}

function lowerPlugin(
  entry: RecipePlugin,
  source: ContentSource,
  content: Content,
  profile: ToolProfile,
  scope: Scope,
  lowered: Lowered,
): void {
  const framework = content.framework.id;
  const cli = profile.id;
  const install = profile.plugins as NonNullable<ToolProfile["plugins"]>;
  const folder = recordOf(entry, content);
  if (folder === undefined) {
    lowered.missing.push({ framework, cli, reason: "plugin-not-recorded" });
    return;
  }
  const at = `recipe/plugins/${cli}/marketplace`;
  let marketplace: PluginStep["marketplace"];
  let marketplaceName: string | undefined;
  if (install.pinForm === "marketplace") {
    if (entry.marketplace === undefined)
      lowered.problems.push({
        path: at,
        message: `${cli} installs a plugin from a named marketplace`,
      });
    marketplace = entry.marketplace;
  } else if (entry.marketplace !== undefined)
    lowered.problems.push({ path: at, message: `${cli} takes no marketplace for its plugin` });
  if (install.pinForm === "local-marketplace") {
    const path = fill(install.marketplaceFolder as string, { framework }).slice(0, -1);
    const render: MarketplaceRender = {
      name: "plugin-marketplace",
      profile: profile.id,
      version: profile.version,
      marketplace: `aihq-${framework}`,
      plugin: entry.plugin,
      repository: source.repository as string,
      commit: entry.commit,
    };
    lowered.writes.push({
      op: "write",
      root: scope,
      path: `${path}/.claude-plugin/marketplace.json`,
      executable: false,
      render,
      scanned: false,
      framework,
      clis: [cli],
    });
    marketplace = { root: scope, path };
    marketplaceName = render.marketplace;
  }
  const items = containedIn(content, entry.source, entry.path);
  for (const code of install.warnings ?? []) lowered.warnings.push({ code, cli, items, framework });
  lowered.plugins.push({
    op: "plugin",
    cli,
    framework,
    ...(marketplace !== undefined ? { marketplace } : {}),
    ...(marketplaceName !== undefined ? { marketplaceName } : {}),
    plugin: entry.plugin,
    repository: source.repository as string,
    commit: entry.commit,
    scanKey: folder.scanKey,
    verify: install.verify,
  });
}

function lowerLocalPlugin(
  entry: RecipePlugin,
  content: Content,
  profile: ToolProfile,
  scope: Scope,
  lowered: Lowered,
): void {
  const framework = content.framework.id;
  const cli = profile.id;
  const place = profile.localPlugins?.[scope] as NonNullable<ToolProfile["localPlugins"]>["user"] &
    object;
  const folder = recordOf(entry, content);
  if (folder === undefined) {
    lowered.missing.push({ framework, cli, reason: "plugin-not-recorded" });
    return;
  }
  if (
    !place.manifests.some((path) =>
      folder.files.some((file) => file.sourcePath === join(folder.path, path)),
    )
  ) {
    lowered.missing.push({ framework, cli, reason: "no-plugin-manifest" });
    return;
  }
  const values: Record<string, string> = { framework, plugin: entry.plugin };
  const target = fill(place.folder, values).slice(0, -1);
  values.folder = target;
  if (entry.marketplace !== undefined) values.marketplace = entry.marketplace;
  const unfilled = placeholders(place.register ?? []).filter((name) => values[name] === undefined);
  if (unfilled.length > 0) {
    lowered.problems.push({
      path: `recipe/plugins/${cli}`,
      message: `${cli} registers a local plugin by its ${unfilled[0]}`,
    });
    return;
  }
  const contains = containedIn(content, entry.source, entry.path);
  const marks = { framework, route: "local-plugin" as const, contains };
  for (const file of folder.files)
    lowered.writes.push({
      op: "write",
      root: scope,
      path: `${target}/${relative(folder.path, file.sourcePath)}`,
      from: { sourceId: folder.sourceId, sourcePath: file.sourcePath, sha256: file.sha256 },
      executable: file.executable,
      ...marks,
      scanKey: folder.scanKey,
      clis: [cli],
    });
  for (const merge of place.register ?? [])
    lowered.merges.push({
      op: "merge",
      root: scope,
      file: fill(merge.file, values),
      format: merge.format,
      key: fill(merge.key, values),
      entry: fillDeep(merge.entry, values),
      ...marks,
      clis: [cli],
    });
  for (const code of place.warnings ?? [])
    lowered.warnings.push({ code, cli, items: contains, framework });
  for (const item of contains) lowered.served.push({ item, cli });
}

function lowerSetup(
  recipe: Recipe,
  content: Content,
  cli: string,
  scope: Scope,
  pinned: (repository: string, commit: string) => ContentSource | undefined,
): SetupStep | PlanResult {
  const setup = recipe.setup?.[cli] as NonNullable<Recipe["setup"]>[string];
  if (pinned(setup.repository, setup.commit) === undefined)
    return refused(
      "content-mismatch",
      `the ${cli} setup's repository at ${setup.commit} is not a source of the supplied content`,
    );
  return {
    op: "upstream-setup",
    cli,
    framework: content.framework.id,
    root: scope,
    repository: setup.repository,
    commit: setup.commit,
    into: setup.into,
    command: setup.command,
    needs: setup.needs,
    scanned: false,
    approval: "required",
  };
}
