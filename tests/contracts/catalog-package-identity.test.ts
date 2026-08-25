import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STRICT_V2_CORE_LOCK } from "../../src/index.js";

const root = resolve(import.meta.dirname, "..", "..");
const coreCommit = "74ddf3439df47a947a6f7a022515099602702ac8";
const corePackageManifestSha256 =
  "af64feda4e3e57808e1a262e15a5cb8f41581f77e8f9b49eb9b459317b803ecd";

function git(cwd: string, args: readonly string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

describe("Catalog package identity and current Core lock", () => {
  it("exposes the 0.1 Catalog source identity while preserving the aih-supported command", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;

    expect(packageJson.name).toBe("@aihq/catalog");
    expect(packageJson.version).toBe("0.1.0");
    expect(packageJson).not.toHaveProperty("private");
    expect(packageJson.bin).toEqual({ "aih-supported": "dist/cli.js" });
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    expect(packageJson.scripts).not.toMatchObject({ publish: expect.any(String) });
  });

  it("binds the public Catalog contract and verification tools to exact current Core bytes", () => {
    expect(STRICT_V2_CORE_LOCK).toEqual({
      coreCommit,
      corePackageManifestSha256,
      corePackageName: "@aihq/core",
      corePackageVersion: "0.1.0",
      receiptMaxBytes: 5970,
      receiptSchemaSha256: "40a2522dfd05b370c537dc5d9b05ddc3fe2a1d6e1b6448fa50b97d53d2d2477f",
      receiptSourceMaxBytes: 4096,
      schemaSha256: "27295aee8d8be333abe2c73adc72884b534b1c9980a9b7a39d12be8d34c5caff",
    });

    const verifier = readFileSync(resolve(root, "tools/verify-core-v2-lock.mjs"), "utf8");
    expect(verifier).toContain(coreCommit);
    expect(verifier).toContain(corePackageManifestSha256);
    expect(verifier).toContain('name: "@aihq/core"');
    expect(verifier).toContain('version: "0.1.0"');
    expect(verifier).toMatch(/--core-root/);
    expect(verifier).toMatch(/status.*--porcelain=v1/s);
    expect(verifier).toMatch(/(?:openSync|readFileSync)\(/);
    expect(verifier).toMatch(/(?:fstatSync|lstatSync)\(/);

    const coldProof = readFileSync(resolve(root, "tools/verify-cold-external-admin.mjs"), "utf8");
    expect(coldProof).toContain(coreCommit);
    expect(coldProof).toContain(corePackageManifestSha256);
    expect(coldProof).toContain('name: "@aihq/core"');
    expect(coldProof).toContain('name: "@aihq/catalog"');
    expect(coldProof).toContain('await import("@aihq/core")');
    expect(coldProof).toContain('node_modules", "@aihq", "catalog');
    expect(coldProof).toContain('node_modules", "@aihq", "core');
    expect(coldProof).not.toMatch(/@aihq\/harness|@aihq\/supported/);
    expect(coldProof).toMatch(/(?:openSync|readFileSync)\(/);
    expect(coldProof).toMatch(/(?:fstatSync|lstatSync)\(/);

    const workflow = readFileSync(resolve(root, ".github/workflows/verify.yml"), "utf8");
    expect(workflow).toContain(`ref: ${coreCommit}`);
    expect(workflow).toMatch(/verify:core-v2-lock -- --core-root/);
  });

  const coreSource = process.env.AIH_SUPPORTED_CORE_SOURCE;
  const coreIntegration = typeof coreSource === "string" ? it : it.skip;
  coreIntegration(
    "accepts only the exact clean Core checkout and rejects commit, dirty, package, and schema drift",
    () => {
      const verifier = resolve(root, "tools/verify-core-v2-lock.mjs");
      const exact = spawnSync(process.execPath, [verifier, "--core-root", coreSource as string], {
        cwd: root,
        encoding: "utf8",
      });
      expect(exact.status, exact.stderr).toBe(0);

      const temporaryRoot = mkdtempSync(join(tmpdir(), "aih-supported-core-lock-test-"));
      const clone = (name: string): string => {
        const destination = resolve(temporaryRoot, name);
        expect(
          git(temporaryRoot, [
            "clone",
            "--no-checkout",
            "--shared",
            coreSource as string,
            destination,
          ]).status,
        ).toBe(0);
        expect(git(destination, ["checkout", "--detach", coreCommit]).status).toBe(0);
        return destination;
      };
      const verify = (coreRoot: string) =>
        spawnSync(process.execPath, [verifier, "--core-root", coreRoot], {
          cwd: root,
          encoding: "utf8",
        });

      try {
        const wrongCommit = clone("wrong-commit");
        expect(git(wrongCommit, ["checkout", "--detach", `${coreCommit}^`]).status).toBe(0);
        expect(verify(wrongCommit).status).not.toBe(0);

        const dirty = clone("dirty");
        writeFileSync(resolve(dirty, "untracked-proof.txt"), "dirty");
        expect(verify(dirty).status).not.toBe(0);

        const hiddenPackageDrift = clone("hidden-package-drift");
        expect(
          git(hiddenPackageDrift, ["update-index", "--skip-worktree", "package.json"]).status,
        ).toBe(0);
        const packageJson = JSON.parse(
          readFileSync(resolve(hiddenPackageDrift, "package.json"), "utf8"),
        ) as Record<string, unknown>;
        writeFileSync(
          resolve(hiddenPackageDrift, "package.json"),
          JSON.stringify({ ...packageJson, name: "@aihq/not-core" }),
        );
        expect(git(hiddenPackageDrift, ["status", "--porcelain=v1"]).stdout).toBe("");
        expect(verify(hiddenPackageDrift).status).not.toBe(0);

        const hiddenSchemaDrift = clone("hidden-schema-drift");
        const schemaPath = "schemas/aih-governance-decision-v2.schema.json";
        expect(git(hiddenSchemaDrift, ["update-index", "--skip-worktree", schemaPath]).status).toBe(
          0,
        );
        writeFileSync(
          resolve(hiddenSchemaDrift, schemaPath),
          `${readFileSync(resolve(hiddenSchemaDrift, schemaPath), "utf8")}\n`,
        );
        expect(git(hiddenSchemaDrift, ["status", "--porcelain=v1"]).stdout).toBe("");
        expect(verify(hiddenSchemaDrift).status).not.toBe(0);
      } finally {
        rmSync(temporaryRoot, { force: true, recursive: true });
      }
    },
    120_000,
  );
});
