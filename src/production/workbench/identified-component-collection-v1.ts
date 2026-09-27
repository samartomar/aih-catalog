import {
  type CatalogCompilerAssemblyInputV1,
  compilerRegistrationForInputFormatV1,
} from "./compiler-formats-v1.js";
import { compilePinnedComponentCollectionV1 } from "./pinned-component-collection-v1.js";

/**
 * A pinned component collection compiled as the assembly input of one exact source, the way
 * Core compiled the packaged collection records (distributor @aihq/core, git upstream origin).
 */
export function compileIdentifiedComponentCollectionV1(
  input: unknown,
  sourceId: string,
  repository: string,
  label: string,
): CatalogCompilerAssemblyInputV1 {
  const result = compilePinnedComponentCollectionV1(input);
  if (result.source.id !== `source:${sourceId}` || result.source.repository !== repository)
    throw new TypeError(`${label} provider requires its exact source identity`);
  return {
    sources: {
      [result.source.id]: {
        id: result.source.id,
        distributor: { kind: "aih", locator: "@aihq/core" },
        upstreamOrigin: { kind: "git", locator: result.source.repository },
        inputFormat: result.source.inputFormat,
        revision: { id: result.source.revisionId, contentDigest: result.source.contentDigest },
        compiler: compilerRegistrationForInputFormatV1(result.source.inputFormat),
      },
    },
    declarations: result.declarations,
    relations: result.relations,
    groups: result.groups,
    templates: result.templates,
    detailBytes: result.detailBytes,
  };
}
