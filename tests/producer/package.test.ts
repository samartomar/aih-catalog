import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCandidate } from "../../src/producer/candidate.js";
import { ProducerRefusal } from "../../src/producer/errors.js";
import { installCandidate, readReleaseDirectory } from "../../src/producer/install.js";
import { checkCandidateFiles } from "../../src/producer/integrity.js";
import {
  exportTargets,
  type PackedArtifact,
  packStaged,
  stagePackage,
  verifyPacked,
} from "../../src/producer/package.js";
import { AUTHORED_SOURCE, emptyRelease, HETEROGENEOUS, withAuthoredItems } from "./authored.js";
import {
  committedRelease,
  declaration,
  makePackageRoot,
  memoryTree,
  PINNED_REVISION,
  packageIdentity,
  pinnedUpstreamFiles,
  root,
  sha256,
} from "./helpers.js";

const identity = packageIdentity();
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  files: string[];
};
const scratch = mkdtempSync(join(tmpdir(), "aih-producer-package-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
/** Stage and pack a disposable package root; `tamper` runs between stage and pack. */
async function packAndVerify(
  files: ReadonlyMap<string, Buffer>,
  options: { source?: (sourceRoot: string) => void; tamper?: (stage: string) => void } = {},
) {
  counter += 1;
  const sourceRoot = makePackageRoot(join(scratch, `src-${counter}`), files);
  options.source?.(sourceRoot);
  const stage = join(scratch, `stage-${counter}`);
  stagePackage({ sourceRoot, files, stageDir: stage });
  options.tamper?.(stage);
  const artifact = packStaged(stage, join(scratch, `pack-${counter}`));
  const result = await verifyPacked({
    artifact,
    files,
    identity,
    manifest,
    sourceRoot,
    authored: declaration().authored,
  });
  return { result, artifact, sourceRoot, stage };
}
const failed = (result: { checks: readonly { name: string; ok: boolean }[] }) =>
  result.checks.filter((c) => !c.ok).map((c) => c.name);
const check = (result: { checks: readonly { name: string }[] }, name: string) =>
  result.checks.find((c) => c.name === name) as
    | { name: string; ok: boolean; detail?: string; status?: string }
    | undefined;
const selectedContextDetail = `selected ${[
  "aihq.client.antigravity",
  "aihq.project-context-pointer.gemini-md",
  "aihq.project-context",
  "aihq.project-context-pointer.agents-md",
].join(" + ")}`;

describe("packed candidate", () => {
  const files = committedRelease();
  let artifact: PackedArtifact;
  let outcome: Awaited<ReturnType<typeof packAndVerify>>;

  beforeAll(async () => {
    if (!existsSync(join(root, "dist/release/reader.js"))) {
      throw new Error("dist/release is missing; run npm run build:dist first");
    }
    outcome = await packAndVerify(files);
    artifact = outcome.artifact;
  }, 240_000);

  it("packs exactly the intended package and runs its public imports from the tarball", () => {
    expect(failed(outcome.result)).toEqual([]);
    expect(outcome.result.checks.map((c) => c.name)).toEqual([
      "packed-release-bytes",
      "packed-inventory-intended",
      "packed-runtime-bytes",
      "packed-required-files",
      "packed-export-targets",
      "packed-listing-agrees",
      "packed-release-integrity",
      "packed-public-imports",
      "reader-selection-smoke",
    ]);
    expect(artifact.sha256).toBe(sha256(readFileSync(artifact.tarball)));
    expect(
      artifact.packedPaths.some((path) => /^(?:src|tests|tools|producer|docs)\//.test(path)),
    ).toBe(false);
    expect(artifact.packedPaths.some((path) => path.startsWith("dist/producer"))).toBe(false);
    expect(artifact.packedPaths).toContain("LICENSE");
    expect(artifact.packedPaths).toContain("release/release.json");
    expect(check(outcome.result, "reader-selection-smoke")).toMatchObject({
      ok: true,
      status: "passed",
    });
    expect(check(outcome.result, "reader-selection-smoke")?.detail?.split(";")[0]).toBe(
      selectedContextDetail,
    );
  });

  it("reports packed bytes that differ from the candidate it was asked about", async () => {
    const other = new Map(files);
    const [path] = [...other.keys()].filter((key) => key.endsWith("/grilling/SKILL.md"));
    other.set(path as string, Buffer.from("different"));
    const result = await verifyPacked({
      artifact,
      files: other,
      identity,
      manifest,
      sourceRoot: outcome.sourceRoot,
      authored: declaration().authored,
    });
    expect(check(result, "packed-release-bytes")?.ok).toBe(false);
  }, 60_000);

  it("flags anything packed outside the declared runtime entries", async () => {
    const narrower = { files: manifest.files.filter((entry) => entry !== "schemas/core-recipe") };
    const result = await verifyPacked({
      artifact,
      files,
      identity,
      manifest: narrower,
      sourceRoot: outcome.sourceRoot,
      authored: declaration().authored,
    });
    expect(check(result, "packed-inventory-intended")?.ok).toBe(false);
    expect(check(result, "packed-runtime-bytes")?.ok).toBe(false);
  }, 60_000);

  it("fails the packed release integrity on authored content without allowances", async () => {
    const result = await verifyPacked({
      artifact,
      files,
      identity,
      manifest,
      sourceRoot: outcome.sourceRoot,
      authored: [],
    });
    expect(check(result, "packed-release-integrity")).toMatchObject({
      ok: false,
      detail: "authored-references, authored-placeholders",
    });
  }, 60_000);

  it("refuses to stage without a built package, a license, or into an occupied stage", () => {
    const empty = mkdtempSync(join(scratch, "no-build-"));
    writeFileSync(join(empty, "package.json"), JSON.stringify({ files: ["release"] }));
    expect(() => stagePackage({ sourceRoot: empty, files, stageDir: join(scratch, "x") })).toThrow(
      /build-missing/,
    );
    const source = makePackageRoot(join(scratch, "no-license"), files);
    unlinkSync(join(source, "LICENSE"));
    expect(() => stagePackage({ sourceRoot: source, files, stageDir: join(scratch, "y") })).toThrow(
      /package-entry-missing/,
    );
  });

  it("derives export targets however they are nested", () => {
    expect(
      exportTargets({
        ".": { types: "./a.d.ts", import: "./a.js" },
        "./b": "./b.json",
        "./c": [{ default: "./c.js" }],
      }),
    ).toEqual(["./a.d.ts", "./a.js", "./b.json", "./c.js"]);
    expect(exportTargets(undefined)).toEqual([]);
  });
});

describe("a packed package that is broken anywhere is not ready", () => {
  const files = committedRelease();

  it("fails when the packed reader throws, even though every byte matches the source", async () => {
    const { result } = await packAndVerify(files, {
      source: (source) =>
        writeFileSync(
          join(source, "dist/release/reader.js"),
          'throw new Error("tampered reader");\n',
        ),
    });
    expect(check(result, "packed-runtime-bytes")?.ok).toBe(true);
    expect(failed(result)).toContain("packed-public-imports");
    expect(check(result, "packed-public-imports")?.detail).toMatch(/tampered reader|imports/);
  }, 240_000);

  it("fails when a declared export target is not packed (the schema export)", async () => {
    const { result } = await packAndVerify(files, {
      source: (source) => rmSync(join(source, "schemas/release/1.0.0.json")),
    });
    expect(failed(result)).toContain("packed-export-targets");
    expect(check(result, "packed-export-targets")?.detail).toContain("schemas/release/1.0.0.json");
    expect(failed(result)).toContain("packed-public-imports");
  }, 240_000);

  it("fails when the license is missing from the pack", async () => {
    const { result } = await packAndVerify(files, {
      tamper: (stage) => unlinkSync(join(stage, "LICENSE")),
    });
    expect(failed(result)).toContain("packed-required-files");
    expect(failed(result)).toContain("packed-runtime-bytes");
  }, 240_000);

  it("fails when a runtime file changes between the source and the pack", async () => {
    const { result } = await packAndVerify(files, {
      tamper: (stage) => appendFileSync(join(stage, "dist/release/contracts.js"), "\n// drift\n"),
    });
    expect(failed(result)).toEqual(["packed-runtime-bytes"]);
    expect(check(result, "packed-runtime-bytes")?.detail).toContain("dist/release/contracts.js");
  }, 240_000);

  it("fails when an unexpected file is packed beside the runtime", async () => {
    const { result } = await packAndVerify(files, {
      tamper: (stage) => writeFileSync(join(stage, "dist/release/extra.js"), "export {};\n"),
    });
    expect(failed(result)).toEqual(["packed-runtime-bytes"]);
    expect(check(result, "packed-runtime-bytes")?.detail).toContain(
      "unexpected: dist/release/extra.js",
    );
  }, 240_000);
});

describe("bounded selection with realistic mixed content", () => {
  const mixed = () => withAuthoredItems(committedRelease(), HETEROGENEOUS);

  it("keeps a valid release with configuration-required, conflicting and platform-gated items ready", async () => {
    const files = mixed();
    expect(checkCandidateFiles(files, identity, { authored: declaration().authored }).ok).toBe(
      true,
    );
    const { result } = await packAndVerify(files);
    expect(failed(result)).toEqual([]);
    const smoke = check(result, "reader-selection-smoke");
    expect(smoke).toMatchObject({ ok: true, status: "passed" });
    // The scenario is deterministic: the first viable item that has an explicit required closure.
    expect(smoke?.detail?.split(";")[0]).toBe(selectedContextDetail);
    expect(smoke?.detail).toContain("1 configuration-required");
    expect(smoke?.detail).toContain("1 conflicting");
  }, 240_000);

  it("records NOT RUN, truthfully, when nothing is selectable with defaults", async () => {
    const files = withAuthoredItems(
      emptyRelease(identity),
      HETEROGENEOUS.filter((spec) => spec.id === "ext.server"),
    );
    expect(AUTHORED_SOURCE).toBe("local-authored");
    expect(checkCandidateFiles(files, identity).ok).toBe(true);
    const { result } = await packAndVerify(files);
    const smoke = check(result, "reader-selection-smoke");
    expect(smoke).toMatchObject({ ok: true, status: "not-run" });
    expect(smoke?.detail).toMatch(/^NOT RUN: no item of 1 is selectable with defaults/);
    expect(smoke?.detail).toContain("1 need configuration");
    expect(failed(result)).toEqual([]);
  }, 240_000);

  it("still refuses a release whose own integrity is broken", async () => {
    const files = mixed();
    const [path] = [...files.keys()].filter((key) => key.includes("/authored/ext.server/"));
    files.set(path as string, Buffer.from("tampered"));
    expect(
      failed(checkCandidateFiles(files, identity, { authored: declaration().authored })),
    ).toContain("member-bytes");
  });
});

describe("atomic install", () => {
  const files = () => new Map(committedRelease());
  const seed = (name: string) => {
    const dir = join(scratch, name);
    for (const [path, bytes] of files()) {
      const target = join(dir, ...path.split("/"));
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, bytes);
    }
    return dir;
  };
  const snapshot = (dir: string) =>
    [...readReleaseDirectory(dir)].map(([path, bytes]) => `${path}:${sha256(bytes)}`).sort();

  it("replaces the published tree with the candidate and leaves no temporary directory", () => {
    const dir = seed("replace");
    const next = files();
    const [path] = [...next.keys()].filter((key) => key.endsWith("LICENSE"));
    next.delete(path as string);
    const extra = "release/materials/extra/NOTE.txt";
    next.set(extra, Buffer.from("note"));
    installCandidate({ root: dir, files: next });
    expect(readReleaseDirectory(dir).has(extra)).toBe(true);
    expect(readReleaseDirectory(dir).has(path as string)).toBe(false);
    for (const name of ["release.next", "release.previous", "release.rejected"]) {
      expect(existsSync(join(dir, name))).toBe(false);
    }
  });

  it("leaves the published tree untouched when anything fails before the swap", () => {
    const dir = seed("fail");
    const before = snapshot(dir);
    expect(() =>
      installCandidate({
        root: dir,
        files: files(),
        beforeSwap: () => {
          throw new Error("simulated failure before swap");
        },
      }),
    ).toThrow(/simulated failure/);
    expect(snapshot(dir)).toEqual(before);
    expect(existsSync(join(dir, "release.next"))).toBe(false);
  });

  it("restores the previous release when the installed tree is rejected", () => {
    const dir = seed("rejected");
    const before = snapshot(dir);
    const next = files();
    next.set("release/materials/extra/NOTE.txt", Buffer.from("note"));
    expect(() =>
      installCandidate({
        root: dir,
        files: next,
        verifyInstalled: () => {
          throw new Error("installed tree rejected");
        },
      }),
    ).toThrow(/installed tree rejected/);
    expect(snapshot(dir)).toEqual(before);
    for (const name of ["release.next", "release.previous", "release.rejected"]) {
      expect(existsSync(join(dir, name))).toBe(false);
    }
  });

  it("refuses paths outside release/ and a leftover from an interrupted run", () => {
    const dir = seed("leftover");
    const before = snapshot(dir);
    expect(() =>
      installCandidate({ root: dir, files: new Map([["package.json", Buffer.from("{}")]]) }),
    ).toThrow(ProducerRefusal);
    mkdirSync(join(dir, "release.next"));
    expect(() => installCandidate({ root: dir, files: files() })).toThrow(/install-leftover/);
    rmSync(join(dir, "release.next"), { recursive: true });
    expect(snapshot(dir)).toEqual(before);
  });
});

describe.skipIf(!process.env.AIH_CORE_ARTIFACT)("optional Core handoff over mixed content", () => {
  const handoff = (tarball: string) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ["tools/verify-core-consumer.mjs", process.env.AIH_CORE_ARTIFACT as string, tarball],
        { cwd: root, encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
      ),
    ) as {
      status: string;
      selected?: string[];
      staleMaterialRejected?: boolean;
      configurationRequired?: number;
      defaultOrigin?: string;
      defaultInputsChecked?: number;
      contextLifecycle?: { status: string };
    };

  it("selects the bounded scenario although other valid items need configuration or conflict", async () => {
    const { artifact } = await packAndVerify(withAuthoredItems(committedRelease(), HETEROGENEOUS));
    const result = handoff(artifact.tarball);
    expect(result).toMatchObject({ status: "passed", staleMaterialRejected: true });
    expect(result.selected).toEqual([
      "aihq.client.antigravity",
      "aihq.project-context-pointer.agents-md",
      "aihq.project-context-pointer.gemini-md",
      "aihq.project-context",
    ]);
    expect(result.defaultOrigin).toBe("not-applicable");
    expect(result.contextLifecycle?.status).toBe("passed");
  }, 400_000);

  it("retains skill default-origin coverage and skips absent context for an upstream-only candidate", async () => {
    const files = buildCandidate({
      declaration: declaration(),
      tree: memoryTree(PINNED_REVISION, pinnedUpstreamFiles()),
      package: identity,
    }).files;
    const { artifact } = await packAndVerify(files);
    const result = handoff(artifact.tarball);
    expect(result).toMatchObject({
      status: "passed",
      defaultOrigin: "default",
      staleMaterialRejected: true,
    });
    expect(result.selected).toEqual(["mattpocock.grill-me", "mattpocock.grilling"]);
    expect(result.defaultInputsChecked).toBeGreaterThan(0);
    expect(result.contextLifecycle?.status).toBe("not-run");
  }, 400_000);

  it("reports NOT RUN, not a pass, when nothing is selectable with defaults", async () => {
    const files = withAuthoredItems(
      emptyRelease(identity),
      HETEROGENEOUS.filter((spec) => spec.id === "ext.server"),
    );
    const { artifact } = await packAndVerify(files);
    expect(handoff(artifact.tarball)).toMatchObject({
      status: "not-run",
      configurationRequired: 1,
    });
  }, 400_000);
});
