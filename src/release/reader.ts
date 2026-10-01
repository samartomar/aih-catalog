/**
 * Portable Catalog release reader: `@aihq/catalog/reader`.
 *
 * Reads caller-supplied release bytes into an immutable checked view. No Node
 * built-ins, filesystem, network, package installation or code execution.
 */
import {
  ARCHIVE_PACKAGE_PREFIX,
  type CatalogDiagnostic,
  type CatalogItem,
  type CatalogRelease,
  type ConfigureItemRequest,
  type ConfigureItemResult,
  type DependencyRef,
  type GetItemResult,
  type InputOrigin,
  type ItemDependencies,
  type Json,
  type MaterialMember,
  type MaterialSource,
  RELEASE_MAX_BYTES,
  RELEASE_MAX_DEPTH,
  RELEASE_SCHEMA_ID,
  type ReadReleaseResult,
  type SelectionRequest,
  type SelectionSetResult,
  type ValidateSelectionSetRequest,
} from "./contracts.js";
import {
  checkMaterialSource,
  checkReleaseDocument,
  Diagnostics,
  ID,
  isRecord,
  SHA256,
} from "./document.js";
import { inputAccepts } from "./inputs.js";
import { deepFreeze, JsonAdmissionError, readCanonicalBytes } from "./json.js";
import { sha256Hex } from "./sha256.js";

/** Views this reader produced. Other operations accept nothing else. */
const checkedReleases = new WeakSet<object>();

function invalid(reason: string, message: string, path?: string): CatalogDiagnostic {
  return Object.freeze({
    code: "INPUT_INVALID",
    reason,
    message,
    blocking: true,
    ...(path === undefined ? {} : { path }),
  });
}

const refused = (...diagnostics: CatalogDiagnostic[]): ReadReleaseResult =>
  Object.freeze({ valid: false, diagnostics: Object.freeze(diagnostics) });

export function readRelease(
  bytes: Uint8Array,
  options: { readonly expectedSha256: string },
): ReadReleaseResult {
  const expected = (options as { expectedSha256?: unknown } | undefined)?.expectedSha256;
  if (typeof expected !== "string" || !SHA256.test(expected)) {
    return refused(
      invalid(
        "expected-sha256-required",
        "A release is read only against the caller's expected lowercase SHA-256.",
      ),
    );
  }
  if (!(bytes instanceof Uint8Array)) {
    return refused(invalid("malformed-bytes", "Release bytes must be a Uint8Array."));
  }
  if (bytes.byteLength > RELEASE_MAX_BYTES) {
    return refused(invalid("byte-limit", "The release exceeds its 16 MiB byte ceiling."));
  }
  const actual = sha256Hex(bytes);
  if (actual !== expected) {
    return refused(
      invalid("release-integrity-mismatch", "The release bytes do not match the expected SHA-256."),
    );
  }
  let value: unknown;
  try {
    value = readCanonicalBytes(bytes, { maxBytes: RELEASE_MAX_BYTES, maxDepth: RELEASE_MAX_DEPTH });
  } catch (error) {
    if (!(error instanceof JsonAdmissionError)) throw error;
    return refused(invalid(error.reason, "The release is not bounded canonical JSON with one LF."));
  }
  const checked = checkReleaseDocument(value);
  if (checked.document === undefined) return refused(...checked.diagnostics);
  const release = deepFreeze({
    schema: RELEASE_SCHEMA_ID,
    sha256: actual,
    byteLength: bytes.byteLength,
    ...checked.document,
  }) as unknown as CatalogRelease;
  checkedReleases.add(release);
  return Object.freeze({ valid: true, release, diagnostics: Object.freeze([]) as readonly [] });
}

export const isCheckedRelease = (value: unknown): value is CatalogRelease =>
  typeof value === "object" && value !== null && checkedReleases.has(value);

function requireChecked(release: CatalogRelease): void {
  if (!isCheckedRelease(release)) {
    throw new TypeError("Expected a release view returned by readRelease.");
  }
}

/** Every item with its computed identity, in release order. */
export function listItems(release: CatalogRelease): readonly CatalogItem[] {
  requireChecked(release);
  return release.items;
}

const itemNotFound = (itemId: unknown, extra: Partial<CatalogDiagnostic> = {}): CatalogDiagnostic =>
  Object.freeze({
    code: "INPUT_INVALID",
    reason: "item-not-found",
    message: "The release has no item with this ID.",
    blocking: true,
    itemId: typeof itemId === "string" ? itemId.slice(0, 128) : String(itemId),
    ...extra,
  });

export function getItem(release: CatalogRelease, itemId: string): GetItemResult {
  requireChecked(release);
  const item = release.items.find((candidate) => candidate.id === itemId);
  if (item !== undefined) return Object.freeze({ found: true, item });
  return Object.freeze({ found: false, diagnostics: Object.freeze([itemNotFound(itemId)]) });
}

type Origins = Record<string, { readonly origin: InputOrigin; readonly required: boolean }>;

/**
 * Validates ordinary configuration against an item's InputSpec mirror. Returns a
 * copy of exactly the supplied values (no defaults inserted) and each input's
 * value origin. Sensitive values are refused here; they belong to Core host controls.
 */
export function checkConfiguration(
  item: CatalogItem,
  configuration: unknown,
  diagnostics: CatalogDiagnostic[],
  context: { readonly path: string; readonly selectionId?: string },
): { configuration: Record<string, Json>; inputs: Origins } | undefined {
  const start = diagnostics.length;
  const report = (reason: string, path: string, message: string) =>
    diagnostics.push(
      Object.freeze({
        code: "INPUT_INVALID",
        reason,
        message,
        blocking: true,
        path,
        itemId: item.id,
        ...(context.selectionId === undefined ? {} : { selectionId: context.selectionId }),
      }),
    );
  const prototype = isRecord(configuration) ? Object.getPrototypeOf(configuration) : undefined;
  if (!isRecord(configuration) || (prototype !== Object.prototype && prototype !== null)) {
    report(
      "configuration-invalid",
      context.path,
      "Configuration is a plain object of input values.",
    );
    return undefined;
  }
  const copy: Record<string, Json> = {};
  for (const key of Reflect.ownKeys(configuration)) {
    const descriptor = Object.getOwnPropertyDescriptor(configuration, key);
    const at = `${context.path}/${String(key)}`;
    if (typeof key !== "string" || descriptor === undefined || !("value" in descriptor)) {
      report("configuration-invalid", at, "Configuration values are own data properties.");
      continue;
    }
    const spec = Object.hasOwn(item.inputs, key) ? item.inputs[key] : undefined;
    if (spec === undefined)
      report("input-unknown", at, "The item declares no input with this name.");
    else if (spec.sensitive === true) {
      report("input-sensitive", at, "Sensitive inputs arrive only through host controls.");
    } else if (!inputAccepts(spec, descriptor.value)) {
      report("input-value", at, "The value does not satisfy the declared input.");
    } else copy[key] = descriptor.value;
  }
  const inputs: Origins = {};
  for (const [name, spec] of Object.entries(item.inputs)) {
    let origin: InputOrigin;
    if (spec.sensitive === true) origin = "host";
    else if (Object.hasOwn(copy, name)) origin = "explicit";
    else if (spec.default !== undefined) origin = "default";
    else {
      origin = "omitted";
      if (spec.required && !Object.hasOwn(configuration, name)) {
        report(
          "input-required",
          `${context.path}/${name}`,
          "Required input has no value or default.",
        );
      }
    }
    inputs[name] = Object.freeze({ origin, required: spec.required });
  }
  return diagnostics.length === start ? { configuration: copy, inputs } : undefined;
}

interface ResolvedSelection {
  readonly index: number;
  readonly request: SelectionRequest;
  readonly release: CatalogRelease;
  readonly item: CatalogItem;
}

const identityKey = (releaseSha256: string, itemId: string, itemSha256: string) =>
  `${releaseSha256}\u0000${itemId}\u0000${itemSha256}`;

/**
 * Read-only check of an explicit selection set. Never fetches, selects,
 * configures or reorders anything; a valid set yields each selection's exact
 * required selection IDs for the caller to copy into its policy.
 */
export function validateSelectionSet(request: ValidateSelectionSetRequest): SelectionSetResult {
  const diagnostics: CatalogDiagnostic[] = [];
  const report = (reason: string, message: string, extra: Partial<CatalogDiagnostic> = {}) =>
    diagnostics.push(
      Object.freeze({ code: "INPUT_INVALID", reason, message, blocking: true, ...extra }),
    );
  const releases = new Map<string, CatalogRelease>();
  const supplied = (request as { releases?: unknown } | undefined)?.releases;
  if (!isRecord(supplied))
    report("releases-invalid", "Expected releases keyed by manifest SHA-256.");
  else {
    for (const [key, release] of Object.entries(supplied)) {
      if (!isCheckedRelease(release)) {
        report("release-unchecked", "Expected a release view returned by readRelease.", {
          path: `/releases/${key}`,
        });
      } else if (release.sha256 !== key) {
        report("release-key-mismatch", "A release is keyed by its own manifest SHA-256.", {
          path: `/releases/${key}`,
        });
      } else releases.set(key, release);
    }
  }
  const selections = (request as { selections?: unknown } | undefined)?.selections;
  if (!Array.isArray(selections)) {
    report("selections-invalid", "Expected an array of selections.");
    return finish(diagnostics);
  }
  const ids = new Set<string>();
  const resolved: ResolvedSelection[] = [];
  selections.forEach((selection: SelectionRequest, index) => {
    const path = `/selections/${index}`;
    const selectionId =
      isRecord(selection) && typeof selection.id === "string" ? selection.id : undefined;
    if (selectionId === undefined || selectionId.length > 128 || !ID.test(selectionId)) {
      report("invalid-selection-id", "Selection IDs are policy selection identifiers.", {
        path: `${path}/id`,
      });
      return;
    }
    if (ids.has(selectionId)) {
      report("duplicate-selection-id", "Selection IDs are unique.", {
        path: `${path}/id`,
        selectionId,
      });
      return;
    }
    ids.add(selectionId);
    const target: Record<string, unknown> = isRecord(selection.item) ? selection.item : {};
    const release =
      typeof target.releaseSha256 === "string" ? releases.get(target.releaseSha256) : undefined;
    if (release === undefined) {
      report("release-missing", "The selected release was not supplied.", {
        path: `${path}/item/releaseSha256`,
        selectionId,
      });
      return;
    }
    const item = release.items.find((candidate) => candidate.id === target.itemId);
    if (item === undefined) {
      diagnostics.push(itemNotFound(target.itemId, { path: `${path}/item/itemId`, selectionId }));
      return;
    }
    if (item.itemSha256 !== target.itemSha256) {
      report(
        "item-sha256-mismatch",
        "The selected item identity differs from this release's item.",
        {
          path: `${path}/item/itemSha256`,
          selectionId,
          itemId: item.id,
        },
      );
      return;
    }
    checkConfiguration(item, selection.configuration, diagnostics, {
      path: `${path}/configuration`,
      selectionId,
    });
    resolved.push({ index, request: selection, release, item });
  });

  const byIdentity = new Map<string, string[]>();
  for (const entry of resolved) {
    const key = identityKey(entry.release.sha256, entry.item.id, entry.item.itemSha256);
    byIdentity.set(key, [...(byIdentity.get(key) ?? []), entry.request.id]);
  }
  /** The exact identity a reference names, relative to the declaring release. */
  const target = (from: ResolvedSelection, ref: DependencyRef, at: string, required = true) => {
    if (!("release" in ref)) {
      const item = from.release.items.find((candidate) => candidate.id === ref.itemId);
      return item === undefined
        ? undefined
        : identityKey(from.release.sha256, item.id, item.itemSha256);
    }
    const release = releases.get(ref.release.manifest.sha256);
    const context: Partial<CatalogDiagnostic> = {
      path: at,
      selectionId: from.request.id,
      itemId: ref.itemId,
      blocking: required,
      code: required ? "INPUT_INVALID" : "SUGGESTION",
    };
    if (release === undefined) {
      report("dependency-release-missing", "The referenced release was not supplied.", context);
      return undefined;
    }
    const item = release.items.find((candidate) => candidate.id === ref.itemId);
    if (item === undefined || item.itemSha256 !== ref.itemSha256) {
      report(
        "dependency-unresolved",
        "The referenced item identity is not in the supplied release.",
        context,
      );
      return undefined;
    }
    return identityKey(release.sha256, item.id, item.itemSha256);
  };

  const requires: Record<string, string[]> = {};
  for (const entry of resolved) {
    const base = `/selections/${entry.index}`;
    const selectionId = entry.request.id;
    requires[selectionId] = [];
    entry.item.dependencies.requires.forEach((ref, index) => {
      const key = target(entry, ref, `${base}/requires/${index}`);
      if (key === undefined) return;
      const matches = byIdentity.get(key) ?? [];
      if (matches.length === 0) {
        report("dependency-missing", "A required item is not selected.", {
          path: base,
          selectionId,
          itemId: ref.itemId,
        });
      } else if (matches.length > 1) {
        report("dependency-ambiguous", "More than one selection matches a required item.", {
          path: base,
          selectionId,
          itemId: ref.itemId,
        });
      } else (requires[selectionId] as string[]).push(matches[0] as string);
    });
    entry.item.dependencies.conflicts.forEach((ref, index) => {
      const key = target(entry, ref, `${base}/conflicts/${index}`, false);
      if (key !== undefined && (byIdentity.get(key) ?? []).length > 0) {
        report("conflict-selected", "A conflicting item is also selected.", {
          path: base,
          selectionId,
          itemId: ref.itemId,
        });
      }
    });
    entry.item.dependencies.optional.forEach((ref, index) => {
      const key = target(entry, ref, `${base}/optional/${index}`, false);
      if (key !== undefined && (byIdentity.get(key) ?? []).length === 0) {
        diagnostics.push(
          Object.freeze({
            code: "SUGGESTION",
            reason: "optional-unselected",
            message: "An optional item is suggested but not selected; nothing was selected for it.",
            blocking: false,
            path: base,
            selectionId,
            itemId: ref.itemId,
          }),
        );
      }
    });
  }
  for (const id of Object.keys(requires)) requires[id] = [...new Set(requires[id])];
  if (findCycle(requires)) {
    report("dependency-cycle", "Required selections form a cycle.");
  }
  return finish(diagnostics, requires);
}

function findCycle(edges: Readonly<Record<string, readonly string[]>>): boolean {
  const state = new Map<string, 1 | 2>();
  for (const start of Object.keys(edges)) {
    if (state.has(start)) continue;
    const stack: [string, number][] = [[start, 0]];
    state.set(start, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as [string, number];
      const next = (edges[frame[0]] ?? [])[frame[1]++];
      if (next === undefined) {
        state.set(frame[0], 2);
        stack.pop();
      } else if (state.get(next) === 1) return true;
      else if (!state.has(next)) {
        state.set(next, 1);
        stack.push([next, 0]);
      }
    }
  }
  return false;
}

function finish(
  diagnostics: readonly CatalogDiagnostic[],
  requires?: Record<string, string[]>,
): SelectionSetResult {
  const valid = requires !== undefined && diagnostics.every((d) => !d.blocking);
  return deepFreeze({
    valid,
    ...(valid ? { requiresBySelectionId: requires } : {}),
    diagnostics: [...diagnostics],
  });
}

const toMember = (prefix: string, member: MaterialMember): MaterialMember =>
  Object.freeze({
    id: member.id,
    path: `${prefix}${member.path}`,
    sha256: member.sha256,
    byteLength: member.byteLength,
  });

export function configureItem(request: ConfigureItemRequest): ConfigureItemResult {
  const empty = Object.freeze({ requires: [], optional: [], conflicts: [] });
  const fail = (
    diagnostics: readonly CatalogDiagnostic[],
    dependencies: ItemDependencies = empty,
  ) => Object.freeze({ valid: false, dependencies, diagnostics: Object.freeze([...diagnostics]) });
  const { release, itemId, configuration, materialSource } = (request ??
    {}) as ConfigureItemRequest;
  if (!isCheckedRelease(release)) {
    return fail([
      Object.freeze({
        code: "INPUT_INVALID",
        reason: "release-unchecked",
        message: "Expected a release view returned by readRelease.",
        blocking: true,
      }),
    ]);
  }
  const item = release.items.find((candidate) => candidate.id === itemId);
  if (item === undefined) return fail([itemNotFound(itemId)]);
  const sourceCheck = new Diagnostics();
  checkMaterialSource(sourceCheck, materialSource, "/materialSource");
  const diagnostics: CatalogDiagnostic[] = sourceCheck.list.map((d) =>
    Object.freeze({ ...d, itemId: item.id }),
  );
  const checkedConfiguration = checkConfiguration(item, configuration, diagnostics, {
    path: "/configuration",
  });
  if (checkedConfiguration === undefined || diagnostics.length > 0) {
    return fail(diagnostics, item.dependencies);
  }
  const source: MaterialSource = Object.freeze(
    materialSource.kind === "archive"
      ? {
          kind: "archive",
          url: materialSource.url,
          sha256: materialSource.sha256,
          byteLength: materialSource.byteLength,
        }
      : { kind: "local", input: materialSource.input },
  );
  const prefix = source.kind === "archive" ? ARCHIVE_PACKAGE_PREFIX : "";
  return deepFreeze({
    valid: true,
    selection: {
      recipe: {
        reference: {
          source,
          path: `${prefix}${item.recipe.path}`,
          sha256: item.recipe.sha256,
          byteLength: item.recipe.byteLength,
          materials: item.materials.map((member) => toMember(prefix, member)),
        },
      },
      configuration: checkedConfiguration.configuration,
    },
    inputs: checkedConfiguration.inputs,
    provenance: {
      package: { name: release.package.name, version: release.package.version },
      manifestSha256: release.sha256,
      itemId: item.id,
      itemSha256: item.itemSha256,
    },
    dependencies: item.dependencies,
    diagnostics: [],
  });
}
