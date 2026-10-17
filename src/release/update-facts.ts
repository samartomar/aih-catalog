/**
 * Portable comparison of two checked releases: the facts a consumer needs to
 * judge a content update, decided once by Catalog. No acquisition, host access
 * or recommendation; the caller decides what to do with the facts.
 */

import { dataRecord, exactFields } from "./boundary.js";
import type { AuthoringResult, CatalogItem, CatalogRelease, Diagnostic } from "./contracts.js";
import { deepFreeze } from "./json.js";
import { isCheckedRelease } from "./reader.js";

/** Two actual `readRelease` handles; `second` is described relative to `first`. */
export interface CompareReleasesRequest {
  readonly first: CatalogRelease;
  readonly second: CatalogRelease;
}

/** The exact release a comparison side names. */
export interface ComparedRelease {
  readonly sha256: string;
  readonly package: { readonly name: string; readonly version: string };
}

/**
 * How `second`'s package version stands against `first`'s, by Semantic Versioning
 * 2.0.0 precedence. `unknown` is never resolved by guessing.
 */
export type VersionOrder = "older" | "newer" | "equal" | "unknown";

/**
 * Why an order is `unknown`: the packages differ; a version is outside strict
 * Semantic Versioning 2.0.0; or the versions differ only in build metadata,
 * which has no precedence.
 */
export type VersionOrderUnknownReason =
  | "different-package"
  | "version-not-semver"
  | "build-metadata-only";

export type VersionComparison =
  | {
      readonly first: string;
      readonly second: string;
      readonly secondIs: "older" | "newer" | "equal";
    }
  | {
      readonly first: string;
      readonly second: string;
      readonly secondIs: "unknown";
      readonly reason: VersionOrderUnknownReason;
    };

/** One item's content identity: its recipe digest and the sorted set of material digests. */
export interface ItemIdentity {
  readonly itemSha256: string;
  readonly recipeSha256: string;
  readonly materialSha256: readonly string[];
}

export type Change = "unchanged" | "changed";

/** An item ID present in both releases of one package: the same content slot. */
export interface ItemInBoth {
  readonly itemId: string;
  readonly presence: "in-both";
  /** `changed` when the recipe or the material digest set differs. */
  readonly content: Change;
  readonly recipe: Change;
  readonly materials: Change;
  /** `changed` when `itemSha256` differs, including descriptive-only changes. */
  readonly record: Change;
  readonly first: ItemIdentity;
  readonly second: ItemIdentity;
}
export interface ItemOnlyInFirst {
  readonly itemId: string;
  readonly presence: "only-in-first";
  readonly first: ItemIdentity;
}
export interface ItemOnlyInSecond {
  readonly itemId: string;
  readonly presence: "only-in-second";
  readonly second: ItemIdentity;
}
export type ItemComparison = ItemInBoth | ItemOnlyInFirst | ItemOnlyInSecond;

export interface ReleaseComparison {
  readonly first: ComparedRelease;
  readonly second: ComparedRelease;
  /** Both sides are the same exact release bytes. */
  readonly sameRelease: boolean;
  /** Same `package.name`. Item IDs identify the same content only within one package. */
  readonly package: "same-package" | "different-package";
  readonly version: VersionComparison;
  /** Sorted by item ID in UTF-16 code-unit order; empty for different packages. */
  readonly items: readonly ItemComparison[];
}

export type CompareReleasesResult = AuthoringResult<ReleaseComparison>;

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Semantic Versioning 2.0.0 grammar: no leading zeros in numeric identifiers.
const NUMBER = "0|[1-9][0-9]*";
const PRERELEASE_PART = `(?:${NUMBER}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER = new RegExp(
  `^(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})` +
    `(?:-(${PRERELEASE_PART}(?:\\.${PRERELEASE_PART})*))?` +
    "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$",
);
const NUMERIC = /^[0-9]+$/;

/** Orders canonical decimal strings of any length without precision loss. */
const numeric = (a: string, b: string) =>
  a.length === b.length ? compare(a, b) : a.length - b.length;

/** Negative when `a` has lower precedence, zero for equal precedence, undefined if invalid. */
function precedence(a: string, b: string): number | undefined {
  const [x, y] = [SEMVER.exec(a), SEMVER.exec(b)];
  if (x === null || y === null) return undefined;
  for (const index of [1, 2, 3]) {
    const order = numeric(x[index] as string, y[index] as string);
    if (order !== 0) return order;
  }
  const [p, q] = [x[4], y[4]];
  // A version without pre-release identifiers has higher precedence.
  if (p === undefined || q === undefined)
    return (p === undefined ? 1 : 0) - (q === undefined ? 1 : 0);
  const [left, right] = [p.split("."), q.split(".")];
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const [l, r] = [left[index] as string, right[index] as string];
    if (l === r) continue;
    const [ln, rn] = [NUMERIC.test(l), NUMERIC.test(r)];
    if (ln && rn) return numeric(l, r);
    if (ln !== rn) return ln ? -1 : 1;
    return compare(l, r);
  }
  return left.length - right.length;
}

function versionOrder(first: string, second: string): VersionComparison {
  const order = precedence(second, first);
  if (order === undefined)
    return { first, second, secondIs: "unknown", reason: "version-not-semver" };
  if (order > 0) return { first, second, secondIs: "newer" };
  if (order < 0) return { first, second, secondIs: "older" };
  return first === second
    ? { first, second, secondIs: "equal" }
    : { first, second, secondIs: "unknown", reason: "build-metadata-only" };
}

const identity = (item: CatalogItem): ItemIdentity => ({
  itemSha256: item.itemSha256,
  recipeSha256: item.recipe.sha256,
  materialSha256: [...new Set(item.materials.map((member) => member.sha256))].sort(compare),
});
const change = (same: boolean): Change => (same ? "unchanged" : "changed");
const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const side = (release: CatalogRelease): ComparedRelease => ({
  sha256: release.sha256,
  package: { name: release.package.name, version: release.package.version },
});

/**
 * Compares two checked releases. Within one package an item ID names the same
 * content slot, and recipe/material digests decide whether its content changed.
 * Releases of different packages are unrelated: no item or version comparison.
 */
export function compareReleases(request: CompareReleasesRequest): CompareReleasesResult {
  const diagnostics: Diagnostic[] = [];
  const refuse = (): CompareReleasesResult => deepFreeze({ status: "refused", diagnostics });
  let top: Record<string, unknown>;
  try {
    top = dataRecord(request);
    if (!exactFields(top, ["first", "second"])) throw new TypeError("Request fields");
  } catch {
    diagnostics.push({
      code: "INPUT_INVALID",
      path: "",
      message: "Expected exactly { first, second } checked releases.",
    });
    return refuse();
  }
  for (const name of ["first", "second"] as const) {
    if (!isCheckedRelease(top[name])) {
      diagnostics.push({
        code: "INPUT_INVALID",
        path: `/${name}`,
        message: "Expected a release view returned by readRelease.",
      });
    }
  }
  if (diagnostics.length > 0) return refuse();
  const first = top.first as CatalogRelease;
  const second = top.second as CatalogRelease;
  const samePackage = first.package.name === second.package.name;
  const items: ItemComparison[] = [];
  if (samePackage) {
    const before = new Map(first.items.map((item) => [item.id, item]));
    const after = new Map(second.items.map((item) => [item.id, item]));
    for (const itemId of [...new Set([...before.keys(), ...after.keys()])].sort(compare)) {
      const [a, b] = [before.get(itemId), after.get(itemId)];
      if (a !== undefined && b !== undefined) {
        const [x, y] = [identity(a), identity(b)];
        const recipe = x.recipeSha256 === y.recipeSha256;
        const materials = sameList(x.materialSha256, y.materialSha256);
        items.push({
          itemId,
          presence: "in-both",
          content: change(recipe && materials),
          recipe: change(recipe),
          materials: change(materials),
          record: change(x.itemSha256 === y.itemSha256),
          first: x,
          second: y,
        });
      } else if (a !== undefined) {
        items.push({ itemId, presence: "only-in-first", first: identity(a) });
      } else if (b !== undefined) {
        items.push({ itemId, presence: "only-in-second", second: identity(b) });
      }
    }
  }
  return deepFreeze({
    status: "ok",
    value: {
      first: side(first),
      second: side(second),
      sameRelease: first.sha256 === second.sha256,
      package: samePackage ? "same-package" : "different-package",
      version: samePackage
        ? versionOrder(first.package.version, second.package.version)
        : {
            first: first.package.version,
            second: second.package.version,
            secondIs: "unknown",
            reason: "different-package",
          },
      items,
    },
    diagnostics: [],
  });
}
