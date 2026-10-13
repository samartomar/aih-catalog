import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { contractSupport } from "../../src/release/contracts.js";
import { configureItem, readRelease } from "../../src/release/reader.js";
import { fixtureRelease, type Json, releaseBytes, sha256 } from "./fixtures.js";

const root = resolve(import.meta.dirname, "../..");
const releaseSchema = "urn:aihq:catalog:release:1.2.0";
const recipeSchema = "urn:aihq:core:recipe:1.3.0";
const document = () => {
  const value = fixtureRelease();
  value.schema = releaseSchema;
  const items = value.items as Record<string, Json>[];
  (items[1]?.recipe as Record<string, Json>).schema = recipeSchema;
  return value;
};
const read = (value: unknown) => {
  const bytes = releaseBytes(value);
  return readRelease(bytes, { expectedSha256: sha256(bytes) });
};

describe("release 1.2 format admission", () => {
  it("admits explicit recipe 1.3 and configures through the ordinary portable reader", () => {
    const result = read(document());
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("fixture");
    expect(result.release.items[1]?.recipe.schema).toBe(recipeSchema);
    expect(
      configureItem({
        release: result.release,
        itemId: "alpha",
        configuration: {},
        materialSource: { kind: "local", input: "catalog" },
      }).valid,
    ).toBe(true);
    expect(contractSupport.contracts.some((entry) => entry.id === recipeSchema)).toBe(true);
  });
  it("preserves previous release boundaries and refuses unknown recipe versions", () => {
    for (const schema of ["urn:aihq:catalog:release:1.0.0", "urn:aihq:catalog:release:1.1.0"]) {
      expect(read({ ...document(), schema }).valid).toBe(false);
    }
    const value = document();
    const items = value.items as Record<string, Json>[];
    (items[1]?.recipe as Record<string, Json>).schema = "urn:aihq:core:recipe:9.0.0";
    expect(read(value).valid).toBe(false);
  });
  it("agrees with its exported structural schema and preserves the older item identity", () => {
    const schema = JSON.parse(readFileSync(resolve(root, "schemas/release/1.2.0.json"), "utf8"));
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate(document())).toBe(true);
    expect(validate(fixtureRelease())).toBe(false);
    const old = read(fixtureRelease()),
      next = read(document());
    expect(old.valid && old.release.items[0]?.itemSha256).toBe(
      next.valid && next.release.items[0]?.itemSha256,
    );
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(pkg.exports["./schemas/release/1.2.0.json"]).toBe("./schemas/release/1.2.0.json");
  });
});
