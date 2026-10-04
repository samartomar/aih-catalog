import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { contractSupport } from "../../src/release/contracts.js";
import { configureItem, readRelease, validateSelectionSet } from "../../src/release/reader.js";
import { fixtureRelease, type Json, releaseBytes, sha256 } from "./fixtures.js";

const root = resolve(import.meta.dirname, "../..");
const RELEASE_11 = "urn:aihq:catalog:release:1.1.0";
const RECIPE_11 = "urn:aihq:core:recipe:1.1.0";

type Release = ReturnType<typeof fixtureRelease>;
const items = (release: Release) => release.items as { [key: string]: Json }[];

/** A 1.1 release: `alpha` keeps recipe 1.0 and `beta` carries recipe 1.1 (a mixed release). */
function release11(): Release {
  const release = fixtureRelease();
  release.schema = RELEASE_11;
  (items(release)[1]?.recipe as Record<string, Json>).schema = RECIPE_11;
  return release;
}

const read = (document: unknown) => {
  const bytes = releaseBytes(document);
  return readRelease(bytes, { expectedSha256: sha256(bytes) });
};

describe("release 1.1 documents", () => {
  it("reads a mixed 1.0/1.1 recipe release and reports its own format", () => {
    const result = read(release11());
    expect(result.diagnostics).toEqual([]);
    expect(result.valid && result.release.schema).toBe(RELEASE_11);
    expect(result.valid && result.release.items.map((item) => item.recipe.schema)).toEqual([
      "urn:aihq:core:recipe:1.0.0",
      RECIPE_11,
    ]);
  });

  it("keeps reading a 1.0 release and its unchanged item identities", () => {
    const one = read(fixtureRelease());
    const mixed = read(release11());
    expect(one.valid && one.release.schema).toBe("urn:aihq:catalog:release:1.0.0");
    // alpha is byte-identical in both documents, so its identity is unchanged.
    expect(mixed.valid && mixed.release.items[0]?.itemSha256).toBe(
      one.valid && one.release.items[0]?.itemSha256,
    );
  });

  it("refuses a recipe 1.1 item inside a 1.0 release", () => {
    const document = fixtureRelease();
    (items(document)[1]?.recipe as Record<string, Json>).schema = RECIPE_11;
    const result = read(document);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => d.reason)).toEqual(["unsupported-recipe-schema"]);
  });

  it("names both supported release formats for an unknown one", () => {
    const document = fixtureRelease();
    document.schema = "urn:aihq:catalog:release:9.0.0";
    const result = read(document);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.supported).toEqual([
      "urn:aihq:catalog:release:1.0.0",
      RELEASE_11,
    ]);
  });

  it("is rejected whole by the published 1.0 structural schema", () => {
    const schema = JSON.parse(readFileSync(resolve(root, "schemas/release/1.0.0.json"), "utf8"));
    const validate10 = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    expect(validate10(release11())).toBe(false);
    expect(validate10(fixtureRelease())).toBe(true);
  });

  it("is accepted by the published 1.1 structural schema, which allows both recipe formats", () => {
    const schema = JSON.parse(readFileSync(resolve(root, "schemas/release/1.1.0.json"), "utf8"));
    expect(schema.$id).toBe(RELEASE_11);
    const validate11 = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    expect(validate11(release11())).toBe(true);
    expect(validate11(fixtureRelease())).toBe(false);
    const wrongRecipe = release11();
    (items(wrongRecipe)[0]?.recipe as Record<string, Json>).schema = "urn:aihq:core:recipe:9.0.0";
    expect(validate11(wrongRecipe)).toBe(false);
  });

  it("configures and selects a recipe 1.1 item through the ordinary reader operations", () => {
    const result = read(release11());
    if (!result.valid) throw new Error("fixture");
    const source = { kind: "local", input: "catalog" } as const;
    const alpha = configureItem({
      release: result.release,
      itemId: "alpha",
      configuration: {},
      materialSource: source,
    });
    expect(alpha.diagnostics).toEqual([]);
    expect(alpha.valid && alpha.selection?.recipe.reference.path).toBe(
      "release/recipes/alpha.json",
    );
    const set = validateSelectionSet({
      releases: { [result.release.sha256]: result.release },
      selections: [
        {
          id: "a",
          item: {
            releaseSha256: result.release.sha256,
            itemId: "alpha",
            itemSha256: result.release.items[0]?.itemSha256 as string,
          },
          configuration: {},
        },
      ],
    });
    expect(set.diagnostics).toEqual([]);
    expect(set.valid).toBe(true);
  });

  it("declares only the release and recipe formats Catalog actually produces", () => {
    const ids = contractSupport.contracts.map((contract) => contract.id);
    expect(ids).toEqual([
      "urn:aihq:catalog:release:1.0.0",
      "urn:aihq:core:recipe:1.0.0",
      RELEASE_11,
      RECIPE_11,
    ]);
    expect(contractSupport.contracts.find((c) => c.id === RELEASE_11)).toMatchObject({
      role: "produces",
      schemaExport: "@aihq/catalog/schemas/release/1.1.0.json",
    });
    expect(contractSupport.contracts.find((c) => c.id === RECIPE_11)).toMatchObject({
      role: "produces",
      schemaExport: "@aihq/core/schemas/recipe/1.1.0.json",
    });
  });
});
