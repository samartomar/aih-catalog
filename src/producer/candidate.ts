import type { Json } from "../release/contracts.js";
import { canonicalJson } from "../release/json.js";
import { listItems, readRelease } from "../release/reader.js";
import type { BaseRelease, Record_ } from "./base.js";
import { assertAcyclic, type ProducerDeclaration } from "./declaration.js";
import { classifyDelta, type ItemDelta, repositoryUrl } from "./delta.js";
import { refuse } from "./errors.js";
import {
  documentBytes,
  type GeneratedItem,
  generateItem,
  HOOK_RELEASE_PATH,
  RELEASE_PATH,
  sha256Hex,
} from "./generate.js";
import type { SourceTree } from "./tree.js";

export type ReportedState =
  | "added"
  | "changed"
  | "removed"
  | "unchanged"
  | "dependent-confirmed"
  | "provenance-only";

export interface ItemReport {
  readonly id: string;
  readonly state: ReportedState;
  /** What differs operationally (bytes, label, dependencies, install directory). */
  readonly operational: readonly string[];
  /** What differs only in where the content came from. */
  readonly provenance: readonly string[];
  /** For a dependent: the changed/added/removed items it requires. */
  readonly dependsOnChanged: readonly string[];
  readonly itemSha256Before?: string;
  readonly itemSha256After?: string;
}

export interface CandidateReport {
  readonly schema: "aihq-catalog-candidate-report";
  readonly version: 1;
  readonly package: { readonly name: string; readonly version: string };
  readonly source: {
    readonly id: string;
    readonly repository: string;
    readonly revision: string;
    readonly inventoryComplete: boolean;
    readonly inventoryFiles: number;
  };
  readonly baseRevisions: readonly string[];
  readonly release: {
    readonly sha256: string;
    readonly byteLength: number;
    readonly baseSha256?: string;
  };
  readonly items: readonly ItemReport[];
  readonly summary: Readonly<Record<ReportedState, number>>;
  readonly files: {
    readonly total: number;
    readonly preserved: number;
    readonly written: readonly string[];
    readonly dropped: readonly string[];
  };
}

export interface BuildCandidateInput {
  readonly declaration: ProducerDeclaration;
  readonly tree: SourceTree;
  readonly base?: BaseRelease;
  readonly package: { readonly name: string; readonly version: string };
  /**
   * Re-pin retained items whose behavior is identical to the target revision.
   * Off by default: unaffected records keep their provenance exactly. The changes
   * it makes are reported as `provenance-only`.
   */
  readonly advanceProvenance?: boolean;
}

export interface BuildCandidateResult {
  /** The complete `release/**` inventory: package-relative path → bytes. */
  readonly files: ReadonlyMap<string, Buffer>;
  readonly report: CandidateReport;
}

const asRecord = (value: Json | undefined): Record_ => value as Record_;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The parts of an item that decide what Core would do, without where the bytes came from. */
function operationalView(
  record: Record_,
  recipeBytes: Uint8Array,
): { item: string; recipe: string } {
  const { sourceIds: _sourceIds, metadata, recipe, materials, ...rest } = record;
  const { upstream: _upstream, ...otherMetadata } = asRecord(metadata);
  const descriptor = asRecord(recipe);
  const parsed = JSON.parse(Buffer.from(recipeBytes).toString("utf8")) as Record_;
  const { description: _description, ...operations } = parsed;
  return {
    item: canonicalJson({
      ...rest,
      metadata: otherMetadata,
      recipe: { id: descriptor.id, schema: descriptor.schema },
      materials: (materials as Json[]).map((member) => {
        const { path: _path, ...kept } = asRecord(member);
        return kept;
      }),
    }),
    recipe: canonicalJson(operations),
  };
}

function targetSourceId(
  sources: Map<string, Record_>,
  repository: string,
  declaredId: string,
  revision: string,
): string {
  const url = repositoryUrl(repository);
  for (const [id, source] of sources) {
    const origin = asRecord(source.origin);
    if (origin.kind === "git" && origin.repository === url && origin.revision === revision)
      return id;
  }
  const preferred = sources.has(declaredId) ? `${declaredId}-${revision.slice(0, 12)}` : declaredId;
  if (sources.has(preferred)) {
    return refuse(
      "source-id-collision",
      `source id ${preferred} is already used by another origin`,
    );
  }
  sources.set(preferred, { id: preferred, origin: { kind: "git", repository: url, revision } });
  return preferred;
}

/**
 * Builds the next release candidate for one pinned upstream commit.
 *
 * Only added, changed and dependent items are produced; every other record and
 * member is carried over byte for byte. Anything that cannot be decided
 * (incomplete inventory, undeclared released items, a retained item requiring a
 * removed one) refuses instead of guessing, and the base is never modified.
 */
export function buildCandidate(input: BuildCandidateInput): BuildCandidateResult {
  const { declaration, tree, base } = input;
  const plan = classifyDelta({ declaration, tree, ...(base ? { base } : {}) });
  const unknown = plan.items.filter((item) => item.state === "unknown").map((item) => item.id);
  if (unknown.length > 0) {
    return refuse(
      "inventory-incomplete",
      `the upstream inventory cannot decide ${unknown.join(", ")}; incomplete is never removal`,
      { itemIds: unknown, inventoryComplete: tree.inventory.complete },
    );
  }
  const removed = plan.items.filter((item) => item.state === "removed").map((item) => item.id);
  if (removed.length > 0 && removed.length === plan.items.length) {
    return refuse(
      "removal-of-every-item",
      `the pinned commit would remove every item of ${plan.source.id}; that is refused rather than assumed (check the pin and the declaration)`,
      { removed },
    );
  }
  if (removed.length > 0) {
    const stillRequired = [
      ...declaration.items.filter(
        (item) => !removed.includes(item.id) && item.requires.some((id) => removed.includes(id)),
      ),
    ].map((item) => item.id);
    // Declared items of the target source are judged by their NEW edges (the declaration);
    // only released items this run does not regenerate keep the edges they were released with.
    const declaredIds = new Set(plan.items.map((item) => item.id));
    const releasedRequirers = (base?.items ?? [])
      .filter((item) => !declaredIds.has(item.id as string))
      .filter((item) =>
        (asRecord(item.dependencies).requires as Json[]).some((ref) =>
          removed.includes(asRecord(ref).itemId as string),
        ),
      )
      .map((item) => item.id as string);
    const blocked = [...new Set([...stillRequired, ...releasedRequirers])].sort();
    if (blocked.length > 0) {
      return refuse(
        "required-item-removed",
        `${blocked.join(", ")} still require removed item(s) ${removed.join(", ")}`,
        { removed, blocked },
      );
    }
  }

  const sources = new Map<string, Record_>((base?.sources ?? []).map((s) => [s.id as string, s]));
  const items = new Map<string, Record_>((base?.items ?? []).map((i) => [i.id as string, i]));
  const files = new Map<string, Buffer>(base?.files ?? []);
  const generated = new Map<string, GeneratedItem>();
  const states = new Map<string, ItemReport>();
  const baseItemSha = new Map(base ? listItems(base.checked).map((i) => [i.id, i.itemSha256]) : []);

  const produce = (delta: ItemDelta): GeneratedItem => {
    const sourceId = targetSourceId(sources, plan.source.repository, plan.source.id, tree.commit);
    const item = generateItem({
      item: delta.declared,
      source: plan.source,
      sourceId,
      revision: tree.commit,
      skill: delta.skill as Buffer,
      license: delta.license as Buffer,
    });
    generated.set(delta.id, item);
    return item;
  };

  for (const delta of plan.items) {
    const dependsOn = plan.dependents.get(delta.id) ?? [];
    const report = (state: ReportedState): ItemReport => ({
      id: delta.id,
      state,
      operational: delta.operational,
      provenance: delta.provenance,
      dependsOnChanged: dependsOn,
      ...(baseItemSha.has(delta.id)
        ? { itemSha256Before: baseItemSha.get(delta.id) as string }
        : {}),
    });
    if (delta.state === "removed") {
      items.delete(delta.id);
      states.set(delta.id, report("removed"));
      continue;
    }
    if (delta.state === "added" || delta.state === "changed") {
      produce(delta);
      states.set(delta.id, report(delta.state));
      continue;
    }
    // Retained: unchanged, provenance-only or (possibly) a dependent.
    const retained = delta.base as Record_;
    const recipeBytes = files.get(asRecord(retained.recipe).path as string) as Buffer;
    if (dependsOn.length > 0 || delta.state === "provenance-only" || input.advanceProvenance) {
      const next = produce(delta);
      const before = operationalView(retained, recipeBytes);
      const after = operationalView(next.record, next.recipeBytes);
      if (before.item !== after.item || before.recipe !== after.recipe) {
        // Revalidation found an operational difference the digests did not: treat it as changed.
        states.set(delta.id, { ...report("changed"), operational: ["regenerated-differs"] });
        continue;
      }
      if (delta.state === "provenance-only" || input.advanceProvenance) {
        states.set(delta.id, report("provenance-only"));
        continue;
      }
      generated.delete(delta.id);
      states.set(delta.id, report("dependent-confirmed"));
      continue;
    }
    states.set(delta.id, report("unchanged"));
  }

  for (const [id, item] of generated) items.set(id, item.record);
  const used = new Set([...items.values()].flatMap((item) => item.sourceIds as string[]));
  const finalSources = [...sources.values()]
    .filter((source) => used.has(source.id as string))
    .sort((a, b) => compare(a.id as string, b.id as string));
  const finalItems = [...items.values()].sort((a, b) => compare(a.id as string, b.id as string));

  assertRequiredClosure(finalItems);

  const document: Record_ = {
    schema: "urn:aihq:catalog:release:1.0.0",
    package: { name: input.package.name, version: input.package.version },
    sources: finalSources,
    items: finalItems,
    ...(base?.metadata === undefined ? {} : { metadata: base.metadata }),
  };
  const out = new Map<string, Buffer>();
  const put = (path: string, bytes: Buffer) => {
    const prior = out.get(path);
    if (prior !== undefined && !prior.equals(bytes)) {
      refuse("member-path-conflict", `${path} would hold two different byte sequences`, { path });
    }
    out.set(path, bytes);
  };
  for (const item of finalItems) {
    const made = generated.get(item.id as string);
    if (made !== undefined) {
      put(made.recipePath, made.recipeBytes);
      for (const member of made.members) put(member.path, member.bytes);
      continue;
    }
    for (const member of [asRecord(item.recipe), ...(item.materials as Json[]).map(asRecord)]) {
      put(member.path as string, files.get(member.path as string) as Buffer);
    }
  }
  const releaseBytes = documentBytes(document);
  put(RELEASE_PATH, releaseBytes);
  if (base?.hookDocument !== undefined) {
    // The 1.1 release is carried as published: its items and members are untouched and only
    // the package identity it embeds follows this candidate's package.
    const hookDocument: Record_ = {
      ...base.hookDocument,
      package: { name: input.package.name, version: input.package.version },
    };
    for (const item of (hookDocument.items as Json[]).map(asRecord)) {
      for (const member of [asRecord(item.recipe), ...(item.materials as Json[]).map(asRecord)]) {
        put(member.path as string, files.get(member.path as string) as Buffer);
      }
    }
    put(HOOK_RELEASE_PATH, documentBytes(hookDocument));
  }

  const checked = readRelease(releaseBytes, { expectedSha256: sha256Hex(releaseBytes) });
  if (!checked.valid) {
    return refuse("candidate-envelope-invalid", "the produced release document is invalid", {
      diagnostics: checked.diagnostics.map((d) => ({ reason: d.reason, path: d.path })),
    });
  }
  const afterSha = new Map(listItems(checked.release).map((i) => [i.id, i.itemSha256]));
  const reports: ItemReport[] = [
    ...[...states.values()].map((entry) =>
      afterSha.has(entry.id)
        ? { ...entry, itemSha256After: afterSha.get(entry.id) as string }
        : entry,
    ),
  ].sort((a, b) => compare(a.id, b.id));
  // Released items this run does not produce (other sources) are carried untouched. Those that
  // require, directly or through other items, something added or changed are revalidated against
  // the resulting graph and reported as dependents; their bytes and provenance stay as released.
  const dependentsOf = externalDependents(finalItems, plan.items, states);
  for (const item of finalItems) {
    if (!states.has(item.id as string)) {
      const dependsOnChanged = dependentsOf.get(item.id as string) ?? [];
      reports.push({
        id: item.id as string,
        state: dependsOnChanged.length > 0 ? "dependent-confirmed" : "unchanged",
        operational: [],
        provenance: [],
        dependsOnChanged,
        ...(baseItemSha.has(item.id as string)
          ? { itemSha256Before: baseItemSha.get(item.id as string) as string }
          : {}),
        itemSha256After: afterSha.get(item.id as string) as string,
      });
    }
  }
  reports.sort((a, b) => compare(a.id, b.id));
  const summary: Record<ReportedState, number> = {
    added: 0,
    changed: 0,
    removed: 0,
    unchanged: 0,
    "dependent-confirmed": 0,
    "provenance-only": 0,
  };
  for (const entry of reports) summary[entry.state] += 1;
  const preserved = [...out].filter(([path, bytes]) => base?.files.get(path)?.equals(bytes)).length;
  const revisionsOf = (base?.sources ?? [])
    .map(asRecord)
    .filter((s) => asRecord(s.origin).repository === repositoryUrl(plan.source.repository))
    .map((s) => asRecord(s.origin).revision as string)
    .sort();
  return {
    files: out,
    report: {
      schema: "aihq-catalog-candidate-report",
      version: 1,
      package: { name: input.package.name, version: input.package.version },
      source: {
        id: plan.source.id,
        repository: plan.source.repository,
        revision: tree.commit,
        inventoryComplete: tree.inventory.complete,
        inventoryFiles: tree.inventory.paths.size,
      },
      baseRevisions: revisionsOf,
      release: {
        sha256: checked.release.sha256,
        byteLength: checked.release.byteLength,
        ...(base ? { baseSha256: base.checked.sha256 } : {}),
      },
      items: reports,
      summary,
      files: {
        total: out.size,
        preserved,
        written: [...out.keys()]
          .filter((path) => !base?.files.get(path)?.equals(out.get(path) as Buffer))
          .sort(),
        dropped: [...(base?.files.keys() ?? [])].filter((path) => !out.has(path)).sort(),
      },
    },
  };
}

/** Every required same-release item must exist and the required graph must be acyclic. */
export function assertRequiredClosure(items: readonly Record_[]): void {
  const ids = new Set(items.map((item) => item.id as string));
  const graph = items.map((item) => ({
    id: item.id as string,
    requires: (asRecord(item.dependencies).requires as Json[]).flatMap((ref) => {
      const record = asRecord(ref);
      return typeof record.itemId === "string" && record.release === undefined
        ? [record.itemId]
        : [];
    }),
  }));
  for (const node of graph) {
    for (const required of node.requires) {
      if (!ids.has(required)) {
        refuse(
          "required-item-missing",
          `${node.id} requires ${required}, which is not in the release`,
          {
            itemId: node.id,
            required,
          },
        );
      }
    }
  }
  assertAcyclic(graph);
}

/** Items outside the target source mapped to the changed/added items they depend on. */
function externalDependents(
  finalItems: readonly Record_[],
  planned: readonly ItemDelta[],
  states: ReadonlyMap<string, ItemReport>,
): Map<string, string[]> {
  const declaredRequires = new Map(planned.map((delta) => [delta.id, delta.declared.requires]));
  const reverse = new Map<string, string[]>();
  for (const item of finalItems) {
    const id = item.id as string;
    const requires =
      declaredRequires.get(id) ??
      (asRecord(item.dependencies).requires as Json[]).flatMap((ref) => {
        const record = asRecord(ref);
        return typeof record.itemId === "string" && record.release === undefined
          ? [record.itemId]
          : [];
      });
    for (const required of requires) reverse.set(required, [...(reverse.get(required) ?? []), id]);
  }
  const roots = [...states.values()]
    .filter((entry) => entry.state === "added" || entry.state === "changed")
    .map((entry) => entry.id);
  const reached = new Map<string, Set<string>>();
  for (const root of roots) {
    const pending = [...(reverse.get(root) ?? [])];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const id = pending.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      reached.set(id, (reached.get(id) ?? new Set()).add(root));
      pending.push(...(reverse.get(id) ?? []));
    }
  }
  return new Map([...reached].map(([id, from]) => [id, [...from].sort(compare)]));
}
