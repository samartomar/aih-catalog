/**
 * Planning AI setups: which qualification a selected AI setup uses on the plan's cell, the
 * `acquire` step that installs its exact artifact at user scope, the `tool-command` steps that
 * apply its settings, the settings files it writes, and how its MCP item starts the acquired
 * executable. A combination recipe uses exactly the member qualifications its own qualification
 * lists. An explicit upstream-installer override makes the tool unmanaged: one approval-requiring
 * `upstream-installer` step, no qualification or settings checks, and a warning.
 */
import type { Problem } from "../contracts.js";
import type {
  AiSetup,
  AiSetupChange,
  Cell,
  Distribution,
  Interpreter,
  Qualification,
  Settings,
  Wheel,
} from "./ai-setup.js";
import { canonicalDocument } from "./json.js";
import type { Content, Item } from "./model.js";
import { compareCodeUnits } from "./paths.js";
import type { Unavailable, Warning, WriteStep } from "./plan.js";
import { sha256Hex } from "./sha256.js";

/** Installs one AI setup's qualified artifact into its own user-scope folder. */
export interface AcquireStep {
  readonly op: "acquire";
  readonly aiSetup: string;
  readonly version: string;
  readonly cell: Cell;
  readonly root: "user";
  /** `.aihq/ai-setup/<name>/<version>/<cell>/`; versions sit side by side. */
  readonly into: string;
  readonly distribution: Omit<Distribution, "cells">;
  /** The program the server and settings commands run, from the user root. */
  readonly executable: string;
  /** The sha256 of the qualification every acquired byte is checked against. */
  readonly qualification: string;
  /** A Python tool's hash-locked, binary-only closure, installed into a dedicated environment. */
  readonly closure?: readonly Wheel[];
  /**
   * A Python tool's interpreter: an installed one inside `range` first; the qualification's
   * interpreter artifact only after a real failure.
   */
  readonly interpreter?: {
    readonly prefer: "installed";
    readonly range: string;
    readonly fallback: Interpreter | null;
  };
  /** npm artifacts never run lifecycle scripts. */
  readonly ignoreScripts?: true;
  readonly scanned: false;
}

/** A settings command, run only after the user approves; its readback must match. */
export interface ToolCommandStep {
  readonly op: "tool-command";
  readonly aiSetup: string;
  readonly qualification: string;
  readonly executable: { readonly root: "user"; readonly path: string };
  readonly argv: readonly string[];
  readonly readback: { readonly argv: readonly string[]; readonly expected: string };
  readonly approval: "required";
}

/** An upstream installer the user chose instead of a managed setup (`managed: false`). */
export interface UpstreamInstallerStep {
  readonly op: "upstream-installer";
  readonly aiSetup: string;
  readonly argv: readonly string[];
  readonly managed: false;
  readonly scanned: false;
  readonly approval: "required";
}

/** How a managed tool's MCP item starts: the acquired executable and its arguments. */
export interface ToolLaunch {
  readonly aiSetup: string;
  /** The executable from the user root, or undefined when the cell has no artifact. */
  readonly path?: string;
  readonly args: readonly string[];
  readonly clis?: Readonly<Record<string, readonly string[]>>;
  /** What a recipe changes in the MCP item's own settings. */
  readonly change?: AiSetupChange;
}

export interface ToolPlan {
  /** MCP items a selected, managed AI setup brings with it. */
  readonly implied: readonly string[];
  /** AI setup and MCP item ids that do not count as mixed frameworks. */
  readonly exempt: ReadonlySet<string>;
  readonly launches: ReadonlyMap<string, ToolLaunch>;
  readonly acquires: readonly AcquireStep[];
  readonly commands: readonly ToolCommandStep[];
  readonly installers: readonly UpstreamInstallerStep[];
  readonly writes: readonly WriteStep[];
  readonly unavailable: readonly Unavailable[];
  readonly warnings: readonly Warning[];
}

export interface ToolInput {
  readonly selection: readonly string[];
  readonly byId: ReadonlyMap<string, { readonly content: Content; readonly item: Item }>;
  readonly cell?: string;
  readonly qualifications?: readonly Qualification[];
  readonly upstreamInstallers?: readonly string[];
  /** A recipe's changes per AI setup id. */
  readonly changes?: Readonly<Record<string, AiSetupChange>>;
  /** A combination recipe: its id and the sha256 of its qualification for the plan's cell. */
  readonly combination?: { readonly recipe: string; readonly sha256?: string };
  /** Every client in the plan, which a settings file serves. */
  readonly clis: readonly string[];
}

/** The sha256 a qualification record is referenced by: its canonical bytes. */
export const qualificationSha = (record: Qualification): string =>
  sha256Hex(new TextEncoder().encode(canonicalDocument(record)));

const isWindows = (cell: string) => cell.startsWith("windows-");

/** The acquired program's path inside its folder, by artifact kind and cell. */
function programPath(setup: AiSetup, distribution: Distribution, cell: string): string | undefined {
  const name = setup.executable;
  switch (distribution.kind) {
    case "pypi-wheel":
      return isWindows(cell) ? `Scripts/${name}.exe` : `bin/${name}`;
    case "npm":
      return isWindows(cell) ? `node_modules/.bin/${name}.cmd` : `node_modules/.bin/${name}`;
    case "native-archive": {
      const found = (distribution.members ?? []).filter((member) => {
        const base = member.path.slice(member.path.lastIndexOf("/") + 1);
        return member.executable && (base === name || base === `${name}.exe`);
      });
      return found.length === 1 ? found[0]?.path : undefined;
    }
    default:
      return undefined;
  }
}

type Choice =
  | { readonly sha256: string; readonly record: Qualification }
  | Omit<Unavailable, "item">;

const sameMembers = (record: Qualification, distribution: Distribution) => {
  const observed = "artifact" in record.observed ? record.observed.members : undefined;
  if (distribution.kind !== "native-archive") return true;
  const key = (members: readonly { path: string; sha256: string; executable: boolean }[]) =>
    members
      .map((member) => `${member.path}\0${member.sha256}\0${member.executable}`)
      .sort()
      .join("\n");
  return observed !== undefined && key(observed) === key(distribution.members ?? []);
};

/**
 * Whether one qualification counts for this AI setup on this cell: it names the item, version
 * and cell, its observed artifact (and members) match the item's artifact, and for a Python
 * tool it records the closure.
 */
function check(
  item: Item,
  setup: AiSetup,
  distribution: Distribution,
  cell: string,
  record: Qualification,
): "ok" | "other" | "artifact-mismatch" | "no-closure" {
  const subject = record.subject;
  if (
    !("aiSetup" in subject) ||
    subject.aiSetup !== item.id ||
    subject.version !== setup.version ||
    subject.cell !== cell ||
    !("artifact" in record.observed)
  )
    return "other";
  const artifact = record.observed.artifact;
  if (
    artifact.sha256 !== distribution.sha256 ||
    artifact.bytes !== distribution.bytes ||
    !sameMembers(record, distribution)
  )
    return "artifact-mismatch";
  if (setup.runtime?.python !== undefined && record.observed.closure === null) return "no-closure";
  return "ok";
}

/** D95: among matching qualified records, the latest date, then the lowest sha256. */
function standalone(
  item: Item,
  setup: AiSetup,
  distribution: Distribution,
  cell: string,
  supplied: ReadonlyMap<string, Qualification>,
): Choice {
  const named = setup.qualifications
    .filter((sha256) => supplied.has(sha256))
    .map((sha256) => ({ sha256, record: supplied.get(sha256) as Qualification }))
    .map((entry) => ({
      ...entry,
      fit: check(item, setup, distribution, cell, entry.record),
    }))
    .filter((entry) => entry.fit !== "other");
  if (named.length === 0)
    return {
      cell: cell as Cell,
      reason: "no-qualification",
      detail: `no qualification of ${setup.version} on ${cell} was supplied`,
    };
  const matching = named.filter((entry) => entry.fit === "ok");
  if (matching.length === 0)
    return {
      cell: cell as Cell,
      reason: "not-qualified",
      cause: named.some((entry) => entry.fit === "artifact-mismatch")
        ? "artifact-mismatch"
        : "no-closure",
      detail: named.some((entry) => entry.fit === "artifact-mismatch")
        ? "no supplied qualification observed the item's artifact for this cell"
        : "the qualification records no dependency closure for this Python tool",
    };
  const qualified = matching
    .filter((entry) => entry.record.result.status === "qualified")
    .sort(
      (left, right) =>
        compareCodeUnits(right.record.result.date, left.record.result.date) ||
        compareCodeUnits(left.sha256, right.sha256),
    );
  const best = qualified[0];
  if (best !== undefined) return { sha256: best.sha256, record: best.record };
  return notQualified(
    matching.map((entry) => entry.record),
    cell,
  );
}

/** The latest result of records that are not qualified, as the unavailable reason. */
function notQualified(records: readonly Qualification[], cell: string): Omit<Unavailable, "item"> {
  const latest = [...records].sort((left, right) =>
    compareCodeUnits(right.result.date, left.result.date),
  )[0] as Qualification;
  const blocked = records.find((record) => record.result.status === "blocked");
  const shown = blocked ?? latest;
  return {
    cell: cell as Cell,
    reason: "not-qualified",
    cause: shown.result.status === "blocked" ? "blocked" : "unknown",
    detail:
      shown.result.reason ??
      `the qualification run's result is ${shown.result.status}, not qualified`,
  };
}

const distributionFor = (setup: AiSetup, cell: string) =>
  setup.distributions.find((entry) => entry.cells.includes(cell as Cell));

/** Problems of the tool options against the selection. */
export function toolProblems(input: ToolInput): Problem[] {
  const problems: Problem[] = [];
  const tools = input.selection.filter((id) => input.byId.get(id)?.item.kind === "ai-setup");
  if (tools.length > 0 && input.cell === undefined)
    problems.push({
      path: "options/cell",
      message: "an AI setup is planned for one platform cell",
    });
  for (const [index, id] of (input.upstreamInstallers ?? []).entries()) {
    const found = input.byId.get(id)?.item;
    if (found?.kind !== "ai-setup" || !input.selection.includes(id))
      problems.push({
        path: `options/upstreamInstallers/${index}`,
        message: "names a selected AI setup",
      });
    else if ((found.aiSetup as AiSetup).doNotRun.length === 0)
      problems.push({
        path: `options/upstreamInstallers/${index}`,
        message: "the AI setup lists no upstream installer",
      });
  }
  for (const id of Object.keys(input.changes ?? {}))
    if (input.byId.get(id)?.item.kind !== "ai-setup" || !input.selection.includes(id))
      problems.push({
        path: `recipe/aiSetup/${id}`,
        message: "names an AI setup the recipe installs",
      });
  return problems;
}

export function planTools(input: ToolInput): ToolPlan {
  const cell = input.cell as string;
  const supplied = new Map<string, Qualification>();
  for (const record of input.qualifications ?? []) supplied.set(qualificationSha(record), record);
  const unmanaged = new Set(input.upstreamInstallers ?? []);
  const plan = {
    implied: [] as string[],
    exempt: new Set<string>(),
    launches: new Map<string, ToolLaunch>(),
    acquires: [] as AcquireStep[],
    commands: [] as ToolCommandStep[],
    installers: [] as UpstreamInstallerStep[],
    writes: [] as WriteStep[],
    unavailable: [] as Unavailable[],
    warnings: [] as Warning[],
  };
  const tools = [...input.selection]
    .filter((id) => input.byId.get(id)?.item.kind === "ai-setup")
    .sort(compareCodeUnits);
  if (tools.length === 0) return plan;

  // A combination uses exactly the member qualifications its own qualification lists.
  let members: ReadonlyMap<string, string> | undefined;
  const combination = input.combination;
  const managed = tools.filter((id) => !unmanaged.has(id));
  if (combination !== undefined && managed.length > 0) {
    const record = combination.sha256 ? supplied.get(combination.sha256) : undefined;
    const subject = record?.subject;
    if (
      record === undefined ||
      subject === undefined ||
      !("recipe" in subject) ||
      subject.recipe !== combination.recipe ||
      subject.cell !== cell
    )
      plan.unavailable.push({
        recipe: combination.recipe,
        cell: cell as Cell,
        reason: "no-qualification",
        detail: `no qualification of the combination on ${cell} was supplied`,
      });
    else if (record.result.status !== "qualified") {
      plan.unavailable.push({ recipe: combination.recipe, ...notQualified([record], cell) });
    } else if ("qualifications" in record.observed) {
      const map = new Map<string, string>();
      for (const sha256 of record.observed.qualifications) {
        const member = supplied.get(sha256)?.subject;
        if (member !== undefined && "aiSetup" in member) map.set(member.aiSetup, sha256);
      }
      members = map;
    }
  }

  for (const id of tools) {
    const { item } = input.byId.get(id) as { item: Item };
    const setup = item.aiSetup as AiSetup;
    plan.exempt.add(id);
    if (setup.mcpItem !== undefined) plan.exempt.add(setup.mcpItem);
    if (setup.licenceNotice !== undefined)
      plan.warnings.push({ code: "licence-notice", aiSetup: id, items: [id] });
    if (unmanaged.has(id)) {
      plan.installers.push({
        op: "upstream-installer",
        aiSetup: id,
        argv: setup.doNotRun[0] as readonly string[],
        managed: false,
        scanned: false,
        approval: "required",
      });
      plan.warnings.push({ code: "unmanaged", aiSetup: id, items: [id] });
      continue;
    }
    const distribution = distributionFor(setup, cell);
    const program = distribution ? programPath(setup, distribution, cell) : undefined;
    const into = `.aihq/ai-setup/${item.name}/${setup.version}/${cell}/`;
    const path = program === undefined ? undefined : `${into}${program}`;
    const change = input.changes?.[id];
    if (setup.mcpItem !== undefined) {
      plan.implied.push(setup.mcpItem);
      plan.launches.set(setup.mcpItem, {
        aiSetup: id,
        ...(path !== undefined ? { path } : {}),
        args: setup.launch.args,
        ...(setup.launch.clis ? { clis: setup.launch.clis } : {}),
        ...(change ? { change } : {}),
      });
    }
    if (distribution === undefined) {
      plan.unavailable.push({
        item: id,
        cell: cell as Cell,
        reason: "no-qualification",
        detail: `the AI setup has no artifact for ${cell}`,
      });
      continue;
    }
    if (path === undefined) {
      plan.unavailable.push({
        item: id,
        cell: cell as Cell,
        reason: "not-implemented",
        detail: `acquiring a ${distribution.kind} artifact's program is not implemented`,
      });
      continue;
    }
    let choice: Choice;
    const listed = members?.get(id);
    if (members !== undefined) {
      const record = listed ? supplied.get(listed) : undefined;
      if (listed === undefined || record === undefined || !setup.qualifications.includes(listed))
        choice = {
          cell: cell as Cell,
          reason: "no-qualification",
          detail: "the combination's qualification lists no member qualification this item accepts",
        };
      else {
        const fit = check(item, setup, distribution, cell, record);
        choice =
          fit === "ok"
            ? record.result.status === "qualified"
              ? { sha256: listed, record }
              : notQualified([record], cell)
            : fit === "other"
              ? {
                  cell: cell as Cell,
                  reason: "no-qualification",
                  detail: "the listed member qualification is for another subject",
                }
              : {
                  cell: cell as Cell,
                  reason: "not-qualified",
                  cause: fit,
                  detail: "the listed member qualification does not match the item's artifact",
                };
      }
    } else choice = standalone(item, setup, distribution, cell, supplied);
    if (!("sha256" in choice)) {
      plan.unavailable.push({ item: id, ...choice });
      continue;
    }
    const observed = choice.record.observed as Extract<
      Qualification["observed"],
      { artifact: unknown }
    >;
    const { cells: _cells, ...artifact } = distribution;
    plan.acquires.push({
      op: "acquire",
      aiSetup: id,
      version: setup.version,
      cell: cell as Cell,
      root: "user",
      into,
      distribution: artifact,
      executable: path,
      qualification: choice.sha256,
      ...(observed.closure !== null ? { closure: observed.closure } : {}),
      ...(setup.runtime?.python !== undefined
        ? {
            interpreter: {
              prefer: "installed" as const,
              range: setup.runtime.python,
              fallback: observed.interpreter,
            },
          }
        : {}),
      ...(distribution.kind === "npm" ? { ignoreScripts: true as const } : {}),
      scanned: false,
    });
    const settings: Settings = change?.settings ?? setup.settings;
    for (const command of settings.commands)
      plan.commands.push({
        op: "tool-command",
        aiSetup: id,
        qualification: choice.sha256,
        executable: { root: "user", path },
        argv: command.argv,
        readback: command.readback,
        approval: "required",
      });
    for (const file of settings.files) {
      const source = item.files.find((entry) => entry.sourcePath === file.sourcePath);
      if (source === undefined) continue;
      plan.writes.push({
        op: "write",
        root: file.root,
        path: file.path,
        from: {
          item: id,
          sourceId: source.sourceId,
          sourcePath: source.sourcePath,
          sha256: source.sha256,
        },
        executable: source.executable,
        item: id,
        clis: input.clis,
      });
    }
  }
  return plan;
}
