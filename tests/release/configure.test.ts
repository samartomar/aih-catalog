import { describe, expect, it } from "vitest";
import type { CatalogRelease, Json, MaterialSource } from "../../src/release/contracts.js";
import { configureItem, readRelease } from "../../src/release/reader.js";
import { canonical, fixtureRelease, releaseBytes, sha256 } from "./fixtures.js";

function checked(): CatalogRelease {
  const bytes = releaseBytes(fixtureRelease());
  const result = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
  return result.release;
}
const local: MaterialSource = { kind: "local", input: "catalog" };
const archive: MaterialSource = {
  kind: "archive",
  url: "https://registry.example.org/@example/catalog/-/catalog-1.2.0.tgz",
  sha256: sha256("archive"),
  byteLength: 4096,
};
const reasons = (result: { diagnostics: readonly { reason: string }[] }) =>
  result.diagnostics.map((d) => d.reason);

describe("configureItem", () => {
  it("maps a local source to package-relative members and keeps omitted inputs omitted", () => {
    const release = checked();
    const result = configureItem({
      release,
      itemId: "alpha",
      configuration: {},
      materialSource: local,
    });
    expect(reasons(result)).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.selection).toEqual({
      recipe: {
        reference: {
          source: { kind: "local", input: "catalog" },
          path: "release/recipes/alpha.json",
          sha256: sha256("alpha-recipe"),
          byteLength: 900,
          materials: [
            {
              id: "license",
              path: "release/materials/LICENSE",
              sha256: sha256("license"),
              byteLength: 1068,
            },
            {
              id: "skill",
              path: "release/materials/alpha/SKILL.md",
              sha256: sha256("alpha"),
              byteLength: 157,
            },
          ],
        },
      },
      configuration: {},
    });
    expect(result.inputs).toEqual({ agentDirectory: { origin: "default", required: true } });
    const document = fixtureRelease();
    expect(result.provenance).toEqual({
      package: { name: "@example/catalog", version: "1.2.0" },
      manifestSha256: release.sha256,
      itemId: "alpha",
      itemSha256: sha256(canonical((document.items as Json[])[0])),
    });
    expect(result.dependencies).toEqual({ requires: [], optional: [], conflicts: [] });
  });

  it("maps an archive source to the fixed package/ member prefix", () => {
    const result = configureItem({
      release: checked(),
      itemId: "alpha",
      configuration: { agentDirectory: ".agents" },
      materialSource: archive,
    });
    expect(result.valid).toBe(true);
    const reference = result.selection?.recipe.reference;
    expect(reference?.source).toEqual(archive);
    expect(reference?.path).toBe("package/release/recipes/alpha.json");
    expect(reference?.materials.map((member) => member.path)).toEqual([
      "package/release/materials/LICENSE",
      "package/release/materials/alpha/SKILL.md",
    ]);
    expect(result.selection?.configuration).toEqual({ agentDirectory: ".agents" });
    expect(result.inputs).toEqual({ agentDirectory: { origin: "explicit", required: true } });
  });

  it("keeps template-like strings as plain data and never mutates the caller's object", () => {
    const configuration = { serverUrl: "${HOME}/{{token}}", enabled: false };
    const result = configureItem({
      release: checked(),
      itemId: "beta",
      configuration,
      materialSource: local,
    });
    expect(result.valid).toBe(true);
    expect(result.selection?.configuration).toEqual({
      serverUrl: "${HOME}/{{token}}",
      enabled: false,
    });
    expect(configuration).toEqual({ serverUrl: "${HOME}/{{token}}", enabled: false });
    expect(result.selection?.configuration).not.toBe(configuration);
    expect(result.inputs).toEqual({
      serverUrl: { origin: "explicit", required: true },
      enabled: { origin: "explicit", required: false },
      retries: { origin: "omitted", required: false },
      token: { origin: "host", required: true },
      mode: { origin: "omitted", required: false },
    });
    expect(result.dependencies.requires).toEqual([{ itemId: "alpha" }]);
  });

  it.each([
    [
      "unknown name",
      { serverUrl: "https://a", colour: "red" },
      "input-unknown",
      "/configuration/colour",
    ],
    [
      "no coercion of booleans",
      { serverUrl: "https://a", enabled: "true" },
      "input-value",
      "/configuration/enabled",
    ],
    [
      "fractional integer",
      { serverUrl: "https://a", retries: 1.5 },
      "input-value",
      "/configuration/retries",
    ],
    [
      "integer above maximum",
      { serverUrl: "https://a", retries: 6 },
      "input-value",
      "/configuration/retries",
    ],
    [
      "value outside enum",
      { serverUrl: "https://a", mode: "slow" },
      "input-value",
      "/configuration/mode",
    ],
    ["required ordinary input omitted", {}, "input-required", "/configuration/serverUrl"],
    [
      "portable secret",
      { serverUrl: "https://a", token: "s3cret" },
      "input-sensitive",
      "/configuration/token",
    ],
    ["non-scalar value", { serverUrl: { input: "x" } }, "input-value", "/configuration/serverUrl"],
  ] as [
    string,
    Record<string, Json>,
    string,
    string,
  ][])("refuses %s", (_name, configuration, reason, path) => {
    const result = configureItem({
      release: checked(),
      itemId: "beta",
      configuration,
      materialSource: local,
    });
    expect(result.valid).toBe(false);
    expect(result.selection).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ reason, path, itemId: "beta" }),
    );
    expect(JSON.stringify(result)).not.toContain("s3cret");
  });

  it.each([
    ["plain HTTP archive", { ...archive, url: "http://registry.example.org/a.tgz" }],
    ["unsized archive", { ...archive, byteLength: 0 }],
    ["local root path smuggled as input", { kind: "local", input: "C:/Users/someone" }],
    ["extra source field", { ...local, root: "/tmp" }],
  ] as [string, MaterialSource][])("refuses %s as a material source", (_name, materialSource) => {
    const result = configureItem({
      release: checked(),
      itemId: "alpha",
      configuration: {},
      materialSource,
    });
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain("invalid-source");
  });

  it("names a missing item and refuses a release view it did not check", () => {
    const missing = configureItem({
      release: checked(),
      itemId: "gamma",
      configuration: {},
      materialSource: local,
    });
    expect(reasons(missing)).toEqual(["item-not-found"]);
    const forged = JSON.parse(JSON.stringify(checked())) as CatalogRelease;
    const refused = configureItem({
      release: forged,
      itemId: "alpha",
      configuration: {},
      materialSource: local,
    });
    expect(reasons(refused)).toEqual(["release-unchecked"]);
  });
});
