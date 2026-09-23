import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const example = "examples/read-the-catalog.mjs";
const source = readFileSync(resolve(root, example), "utf8");
/** The example with its comment lines removed: only code is held to the rules below. */
const code = source
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("//"))
  .join("\n");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
  files: string[];
};

describe("public-API example", () => {
  it("uses only the package root, its declared subpaths and Node builtins", () => {
    const specifiers = [
      ...code.matchAll(/from "([^"]+)"/gu),
      ...code.matchAll(/require\.resolve\("([^"]+)"\)/gu),
    ].map(([, specifier]) => specifier as string);
    expect(specifiers).toContain("@aihq/catalog");
    expect(specifiers).toContain("@aihq/catalog/package.json");
    for (const specifier of specifiers) {
      if (specifier.startsWith("node:") || specifier === "@aihq/catalog") continue;
      const subpath = specifier.replace(/^@aihq\/catalog/u, ".");
      expect(packageJson.exports, specifier).toHaveProperty([subpath]);
    }
    // Every JSON subpath is read through one helper that prefixes the package name.
    expect(code).toContain(["require.resolve(`@aihq/catalog/$", "{subpath}`)"].join(""));
    const subpaths = [...code.matchAll(/bytesAt\("([^"]+)"\)/gu)].map(([, name]) => name);
    expect(subpaths).toEqual([
      "catalog-index.json",
      "catalog-collections.json",
      "catalog-presentation.json",
      "catalog-qualification.json",
      "catalog-runtime-descriptors.json",
    ]);
    for (const subpath of subpaths) {
      expect(packageJson.exports, subpath).toHaveProperty([`./${subpath}`]);
    }
    expect(code).not.toMatch(/dist\/|\.\.\/src|defaults\//u);
    // The package root is found through a declared export, not a relative path.
    expect(packageJson.exports["./package.json"]).toBe("./package.json");
    // The example is repository material; the published file list is unchanged.
    expect(packageJson.files).toEqual(["dist", "defaults", "README.md"]);
  });

  // The example imports the built package through its own name, so it needs `dist/`.
  it.skipIf(!existsSync(resolve(root, "dist/index.js")))(
    "reads every public route and reports expiry honestly",
    () => {
      const run = (now: string) =>
        spawnSync(process.execPath, [example, "--now", now], { cwd: root, encoding: "utf8" });
      const current = run("2026-09-22T12:00:00Z");
      expect(current.status, current.stderr).toBe(0);
      const report = JSON.parse(current.stdout);
      expect(report.index.entries).toBe(457);
      expect(report.collections.map((c: { owner: string }) => c.owner)).toEqual([
        "@aihq/core",
        "@aihq/catalog",
      ]);
      expect(report.qualification).toMatchObject({
        attestation: "absent",
        organizationAdmission: "not-authoritative",
        signature: "not-evaluated",
        states: { qualified: 457 },
      });
      expect(report.runtimeDescriptors).toEqual([
        {
          framework: "ecc",
          format: "ecc-runtime-descriptor/v1",
          source: "affaan-m/ECC@5064474d4d762dc9640234a41617cccb79185cec",
          sha256: "158f63e265f1ca18a7e65c97e372b1259200d6fb60eab87d70c20600d9d9abf0",
          state: "verified",
        },
      ]);
      expect(report.sourceClosure.files).toContain(
        "packs/governance-quality/aih-gov-doctor/SKILL.md",
      );
      const expired = JSON.parse(run("2026-12-08T00:47:41Z").stdout);
      expect(expired.qualification.states).toEqual({ expired: 457 });
    },
    60_000,
  );
});
