import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { readRelease } from "../../src/release/reader.js";
import { fixtureRelease, releaseBytes, sha256 } from "./fixtures.js";

const root = resolve(import.meta.dirname, "../..");
const schema = JSON.parse(readFileSync(resolve(root, "schemas/release/1.3.0.json"), "utf8"));
const validate = new Ajv2020({ strict: true }).compile(schema);
const read = (value: unknown) => {
  const bytes = releaseBytes(value);
  return readRelease(bytes, { expectedSha256: sha256(bytes) });
};
const document = (origin: unknown) => ({
  ...fixtureRelease(),
  schema: "urn:aihq:catalog:release:1.3.0",
  sources: [{ id: "upstream", origin }],
});

it("agrees on pinned local origins and rejects them under every older schema", () => {
  for (const revision of ["a".repeat(40), "b".repeat(64)]) {
    const value = document({ kind: "local", revision });
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    const result = read(value);
    expect(result.valid, JSON.stringify(result.diagnostics)).toBe(true);
    if (result.valid) expect(result.release.sources).toEqual(value.sources);
    for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
      expect(read({ ...value, schema: `urn:aihq:catalog:release:${version}` }).valid).toBe(false);
    }
  }
});
it("refuses ambiguous local authority, missing revisions and malformed pins", () => {
  for (const origin of [
    { kind: "local" },
    { kind: "local", revision: "main" },
    { kind: "local", revision: "A".repeat(40) },
    { kind: "local", revision: "a".repeat(40), repository: "https://github.com/example/fake" },
    { kind: "local", revision: "a".repeat(40), path: "/private/tree" },
  ]) {
    const value = document(origin);
    expect(validate(value)).toBe(false);
    const result = read(value);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.path?.includes("origin"))).toBe(true);
  }
});
it("retains exact Git and npm provenance and item identity in the new release", () => {
  const old = read(fixtureRelease());
  for (const origin of [
    { kind: "git", repository: "https://github.com/example/real", revision: "c".repeat(40) },
    {
      kind: "npm",
      registry: "https://registry.npmjs.org",
      package: "@example/content",
      version: "1.2.3",
      integrity: "sha512-YWJjZA==",
    },
  ]) {
    const value = document(origin);
    expect(validate(value)).toBe(true);
    const result = read(value);
    expect(result.valid, JSON.stringify(result.diagnostics)).toBe(true);
    if (result.valid) {
      expect(result.release.sources).toEqual(value.sources);
      expect(result.release.items[0]?.itemSha256).toBe(
        old.valid && old.release.items[0]?.itemSha256,
      );
    }
  }
  expect(
    read(
      document({
        kind: "npm",
        registry: "https://registry.npmjs.org",
        package: "content",
        version: "latest",
        integrity: "sha512-YWJjZA==",
      }),
    ).valid,
  ).toBe(false);
});
