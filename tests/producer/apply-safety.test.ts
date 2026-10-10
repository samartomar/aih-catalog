import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCandidate } from "../../src/producer/candidate.js";
import { parseDeclaration } from "../../src/producer/declaration.js";
import { readCommitTree } from "../../src/producer/git-tree.js";
import { readReleaseDirectory } from "../../src/producer/install.js";
import { type AcquiredTree, prepareCandidate } from "../../src/producer/prepare.js";
import { FixtureRepository, UPSTREAM_A, UPSTREAM_B_CHANGES } from "./git-fixture.js";
import { makePackageRoot, NATIVE_FIXTURE_ALLOWANCE, REPOSITORY, sha256 } from "./helpers.js";

const skill = (name: string) => `skills/productivity/${name}/SKILL.md`;
const item = (name: string, requires: string[] = []) => ({
  id: `fixture.${name}`,
  source: "fixture-skills",
  label: name,
  skillPath: skill(name),
  requires: requires.map((required) => `fixture.${required}`),
});
const declare = (items: ReturnType<typeof item>[]) =>
  parseDeclaration({
    format: "aihq-catalog-producer-declaration",
    version: 1,
    sources: [
      { id: "fixture-skills", repository: REPOSITORY, licensePath: "LICENSE", license: "MIT" },
    ],
    items,
    authored: [NATIVE_FIXTURE_ALLOWANCE],
  });
const declarationA = declare([
  item("grill-me", ["grilling"]),
  item("grilling"),
  item("handoff"),
  item("wait-what"),
  item("writing-for-agents"),
]);
const declarationB = declare([
  item("grill-me", ["grilling"]),
  item("grilling"),
  item("handoff"),
  item("to-questionnaire"),
  item("wait-what"),
  item("writing-for-agents"),
]);

const scratch = mkdtempSync(join(tmpdir(), "aih-producer-apply-"));
const upstream = new FixtureRepository();
let commitB = "";
let seeded: Map<string, Buffer>;
afterAll(() => {
  upstream.dispose();
  rmSync(scratch, { recursive: true, force: true });
});
beforeAll(() => {
  const commitA = upstream.commit(UPSTREAM_A, "first fixed commit");
  commitB = upstream.commit(UPSTREAM_B_CHANGES, "second fixed commit");
  seeded = new Map(
    buildCandidate({
      declaration: declarationA,
      tree: readCommitTree({ repository: REPOSITORY, commit: commitA, run: upstream.run }),
      package: { name: "@aihq/catalog", version: "0.3.0" },
    }).files,
  );
}, 60_000);

const acquire = async (): Promise<AcquiredTree> => ({
  ...readCommitTree({ repository: REPOSITORY, commit: commitB, run: upstream.run }),
  cache: "miss",
  attempts: 1,
  originVerified: true,
});
const digestTree = (dir: string) =>
  [...readReleaseDirectory(dir)].map(([path, bytes]) => `${path}:${sha256(bytes)}`).sort();
const leftovers = (dir: string) =>
  ["release.next", "release.previous", "release.rejected"].filter((name) =>
    existsSync(join(dir, name)),
  );
const options = (dir: string, out: string) => ({
  sourceRoot: dir,
  declaration: declarationB,
  commit: commitB,
  acquire,
  outDir: join(scratch, out),
});

describe("the apply guarantee is honest", () => {
  it("rolls the previous release back when the installed release fails its check", async () => {
    const dir = makePackageRoot(join(scratch, "rollback"), seeded);
    const before = digestTree(dir);
    await expect(
      prepareCandidate({
        ...options(dir, "rollback-out"),
        apply: true,
        afterSwap: () => {
          throw new Error("post-swap check failed");
        },
      }),
    ).rejects.toThrow(/post-swap check failed/);
    expect(digestTree(dir)).toEqual(before);
    expect(leftovers(dir)).toEqual([]);
  }, 120_000);

  it("refuses with the release untouched when the review page cannot be written", async () => {
    const dir = makePackageRoot(join(scratch, "review-fails"), seeded);
    const before = digestTree(dir);
    await expect(
      prepareCandidate({
        ...options(dir, "review-fails-out"),
        apply: true,
        write: (path) => {
          if (path.endsWith("candidate-review.md")) throw new Error("disk full");
        },
      }),
    ).rejects.toThrow(/disk full/);
    expect(digestTree(dir)).toEqual(before);
  }, 120_000);

  it("reports a late summary failure as applied, never as an untouched refusal", async () => {
    const dir = makePackageRoot(join(scratch, "summary-fails"), seeded);
    const result = await prepareCandidate({
      ...options(dir, "summary-fails-out"),
      apply: true,
      write: (path, content) => {
        if (path.endsWith("timing-summary.json")) throw new Error("summary disk full");
        writeFileSync(path, content);
      },
    });
    expect(result.installed).toBe(true);
    expect(result.summary.outcome).toBe("ready");
    expect(result.reportError).toMatch(/summary disk full/);
    expect(readFileSync(join(dir, "release/release.json"), "utf8")).toContain(commitB);
    expect(leftovers(dir)).toEqual([]);
  }, 120_000);

  it("refuses a non-empty or overlapping output directory before reading anything", async () => {
    const dir = makePackageRoot(join(scratch, "fresh-out"), seeded);
    const before = digestTree(dir);
    const occupied = join(scratch, "fresh-out-occupied");
    mkdirSync(occupied);
    writeFileSync(join(occupied, "keep.txt"), "keep");
    for (const outDir of [occupied, join(dir, "scratch-out"), dir]) {
      await expect(prepareCandidate({ ...options(dir, "unused"), outDir })).rejects.toThrow(
        /out-(?:not-empty|overlap)/,
      );
    }
    expect(readFileSync(join(occupied, "keep.txt"), "utf8")).toBe("keep");
    expect(digestTree(dir)).toEqual(before);
  });
});
