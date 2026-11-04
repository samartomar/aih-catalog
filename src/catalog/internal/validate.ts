/**
 * Record-shape checks for content documents and tool profiles. Without source files these
 * check shape and recompute the digests that depend only on the record.
 */
import { formats, kinds, type Problem } from "../contracts.js";
import { behaviourSha256, contentSha256, kindFieldNames } from "./identity.js";
import {
  FRAMEWORK_ID,
  ID_SEGMENT,
  INPUT_NAME,
  INSTALL_NAME,
  type Item,
  NPM_PACKAGE,
  OBJECT_ID,
  SHA256,
} from "./model.js";
import { isSafeRelativePath } from "./paths.js";
import { EXACT_VERSION } from "./source-link.js";

type Record_ = Record<string, unknown>;
const isRecord = (value: unknown): value is Record_ =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown, max = 4096): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

class Problems {
  readonly list: Problem[] = [];
  add(path: string, message: string): void {
    this.list.push({ path, message });
  }
  keys(
    value: Record_,
    path: string,
    allowed: readonly string[],
    required: readonly string[],
  ): void {
    for (const key of Object.keys(value))
      if (!allowed.includes(key)) this.add(`${path}/${key}`, "unknown field");
    for (const key of required)
      if (value[key] === undefined) this.add(`${path}/${key}`, "required field is missing");
  }
}

const SOURCE_KINDS = ["git", "npm", "local", "authored"];
const ITEM_FIELDS = [
  "id",
  "kind",
  "name",
  "description",
  "files",
  "contentSha256",
  "behaviourSha256",
  "scanKey",
  "userOnly",
  "arguments",
  "scope",
  "language",
  "requirements",
  "dependencies",
  "references",
  "bundle",
  "supersedes",
  "fetch",
  "editions",
  "cli",
  ...new Set(kinds.flatMap((kind) => kindFieldNames(kind))),
];
const SCAN_KEY = /^git-sha(?:1:[0-9a-f]{40}|256:[0-9a-f]{64})$/;

function checkScope(scope: unknown, path: string, problems: Problems): void {
  if (scope === "always" || scope === "on-request") return;
  if (isRecord(scope) && Object.keys(scope).length === 1) {
    if (scope.byDescription === true) return;
    if (
      Array.isArray(scope.paths) &&
      scope.paths.length > 0 &&
      scope.paths.every((glob) => isString(glob, 1024))
    )
      return;
  }
  problems.add(path, "scope must be always, on-request, { paths } or { byDescription: true }");
}

function checkIdList(value: unknown, path: string, problems: Problems): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.every((entry) => isString(entry, 512)))
    problems.add(path, "must be a list of ids");
}

/** Shape problems of a content document; empty when the record is well formed. */
export function contentProblems(value: unknown): Problem[] {
  const problems = new Problems();
  if (!isRecord(value)) return [{ path: "", message: "content must be an object" }];
  problems.keys(
    value,
    "",
    ["schema", "framework", "sources", "items", "bundles"],
    ["schema", "framework", "sources", "items"],
  );
  if (value.schema !== formats.content)
    problems.add("/schema", `schema must be ${formats.content}`);
  const framework = value.framework;
  let frameworkId = "";
  if (!isRecord(framework)) problems.add("/framework", "framework must be an object");
  else {
    problems.keys(framework, "/framework", ["id", "name"], ["id", "name"]);
    if (!isString(framework.id, 128) || !FRAMEWORK_ID.test(framework.id))
      problems.add("/framework/id", "invalid framework id");
    else frameworkId = framework.id;
    if (!isString(framework.name, 200))
      problems.add("/framework/name", "name must be 1–200 characters");
  }
  const sourceIds = new Set<string>();
  if (!Array.isArray(value.sources)) problems.add("/sources", "sources must be a list");
  else
    value.sources.forEach((source, index) => {
      const path = `/sources/${index}`;
      if (!isRecord(source)) {
        problems.add(path, "a source must be an object");
        return;
      }
      problems.keys(
        source,
        path,
        [
          "id",
          "kind",
          "repository",
          "commit",
          "package",
          "version",
          "subpath",
          "notices",
          "noticesFor",
        ],
        ["id", "kind", "notices"],
      );
      if (!isString(source.id, 128) || !FRAMEWORK_ID.test(source.id))
        problems.add(`${path}/id`, "invalid source id");
      else if (sourceIds.has(source.id)) problems.add(`${path}/id`, "duplicate source id");
      else sourceIds.add(source.id);
      if (!SOURCE_KINDS.includes(source.kind as string))
        problems.add(`${path}/kind`, "unknown source kind");
      for (const key of ["repository", "commit", "package", "version"])
        if (source[key] !== undefined && !isString(source[key], 2048))
          problems.add(`${path}/${key}`, "must be a string");
      if (source.subpath !== undefined && !isSafeRelativePath(source.subpath))
        problems.add(`${path}/subpath`, "unsafe subpath");
      // Pinned identity: a Git source records its commit id, an npm source its exact version.
      const absent = (keys: readonly string[]) => {
        for (const key of keys)
          if (source[key] !== undefined)
            problems.add(`${path}/${key}`, `a ${String(source.kind)} source has no ${key}`);
      };
      if (source.kind === "git") {
        if (!isString(source.repository, 2048))
          problems.add(`${path}/repository`, "a git source needs its repository");
        if (typeof source.commit !== "string" || !OBJECT_ID.test(source.commit))
          problems.add(`${path}/commit`, "a git source needs an exact commit id");
        absent(["package", "version"]);
      } else if (source.kind === "npm") {
        if (typeof source.package !== "string" || !NPM_PACKAGE.test(source.package))
          problems.add(`${path}/package`, "an npm source needs its package name");
        if (typeof source.version !== "string" || !EXACT_VERSION.test(source.version))
          problems.add(`${path}/version`, "an npm source needs an exact version");
        absent(["repository", "commit", "subpath"]);
      } else if (source.kind === "local")
        absent(["repository", "commit", "package", "version", "subpath"]);
      checkIdList(source.noticesFor, `${path}/noticesFor`, problems);
      if (!Array.isArray(source.notices)) problems.add(`${path}/notices`, "notices must be a list");
      else
        source.notices.forEach((notice, at) => {
          const noticePath = `${path}/notices/${at}`;
          if (!isRecord(notice)) {
            problems.add(noticePath, "a notice must be an object");
            return;
          }
          problems.keys(
            notice,
            noticePath,
            ["sourcePath", "sha256", "covers"],
            ["sourcePath", "sha256", "covers"],
          );
          if (!isSafeRelativePath(notice.sourcePath))
            problems.add(`${noticePath}/sourcePath`, "unsafe path");
          if (typeof notice.sha256 !== "string" || !SHA256.test(notice.sha256))
            problems.add(`${noticePath}/sha256`, "invalid sha256");
          if (notice.covers !== "/" && !isSafeRelativePath(notice.covers))
            problems.add(`${noticePath}/covers`, "covers must be / or a folder");
        });
    });
  const bundles = new Map<string, unknown[]>();
  if (value.bundles !== undefined) {
    if (!Array.isArray(value.bundles)) problems.add("/bundles", "bundles must be a list");
    else
      value.bundles.forEach((bundle, index) => {
        if (!isRecord(bundle) || !isString(bundle.id, 512) || !Array.isArray(bundle.files)) {
          problems.add(`/bundles/${index}`, "a bundle needs an id and files");
        } else bundles.set(bundle.id, bundle.files);
      });
  }
  const itemIds = new Set<string>();
  if (!Array.isArray(value.items)) problems.add("/items", "items must be a list");
  else
    value.items.forEach((item, index) => {
      const path = `/items/${index}`;
      if (!isRecord(item)) {
        problems.add(path, "an item must be an object");
        return;
      }
      problems.keys(item, path, ITEM_FIELDS, [
        "id",
        "kind",
        "name",
        "description",
        "files",
        "contentSha256",
        "behaviourSha256",
      ]);
      if (!kinds.includes(item.kind as never)) problems.add(`${path}/kind`, "unknown kind");
      const id = item.id;
      const prefix = `${frameworkId}.${String(item.kind)}.`;
      if (
        !isString(id, 512) ||
        !id.startsWith(prefix) ||
        !id
          .slice(prefix.length)
          .split(".")
          .every((segment) => ID_SEGMENT.test(segment))
      ) {
        problems.add(`${path}/id`, "id must be <framework>.<kind>.<path>");
      } else if (itemIds.has(id)) problems.add(`${path}/id`, "duplicate item id");
      else itemIds.add(id);
      if (!isString(item.name, 64) || !INSTALL_NAME.test(item.name)) {
        problems.add(
          `${path}/name`,
          "name must be at most 64 characters of a-z0-9- with single inner hyphens",
        );
      }
      if (!isString(item.description, 1024))
        problems.add(`${path}/description`, "description must be 1–1024 characters");
      let filesOk = Array.isArray(item.files) && item.files.length > 0;
      if (!filesOk) problems.add(`${path}/files`, "an item needs at least one file");
      else
        (item.files as unknown[]).forEach((file, at) => {
          const filePath = `${path}/files/${at}`;
          if (!isRecord(file)) {
            filesOk = false;
            problems.add(filePath, "a file must be an object");
            return;
          }
          const before = problems.list.length;
          problems.keys(
            file,
            filePath,
            [
              "sourceId",
              "sourcePath",
              "sha256",
              "bytes",
              "executable",
              "role",
              "cli",
              "derivedFrom",
            ],
            ["sourceId", "sourcePath", "sha256", "bytes", "executable", "role"],
          );
          if (!sourceIds.has(file.sourceId as string))
            problems.add(`${filePath}/sourceId`, "names no source");
          if (!isSafeRelativePath(file.sourcePath))
            problems.add(`${filePath}/sourcePath`, "unsafe path");
          if (typeof file.sha256 !== "string" || !SHA256.test(file.sha256))
            problems.add(`${filePath}/sha256`, "invalid sha256");
          if (!Number.isSafeInteger(file.bytes) || (file.bytes as number) < 0)
            problems.add(`${filePath}/bytes`, "invalid byte count");
          if (typeof file.executable !== "boolean")
            problems.add(`${filePath}/executable`, "must be a boolean");
          if (file.role !== "content" && file.role !== "behaviour")
            problems.add(`${filePath}/role`, "role must be content or behaviour");
          if (file.cli !== undefined && !isString(file.cli, 64))
            problems.add(`${filePath}/cli`, "must be a CLI id");
          if (
            file.derivedFrom !== undefined &&
            !(
              isRecord(file.derivedFrom) &&
              isSafeRelativePath(file.derivedFrom.sourcePath) &&
              typeof file.derivedFrom.pointer === "string"
            )
          ) {
            problems.add(`${filePath}/derivedFrom`, "derivedFrom needs sourcePath and pointer");
          }
          if (problems.list.length > before) filesOk = false;
        });
      if (
        item.scanKey !== undefined &&
        !(typeof item.scanKey === "string" && SCAN_KEY.test(item.scanKey))
      ) {
        problems.add(`${path}/scanKey`, "invalid scan key");
      }
      if (item.kind === "skill") {
        if (typeof item.userOnly !== "boolean")
          problems.add(`${path}/userOnly`, "a skill records userOnly");
        if (typeof item.arguments !== "boolean")
          problems.add(`${path}/arguments`, "a skill records arguments");
      } else {
        if (item.userOnly !== undefined)
          problems.add(`${path}/userOnly`, "only skills are user-only");
        if (item.arguments !== undefined)
          problems.add(`${path}/arguments`, "only skills record arguments");
      }
      if (item.kind === "rule") checkScope(item.scope, `${path}/scope`, problems);
      else if (item.scope !== undefined) problems.add(`${path}/scope`, "only rules have a scope");
      checkKindFields(item, path, problems);
      if (item.requirements !== undefined)
        checkRequirements(item.requirements, `${path}/requirements`, problems);
      if (item.editions !== undefined)
        checkEditions(item.editions, `${path}/editions`, sourceIds, problems);
      for (const key of ["dependencies", "references", "supersedes"])
        checkIdList(item[key], `${path}/${key}`, problems);
      if (item.fetch !== undefined && item.fetch !== "upstream")
        problems.add(`${path}/fetch`, "fetch must be upstream");
      if (
        item.language !== undefined &&
        !(isString(item.language, 64) && ID_SEGMENT.test(item.language))
      ) {
        problems.add(`${path}/language`, "invalid language");
      }
      if (item.bundle !== undefined && !bundles.has(item.bundle as string))
        problems.add(`${path}/bundle`, "names no bundle");
      if (filesOk) {
        const record = item as unknown as Item;
        if (item.contentSha256 !== contentSha256(record.files))
          problems.add(`${path}/contentSha256`, "does not match the files");
        const bundleFiles =
          item.bundle === undefined ? null : (bundles.get(item.bundle as string) ?? null);
        if (item.behaviourSha256 !== behaviourSha256(record, bundleFiles)) {
          problems.add(`${path}/behaviourSha256`, "does not match the item");
        }
      }
    });
  return problems.list;
}

/** The kind fields this implementation builds: present on their own kind, absent elsewhere. */
function checkKindFields(item: Record_, path: string, problems: Problems): void {
  const own = (kind: string, field: string) => {
    if (item.kind !== kind && item[field] !== undefined)
      problems.add(`${path}/${field}`, `only ${kind} items have ${field}`);
    return item.kind === kind;
  };
  if (own("agent", "agent")) {
    const agent = item.agent;
    const ok =
      isRecord(agent) &&
      Object.keys(agent).every((key) =>
        ["prompt", "tools", "model", "color", "background"].includes(key),
      ) &&
      isSafeRelativePath(agent.prompt) &&
      (agent.tools === undefined ||
        (Array.isArray(agent.tools) && agent.tools.every((tool) => isString(tool, 128)))) &&
      (agent.model === undefined || isString(agent.model, 128)) &&
      (agent.color === undefined || isString(agent.color, 128)) &&
      (agent.background === undefined || typeof agent.background === "boolean");
    if (!ok)
      problems.add(
        `${path}/agent`,
        "an agent records { prompt, tools?, model?, color?, background? }",
      );
  }
  if (own("mcp", "server")) {
    const server = item.server;
    if (!isRecord(server) || !isString(server.name, 256) || !isString(server.description, 1024))
      problems.add(`${path}/server`, "an MCP item records its server name and description");
  }
  for (const field of ["event", "matcher", "handler"]) own("hook", field);
  if (item.kind === "hook") {
    if (!isString(item.event, 64) || !/^[a-z]+(?:-[a-z]+)*$/.test(item.event))
      problems.add(`${path}/event`, "a hook records its neutral event");
    if (!isRecord(item.handler) || !isString(item.handler.type, 64))
      problems.add(`${path}/handler`, "a hook records its handler type");
  }
  if (own("document", "purpose") && !isString(item.purpose, 256))
    problems.add(`${path}/purpose`, "a document records its purpose");
}

function checkRequirements(value: unknown, path: string, problems: Problems): void {
  if (
    !isRecord(value) ||
    !isRecord(value.inputs) ||
    !Object.keys(value).every((key) => key === "inputs" || key === "tools")
  ) {
    problems.add(path, "requirements are { inputs, tools? }");
    return;
  }
  for (const [name, input] of Object.entries(value.inputs)) {
    const at = `${path}/inputs/${name}`;
    const ok =
      INPUT_NAME.test(name) &&
      isRecord(input) &&
      Object.keys(input).every((key) =>
        ["description", "isRequired", "isSecret", "default", "placeholder"].includes(key),
      ) &&
      isString(input.description, 1024) &&
      typeof input.isRequired === "boolean" &&
      typeof input.isSecret === "boolean" &&
      (input.default === undefined || typeof input.default === "string") &&
      (input.placeholder === undefined ||
        (isRecord(input.placeholder) &&
          Object.keys(input.placeholder).sort().join() === "marker,sourcePath" &&
          isSafeRelativePath(input.placeholder.sourcePath) &&
          isString(input.placeholder.marker, 128)));
    if (!ok)
      problems.add(at, "an input is { description, isRequired, isSecret, default?, placeholder? }");
    else if (input.isSecret === true && input.default !== undefined)
      problems.add(`${at}/default`, "a secret input never carries a value");
  }
}

function checkEditions(
  value: unknown,
  path: string,
  sourceIds: Set<string>,
  problems: Problems,
): void {
  if (!isRecord(value)) {
    problems.add(path, "editions map client ids to { files, scanKey }");
    return;
  }
  for (const [cli, edition] of Object.entries(value)) {
    const at = `${path}/${cli}`;
    const ok =
      FRAMEWORK_ID.test(cli) &&
      isRecord(edition) &&
      Object.keys(edition).sort().join() === "files,scanKey" &&
      typeof edition.scanKey === "string" &&
      SCAN_KEY.test(edition.scanKey) &&
      Array.isArray(edition.files) &&
      edition.files.length > 0 &&
      edition.files.every(
        (file) =>
          isRecord(file) &&
          sourceIds.has(file.sourceId as string) &&
          isSafeRelativePath(file.sourcePath) &&
          typeof file.sha256 === "string" &&
          SHA256.test(file.sha256) &&
          Number.isSafeInteger(file.bytes) &&
          typeof file.executable === "boolean" &&
          (file.role === "content" || file.role === "behaviour"),
      );
    if (!ok) problems.add(at, "an edition is { files, scanKey } with recorded files");
  }
}
