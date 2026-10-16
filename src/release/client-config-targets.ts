/**
 * Catalog content does not manage a Codex `config.toml` with a `text.block`. Core places a
 * new block at the end of its target file, and Codex rewrites that file when it records a
 * trusted project: the client's new table lands before the file's trailing comment lines,
 * which puts it inside a managed block whose `END` marker is the last line. Core then reports
 * the block changed although the person changed nothing, and applying the block again would
 * drop the client's table. This module names every recipe `text.block` that could write such
 * a file, so the whole-package integrity check can refuse it.
 * Portable: no Node built-ins.
 */

export interface CodexConfigBlockProblem {
  /**
   * `codex-config-target`: the target ends in a literal `.codex/config.toml`.
   * `codex-config-target-unresolved`: an input slot could resolve the target to one.
   */
  readonly reason: "codex-config-target" | "codex-config-target-unresolved";
  readonly itemId: string;
  readonly operationId: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The lower-cased text of a literal path segment, `undefined` for an input slot or anything else. */
const literalOf = (segment: unknown): string | undefined =>
  isObject(segment) && typeof segment.literal === "string"
    ? segment.literal.toLowerCase()
    : undefined;

/**
 * Stable problems for every `text.block` operation, in recipe and operation order, whose
 * target could be a Codex `config.toml` under any root: a literal `.codex/config.toml`
 * ending, or a target whose last segment, or the segment before a literal `config.toml`, is
 * an input slot that could resolve there. Names compare case-insensitively. Other operation
 * kinds and other paths are ignored; a recipe that is not an operation list is ignored here
 * because recipe agreement already refuses it.
 */
export function codexConfigBlockProblems(
  recipes: readonly { readonly itemId: string; readonly recipe: unknown }[],
): readonly CodexConfigBlockProblem[] {
  const problems: CodexConfigBlockProblem[] = [];
  for (const { itemId, recipe } of recipes) {
    if (!isObject(recipe) || !Array.isArray(recipe.operations)) continue;
    for (const operation of recipe.operations as unknown[]) {
      if (!isObject(operation) || operation.kind !== "text.block") continue;
      if (!isObject(operation.target) || !Array.isArray(operation.target.segments)) continue;
      const segments = operation.target.segments as unknown[];
      const last = literalOf(segments[segments.length - 1]);
      const directory = literalOf(segments[segments.length - 2]);
      const operationId = typeof operation.id === "string" ? operation.id : "";
      if (last === undefined) {
        problems.push({ reason: "codex-config-target-unresolved", itemId, operationId });
      } else if (last === "config.toml") {
        if (directory === ".codex") {
          problems.push({ reason: "codex-config-target", itemId, operationId });
        } else if (directory === undefined && segments.length >= 2) {
          problems.push({ reason: "codex-config-target-unresolved", itemId, operationId });
        }
      }
    }
  }
  return Object.freeze(problems);
}
