import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ProducerRefusal } from "../../src/producer/errors.js";
import { stagePackage } from "../../src/producer/package.js";
import { assertFreshOutput } from "../../src/producer/paths.js";
import { committedRelease, makePackageRoot, root } from "./helpers.js";

const scratch = mkdtempSync(join(tmpdir(), "aih-producer-staging-"));
const links: string[] = [];
afterAll(() => {
  for (const link of links) {
    try {
      unlinkSync(link);
    } catch {
      /* already detached */
    }
  }
  rmSync(scratch, { recursive: true, force: true });
});

const tree = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
const reason = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof ProducerRefusal) return error.reason;
    throw error;
  }
  return "no refusal";
};

describe("staging never deletes what it does not own", () => {
  it("refuses a stage directory that is the source root and keeps every file", () => {
    const source = makePackageRoot(join(scratch, "same"), committedRelease());
    const before = tree(source);
    expect(
      reason(() => stagePackage({ sourceRoot: source, stageDir: source, files: new Map() })),
    ).toBe("stage-overlap");
    expect(tree(source)).toEqual(before);
  });

  it("refuses a stage directory that contains the source root", () => {
    const base = join(scratch, "contains");
    const source = makePackageRoot(join(base, "stage", "pkg"), committedRelease());
    writeFileSync(join(source, "UNRELATED.txt"), "keep me");
    const before = tree(base);
    expect(
      reason(() =>
        stagePackage({ sourceRoot: source, stageDir: join(base, "stage"), files: new Map() }),
      ),
    ).toBe("stage-overlap");
    expect(tree(base)).toEqual(before);
  });

  it("refuses a stage directory that already holds anything, and leaves it alone", () => {
    const source = makePackageRoot(join(scratch, "occupied-src"), committedRelease());
    const stage = join(scratch, "occupied-stage");
    mkdirSync(stage);
    writeFileSync(join(stage, "precious.txt"), "do not delete");
    expect(
      reason(() => stagePackage({ sourceRoot: source, stageDir: stage, files: new Map() })),
    ).toBe("stage-collision");
    expect(readFileSync(join(stage, "precious.txt"), "utf8")).toBe("do not delete");
  });

  it("sees through a symlinked or junctioned alias into the source root", () => {
    const source = makePackageRoot(join(scratch, "alias-src"), committedRelease());
    const alias = join(scratch, "alias-link");
    try {
      symlinkSync(source, alias, "junction");
    } catch {
      return; // links cannot be created here; the realpath logic is unit-covered below
    }
    links.push(alias);
    const before = tree(source);
    expect(
      reason(() => stagePackage({ sourceRoot: source, stageDir: alias, files: new Map() })),
    ).toBe("stage-overlap");
    expect(
      reason(() =>
        stagePackage({ sourceRoot: source, stageDir: join(alias, "inner"), files: new Map() }),
      ),
    ).toBe("stage-overlap");
    expect(tree(source)).toEqual(before);
  });
});

describe("the output directory must be fresh and disjoint from the source", () => {
  it("accepts a missing directory and an empty one", () => {
    const source = makePackageRoot(join(scratch, "ok-src"), committedRelease());
    expect(() =>
      assertFreshOutput({ sourceRoot: source, outDir: join(scratch, "ok-new") }),
    ).not.toThrow();
    const empty = join(scratch, "ok-empty");
    mkdirSync(empty);
    expect(() => assertFreshOutput({ sourceRoot: source, outDir: empty })).not.toThrow();
  });

  it("refuses a non-empty output, an output inside the source and a source inside the output", () => {
    const source = makePackageRoot(join(scratch, "bad-src"), committedRelease());
    const occupied = join(scratch, "bad-occupied");
    mkdirSync(occupied);
    writeFileSync(join(occupied, "x.txt"), "x");
    expect(reason(() => assertFreshOutput({ sourceRoot: source, outDir: occupied }))).toBe(
      "out-not-empty",
    );
    expect(
      reason(() =>
        assertFreshOutput({ sourceRoot: source, outDir: join(source, "release", "out") }),
      ),
    ).toBe("out-overlap");
    expect(
      reason(() => assertFreshOutput({ sourceRoot: source, outDir: join(source, ".out") })),
    ).toBe("out-overlap");
    expect(reason(() => assertFreshOutput({ sourceRoot: source, outDir: scratch }))).toBe(
      "out-overlap",
    );
    expect(reason(() => assertFreshOutput({ sourceRoot: source, outDir: source }))).toBe(
      "out-overlap",
    );
  });
});

describe("tools/prepare-candidate.mjs preserves the caller's files (reviewer reproduction)", () => {
  const cli = (...args: string[]) =>
    spawnSync(process.execPath, ["tools/prepare-candidate.mjs", ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
    });

  it("--root <x>/stage --out <x> is refused before anything is touched", () => {
    const base = join(scratch, "cli-contains");
    const source = makePackageRoot(join(base, "stage"), committedRelease());
    const before = tree(base);
    const result = cli(
      "--commit",
      "a".repeat(40),
      "--root",
      source,
      "--out",
      base,
      "--declaration",
      join(root, "producer", "declaration.json"),
      "--source-git-dir",
      scratch,
      "--allow-unverified-origin",
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--out/);
    expect(tree(base)).toEqual(before);
    expect(existsSync(join(source, "package.json"))).toBe(true);
    expect(existsSync(join(source, "release", "release.json"))).toBe(true);
  });

  it("an output directory that already holds a stage directory is refused unchanged", () => {
    const source = makePackageRoot(join(scratch, "cli-src"), committedRelease());
    const out = join(scratch, "cli-out");
    mkdirSync(join(out, "stage"), { recursive: true });
    writeFileSync(join(out, "stage", "precious.txt"), "keep");
    const result = cli(
      "--commit",
      "a".repeat(40),
      "--root",
      source,
      "--out",
      out,
      "--declaration",
      join(root, "producer", "declaration.json"),
      "--source-git-dir",
      scratch,
      "--allow-unverified-origin",
    );
    expect(result.status).toBe(2);
    expect(readFileSync(join(out, "stage", "precious.txt"), "utf8")).toBe("keep");
  });
});
