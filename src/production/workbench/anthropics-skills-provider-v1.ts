import type { CatalogCompilerAssemblyInputV1 } from "./compiler-formats-v1.js";
import { compileIdentifiedComponentCollectionV1 } from "./ponytail-provider-v1.js";

export const ANTHROPICS_SKILLS_SOURCE_ID_V1 = "anthropics-skills";
export const ANTHROPICS_SKILLS_REPOSITORY_V1 = "https://github.com/anthropics/skills";

/**
 * anthropics/skills has no fetched snapshot in the Catalog: it compiles from an explicitly
 * named T3 compiler input (tools/emit-compiler-input.mjs anthropics-skills), the curated
 * component template with its file bytes at the pin.
 */
export function compileAnthropicsSkillsComponentCollectionV1(
  input: unknown,
): CatalogCompilerAssemblyInputV1 {
  return compileIdentifiedComponentCollectionV1(
    input,
    ANTHROPICS_SKILLS_SOURCE_ID_V1,
    ANTHROPICS_SKILLS_REPOSITORY_V1,
    "anthropics-skills",
  );
}
