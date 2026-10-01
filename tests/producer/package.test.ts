import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProducerRefusal } from "../../src/producer/errors.js";
import { installCandidate, readReleaseDirectory } from "../../src/producer/install.js";
import {
  exerciseInstalledRelease,
  type PackedArtifact,
  packStaged,
  stagePackage,
  verifyPacked,
} from "../../src/producer/package.js";
import { committedRelease, packageIdentity, root, sha256 } from "./helpers.js";

const identity = packageIdentity();
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  files: string[];
};
const scratch = mkdtempSync(join(tmpdir(), "aih-producer-package-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("packed candidate", () => {
  const files = committedRelease();
  let artifact: PackedArtifact;

  beforeAll(() => {
    if (!existsSync(join(root, "dist/release/reader.js"))) {
      throw new Error("dist/release is missing; run npm run build:dist first");
    }
    const stage = join(scratch, "stage");
    stagePackage({ sourceRoot: root, files, stageDir: stage });
    artifact = packStaged(stage, join(scratch, "pack"));
  }, 240_000);

  it("packs exactly the candidate release bytes and nothing outside the runtime subset", async () => {
    const result = await verifyPacked({ artifact, files, identity, manifest });
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.checks.map((c) => c.name)).toEqual([
      "packed-release-bytes",
      "packed-inventory-intended",
      "packed-listing-agrees",
      "packed-release-integrity",
      "reader-selection-handoff",
    ]);
    expect(artifact.sha256).toBe(sha256(readFileSync(artifact.tarball)));
    expect(
      artifact.packedPaths.some((path) => /^(?:src|tests|tools|producer|docs)\//.test(path)),
    ).toBe(false);
    expect(artifact.packedPaths.some((path) => path.startsWith("dist/producer"))).toBe(false);
    expect(artifact.packedPaths).toContain("release/release.json");
    expect(artifact.packedPaths).toContain("dist/release/reader.js");
  });

  it("reports packed bytes that differ from the candidate it was asked about", async () => {
    const other = new Map(files);
    const [path] = [...other.keys()].filter((key) => key.endsWith("/grilling/SKILL.md"));
    other.set(path as string, Buffer.from("different"));
    const result = await verifyPacked({ artifact, files: other, identity, manifest });
    expect(result.checks.find((c) => c.name === "packed-release-bytes")?.ok).toBe(false);
  });

  it("flags anything packed outside the declared runtime entries", async () => {
    const narrower = { files: manifest.files.filter((entry) => entry !== "schemas/core-recipe") };
    const result = await verifyPacked({ artifact, files, identity, manifest: narrower });
    expect(result.checks.find((c) => c.name === "packed-inventory-intended")?.ok).toBe(false);
  });

  it("is accepted by the installed-root reader with a bounded selection of every item", async () => {
    const stage = join(scratch, "stage");
    const handoff = await exerciseInstalledRelease(stage);
    expect(handoff).toEqual({ ok: true, items: 2 });
  });

  it("refuses to stage without a built package", () => {
    const empty = mkdtempSync(join(scratch, "no-build-"));
    writeFileSync(join(empty, "package.json"), JSON.stringify({ files: ["release"] }));
    expect(() => stagePackage({ sourceRoot: empty, files, stageDir: join(scratch, "x") })).toThrow(
      /build-missing/,
    );
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
    expect(existsSync(join(dir, "release.next"))).toBe(false);
    expect(existsSync(join(dir, "release.previous"))).toBe(false);
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
