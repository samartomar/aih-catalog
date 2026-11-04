/**
 * `planInstall`: hand-selected items placed by tool profiles. This implementation
 * plans project scope for skills and always-on rules; everything else is reported, never
 * claimed. Identical inputs give byte-identical plans.
 */
import type { Invalid, Problem, Refused } from "../contracts.js";
import { implementedKinds } from "../contracts.js";
import { installRelative } from "./identity.js";
import { canonicalJson } from "./json.js";
import { type Content, INSTALL_NAME, type Item, type ItemFile } from "./model.js";
import { compareCodeUnits, isSafeRelativePath, isUnder, quote, refused } from "./paths.js";
import { changesBytes, type RenderName, renderEdit, type ToolProfile } from "./render.js";
import { contentProblems, profileProblems } from "./validate.js";

export interface PlanRender {
  readonly name: RenderName;
  readonly profile: string;
  readonly version: number;
  readonly entry?: string;
}

export interface WriteStep {
  readonly op: "write";
  readonly root: "project" | "user";
  readonly path: string;
  readonly from: {
    readonly item?: string;
    readonly sourceId: string;
    readonly sourcePath: string;
    readonly sha256: string;
  };
  readonly executable: boolean;
  readonly render?: PlanRender;
  readonly scanned?: false;
  readonly item?: string;
  readonly items?: readonly string[];
  readonly clis: readonly string[];
}

export type PlanStep = WriteStep;

export interface Unavailable {
  readonly item: string;
  readonly cli: string;
  readonly reason: "not-implemented" | "not-described" | "no-user-only";
  readonly detail: string;
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
  readonly clashes: readonly {
    readonly root: string;
    readonly path: string;
    readonly items: readonly string[];
    readonly clis: readonly string[];
  }[];
  readonly duplicates: readonly never[];
  readonly references: readonly never[];
  readonly warnings: readonly never[];
}

export type PlanResult = Plan | Invalid | Refused;

export interface PlanOptions {
  readonly scope: "project" | "user";
  readonly data: { readonly repository: string; readonly commit: string } | null;
  readonly copy?: boolean;
  readonly names?: Readonly<Record<string, string>>;
}

const OPTION_KEYS = ["scope", "data", "copy", "names"];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

interface Placement {
  readonly steps: WriteStep[];
}

function stepFor(
  item: Item,
  file: ItemFile,
  path: string,
  profile: ToolProfile,
  render: { name: RenderName; entry?: string } | null,
): WriteStep {
  const base = {
    op: "write" as const,
    root: "project" as const,
    path,
    from: {
      item: item.id,
      sourceId: file.sourceId,
      sourcePath: file.sourcePath,
      sha256: file.sha256,
    },
    executable: file.executable,
    item: item.id,
    clis: [profile.id],
  };
  if (render === null) return base;
  const recorded: PlanRender =
    render.entry === undefined
      ? { name: render.name, profile: profile.id, version: profile.version }
      : { name: render.name, profile: profile.id, version: profile.version, entry: render.entry };
  return { ...base, render: recorded, scanned: false };
}

/** Where one item goes for one profile at project scope, or why it cannot. */
function place(
  item: Item,
  profile: ToolProfile,
  installName: string,
): Placement | Omit<Unavailable, "item" | "cli"> {
  if (!(implementedKinds as readonly string[]).includes(item.kind)) {
    return {
      reason: "not-implemented",
      detail: `planning ${item.kind} items is not implemented yet`,
    };
  }
  if (item.fetch === "upstream" || item.editions !== undefined || item.bundle !== undefined) {
    return {
      reason: "not-implemented",
      detail: "upstream fetching, editions and bundles are not implemented yet",
    };
  }
  const own = item.files.filter((file) => file.cli === undefined || file.cli === profile.id);
  if (item.kind === "skill") {
    const folder = profile.places.skill?.project;
    if (typeof folder !== "string")
      return { reason: "not-described", detail: "the profile has no project skill place" };
    const skillFile = own.find((file) => installRelative(item, file) === "SKILL.md");
    if (skillFile === undefined)
      return { reason: "not-implemented", detail: "the skill has no SKILL.md" };
    if (item.userOnly && profile.userOnly === "none") {
      const fallback = profile.userOnlyFallback?.project;
      if (fallback === undefined) {
        return {
          reason: "no-user-only",
          detail: "the profile can neither flag nor fall back for a user-only skill",
        };
      }
      if (own.length > 1) {
        return {
          reason: "not-implemented",
          detail: "a user-only fallback for a skill with support files is not implemented yet",
        };
      }
      return {
        steps: fallback.map((entry) => {
          const edit = renderEdit("user-only-fallback", entry.id, item, profile, "project");
          const render =
            "reason" in edit || !changesBytes(edit)
              ? null
              : { name: "user-only-fallback" as const, entry: entry.id };
          return stepFor(
            item,
            skillFile,
            entry.path.replaceAll("<name>", installName),
            profile,
            render,
          );
        }),
      };
    }
    const target = folder.replaceAll("<name>", installName);
    return {
      steps: own.map((file) => {
        const relative = installRelative(item, file);
        let render: { name: RenderName } | null = null;
        if (file === skillFile) {
          const edit = renderEdit("skill", undefined, item, profile, "project");
          if (!("reason" in edit) && changesBytes(edit)) render = { name: "skill" };
        }
        return stepFor(item, file, `${target}${relative}`, profile, render);
      }),
    };
  }
  // rule
  if (item.scope !== "always") {
    return {
      reason: "not-implemented",
      detail: "rules scoped other than always are not implemented yet",
    };
  }
  const places = profile.places.rule?.project as Readonly<Record<string, string>> | undefined;
  const file = places?.always;
  const scope = profile.ruleScopes?.always;
  if (file === undefined || scope === undefined) {
    return { reason: "not-described", detail: "the profile has no project always-on rule place" };
  }
  const only = own[0] as ItemFile;
  const edit = renderEdit("rule", undefined, item, profile, "project");
  const render = "reason" in edit || !changesBytes(edit) ? null : { name: "rule" as const };
  return { steps: [stepFor(item, only, file.replaceAll("<name>", installName), profile, render)] };
}

const union = (left: readonly string[], right: readonly string[]): string[] =>
  [...new Set([...left, ...right])].sort(compareCodeUnits);

export function planInstall(
  selection: readonly string[],
  contents: readonly Content[],
  profiles: readonly ToolProfile[],
  options: PlanOptions,
): PlanResult {
  const problems: Problem[] = [];
  if (!Array.isArray(selection) || !selection.every((id) => typeof id === "string")) {
    problems.push({ path: "selection", message: "the selection is a list of item ids" });
  } else if (new Set(selection).size !== selection.length) {
    problems.push({ path: "selection", message: "an item is selected twice" });
  }
  if (!Array.isArray(contents)) problems.push({ path: "contents", message: "contents is a list" });
  else
    contents.forEach((content, index) => {
      for (const problem of contentProblems(content))
        problems.push({ path: `contents/${index}${problem.path}`, message: problem.message });
    });
  if (!Array.isArray(profiles) || profiles.length === 0)
    problems.push({ path: "profiles", message: "plan for at least one profile" });
  else {
    profiles.forEach((profile, index) => {
      for (const problem of profileProblems(profile))
        problems.push({ path: `profiles/${index}${problem.path}`, message: problem.message });
    });
    if (new Set(profiles.map((profile) => profile?.id)).size !== profiles.length) {
      problems.push({ path: "profiles", message: "a profile is supplied twice" });
    }
  }
  if (!isRecord(options)) problems.push({ path: "options", message: "options is an object" });
  else {
    for (const key of Object.keys(options)) {
      if (!OPTION_KEYS.includes(key))
        problems.push({ path: `options/${key}`, message: "unknown or not implemented option" });
    }
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
    ) {
      problems.push({
        path: "options/data",
        message: "data is null or { repository, commit } with an exact commit",
      });
    }
    if (options.copy !== undefined && typeof options.copy !== "boolean")
      problems.push({ path: "options/copy", message: "copy is a boolean" });
    if (options.names !== undefined) {
      if (!isRecord(options.names))
        problems.push({ path: "options/names", message: "names maps item ids to install names" });
      else
        for (const [id, name] of Object.entries(options.names)) {
          if (!Array.isArray(selection) || !selection.includes(id))
            problems.push({ path: `options/names/${id}`, message: "names an unselected item" });
          if (typeof name !== "string" || name.length > 64 || !INSTALL_NAME.test(name)) {
            problems.push({
              path: `options/names/${id}`,
              message: "an install name is at most 64 characters of a-z0-9-",
            });
          }
        }
    }
  }
  if (problems.length > 0) return { status: "invalid", problems };
  if (options.scope === "user")
    return refused("not-implemented", "user-scope placement is not implemented yet");

  const byId = new Map<string, { content: Content; item: Item }>();
  for (const content of contents) {
    for (const item of content.items) {
      if (byId.has(item.id))
        return {
          status: "invalid",
          problems: [{ path: item.id, message: "the item id appears in two contents" }],
        };
      byId.set(item.id, { content, item });
    }
  }
  for (const id of selection) {
    if (!byId.has(id))
      return refused(
        "unknown-item",
        `the selected item ${quote(id)} is not in the supplied content`,
      );
  }

  const chosen = [...selection].sort(compareCodeUnits);
  const missing: { item: string; reason: string; dependency: string }[] = [];
  for (const id of chosen) {
    for (const dependency of byId.get(id)?.item.dependencies ?? []) {
      if (!selection.includes(dependency))
        missing.push({ item: id, reason: "dependency-not-selected", dependency });
    }
  }

  const sortedProfiles = [...profiles].sort((left, right) => compareCodeUnits(left.id, right.id));
  const unavailable: Unavailable[] = [];
  const steps: WriteStep[] = [];
  const servedBy = new Map<string, string[]>();
  for (const profile of sortedProfiles) {
    for (const id of chosen) {
      const { item } = byId.get(id) as { item: Item };
      const result = place(item, profile, options.names?.[id] ?? item.name);
      if ("reason" in result) {
        unavailable.push({ item: id, cli: profile.id, ...result });
        continue;
      }
      steps.push(...result.steps);
      servedBy.set(id, union(servedBy.get(id) ?? [], [profile.id]));
    }
  }

  // Notices covering a placed item, once each.
  for (const content of contents) {
    for (const source of content.sources) {
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
        steps.push({
          op: "write",
          root: "project",
          path: `.aihq/notices/${content.framework.id}/${notice.sourcePath}`,
          from: { sourceId: source.id, sourcePath: notice.sourcePath, sha256: notice.sha256 },
          executable: false,
          items: covered,
          clis: covered.reduce<string[]>((clis, id) => union(clis, servedBy.get(id) ?? []), []),
        });
      }
    }
  }

  // Deduplicate identical placements, uniting their consumers; others clash.
  const byPath = new Map<string, WriteStep[]>();
  for (const step of steps) {
    if (!isSafeRelativePath(step.path))
      return refused("path-escape", `a planned path ${quote(step.path)} is unsafe`);
    const key = `${step.root}\0${step.path}`;
    byPath.set(key, [...(byPath.get(key) ?? []), step]);
  }
  const identity = (step: WriteStep) => canonicalJson({ ...step, clis: [] });
  const merged: WriteStep[] = [];
  const clashes: Plan["clashes"][number][] = [];
  for (const group of byPath.values()) {
    const first = group[0] as WriteStep;
    if (group.every((step) => identity(step) === identity(first))) {
      merged.push({
        ...first,
        clis: group.reduce<string[]>((clis, step) => union(clis, step.clis), []),
      });
    } else {
      clashes.push({
        root: first.root,
        path: first.path,
        items: [
          ...new Set(group.flatMap((step) => (step.item ? [step.item] : (step.items ?? [])))),
        ].sort(compareCodeUnits),
        clis: group.reduce<string[]>((clis, step) => union(clis, step.clis), []),
      });
    }
  }
  merged.sort(
    (left, right) =>
      compareCodeUnits(left.root, right.root) || compareCodeUnits(left.path, right.path),
  );
  clashes.sort(
    (left, right) =>
      compareCodeUnits(left.root, right.root) || compareCodeUnits(left.path, right.path),
  );

  unavailable.sort(
    (left, right) =>
      compareCodeUnits(left.item, right.item) || compareCodeUnits(left.cli, right.cli),
  );
  const blocked = missing.length > 0 || unavailable.length > 0 || clashes.length > 0;
  return {
    status: blocked ? "incomplete" : "ok",
    data:
      options.data === null
        ? null
        : { repository: options.data.repository, commit: options.data.commit },
    profiles: sortedProfiles.map((profile) => ({ id: profile.id, version: profile.version })),
    plan: merged,
    missing,
    unavailable,
    clashes,
    duplicates: [],
    references: [],
    warnings: [],
  };
}
