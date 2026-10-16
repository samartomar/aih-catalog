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

/**
 * Whether a path segment can be `name` (lower case): a literal only as itself, an input slot
 * only as one of its declared `enum` values, and an unconstrained slot or anything else always.
 * `literal` says whether the segment is a literal.
 */
const segmentCanBe = (
  segment: unknown,
  inputs: Record<string, unknown>,
  name: string,
): { readonly possible: boolean; readonly literal: boolean } => {
  if (isObject(segment) && typeof segment.literal === "string") {
    return { possible: segment.literal.toLowerCase() === name, literal: true };
  }
  const input =
    isObject(segment) && typeof segment.input === "string" ? inputs[segment.input] : undefined;
  if (isObject(input) && Array.isArray(input.enum)) {
    return {
      possible: input.enum.some(
        (value) => typeof value === "string" && value.toLowerCase() === name,
      ),
      literal: false,
    };
  }
  return { possible: true, literal: false };
};

/**
 * Stable problems for every `text.block` operation, in recipe and operation order, whose
 * target could be a Codex `config.toml` under any root: its last two segments can be
 * `.codex` and `config.toml`. The reason is `codex-config-target` when both segments are
 * literal, and `codex-config-target-unresolved` when either is an input slot whose declared
 * `enum` does not rule the name out. Names compare
 * case-insensitively. A Codex home outside a `.codex` directory is not recognised. Other
 * operation kinds and other paths are ignored; a recipe that is not an operation list is
 * ignored here because recipe agreement already refuses it. An operation without an id is
 * named by its zero-based position, `#<index>`.
 */
export function codexConfigBlockProblems(
  recipes: readonly { readonly itemId: string; readonly recipe: unknown }[],
): readonly CodexConfigBlockProblem[] {
  const problems: CodexConfigBlockProblem[] = [];
  for (const { itemId, recipe } of recipes) {
    if (!isObject(recipe) || !Array.isArray(recipe.operations)) continue;
    const inputs = isObject(recipe.inputs) ? recipe.inputs : {};
    (recipe.operations as unknown[]).forEach((operation, index) => {
      if (!isObject(operation) || operation.kind !== "text.block") return;
      if (!isObject(operation.target) || !Array.isArray(operation.target.segments)) return;
      const segments = operation.target.segments as unknown[];
      if (segments.length < 2) return;
      const file = segmentCanBe(segments[segments.length - 1], inputs, "config.toml");
      const directory = segmentCanBe(segments[segments.length - 2], inputs, ".codex");
      if (!file.possible || !directory.possible) return;
      const operationId = typeof operation.id === "string" ? operation.id : `#${index}`;
      const reason =
        file.literal && directory.literal
          ? "codex-config-target"
          : "codex-config-target-unresolved";
      problems.push({ reason, itemId, operationId });
    });
  }
  return Object.freeze(problems);
}
