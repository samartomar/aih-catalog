import {
  type CatalogCompilerAssemblyInputV1,
  compilerRegistrationForInputFormatV1,
} from "./compiler-formats-v1.js";
import { compilePinnedComponentCollectionV1 } from "./pinned-component-collection-v1.js";

export const PONYTAIL_SOURCE_ID_V1 = "ponytail";
export const PONYTAIL_REPOSITORY_V1 = "https://github.com/DietrichGebert/ponytail";

/**
 * The Ponytail snapshot is the hand-authored component declaration plus the
 * upstream file bytes `produce:ponytail` fetched at the pinned commit.
 */
export function compilePonytailComponentCollectionV1(
  input: unknown,
): CatalogCompilerAssemblyInputV1 {
  const result = compilePinnedComponentCollectionV1(input);
  if (
    result.source.id !== `source:${PONYTAIL_SOURCE_ID_V1}` ||
    result.source.repository !== PONYTAIL_REPOSITORY_V1
  )
    throw new TypeError("Ponytail provider requires its exact source identity");
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
