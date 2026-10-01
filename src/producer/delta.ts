import type { Json } from "../release/contracts.js";
import type { BaseRelease, Record_ } from "./base.js";
import type { DeclaredItem, DeclaredSource, ProducerDeclaration } from "./declaration.js";
import { refuse } from "./errors.js";
import { sha256Hex } from "./generate.js";
import { pathStatus, readPresent, type SourceTree } from "./tree.js";

/**
 * Cheap change detection for one pinned upstream commit. Only the declared
 * closure files of each item are read and digested; nothing is generated here.
 *
 * - `added`/`removed`: the item is absent from the base / its skill file is
 *   absent from a COMPLETE upstream inventory.
 * - `changed`: an operational difference (closure bytes, label, dependencies,
 *   install directory).
 * - `provenance-only`: the bytes and behavior agree and only where they came
 *   from differs (the upstream path moved).
 * - `unknown`: the inventory cannot say (incomplete enumeration, submodule
 *   prefix). Unknown is never treated as removal.
 */
export type ItemState =
  | "added"
  | "changed"
  | "removed"
  | "unchanged"
  | "provenance-only"
  | "unknown";

export interface ItemDelta {
  readonly id: string;
  readonly state: ItemState;
  readonly operational: readonly string[];
  readonly provenance: readonly string[];
  readonly declared: DeclaredItem;
  readonly base?: Record_;
  readonly skill?: Buffer;
  readonly license?: Buffer;
}

export interface DeltaPlan {
  readonly source: DeclaredSource;
  readonly items: readonly ItemDelta[];
  /** Retained items that, directly or transitively, require an added/changed/removed item. */
  readonly dependents: ReadonlyMap<string, readonly string[]>;
}

const asRecord = (value: Json | undefined): Record_ => value as Record_;
export const repositoryUrl = (repository: string): string => `https://github.com/${repository}`;

/** Base items that came from the given repository. */
export function ownedBaseItems(base: BaseRelease, repository: string): Record_[] {
  const owned = new Set(
    base.sources
      .filter((source) => {
        const origin = asRecord(source.origin);
        return origin.kind === "git" && origin.repository === repositoryUrl(repository);
      })
      .map((source) => source.id as string),
  );
  return base.items.filter((item) => (item.sourceIds as string[]).some((id) => owned.has(id)));
}

function baseMember(item: Record_, id: string): Record_ | undefined {
  return (item.materials as Json[]).map(asRecord).find((member) => member.id === id);
}

const sameList = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

function baseRequires(item: Record_): string[] | undefined {
  const requires = (asRecord(item.dependencies).requires as Json[]).map(asRecord);
  if (requires.some((ref) => Object.keys(ref).join() !== "itemId")) return undefined;
  return requires.map((ref) => ref.itemId as string).sort();
}

export function classifyDelta(input: {
  declaration: ProducerDeclaration;
  tree: SourceTree;
  base?: BaseRelease;
}): DeltaPlan {
  const { declaration, tree, base } = input;
  const source = declaration.sources.find(
    (candidate) => candidate.repository.toLowerCase() === tree.repository.toLowerCase(),
  );
  if (source === undefined) {
    return refuse(
      "repository-not-declared",
      `${tree.repository} is not a declared source; the producer carries only declared repositories`,
    );
  }
  const mine = declaration.items.filter((item) => item.source === source.id);
  const baseItems = new Map((base?.items ?? []).map((item) => [item.id as string, item]));
  if (base !== undefined) {
    const declared = new Set(declaration.items.map((item) => item.id));
    const undeclared = ownedBaseItems(base, source.repository)
      .map((item) => item.id as string)
      .filter((id) => !declared.has(id));
    if (undeclared.length > 0) {
      return refuse(
        "undeclared-base-item",
        `released items are not declared: ${undeclared.join(", ")}; keep a declaration until its removal candidate is merged`,
        { itemIds: undeclared },
      );
    }
  }
  const license = pathStatus(tree, source.licensePath);
  const items = mine.map((declared): ItemDelta => {
    const prior = baseItems.get(declared.id);
    const skillStatus = pathStatus(tree, declared.skillPath);
    if (skillStatus === "irregular" || license === "irregular") {
      return refuse("source-file-unavailable", `${declared.id} names a non-regular upstream file`, {
        itemId: declared.id,
      });
    }
    if (skillStatus === "unknown" || (skillStatus === "present" && license === "unknown")) {
      return {
        id: declared.id,
        state: "unknown",
        operational: [],
        provenance: [],
        declared,
        ...(prior ? { base: prior } : {}),
      };
    }
    if (skillStatus === "absent") {
      if (prior === undefined) {
        return refuse(
          "declared-item-not-found",
          `${declared.id} is neither released nor present upstream at ${declared.skillPath}`,
          { itemId: declared.id },
        );
      }
      return {
        id: declared.id,
        state: "removed",
        operational: [],
        provenance: [],
        declared,
        base: prior,
      };
    }
    if (license !== "present") {
      return refuse("source-file-unavailable", `license ${source.licensePath} is ${license}`, {
        itemId: declared.id,
      });
    }
    const skill = readPresent(tree, declared.skillPath);
    const licenseBytes = readPresent(tree, source.licensePath);
    if (prior === undefined) {
      return {
        id: declared.id,
        state: "added",
        operational: ["new-item"],
        provenance: [],
        declared,
        skill,
        license: licenseBytes,
      };
    }
    const operational: string[] = [];
    const provenance: string[] = [];
    const skillMember = baseMember(prior, "skill");
    const licenseMember = baseMember(prior, "license");
    if (skillMember?.sha256 !== sha256Hex(skill)) operational.push("material:skill");
    if (licenseMember?.sha256 !== sha256Hex(licenseBytes)) operational.push("material:license");
    if (prior.label !== declared.label) operational.push("label");
    const priorRequires = baseRequires(prior);
    if (priorRequires === undefined || !sameList(priorRequires, declared.requires)) {
      operational.push("requires");
    }
    const priorPath = asRecord(asRecord(prior.metadata).upstream).path;
    if (typeof priorPath !== "string") {
      operational.push("upstream-path");
    } else if (priorPath !== declared.skillPath) {
      const previousEntry = priorPath.split("/").slice(-2, -1)[0];
      (previousEntry === declared.entry ? provenance : operational).push("upstream-path");
    }
    const state: ItemState =
      operational.length > 0 ? "changed" : provenance.length > 0 ? "provenance-only" : "unchanged";
    return {
      id: declared.id,
      state,
      operational,
      provenance,
      declared,
      base: prior,
      skill,
      license: licenseBytes,
    };
  });

  const roots = new Set(
    items.filter((item) => ["added", "changed", "removed"].includes(item.state)).map((i) => i.id),
  );
  const requiredBy = new Map<string, string[]>();
  for (const item of declaration.items) {
    for (const required of item.requires)
      requiredBy.set(required, [...(requiredBy.get(required) ?? []), item.id]);
  }
  const dependents = new Map<string, string[]>();
  for (const root of roots) {
    const pending = [...(requiredBy.get(root) ?? [])];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const id = pending.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...(requiredBy.get(id) ?? []));
      if (!roots.has(id)) dependents.set(id, [...(dependents.get(id) ?? []), root].sort());
    }
  }
  return { source, items, dependents };
}
