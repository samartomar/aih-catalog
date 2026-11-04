/**
 * AI setup records (kind `ai-setup`) and qualifications (`urn:aihq:catalog:qualification:0.1.0`).
 * An AI setup pins one tool version's artifact per platform cell, the runtime range it runs on,
 * how its MCP server starts from the acquired executable, its standalone settings, the upstream
 * installers a plan never offers, and the qualifications it accepts. A qualification records the
 * exact bytes one run saw on one cell and the run's result; Catalog runs nothing. Pure data.
 */
import { formats, type Problem } from "../contracts.js";
import { isRecord, isText, Problems, type Record_, TEXT_LIMITS } from "./check.js";
import {
  DATE,
  EXACT_VERSION,
  FRAMEWORK_ID,
  ID_SEGMENT,
  INPUT_NAME,
  PYTHON_PACKAGE_VERSION,
  RANGE,
  SHA256,
  SOURCE_ARCHIVE,
  SOURCE_HTTPS_URL,
  TOOL_NAME,
  WHEEL,
} from "./model.js";
import { isSafeRelativePath } from "./paths.js";

/** The six platform cells. */
export const CELLS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "windows-arm64",
  "windows-x64",
] as const;
export type Cell = (typeof CELLS)[number];

export const DISTRIBUTION_KINDS = ["pypi-wheel", "native-archive", "npm", "git"] as const;

export interface ArchiveMember {
  readonly path: string;
  readonly sha256: string;
  readonly executable: boolean;
}

/** One artifact, for the cells it serves. */
export interface Distribution {
  readonly cells: readonly Cell[];
  readonly kind: (typeof DISTRIBUTION_KINDS)[number];
  readonly file?: string;
  readonly url?: string;
  readonly sha256: string;
  readonly bytes: number;
  /** A native archive's members. */
  readonly members?: readonly ArchiveMember[];
  /** An npm artifact's registry integrity. */
  readonly integrity?: string;
}

/** A settings command: argv after the tool's executable, and the readback that checks it. */
export interface SettingsCommand {
  readonly argv: readonly string[];
  readonly readback: { readonly argv: readonly string[]; readonly expected: string };
}

/** An item file written as a setting, where the tool has no command for it. */
export interface SettingsFile {
  readonly sourcePath: string;
  readonly root: "user" | "project";
  readonly path: string;
}

export interface Settings {
  readonly commands: readonly SettingsCommand[];
  readonly files: readonly SettingsFile[];
}

export interface AiSetup {
  readonly version: string;
  readonly distributions: readonly Distribution[];
  readonly runtime?: {
    readonly python?: string;
    readonly node?: string;
    readonly closure?: string;
  };
  /** The program the acquired artifact provides: a member's name, a console script or a bin. */
  readonly executable: string;
  /** The MCP server's arguments after the executable; per client where they differ. */
  readonly launch: {
    readonly args: readonly string[];
    readonly clis?: Readonly<Record<string, readonly string[]>>;
  };
  readonly mcpItem?: string;
  readonly settings: Settings;
  /** Upstream installers a plan never offers; the first is the one an explicit override runs. */
  readonly doNotRun: readonly (readonly string[])[];
  /** The sha256 of each qualification this item accepts. Never part of the item's digests. */
  readonly qualifications: readonly string[];
  readonly licenceNotice?: string;
}

/** What a recipe changes in one AI setup's standalone setup. */
export interface AiSetupChange {
  readonly enabledTools?: readonly string[];
  readonly disabledTools?: readonly string[];
  readonly startupSeconds?: number;
  readonly callSeconds?: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly settings?: Settings;
}

export interface Interpreter {
  readonly version: string;
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
}

/** An exact wheel artifact, with no execution implied. */
export interface WheelArtifact {
  readonly name: string;
  readonly version: string;
  readonly file: string;
  readonly sha256: string;
}

/** Inputs actually used to build a wheel when a prebuilt dependency was unavailable. */
export interface WheelBuild {
  readonly source: {
    readonly file: string;
    readonly url: string;
    readonly sha256: string;
    readonly bytes: number;
  };
  readonly interpreter: Interpreter;
  readonly dependencies: readonly WheelArtifact[];
  /** Non-Python build tools, identified by their executable bytes. Empty for a pure build. */
  readonly tools: readonly {
    readonly name: string;
    readonly version: string;
    readonly sha256: string;
  }[];
  readonly isolated: true;
}

/** One installed wheel of a hash-locked closure; a source-built wheel retains its inputs. */
export interface Wheel extends WheelArtifact {
  readonly build?: WheelBuild;
}

export interface QualificationResult {
  readonly status: "qualified" | "blocked" | "unknown";
  readonly reason?: string;
  /** The sha256 of the qualification run's own record. */
  readonly run: string;
  readonly date: string;
}

export interface Qualification {
  readonly schema: string;
  readonly subject:
    | { readonly aiSetup: string; readonly version: string; readonly cell: Cell }
    | { readonly recipe: string; readonly cell: Cell };
  readonly observed:
    | {
        readonly artifact: {
          readonly file?: string;
          readonly url?: string;
          readonly sha256: string;
          readonly bytes: number;
        };
        readonly members?: readonly ArchiveMember[];
        readonly closure: readonly Wheel[] | null;
        readonly interpreter: Interpreter | null;
      }
    | { readonly qualifications: readonly string[] };
  readonly result: QualificationResult;
}

const isString = (value: unknown, max: number = TEXT_LIMITS.document): value is string =>
  isText(value, max);
const isArgv = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length <= 4096);
const isSha = (value: unknown): value is string => typeof value === "string" && SHA256.test(value);
const isCell = (value: unknown): value is Cell => (CELLS as readonly unknown[]).includes(value);
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const isSeconds = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 86_400;

function checkMembers(value: unknown, path: string, problems: Problems): void {
  if (!Array.isArray(value) || value.length === 0) {
    problems.add(path, "members lists each file with path, sha256 and executable");
    return;
  }
  const seen = new Set<string>();
  value.forEach((member, at) => {
    const where = `${path}/${at}`;
    if (!isRecord(member)) {
      problems.add(where, "a member is { path, sha256, executable }");
      return;
    }
    problems.keys(
      member,
      where,
      ["path", "sha256", "executable"],
      ["path", "sha256", "executable"],
    );
    problems.check(isSafeRelativePath(member.path), `${where}/path`, "a safe relative path");
    if (seen.has(String(member.path))) problems.add(`${where}/path`, "a member is listed twice");
    seen.add(String(member.path));
    problems.check(isSha(member.sha256), `${where}/sha256`, "a sha256");
    problems.check(typeof member.executable === "boolean", `${where}/executable`, "a boolean");
  });
}

function checkSettings(value: unknown, path: string, problems: Problems, files?: Set<string>) {
  if (!isRecord(value)) {
    problems.add(path, "settings are { commands, files }");
    return;
  }
  problems.keys(value, path, ["commands", "files"], ["commands", "files"]);
  if (!Array.isArray(value.commands)) problems.add(`${path}/commands`, "a list of commands");
  else
    value.commands.forEach((command, at) => {
      const where = `${path}/commands/${at}`;
      const ok =
        isRecord(command) &&
        Object.keys(command).sort().join() === "argv,readback" &&
        isArgv(command.argv) &&
        command.argv.length > 0 &&
        isRecord(command.readback) &&
        Object.keys(command.readback).sort().join() === "argv,expected" &&
        isArgv(command.readback.argv) &&
        command.readback.argv.length > 0 &&
        typeof command.readback.expected === "string";
      problems.check(ok, where, "a command is { argv, readback: { argv, expected } }");
    });
  if (!Array.isArray(value.files)) problems.add(`${path}/files`, "a list of settings files");
  else
    value.files.forEach((file, at) => {
      const where = `${path}/files/${at}`;
      const ok =
        isRecord(file) &&
        Object.keys(file).sort().join() === "path,root,sourcePath" &&
        isSafeRelativePath(file.sourcePath) &&
        isSafeRelativePath(file.path) &&
        (file.root === "user" || file.root === "project");
      problems.check(ok, where, "a settings file is { sourcePath, root, path }");
      if (ok && files !== undefined && !files.has(file.sourcePath as string))
        problems.add(`${where}/sourcePath`, "names no file of the item");
    });
}

/**
 * Shape problems of an item's `aiSetup` record. `files` are the item's own source paths, which
 * settings files must name.
 */
export function aiSetupProblems(
  value: unknown,
  path: string,
  files: readonly string[] = [],
): Problem[] {
  const problems = new Problems();
  if (!isRecord(value)) return [{ path, message: "aiSetup must be an object" }];
  problems.keys(
    value,
    path,
    [
      "version",
      "distributions",
      "runtime",
      "executable",
      "launch",
      "mcpItem",
      "settings",
      "doNotRun",
      "qualifications",
      "licenceNotice",
    ],
    ["version", "distributions", "executable", "launch", "settings", "doNotRun", "qualifications"],
  );
  problems.check(
    typeof value.version === "string" && EXACT_VERSION.test(value.version),
    `${path}/version`,
    "the upstream's exact version",
  );
  const covered = new Set<string>();
  if (!Array.isArray(value.distributions)) problems.add(`${path}/distributions`, "a list");
  else
    value.distributions.forEach((entry, at) => {
      const where = `${path}/distributions/${at}`;
      if (!isRecord(entry)) {
        problems.add(where, "a distribution is an object");
        return;
      }
      problems.keys(
        entry,
        where,
        ["cells", "kind", "file", "url", "sha256", "bytes", "members", "integrity"],
        ["cells", "kind", "sha256", "bytes"],
      );
      const cells = entry.cells;
      if (!Array.isArray(cells) || cells.length === 0 || !cells.every(isCell))
        problems.add(`${where}/cells`, `cells are among ${CELLS.join(", ")}`);
      else
        for (const cell of cells) {
          if (covered.has(cell)) problems.add(`${where}/cells`, `${cell} has two artifacts`);
          covered.add(cell);
        }
      problems.check(
        (DISTRIBUTION_KINDS as readonly unknown[]).includes(entry.kind),
        `${where}/kind`,
        "pypi-wheel, native-archive, npm or git",
      );
      problems.check(
        entry.file !== undefined || entry.url !== undefined,
        `${where}/file`,
        "an artifact names its file or url",
      );
      if (entry.file !== undefined)
        problems.check(
          isString(entry.file, 512) && !/[/\\]/.test(entry.file),
          `${where}/file`,
          "a file name",
        );
      if (entry.url !== undefined)
        problems.check(
          isString(entry.url, 2048) && entry.url.startsWith("https://"),
          `${where}/url`,
          "an https URL",
        );
      problems.check(isSha(entry.sha256), `${where}/sha256`, "the artifact's sha256");
      problems.check(isCount(entry.bytes), `${where}/bytes`, "the artifact's byte count");
      if (entry.kind === "native-archive")
        checkMembers(entry.members, `${where}/members`, problems);
      else if (entry.members !== undefined)
        problems.add(`${where}/members`, "only a native archive lists members");
      if (entry.kind === "npm")
        problems.check(
          typeof entry.integrity === "string" &&
            /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity),
          `${where}/integrity`,
          "an npm artifact carries its sha512 integrity",
        );
      else if (entry.integrity !== undefined)
        problems.add(`${where}/integrity`, "only an npm artifact carries integrity");
    });
  if (value.runtime !== undefined) {
    const runtime = value.runtime;
    if (!isRecord(runtime)) problems.add(`${path}/runtime`, "runtime is an object");
    else {
      problems.keys(runtime, `${path}/runtime`, ["python", "node", "closure"], []);
      for (const key of ["python", "node"])
        if (runtime[key] !== undefined)
          problems.check(
            typeof runtime[key] === "string" && RANGE.test(runtime[key] as string),
            `${path}/runtime/${key}`,
            "the upstream's supported version range",
          );
      if (runtime.closure !== undefined)
        problems.check(isString(runtime.closure, 64), `${path}/runtime/closure`, "a lock kind");
    }
  }
  problems.check(
    typeof value.executable === "string" && TOOL_NAME.test(value.executable),
    `${path}/executable`,
    "the program's name",
  );
  const launch = value.launch;
  if (!isRecord(launch)) problems.add(`${path}/launch`, "launch is { args, clis? }");
  else {
    problems.keys(launch, `${path}/launch`, ["args", "clis"], ["args"]);
    problems.check(isArgv(launch.args), `${path}/launch/args`, "an argv list");
    if (launch.clis !== undefined)
      problems.check(
        isRecord(launch.clis) &&
          Object.entries(launch.clis).every(
            ([cli, args]) => FRAMEWORK_ID.test(cli) && isArgv(args),
          ),
        `${path}/launch/clis`,
        "clis maps client ids to argv lists",
      );
  }
  if (value.mcpItem !== undefined)
    problems.check(isString(value.mcpItem, 512), `${path}/mcpItem`, "an mcp item id");
  checkSettings(value.settings, `${path}/settings`, problems, new Set(files));
  problems.check(
    Array.isArray(value.doNotRun) &&
      value.doNotRun.every((argv) => isArgv(argv) && argv.length > 0),
    `${path}/doNotRun`,
    "doNotRun lists argv lists",
  );
  problems.check(
    Array.isArray(value.qualifications) &&
      value.qualifications.every(isSha) &&
      new Set(value.qualifications).size === value.qualifications.length,
    `${path}/qualifications`,
    "qualifications lists distinct sha256",
  );
  if (value.licenceNotice !== undefined)
    problems.check(isString(value.licenceNotice), `${path}/licenceNotice`, "a notice text");
  return problems.list;
}

/** Shape problems of what a recipe changes in one AI setup; empty when well formed. */
export function aiSetupChangeProblems(value: unknown, path: string): Problem[] {
  const problems = new Problems();
  if (!isRecord(value)) return [{ path, message: "a change is an object" }];
  problems.keys(
    value,
    path,
    ["enabledTools", "disabledTools", "startupSeconds", "callSeconds", "env", "settings"],
    [],
  );
  toolSettingProblems(value, path, problems);
  if (value.settings !== undefined) checkSettings(value.settings, `${path}/settings`, problems);
  return problems.list;
}

/** The MCP setting fields an `mcp` item and a recipe change share. */
export const MCP_SETTINGS = [
  "enabledTools",
  "disabledTools",
  "startupSeconds",
  "callSeconds",
  "env",
] as const;

function toolSettingProblems(value: Record_, path: string, problems: Problems): void {
  for (const key of ["enabledTools", "disabledTools"])
    if (value[key] !== undefined) {
      const list = value[key];
      problems.check(
        Array.isArray(list) &&
          list.every((entry) => typeof entry === "string" && TOOL_NAME.test(entry)) &&
          new Set(list).size === list.length,
        `${path}/${key}`,
        "a list of distinct tool names",
      );
    }
  for (const key of ["startupSeconds", "callSeconds"])
    if (value[key] !== undefined)
      problems.check(isSeconds(value[key]), `${path}/${key}`, "whole seconds, 1–86400");
  if (value.env !== undefined)
    problems.check(
      isRecord(value.env) &&
        Object.entries(value.env).every(
          ([name, text]) =>
            INPUT_NAME.test(name) && typeof text === "string" && text.length <= 4096,
        ),
      `${path}/env`,
      "env maps variable names to text values (never a secret)",
    );
}

/** Problems of an `mcp` item's own settings fields (enabledTools … env). */
export function mcpSettingProblems(value: Record_, path: string): Problem[] {
  const problems = new Problems();
  toolSettingProblems(value, path, problems);
  return problems.list;
}

function checkInterpreter(value: unknown, path: string, problems: Problems): void {
  const ok =
    isRecord(value) &&
    Object.keys(value).sort().join() === "bytes,file,sha256,version" &&
    typeof value.version === "string" &&
    EXACT_VERSION.test(value.version) &&
    isString(value.file, 512) &&
    !/[/\\]/.test(value.file) &&
    isSha(value.sha256) &&
    isCount(value.bytes);
  problems.check(ok, path, "an interpreter is { version, file, sha256, bytes }");
}

function checkWheel(value: unknown, path: string, problems: Problems, allowBuild: boolean): void {
  if (!isRecord(value)) {
    problems.add(path, "a wheel is { name, version, file, sha256, build? }");
    return;
  }
  problems.keys(
    value,
    path,
    ["name", "version", "file", "sha256", ...(allowBuild ? ["build"] : [])],
    ["name", "version", "file", "sha256"],
  );
  problems.check(isString(value.name, 256), `${path}/name`, "a package name");
  problems.check(
    isString(value.version, 128) && PYTHON_PACKAGE_VERSION.test(value.version),
    `${path}/version`,
    "an exact package version",
  );
  problems.check(isSha(value.sha256), `${path}/sha256`, "the wheel's sha256");
  problems.check(
    typeof value.file === "string" && WHEEL.test(value.file),
    `${path}/file`,
    "a closure holds wheels only; source archives belong in build provenance",
  );
  if (allowBuild && value.build !== undefined) checkBuild(value.build, `${path}/build`, problems);
}

function checkBuild(value: unknown, path: string, problems: Problems): void {
  if (!isRecord(value)) {
    problems.add(path, "a build records its isolated source, interpreter, dependencies and tools");
    return;
  }
  const keys = ["source", "interpreter", "dependencies", "tools", "isolated"];
  problems.keys(value, path, keys, keys);
  problems.check(value.isolated === true, `${path}/isolated`, "a source build must be isolated");
  const source = value.source;
  if (!isRecord(source)) problems.add(`${path}/source`, "the exact source archive");
  else {
    const keys = ["file", "url", "sha256", "bytes"];
    problems.keys(source, `${path}/source`, keys, keys);
    problems.check(
      isString(source.file, 512) && SOURCE_ARCHIVE.test(source.file),
      `${path}/source/file`,
      "a source archive's file name",
    );
    let https = false;
    if (isString(source.url, 2048) && SOURCE_HTTPS_URL.test(source.url)) {
      try {
        const url = new URL(source.url);
        https = url.protocol === "https:" && !url.username && !url.password && !url.hash;
      } catch {
        /* an invalid URL remains false */
      }
    }
    problems.check(https, `${path}/source/url`, "an https URL without credentials or fragment");
    problems.check(isSha(source.sha256), `${path}/source/sha256`, "the source archive's sha256");
    problems.check(
      isCount(source.bytes),
      `${path}/source/bytes`,
      "the source archive's byte count",
    );
  }
  checkInterpreter(value.interpreter, `${path}/interpreter`, problems);
  if (!Array.isArray(value.dependencies) || value.dependencies.length === 0)
    problems.add(`${path}/dependencies`, "the exact build-dependency wheels");
  else
    value.dependencies.forEach((wheel, at) => {
      checkWheel(wheel, `${path}/dependencies/${at}`, problems, false);
    });
  if (!Array.isArray(value.tools))
    problems.add(`${path}/tools`, "the observed non-Python build tools");
  else
    value.tools.forEach((tool, at) => {
      const where = `${path}/tools/${at}`;
      const ok =
        isRecord(tool) &&
        Object.keys(tool).sort().join() === "name,sha256,version" &&
        isString(tool.name, 256) &&
        isString(tool.version, 256) &&
        isSha(tool.sha256);
      problems.check(ok, where, "a build tool is { name, version, sha256 }");
    });
}

/** Shape problems of a qualification document; empty when well formed. */
export function qualificationProblems(value: unknown): Problem[] {
  const problems = new Problems();
  if (!isRecord(value)) return [{ path: "", message: "a qualification must be an object" }];
  problems.keys(
    value,
    "",
    ["schema", "subject", "observed", "result"],
    ["schema", "subject", "observed", "result"],
  );
  problems.check(
    value.schema === formats.qualification,
    "/schema",
    `schema must be ${formats.qualification}`,
  );
  const subject = value.subject;
  let combination = false;
  if (!isRecord(subject))
    problems.add("/subject", "a subject is an AI setup or a recipe and a cell");
  else if (subject.recipe !== undefined) {
    combination = true;
    problems.keys(subject, "/subject", ["recipe", "cell"], ["recipe", "cell"]);
    problems.check(
      isString(subject.recipe, 128) && FRAMEWORK_ID.test(subject.recipe),
      "/subject/recipe",
      "a recipe id",
    );
    problems.check(isCell(subject.cell), "/subject/cell", "a platform cell");
  } else {
    problems.keys(
      subject,
      "/subject",
      ["aiSetup", "version", "cell"],
      ["aiSetup", "version", "cell"],
    );
    const id = subject.aiSetup;
    problems.check(
      isString(id, 512) &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*\.ai-setup\./.test(id) &&
        id
          .split(".")
          .slice(2)
          .every((segment) => ID_SEGMENT.test(segment)),
      "/subject/aiSetup",
      "an ai-setup item id",
    );
    problems.check(
      typeof subject.version === "string" && EXACT_VERSION.test(subject.version),
      "/subject/version",
      "an exact version",
    );
    problems.check(isCell(subject.cell), "/subject/cell", "a platform cell");
  }
  const result = value.result;
  let status: unknown;
  if (!isRecord(result)) problems.add("/result", "a result is { status, reason?, run, date }");
  else {
    problems.keys(
      result,
      "/result",
      ["status", "reason", "run", "date"],
      ["status", "run", "date"],
    );
    status = result.status;
    problems.check(
      status === "qualified" || status === "blocked" || status === "unknown",
      "/result/status",
      "qualified, blocked or unknown",
    );
    if (status === "blocked")
      problems.check(isString(result.reason, 1024), "/result/reason", "blocked names its reason");
    else if (status === "qualified")
      problems.check(result.reason === undefined, "/result/reason", "qualified has no reason");
    else if (result.reason !== undefined)
      problems.check(isString(result.reason, 1024), "/result/reason", "1–1024 characters");
    problems.check(isSha(result.run), "/result/run", "the sha256 of the run's record");
    problems.check(
      typeof result.date === "string" && DATE.test(result.date),
      "/result/date",
      "a YYYY-MM-DD date",
    );
  }
  const observed = value.observed;
  if (!isRecord(observed)) {
    problems.add("/observed", "observed is an object");
    return problems.list;
  }
  if (combination) {
    problems.keys(observed, "/observed", ["qualifications"], ["qualifications"]);
    const list = observed.qualifications;
    problems.check(
      Array.isArray(list) &&
        list.length >= 2 &&
        list.every(isSha) &&
        list.every((entry, at) => at === 0 || (list[at - 1] as string) < entry),
      "/observed/qualifications",
      "a combination lists two or more member qualifications, sorted and distinct",
    );
    return problems.list;
  }
  problems.keys(
    observed,
    "/observed",
    ["artifact", "members", "closure", "interpreter"],
    ["artifact", "closure", "interpreter"],
  );
  const artifact = observed.artifact;
  if (!isRecord(artifact)) problems.add("/observed/artifact", "the artifact that was seen");
  else {
    problems.keys(
      artifact,
      "/observed/artifact",
      ["file", "url", "sha256", "bytes"],
      ["sha256", "bytes"],
    );
    problems.check(
      artifact.file !== undefined || artifact.url !== undefined,
      "/observed/artifact/file",
      "the artifact's file or url",
    );
    problems.check(isSha(artifact.sha256), "/observed/artifact/sha256", "a sha256");
    problems.check(isCount(artifact.bytes), "/observed/artifact/bytes", "a byte count");
  }
  if (observed.members !== undefined) checkMembers(observed.members, "/observed/members", problems);
  const closure = observed.closure;
  if (closure !== null) {
    if (!Array.isArray(closure) || closure.length === 0)
      problems.add("/observed/closure", "null, or the hash-locked wheels");
    else
      closure.forEach((wheel, at) => {
        checkWheel(wheel, `/observed/closure/${at}`, problems, true);
      });
  }
  const interpreter = observed.interpreter;
  if (interpreter !== null) checkInterpreter(interpreter, "/observed/interpreter", problems);
  if (status === "qualified" && closure !== null)
    problems.check(
      interpreter !== null,
      "/observed/interpreter",
      "a qualified closure names the interpreter it ran on",
    );
  return problems.list;
}
