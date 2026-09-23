import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CATALOG_ASSESSMENT_PROFILE_FORMAT_V1,
  CATALOG_ASSESSMENT_PROFILE_VERSION_V1,
} from "../../src/content/catalog-source-closure-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const temporaryRoots: string[] = [];
const mirrorPath = "src/content/catalog-source-closure-v1.ts";

interface LockTool {
  profileContract: {
    coreCommit: string;
    coreSourcePath: string;
    format: string;
    version: number;
  };
  readCoreProfileContract(sourceText: string): { format: string; version: number };
  readCatalogProfileMirror(sourceText: string): { format: string; version: number };
  requireProfileContract(actual: { format: string; version: number }, drift: string): void;
}

async function lockTool(): Promise<LockTool> {
  // @ts-expect-error The lock tool is intentionally plain ESM JavaScript.
  return import("../../tools/verify-core-v2-lock.mjs");
}

/** A disposable copy of exactly what the offline lock reads. */
function copyOfLockInputs(): string {
  const directory = mkdtempSync(join(tmpdir(), "aih-catalog-profile-lock-"));
  temporaryRoots.push(directory);
  for (const path of ["tools/verify-core-v2-lock.mjs", "tests/contracts", mirrorPath]) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    cpSync(join(root, path), join(directory, path), { recursive: true });
  }
  return directory;
}

const runLock = (cwd: string, args: readonly string[] = []) =>
  spawnSync(process.execPath, ["tools/verify-core-v2-lock.mjs", ...args], {
    cwd,
    encoding: "utf8",
  });

/** The shape of Core's declaration, reduced to the two literals the lock reads. */
const coreSource = (format: string, version: string) =>
  [
    `export const ASSESSMENT_MATERIAL_FORMAT_V1 = "${format}";`,
    "const Profile = z.object({",
    "  format: z.literal(ASSESSMENT_MATERIAL_FORMAT_V1),",
    '  material: z.object({ kind: z.literal("source-files") }),',
    `  version: z.literal(${version}),`,
    "});",
  ].join("\n");

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("the mirrored assessment profile literals are locked against Core", () => {
  it("pins Catalog's exported mirror to the contract the lock names", async () => {
    const { profileContract, readCatalogProfileMirror } = await lockTool();
    expect(profileContract).toEqual({
      coreCommit: "2b3212f22e9f7006455b75f29377be3add58fac7",
      coreSourcePath: "src/org-policy/assessment-material-binding-v1.ts",
      format: "aih-first-party-qualification-profile",
      version: 1,
    });
    expect(CATALOG_ASSESSMENT_PROFILE_FORMAT_V1).toBe(profileContract.format);
    expect(CATALOG_ASSESSMENT_PROFILE_VERSION_V1).toBe(profileContract.version);
    expect(readCatalogProfileMirror(readFileSync(resolve(root, mirrorPath), "utf8"))).toEqual({
      format: profileContract.format,
      version: profileContract.version,
    });
    // The CI job checks Core out at the profile pin and runs the lock against it.
    const workflow = readFileSync(resolve(root, ".github/workflows/verify.yml"), "utf8");
    expect(workflow).toContain(`ref: ${profileContract.coreCommit}`);
    expect(workflow).toContain("--profile-core-root");
  });

  it("passes on an unaltered copy and fails when the mirrored literal or version is altered", () => {
    const intact = copyOfLockInputs();
    const passed = runLock(intact);
    expect(passed.status, passed.stderr).toBe(0);

    for (const [label, from, to] of [
      [
        "format",
        'CATALOG_ASSESSMENT_PROFILE_FORMAT_V1 = "aih-first-party-qualification-profile";',
        'CATALOG_ASSESSMENT_PROFILE_FORMAT_V1 = "aih-first-party-qualification-profile-v2";',
      ],
      [
        "version",
        "CATALOG_ASSESSMENT_PROFILE_VERSION_V1 = 1;",
        "CATALOG_ASSESSMENT_PROFILE_VERSION_V1 = 2;",
      ],
      ["removed", "export const CATALOG_ASSESSMENT_PROFILE_VERSION_V1 = 1;", ""],
    ] as const) {
      const altered = copyOfLockInputs();
      const target = join(altered, mirrorPath);
      const text = readFileSync(target, "utf8");
      expect(text, label).toContain(from);
      writeFileSync(target, text.replace(from, to));
      const failed = runLock(altered);
      expect(failed.status, label).toBe(1);
      expect(failed.stderr, label).toContain(
        "Core Strict V2 compatibility gate failed: profile-mirror-drift",
      );
    }
  });

  it("reads Core's two literals and refuses a declaration that differs", async () => {
    const { readCoreProfileContract, requireProfileContract } = await lockTool();
    const declared = readCoreProfileContract(
      coreSource("aih-first-party-qualification-profile", "1"),
    );
    expect(declared).toEqual({ format: "aih-first-party-qualification-profile", version: 1 });
    expect(() => requireProfileContract(declared, "core-profile-drift")).not.toThrow();
    // Line endings from a Windows checkout do not change what is read.
    expect(
      readCoreProfileContract(
        coreSource("aih-first-party-qualification-profile", "1").replaceAll("\n", "\r\n"),
      ),
    ).toEqual(declared);

    for (const [format, version] of [
      ["aih-first-party-qualification-profile-v2", "1"],
      ["aih-first-party-qualification-profile", "2"],
    ] as const) {
      expect(() =>
        requireProfileContract(
          readCoreProfileContract(coreSource(format, version)),
          "core-profile-drift",
        ),
      ).toThrow("core-profile-drift");
    }
    expect(() => readCoreProfileContract("export const OTHER = 1;")).toThrow("core-profile-format");
    expect(() =>
      readCoreProfileContract(
        'export const ASSESSMENT_MATERIAL_FORMAT_V1 = "x";\nformat: z.literal(ASSESSMENT_MATERIAL_FORMAT_V1),',
      ),
    ).toThrow("core-profile-version");
  });

  const profileSource = process.env.AIH_SUPPORTED_PROFILE_CORE_SOURCE;
  const integration = typeof profileSource === "string" ? it : it.skip;
  integration("accepts a clean Core checkout at the profile pin, and no other commit", () => {
    const accepted = runLock(root, ["--profile-core-root", profileSource as string]);
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(JSON.parse(accepted.stdout.trim().split("\n").at(-1) as string)).toEqual({
      profile: {
        coreCommit: "2b3212f22e9f7006455b75f29377be3add58fac7",
        format: "aih-first-party-qualification-profile",
        version: 1,
      },
    });
    const strictSource = process.env.AIH_SUPPORTED_CORE_SOURCE;
    if (typeof strictSource === "string") {
      const refused = runLock(root, ["--profile-core-root", strictSource]);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("core-commit");
    }
  });
});
