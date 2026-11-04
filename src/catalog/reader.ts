/**
 * `@aihq/catalog/reader` (new model, browser-safe): reading content documents and tool
 * profiles, item lookup, availability, planning and the recorded renders.
 */
import {
  formats,
  type Invalid,
  limits,
  type Refused,
  type UnsupportedVersion,
} from "./contracts.js";
import { deepFreeze, JsonAdmissionError, readCanonicalDocument } from "./internal/json.js";
import type { Content, Item } from "./internal/model.js";
import { quote, refused } from "./internal/paths.js";
import { type PlanStep, planInstall as plan } from "./internal/plan.js";
import {
  changesBytes,
  renderBytes,
  renderEdit,
  renderNames,
  type ToolProfile,
} from "./internal/render.js";
import { sha256Hex } from "./internal/sha256.js";
import { contentProblems, profileProblems } from "./internal/validate.js";

export type {
  Content,
  ContentSource,
  Item,
  ItemFile,
  Notice,
  RuleScope,
} from "./internal/model.js";
export type {
  Plan,
  PlanOptions,
  PlanResult,
  PlanStep,
  Unavailable,
  WriteStep,
} from "./internal/plan.js";
export type { ToolProfile } from "./internal/render.js";

export type ReadContentResult =
  | { readonly status: "ok"; readonly content: Content }
  | Invalid
  | UnsupportedVersion;
export type ReadToolProfileResult =
  | { readonly status: "ok"; readonly profile: ToolProfile }
  | Invalid
  | UnsupportedVersion;

function readDocument(
  bytes: Uint8Array,
  maxBytes: number,
  family: string,
  current: string,
  problemsOf: (value: unknown) => readonly { path: string; message: string }[],
): { status: "ok"; value: unknown } | Invalid | UnsupportedVersion {
  let value: unknown;
  try {
    value = readCanonicalDocument(bytes, { maxBytes, maxDepth: limits.documentDepth });
  } catch (error) {
    const reason = error instanceof JsonAdmissionError ? error.reason : "malformed-json";
    return {
      status: "invalid",
      problems: [{ path: "", message: `the document is not canonical JSON (${reason})` }],
    };
  }
  const schema = (value as { schema?: unknown } | null)?.schema;
  if (typeof schema === "string" && schema.startsWith(family) && schema !== current) {
    return { status: "unsupported-version", schema };
  }
  const problems = problemsOf(value);
  if (problems.length > 0) return { status: "invalid", problems };
  return { status: "ok", value: deepFreeze(value) };
}

/**
 * Reads a content document: canonical JSON (sorted keys, two-space indent, final LF) within
 * the content-file limit, with its record shape and record-derived digests checked.
 */
export function readContent(bytes: Uint8Array): ReadContentResult {
  const result = readDocument(
    bytes,
    limits.contentFileBytes,
    "urn:aihq:catalog:content:",
    formats.content,
    contentProblems,
  );
  return result.status === "ok" ? { status: "ok", content: result.value as Content } : result;
}

/** Reads a tool profile document (pure data) in the same canonical form. */
export function readToolProfile(bytes: Uint8Array): ReadToolProfileResult {
  const result = readDocument(
    bytes,
    limits.toolProfileBytes,
    "urn:aihq:catalog:tool-profile:",
    formats.toolProfile,
    profileProblems,
  );
  return result.status === "ok" ? { status: "ok", profile: result.value as ToolProfile } : result;
}

export type Availability = {
  readonly available: boolean;
  readonly how: "edition" | "rendered" | "none";
  readonly reason?: string;
};

/** Whether an item can be placed for a profile at project scope, and how. */
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
  return blocked
    ? { available: false, how: "none", reason: blocked.reason }
    : { available: true, how: "rendered" };
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

/** The items of a content document, optionally of one kind or placeable for one profile. */
export function listItems(
  content: Content,
  options: { readonly kind?: string; readonly cli?: ToolProfile } = {},
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

/** `planInstall(selection, contents, profiles, { scope, data, copy?, names?})`. */
export const planInstall = plan;

export type RenderStepResult =
  | { readonly status: "ok"; readonly bytes: Uint8Array; readonly sha256: string }
  | Refused
  | Invalid;

/**
 * The bytes of one `write` step that has a `render`, from the supplied source file.
 * Refuses `source-mismatch` when the file's sha256 differs from the step's and
 * `profile-mismatch` when the supplied profile's version differs from the recorded one.
 */
export function renderStep(
  step: PlanStep,
  contents: readonly Content[],
  profiles: readonly ToolProfile[],
  files: readonly {
    readonly sourceId?: string;
    readonly sourcePath: string;
    readonly bytes: Uint8Array;
  }[],
): RenderStepResult {
  const render = step?.render;
  const from = step?.from;
  if (
    step?.op !== "write" ||
    render === undefined ||
    from === undefined ||
    typeof from.item !== "string"
  ) {
    return {
      status: "invalid",
      problems: [{ path: "step", message: "renderStep takes a write step with a render" }],
    };
  }
  if (!renderNames.includes(render.name)) {
    return {
      status: "invalid",
      problems: [{ path: "step/render/name", message: "unknown render" }],
    };
  }
  const profile = profiles.find((candidate) => candidate.id === render.profile);
  if (profile === undefined)
    return refused("profile-mismatch", `no profile ${quote(render.profile)} was supplied`);
  if (profile.version !== render.version) {
    return refused(
      "profile-mismatch",
      `the step was planned with ${render.profile} version ${render.version}, not version ${profile.version}`,
    );
  }
  const item = contents
    .flatMap((content) => content.items)
    .find((candidate) => candidate.id === from.item);
  if (item === undefined)
    return refused("unknown-item", `the item ${quote(from.item)} is not in the supplied content`);
  const record = item.files.find(
    (file) => file.sourceId === from.sourceId && file.sourcePath === from.sourcePath,
  );
  if (record === undefined || record.sha256 !== from.sha256) {
    return refused(
      "source-mismatch",
      `the content does not record ${quote(from.sourcePath)} with the step's sha256`,
    );
  }
  const supplied = files.find(
    (file) =>
      file.sourcePath === from.sourcePath &&
      (file.sourceId === undefined || file.sourceId === from.sourceId),
  );
  if (supplied === undefined || !(supplied.bytes instanceof Uint8Array)) {
    return {
      status: "invalid",
      problems: [{ path: "files", message: `the source file ${from.sourcePath} was not supplied` }],
    };
  }
  if (sha256Hex(supplied.bytes) !== from.sha256) {
    return refused(
      "source-mismatch",
      `the supplied ${quote(from.sourcePath)} differs from the bytes the plan recorded`,
    );
  }
  const edit = renderEdit(render.name, render.entry, item, profile, step.root);
  if ("reason" in edit || !changesBytes(edit)) {
    return {
      status: "invalid",
      problems: [
        {
          path: "step/render",
          message: "reason" in edit ? edit.reason : "the render changes nothing",
        },
      ],
    };
  }
  const result = renderBytes(edit, supplied.bytes);
  if ("reason" in result)
    return { status: "invalid", problems: [{ path: from.sourcePath, message: result.reason }] };
  return { status: "ok", bytes: result.bytes, sha256: sha256Hex(result.bytes) };
}
