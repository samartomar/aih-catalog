import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { listItems, readRelease } from "../../src/release/reader.js";
import {
  canonical,
  MATT_ITEM_IDS,
  MATT_REQUIRED,
  MATT_SOURCE_REVISION,
  sha256,
} from "./fixtures.js";

const root = resolve(import.meta.dirname, "../..");
const bytesAt = (path: string) => readFileSync(resolve(root, path));
const pkg = JSON.parse(bytesAt("package.json").toString("utf8"));

/**
 * Core's generic recipe schema, vendored as a test fixture. Pinned by the
 * packaged bytes and by the canonical JSON content so a reformatting cannot hide
 * a contract change.
 */
const CORE_RECIPE_SCHEMA = "tests/fixtures/core/recipe-1.0.0.schema.json";
const CORE_RECIPE_SCHEMA_SHA256 =
  "d94ae4060a2a8f3dcf105b9d476966ee532476825ccc8b7129247e7f951772b6";
const CORE_RECIPE_SCHEMA_CANONICAL_SHA256 =
  "14288dff370dffcfd9ac258b17d1fd5dfe6107f4ffb0b6605681913c00272a7f";

/** These two unchanged skill bytes and MIT license retain their independent donor digests. */
const UPSTREAM_REVISION = MATT_SOURCE_REVISION;
const GRILLING_SKILL_SHA256 = "10ff989e7498b23b5acb49d5048f11dcd906757d2f79c5cdf8a00001381296f2";
const GRILL_ME_SKILL_SHA256 = "caaf8b8de1684f96e26b28f3c29189db5c89cce4b73e1c93d86164f66ef88637";
const MIT_LICENSE_SHA256 = "0e7ac423bf2c6e223b7c5b156f8cf72da49d748e56a1641402c31f22ad07dbb5";

function carried() {
  const bytes = bytesAt("release/release.json");
  const result = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
  return result.release;
}

describe("carried release", () => {
  it("checks authored content independently after the targeted release advances", () => {
    // The generator renders the authored context through the built release module.
    if (!existsSync(resolve(root, "dist/release/project-context.js")))
      throw new Error("run npm run build:dist first");
    const output = execFileSync(process.execPath, ["tools/generate-release.mjs", "--check"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(output).toContain("Checked authored context");
  });

  it("describes the containing package and the pinned upstream sources", () => {
    const release = carried();
    expect(release.package).toEqual({ name: pkg.name, version: pkg.version });
    expect(release.sources).toEqual([
      { id: "aihq-project-context", origin: { kind: "authored" } },
      {
        id: "mattpocock-skills-d81f3a183412",
        origin: {
          kind: "git",
          repository: "https://github.com/mattpocock/skills",
          revision: UPSTREAM_REVISION,
        },
      },
    ]);
    expect(
      listItems(release)
        .filter((item) => item.id.startsWith("mattpocock."))
        .map((item) => item.id),
    ).toEqual(MATT_ITEM_IDS);
    for (const item of listItems(release).filter((entry) => entry.id.startsWith("mattpocock."))) {
      expect(item.sourceIds).toEqual(["mattpocock-skills-d81f3a183412"]);
      expect(item.dependencies.requires).toEqual(
        (MATT_REQUIRED[item.id] ?? []).map((itemId) => ({ itemId })),
      );
    }
  });

  it("retains unchanged upstream skill bytes and the exact MIT notice for every refreshed skill", () => {
    const members = Object.fromEntries(
      listItems(carried())
        .filter((item) => item.id.startsWith("mattpocock."))
        .flatMap((item) => item.materials.map((m) => [`${item.id}/${m.id}`, m.sha256])),
    );
    expect(members).toMatchObject({
      "mattpocock.grill-me/license": MIT_LICENSE_SHA256,
      "mattpocock.grill-me/skill": GRILL_ME_SKILL_SHA256,
      "mattpocock.grilling/license": MIT_LICENSE_SHA256,
      "mattpocock.grilling/skill": GRILLING_SKILL_SHA256,
    });
    for (const id of MATT_ITEM_IDS) expect(members[`${id}/license`]).toBe(MIT_LICENSE_SHA256);
  });

  it("has every declared recipe and material byte-exact at its package path, and nothing else", () => {
    // The 1.1 release of authored hook items is checked in hook-release.test.ts; its members
    // share the release directory and are declared here with the 1.0 release.
    const hookBytes = bytesAt("release/release-1.1.json");
    const hookRead = readRelease(hookBytes, { expectedSha256: sha256(hookBytes) });
    if (!hookRead.valid) throw new Error(JSON.stringify(hookRead.diagnostics));
    // The native-fixture documents are checked in native-fixture-release.test.ts and share the directory.
    const nativeDocuments = [
      "release/release-native-fixture.json",
      "release/release-native-bundles.json",
    ].map((path) => {
      const bytes = bytesAt(path);
      const read = readRelease(bytes, { expectedSha256: sha256(bytes) });
      if (!read.valid) throw new Error(JSON.stringify(read.diagnostics));
      return read.release;
    });
    const declared = new Set<string>([
      "release/release.json",
      "release/release-1.1.json",
      "release/release-native-fixture.json",
      "release/release-native-bundles.json",
    ]);
    for (const item of [
      ...listItems(carried()),
      ...listItems(hookRead.release),
      ...nativeDocuments.flatMap((release) => listItems(release)),
    ]) {
      for (const member of [item.recipe, ...item.materials]) {
        const bytes = bytesAt(member.path);
        expect(sha256(bytes), member.path).toBe(member.sha256);
        expect(bytes.byteLength, member.path).toBe(member.byteLength);
        declared.add(member.path);
      }
    }
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name))
          : [relative(root, join(dir, entry.name)).replaceAll("\\", "/")],
      );
    expect(new Set(walk(resolve(root, "release")))).toEqual(declared);
  });

  it("uses complete Core recipes whose definitions agree with each item", () => {
    const schemaBytes = bytesAt(CORE_RECIPE_SCHEMA);
    expect(sha256(schemaBytes)).toBe(CORE_RECIPE_SCHEMA_SHA256);
    expect(sha256(bytesAt("schemas/core-recipe/1.0.0.json"))).toBe(CORE_RECIPE_SCHEMA_SHA256);
    const schema = JSON.parse(schemaBytes.toString("utf8"));
    expect(sha256(canonical(schema))).toBe(CORE_RECIPE_SCHEMA_CANONICAL_SHA256);
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    for (const item of listItems(carried())) {
      const recipe = JSON.parse(bytesAt(item.recipe.path).toString("utf8"));
      expect(validate(recipe), JSON.stringify(validate.errors)).toBe(true);
      expect(recipe.id).toBe(item.recipe.id);
      expect(recipe.inputs).toEqual(item.inputs);
      expect(recipe.prerequisites).toEqual(item.targets);
      expect(item.scopes.every((scope) => recipe.targets.includes(scope))).toBe(true);
      expect(recipe.materials).toEqual(
        item.materials.map(({ id, sha256: hash, byteLength }) => ({
          id,
          sha256: hash,
          byteLength,
        })),
      );
      // Every material is delivered by a file.write whose supplied check pins the same bytes.
      const checks = new Map(recipe.checks.map((check: { id: string }) => [check.id, check]));
      for (const material of item.materials) {
        const write = recipe.operations.find(
          (op: { kind: string; material?: string }) =>
            op.kind === "file.write" && op.material === material.id,
        );
        expect(write, material.id).toBeDefined();
        const [checkId] = write.checks;
        expect(checks.get(checkId)).toMatchObject({
          kind: "file.sha256",
          sha256: material.sha256,
          target: write.target,
        });
      }
    }
  });
});
