/** Portable, effect-free required closure over actual checked reader handles. */

import { copyJson, dataRecord, exactFields, pointer } from "./boundary.js";
import type {
  CatalogDiagnostic,
  CatalogItem,
  CatalogRelease,
  DependencyRef,
  Diagnostic,
  Inclusion,
  InclusionOrigin,
  ReleaseSet,
  RemovalImpact,
  ResolveSelectionsRequest,
  ResolveSelectionsResult,
  SelectionRef,
  SelectionRequest,
  SelectionRoot,
  SetMember,
  SetRef,
  SetSelection,
} from "./contracts.js";
import { SET_MAX_DEPTH, SET_MAX_MEMBERS } from "./contracts.js";
import { ID, isId, SHA256 } from "./document.js";
import { canonicalJson, deepFreeze } from "./json.js";
import { isCheckedRelease, validateSelectionSet } from "./reader.js";
import { memberKey } from "./sets.js";
import { sha256Hex } from "./sha256.js";

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const key = (ref: SelectionRef) => `${ref.releaseSha256}\u0000${ref.itemId}\u0000${ref.scope}`;
const order = (a: SelectionRef, b: SelectionRef) => compare(key(a), key(b));
const reference = (root: SelectionRef): SelectionRef => ({
  releaseSha256: root.releaseSha256,
  itemId: root.itemId,
  scope: root.scope,
});
const uniqueRefs = (refs: readonly SelectionRef[]) =>
  [...new Map(refs.map((ref) => [key(ref), reference(ref)])).values()].sort(order);
const pathKey = (path: readonly SelectionRef[]) => path.map(key).join("\u0001");

const stableInclusions = (inclusions: readonly Inclusion[]): Inclusion[] =>
  [
    ...new Map(
      inclusions.map((inclusion) => [
        `${key(inclusion.item)}\u0001${key(inclusion.root)}\u0001${pathKey(inclusion.path)}`,
        inclusion,
      ]),
    ).values(),
  ].sort(
    (a, b) =>
      order(a.item, b.item) || order(a.root, b.root) || compare(pathKey(a.path), pathKey(b.path)),
  );

export function resolveSelections(request: ResolveSelectionsRequest): ResolveSelectionsResult {
  const diagnostics: Diagnostic[] = [];
  const inclusions: Inclusion[] = [];
  const optional: { from: SelectionRef; to: SelectionRef; skipped: boolean }[] = [];
  const impact: RemovalImpact[] = [];
  const report = (
    code: string,
    path: string,
    message: string,
    details?: readonly CatalogDiagnostic[],
    subject?: { reference: SelectionRef & { itemSha256?: string }; declaredBy?: SelectionRef },
    reason?: string,
  ) => {
    diagnostics.push({
      code,
      path,
      message,
      ...(reason ? { reason } : {}),
      ...(details ? { details: { owner: "catalog" as const, diagnostics: details } } : {}),
      // Copies, so a frozen result never aliases walk state or request data.
      ...(subject
        ? {
            reference: {
              ...reference(subject.reference),
              ...(subject.reference.itemSha256 ? { itemSha256: subject.reference.itemSha256 } : {}),
            },
          }
        : {}),
      ...(subject?.declaredBy ? { declaredBy: reference(subject.declaredBy) } : {}),
    });
  };
  const unavailable = (diagnostic: Diagnostic) =>
    diagnostic.code === "RELEASE_UNAVAILABLE" || diagnostic.code === "ITEM_UNAVAILABLE";
  const refuse = (walkComplete = false): ResolveSelectionsResult =>
    deepFreeze({
      status: "refused",
      diagnostics,
      removalImpact: impact,
      ...(walkComplete && diagnostics.some(unavailable)
        ? { partial: { status: "partial" as const, inclusions: stableInclusions(inclusions) } }
        : {}),
    });
  let supplied: Record<string, unknown>;
  let roots: SelectionRoot[];
  let skips: SelectionRef[];
  let remove: SelectionRef[];
  let chosen: SetSelection[];
  try {
    const top = dataRecord(request);
    if (!exactFields(top, ["releases", "roots", "skips"], ["remove", "sets"]))
      throw new TypeError("Request fields");
    supplied = dataRecord(top.releases);
    roots = copyJson(top.roots) as SelectionRoot[];
    skips = copyJson(top.skips) as SelectionRef[];
    remove = top.remove === undefined ? [] : (copyJson(top.remove) as SelectionRef[]);
    chosen = top.sets === undefined ? [] : (copyJson(top.sets) as SetSelection[]);
    if (![roots, skips, remove, chosen].every(Array.isArray))
      throw new TypeError("Expected arrays");
  } catch {
    report("INPUT_INVALID", "", "Expected bounded plain request data and checked releases.");
    return refuse();
  }
  const releases = new Map<string, CatalogRelease>();
  for (const [digest, release] of Object.entries(supplied).sort(([a], [b]) => compare(a, b))) {
    if (!isCheckedRelease(release) || release.sha256 !== digest) {
      const checked = validateSelectionSet({
        releases: { [digest]: release as CatalogRelease },
        selections: [],
      });
      report(
        "INPUT_INVALID",
        `/releases/${pointer(digest)}`,
        "Release must be an actual reader handle keyed by its digest.",
        checked.diagnostics,
      );
    } else releases.set(digest, release);
  }
  const itemAt = (
    ref: SelectionRef,
    at: string,
    declaredBy?: SelectionRef,
    itemSha256?: string,
  ): CatalogItem | undefined => {
    const unresolved = {
      reference: { ...reference(ref), ...(itemSha256 ? { itemSha256 } : {}) },
      ...(declaredBy ? { declaredBy } : {}),
    };
    const release = releases.get(ref.releaseSha256);
    if (!release) {
      report(
        "RELEASE_UNAVAILABLE",
        at,
        "Referenced release was not supplied.",
        undefined,
        unresolved,
      );
      return;
    }
    const item = release.items.find((item) => item.id === ref.itemId);
    if (!item) {
      report(
        "ITEM_UNAVAILABLE",
        at,
        "Referenced item is absent from the supplied release.",
        undefined,
        unresolved,
      );
      return;
    }
    if (!item.scopes.includes(ref.scope)) {
      report("INPUT_INVALID", `${at}/scope`, "Item does not admit this scope.");
      return;
    }
    return item;
  };
  const checkRefs = (refs: readonly SelectionRef[], name: string, configured: boolean) => {
    refs.forEach((ref, index) => {
      const at = `/${name}/${index}`;
      if (
        !exactFields(ref, [
          "releaseSha256",
          "itemId",
          "scope",
          ...(configured ? ["configuration"] : []),
        ]) ||
        typeof ref.releaseSha256 !== "string" ||
        !SHA256.test(ref.releaseSha256) ||
        typeof ref.itemId !== "string" ||
        ref.itemId.length > 128 ||
        !ID.test(ref.itemId) ||
        (ref.scope !== "project" && ref.scope !== "user") ||
        (configured && !exactFields(ref.configuration, [], Object.keys(ref.configuration ?? {})))
      ) {
        report(
          "INPUT_INVALID",
          at,
          "Expected an exact item/scope reference and ordinary root configuration.",
        );
      } else itemAt(ref, at);
    });
  };
  checkRefs(roots, "roots", true);
  checkRefs(skips, "skips", false);
  checkRefs(remove, "remove", false);
  if (diagnostics.some((diagnostic) => !unavailable(diagnostic))) return refuse();
  const expansion = expandSets(chosen, releases, report, itemAt);
  if (expansion === undefined) return refuse();

  const configurations = new Map<string, SelectionRoot["configuration"]>();
  roots.forEach((root, index) => {
    const prior = configurations.get(key(root));
    if (prior && canonicalJson(prior) !== canonicalJson(root.configuration))
      report(
        "CONFIGURATION_CONFLICT",
        `/roots/${index}/configuration`,
        "One exact item/scope has contradictory root configurations.",
      );
    else configurations.set(key(root), root.configuration);
  });
  const skipped = new Set([...skips.map(key), ...expansion.excluded.keys()]);
  // Exclusions apply after expansion: a skipped member leaves every set at once.
  let excludedRequired = false;
  for (const [index, skip] of skips.entries()) {
    if (!expansion.taken.delete(key(skip)) || !expansion.required.has(key(skip))) continue;
    excludedRequired = true;
    report(
      "REQUIRED_EXCLUDED",
      `/skips/${index}`,
      "A request excludes a member its set requires.",
      undefined,
      { reference: skip },
      "required-excluded",
    );
  }
  if (excludedRequired) return refuse();
  const selected = new Map<string, SelectionRef>();
  const resolveRef = (
    from: SelectionRef,
    dependency: DependencyRef,
    at: string,
  ): SelectionRef | undefined => {
    const digest =
      "release" in dependency ? dependency.release.manifest.sha256 : from.releaseSha256;
    const target = { releaseSha256: digest, itemId: dependency.itemId, scope: from.scope };
    const item = itemAt(
      target,
      at,
      from,
      "itemSha256" in dependency ? dependency.itemSha256 : undefined,
    );
    if (!item) return;
    if (
      "release" in dependency &&
      (item.itemSha256 !== dependency.itemSha256 ||
        (dependency.contentSha256 !== undefined &&
          item.contentSha256 !== dependency.contentSha256) ||
        (dependency.behaviourSha256 !== undefined &&
          item.behaviourSha256 !== dependency.behaviourSha256) ||
        releases.get(digest)?.byteLength !== dependency.release.manifest.byteLength)
    ) {
      report(
        "REFERENCE_AMBIGUOUS",
        at,
        "The supplied release/item does not match the exact referenced identities.",
      );
      return;
    }
    return target;
  };
  const sortedRoots = uniqueRefs([
    ...roots,
    ...[...expansion.taken.values()].map((entry) => entry.ref),
  ]).filter((ref) => releases.get(ref.releaseSha256)?.items.some((item) => item.id === ref.itemId));
  // Each path is walked independently: shared dependencies retain all explanations.
  for (const root of sortedRoots) {
    const pending: SelectionRef[][] = [[root]];
    while (pending.length) {
      const path = pending.pop() as SelectionRef[];
      const current = path[path.length - 1] as SelectionRef;
      const currentKey = key(current);
      if (path.slice(0, -1).some((ref) => key(ref) === currentKey)) {
        report("REQUIRED_CYCLE", "/roots", "Required items form a cycle.");
        continue;
      }
      if (inclusions.length >= 65_536) {
        report(
          "INPUT_INVALID",
          "/roots",
          "Required explanation paths exceed the 65,536 path bound.",
        );
        return refuse();
      }
      selected.set(currentKey, current);
      inclusions.push({ item: current, root, path });
      if (skipped.has(currentKey)) {
        // Requests with sets name the excluded item and its requirer; legacy ones are unchanged.
        const declaredBy = path.length > 1 ? path[path.length - 2] : undefined;
        if (chosen.length)
          report(
            "REQUIRED_EXCLUDED",
            "/skips",
            "A request excludes an item a selection requires.",
            undefined,
            { reference: current, ...(declaredBy ? { declaredBy } : {}) },
            "required-excluded",
          );
        else report("REQUIRED_ITEM_SKIPPED", "/skips", "A skip suppresses a required selection.");
      }
      const item = itemAt(current, "/roots");
      if (!item) continue;
      const itemIndex = releases.get(current.releaseSha256)?.items.indexOf(item);
      const base = `/releases/${current.releaseSha256}/items/${itemIndex}/dependencies`;
      const required = item.dependencies.requires
        .map((ref, index) => resolveRef(current, ref, `${base}/requires/${index}`))
        .filter((ref): ref is SelectionRef => ref !== undefined);
      for (const next of uniqueRefs(required).reverse()) pending.push([...path, next]);
      item.dependencies.optional.forEach((ref, index) => {
        const target = resolveRef(current, ref, `${base}/optional/${index}`);
        if (target) optional.push({ from: current, to: target, skipped: skipped.has(key(target)) });
      });
    }
  }
  for (const current of [...selected.values()].sort(order)) {
    const item = itemAt(current, "/roots");
    item?.dependencies.conflicts.forEach((ref, index) => {
      const at = `/releases/${current.releaseSha256}/items/${releases.get(current.releaseSha256)?.items.indexOf(item)}/dependencies/conflicts/${index}`;
      const target = resolveRef(current, ref, at);
      if (target && selected.has(key(target)))
        report("ITEM_CONFLICT", at, "Conflicting items are selected together.", undefined, {
          reference: target,
          declaredBy: current,
        });
    });
  }
  for (const proposed of uniqueRefs(remove)) {
    const affectedRoots = uniqueRefs(
      inclusions
        .filter((inclusion) => inclusion.path.some((ref) => key(ref) === key(proposed)))
        .map((inclusion) => inclusion.root),
    );
    const affected = new Set(affectedRoots.map(key));
    const retained = new Set(
      inclusions
        .filter((inclusion) => !affected.has(key(inclusion.root)))
        .map((inclusion) => key(inclusion.item)),
    );
    const orphaned = uniqueRefs(
      inclusions
        .filter(
          (inclusion) =>
            affected.has(key(inclusion.root)) &&
            !retained.has(key(inclusion.item)) &&
            !configurations.has(key(inclusion.item)) &&
            key(inclusion.item) !== key(proposed),
        )
        .map((inclusion) => inclusion.item),
    );
    impact.push({ item: proposed, affectedRoots, orphaned });
  }
  const selections = [...selected.values()]
    .sort(order)
    .map((ref): SelectionRequest & { scope: "project" | "user" } => ({
      id: `catalog-${sha256Hex(new TextEncoder().encode(key(ref)))}`,
      scope: ref.scope,
      item: {
        releaseSha256: ref.releaseSha256,
        itemId: ref.itemId,
        itemSha256: itemAt(ref, "/roots")?.itemSha256 as string,
      },
      configuration: configurations.get(key(ref)) ?? {},
    }));
  const validated = validateSelectionSet({ releases: Object.fromEntries(releases), selections });
  if (!validated.valid)
    report(
      "INPUT_INVALID",
      "/roots",
      "The resolved composition is refused by the final selection validator.",
      validated.diagnostics,
    );
  if (diagnostics.length) return refuse(true);
  const frameworkOf = (ref: SelectionRef) => releases.get(ref.releaseSha256)?.framework?.id;
  const requiredBy = new Map<string, Map<string, InclusionOrigin>>();
  for (const inclusion of inclusions) {
    const by = inclusion.path[inclusion.path.length - 2];
    if (!by) continue;
    const framework = frameworkOf(by);
    const origin: InclusionOrigin = {
      reasonIncluded: "required-by",
      requiredBy: { ...(framework ? { framework } : {}), itemId: by.itemId },
    };
    const entries = requiredBy.get(key(inclusion.item)) ?? new Map<string, InclusionOrigin>();
    entries.set(canonicalJson(origin), origin);
    requiredBy.set(key(inclusion.item), entries);
  }
  const rootKeys = new Set(roots.map(key));
  const withOrigins = selections.map((selection) => {
    const ref = {
      releaseSha256: selection.item.releaseSha256,
      itemId: selection.item.itemId,
      scope: selection.scope,
    };
    const origins: InclusionOrigin[] = [
      ...(rootKeys.has(key(ref)) ? [{ reasonIncluded: "chosen" as const }] : []),
      ...(expansion.taken.get(key(ref))?.origins.values() ?? []),
      ...[...(requiredBy.get(key(ref))?.entries() ?? [])]
        .sort(([a], [b]) => compare(a, b))
        .map(([, origin]) => origin),
    ];
    return { ...selection, origins };
  });
  const stableOptional = [
    ...new Map(
      optional.map((entry) => [`${key(entry.from)}\u0001${key(entry.to)}`, entry]),
    ).values(),
  ].sort((a, b) => order(a.from, b.from) || order(a.to, b.to));
  return deepFreeze({
    status: "ok",
    value: {
      selections: withOrigins,
      inclusions: stableInclusions(inclusions),
      optional: stableOptional,
      removalImpact: impact,
    },
    diagnostics: [],
  });
}

type Report = (
  code: string,
  path: string,
  message: string,
  details?: readonly CatalogDiagnostic[],
  subject?: { reference: SelectionRef & { itemSha256?: string }; declaredBy?: SelectionRef },
  reason?: string,
) => void;
type ItemAt = (ref: SelectionRef, at: string) => CatalogItem | undefined;
interface Taken {
  readonly ref: SelectionRef;
  readonly origins: Map<string, InclusionOrigin>;
}
interface SetExpansion {
  /** Members taken by chosen sets, in expansion order, with their in-set origins. */
  readonly taken: Map<string, Taken>;
  /** Items a request names with `include: false`, with the override's path. */
  readonly excluded: Map<string, { readonly ref: SelectionRef; readonly path: string }>;
  /** Members a chosen set requires: not optional. */
  readonly required: Set<string>;
}
/** Thrown to stop expansion once a refusal is reported; never truncates. */
class StopExpansion extends Error {}

/**
 * Expands chosen sets in the published order. Step 1 takes every chosen set in
 * request order, each depth-first (includes, members, required sets). Step 2 then
 * applies option values per chosen set, in request order and declared option
 * order. Returns undefined after reporting a refusal.
 */
function expandSets(
  chosen: readonly SetSelection[],
  releases: ReadonlyMap<string, CatalogRelease>,
  report: Report,
  itemAt: ItemAt,
): SetExpansion | undefined {
  const taken = new Map<string, Taken>();
  const excluded = new Map<string, { ref: SelectionRef; path: string }>();
  const required = new Set<string>();
  const fail = (code: string, path: string, message: string, reason: string): never => {
    report(code, path, message, undefined, undefined, reason);
    throw new StopExpansion();
  };
  const frameworkRelease = (framework: string, version: string, at: string): CatalogRelease => {
    const found = [...releases.values()].filter(
      (release) => release.framework?.id === framework && release.framework.version === version,
    );
    if (found.length > 1)
      fail(
        "REFERENCE_AMBIGUOUS",
        at,
        "Several supplied releases share this framework version.",
        "release-ambiguous",
      );
    if (!found.length)
      fail(
        "RELEASE_UNAVAILABLE",
        at,
        "The referenced framework release was not supplied.",
        "release-unavailable",
      );
    return found[0] as CatalogRelease;
  };
  const setAt = (
    from: CatalogRelease,
    ref: { framework: string; setId: string; setSha256: string; releaseVersion?: string },
    at: string,
  ): { set: ReleaseSet; release: CatalogRelease } => {
    const release =
      ref.releaseVersion === undefined
        ? from
        : frameworkRelease(ref.framework, ref.releaseVersion, at);
    const set = release.sets?.find((candidate) => candidate.id === ref.setId);
    if (!set)
      return fail(
        "SET_UNAVAILABLE",
        at,
        "The referenced set is absent from its release.",
        "set-unavailable",
      );
    if (set.setSha256 !== ref.setSha256)
      fail(
        "REFERENCE_AMBIGUOUS",
        `${at}/setSha256`,
        "The set digest differs from the checked release's set.",
        "set-digest-mismatch",
      );
    return { set, release };
  };
  const memberRef = (
    member: SetMember,
    from: CatalogRelease,
    scope: "project" | "user",
    at: string,
  ): SelectionRef => {
    const item = member.item as {
      framework: string;
      itemId: string;
      releaseVersion?: string;
      contentSha256?: string;
      behaviourSha256?: string;
    };
    const release =
      item.releaseVersion === undefined
        ? from
        : frameworkRelease(item.framework, item.releaseVersion, at);
    const ref = { releaseSha256: release.sha256, itemId: item.itemId, scope };
    const found = itemAt(ref, at);
    if (!found) throw new StopExpansion();
    if (
      item.releaseVersion !== undefined &&
      (found.contentSha256 !== item.contentSha256 || found.behaviourSha256 !== item.behaviourSha256)
    )
      fail(
        "REFERENCE_AMBIGUOUS",
        `${at}/item`,
        "The supplied item does not match the member's pinned identities.",
        "member-pin-mismatch",
      );
    if (found.kind === "hook" && !member.optional)
      fail("INPUT_INVALID", at, "Every hook member of a set is optional.", "hook-member-required");
    return ref;
  };
  let count = 0;
  interface Expanded {
    readonly set: ReleaseSet;
    readonly release: CatalogRelease;
    readonly depth: number;
    readonly stack: readonly string[];
  }
  interface Chosen {
    readonly at: string;
    readonly entry: SetSelection;
    readonly identity: { framework: string; setId: string; setSha256: string };
    readonly overrides: Map<string, { include: boolean; path: string }>;
    readonly seenMembers: Set<string>;
    readonly visited: Set<string>;
    readonly expanded: Expanded[];
  }
  const validEntry = (entry: SetSelection) =>
    exactFields(entry, ["release", "setId", "setSha256"], ["options", "members"]) &&
    exactFields(entry.release, ["releaseSha256", "scope"]) &&
    typeof entry.release.releaseSha256 === "string" &&
    SHA256.test(entry.release.releaseSha256) &&
    (entry.release.scope === "project" || entry.release.scope === "user") &&
    isId(entry.setId) &&
    typeof entry.setSha256 === "string" &&
    SHA256.test(entry.setSha256) &&
    (entry.options === undefined ||
      (typeof entry.options === "object" &&
        entry.options !== null &&
        !Array.isArray(entry.options) &&
        Object.keys(entry.options).length <= 64 &&
        Object.entries(entry.options).every(
          ([optionId, values]) =>
            isId(optionId) &&
            Array.isArray(values) &&
            values.length <= 256 &&
            values.every(isId) &&
            new Set(values).size === values.length,
        ))) &&
    (entry.members === undefined ||
      (Array.isArray(entry.members) &&
        entry.members.length <= SET_MAX_MEMBERS &&
        entry.members.every(
          (override) =>
            exactFields(override, ["item", "include"]) &&
            typeof override.include === "boolean" &&
            exactFields(override.item, ["framework", "itemId"]) &&
            isId(override.item.framework) &&
            isId(override.item.itemId),
        )));
  /** Depth-first: includes, then members, then required sets. */
  const expand = (
    current: Chosen,
    set: ReleaseSet,
    from: CatalogRelease,
    depth: number,
    stack: readonly string[],
    options: Readonly<Record<string, readonly string[]>> | undefined,
  ) => {
    const { at } = current;
    const setKey = `${from.sha256}\u0000${set.id}`;
    if (stack.includes(setKey)) fail("SET_CYCLE", at, "Chosen sets form a cycle.", "set-cycle");
    if (depth > SET_MAX_DEPTH)
      fail(
        "SET_LIMIT_EXCEEDED",
        at,
        "Sets nest more than 8 levels below a chosen set.",
        "set-depth-exceeded",
      );
    const visitKey = `${setKey}\u0001${canonicalJson(options ?? null)}`;
    if (current.visited.has(visitKey)) return;
    current.visited.add(visitKey);
    const next = [...stack, setKey];
    current.expanded.push({ set, release: from, depth, stack: next });
    const nested = (refs: readonly SetRef[] | undefined) => {
      for (const ref of refs ?? []) {
        const target = setAt(from, ref, at);
        expand(current, target.set, target.release, depth + 1, next, options);
      }
    };
    nested(set.includes);
    for (const member of set.members) {
      const ref = memberRef(member, from, current.entry.release.scope, at);
      const name = memberKey(member.item);
      current.seenMembers.add(name);
      const override = current.overrides.get(name);
      if (override?.include === false) {
        if (!member.optional) required.add(key(ref));
        excluded.set(key(ref), { ref, path: override.path });
        continue;
      }
      if (!(override?.include ?? member.defaultOn)) continue;
      if (!member.optional) required.add(key(ref));
      let entry = taken.get(key(ref));
      if (!entry) {
        if (++count > SET_MAX_MEMBERS)
          fail(
            "SET_LIMIT_EXCEEDED",
            at,
            "Chosen sets resolve more than 5,000 members.",
            "set-members-exceeded",
          );
        entry = { ref, origins: new Map<string, InclusionOrigin>() };
        taken.set(key(ref), entry);
      }
      const origin: InclusionOrigin = {
        reasonIncluded: "in-set",
        set: current.identity,
        ...(options ? { options } : {}),
      };
      entry.origins.set(canonicalJson(origin), origin);
    }
    nested(set.requires);
  };
  const chosenSets: Chosen[] = [];
  try {
    // Step 1: every chosen set in request order, depth-first.
    chosen.forEach((entry, index) => {
      const at = `/sets/${index}`;
      if (!validEntry(entry))
        fail(
          "INPUT_INVALID",
          at,
          "Expected { release: { releaseSha256, scope }, setId, setSha256, options?, members? }.",
          "set-selection-invalid",
        );
      const release = releases.get(entry.release.releaseSha256);
      if (!release)
        fail(
          "RELEASE_UNAVAILABLE",
          `${at}/release`,
          "Referenced release was not supplied.",
          "release-unavailable",
        );
      const framework = (release as CatalogRelease).framework?.id as string;
      const top = setAt(
        release as CatalogRelease,
        { framework, setId: entry.setId, setSha256: entry.setSha256 },
        at,
      ).set;
      const overrides = new Map<string, { include: boolean; path: string }>();
      (entry.members ?? []).forEach((override, o) => {
        const name = memberKey(override.item);
        if (overrides.has(name))
          fail(
            "INPUT_INVALID",
            `${at}/members/${o}`,
            "A member is overridden once.",
            "set-member-repeated",
          );
        overrides.set(name, { include: override.include, path: `${at}/members/${o}` });
      });
      for (const [optionId, choiceIds] of Object.entries(entry.options ?? {})) {
        const option = top.options?.find((candidate) => candidate.id === optionId);
        if (!option || !choiceIds.every((id) => option.choices.some((choice) => choice.id === id)))
          fail(
            "INPUT_INVALID",
            `${at}/options/${pointer(optionId)}`,
            "The set has no such option or choice.",
            "set-option-unknown",
          );
      }
      const current: Chosen = {
        at,
        entry,
        identity: { framework, setId: top.id, setSha256: top.setSha256 },
        overrides,
        seenMembers: new Set(),
        visited: new Set(),
        expanded: [],
      };
      chosenSets.push(current);
      expand(current, top, release as CatalogRelease, 0, [], undefined);
    });
    // Step 2: option values per chosen set in request order. Only the chosen set's
    // own options take choices; every expanded set's always-included sets apply.
    for (const current of chosenSets) {
      for (let cursor = 0; cursor < current.expanded.length; cursor++) {
        const { set, release: from, depth, stack } = current.expanded[cursor] as Expanded;
        for (const option of set.options ?? []) {
          for (const ref of option.always ?? []) {
            const target = setAt(from, ref, current.at);
            expand(current, target.set, target.release, depth + 1, stack, undefined);
          }
          if (cursor !== 0) continue;
          const picked = current.entry.options?.[option.id] ?? [];
          for (const choice of option.choices) {
            if (!picked.includes(choice.id)) continue;
            for (const ref of choice.sets) {
              const target = setAt(from, ref, current.at);
              expand(current, target.set, target.release, depth + 1, stack, {
                [option.id]: [choice.id],
              });
            }
          }
        }
      }
    }
  } catch (error) {
    if (!(error instanceof StopExpansion)) throw error;
    return undefined;
  }
  let refused = false;
  for (const current of chosenSets)
    (current.entry.members ?? []).forEach((override, o) => {
      if (current.seenMembers.has(memberKey(override.item))) return;
      refused = true;
      report(
        "INPUT_INVALID",
        `${current.at}/members/${o}`,
        "The chosen set has no such member.",
        undefined,
        undefined,
        "set-member-unknown",
      );
    });
  // An excluded item leaves every set; one that any chosen set requires is refused.
  for (const [name, { ref, path }] of excluded) {
    taken.delete(name);
    if (!required.has(name)) continue;
    refused = true;
    report(
      "REQUIRED_EXCLUDED",
      path,
      "A request excludes a member its set requires.",
      undefined,
      { reference: ref },
      "required-excluded",
    );
  }
  return refused ? undefined : { taken, excluded, required };
}
