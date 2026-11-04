/**
 * `planInstall`: hand-selected items placed by tool profiles at project or user scope.
 * Each item and client first gives placements (a folder, a file or a merge entry); equal
 * placements then share one step with the union of their clients, different ones clash,
 * and user-scope folders become shared versions linked where the client documents links.
 * Nothing is claimed that a profile does not describe. Identical inputs give byte-identical
 * plans.
 */
import type { Invalid, Problem, Refused } from "../contracts.js";
import { implementedKinds } from "../contracts.js";
import { installRelative } from "./identity.js";
import { canonicalJson } from "./json.js";
import { lowerServer } from "./mcp.js";
import { type Content, INSTALL_NAME, type Item, type ItemFile } from "./model.js";
import {
  basenameOf,
  compareCodeUnits,
  dirnameOf,
  isSafeRelativePath,
  isUnder,
  quote,
  refused,
} from "./paths.js";
import { type Place, profileProblems, type Scope, type ToolProfile } from "./profile.js";
import {
  agentTools,
  changesBytes,
  editFor,
  editKey,
  type RenderName,
  scopeKeyOf,
} from "./render.js";
import { sha256Hex } from "./sha256.js";
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

export interface WriteStep {
  readonly op: "write";
  readonly root: Scope;
  readonly path: string;
  readonly from?: SourceRef;
  readonly executable: boolean;
  readonly render?: PlanRender;
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

export interface MergeStep {
  readonly op: "merge";
  readonly root: Scope;
  readonly file: string;
  readonly format: "json" | "toml" | "markdown";
  /** A JSON Pointer, a TOML table, or the item id that names a Markdown block. */
  readonly key: string;
  /** The structured entry (json, toml); a Markdown block takes its text from `from`. */
  readonly entry?: unknown;
  readonly from?: SourceRef;
  readonly render?: PlanRender;
  readonly scanned?: false;
  readonly item?: string;
  readonly items?: readonly string[];
  readonly clis: readonly string[];
  readonly inputs?: readonly Binding[];
}

export type PlanStep = WriteStep | LinkStep | MergeStep;

export type UnavailableReason =
  | "not-implemented"
  | "not-described"
  | "unsupported-kind"
  | "no-user-only"
  | "no-edition"
  | "no-edition-place"
  | "no-hook-event"
  | "no-path-scope"
  | "no-rule-scope"
  | "no-tool-names"
  | "no-tool-restriction"
  | "unsupported-server";

export interface Unavailable {
  readonly item: string;
  readonly cli: string;
  readonly reason: UnavailableReason;
  readonly detail: string;
}

export interface Clash {
  readonly root: string;
  readonly path: string;
  readonly key?: string;
  readonly reason?: "different-content" | "nested-key" | "write-and-merge" | "under-link" | "limit";
  readonly items: readonly string[];
  readonly clis: readonly string[];
}

export interface Warning {
  readonly code: string;
  readonly cli: string;
  readonly items: readonly string[];
}

export interface Plan {
  readonly status: "ok" | "incomplete";
  readonly data: { readonly repository: string; readonly commit: string } | null;
  readonly profiles: readonly { readonly id: string; readonly version: number }[];
  readonly plan: readonly PlanStep[];
  readonly missing: readonly {
    readonly item: string;
    readonly reason: string;
    readonly dependency?: string;
  }[];
  readonly unavailable: readonly Unavailable[];
  readonly clashes: readonly Clash[];
  readonly duplicates: readonly never[];
  readonly references: readonly never[];
  readonly warnings: readonly Warning[];
}

export type PlanResult = Plan | Invalid | Refused;

export interface PlanOptions {
  readonly scope: Scope;
  readonly data: { readonly repository: string; readonly commit: string } | null;
  readonly copy?: boolean;
  readonly names?: Readonly<Record<string, string>>;
}

const OPTION_KEYS = ["scope", "data", "copy", "names"];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
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
  framework: string,
  profile: ToolProfile,
  scope: Scope,
  installName: string,
): Placed[] | Failure {
  const placed = (unit: Unit, reuse?: readonly string[]): Placed => ({
    unit,
    item,
    framework,
    installName,
    profile,
    ...(reuse ? { reuse } : {}),
  });
  if (!(implementedKinds as readonly string[]).includes(item.kind))
    return {
      reason: "not-implemented",
      detail: `planning ${item.kind} items is not implemented yet`,
    };
  const unsupported = profile.unsupported?.[item.kind];
  if (unsupported !== undefined) return { reason: "unsupported-kind", detail: unsupported };
  if (item.fetch === "upstream" || item.bundle !== undefined)
    return {
      reason: "not-implemented",
      detail: "upstream fetching and bundles are not implemented yet",
    };
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
      const tools = agentTools(item, profile);
      const made: Unit | Failure = (() => {
        if ("reason" in tools) return tools;
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
      const lowered = lowerServer(item, profile.mcpFile);
      if ("reason" in lowered) return { reason: "unsupported-server", detail: lowered.reason };
      return [
        placed({
          shape: "merge",
          file: target.file,
          format: target.format,
          key: fill(target.key, installName),
          entry: lowered.entry,
          ...(lowered.inputs.length > 0 ? { inputs: lowered.inputs } : {}),
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
  const ownOf = (profile: ToolProfile) =>
    item.files.filter((file) => file.cli === undefined || file.cli === profile.id);
  const own = ownOf(profiles[0] as ToolProfile);
  for (const profile of profiles) {
    const files = ownOf(profile);
    if (files.length !== own.length || files.some((file, index) => file !== own[index]))
      return undefined;
  }
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

function commonFolder(paths: readonly string[]): string {
  let folder = dirnameOf(paths[0] ?? "");
  while (folder !== "" && !paths.every((path) => isUnder(path, folder) && path !== folder))
    folder = dirnameOf(folder);
  return folder;
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
  if (!isRecord(options)) {
    problems.push({ path: "options", message: "options is an object" });
    return problems;
  }
  for (const key of Object.keys(options))
    if (!OPTION_KEYS.includes(key))
      problems.push({ path: `options/${key}`, message: "unknown or not implemented option" });
  if (options.scope !== "project" && options.scope !== "user")
    problems.push({ path: "options/scope", message: "scope is project or user" });
  const data = options.data;
  if (
    data !== null &&
    !(
      isRecord(data) &&
      Object.keys(data).sort().join() === "commit,repository" &&
      typeof data.repository === "string" &&
      data.repository.length > 0 &&
      typeof data.commit === "string" &&
      /^[0-9a-f]{40}$/.test(data.commit)
    )
  )
    problems.push({
      path: "options/data",
      message: "data is null or { repository, commit } with an exact commit",
    });
  if (options.copy !== undefined && typeof options.copy !== "boolean")
    problems.push({ path: "options/copy", message: "copy is a boolean" });
  if (options.names !== undefined) {
    if (!isRecord(options.names))
      problems.push({ path: "options/names", message: "names maps item ids to install names" });
    else
      for (const [id, name] of Object.entries(options.names)) {
        if (!Array.isArray(selection) || !selection.includes(id))
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

export function planInstall(
  selection: readonly string[],
  contents: readonly Content[],
  profiles: readonly ToolProfile[],
  options: PlanOptions,
): PlanResult {
  const problems = validate(selection, contents, profiles, options);
  if (problems.length > 0) return { status: "invalid", problems };
  const scope = options.scope;

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
  for (const id of selection)
    if (!byId.has(id))
      return refused(
        "unknown-item",
        `the selected item ${quote(id)} is not in the supplied content`,
      );

  const chosen = [...selection].sort(compareCodeUnits);
  const missing: { item: string; reason: string; dependency: string }[] = [];
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
      const result = place(
        item,
        content.framework.id,
        profile,
        scope,
        options.names?.[id] ?? item.name,
      );
      if (isFailure(result)) unavailable.push({ item: id, cli: profile.id, ...result });
      else placements.push(...result);
    }

  // A client that shares another client's place takes it when that place is planned for
  // the same item, as a copy of that placement; otherwise its own place.
  const resolved: Placed[] = [];
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
    if (shared) {
      resolved.push({ ...shared, profile: entry.profile, representative: shared });
      continue;
    }
    if (entry.failure) {
      unavailable.push({ item: entry.item.id, cli: entry.profile.id, ...entry.failure });
      continue;
    }
    const { reuse: _reuse, ...own } = entry;
    resolved.push(own);
  }

  const clashes: Clash[] = [];
  const warnings: Warning[] = [];
  const writes: WriteStep[] = [];
  const links: LinkStep[] = [];
  const merges: MergeStep[] = [];
  const servedBy = new Map<string, string[]>();
  const serve = (id: string, clis: readonly string[]) =>
    servedBy.set(id, union(servedBy.get(id) ?? [], clis));
  const group = <T>(entries: readonly T[], keyOf: (entry: T) => string) => {
    const groups = new Map<string, T[]>();
    for (const entry of entries)
      groups.set(keyOf(entry), [...(groups.get(keyOf(entry)) ?? []), entry]);
    return [...groups.values()];
  };
  /** A shared placement's bytes come from its first client; reused ones keep their source. */
  const representative = (members: readonly Placed[]): Placed => {
    const first = members[0] as Placed;
    return first.representative ?? first;
  };
  const clisOf = (members: readonly Placed[]) => union(members.map((member) => member.profile.id));
  const itemsOf = (members: readonly Placed[]) => union(members.map((member) => member.item.id));

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
  for (const members of group(placementsAt, (entry) => (entry.unit as { path: string }).path)) {
    const first = members[0] as Placed;
    const unit = first.unit as Exclude<Unit, { shape: "merge" }>;
    const clis = clisOf(members);
    if (
      !members.every(
        (member) => signature(member.unit) === signature(unit) && member.item.id === first.item.id,
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
    for (const member of members) serve(member.item.id, [member.profile.id]);
    if (unit.shape === "file") {
      writes.push(writeOf(scope, unit.path, unit.output, rep, clis));
      continue;
    }
    const link =
      scope === "user" &&
      options.copy !== true &&
      unit.linkable &&
      members.every((member) => member.profile.links.skill === "documented");
    if (!link) {
      for (const entry of unit.outputs)
        writes.push(writeOf(scope, `${unit.path}/${entry.rel}`, entry, rep, clis));
      continue;
    }
    const shared = `.aihq/shared/${rep.framework}/${rep.item.kind}/${rep.item.name}/${versionOf(rep, unit.outputs)}`;
    for (const entry of unit.outputs)
      writes.push(writeOf("user", `${shared}/${entry.rel}`, entry, rep, clis));
    links.push({ op: "link", root: "user", path: unit.path, to: shared, item: rep.item.id, clis });
  }

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
      ...(unit.inputs ? { inputs: unit.inputs } : {}),
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

  // Notices covering a placed item, once each.
  for (const content of contents)
    for (const source of content.sources)
      for (const notice of source.notices) {
        const covered = chosen.filter((id) => {
          if (!servedBy.has(id)) return false;
          const { item, content: owner } = byId.get(id) as { item: Item; content: Content };
          if (owner !== content) return false;
          if (source.noticesFor?.includes(id)) return true;
          return item.files.some(
            (file) => file.sourceId === source.id && isUnder(file.sourcePath, notice.covers),
          );
        });
        if (covered.length === 0) continue;
        writes.push({
          op: "write",
          root: scope,
          path: `.aihq/notices/${content.framework.id}/${notice.sourcePath}`,
          from: { sourceId: source.id, sourcePath: notice.sourcePath, sha256: notice.sha256 },
          executable: false,
          items: covered,
          clis: union(...covered.map((id) => servedBy.get(id) ?? [])),
        });
      }

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
  for (const members of group(
    mergeUnits.filter((entry) => (entry.unit as { limitBytes?: number }).limitBytes !== undefined),
    (entry) => `${(entry.unit as { file: string }).file}\0${entry.profile.id}`,
  )) {
    const first = members[0] as Placed;
    const unit = first.unit as Extract<Unit, { shape: "merge" }>;
    const blocks = mergeUnits.filter(
      (entry) =>
        entry.profile.id === first.profile.id &&
        (entry.unit as { file: string }).file === unit.file,
    );
    const total = blocks.reduce(
      (sum, entry) =>
        sum + ((entry.unit as { bytes?: number }).bytes ?? 0) + MARKDOWN_OVERHEAD(entry.item.id),
      0,
    );
    if (total > (unit.limitBytes as number))
      clashes.push({
        root: scope,
        path: unit.file,
        reason: "limit",
        items: itemsOf(blocks),
        clis: [first.profile.id],
      });
  }
  // Never write through a planned link.
  for (const link of links)
    for (const step of finalWrites)
      if (step.root === link.root && step.path.startsWith(`${link.path}/`))
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
  unavailable.sort(
    (left, right) =>
      compareCodeUnits(left.item, right.item) || compareCodeUnits(left.cli, right.cli),
  );
  warnings.sort(
    (left, right) =>
      compareCodeUnits(left.code, right.code) || compareCodeUnits(left.cli, right.cli),
  );

  const blocked = missing.length > 0 || unavailable.length > 0 || clashes.length > 0;
  return {
    status: blocked ? "incomplete" : "ok",
    data:
      options.data === null
        ? null
        : { repository: options.data.repository, commit: options.data.commit },
    profiles: sortedProfiles.map((profile) => ({ id: profile.id, version: profile.version })),
    plan: [...finalWrites, ...links, ...merges],
    missing,
    unavailable,
    clashes,
    duplicates: [],
    references: [],
    warnings,
  };
}
