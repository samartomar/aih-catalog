/**
 * `planInstall`: hand-selected items placed by tool profiles at project or user scope.
 * Each item and client first gives placements (a folder, a file or a merge entry); equal
 * placements then share one step with the union of their clients, different ones clash,
 * and user-scope folders become shared versions linked where the client documents links.
 * Nothing is claimed that a profile does not describe. Identical inputs give byte-identical
 * plans.
 */
import type { Invalid, Kind, Problem, Refused } from "../contracts.js";
import { kinds } from "../contracts.js";
import { type AiSetupChange, CELLS, type Cell, qualificationProblems } from "./ai-setup.js";
import {
  AUTHORED_FRAMEWORK,
  aihContent,
  DUPLICATE_RESOLVER,
  DUPLICATES_REPORT,
} from "./authored.js";
import { isRecord } from "./check.js";
import { installRelative } from "./identity.js";
import { canonicalJson } from "./json.js";
import {
  applySettings,
  literalProblem,
  lowerServer,
  lowerTool,
  restricts,
  serverSettings,
} from "./mcp.js";
import { type Bundle, type Content, INSTALL_NAME, type Item, type ItemFile } from "./model.js";
import {
  basenameOf,
  clashKey,
  compareCodeUnits,
  dirnameOf,
  isSafeRelativePath,
  isUnder,
  quote,
  refused,
} from "./paths.js";
import {
  type Place,
  type PluginVerify,
  type ProvidedKind,
  profileProblems,
  type Scope,
  type ToolProfile,
  type UserOnlyFallbackEntry,
} from "./profile.js";
import {
  agentTools,
  bundleRootBytes,
  changesBytes,
  editFor,
  editKey,
  namedBundles,
  type RenderName,
  scopeKeyOf,
} from "./render.js";
import { sha256Hex } from "./sha256.js";
import {
  type AcquireStep,
  planTools,
  type ToolCommandStep,
  type ToolLaunch,
  type ToolOptions,
  toolOptions,
  toolProblems,
  type UpstreamInstallerStep,
} from "./tools.js";
import { contentProblems } from "./validate.js";

export interface ProfileVersion {
  readonly id: string;
  readonly version: number;
}

/**
 * The render a step records: one profile's, or a combined render that names every
 * participating profile and version (a user-only skill in a folder several clients share).
 */
export type PlanRender =
  | {
      readonly name: RenderName;
      readonly profile: string;
      readonly version: number;
      readonly installName: string;
      readonly entry?: string;
      /** For a launcher: the installed `SKILL.md` it starts, from the step's root. */
      readonly target?: string;
    }
  | {
      readonly name: RenderName;
      readonly profiles: readonly ProfileVersion[];
      readonly installName: string;
      readonly entry?: string;
    };

/** Where a declared input is bound: exactly one destination form; never a value. */
export interface Binding {
  readonly item: string;
  readonly input: string;
  readonly at:
    | { readonly pointer: string }
    | { readonly placeholder: string }
    | { readonly argv: number }
    | { readonly env: string };
}

export interface SourceRef {
  readonly item?: string;
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly sha256: string;
}

/**
 * A generated file that is not made from an item file: the pinned local marketplace a plugin
 * route writes for a client that pins only through one (Copilot CLI).
 */
export interface MarketplaceRender {
  readonly name: "plugin-marketplace";
  readonly profile: string;
  readonly version: number;
  readonly marketplace: string;
  readonly plugin: string;
  readonly repository: string;
  readonly commit: string;
}

/**
 * The generated always-on rule that names where each placed bundle's root is
 * (`aih.rule.bundle-root`). A rule file records its profile for the frontmatter; a block in a
 * shared Markdown file is the same text for every client that shares the file.
 */
export interface BundleRootRender {
  readonly name: "bundle-root";
  readonly profile?: string;
  readonly version?: number;
  /** Each placed bundle and its root folder (with a trailing slash, or "" for the plan root). */
  readonly bundles: readonly { readonly bundle: string; readonly root: string }[];
}

/** The id and install name of the generated bundle-root rule. */
export const BUNDLE_ROOT_RULE = "aih.rule.bundle-root";
const BUNDLE_ROOT_NAME = "aih-bundle-root";

/** What a step lowered from a route records: its framework and, for a local plugin, the route. */
export interface RouteMarks {
  /** The indivisible framework a plugin, local-plugin or upstream-setup step belongs to. */
  readonly framework?: string;
  readonly route?: "local-plugin";
  /** On the first step of a local-plugin route group: the ids of the items it contains. */
  readonly contains?: readonly string[];
  /** The scan key of the plugin folder at its pin. */
  readonly scanKey?: string;
}

export interface WriteStep extends RouteMarks {
  readonly op: "write";
  readonly root: Scope;
  readonly path: string;
  readonly from?: SourceRef;
  readonly executable: boolean;
  readonly render?: PlanRender | MarketplaceRender | BundleRootRender | DuplicatesRender;
  /** A runtime bundle's root file: the bundle's id. */
  readonly bundle?: string;
  readonly scanned?: false;
  readonly item?: string;
  readonly items?: readonly string[];
  readonly clis: readonly string[];
  readonly inputs?: readonly Binding[];
}

export interface LinkStep {
  readonly op: "link";
  readonly root: "user";
  /** The client's folder; on Windows the installer makes a folder junction. */
  readonly path: string;
  readonly to: string;
  readonly item: string;
  readonly clis: readonly string[];
}

/**
 * A value in a merge entry that names a path under a plan root (an acquired executable): the
 * entry holds the path from that root, and the installer writes it as an absolute path.
 */
export interface RootPath {
  readonly pointer: string;
  readonly root: "user";
  readonly path: string;
}

export interface MergeStep extends RouteMarks {
  readonly op: "merge";
  readonly root: Scope;
  readonly file: string;
  readonly format: "json" | "toml" | "markdown";
  /** A JSON Pointer, a TOML table, or the item id that names a Markdown block. */
  readonly key: string;
  /** The structured entry (json, toml); a Markdown block takes its text from `from`. */
  readonly entry?: unknown;
  readonly from?: SourceRef;
  readonly render?: PlanRender | BundleRootRender;
  readonly scanned?: false;
  readonly item?: string;
  readonly items?: readonly string[];
  readonly clis: readonly string[];
  readonly inputs?: readonly Binding[];
  readonly rootPaths?: readonly RootPath[];
}

/**
 * A native plugin install at a pinned commit, run by the installer with the client's own
 * commands (the profile's `plugins.install`). `marketplace` is a URL or repository, or the
 * `{ root, path }` of a marketplace the plan writes itself; it is absent where the client
 * pins a plugin by its spec alone. `verify` is the profile's presence check, or `none`.
 */
export interface PluginStep {
  readonly op: "plugin";
  readonly cli: string;
  readonly framework: string;
  readonly marketplace?: string | { readonly root: Scope; readonly path: string };
  /** The name of a marketplace the plan writes itself, for the client's install command. */
  readonly marketplaceName?: string;
  readonly plugin: string;
  readonly repository: string;
  readonly commit: string;
  readonly scanKey: string;
  readonly verify: PluginVerify;
}

/** An upstream setup program: the installer clones, shows the exact command and runs it only after approval. */
export interface SetupStep {
  readonly op: "upstream-setup";
  readonly cli: string;
  readonly framework: string;
  readonly root: Scope;
  readonly repository: string;
  readonly commit: string;
  readonly into: string;
  readonly command: readonly string[];
  readonly needs: readonly string[];
  readonly scanned: false;
  readonly approval: "required";
}

/**
 * A file of an upstream-only item (`fetch: "upstream"`), which Catalog may not ship: the
 * installer fetches it from the pinned content source `source` and checks its sha256. The
 * first phase of a plan; never scanned for now.
 */
export interface FetchStep {
  readonly op: "fetch";
  readonly root: Scope;
  readonly path: string;
  /** The content source id; its recorded pin is the exact identity. */
  readonly source: string;
  readonly sourcePath: string;
  readonly sha256: string;
  readonly executable: boolean;
  readonly item?: string;
  readonly items?: readonly string[];
  readonly clis: readonly string[];
  readonly scanned: false;
}

/** Steps that place files or entries; each carries the clients it serves (`clis`). */
export type PlacementStep = FetchStep | WriteStep | LinkStep | MergeStep;
export type PlanStep =
  | PlacementStep
  | AcquireStep
  | PluginStep
  | SetupStep
  | UpstreamInstallerStep
  | ToolCommandStep;

export interface Missing {
  readonly item?: string;
  readonly framework?: string;
  readonly cli?: string;
  readonly reason: string;
  readonly dependency?: string;
}

export type UnavailableReason =
  | "not-implemented"
  | "not-described"
  | "unsupported-kind"
  | "no-user-only"
  | "user-only-shared-place"
  | "no-edition"
  | "no-edition-place"
  | "no-hook-event"
  | "no-path-scope"
  | "no-rule-scope"
  | "unsupported-server"
  | "no-bundle-place"
  | "no-qualification"
  | "not-qualified";

/**
 * What cannot be placed: an item for one client, or an AI setup (or a combination recipe) on
 * the plan's platform cell, with no qualification or none `qualified` (`cause` says why).
 */
export interface Unavailable {
  readonly item?: string;
  readonly recipe?: string;
  readonly cli?: string;
  readonly cell?: Cell;
  readonly reason: UnavailableReason;
  /** For `not-qualified`: `artifact-mismatch`, `blocked`, `unknown` or `no-closure`. */
  readonly cause?: string;
  readonly detail: string;
}

export interface Clash {
  readonly root: string;
  readonly path: string;
  readonly key?: string;
  readonly reason?:
    | "different-content"
    | "nested-key"
    | "write-and-merge"
    | "under-link"
    | "limit"
    | "built-in";
  /** For a `built-in` clash: the name the client already provides that the item would shadow. */
  readonly builtIn?: string;
  readonly items: readonly string[];
  readonly clis: readonly string[];
}

/**
 * What an item's text names that its route does not provide. A `path` reference is a source
 * file outside the item's own files that no placed bundle provides for these clients, so the
 * item would read a path that does not exist: it blocks the plan. A `name` reference is a
 * plugin-namespaced name (`ecc:security-reviewer`) that only the upstream's plugin provides: a
 * warning, with the chosen item it most likely means. Catalog never edits the text.
 */
export type Reference =
  | {
      readonly kind: "path";
      readonly item: string;
      /** The item file that names the path. */
      readonly file: string;
      /** The path from the source root. */
      readonly path: string;
      readonly clis: readonly string[];
    }
  | {
      readonly kind: "name";
      readonly item: string;
      readonly file: string;
      readonly name: string;
      /** The chosen item of the same framework with that name, when exactly one is. */
      readonly means?: string;
      readonly clis: readonly string[];
    };

export interface Warning {
  readonly code: string;
  /** The client the warning is about; absent for an AI setup warning. */
  readonly cli?: string;
  /** The AI setup an `unmanaged` or `licence-notice` warning is about. */
  readonly aiSetup?: string;
  readonly items: readonly string[];
  readonly framework?: string;
  /** For a route fallback: the route asked for and the route used. */
  readonly route?: { readonly from: string; readonly to: string };
}

export interface Plan {
  readonly status: "ok" | "incomplete";
  /** Only on a `planRecipe` plan. */
  readonly recipe?: RecipeOrigin;
  readonly data: { readonly repository: string; readonly commit: string } | null;
  readonly profiles: readonly { readonly id: string; readonly version: number }[];
  readonly plan: readonly PlanStep[];
  readonly missing: readonly Missing[];
  readonly unavailable: readonly Unavailable[];
  readonly clashes: readonly Clash[];
  readonly duplicates: readonly Duplicate[];
  readonly references: readonly Reference[];
  readonly warnings: readonly Warning[];
}

/**
 * A fact about mixed frameworks: items sharing one install name across frameworks, or items
 * with the same `contentSha256` under different ids. Catalog never picks a winner.
 */
export interface Duplicate {
  readonly by: "name" | "content";
  readonly kind: string;
  /** For `name`: the install name the items share. */
  readonly name?: string;
  /** For `content`: the shared content identity. */
  readonly contentSha256?: string;
  readonly items: readonly string[];
  readonly frameworks: readonly string[];
  /** The clients the items are planned for. */
  readonly clis: readonly string[];
}

/** The duplicates report a mixed plan writes for the resolver agent; its bytes are canonical JSON. */
export interface DuplicatesRender {
  readonly name: "duplicates-report";
  readonly duplicates: readonly Duplicate[];
}

/** A recipe plan's origin: the recipe id, the sha256 of its exact bytes, and where it was read. */
export interface RecipeOrigin {
  readonly id: string;
  readonly sha256: string;
  readonly repository: string;
  readonly commit: string;
}

export type PlanResult = Plan | Invalid | Refused;

export interface PlanOptions extends ToolOptions {
  readonly scope: Scope;
  readonly data: { readonly repository: string; readonly commit: string } | null;
  readonly copy?: boolean;
  readonly names?: Readonly<Record<string, string>>;
}

const OPTION_KEYS = [
  "scope",
  "data",
  "copy",
  "names",
  "cell",
  "qualifications",
  "upstreamInstallers",
];
const union = (...lists: readonly (readonly string[])[]): string[] =>
  [...new Set(lists.flat())].sort(compareCodeUnits);

interface OutputRender {
  readonly name: RenderName;
  readonly entry?: string;
  /** For a combined render: every participating profile, sorted by id. */
  readonly profiles?: readonly ProfileVersion[];
}

/** One file of a placement, relative to its unit. */
interface Output {
  readonly rel: string;
  readonly from?: SourceRef;
  readonly executable: boolean;
  readonly render?: OutputRender;
  readonly edit?: string;
  readonly inputs?: readonly Binding[];
}

type Unit =
  | {
      readonly shape: "folder";
      readonly path: string;
      readonly outputs: readonly Output[];
      readonly linkable: boolean;
    }
  | { readonly shape: "file"; readonly path: string; readonly output: Output }
  | {
      readonly shape: "merge";
      readonly file: string;
      readonly format: "json" | "toml" | "markdown";
      readonly key: string;
      readonly entry?: unknown;
      readonly output?: Output;
      readonly inputs?: readonly Binding[];
      readonly rootPaths?: readonly RootPath[];
      readonly limitBytes?: number;
      readonly bytes?: number;
    };

/** One item's placement for one client. */
interface Placed {
  readonly unit: Unit;
  readonly item: Item;
  readonly framework: string;
  readonly installName: string;
  readonly profile: ToolProfile;
  /** For a client that shares another client's place when planned. */
  readonly reuse?: readonly string[];
  /** For a sharing client: why its own place cannot be used when nothing is shared. */
  readonly failure?: Failure;
  /** For a shared copy: the placement whose bytes it takes. */
  readonly representative?: Placed;
  /** The runtime bundle the item reads. */
  readonly bundle?: Bundle;
  /** For a user-only bundle skill on a client with no flag: the launchers that start it. */
  readonly launchers?: readonly UserOnlyFallbackEntry[];
}

type Failure = { readonly reason: UnavailableReason; readonly detail: string };

const fill = (template: string, name: string) => template.replaceAll("<name>", name);
const fromOf = (item: Item, file: ItemFile): SourceRef => ({
  item: item.id,
  sourceId: file.sourceId,
  sourcePath: file.sourcePath,
  sha256: file.sha256,
});

/** Placeholder bindings for an output made from one item file. */
function placeholders(item: Item, sourcePath: string): Binding[] | undefined {
  const bindings = Object.entries(item.requirements?.inputs ?? {})
    .filter(([, input]) => input.placeholder?.sourcePath === sourcePath)
    .map(([input, declaration]) => ({
      item: item.id,
      input,
      at: { placeholder: declaration.placeholder?.marker as string },
    }));
  return bindings.length > 0 ? bindings : undefined;
}

function output(
  item: Item,
  file: ItemFile | undefined,
  rel: string,
  profile: ToolProfile | readonly ToolProfile[],
  scope: Scope,
  installName: string,
  render: { name: RenderName; entry?: string } | null,
  always = false,
): Output | Failure {
  const profiles = Array.isArray(profile) ? profile : [profile as ToolProfile];
  const base = file
    ? {
        rel,
        from: fromOf(item, file),
        executable: file.executable,
        ...(placeholders(item, file.sourcePath)
          ? { inputs: placeholders(item, file.sourcePath) }
          : {}),
      }
    : { rel, executable: false };
  if (render === null) return base;
  const edit = editFor({ ...render, installName }, item, profiles, scope);
  if ("reason" in edit) return { reason: "not-described", detail: edit.reason };
  if (!always && !changesBytes(edit)) return base;
  const record: OutputRender = Array.isArray(profile)
    ? { ...render, profiles: profiles.map(({ id, version }) => ({ id, version })) }
    : render;
  return { ...base, render: record, edit: editKey(edit) };
}

const isFailure = (value: unknown): value is Failure =>
  isRecord(value) && typeof value.reason === "string" && typeof value.detail === "string";

function resolvePlace(place: Place | undefined, name: string) {
  if (place === undefined) return undefined;
  if (typeof place === "string") return { path: fill(place, name) };
  return {
    path: fill(place.otherwise, name),
    reuse: place.reuse.map((entry) => fill(entry, name)),
  };
}

const folderPath = (path: string) => (path.endsWith("/") ? path.slice(0, -1) : path);

/** The placements of one item for one client, or why it cannot be placed. */
function place(
  item: Item,
  content: Content,
  profile: ToolProfile,
  scope: Scope,
  installName: string,
  launch?: ToolLaunch,
): Placed[] | Failure {
  const framework = content.framework.id;
  const bundle =
    item.bundle === undefined
      ? undefined
      : content.bundles?.find((candidate) => candidate.id === item.bundle);
  const placed = (unit: Unit, reuse?: readonly string[]): Placed => ({
    unit,
    item,
    framework,
    installName,
    profile,
    ...(reuse ? { reuse } : {}),
    ...(bundle ? { bundle } : {}),
  });
  if (!(kinds as readonly string[]).includes(item.kind))
    return {
      reason: "not-implemented",
      detail: `planning ${item.kind} items is not implemented yet`,
    };
  const unsupported = profile.unsupported?.[item.kind];
  if (unsupported !== undefined) return { reason: "unsupported-kind", detail: unsupported };
  const edition = item.editions?.[profile.id];
  const own = item.files.filter((file) => file.cli === undefined || file.cli === profile.id);

  if (item.kind === "hook") {
    if (edition === undefined)
      return { reason: "no-edition", detail: "a hook is placed only from its upstream edition" };
    const event = item.event as string;
    if (profile.hookEvents !== undefined && profile.hookEvents[event] === undefined)
      return { reason: "no-hook-event", detail: `the client has no ${event} event` };
  }
  if (edition !== undefined && item.kind !== "skill") {
    const folder = profile.editionPlaces?.[item.kind as "agent" | "rule" | "hook"]?.[scope];
    const single = edition.files.length === 1 ? edition.files[0] : undefined;
    const template =
      item.kind === "agent"
        ? resolvePlace(profile.places.agent?.[scope], installName)
        : item.kind === "rule"
          ? (() => {
              const entry = profile.places.rule?.[scope]?.[scopeKeyOf(item)];
              return typeof entry === "string" ? { path: fill(entry, installName) } : undefined;
            })()
          : undefined;
    if (folder === undefined && (single === undefined || template === undefined))
      return {
        reason: "no-edition-place",
        detail: "the client describes no place for this edition",
      };
    return edition.files.map((file) =>
      placed({
        shape: "file",
        path:
          folder !== undefined
            ? `${folder}${basenameOf(file.sourcePath)}`
            : (template?.path as string),
        output: { rel: "", from: fromOf(item, file), executable: file.executable },
      }),
    );
  }

  switch (item.kind) {
    case "skill": {
      if (edition !== undefined) {
        const target = resolvePlace(profile.places.skill?.[scope], installName);
        if (target === undefined)
          return { reason: "not-described", detail: `the client has no ${scope} skill place` };
        const view = { kind: "skill", files: edition.files };
        return [
          placed({
            shape: "folder",
            path: folderPath(target.path),
            linkable: profile.links.skill === "documented",
            outputs: edition.files.map((file) => ({
              rel: installRelative(view, file),
              from: fromOf(item, file),
              executable: file.executable,
            })),
          }),
        ];
      }
      const skill = own.find((file) => installRelative(item, file) === "SKILL.md");
      if (skill === undefined)
        return { reason: "not-implemented", detail: "the skill has no SKILL.md" };
      // A bundle skill keeps its folder in the bundle layout (never linked, so its relative
      // paths stay put); where the client has no user-only flag, launchers start it.
      if (bundle !== undefined) {
        const fixed = profile.bundleRoot?.[scope];
        const target =
          fixed !== undefined
            ? {
                path: fill(
                  `${fixed.replaceAll("<framework>", framework)}${bundle.layout}`,
                  installName,
                ),
              }
            : resolvePlace(profile.places.skill?.[scope], installName);
        if (target === undefined)
          return { reason: "not-described", detail: `the client has no ${scope} skill place` };
        const launchers =
          item.userOnly && profile.userOnly === "none"
            ? profile.userOnlyFallback?.[scope]
            : undefined;
        if (item.userOnly && profile.userOnly === "none" && launchers === undefined)
          return {
            reason: "no-user-only",
            detail: `the client can neither flag nor launch a user-only skill at ${scope} scope`,
          };
        const outputs = skillOutputs(item, own, skill, profile, scope, installName);
        if (isFailure(outputs)) return outputs;
        const unit: Unit = {
          shape: "folder",
          path: folderPath(target.path),
          outputs,
          linkable: false,
        };
        return [
          {
            ...placed(unit, "reuse" in target ? target.reuse?.map(folderPath) : undefined),
            ...(launchers ? { launchers } : {}),
          },
        ];
      }
      if (item.userOnly && profile.userOnly === "none") {
        const fallback = profile.userOnlyFallback?.[scope];
        if (fallback === undefined)
          return {
            reason: "no-user-only",
            detail: `the client can neither flag nor fall back for a user-only skill at ${scope} scope`,
          };
        if (own.length > 1)
          return {
            reason: "not-implemented",
            detail: "a user-only fallback for a skill with support files is not implemented yet",
          };
        const units: Placed[] = [];
        for (const entry of fallback) {
          const made = output(item, skill, "", profile, scope, installName, {
            name: "user-only-fallback",
            entry: entry.id,
          });
          if (isFailure(made)) return made;
          units.push(placed({ shape: "file", path: fill(entry.path, installName), output: made }));
        }
        return units;
      }
      const target = resolvePlace(profile.places.skill?.[scope], installName);
      if (target === undefined)
        return { reason: "not-described", detail: `the client has no ${scope} skill place` };
      const outputs = skillOutputs(item, own, skill, profile, scope, installName);
      if (isFailure(outputs)) return outputs;
      return [
        placed(
          {
            shape: "folder",
            path: folderPath(target.path),
            outputs,
            linkable: profile.links.skill === "documented",
          },
          target.reuse?.map(folderPath),
        ),
      ];
    }
    case "agent": {
      const target = resolvePlace(profile.places.agent?.[scope], installName);
      if (target === undefined || profile.agentFile === undefined)
        return { reason: "not-described", detail: `the client has no ${scope} agent place` };
      const prompt = own.find((file) => file.sourcePath === item.agent?.prompt);
      if (prompt === undefined)
        return { reason: "not-implemented", detail: "the agent has no prompt file" };
      const made: Unit | Failure = (() => {
        const entry = output(
          item,
          prompt,
          "",
          profile,
          scope,
          installName,
          { name: "agent" },
          profile.agentFile?.format !== "claude-md",
        );
        return isFailure(entry)
          ? entry
          : { shape: "file" as const, path: target.path, output: entry };
      })();
      // A client that reads another client's agent file takes it only when that is planned.
      if (target.reuse) {
        const own = isFailure(made)
          ? { shape: "file" as const, path: target.path, output: { rel: "", executable: false } }
          : made;
        return [{ ...placed(own, target.reuse), ...(isFailure(made) ? { failure: made } : {}) }];
      }
      return isFailure(made) ? made : [placed(made)];
    }
    case "rule": {
      const key = scopeKeyOf(item);
      const places = profile.places.rule?.[scope];
      const target = places?.[key];
      if (target === undefined) {
        if (places === undefined)
          return { reason: "not-described", detail: `the client has no ${scope} rule place` };
        return key === "paths"
          ? { reason: "no-path-scope", detail: "the client has no path-scoped rules" }
          : { reason: "no-rule-scope", detail: `the client has no ${key} rules` };
      }
      const file = own[0] as ItemFile;
      if (typeof target !== "string") {
        const made = output(
          item,
          file,
          "",
          profile,
          scope,
          installName,
          { name: "rule-block" },
          true,
        );
        if (isFailure(made)) return made;
        return [
          placed({
            shape: "merge",
            file: target.file,
            format: "markdown",
            key: item.id,
            output: made,
            bytes: file.bytes,
            ...(target.limitBytes ? { limitBytes: target.limitBytes } : {}),
          }),
        ];
      }
      if (profile.ruleScopes?.[key] === undefined)
        return { reason: "not-described", detail: `the client describes no ${key} rule form` };
      const made = output(item, file, "", profile, scope, installName, { name: "rule" });
      if (isFailure(made)) return made;
      return [placed({ shape: "file", path: fill(target, installName), output: made })];
    }
    case "mcp": {
      const target = profile.places.mcp?.[scope];
      if (target === undefined || profile.mcpFile === undefined)
        return { reason: "not-described", detail: `the client has no ${scope} MCP place` };
      if (edition !== undefined)
        return { reason: "not-implemented", detail: "MCP editions are not implemented yet" };
      if (launch !== undefined && launch.path === undefined)
        return {
          reason: "no-qualification",
          detail: "its AI setup is not acquired for the cell: no qualified artifact",
        };
      const lowered =
        launch === undefined
          ? lowerServer(item, profile.mcpFile)
          : lowerTool(item, launch, profile.mcpFile, profile.id);
      if ("reason" in lowered) return { reason: "unsupported-server", detail: lowered.reason };
      const settings = applySettings(lowered.entry, serverSettings(item, launch), profile.mcpFile);
      if ("reason" in settings) return { reason: "unsupported-server", detail: settings.reason };
      const literal = literalProblem(
        settings.entry,
        Object.keys(item.requirements?.inputs ?? {}),
        Object.values(profile.inputReferences).flatMap((reference) =>
          typeof reference === "object" ? [reference.syntax] : [],
        ),
      );
      if (literal !== undefined) return { reason: "unsupported-server", detail: literal };
      const rootPaths = (lowered as { rootPaths?: readonly RootPath[] }).rootPaths ?? [];
      return [
        placed({
          shape: "merge",
          file: target.file,
          format: target.format,
          key: fill(target.key, installName),
          entry: settings.entry,
          ...(lowered.inputs.length > 0 ? { inputs: lowered.inputs } : {}),
          ...(rootPaths.length > 0 ? { rootPaths } : {}),
        }),
      ];
    }
    case "document": {
      const target = profile.places.document?.[scope];
      if (target === undefined)
        return {
          reason: "not-described",
          detail: `no client documents a ${scope} place for documents`,
        };
      const root = commonFolder(own.map((file) => file.sourcePath));
      return [
        placed({
          shape: "folder",
          path: folderPath(fill(target, installName)),
          linkable: false,
          outputs: own.map((file) => ({
            rel: root === "" ? file.sourcePath : file.sourcePath.slice(root.length + 1),
            from: fromOf(item, file),
            executable: file.executable,
          })),
        }),
      ];
    }
    default:
      return {
        reason: "not-implemented",
        detail: `planning ${item.kind} items is not implemented yet`,
      };
  }
}

/**
 * A rendered skill folder's outputs: its files with `SKILL.md` rendered, and the files the
 * client marks a user-only skill with. Several profiles give the combined renders.
 */
function skillOutputs(
  item: Item,
  own: readonly ItemFile[],
  skill: ItemFile,
  profiles: ToolProfile | readonly ToolProfile[],
  scope: Scope,
  installName: string,
): Output[] | Failure {
  const shared = Array.isArray(profiles);
  const list: readonly ToolProfile[] = shared ? profiles : [profiles as ToolProfile];
  const generated = item.userOnly
    ? union(
        list.flatMap((profile) =>
          profile.userOnly !== "none" && "file" in profile.userOnly
            ? [profile.userOnly.file.path]
            : [],
        ),
      )
    : [];
  const outputs: Output[] = [];
  for (const file of own) {
    const rel = installRelative(item, file);
    if (generated.includes(rel)) continue;
    const name: RenderName = shared ? "shared-skill" : "skill";
    const made = output(
      item,
      file,
      rel,
      profiles,
      scope,
      installName,
      file === skill ? { name } : null,
    );
    if (isFailure(made)) return made;
    outputs.push(made);
  }
  for (const rel of generated) {
    const upstream = own.find((file) => installRelative(item, file) === rel);
    const render = shared
      ? { name: "shared-user-only-file" as const, entry: rel }
      : { name: "user-only-file" as const };
    const made = output(item, upstream, rel, profiles, scope, installName, render, true);
    if (isFailure(made)) return made;
    outputs.push(made);
  }
  return outputs.sort((left, right) => compareCodeUnits(left.rel, right.rel));
}

/**
 * One combined render for a user-only skill placed in one folder by several clients: the
 * union of their user-only markers, so the folder is byte-identical for all of them. Undefined
 * when they cannot share one (different items, an edition, different files, or a render that
 * does not apply, such as disagreeing on rewording `$ARGUMENTS`); the folder then clashes.
 */
function combined(members: readonly Placed[], scope: Scope): Unit | undefined {
  const first = members[0];
  if (first === undefined || first.unit.shape !== "folder") return undefined;
  const { item, installName } = first;
  const profiles = [...new Map(members.map((member) => [member.profile.id, member.profile]))]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([, profile]) => profile);
  if (profiles.length < 2 || item.kind !== "skill" || !item.userOnly) return undefined;
  if (
    members.some(
      (member) =>
        member.item.id !== item.id ||
        member.installName !== installName ||
        member.unit.shape !== "folder" ||
        item.editions?.[member.profile.id] !== undefined,
    )
  )
    return undefined;
  // The folder holds every sharing client's files; a file only one client uses (`cli`) is
  // credited to that client when the folder is written.
  const ids = profiles.map((profile) => profile.id);
  const own = item.files.filter((file) => file.cli === undefined || ids.includes(file.cli));
  const skill = own.find((file) => installRelative(item, file) === "SKILL.md");
  if (skill === undefined) return undefined;
  const outputs = skillOutputs(item, own, skill, profiles, scope, installName);
  if (isFailure(outputs)) return undefined;
  return {
    shape: "folder",
    path: first.unit.path,
    outputs,
    linkable: profiles.every((profile) => profile.links.skill === "documented"),
  };
}

/**
 * The placements without those of clients that have no user-only flag where a user-only skill's
 * folder is shared with clients that flag it; each removed one is reported unavailable.
 */
function withoutUnflaggedSharers(
  resolved: readonly Placed[],
  unavailable: Unavailable[],
): Placed[] {
  const removed = new Set<Placed>();
  const folders = resolved.filter(
    (entry) => entry.unit.shape === "folder" && entry.item.kind === "skill" && entry.item.userOnly,
  );
  for (const members of group(folders, (entry) => (entry.unit as { path: string }).path)) {
    const unflagged = members.filter((member) => member.profile.userOnly === "none");
    const flagged = members.filter((member) => member.profile.userOnly !== "none");
    if (unflagged.length === 0 || flagged.length === 0) continue;
    const path = (members[0]?.unit as { path: string }).path;
    const by = union(flagged.map((member) => member.profile.id)).join(", ");
    for (const member of unflagged) {
      removed.add(member);
      unavailable.push({
        item: member.item.id,
        cli: member.profile.id,
        reason: "user-only-shared-place",
        detail: `${path} is shared with ${by}, which flag the skill user-only; this client has no user-only flag, so plan it for this client without them`,
      });
    }
  }
  return resolved.filter((entry) => !removed.has(entry));
}

function commonFolder(paths: readonly string[]): string {
  let folder = dirnameOf(paths[0] ?? "");
  while (folder !== "" && !paths.every((path) => isUnder(path, folder) && path !== folder))
    folder = dirnameOf(folder);
  return folder;
}

/**
 * A placement's folder split into what every client shares and the outputs of files only this
 * client uses (`cli`). Other units are shared whole.
 */
function clientFiles(placed: Placed): { common: Unit; own: Output[] } {
  const unit = placed.unit;
  if (unit.shape !== "folder") return { common: unit, own: [] };
  const cliOf = (output: Output) =>
    output.from === undefined
      ? undefined
      : placed.item.files.find(
          (file) =>
            file.cli !== undefined &&
            file.sourceId === output.from?.sourceId &&
            file.sourcePath === output.from?.sourcePath,
        )?.cli;
  return {
    common: { ...unit, outputs: unit.outputs.filter((output) => cliOf(output) === undefined) },
    own: unit.outputs.filter((output) => cliOf(output) === placed.profile.id),
  };
}

/** Everything that decides a unit's bytes, without its clients or their link support. */
function signature(unit: Unit): string {
  if (unit.shape !== "folder") return canonicalJson(unit);
  const { linkable: _linkable, ...rest } = unit;
  return canonicalJson(rest);
}

function versionOf(placed: Placed, outputs: readonly Output[]): string {
  const files = [...outputs]
    .sort((left, right) => compareCodeUnits(left.rel, right.rel))
    .map((entry) => ({
      executable: entry.executable,
      path: entry.rel,
      ...(entry.from ? { sha256: entry.from.sha256 } : {}),
      ...(entry.render ? { render: renderRecord(entry.render, placed) } : {}),
    }));
  return sha256Hex(
    new TextEncoder().encode(
      canonicalJson({
        behaviourSha256: placed.item.behaviourSha256,
        description: placed.item.description,
        files,
        name: placed.installName,
      }),
    ),
  ).slice(0, 12);
}

function renderRecord(render: OutputRender, placed: Placed): PlanRender {
  const entry = render.entry === undefined ? {} : { entry: render.entry };
  if (render.profiles !== undefined)
    return {
      name: render.name,
      profiles: render.profiles,
      installName: placed.installName,
      ...entry,
    };
  return {
    name: render.name,
    profile: placed.profile.id,
    version: placed.profile.version,
    installName: placed.installName,
    ...entry,
  };
}

function writeOf(
  root: Scope,
  path: string,
  entry: Output,
  placed: Placed,
  clis: readonly string[],
): WriteStep {
  return {
    op: "write",
    root,
    path,
    ...(entry.from ? { from: entry.from } : {}),
    executable: entry.executable,
    ...(entry.render
      ? { render: renderRecord(entry.render, placed), scanned: false as const }
      : {}),
    item: placed.item.id,
    clis,
    ...(entry.inputs ? { inputs: entry.inputs } : {}),
  };
}

const MARKDOWN_OVERHEAD = (id: string) =>
  `<!-- aih:begin ${id} -->\n`.length + `<!-- aih:end ${id} -->\n`.length;

interface PlacedBundle {
  readonly bundle: Bundle;
  readonly root: string;
  readonly items: Set<string>;
}

interface BundlePlacement {
  /** The placements left after bundle checks (agents read from the bundle are dropped). */
  readonly kept: Placed[];
  readonly unavailable: Unavailable[];
  readonly ruleUnavailable: Unavailable[];
  /** Agents a client reads from the bundle's own files rather than from a placement. */
  readonly served: { readonly item: string; readonly cli: string }[];
  readonly writes: WriteStep[];
  readonly merges: MergeStep[];
  /** Per client: each placed bundle and its root. */
  readonly roots: ReadonlyMap<string, ReadonlyMap<string, PlacedBundle>>;
  /** Per client with a placed bundle: the items placed with it. */
  readonly byCli: ReadonlyMap<string, string[]>;
}

/** The bundle root of a skill folder: the folder with the filled layout taken off its end. */
function rootOf(path: string, layout: string, name: string): string | undefined {
  const suffix = folderPath(fill(layout, name));
  if (path === suffix) return "";
  return path.endsWith(`/${suffix}`) ? path.slice(0, path.length - suffix.length) : undefined;
}

/** A client's bundle root when no bundle skill fixes it: its own bundle root or skill place. */
function templateRoot(
  profile: ToolProfile,
  bundle: Bundle,
  framework: string,
  scope: Scope,
): string | undefined {
  const fixed = profile.bundleRoot?.[scope];
  if (fixed !== undefined) return fixed.replaceAll("<framework>", framework);
  const place = profile.places.skill?.[scope];
  if (place === undefined) return undefined;
  const template = typeof place === "string" ? place : place.otherwise;
  return rootOf(folderPath(fill(template, "x")), bundle.layout, "x");
}

const sortedSet = (values: Iterable<string>) => [...new Set(values)].sort(compareCodeUnits);

/**
 * The files and folders the planned clients read as configuration at this scope, by clash key:
 * MCP files, local-plugin and built-in switch-off settings, shared rule files, the VS Code
 * folder-overlap setting and hook edition folders (folders end in `/`).
 */
function configSurfaces(profiles: readonly ToolProfile[], scope: Scope): Set<string> {
  const found = new Set<string>();
  const add = (path: string | undefined) => {
    if (path !== undefined) found.add(clashKey(path));
  };
  for (const profile of profiles) {
    add(profile.places.mcp?.[scope]?.file);
    for (const entry of profile.localPlugins?.[scope]?.register ?? []) add(entry.file);
    const disable = profile.disableBuiltIn;
    if (typeof disable === "object" && disable.setting?.root === scope) add(disable.setting.file);
    for (const place of Object.values(profile.places.rule?.[scope] ?? {}))
      if (typeof place === "object") add(place.file);
    if (scope === "project") add(profile.skillFolderOverlap?.merge.file);
    const hooks = profile.editionPlaces?.hook?.[scope];
    if (hooks !== undefined) add(hooks.endsWith("/") ? hooks : `${hooks}/`);
  }
  return found;
}

/**
 * Whether a planned path is configuration a client runs or loads: a listed surface or a file
 * below a listed folder, any `settings*.json` file, or anything in a `hooks` folder.
 */
function onConfigSurface(path: string, surfaces: ReadonlySet<string>): boolean {
  const key = clashKey(path);
  if (surfaces.has(key)) return true;
  for (const surface of surfaces) if (surface.endsWith("/") && key.startsWith(surface)) return true;
  const segments = key.split("/");
  return (
    /^settings[^/]*\.json$/.test(segments.at(-1) ?? "") || segments.slice(0, -1).includes("hooks")
  );
}

/**
 * Places each client's runtime bundles: the root files once per root at their upstream paths,
 * copied as one unit at both scopes, the launchers of user-only bundle skills, and the
 * bundle-root rule in each client's always-on rule place.
 */
function placeBundles(
  resolved: readonly Placed[],
  profiles: readonly ToolProfile[],
  scope: Scope,
): BundlePlacement {
  const roots = new Map<string, Map<string, PlacedBundle>>();
  const rootsOf = (cli: string) => {
    const known = roots.get(cli) ?? new Map<string, PlacedBundle>();
    roots.set(cli, known);
    return known;
  };
  const unavailable: Unavailable[] = [];
  const dropped = new Set<Placed>();
  const fail = (entry: Placed, detail: string) => {
    unavailable.push({
      item: entry.item.id,
      cli: entry.profile.id,
      reason: "no-bundle-place",
      detail,
    });
    dropped.add(entry);
  };
  const isSkillFolder = (entry: Placed) =>
    entry.item.kind === "skill" && entry.unit.shape === "folder";
  for (const entry of resolved) {
    const bundle = entry.bundle;
    if (bundle === undefined || !isSkillFolder(entry)) continue;
    const root = rootOf((entry.unit as { path: string }).path, bundle.layout, entry.installName);
    const known = rootsOf(entry.profile.id).get(bundle.id);
    if (root === undefined) fail(entry, "the skill folder does not end in the bundle layout");
    else if (known !== undefined && known.root !== root)
      fail(entry, "the client would place the bundle at two roots");
    else if (known !== undefined) known.items.add(entry.item.id);
    else
      rootsOf(entry.profile.id).set(bundle.id, { bundle, root, items: new Set([entry.item.id]) });
  }
  const served: { item: string; cli: string }[] = [];
  for (const entry of resolved) {
    const bundle = entry.bundle;
    if (bundle === undefined || isSkillFolder(entry) || dropped.has(entry)) continue;
    let known = rootsOf(entry.profile.id).get(bundle.id);
    if (known === undefined) {
      const root = templateRoot(entry.profile, bundle, entry.framework, scope);
      if (root === undefined) {
        fail(entry, `the client has no ${scope} place for the bundle's root`);
        continue;
      }
      known = { bundle, root, items: new Set() };
      rootsOf(entry.profile.id).set(bundle.id, known);
    }
    known.items.add(entry.item.id);
    const prompt = entry.item.agent?.prompt;
    if (
      entry.item.kind === "agent" &&
      entry.unit.shape === "file" &&
      prompt !== undefined &&
      bundle.files.some((file) => file.sourcePath === prompt) &&
      dirnameOf(entry.unit.path) === folderPath(`${known.root}${dirnameOf(prompt)}`)
    ) {
      served.push({ item: entry.item.id, cli: entry.profile.id });
      dropped.add(entry);
    }
  }

  // A bundle file never lands on a file or folder a planned client reads as configuration: the
  // bundle is not placed for that client.
  const surfaces = configSurfaces(profiles, scope);
  let blocked = served;
  for (const [cli, map] of roots)
    for (const [id, placed] of map) {
      const hit = placed.bundle.files
        .map((file) => `${placed.root}${file.sourcePath}`)
        .find((path) => onConfigSurface(path, surfaces));
      if (hit === undefined) continue;
      map.delete(id);
      blocked = blocked.filter((entry) => entry.cli !== cli || !placed.items.has(entry.item));
      for (const entry of resolved)
        if (entry.profile.id === cli && entry.bundle?.id === id) {
          unavailable.push({
            item: entry.item.id,
            cli,
            reason: "no-bundle-place",
            detail: `the bundle file ${quote(hit)} would land on the client's configuration`,
          });
          dropped.add(entry);
        }
    }
  served.splice(0, served.length, ...blocked);

  const writes: WriteStep[] = [];
  const groups = new Map<string, { placed: PlacedBundle; items: Set<string>; clis: Set<string> }>();
  const byCli = new Map<string, string[]>();
  for (const [cli, map] of roots) {
    if (map.size === 0) continue;
    byCli.set(cli, sortedSet([...map.values()].flatMap((placed) => [...placed.items])));
    for (const placed of map.values()) {
      const key = `${placed.root}\0${placed.bundle.id}`;
      const group = groups.get(key) ?? {
        placed,
        items: new Set<string>(),
        clis: new Set<string>(),
      };
      for (const item of placed.items) group.items.add(item);
      group.clis.add(cli);
      groups.set(key, group);
    }
  }
  for (const { placed, items, clis } of groups.values())
    for (const file of placed.bundle.files)
      writes.push({
        op: "write",
        root: scope,
        path: `${placed.root}${file.sourcePath}`,
        from: {
          sourceId: placed.bundle.sourceId,
          sourcePath: file.sourcePath,
          sha256: file.sha256,
        },
        executable: file.executable,
        bundle: placed.bundle.id,
        items: sortedSet(items),
        clis: sortedSet(clis),
      });

  // Launchers: one line naming the installed SKILL.md, in each fallback place.
  const kept = resolved.filter((entry) => !dropped.has(entry));
  for (const entry of kept) {
    if (entry.launchers === undefined || entry.unit.shape !== "folder") continue;
    for (const fallback of entry.launchers)
      writes.push({
        op: "write",
        root: scope,
        path: fill(fallback.path, entry.installName),
        executable: false,
        render: {
          name: "launcher",
          profile: entry.profile.id,
          version: entry.profile.version,
          installName: entry.installName,
          entry: fallback.id,
          target: `${entry.unit.path}/SKILL.md`,
        },
        scanned: false,
        item: entry.item.id,
        clis: [entry.profile.id],
      });
  }

  // The bundle-root rule, in each client's always-on rule place.
  const ruleUnavailable: Unavailable[] = [];
  const blocks = new Map<
    string,
    {
      bundles: Map<string, { bundle: string; root: string }>;
      items: Set<string>;
      clis: Set<string>;
    }
  >();
  for (const profile of profiles) {
    const map = roots.get(profile.id);
    if (map === undefined || map.size === 0) continue;
    const listed = [...map.values()]
      .map((placed) => ({ bundle: placed.bundle.id, root: placed.root }))
      .sort((left, right) => compareCodeUnits(left.bundle, right.bundle));
    const items = byCli.get(profile.id) ?? [];
    const target = profile.places.rule?.[scope]?.always;
    if (
      target === undefined ||
      (typeof target === "string" && profile.ruleScopes?.always === undefined)
    ) {
      ruleUnavailable.push({
        item: BUNDLE_ROOT_RULE,
        cli: profile.id,
        reason: "not-described",
        detail: `the client has no ${scope} always-on rule place to name the bundle root`,
      });
      continue;
    }
    if (typeof target === "string") {
      writes.push({
        op: "write",
        root: scope,
        path: fill(target, BUNDLE_ROOT_NAME),
        executable: false,
        render: {
          name: "bundle-root",
          profile: profile.id,
          version: profile.version,
          bundles: listed,
        },
        scanned: false,
        items,
        clis: [profile.id],
      });
      continue;
    }
    const block = blocks.get(target.file) ?? {
      bundles: new Map(),
      items: new Set(),
      clis: new Set(),
    };
    for (const entry of listed) block.bundles.set(`${entry.bundle}\0${entry.root}`, entry);
    for (const item of items) block.items.add(item);
    block.clis.add(profile.id);
    blocks.set(target.file, block);
  }
  const merges: MergeStep[] = [...blocks].map(([file, block]) => ({
    op: "merge",
    root: scope,
    file,
    format: "markdown",
    key: BUNDLE_ROOT_RULE,
    render: {
      name: "bundle-root",
      bundles: [...block.bundles.values()].sort(
        (left, right) =>
          compareCodeUnits(left.bundle, right.bundle) || compareCodeUnits(left.root, right.root),
      ),
    },
    scanned: false,
    items: sortedSet(block.items),
    clis: sortedSet(block.clis),
  }));
  return { kept, unavailable, ruleUnavailable, served, writes, merges, roots, byCli };
}

/**
 * References for each client an item is placed for: every source file the item names outside
 * its own files that is not one of its bundle's root files at that client's bundle root, and
 * every plugin-namespaced name it mentions. A plugin route places the whole plugin, so its
 * items are never checked.
 */
/**
 * Skill folders whose relative path references reach a file of another placed skill folder of
 * the same client, in the same relative position as upstream: per item, the clients for which
 * that holds. Both skills must then be copied in place for the path to resolve.
 */
function siblingReferences(placed: readonly Placed[]): Map<string, Set<string>> {
  const marks = new Map<string, Set<string>>();
  const mark = (item: string, cli: string) =>
    marks.set(item, new Set([...(marks.get(item) ?? []), cli]));
  const folders = placed.filter((entry) => entry.unit.shape === "folder");
  const installedAt = (entry: Placed, sourcePath: string) => {
    const unit = entry.unit as Extract<Unit, { shape: "folder" }>;
    const output = unit.outputs.find((candidate) => candidate.from?.sourcePath === sourcePath);
    return output === undefined ? undefined : `${unit.path.replace(/\/$/, "")}/${output.rel}`;
  };
  for (const entry of folders) {
    const cli = entry.profile.id;
    const edition = entry.item.editions?.[cli] !== undefined ? cli : undefined;
    for (const reference of entry.item.pathReferences ?? []) {
      if (reference.cli !== edition) continue;
      const from = installedAt(entry, reference.sourcePath);
      if (from === undefined) continue;
      for (const other of folders) {
        if (other.profile.id !== cli || other.item.id === entry.item.id) continue;
        const to = installedAt(other, reference.path);
        if (to === undefined) continue;
        const relative = relativePath(dirnameOf(reference.sourcePath), reference.path);
        if (joinPath(dirnameOf(from), relative) !== to) continue;
        mark(entry.item.id, cli);
        mark(other.item.id, cli);
      }
    }
  }
  return marks;
}

/** The relative path from folder `from` to `to` (both from one root, `""` is the root). */
function relativePath(from: string, to: string): string {
  const base = from === "" ? [] : from.split("/");
  const target = to.split("/");
  let common = 0;
  while (common < base.length && common < target.length - 1 && base[common] === target[common])
    common += 1;
  return [...base.slice(common).map(() => ".."), ...target.slice(common)].join("/");
}

/** `folder` joined with a relative path, `..` and `.` resolved; `""` when it climbs out. */
function joinPath(folder: string, path: string): string {
  const out = folder === "" ? [] : folder.split("/");
  for (const segment of path.split("/")) {
    if (segment === "..") {
      if (out.length === 0) return "";
      out.pop();
    } else if (segment !== "." && segment !== "") out.push(segment);
  }
  return out.join("/");
}

function referencesOf(
  chosen: readonly string[],
  byId: ReadonlyMap<string, { content: Content; item: Item }>,
  kept: readonly Placed[],
  bundles: BundlePlacement,
  links: readonly LinkStep[],
): Reference[] {
  const placedFor = new Map<string, Set<string>>();
  const add = (item: string, cli: string) =>
    placedFor.set(item, new Set([...(placedFor.get(item) ?? []), cli]));
  for (const entry of kept) add(entry.item.id, entry.profile.id);
  for (const { item, cli } of bundles.served) add(item, cli);
  // Where each client's placements put each source file, so a reference to another chosen
  // item's file counts as resolved when both land in the same relative position as upstream.
  const installed = new Map<string, Map<string, string[]>>();
  const at = (cli: string, sourceId: string, sourcePath: string, path: string) => {
    const files = installed.get(cli) ?? new Map<string, string[]>();
    installed.set(cli, files);
    const key = `${sourceId}\0${sourcePath}`;
    files.set(key, [...(files.get(key) ?? []), path]);
  };
  for (const entry of kept) {
    const unit = entry.unit;
    const outputs: [string, Output][] =
      unit.shape === "folder"
        ? unit.outputs.map((output) => [`${unit.path.replace(/\/$/, "")}/${output.rel}`, output])
        : unit.shape === "file"
          ? [[unit.path, unit.output]]
          : [];
    for (const [path, output] of outputs)
      if (output.from) at(entry.profile.id, output.from.sourceId, output.from.sourcePath, path);
  }
  // Only copies keep the upstream layout on disk: a folder that is a link into a shared
  // version folder resolves `..` inside the shared folder, never beside its siblings.
  const linked = (cli: string, path: string) =>
    links.some((link) => link.clis.includes(cli) && path.startsWith(`${link.path}/`));
  const resolvedInPlace = (
    item: Item,
    cli: string,
    edition: string | undefined,
    sourcePath: string,
    path: string,
  ) => {
    const own = edition === undefined ? item.files : (item.editions?.[edition]?.files ?? []);
    const file = own.find((candidate) => candidate.sourcePath === sourcePath);
    if (file === undefined || file.derivedFrom !== undefined) return false;
    const files = installed.get(cli);
    const sources = (files?.get(`${file.sourceId}\0${sourcePath}`) ?? []).filter(
      (source) => !linked(cli, source),
    );
    const targets = new Set(
      (files?.get(`${file.sourceId}\0${path}`) ?? []).filter((target) => !linked(cli, target)),
    );
    const relative = relativePath(dirnameOf(sourcePath), path);
    return sources.some((source) => targets.has(joinPath(dirnameOf(source), relative)));
  };
  const found = new Map<string, Reference>();
  const note = (key: string, reference: Reference, cli: string) => {
    const known = found.get(key) ?? reference;
    found.set(key, { ...known, clis: sortedSet([...known.clis, cli]) });
  };
  for (const id of chosen) {
    const { item, content } = byId.get(id) as { content: Content; item: Item };
    for (const cli of placedFor.get(id) ?? []) {
      const placed =
        item.bundle === undefined ? undefined : bundles.roots.get(cli)?.get(item.bundle);
      // A client that takes its edition places the edition's files, so only their mentions
      // count there; every other client places the item's own files.
      const edition = item.editions?.[cli] !== undefined ? cli : undefined;
      for (const reference of item.pathReferences ?? []) {
        if (reference.cli !== edition) continue;
        if (placed?.bundle.files.some((file) => file.sourcePath === reference.path)) continue;
        if (resolvedInPlace(item, cli, edition, reference.sourcePath, reference.path)) continue;
        const reported = {
          kind: "path" as const,
          item: id,
          file: reference.sourcePath,
          path: reference.path,
          clis: [],
        };
        note(`path\0${id}\0${reference.sourcePath}\0${reference.path}`, reported, cli);
      }
      for (const reference of item.references ?? []) {
        const bare = reference.name.slice(reference.name.indexOf(":") + 1);
        const candidates = chosen.filter((other) => {
          const entry = byId.get(other);
          return entry?.content === content && entry.item.name === bare;
        });
        const reported = {
          kind: "name" as const,
          item: id,
          file: reference.sourcePath,
          name: reference.name,
          ...(candidates.length === 1 ? { means: candidates[0] as string } : {}),
          clis: [],
        };
        note(`name\0${id}\0${reference.sourcePath}\0${reference.name}`, reported, cli);
      }
    }
  }
  const detail = (reference: Reference) =>
    reference.kind === "path" ? reference.path : reference.name;
  return [...found.values()].sort(
    (left, right) =>
      compareCodeUnits(left.item, right.item) ||
      compareCodeUnits(left.kind, right.kind) ||
      compareCodeUnits(left.file, right.file) ||
      compareCodeUnits(detail(left), detail(right)),
  );
}

/**
 * Which `provides` lists an install name of each kind can shadow: a skill shares the command
 * namespace. Kinds not listed are never checked against built-ins.
 */
const SHADOWS: Readonly<Partial<Record<Kind, readonly ProvidedKind[]>>> = {
  skill: ["skill", "command"],
  agent: ["agent"],
};

/** The name a client provides that an install name of this kind would shadow, if any. */
function providedName(profile: ToolProfile, kind: Kind, name: string): string | undefined {
  const provided = profile.provides ?? {};
  const names = (SHADOWS[kind] ?? []).flatMap((list) => provided[list] ?? []);
  const lower = name.toLowerCase();
  return names.find((entry) => entry.toLowerCase() === lower);
}

/**
 * Built-in names: a placed skill or agent whose install name matches what its client provides
 * is a `built-in` clash, unless a recipe override intends it. An override switches the built-in
 * off the way the client documents (a same-named item replaces it, or a keyed setting entry),
 * and otherwise warns that both will show or that switching it off is a manual step.
 */
function builtIns(
  resolved: readonly Placed[],
  scope: Scope,
  overrides: readonly Override[],
): { clashes: Clash[]; merges: MergeStep[]; warnings: Warning[] } {
  const intended = (entry: Placed, builtIn: string) =>
    overrides.some(
      (override) =>
        override.item === entry.item.id &&
        override.replaces.toLowerCase() === builtIn.toLowerCase(),
    );
  const clashes = new Map<string, { clash: Clash; items: Set<string>; clis: Set<string> }>();
  const placed = resolved.filter(
    (entry) => entry.unit.shape !== "merge" && SHADOWS[entry.item.kind] !== undefined,
  );
  for (const entry of placed) {
    const builtIn = providedName(entry.profile, entry.item.kind, entry.installName);
    if (builtIn === undefined || intended(entry, builtIn)) continue;
    const path = (entry.unit as { path: string }).path;
    const key = `${path}\0${builtIn}`;
    const known = clashes.get(key) ?? {
      clash: { root: scope, path, reason: "built-in" as const, builtIn, items: [], clis: [] },
      items: new Set<string>(),
      clis: new Set<string>(),
    };
    known.items.add(entry.item.id);
    known.clis.add(entry.profile.id);
    clashes.set(key, known);
  }
  const warnings = new Map<string, { code: string; cli: string; items: Set<string> }>();
  const warn = (code: string, cli: string, item: string) => {
    const known = warnings.get(`${code}\0${cli}`) ?? { code, cli, items: new Set<string>() };
    known.items.add(item);
    warnings.set(`${code}\0${cli}`, known);
  };
  const settings = new Map<string, { step: MergeStep; items: Set<string>; clis: Set<string> }>();
  for (const override of overrides)
    for (const entry of placed) {
      if (entry.item.id !== override.item) continue;
      const builtIn = providedName(entry.profile, entry.item.kind, override.replaces);
      if (builtIn === undefined) continue;
      const cli = entry.profile.id;
      const how = entry.profile.disableBuiltIn;
      if (how === undefined || how === "not-documented") {
        warn("built-in-both-show", cli, override.item);
        continue;
      }
      for (const code of how.warnings ?? []) warn(code, cli, override.item);
      if (entry.installName.toLowerCase() === builtIn.toLowerCase() && how.sameName === "replaces")
        continue;
      if (how.setting !== undefined && entry.item.kind === "skill") {
        const step: MergeStep = {
          op: "merge",
          root: how.setting.root,
          file: how.setting.file,
          format: how.setting.format,
          key: fill(how.setting.key, builtIn),
          entry: how.setting.entry,
          clis: [],
        };
        const key = `${step.root}\0${step.file}\0${step.key}`;
        const known = settings.get(key) ?? {
          step,
          items: new Set<string>(),
          clis: new Set<string>(),
        };
        known.items.add(override.item);
        known.clis.add(cli);
        settings.set(key, known);
      } else if (how.manual !== undefined) warn("built-in-disable-manual", cli, override.item);
      else warn("built-in-both-show", cli, override.item);
    }
  return {
    clashes: [...clashes.values()].map(({ clash, items, clis }) => ({
      ...clash,
      items: sortedSet(items),
      clis: sortedSet(clis),
    })),
    merges: [...settings.values()].map(({ step, items, clis }) => {
      const owners = sortedSet(items);
      return {
        ...step,
        ...(owners.length === 1 ? { item: owners[0] as string } : { items: owners }),
        clis: sortedSet(clis),
      };
    }),
    warnings: [...warnings.values()].map(({ code, cli, items }) => ({
      code,
      cli,
      items: sortedSet(items),
    })),
  };
}

/** Same install names across frameworks and same content under different ids, sorted. */
function duplicatesOf(
  planned: readonly { item: Item; framework: string; cli: string; name: string }[],
): Duplicate[] {
  const groups = new Map<
    string,
    {
      base: Omit<Duplicate, "items" | "frameworks" | "clis">;
      items: Set<string>;
      frameworks: Set<string>;
      clis: Set<string>;
    }
  >();
  const add = (
    key: string,
    base: Omit<Duplicate, "items" | "frameworks" | "clis">,
    entry: (typeof planned)[number],
  ) => {
    const group = groups.get(key) ?? {
      base,
      items: new Set(),
      frameworks: new Set(),
      clis: new Set(),
    };
    group.items.add(entry.item.id);
    group.frameworks.add(entry.framework);
    group.clis.add(entry.cli);
    groups.set(key, group);
  };
  for (const entry of planned) {
    add(
      `name\0${entry.item.kind}\0${entry.name}`,
      { by: "name", kind: entry.item.kind, name: entry.name },
      entry,
    );
    add(
      `content\0${entry.item.contentSha256}`,
      { by: "content", kind: entry.item.kind, contentSha256: entry.item.contentSha256 },
      entry,
    );
  }
  return [...groups.values()]
    .filter(({ base, items, frameworks }) =>
      base.by === "name" ? frameworks.size >= 2 : items.size >= 2,
    )
    .map(({ base, items, frameworks, clis }) => ({
      ...base,
      items: sortedSet(items),
      frameworks: sortedSet(frameworks),
      clis: sortedSet(clis),
    }))
    .sort(
      (left, right) =>
        compareCodeUnits(left.by, right.by) ||
        compareCodeUnits(left.kind, right.kind) ||
        compareCodeUnits(
          left.name ?? left.contentSha256 ?? "",
          right.name ?? right.contentSha256 ?? "",
        ),
    );
}

/** Problems of the supplied contents and profiles, shared by both planners. */
export function inputProblems(
  contents: readonly Content[],
  profiles: readonly ToolProfile[],
): Problem[] {
  const problems: Problem[] = [];
  if (!Array.isArray(contents)) problems.push({ path: "contents", message: "contents is a list" });
  else
    for (const [index, content] of contents.entries())
      for (const problem of contentProblems(content))
        problems.push({ path: `contents/${index}${problem.path}`, message: problem.message });
  if (!Array.isArray(profiles) || profiles.length === 0)
    problems.push({ path: "profiles", message: "plan for at least one profile" });
  else {
    for (const [index, profile] of profiles.entries())
      for (const problem of profileProblems(profile))
        problems.push({ path: `profiles/${index}${problem.path}`, message: problem.message });
    if (new Set(profiles.map((profile) => profile?.id)).size !== profiles.length)
      problems.push({ path: "profiles", message: "a profile is supplied twice" });
  }
  return problems;
}

/** True for `{ repository, commit }` with a non-empty repository and a 40-hex commit. */
export const isDataPin = (data: unknown): data is { repository: string; commit: string } =>
  isRecord(data) &&
  Object.keys(data).sort().join() === "commit,repository" &&
  typeof data.repository === "string" &&
  data.repository.length > 0 &&
  typeof data.commit === "string" &&
  /^[0-9a-f]{40}$/.test(data.commit);

/** Problems of the options both planners share: scope, copy and names. */
export function sharedOptionProblems(
  options: Record<string, unknown>,
  allowed: readonly string[],
  selected: (id: string) => boolean,
): Problem[] {
  const problems: Problem[] = [];
  for (const key of Object.keys(options))
    if (!allowed.includes(key))
      problems.push({ path: `options/${key}`, message: "unknown or not implemented option" });
  if (options.scope !== "project" && options.scope !== "user")
    problems.push({ path: "options/scope", message: "scope is project or user" });
  if (options.copy !== undefined && typeof options.copy !== "boolean")
    problems.push({ path: "options/copy", message: "copy is a boolean" });
  if (options.cell !== undefined && !(CELLS as readonly unknown[]).includes(options.cell))
    problems.push({ path: "options/cell", message: `cell is one of ${CELLS.join(", ")}` });
  if (options.qualifications !== undefined) {
    if (!Array.isArray(options.qualifications))
      problems.push({ path: "options/qualifications", message: "a list of qualification records" });
    else
      for (const [index, record] of options.qualifications.entries())
        for (const problem of qualificationProblems(record))
          problems.push({
            path: `options/qualifications/${index}${problem.path}`,
            message: problem.message,
          });
  }
  if (
    options.upstreamInstallers !== undefined &&
    !(
      Array.isArray(options.upstreamInstallers) &&
      options.upstreamInstallers.every((id) => typeof id === "string") &&
      new Set(options.upstreamInstallers).size === options.upstreamInstallers.length
    )
  )
    problems.push({
      path: "options/upstreamInstallers",
      message: "a list of distinct AI setup ids",
    });
  if (options.names !== undefined) {
    if (!isRecord(options.names))
      problems.push({ path: "options/names", message: "names maps item ids to install names" });
    else
      for (const [id, name] of Object.entries(options.names)) {
        if (!selected(id))
          problems.push({ path: `options/names/${id}`, message: "names an unselected item" });
        if (typeof name !== "string" || name.length > 64 || !INSTALL_NAME.test(name))
          problems.push({
            path: `options/names/${id}`,
            message: "an install name is at most 64 characters of a-z0-9-",
          });
      }
  }
  return problems;
}

function validate(
  selection: readonly string[],
  contents: readonly Content[],
  profiles: readonly ToolProfile[],
  options: PlanOptions,
): Problem[] {
  const problems: Problem[] = [];
  if (!Array.isArray(selection) || !selection.every((id) => typeof id === "string")) {
    problems.push({ path: "selection", message: "the selection is a list of item ids" });
  } else if (new Set(selection).size !== selection.length) {
    problems.push({ path: "selection", message: "an item is selected twice" });
  }
  problems.push(...inputProblems(contents, profiles));
  if (!isRecord(options)) {
    problems.push({ path: "options", message: "options is an object" });
    return problems;
  }
  problems.push(
    ...sharedOptionProblems(
      options as unknown as Record<string, unknown>,
      OPTION_KEYS,
      (id) => Array.isArray(selection) && selection.includes(id),
    ),
  );
  if (options.data !== null && !isDataPin(options.data))
    problems.push({
      path: "options/data",
      message: "data is null or { repository, commit } with an exact commit",
    });
  return problems;
}

export function planInstall(
  selection: readonly string[],
  contents: readonly Content[],
  profiles: readonly ToolProfile[],
  options: PlanOptions,
): PlanResult {
  const problems = validate(selection, contents, profiles, options);
  if (problems.length > 0) return { status: "invalid", problems };
  return planCore({
    selection,
    contents,
    profiles,
    scope: options.scope,
    data: options.data,
    ...(options.copy !== undefined ? { copy: options.copy } : {}),
    installName: (item) => options.names?.[item.id] ?? item.name,
    ...toolOptions(options),
  });
}

/**
 * Steps and reports lowered from recipe routes (plugins, local plugins, upstream setup), which
 * join the item placements' deduplication, clash checks and ordering.
 */
export interface Extras {
  readonly writes: readonly WriteStep[];
  readonly merges: readonly MergeStep[];
  readonly plugins: readonly PluginStep[];
  readonly setups: readonly SetupStep[];
  readonly warnings: readonly Warning[];
  readonly missing: readonly Missing[];
  /** Items a route places for a client outside the item placements (local-plugin contents). */
  readonly served: readonly { readonly item: string; readonly cli: string }[];
  /**
   * Items a plugin or upstream setup installs for a client: never placed as items, still
   * recorded for duplicate checks.
   */
  readonly routed?: readonly { readonly item: string; readonly cli: string }[];
}

export interface CoreInput extends ToolOptions {
  /** The chosen item ids; their dependencies are checked against this list. */
  readonly selection: readonly string[];
  readonly contents: readonly Content[];
  readonly profiles: readonly ToolProfile[];
  readonly scope: Scope;
  readonly data: { readonly repository: string; readonly commit: string } | null;
  readonly copy?: boolean;
  /** The install name of an item for a client, or undefined when the client does not take it. */
  readonly installName: (item: Item, profile: ToolProfile) => string | undefined;
  readonly extras?: Extras;
  /** A recipe's intended built-in replacements: `item` replaces the provided `replaces`. */
  readonly overrides?: readonly Override[];
  /** A recipe's changes to each AI setup's standalone setup. */
  readonly aiSetupChanges?: Readonly<Record<string, AiSetupChange>>;
  /** A combination recipe's id and its qualification's sha256 for the cell. */
  readonly combination?: { readonly recipe: string; readonly sha256?: string };
  /**
   * Pairs a recipe does not force: on clients the upstream does not install on,
   * items the recipe chose (not the user) that are unavailable are listed without blocking.
   */
  readonly notForced?: { readonly clis: readonly string[]; readonly items: readonly string[] };
}

export interface Override {
  readonly item: string;
  readonly replaces: string;
}

/** The planner shared by `planInstall` and `planRecipe`, over already-validated input. */
/**
 * Settings a client cannot carry, one warning per code and client: MCP tool lists it cannot
 * restrict, timeouts no profile maps, and agent tool lists its own agent file cannot hold.
 */
function settingWarnings(
  resolved: readonly Placed[],
  launches: ReadonlyMap<string, ToolLaunch>,
): Warning[] {
  const found = new Map<string, Warning>();
  const warnAbout = (code: string, cli: string, item: string) => {
    const known = found.get(`${code}\0${cli}`);
    found.set(`${code}\0${cli}`, {
      code,
      cli,
      items: union(known?.items ?? [], [item]),
    });
  };
  for (const entry of resolved) {
    if (entry.item.kind !== "mcp") continue;
    const settings = serverSettings(entry.item, launches.get(entry.item.id));
    const lists = settings.enabledTools !== undefined || settings.disabledTools !== undefined;
    if (lists && !restricts(settings, entry.profile.mcpFile))
      warnAbout("mcp-tools-unrestricted", entry.profile.id, entry.item.id);
    if (settings.startupSeconds !== undefined || settings.callSeconds !== undefined)
      warnAbout("mcp-timeouts-not-described", entry.profile.id, entry.item.id);
  }
  // An agent whose tool restriction this client's own agent file cannot carry is placed with
  // no tool list, never silently: a client reading another client's file keeps that file's.
  for (const entry of resolved)
    if (
      entry.item.kind === "agent" &&
      entry.unit.shape === "file" &&
      entry.unit.output.render?.name === "agent" &&
      (entry.representative ?? entry).profile.id === entry.profile.id &&
      agentTools(entry.item, entry.profile).unrestricted !== undefined
    )
      warnAbout("agent-tools-unrestricted", entry.profile.id, entry.item.id);
  return [...found.values()];
}

/** Entries grouped by key, in first-seen order. */
function group<T>(entries: readonly T[], keyOf: (entry: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const entry of entries)
    groups.set(keyOf(entry), [...(groups.get(keyOf(entry)) ?? []), entry]);
  return [...groups.values()];
}
/** A shared placement's bytes come from its first client; reused ones keep their source. */
const representative = (members: readonly Placed[]): Placed => {
  const first = members[0] as Placed;
  return first.representative ?? first;
};
const clisOf = (members: readonly Placed[]) => union(members.map((member) => member.profile.id));
const itemsOf = (members: readonly Placed[]) => union(members.map((member) => member.item.id));

/**
 * Folders and files, one placement per root and path: a user-only skill several clients share
 * takes one combined render, equal placements merge their clients, others clash, and at user
 * scope a linkable folder goes to its shared version folder and is linked.
 */
function placeFolders(
  resolved: readonly Placed[],
  scope: Scope,
  copy: boolean,
): {
  writes: WriteStep[];
  links: LinkStep[];
  clashes: Clash[];
  warnings: Warning[];
  served: { item: string; cli: string }[];
} {
  const writes: WriteStep[] = [];
  const links: LinkStep[] = [];
  const clashes: Clash[] = [];
  const warnings: Warning[] = [];
  const served: { item: string; cli: string }[] = [];
  // A user-only skill in a folder several clients share takes one combined render.
  const combinedAt = new Map<string, Unit>();
  for (const members of group(
    resolved.filter((entry) => entry.unit.shape === "folder"),
    (entry) => (entry.unit as { path: string }).path,
  )) {
    const unit = combined(members, scope);
    if (unit?.shape === "folder") combinedAt.set(unit.path, unit);
  }

  // Folders and files: one placement per root and path.
  const placementsAt = resolved
    .filter((entry) => entry.unit.shape !== "merge")
    .map((entry): Placed => {
      const unit = entry.unit.shape === "folder" ? combinedAt.get(entry.unit.path) : undefined;
      if (unit === undefined) return entry;
      const { representative: _representative, ...own } = entry;
      return { ...own, unit };
    });
  // At user scope a linked folder resolves `..` inside its shared version folder, never beside
  // its siblings, so skills whose relative paths reach another placed skill are copied in place.
  const inPlace = scope === "user" ? siblingReferences(placementsAt) : new Map();
  const copiedFor = new Map<string, Set<string>>();
  for (const members of group(placementsAt, (entry) => (entry.unit as { path: string }).path)) {
    const first = members[0] as Placed;
    const clis = clisOf(members);
    // A file only one client uses (`cli`, such as Codex's agents/openai.yaml) is that client's
    // own in a folder others share: the folder is compared without such files, and each is
    // written for the clients whose placement holds it.
    const split = members.map((member) => clientFiles(member));
    const unit = (split[0] as { common: Unit }).common as Exclude<Unit, { shape: "merge" }>;
    const own = new Map<string, { output: Output; placed: Placed; clis: string[] }>();
    for (const [index, member] of members.entries())
      for (const output of split[index]?.own ?? []) {
        const known = own.get(output.rel);
        if (known !== undefined && canonicalJson(known.output) === canonicalJson(output))
          known.clis.push(member.profile.id);
        else own.set(output.rel, { output, placed: member, clis: [member.profile.id] });
      }
    const ownDiffer = split.some((parts) =>
      parts.own.some(
        (output) => canonicalJson(own.get(output.rel)?.output) !== canonicalJson(output),
      ),
    );
    if (
      ownDiffer ||
      !members.every(
        (member, index) =>
          signature((split[index] as { common: Unit }).common) === signature(unit) &&
          member.item.id === first.item.id,
      )
    ) {
      clashes.push({
        root: scope,
        path: unit.path,
        reason: "different-content",
        items: itemsOf(members),
        clis,
      });
      continue;
    }
    const rep = representative(members);
    for (const member of members) served.push({ item: member.item.id, cli: member.profile.id });
    if (unit.shape === "file") {
      writes.push(writeOf(scope, unit.path, unit.output, rep, clis));
      continue;
    }
    const linkable =
      scope === "user" &&
      !copy &&
      unit.linkable &&
      members.every((member) => member.profile.links.skill === "documented");
    const keep = members.filter((member) => inPlace.get(member.item.id)?.has(member.profile.id));
    if (linkable)
      for (const member of keep)
        copiedFor.set(
          member.profile.id,
          new Set([...(copiedFor.get(member.profile.id) ?? []), member.item.id]),
        );
    const link = linkable && keep.length === 0;
    const owned = [...own.values()].sort((left, right) =>
      compareCodeUnits(left.output.rel, right.output.rel),
    );
    if (!link) {
      for (const entry of unit.outputs)
        writes.push(writeOf(scope, `${unit.path}/${entry.rel}`, entry, rep, clis));
      for (const entry of owned)
        writes.push(
          writeOf(
            scope,
            `${unit.path}/${entry.output.rel}`,
            entry.output,
            entry.placed,
            entry.clis,
          ),
        );
      continue;
    }
    const all = [...unit.outputs, ...owned.map((entry) => entry.output)];
    const shared = `.aihq/shared/${rep.framework}/${rep.item.kind}/${rep.item.name}/${versionOf(rep, all)}`;
    for (const entry of unit.outputs)
      writes.push(writeOf("user", `${shared}/${entry.rel}`, entry, rep, clis));
    for (const entry of owned)
      writes.push(
        writeOf("user", `${shared}/${entry.output.rel}`, entry.output, entry.placed, entry.clis),
      );
    links.push({ op: "link", root: "user", path: unit.path, to: shared, item: rep.item.id, clis });
  }

  for (const [cli, items] of copiedFor)
    warnings.push({ code: "copied-for-references", cli, items: sortedSet(items) });
  return { writes, links, clashes, warnings, served };
}

/** The notices covering each placed item, one write per notice, owned by the items it covers. */
function noticeWrites(
  contents: readonly Content[],
  chosen: readonly string[],
  byId: ReadonlyMap<string, { content: Content; item: Item }>,
  servedBy: ReadonlyMap<string, string[]>,
  scope: Scope,
): WriteStep[] {
  const notices: WriteStep[] = [];
  for (const content of contents)
    for (const source of content.sources)
      for (const notice of source.notices) {
        const covered = chosen.filter((id) => {
          if (!servedBy.has(id)) return false;
          const { item, content: owner } = byId.get(id) as { item: Item; content: Content };
          if (owner !== content) return false;
          if (source.noticesFor?.includes(id)) return true;
          // A file cut out of a shared upstream file carries that file's notices: cut-outs
          // come only from the content's first source.
          return item.files.some(
            (file) =>
              (file.sourceId === source.id && isUnder(file.sourcePath, notice.covers)) ||
              (file.derivedFrom !== undefined &&
                source.id === content.sources[0]?.id &&
                isUnder(file.derivedFrom.sourcePath, notice.covers)),
          );
        });
        if (covered.length === 0) continue;
        notices.push({
          op: "write",
          root: scope,
          // A further source's notices sit in a folder of its own, so two sources' LICENSE
          // files never share one path.
          path:
            source.id === content.framework.id
              ? `.aihq/notices/${content.framework.id}/${notice.sourcePath}`
              : `.aihq/notices/${content.framework.id}/${source.id}/${notice.sourcePath}`,
          from: { sourceId: source.id, sourcePath: notice.sourcePath, sha256: notice.sha256 },
          executable: false,
          items: covered,
          clis: union(...covered.map((id) => servedBy.get(id) ?? [])),
        });
      }
  return notices;
}

/**
 * A client that reads only part of a shared file (Codex: 32 KiB of AGENTS.md) clashes when the
 * blocks its plan merges there pass that: its rule blocks and the bundle-root block.
 */
function limitClashes(
  profiles: readonly ToolProfile[],
  mergeUnits: readonly Placed[],
  bundleMerges: readonly MergeStep[],
  contents: readonly Content[],
  scope: Scope,
): Clash[] {
  const found: Clash[] = [];
  for (const profile of profiles) {
    const target = profile.places.rule?.[scope]?.always;
    if (typeof target !== "object" || target.limitBytes === undefined) continue;
    const blocks = mergeUnits.filter(
      (entry) =>
        entry.profile.id === profile.id && (entry.unit as { file: string }).file === target.file,
    );
    const bundleRoot = bundleMerges.find(
      (step) => step.file === target.file && step.clis.includes(profile.id),
    );
    let total = blocks.reduce(
      (sum, entry) =>
        sum + ((entry.unit as { bytes?: number }).bytes ?? 0) + MARKDOWN_OVERHEAD(entry.item.id),
      0,
    );
    if (bundleRoot?.render?.name === "bundle-root") {
      const named = namedBundles((bundleRoot.render as BundleRootRender).bundles, contents);
      if (Array.isArray(named))
        total += bundleRootBytes(named, scope).byteLength + MARKDOWN_OVERHEAD(BUNDLE_ROOT_RULE);
    }
    if (total > target.limitBytes)
      found.push({
        root: scope,
        path: target.file,
        reason: "limit",
        items: union(
          union(blocks.map((entry) => entry.item.id)),
          bundleRoot ? [BUNDLE_ROOT_RULE] : [],
        ),
        clis: [profile.id],
      });
  }
  return found;
}

export function planCore(input: CoreInput): PlanResult {
  const { contents, profiles, scope, extras } = input;
  const options = { copy: input.copy, data: input.data };

  const byId = new Map<string, { content: Content; item: Item }>();
  for (const content of contents)
    for (const item of content.items) {
      if (byId.has(item.id))
        return {
          status: "invalid",
          problems: [{ path: item.id, message: "the item id appears in two contents" }],
        };
      byId.set(item.id, { content, item });
    }
  for (const id of input.selection)
    if (!byId.has(id))
      return refused(
        "unknown-item",
        `the selected item ${quote(id)} is not in the supplied content`,
      );

  // AI setups: their qualification on the cell, acquisition, settings and implied MCP items.
  const toolInput = {
    selection: input.selection,
    byId,
    ...toolOptions(input),
    ...(input.aiSetupChanges !== undefined ? { changes: input.aiSetupChanges } : {}),
    ...(input.combination !== undefined ? { combination: input.combination } : {}),
    clis: union(profiles.map((profile) => profile.id)),
  };
  const toolIssues = toolProblems(toolInput);
  if (toolIssues.length > 0) return { status: "invalid", problems: toolIssues };
  const tools = planTools(toolInput);
  const selection = union(input.selection, tools.implied);
  for (const id of selection)
    if (!byId.has(id))
      return refused(
        "unknown-item",
        `the AI setup's MCP item ${quote(id)} is not in the supplied content`,
      );

  const chosen = [...selection].sort(compareCodeUnits);
  const missing: Missing[] = [...(extras?.missing ?? [])];
  for (const id of chosen)
    for (const dependency of byId.get(id)?.item.dependencies ?? [])
      if (!selection.includes(dependency))
        missing.push({ item: id, reason: "dependency-not-selected", dependency });

  const sortedProfiles = [...profiles].sort((left, right) => compareCodeUnits(left.id, right.id));
  const unavailable: Unavailable[] = [];
  const placements: Placed[] = [];
  for (const profile of sortedProfiles)
    for (const id of chosen) {
      const { item, content } = byId.get(id) as { item: Item; content: Content };
      // An AI setup is planned once per cell (acquire), never placed per client.
      if (item.kind === "ai-setup") continue;
      const installName = input.installName(item, profile);
      if (installName === undefined) continue;
      const result = place(item, content, profile, scope, installName, tools.launches.get(id));
      if (isFailure(result)) unavailable.push({ item: id, cli: profile.id, ...result });
      else placements.push(...result);
    }
  unavailable.push(...tools.unavailable);

  // A plan that mixes frameworks adds Catalog's duplicate resolver on every client that can
  // take an agent; where it cannot be placed the plan only warns.
  const frameworkOf = (id: string) => byId.get(id)?.content.framework.id;
  const mixedFrameworks = new Set(
    [...selection, ...(extras?.routed ?? []).map((entry) => entry.item)]
      .filter((id) => !tools.exempt.has(id))
      .map(frameworkOf)
      .filter((id): id is string => id !== undefined && id !== AUTHORED_FRAMEWORK),
  );
  const mixes = mixedFrameworks.size >= 2;
  const helperWarnings: Warning[] = [];
  if (mixes) {
    const authored = aihContent.content;
    const resolver = authored.items[0] as Item;
    if (!byId.has(resolver.id)) byId.set(resolver.id, { content: authored, item: resolver });
    const { item, content } = byId.get(DUPLICATE_RESOLVER) as { item: Item; content: Content };
    if (!selection.includes(DUPLICATE_RESOLVER))
      for (const profile of sortedProfiles) {
        const result = place(item, content, profile, scope, item.name);
        if (isFailure(result))
          helperWarnings.push({
            code: "duplicate-resolver-unavailable",
            cli: profile.id,
            items: [DUPLICATE_RESOLVER],
          });
        else placements.push(...result);
      }
  }

  // A client that shares another client's place takes it when that place is planned for
  // the same item, as a copy of that placement; otherwise its own place.
  let resolved: Placed[] = [];
  const fixed = placements.filter((entry) => entry.reuse === undefined);
  for (const entry of placements) {
    if (entry.reuse === undefined) {
      resolved.push(entry);
      continue;
    }
    const pathOf = (unit: Unit) => (unit.shape === "merge" ? unit.file : unit.path);
    const shared = entry.reuse
      .map((path) =>
        fixed.find(
          (other) =>
            other.item.id === entry.item.id &&
            other.unit.shape === entry.unit.shape &&
            pathOf(other.unit) === path,
        ),
      )
      .find((other) => other !== undefined);
    // A skill folder is read as it is: when this client's own render of it would differ (it
    // rewords `$ARGUMENTS` where the other keeps it), it keeps its own bytes at the shared path,
    // so the folder is a combined render or a clash, never the other client's bytes taken
    // silently.
    if (
      shared &&
      entry.item.kind === "skill" &&
      entry.unit.shape === "folder" &&
      shared.unit.shape === "folder" &&
      canonicalJson(entry.unit.outputs) !== canonicalJson(shared.unit.outputs)
    ) {
      const { reuse: _reuse, failure: _failure, ...own } = entry;
      resolved.push({ ...own, unit: { ...entry.unit, path: shared.unit.path } });
      continue;
    }
    if (shared) {
      const { launchers: _launchers, ...base } = shared;
      resolved.push({
        ...base,
        profile: entry.profile,
        representative: shared,
        ...(entry.launchers ? { launchers: entry.launchers } : {}),
      });
      continue;
    }
    if (entry.failure) {
      if (entry.item.id === DUPLICATE_RESOLVER)
        helperWarnings.push({
          code: "duplicate-resolver-unavailable",
          cli: entry.profile.id,
          items: [DUPLICATE_RESOLVER],
        });
      else unavailable.push({ item: entry.item.id, cli: entry.profile.id, ...entry.failure });
      continue;
    }
    const { reuse: _reuse, ...own } = entry;
    resolved.push(own);
  }

  // A client with no user-only flag cannot share a user-only skill's folder with clients that
  // flag it: the folder would need the flags for them and none for it. It is unavailable there
  // (with its launchers), and the flagging clients keep their combined render.
  resolved = withoutUnflaggedSharers(resolved, unavailable);

  // Runtime bundles: each client's bundle root is the parent of its bundle skill folders (or the
  // profile's own bundle root); agents whose folder is the bundle's are read from the bundle.
  const bundles = placeBundles(resolved, profiles, scope);
  for (const failure of bundles.unavailable) unavailable.push(failure);
  resolved = bundles.kept;

  const clashes: Clash[] = [];
  const warnings: Warning[] = [...(extras?.warnings ?? []), ...tools.warnings];
  const writes: WriteStep[] = [...(extras?.writes ?? []), ...tools.writes];
  const links: LinkStep[] = [];
  const merges: MergeStep[] = [];
  const servedBy = new Map<string, string[]>();
  const serve = (id: string, clis: readonly string[]) =>
    servedBy.set(id, union(servedBy.get(id) ?? [], clis));
  for (const { item, cli } of extras?.served ?? []) serve(item, [cli]);
  for (const { item, cli } of bundles.served) serve(item, [cli]);
  writes.push(...bundles.writes);
  merges.push(...bundles.merges);
  for (const failure of bundles.ruleUnavailable) unavailable.push(failure);
  for (const [cli, items] of bundles.byCli) {
    const profile = sortedProfiles.find((candidate) => candidate.id === cli) as ToolProfile;
    for (const code of profile.bundleWarnings ?? []) warnings.push({ code, cli, items });
  }

  const folders = placeFolders(resolved, scope, options.copy === true);
  writes.push(...folders.writes);
  links.push(...folders.links);
  clashes.push(...folders.clashes);
  warnings.push(...folders.warnings);
  for (const { item, cli } of folders.served) serve(item, [cli]);

  // Merge entries: one per file and key.
  const mergeUnits = resolved.filter((entry) => entry.unit.shape === "merge");
  for (const members of group(mergeUnits, (entry) => {
    const unit = entry.unit as Extract<Unit, { shape: "merge" }>;
    return `${unit.file}\0${unit.key}`;
  })) {
    const first = members[0] as Placed;
    const unit = first.unit as Extract<Unit, { shape: "merge" }>;
    const clis = clisOf(members);
    const content = (candidate: Unit) => {
      const { limitBytes: _limit, ...rest } = candidate as Extract<Unit, { shape: "merge" }>;
      return canonicalJson(rest);
    };
    if (
      !members.every(
        (member) => content(member.unit) === content(unit) && member.item.id === first.item.id,
      )
    ) {
      clashes.push({
        root: scope,
        path: unit.file,
        key: unit.key,
        reason: "different-content",
        items: itemsOf(members),
        clis,
      });
      continue;
    }
    for (const member of members) serve(member.item.id, [member.profile.id]);
    const entry = unit.output;
    merges.push({
      op: "merge",
      root: scope,
      file: unit.file,
      format: unit.format,
      key: unit.key,
      ...(unit.entry !== undefined ? { entry: unit.entry } : {}),
      ...(entry?.from ? { from: entry.from } : {}),
      ...(entry?.render
        ? { render: renderRecord(entry.render, first), scanned: false as const }
        : {}),
      item: first.item.id,
      clis,
      // A structured entry's bindings are the unit's; a Markdown block's are its output's.
      ...((unit.inputs ?? entry?.inputs) ? { inputs: unit.inputs ?? entry?.inputs } : {}),
      ...(unit.rootPaths ? { rootPaths: unit.rootPaths } : {}),
    });
  }

  // Route merges (local-plugin registration): identical entries merge, different ones clash.
  const ownersOf = (step: WriteStep | MergeStep) =>
    step.item ? [step.item] : [...(step.items ?? []), ...(step.contains ?? [])];
  for (const members of group(
    extras?.merges ?? [],
    (step) => `${step.root}\0${step.file}\0${step.key}`,
  )) {
    const first = members[0] as MergeStep;
    const identity = (step: MergeStep) => canonicalJson({ ...step, clis: [], contains: [] });
    const taken = merges.filter(
      (step) => step.root === first.root && step.file === first.file && step.key === first.key,
    );
    const clis = union(...members.map((step) => step.clis));
    if (taken.length === 0 && members.every((step) => identity(step) === identity(first))) {
      merges.push({ ...first, clis });
      continue;
    }
    clashes.push({
      root: first.root,
      path: first.file,
      key: first.key,
      reason: "different-content",
      items: union(...[...members, ...taken].map(ownersOf)),
      clis: union(clis, ...taken.map((step) => step.clis)),
    });
  }

  // Copilot reads both shared skill folders in VS Code; when both are planned it is told to
  // read one.
  if (scope === "project")
    for (const profile of sortedProfiles) {
      const overlap = profile.skillFolderOverlap;
      if (overlap === undefined) continue;
      const own = resolved.filter(
        (entry) =>
          entry.profile.id === profile.id &&
          entry.item.kind === "skill" &&
          entry.unit.shape === "folder",
      );
      const folders = resolved
        .filter((entry) => entry.unit.shape === "folder")
        .map((entry) => `${(entry.unit as { path: string }).path}/`);
      if (
        own.length === 0 ||
        !overlap.folders.every((folder) => folders.some((path) => path.startsWith(folder)))
      )
        continue;
      const items = union(own.map((entry) => entry.item.id));
      merges.push({
        op: "merge",
        root: "project",
        file: overlap.merge.file,
        format: overlap.merge.format,
        key: overlap.merge.key,
        entry: overlap.merge.entry,
        items,
        clis: [profile.id],
      });
      for (const code of overlap.warnings) warnings.push({ code, cli: profile.id, items });
    }

  warnings.push(...settingWarnings(resolved, tools.launches));

  // Names the clients already provide: clashes, or an override's switch-off and warnings.
  const shadowing = builtIns(resolved, scope, input.overrides ?? []);
  clashes.push(...shadowing.clashes);
  merges.push(...shadowing.merges);
  warnings.push(...shadowing.warnings);

  // Duplicates across frameworks: facts for the user and the resolver, never a winner.
  const duplicates: Duplicate[] = [];
  if (mixes) {
    const planned: { item: Item; framework: string; cli: string; name: string }[] = [];
    const record = (id: string, cli: string, name?: string) => {
      const found = byId.get(id);
      if (found === undefined || found.content.framework.id === AUTHORED_FRAMEWORK) return;
      planned.push({
        item: found.item,
        framework: found.content.framework.id,
        cli,
        name: name ?? found.item.name,
      });
    };
    for (const entry of resolved) record(entry.item.id, entry.profile.id, entry.installName);
    for (const { item, cli } of [
      ...bundles.served,
      ...(extras?.served ?? []),
      ...(extras?.routed ?? []),
    ]) {
      const profile = sortedProfiles.find((candidate) => candidate.id === cli) as ToolProfile;
      const found = byId.get(item);
      record(item, cli, found ? input.installName(found.item, profile) : undefined);
    }
    duplicates.push(...duplicatesOf(planned));
    writes.push({
      op: "write",
      root: scope,
      path: DUPLICATES_REPORT,
      executable: false,
      render: { name: "duplicates-report", duplicates },
      scanned: false,
      item: DUPLICATE_RESOLVER,
      clis: sortedProfiles.map((profile) => profile.id),
    });
  }
  warnings.push(...helperWarnings);

  // Notices covering a placed item, once each.
  writes.push(...noticeWrites(contents, chosen, byId, servedBy, scope));

  // Identical writes (a shared version used by several folders) merge; others clash.
  const finalWrites: WriteStep[] = [];
  for (const members of group(writes, (step) => `${step.root}\0${step.path}`)) {
    const first = members[0] as WriteStep;
    const identity = (step: WriteStep) => canonicalJson({ ...step, clis: [] });
    if (members.every((step) => identity(step) === identity(first)))
      finalWrites.push({ ...first, clis: union(...members.map((step) => step.clis)) });
    else
      clashes.push({
        root: first.root,
        path: first.path,
        reason: "different-content",
        items: union(...members.map((step) => (step.item ? [step.item] : (step.items ?? [])))),
        clis: union(...members.map((step) => step.clis)),
      });
  }

  // Per-file merge checks: nested keys, a write on the same file, and size limits.
  for (const members of group(merges, (step) => `${step.root}\0${step.file}`)) {
    const first = members[0] as MergeStep;
    const nested = (outer: string, inner: string) =>
      first.format === "json"
        ? inner.startsWith(`${outer}/`)
        : first.format === "toml" && inner.startsWith(`${outer}.`);
    for (const outer of members)
      for (const inner of members)
        if (outer !== inner && nested(outer.key, inner.key))
          clashes.push({
            root: first.root,
            path: first.file,
            key: inner.key,
            reason: "nested-key",
            items: union(
              ...[outer, inner].map((step) => (step.item ? [step.item] : (step.items ?? []))),
            ),
            clis: union(outer.clis, inner.clis),
          });
    if (finalWrites.some((step) => step.root === first.root && step.path === first.file))
      clashes.push({
        root: first.root,
        path: first.file,
        reason: "write-and-merge",
        items: union(...members.map((step) => (step.item ? [step.item] : (step.items ?? [])))),
        clis: union(...members.map((step) => step.clis)),
      });
  }
  clashes.push(...limitClashes(sortedProfiles, mergeUnits, bundles.merges, input.contents, scope));
  // Two spellings of one path (case or Unicode form) name one file on a case-insensitive or
  // normalising file system: they clash.
  const spelled = [
    ...finalWrites.map((step) => ({ root: step.root, path: step.path, step })),
    ...links.map((step) => ({ root: step.root, path: step.path, step })),
    ...merges.map((step) => ({ root: step.root, path: step.file, step })),
  ];
  for (const members of group(spelled, (entry) => `${entry.root} ${clashKey(entry.path)}`)) {
    const first = members[0] as (typeof spelled)[number];
    if (members.every((entry) => entry.path === first.path)) continue;
    clashes.push({
      root: first.root,
      path: first.path,
      reason: "different-content",
      items: union(
        ...members.map(({ step }) =>
          step.item ? [step.item] : "items" in step ? (step.items ?? []) : [],
        ),
      ),
      clis: union(...members.map(({ step }) => step.clis)),
    });
  }
  // Never write through a planned link.
  for (const link of links)
    for (const step of finalWrites)
      if (step.root === link.root && clashKey(step.path).startsWith(`${clashKey(link.path)}/`))
        clashes.push({
          root: link.root,
          path: step.path,
          reason: "under-link",
          items: union([link.item], step.item ? [step.item] : (step.items ?? [])),
          clis: union(link.clis, step.clis),
        });

  for (const step of [...finalWrites, ...links])
    if (!isSafeRelativePath(step.path))
      return refused("path-escape", `a planned path ${quote(step.path)} is unsafe`);
  for (const step of merges)
    if (!isSafeRelativePath(step.file))
      return refused("path-escape", `a planned file ${quote(step.file)} is unsafe`);

  const byPlace =
    <T extends { root: string }>(
      pathOf: (step: T) => string,
      keyOf: (step: T) => string = () => "",
    ) =>
    (left: T, right: T) =>
      compareCodeUnits(left.root, right.root) ||
      compareCodeUnits(pathOf(left), pathOf(right)) ||
      compareCodeUnits(keyOf(left), keyOf(right));
  finalWrites.sort(byPlace((step) => step.path));
  links.sort(byPlace((step) => step.path));
  merges.sort(
    byPlace(
      (step) => step.file,
      (step) => step.key,
    ),
  );
  clashes.sort(
    byPlace(
      (clash) => clash.path,
      (clash) => `${clash.key ?? ""}\0${clash.reason ?? ""}`,
    ),
  );
  missing.sort(
    (left, right) =>
      compareCodeUnits(left.item ?? "", right.item ?? "") ||
      compareCodeUnits(left.framework ?? "", right.framework ?? "") ||
      compareCodeUnits(left.cli ?? "", right.cli ?? "") ||
      compareCodeUnits(left.reason, right.reason) ||
      compareCodeUnits(left.dependency ?? "", right.dependency ?? ""),
  );
  unavailable.sort(
    (left, right) =>
      compareCodeUnits(left.item ?? left.recipe ?? "", right.item ?? right.recipe ?? "") ||
      compareCodeUnits(left.cli ?? "", right.cli ?? "") ||
      compareCodeUnits(left.cell ?? "", right.cell ?? ""),
  );
  warnings.sort(
    (left, right) =>
      compareCodeUnits(left.code, right.code) ||
      compareCodeUnits(left.cli ?? "", right.cli ?? "") ||
      compareCodeUnits(left.aiSetup ?? "", right.aiSetup ?? ""),
  );

  const plugins = [...(extras?.plugins ?? [])].sort(
    (left, right) =>
      compareCodeUnits(left.cli, right.cli) || compareCodeUnits(left.framework, right.framework),
  );
  const setups = [...(extras?.setups ?? [])].sort(
    (left, right) =>
      compareCodeUnits(left.cli, right.cli) || compareCodeUnits(left.framework, right.framework),
  );
  // An upstream-only item's copied files (and notices that cover only such items) are fetched
  // from the pinned source instead of written; a rendered file stays a write of the fetched bytes.
  const upstreamOnly = (id: string) => byId.get(id)?.item.fetch === "upstream";
  const fetches: FetchStep[] = [];
  const shippedWrites = finalWrites.filter((step) => {
    const owners = step.item ? [step.item] : (step.items ?? []);
    if (
      step.from === undefined ||
      step.render !== undefined ||
      step.bundle !== undefined ||
      step.framework !== undefined ||
      owners.length === 0 ||
      !owners.every(upstreamOnly)
    )
      return true;
    fetches.push({
      op: "fetch",
      root: step.root,
      path: step.path,
      source: step.from.sourceId,
      sourcePath: step.from.sourcePath,
      sha256: step.from.sha256,
      executable: step.executable,
      ...(step.item ? { item: step.item } : { items: owners }),
      clis: step.clis,
      scanned: false,
    });
    return false;
  });
  // Phase 1 holds fetches and acquisitions, by root then path.
  const firstPhase: (FetchStep | AcquireStep)[] = [...fetches, ...tools.acquires].sort(
    (left, right) =>
      compareCodeUnits(left.root, right.root) ||
      compareCodeUnits(
        left.op === "fetch" ? left.path : left.into,
        right.op === "fetch" ? right.path : right.into,
      ),
  );
  // The first step of each local-plugin route group, in final order, lists what it contains.
  const placementSteps: (FetchStep | AcquireStep | WriteStep | LinkStep | MergeStep)[] = [
    ...firstPhase,
    ...shippedWrites,
    ...links,
    ...merges,
  ];
  const contained = new Map<string, Set<string>>();
  for (const step of [...(extras?.writes ?? []), ...(extras?.merges ?? [])])
    if (step.route === "local-plugin" && step.framework !== undefined)
      contained.set(
        step.framework,
        new Set([...(contained.get(step.framework) ?? []), ...(step.contains ?? [])]),
      );
  const marked = new Set<string>();
  const ordered = placementSteps.map((step) => {
    if (
      step.op === "link" ||
      step.op === "fetch" ||
      step.op === "acquire" ||
      step.route !== "local-plugin" ||
      step.framework === undefined
    )
      return step;
    const { contains: _contains, ...rest } = step;
    if (marked.has(step.framework)) return rest;
    marked.add(step.framework);
    return { ...rest, contains: [...(contained.get(step.framework) ?? [])].sort(compareCodeUnits) };
  });

  const references = referencesOf(chosen, byId, resolved, bundles, links);
  const notForced = input.notForced;
  const forced = unavailable.filter(
    (entry) =>
      notForced === undefined ||
      entry.cli === undefined ||
      entry.item === undefined ||
      !notForced.clis.includes(entry.cli) ||
      !notForced.items.includes(entry.item),
  );
  const blocked =
    missing.length > 0 ||
    forced.length > 0 ||
    clashes.length > 0 ||
    references.some((reference) => reference.kind === "path");
  return {
    status: blocked ? "incomplete" : "ok",
    data:
      options.data === null
        ? null
        : { repository: options.data.repository, commit: options.data.commit },
    profiles: sortedProfiles.map((profile) => ({ id: profile.id, version: profile.version })),
    plan: [
      ...ordered,
      ...plugins,
      ...setups,
      ...[...tools.installers].sort((left, right) => compareCodeUnits(left.aiSetup, right.aiSetup)),
      // Settings commands keep their declared order within each AI setup.
      ...tools.commands
        .map((step, index) => ({ step, index }))
        .sort(
          (left, right) =>
            compareCodeUnits(left.step.aiSetup, right.step.aiSetup) || left.index - right.index,
        )
        .map(({ step }) => step),
    ],
    missing,
    unavailable,
    clashes,
    duplicates,
    references,
    warnings,
  };
}
