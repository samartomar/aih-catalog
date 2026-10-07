import { canonicalDigestV1 } from "../strict-json-v1.js";
import {
  type CatalogCompilerAssemblyInputV1,
  rejectTrustedCompilerEvidenceV1,
} from "./compiler-formats-v1.js";

export interface CatalogProviderCompilationV1 {
  providerId: string;
  providerVersion: string;
  inputDigest: string;
  inputs: readonly CatalogCompilerAssemblyInputV1[];
}

const ASSEMBLY_FIELDS = new Set([
  "sources",
  "declarations",
  "relations",
  "groups",
  "templates",
  "evidence",
  "detailBytes",
]);

/** Provider identity describes build ownership, never compiler or Core authority. */
export function compileCatalogProviderV1<Input>(
  providerId: string,
  compile: (input: Input) => readonly CatalogCompilerAssemblyInputV1[],
  input: Input,
  providerVersion = "1",
): CatalogProviderCompilationV1 {
  if (!/^[a-z][a-z0-9-]*$/.test(providerId) || !/^[0-9]+$/.test(providerVersion))
    throw new TypeError("invalid catalog provider identity");
  const inputs = compile(input);
  if (!Array.isArray(inputs) || inputs.length === 0)
    throw new TypeError("catalog provider produced no assembly input");
  for (const output of inputs)
    if (Object.keys(output).some((key) => !ASSEMBLY_FIELDS.has(key)))
      throw new TypeError("catalog provider supplied unsupported assembly fields");
  rejectTrustedCompilerEvidenceV1(inputs);
  return { providerId, providerVersion, inputDigest: canonicalDigestV1(input), inputs };
}
