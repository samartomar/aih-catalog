import {
  cpSync,
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readInstalledRelease } from "../../src/release/node.js";
import { configureItem } from "../../src/release/reader.js";
import { sha256 } from "./fixtures.js";
import { installedRoot, rewriteRecipe } from "./installed-fixture.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function root(prefix = "installed") {
  const fixture = installedRoot(prefix);
  cleanups.push(fixture.cleanup);
  return fixture.root;
}
const material = (base: string, file: string) =>
  join(
    base,
    "release",
    "materials",
    "github.com",
    "mattpocock",
    "skills",
    "c55ee46073ed923f86ce59a5eb3b6d895095d1b7",
    ...file.split("/"),
  );
const reasons = (result: { diagnostics: readonly { reason: string }[] }) =>
  result.diagnostics.map((d) => d.reason);

describe("readInstalledRelease", () => {
  it("reads an explicitly selected installed root into a checked release and a bindable local source", async () => {
    const base = root();
    const result = await readInstalledRelease({ root: base, sourceInput: "catalog" });
    expect(reasons(result)).toEqual([]);
    expect(result.valid).toBe(true);
    const manifest = readFileSync(join(base, "release", "release.json"));
    expect(result.release?.sha256).toBe(sha256(manifest));
    expect(result.source).toEqual({ kind: "local", input: "catalog" });
    expect(result.materialRoots).toEqual({ catalog: realpathSync.native(base) });
    expect(result.provenance).toEqual({
      kind: "installed",
      package: result.release?.package,
      manifestPath: "release/release.json",
      manifestSha256: sha256(manifest),
    });
    expect(existsSync(join(base, "IMPORTED"))).toBe(false);
  });

  it("hands configureItem package-relative members for the local source", async () => {
    const result = await readInstalledRelease({ root: root(), sourceInput: "catalog" });
    if (!result.release || !result.source) throw new Error("unreadable");
    const configured = configureItem({
      release: result.release,
      itemId: "mattpocock.grilling",
      configuration: {},
      materialSource: result.source,
    });
    expect(configured.valid).toBe(true);
    expect(configured.selection?.recipe.reference.path).toBe(
      "release/recipes/mattpocock.grilling.json",
    );
  });

  it.each([
    ["a relative root", () => ({ root: "node_modules/@aihq/catalog" }), "invalid-root"],
    ["a missing root", () => ({ root: join(root(), "absent") }), "root-unavailable"],
    [
      "an invalid source input name",
      () => ({ root: root(), sourceInput: "C:/x" }),
      "invalid-source-input",
    ],
  ] as [
    string,
    () => { root: string; sourceInput?: string },
    string,
  ][])("refuses %s", async (_name, request, reason) => {
    expect(reasons(await readInstalledRelease(request()))).toContain(reason);
  });

  it("refuses tampered, truncated and missing members", async () => {
    const tampered = root("tampered");
    const skill = material(tampered, "skills/productivity/grilling/SKILL.md");
    const original = readFileSync(skill);
    writeFileSync(skill, Buffer.concat([original.subarray(0, -1), Buffer.from("!")]));
    expect(reasons(await readInstalledRelease({ root: tampered }))).toContain(
      "member-sha256-mismatch",
    );
    writeFileSync(skill, original.subarray(0, 10));
    expect(reasons(await readInstalledRelease({ root: tampered }))).toContain(
      "member-length-mismatch",
    );
    rmSync(skill);
    const missing = await readInstalledRelease({ root: tampered });
    expect(missing.valid).toBe(false);
    expect(missing.diagnostics).toContainEqual(
      expect.objectContaining({
        reason: "member-missing",
        path: "release/materials/github.com/mattpocock/skills/c55ee46073ed923f86ce59a5eb3b6d895095d1b7/skills/productivity/grilling/SKILL.md",
      }),
    );
  });

  it("refuses a member reached through a link that leaves the package root", async () => {
    const base = root("linked");
    const outside = join(base, "..", "..", "..", "outside-materials");
    const materials = join(base, "release", "materials");
    cpSync(materials, outside, { recursive: true });
    renameSync(materials, `${materials}-moved`);
    try {
      symlinkSync(outside, materials, "junction");
    } catch {
      return; // The host cannot create directory links; nothing to assert here.
    }
    expect(reasons(await readInstalledRelease({ root: base }))).toContain("unsafe-member");
  });

  it("refuses a release whose package identity differs from the installed package", async () => {
    const base = root("identity");
    const pkg = JSON.parse(readFileSync(join(base, "package.json"), "utf8"));
    writeFileSync(join(base, "package.json"), JSON.stringify({ ...pkg, version: "9.9.9" }));
    expect(reasons(await readInstalledRelease({ root: base }))).toContain("package-mismatch");
  });

  it("refuses an export that leaves the package root", async () => {
    const base = root("export");
    const pkg = JSON.parse(readFileSync(join(base, "package.json"), "utf8"));
    writeFileSync(
      join(base, "package.json"),
      JSON.stringify({ ...pkg, exports: { "./release.json": "../release.json" } }),
    );
    expect(reasons(await readInstalledRelease({ root: base }))).toContain("invalid-export");
  });

  it.each([
    [
      "inputs",
      (r: Record<string, unknown>) => {
        (r.inputs as Record<string, Record<string, unknown>>).agentDirectory!.maxLength = 8;
      },
      "recipe-inputs-mismatch",
    ],
    [
      "material closure",
      (r: Record<string, unknown>) => {
        (r.materials as unknown[]).pop();
      },
      "recipe-materials-mismatch",
    ],
    [
      "prerequisites",
      (r: Record<string, unknown>) => {
        r.prerequisites = [{ kind: "executable", name: "git" }];
      },
      "recipe-targets-mismatch",
    ],
    [
      "scopes",
      (r: Record<string, unknown>) => {
        r.targets = ["user"];
      },
      "recipe-scope-mismatch",
    ],
    [
      "recipe id",
      (r: Record<string, unknown>) => {
        r.id = "other";
      },
      "recipe-id-mismatch",
    ],
    [
      "recipe format",
      (r: Record<string, unknown>) => {
        r.schema = "urn:aihq:core:recipe:2.0.0";
      },
      "recipe-schema-mismatch",
    ],
  ] as [
    string,
    (r: Record<string, unknown>) => void,
    string,
  ][])("refuses a loaded recipe whose %s disagree with the item", async (_name, change, reason) => {
    const base = root("agreement");
    rewriteRecipe(base, "mattpocock.grilling", change);
    const result = await readInstalledRelease({ root: base });
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ reason, itemId: "mattpocock.grilling" }),
    );
  });

  it("stops when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      reasons(await readInstalledRelease({ root: root(), signal: controller.signal })),
    ).toEqual(["cancelled"]);
  });
});
