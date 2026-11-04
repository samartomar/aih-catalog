/**
 * The named renders. One implementation serves the planner, which decides
 * whether a render applies from the item and profile alone, and `renderStep`, which
 * produces the bytes. A render only sets frontmatter keys and rewords `$ARGUMENTS`.
 */
import { applyEdit, decodeText, type Edit, type Frontmatter } from "./frontmatter.js";
import type { Item } from "./model.js";

export interface ToolProfile {
  readonly schema: string;
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly checkedWith: readonly {
    readonly app: string;
    readonly version: string;
    readonly date: string;
  }[];
  readonly places: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly userOnly: "none" | { readonly frontmatter: Frontmatter };
  readonly userOnlyFallback?: Readonly<
    Record<
      string,
      readonly {
        readonly id: string;
        readonly path: string;
        readonly frontmatter?: Frontmatter;
        readonly arguments: "kept" | "reworded";
      }[]
    >
  >;
  readonly arguments: "substituted" | "chat-text";
  readonly ruleScopes?: Readonly<Record<string, { readonly frontmatter: Frontmatter }>>;
}

export type RenderName = "skill" | "user-only-fallback" | "rule";
export const renderNames: readonly RenderName[] = ["skill", "user-only-fallback", "rule"];

/** The edit a render makes, or a reason the render does not apply to this item and profile. */
export function renderEdit(
  name: RenderName,
  entry: string | undefined,
  item: Item,
  profile: ToolProfile,
  scope: "project" | "user",
): Edit | { reason: string } {
  if (name === "skill") {
    if (item.kind !== "skill" || entry !== undefined)
      return { reason: "the skill render applies to skills only" };
    if (item.userOnly && profile.userOnly === "none")
      return { reason: "the profile has no user-only flag" };
    const set = item.userOnly && profile.userOnly !== "none" ? profile.userOnly.frontmatter : {};
    return { set, reword: item.arguments === true && profile.arguments === "chat-text" };
  }
  if (name === "user-only-fallback") {
    const fallback = profile.userOnlyFallback?.[scope]?.find((candidate) => candidate.id === entry);
    if (item.kind !== "skill" || !item.userOnly || fallback === undefined) {
      return { reason: "no user-only fallback entry applies" };
    }
    return {
      set: fallback.frontmatter ?? {},
      reword: item.arguments === true && fallback.arguments === "reworded",
    };
  }
  if (name === "rule") {
    const scopeKey = item.scope === "always" ? "always" : undefined;
    const rule = scopeKey === undefined ? undefined : profile.ruleScopes?.[scopeKey];
    if (item.kind !== "rule" || entry !== undefined || rule === undefined)
      return { reason: "no rule scope render applies" };
    return { set: rule.frontmatter, reword: false };
  }
  return { reason: "unknown render" };
}

/** True when the edit can change bytes; the planner copies files whose edit is empty. */
export const changesBytes = (edit: Edit): boolean =>
  edit.reword || Object.keys(edit.set).length > 0;

export function renderBytes(
  edit: Edit,
  source: Uint8Array,
): { bytes: Uint8Array } | { reason: string } {
  const text = decodeText(source);
  if (text === null) return { reason: "the source file is not UTF-8 text" };
  const result = applyEdit(text, edit);
  if ("reason" in result) return result;
  return { bytes: new TextEncoder().encode(result.text) };
}
