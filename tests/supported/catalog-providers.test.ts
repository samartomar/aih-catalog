import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  policyAuthoringCatalogV1,
  readPolicyAuthoringCatalogInputsV1,
} from "../../src/production/catalog/policy-authoring-catalog-v1.js";
import { canonicalDigestV1 } from "../../src/production/strict-json-v1.js";
import { assembleCompilerOutputsV1 } from "../../src/production/workbench/assembly-v1.js";
import { compileCatalogProvidersV1 } from "../../src/production/workbench/catalog-providers-v1.js";
import { compilerFormatRegistrationsV1 } from "../../src/production/workbench/compiler-formats-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const json = (...path: string[]): unknown =>
  JSON.parse(readFileSync(resolve(root, ...path), "utf8"));

interface PublishedAdmission {
  providerAdmissions: {
    providerId: string;
    providerVersion: string;
    inputDigest: string;
    compilerInputsDigest: string;
  }[];
  providerRegistrations: { providerId: string; providerVersion: string }[];
  coreCapabilitiesDigest: string;
  compilerRegistrationsDigest: string;
}

function compile() {
  const inputs = readPolicyAuthoringCatalogInputsV1(root);
  const catalog = policyAuthoringCatalogV1(inputs);
  const compiled = compileCatalogProvidersV1({
    catalog,
    vendorSources: inputs.vendorLock.sources,
    mattpocockSnapshot: json("src", "production", "data", "mattpocock.snapshot.json"),
  });
  return { inputs, compiled };
}

describe("catalog provider compilation", () => {
  it("reproduces every provider admission the published authoring bundle recorded", () => {
    const published = json("defaults", "catalog-authoring-bundle-v1.json") as {
      production: { admission: PublishedAdmission };
    };
    const admission = published.production.admission;
    const { compiled } = compile();
    expect(
      compiled.providers.map((provider) => ({
        providerId: provider.providerId,
        providerVersion: provider.providerVersion,
        inputDigest: provider.inputDigest,
        compilerInputsDigest: canonicalDigestV1(provider.inputs),
      })),
    ).toEqual(admission.providerAdmissions);
    expect(
      compiled.providers.map(({ providerId, providerVersion }) => ({
        providerId,
        providerVersion,
      })),
    ).toEqual(admission.providerRegistrations);
    expect(canonicalDigestV1(compiled.coreCapabilities)).toBe(admission.coreCapabilitiesDigest);
    expect(canonicalDigestV1(compilerFormatRegistrationsV1)).toBe(
      admission.compilerRegistrationsDigest,
    );
  });

  it("assembles one integrity-sealed bundle from the provider outputs", () => {
    const { inputs, compiled } = compile();
    const targets = inputs.core.hosts
      .filter((host) => host.policyTarget === true)
      .map((host) => String(host.id));
    const bundle = assembleCompilerOutputsV1(
      compiled.providers.flatMap((provider) => provider.inputs),
      compiled.coreCapabilities,
      targets,
    );
    expect(Object.keys(bundle.sources).sort()).toEqual([
      "source:aih-core",
      "source:ecc",
      "source:mattpocock",
      "source:superpowers",
    ]);
    expect(bundle.provenance.bundleDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("refuses to assemble two providers that declare the same asset", () => {
    const { inputs, compiled } = compile();
    const aih = compiled.providers.find((provider) => provider.providerId === "aih");
    expect(() =>
      assembleCompilerOutputsV1(
        [...(aih?.inputs ?? []), ...(aih?.inputs ?? [])],
        compiled.coreCapabilities,
        inputs.core.hosts.map((host) => String(host.id)),
      ),
    ).toThrow(/duplicate compiled asset/u);
  });
});
