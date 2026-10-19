/** Portable, effect-free required closure over actual checked reader handles. */

import { copyJson, dataRecord, exactFields, pointer } from "./boundary.js";
import type {
  CatalogDiagnostic,
  CatalogItem,
  CatalogRelease,
  DependencyRef,
  Diagnostic,
  Inclusion,
  RemovalImpact,
  ResolveSelectionsRequest,
  ResolveSelectionsResult,
  SelectionRef,
  SelectionRequest,
  SelectionRoot,
} from "./contracts.js";
import { ID, SHA256 } from "./document.js";
import { canonicalJson, deepFreeze } from "./json.js";
import { isCheckedRelease, validateSelectionSet } from "./reader.js";
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
  ) => {
    diagnostics.push({
      code,
      path,
      message,
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
  try {
    const top = dataRecord(request);
    if (!exactFields(top, ["releases", "roots", "skips"], ["remove"]))
      throw new TypeError("Request fields");
    supplied = dataRecord(top.releases);
    roots = copyJson(top.roots) as SelectionRoot[];
    skips = copyJson(top.skips) as SelectionRef[];
    remove = top.remove === undefined ? [] : (copyJson(top.remove) as SelectionRef[]);
    if (![roots, skips, remove].every(Array.isArray)) throw new TypeError("Expected arrays");
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
  const skipped = new Set(skips.map(key));
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
  const sortedRoots = uniqueRefs(roots).filter((ref) =>
    releases.get(ref.releaseSha256)?.items.some((item) => item.id === ref.itemId),
  );
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
      if (skipped.has(currentKey))
        report("REQUIRED_ITEM_SKIPPED", "/skips", "A skip suppresses a required selection.");
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
  const stableOptional = [
    ...new Map(
      optional.map((entry) => [`${key(entry.from)}\u0001${key(entry.to)}`, entry]),
    ).values(),
  ].sort((a, b) => order(a.from, b.from) || order(a.to, b.to));
  return deepFreeze({
    status: "ok",
    value: {
      selections,
      inclusions: stableInclusions(inclusions),
      optional: stableOptional,
      removalImpact: impact,
    },
    diagnostics: [],
  });
}
