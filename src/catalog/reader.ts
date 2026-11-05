/**
 * `@aihq/catalog/reader` (new model, browser-safe): reading content documents and tool
 * profiles, item lookup, availability, planning and the recorded renders.
 */
import {
  formats,
  type Invalid,
  type LimitName,
  limits,
  type Refused,
  type UnsupportedVersion,
} from "./contracts.js";
import { type Qualification, qualificationProblems } from "./internal/ai-setup.js";
import { AUTHORED_FRAMEWORK, aihContent } from "./internal/authored.js";
import { installRelative } from "./internal/identity.js";
import {
  canonicalDocument,
  deepFreeze,
  JsonAdmissionError,
  readCanonicalDocument,
  readStrictDocument,
} from "./internal/json.js";
import { BLOCK_MARKER, readJson } from "./internal/kinds.js";
import type { Content, Item } from "./internal/model.js";
import { compareCodeUnits, limitRefusal, quote, refused } from "./internal/paths.js";
import {
  type BundleRootRender,
  type DuplicatesRender,
  type MarketplaceRender,
  type PlanRender,
  type PlanStep,
  planInstall as plan,
  suppliedFrameworkProblems,
  type WriteStep,
} from "./internal/plan.js";
import { profileProblems } from "./internal/profile.js";
import {
  type PluginMetadata,
  pluginMetadataProblems,
  type Recipe,
  recipeProblems,
} from "./internal/recipe.js";
import {
  bundleRootBytes,
  editFor,
  launcherBytes,
  namedBundles,
  renderBytes,
  renderNames,
  type ToolProfile,
} from "./internal/render.js";
import { marketplaceBytes, planRecipe as recipePlan } from "./internal/routes.js";
import { sha256Hex } from "./internal/sha256.js";
import { contentProblems } from "./internal/validate.js";

export type {
  AiSetup,
  AiSetupChange,
  Cell,
  Distribution,
  Qualification,
  SettingsCommand,
  SettingsFile,
} from "./internal/ai-setup.js";
export type {
  Content,
  ContentSource,
  Item,
  ItemFile,
  Notice,
  RuleScope,
} from "./internal/model.js";
export type {
  Binding,
  Clash,
  Duplicate,
  DuplicatesRender,
  FetchStep,
  LinkStep,
  MarketplaceRender,
  MergeStep,
  Missing,
  PlacementStep,
  Plan,
  PlanOptions,
  PlanResult,
  PlanStep,
  PluginStep,
  RecipeOrigin,
  RootPath,
  SetupStep,
  Unavailable,
  Warning,
  WriteStep,
} from "./internal/plan.js";
export type {
  PluginMetadata,
  Recipe,
  RecipeMember,
  RecipeOption,
  RecipePlugin,
  RecipeSetup,
  Route,
} from "./internal/recipe.js";
export type { ToolProfile } from "./internal/render.js";
export type {
  AcquireStep,
  ToolCommandStep,
  UpstreamInstallerStep,
} from "./internal/tools.js";

/**
 * Catalog's own authored content (framework and source `aih`): the duplicate-resolver agent a
 * plan that mixes frameworks adds. Plans place it without the caller supplying it; `files`
 * gives the bytes an installer copies for a step whose `from.sourceId` is `aih`.
 */
export { aihContent };

export type ReadContentResult =
  | { readonly status: "ok"; readonly content: Content }
  | Invalid
  | UnsupportedVersion
  | Refused;
export type ReadToolProfileResult =
  | { readonly status: "ok"; readonly profile: ToolProfile }
  | Invalid
  | UnsupportedVersion
  | Refused;

/**
 * Reads one document of `format` (its current URN; another version of the same format is
 * `unsupported-version`) within its byte limit, then checks it with `problemsOf`.
 */
function readDocument(
  bytes: Uint8Array,
  format: string,
  maxBytes: LimitName,
  problemsOf: (value: unknown) => readonly { path: string; message: string }[],
  spelling: "canonical" | "strict" = "strict",
): { status: "ok"; value: unknown } | Invalid | UnsupportedVersion | Refused {
  const family = format.slice(0, format.lastIndexOf(":") + 1);
  let value: unknown;
  try {
    const bounds = { maxBytes: limits[maxBytes], maxDepth: limits.documentDepth };
    value =
      spelling === "canonical"
        ? readCanonicalDocument(bytes, bounds)
        : readStrictDocument(bytes, bounds);
  } catch (error) {
    const reason = error instanceof JsonAdmissionError ? error.reason : "malformed-json";
    // Going over a published limit is a refusal naming the limit, never an invalid document.
    if (reason === "byte-limit") return limitRefusal(maxBytes, "the document");
    if (reason === "depth-limit") return limitRefusal("documentDepth", "the document's nesting");
    return {
      status: "invalid",
      problems: [
        {
          path: "",
          message: `the document is not ${spelling === "canonical" ? "canonical" : "strict"} JSON (${reason})`,
        },
      ],
    };
  }
  const schema = (value as { schema?: unknown } | null)?.schema;
  if (typeof schema === "string" && schema.startsWith(family) && schema !== format) {
    return { status: "unsupported-version", schema };
  }
  const problems = problemsOf(value);
  if (problems.length > 0) return { status: "invalid", problems };
  return { status: "ok", value: deepFreeze(value) };
}

/**
 * Reads a content document: strict JSON in any spelling (your own content need not be
 * canonical; `buildContent` writes the canonical form) within the content-file limit, with its
 * record shape and record-derived digests checked.
 */
export function readContent(bytes: Uint8Array): ReadContentResult {
  const result = readDocument(bytes, formats.content, "contentFileBytes", contentProblems);
  return result.status === "ok" ? { status: "ok", content: result.value as Content } : result;
}

/** Reads a tool profile document (pure data), strict JSON in any spelling, like content. */
export function readToolProfile(bytes: Uint8Array): ReadToolProfileResult {
  const result = readDocument(bytes, formats.toolProfile, "toolProfileBytes", profileProblems);
  return result.status === "ok" ? { status: "ok", profile: result.value as ToolProfile } : result;
}

export type ReadRecipeResult =
  | {
      readonly status: "ok";
      readonly recipe: Recipe;
      readonly plugin: PluginMetadata;
      /** The sha256 of the recipe's canonical form, which a recipe plan records as origin. */
      readonly sha256: string;
    }
  | Invalid
  | UnsupportedVersion
  | Refused;

/**
 * Reads a recipe plugin: its Agent Plugins `plugin.json` and its `recipe.json`, both strict
 * JSON in any spelling. The recipe's identity is the sha256 of its canonical form, a function of
 * the document, so `planRecipe` recomputes the origin hash itself.
 */
export function readRecipe(pluginJsonBytes: Uint8Array, recipeBytes: Uint8Array): ReadRecipeResult {
  const result = readDocument(recipeBytes, formats.recipe, "recipeBytes", recipeProblems);
  if (result.status !== "ok") return result;
  if (pluginJsonBytes instanceof Uint8Array && pluginJsonBytes.byteLength > limits.recipeBytes)
    return limitRefusal("recipeBytes", "plugin.json");
  if (!(pluginJsonBytes instanceof Uint8Array))
    return {
      status: "invalid",
      problems: [{ path: "plugin.json", message: "plugin.json is missing" }],
    };
  const plugin = readJson(pluginJsonBytes);
  if (
    plugin !== null &&
    typeof plugin === "object" &&
    "error" in plugin &&
    Object.keys(plugin).length === 1
  )
    return {
      status: "invalid",
      problems: [{ path: "plugin.json", message: String((plugin as { error: string }).error) }],
    };
  const problems = pluginMetadataProblems(plugin);
  if (problems.length > 0) return { status: "invalid", problems };
  return {
    status: "ok",
    recipe: result.value as Recipe,
    plugin: deepFreeze(plugin) as PluginMetadata,
    sha256: sha256Hex(new TextEncoder().encode(canonicalDocument(result.value))),
  };
}

export type ReadQualificationResult =
  | {
      readonly status: "ok";
      readonly qualification: Qualification;
      /** The sha256 of the exact bytes: the identity items and recipes reference. */
      readonly sha256: string;
    }
  | Invalid
  | UnsupportedVersion
  | Refused;

/**
 * Reads a qualification: canonical JSON, so its sha256 is a function of the document and a
 * planner recomputes it from the record it is given.
 */
export function readQualification(bytes: Uint8Array): ReadQualificationResult {
  const result = readDocument(
    bytes,
    formats.qualification,
    "qualificationBytes",
    qualificationProblems,
    // A qualification is named by the sha256 of its exact bytes, so only its canonical form.
    "canonical",
  );
  if (result.status !== "ok") return result;
  return {
    status: "ok",
    qualification: result.value as Qualification,
    sha256: sha256Hex(bytes),
  };
}

export type Availability = {
  readonly available: boolean;
  readonly how: "edition" | "rendered" | "none";
  readonly reason?: string;
};

/** Whether an item can be placed for a profile at project scope, and how (edition or render). */
export function availability(item: Item, profile: ToolProfile): Availability {
  const result = plan([item.id], [syntheticContent(item)], [profile], {
    scope: "project",
    data: null,
  });
  if (result.status !== "ok" && result.status !== "incomplete") {
    return {
      available: false,
      how: "none",
      reason: result.status === "refused" ? result.code : "invalid",
    };
  }
  const blocked = result.unavailable[0];
  if (blocked) return { available: false, how: "none", reason: blocked.reason };
  return { available: true, how: item.editions?.[profile.id] ? "edition" : "rendered" };
}

/** A one-item content around `item`, so availability reuses the planner's placement rules. */
function syntheticContent(item: Item): Content {
  const framework = item.id.split(".")[0] as string;
  const sourceIds = [...new Set(item.files.map((file) => file.sourceId))].sort();
  return {
    schema: formats.content,
    framework: { id: framework, name: framework },
    sources: sourceIds.map((id) => ({ id, kind: "authored" as const, notices: [] })),
    items: [item],
  };
}

/** The items of a content document, optionally of one kind or placeable for one client. */
export function listItems(
  content: Content,
  options: {
    /** Only items of this kind. */
    readonly kind?: string;
    /**
     * Only items placeable for one client. The option is named `cli`, as in the contract, but
     * it takes that client's tool profile (as `readToolProfile` returns it), not a client id.
     */
    readonly cli?: ToolProfile;
  } = {},
): Item[] {
  return content.items.filter(
    (item) =>
      (options.kind === undefined || item.kind === options.kind) &&
      (options.cli === undefined || availability(item, options.cli).available),
  );
}

export function getItem(
  content: Content,
  id: string,
): { readonly status: "ok"; readonly item: Item } | Refused {
  const item = content.items.find((candidate) => candidate.id === id);
  return item
    ? { status: "ok", item }
    : refused("unknown-item", `the item ${quote(String(id))} is not in this content`);
}

/** What a reader derives from an item's own files instead of storing it. */
export interface Derived {
  /** The content sources the item's files come from, sorted. */
  readonly sourceIds: readonly string[];
  /** Each file's path inside the installed item (a skill's files under its folder), sorted. */
  readonly packagePath: readonly string[];
  /** The bytes of the item's files together. */
  readonly size: number;
}

/**
 * `derive(item, content)`: the facts an item no longer stores, from its own files. Editions
 * and bundles are separate units and are not counted. A plain value over content already read.
 */
export function derive(item: Item, _content: Content): Derived {
  const sorted = (values: Iterable<string>) => [...new Set(values)].sort(compareCodeUnits);
  return {
    sourceIds: sorted(item.files.map((file) => file.sourceId)),
    packagePath: sorted(item.files.map((file) => installRelative(item, file))),
    size: item.files.reduce((total, file) => total + file.bytes, 0),
  };
}

/** `planInstall(selection, contents, profiles, { scope, data, copy?, names?})`. */
export const planInstall = plan;

export type { RecipeChoices, RecipePlanOptions } from "./internal/routes.js";
/**
 * `planRecipe(recipe, contents, profiles, choices, { scope, source, data?, copy?, names? })`:
 * the recipe's members and choices through each client's route, recording the recipe's
 * origin (`id`, the sha256 of its canonical bytes, and `source`) and its data identity.
 */
export const planRecipe = recipePlan;

export type RenderStepResult =
  | { readonly status: "ok"; readonly bytes: Uint8Array; readonly sha256: string }
  | Refused
  | Invalid;

/**
 * The bytes of one `write` step that has a `render` (or the block of a Markdown `merge`), from
 * the supplied source file. Refuses `source-mismatch` when the file's sha256 differs from the
 * step's and `profile-mismatch` when a supplied profile's version differs from the recorded
 * one. A combined render records every participating profile, and each must be supplied at its
 * recorded version. Declared input markers in the source survive the render unchanged. A
 * Markdown block never holds Catalog's own block marker, which would end or start another block.
 */
export function renderStep(
  step: PlanStep,
  suppliedContents: readonly Content[],
  profiles: readonly ToolProfile[],
  suppliedFiles: readonly {
    readonly sourceId?: string;
    readonly sourcePath: string;
    readonly bytes: Uint8Array;
  }[],
): RenderStepResult {
  const result = renderStepBytes(step, suppliedContents, profiles, suppliedFiles);
  if (
    result.status === "ok" &&
    step?.op === "merge" &&
    step.format === "markdown" &&
    new TextDecoder().decode(result.bytes).includes(BLOCK_MARKER)
  )
    return badRender("a Markdown block never holds Catalog's block marker");
  return result;
}

function renderStepBytes(
  step: PlanStep,
  suppliedContents: readonly Content[],
  profiles: readonly ToolProfile[],
  suppliedFiles: readonly {
    readonly sourceId?: string;
    readonly sourcePath: string;
    readonly bytes: Uint8Array;
  }[],
): RenderStepResult {
  // Catalog's own authored items render only from the library's content and bytes: supplied
  // content never claims its framework, and supplied files never stand in for its source.
  const supplied = Array.isArray(suppliedContents) ? suppliedContents : [];
  const claimed = suppliedFrameworkProblems(supplied);
  if (claimed.length > 0) return { status: "invalid", problems: claimed };
  const contents: readonly Content[] = [...supplied, aihContent.content];
  const files = [
    ...(Array.isArray(suppliedFiles) ? suppliedFiles : []).filter(
      (file) => file?.sourceId !== AUTHORED_FRAMEWORK,
    ),
    ...aihContent.files.map((file) => ({ ...file, bytes: file.bytes })),
  ];
  if (step?.op === "write" && step.render?.name === "duplicates-report") {
    const duplicates = (step.render as DuplicatesRender).duplicates;
    if (!Array.isArray(duplicates)) return badRender("the report lists its duplicates");
    return ok(new TextEncoder().encode(canonicalDocument({ duplicates })));
  }
  if (step?.op === "write" && step.render?.name === "plugin-marketplace") {
    const render = step.render;
    const profile = profiles.find((candidate) => candidate.id === render.profile);
    if (profile === undefined || profile.version !== render.version)
      return refused(
        "profile-mismatch",
        `the step was planned with ${render.profile} version ${render.version}`,
      );
    const bytes = marketplaceBytes(render);
    if ("reason" in bytes)
      return { status: "invalid", problems: [{ path: "step/render", message: bytes.reason }] };
    return { status: "ok", bytes, sha256: sha256Hex(bytes) };
  }
  if ((step?.op === "write" || step?.op === "merge") && step.render?.name === "bundle-root")
    return bundleRootStep(step.render as BundleRootRender, step.root, contents, profiles);
  if (step?.op === "write" && step.render?.name === "launcher")
    return launcherStep(step, step.render as PlanRender, contents, profiles);
  const render =
    step?.op === "write" || step?.op === "merge"
      ? (step.render as Exclude<
          WriteStep["render"],
          MarketplaceRender | BundleRootRender | DuplicatesRender
        >)
      : undefined;
  const from = step?.op === "write" || step?.op === "merge" ? step.from : undefined;
  const itemId =
    step?.op === "write" || step?.op === "merge" ? (from?.item ?? step.item) : undefined;
  if (
    render === undefined ||
    typeof itemId !== "string" ||
    (step.op === "merge" && from === undefined)
  ) {
    return {
      status: "invalid",
      problems: [
        { path: "step", message: "renderStep takes a write or Markdown merge step with a render" },
      ],
    };
  }
  if (!renderNames.includes(render.name))
    return {
      status: "invalid",
      problems: [{ path: "step/render/name", message: "unknown render" }],
    };
  const recorded: readonly { readonly id: unknown; readonly version: unknown }[] | undefined =
    "profiles" in render
      ? Array.isArray(render.profiles)
        ? render.profiles
        : undefined
      : [{ id: render.profile, version: render.version }];
  if (
    recorded === undefined ||
    !recorded.every((entry) => typeof entry?.id === "string" && Number.isInteger(entry.version))
  )
    return {
      status: "invalid",
      problems: [{ path: "step/render", message: "the render names its profiles and versions" }],
    };
  const used: ToolProfile[] = [];
  for (const { id, version } of recorded) {
    const profile = profiles.find((candidate) => candidate.id === id);
    if (profile === undefined)
      return refused("profile-mismatch", `no profile ${quote(String(id))} was supplied`);
    if (profile.version !== version)
      return refused(
        "profile-mismatch",
        `the step was planned with ${id} version ${version}, not version ${profile.version}`,
      );
    used.push(profile);
  }
  const item = contents
    .flatMap((content) => content.items)
    .find((candidate) => candidate.id === itemId);
  if (item === undefined)
    return refused("unknown-item", `the item ${quote(itemId)} is not in the supplied content`);
  let source: Uint8Array | undefined;
  if (from !== undefined) {
    const record = [
      ...item.files,
      ...Object.values(item.editions ?? {}).flatMap((edition) => edition.files),
    ].find((file) => file.sourceId === from.sourceId && file.sourcePath === from.sourcePath);
    if (record === undefined || record.sha256 !== from.sha256)
      return refused(
        "source-mismatch",
        `the content does not record ${quote(from.sourcePath)} with the step's sha256`,
      );
    const supplied = files.find(
      (file) =>
        file.sourcePath === from.sourcePath &&
        (file.sourceId === undefined || file.sourceId === from.sourceId),
    );
    if (supplied === undefined || !(supplied.bytes instanceof Uint8Array))
      return {
        status: "invalid",
        problems: [
          { path: "files", message: `the source file ${from.sourcePath} was not supplied` },
        ],
      };
    if (sha256Hex(supplied.bytes) !== from.sha256)
      return refused(
        "source-mismatch",
        `the supplied ${quote(from.sourcePath)} differs from the bytes the plan recorded`,
      );
    source = supplied.bytes;
  }
  const scope = (step as WriteStep).root;
  const edit = editFor(
    {
      name: render.name,
      installName: render.installName,
      ...(render.entry ? { entry: render.entry } : {}),
    },
    item,
    used,
    scope,
  );
  if ("reason" in edit)
    return { status: "invalid", problems: [{ path: "step/render", message: edit.reason }] };
  const result = renderBytes(edit, source);
  if ("reason" in result)
    return {
      status: "invalid",
      problems: [{ path: from?.sourcePath ?? "step", message: result.reason }],
    };
  const text = new TextDecoder().decode(result.bytes);
  for (const input of Object.values(item.requirements?.inputs ?? {}))
    if (
      input.placeholder?.sourcePath === from?.sourcePath &&
      input.placeholder &&
      !text.includes(input.placeholder.marker)
    )
      return {
        status: "invalid",
        problems: [
          { path: "step/render", message: "render guard: a declared input marker was lost" },
        ],
      };
  return { status: "ok", bytes: result.bytes, sha256: sha256Hex(result.bytes) };
}

const ok = (bytes: Uint8Array): RenderStepResult => ({
  status: "ok",
  bytes,
  sha256: sha256Hex(bytes),
});
const badRender = (message: string): Invalid => ({
  status: "invalid",
  problems: [{ path: "step/render", message }],
});

function profileAt(
  profiles: readonly ToolProfile[],
  id: unknown,
  version: unknown,
): ToolProfile | Refused {
  const profile = profiles.find((candidate) => candidate.id === id);
  if (profile === undefined)
    return refused("profile-mismatch", `no profile ${quote(String(id))} was supplied`);
  if (profile.version !== version)
    return refused(
      "profile-mismatch",
      `the step was planned with ${String(id)} version ${String(version)}, not version ${profile.version}`,
    );
  return profile;
}

/** The bundle-root rule's bytes, naming each recorded bundle's root from the supplied content. */
function bundleRootStep(
  render: BundleRootRender,
  scope: "project" | "user",
  contents: readonly Content[],
  profiles: readonly ToolProfile[],
): RenderStepResult {
  if (!Array.isArray(render.bundles) || render.bundles.length === 0)
    return badRender("the bundle-root render names its bundles");
  let frontmatter: Readonly<Record<string, unknown>> | undefined;
  if (render.profile !== undefined) {
    const profile = profileAt(profiles, render.profile, render.version);
    if ("status" in profile) return profile;
    const always = profile.ruleScopes?.always;
    if (always === undefined) return badRender("the profile has no always-on rule form");
    frontmatter = always.frontmatter;
  }
  const named = namedBundles(render.bundles, contents);
  if (!Array.isArray(named))
    return refused(
      "unknown-item",
      `the bundle ${quote(named.unknown)} is not in the supplied content`,
    );
  return ok(bundleRootBytes(named, scope, frontmatter));
}

/** A launcher's bytes: the recorded fallback entry of the profile, naming the recorded target. */
function launcherStep(
  step: WriteStep,
  render: PlanRender,
  contents: readonly Content[],
  profiles: readonly ToolProfile[],
): RenderStepResult {
  if (!("profile" in render) || typeof render.target !== "string")
    return badRender("a launcher names its profile and target");
  const profile = profileAt(profiles, render.profile, render.version);
  if ("status" in profile) return profile;
  const item = contents.flatMap((content) => content.items).find((entry) => entry.id === step.item);
  if (item === undefined || item.kind !== "skill" || item.bundle === undefined)
    return refused(
      "unknown-item",
      `the bundle skill ${quote(String(step.item))} is not in the supplied content`,
    );
  const entry = profile.userOnlyFallback?.[step.root]?.find(
    (candidate) => candidate.id === render.entry,
  );
  if (entry === undefined) return badRender("the profile has no such launcher place");
  return ok(launcherBytes(render.target, entry, step.root));
}
