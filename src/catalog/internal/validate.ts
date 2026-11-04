/**
 * Record-shape checks for content documents and tool profiles. Without source files these
 * check shape and recompute the digests that depend only on the record.
 */
import { formats, kinds, type Problem } from "../contracts.js";
import { behaviourSha256, contentSha256, kindFieldNames } from "./identity.js";
import { FRAMEWORK_ID, ID_SEGMENT, INSTALL_NAME, type Item, SHA256 } from "./model.js";
import { isSafeRelativePath } from "./paths.js";

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

const SCALAR = (value: unknown): boolean =>
  typeof value === "boolean" || typeof value === "number" || isString(value, 256);
const frontmatterOk = (value: unknown): boolean =>
  isRecord(value) &&
  Object.entries(value).every(
    ([key, entry]) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(key) && SCALAR(entry),
  );

function template(value: unknown, folder: boolean): boolean {
  if (!isString(value, 512) || !value.includes("<name>")) return false;
  if (folder !== value.endsWith("/")) return false;
  const filled = value.replaceAll("<name>", "x");
  return isSafeRelativePath(folder ? filled.slice(0, -1) : filled);
}

/** Shape problems of a tool profile; only the sections this implementation reads exist. */
export function profileProblems(value: unknown): Problem[] {
  const problems = new Problems();
  if (!isRecord(value)) return [{ path: "", message: "a tool profile must be an object" }];
  problems.keys(
    value,
    "",
    [
      "schema",
      "id",
      "name",
      "version",
      "checkedWith",
      "places",
      "userOnly",
      "userOnlyFallback",
      "arguments",
      "ruleScopes",
    ],
    ["schema", "id", "name", "version", "checkedWith", "places", "userOnly", "arguments"],
  );
  if (value.schema !== formats.toolProfile)
    problems.add("/schema", `schema must be ${formats.toolProfile}`);
  if (!isString(value.id, 64) || !FRAMEWORK_ID.test(value.id))
    problems.add("/id", "invalid profile id");
  if (!isString(value.name, 200)) problems.add("/name", "name must be 1–200 characters");
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1)
    problems.add("/version", "version must be a positive integer");
  if (
    !Array.isArray(value.checkedWith) ||
    !value.checkedWith.every(
      (entry) =>
        isRecord(entry) &&
        Object.keys(entry).sort().join() === "app,date,version" &&
        isString(entry.app, 64) &&
        isString(entry.version, 64) &&
        typeof entry.date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(entry.date),
    )
  ) {
    problems.add("/checkedWith", "checkedWith lists { app, version, date }");
  }
  const places = value.places;
  if (!isRecord(places)) problems.add("/places", "places must be an object");
  else
    for (const [kind, byScope] of Object.entries(places)) {
      if (!kinds.includes(kind as never)) problems.add(`/places/${kind}`, "unknown kind");
      if (!isRecord(byScope)) {
        problems.add(`/places/${kind}`, "places map scope to a place");
        continue;
      }
      for (const [scope, place] of Object.entries(byScope)) {
        const path = `/places/${kind}/${scope}`;
        if (scope !== "project" && scope !== "user")
          problems.add(path, "scope must be project or user");
        if (kind === "rule") {
          if (
            !isRecord(place) ||
            !Object.entries(place).every(
              ([key, entry]) => key === "always" && template(entry, false),
            )
          ) {
            problems.add(
              path,
              "rule places map a scope name (always) to a file template with <name>",
            );
          }
        } else if (!template(place, true))
          problems.add(path, "a place is a folder template with <name> ending in /");
      }
    }
  if (
    value.userOnly !== "none" &&
    !(
      isRecord(value.userOnly) &&
      Object.keys(value.userOnly).join() === "frontmatter" &&
      frontmatterOk(value.userOnly.frontmatter)
    )
  ) {
    problems.add("/userOnly", "userOnly is none or { frontmatter }");
  }
  if (value.userOnlyFallback !== undefined) {
    const fallback = value.userOnlyFallback;
    if (!isRecord(fallback)) problems.add("/userOnlyFallback", "must be an object");
    else
      for (const [scope, entries] of Object.entries(fallback)) {
        const path = `/userOnlyFallback/${scope}`;
        if (scope !== "project" && scope !== "user")
          problems.add(path, "scope must be project or user");
        const ids = new Set<string>();
        if (
          !Array.isArray(entries) ||
          entries.length === 0 ||
          !entries.every((entry) => {
            if (!isRecord(entry) || !isString(entry.id, 64) || ids.has(entry.id)) return false;
            ids.add(entry.id);
            const allowed = Object.keys(entry).every((key) =>
              ["id", "path", "frontmatter", "arguments"].includes(key),
            );
            return (
              allowed &&
              template(entry.path, false) &&
              (entry.frontmatter === undefined || frontmatterOk(entry.frontmatter)) &&
              (entry.arguments === "kept" || entry.arguments === "reworded")
            );
          })
        ) {
          problems.add(
            path,
            "fallback entries are { id, path, frontmatter?, arguments: kept | reworded }",
          );
        }
      }
  }
  if (value.arguments !== "substituted" && value.arguments !== "chat-text")
    problems.add("/arguments", "arguments is substituted or chat-text");
  if (value.ruleScopes !== undefined) {
    const scopes = value.ruleScopes;
    if (
      !isRecord(scopes) ||
      !Object.entries(scopes).every(
        ([scope, entry]) =>
          scope === "always" &&
          isRecord(entry) &&
          Object.keys(entry).join() === "frontmatter" &&
          frontmatterOk(entry.frontmatter),
      )
    ) {
      problems.add("/ruleScopes", "ruleScopes map a scope name (always) to { frontmatter }");
    }
  }
  return problems.list;
}
