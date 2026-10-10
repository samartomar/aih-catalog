import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCandidate } from "../../src/producer/candidate.js";
import { parseDeclaration } from "../../src/producer/declaration.js";
import { readCommitTree } from "../../src/producer/git-tree.js";
import { readReleaseDirectory } from "../../src/producer/install.js";
import { type AcquiredTree, prepareCandidate } from "../../src/producer/prepare.js";
import type { Clock } from "../../src/producer/timing.js";
import { withAuthoredItems } from "./authored.js";
import { FixtureRepository, UPSTREAM_A, UPSTREAM_B_CHANGES } from "./git-fixture.js";
import { makePackageRoot, NATIVE_FIXTURE_ALLOWANCE, REPOSITORY, root, sha256 } from "./helpers.js";

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

const scratch = mkdtempSync(join(tmpdir(), "aih-producer-prepare-"));
const upstream = new FixtureRepository();
afterAll(() => {
  upstream.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

const packageRoot = (name: string, release: ReadonlyMap<string, Uint8Array>) =>
  makePackageRoot(join(scratch, name), release);

let commitA = "";
let commitB = "";
let seeded: Map<string, Buffer>;
const acquireAt =
  (commit: string, extra: Partial<AcquiredTree> = {}) =>
  async () => ({
    ...readCommitTree({ repository: REPOSITORY, commit, run: upstream.run }),
    cache: "miss" as const,
    attempts: 1,
    originVerified: true,
    ...extra,
  });

beforeAll(() => {
  if (!existsSync(join(root, "dist/release/reader.js")))
    throw new Error("run npm run build:dist first");
  commitA = upstream.commit(UPSTREAM_A, "first fixed commit");
  commitB = upstream.commit(UPSTREAM_B_CHANGES, "second fixed commit");
  seeded = new Map(
    buildCandidate({
      declaration: declarationA,
      tree: readCommitTree({ repository: REPOSITORY, commit: commitA, run: upstream.run }),
      package: JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
    }).files,
  );
}, 60_000);

const digestTree = (dir: string) =>
  [...readReleaseDirectory(dir)].map(([path, bytes]) => `${path}:${sha256(bytes)}`).sort();

describe("prepareCandidate", () => {
  it("prepares and installs a ready candidate from an explicit pin, and times every phase", async () => {
    const dir = packageRoot("apply", seeded);
    const out = join(scratch, "apply-out");
    const result = await prepareCandidate({
      sourceRoot: dir,
      declaration: declarationB,
      commit: commitB,
      acquire: acquireAt(commitB),
      outDir: out,
      apply: true,
      condition: "retained-cache",
      git: { commit: "f".repeat(40), dirty: false },
    });
    expect(result.summary.outcome).toBe("ready");
    expect(result.installed).toBe(true);
    expect(result.report?.summary).toMatchObject({
      added: 1,
      changed: 2,
      removed: 1,
      "dependent-confirmed": 1,
      unchanged: 1,
    });
    // The published release now holds exactly the candidate that was verified and packed.
    const names = result.summary.phases.map((phase) => [phase.name, phase.status]);
    expect(names).toEqual([
      ["load-base", "passed"],
      ["fetch-inputs", "passed"],
      ["affected-production", "passed"],
      ["integrity", "passed"],
      ["stage-and-pack", "passed"],
      ["verify-packed", "passed"],
      ["consumer-handoff", "skipped"],
      ["review-preparation", "passed"],
      ["install", "passed"],
    ]);
    expect(readFileSync(join(dir, "release/release.json"), "utf8")).toContain(commitB);
    expect(result.summary.candidate.artifactSha256).toBe(result.artifact?.sha256);
    expect(existsSync(join(out, "candidate-review.md"))).toBe(true);
    expect(JSON.parse(readFileSync(join(out, "timing-summary.json"), "utf8"))).toEqual(
      result.summary,
    );
    const review = readFileSync(join(out, "candidate-review.md"), "utf8");
    expect(review).toContain("fixture.to-questionnaire");
    expect(review).toContain("Provenance-only changes (reported separately)");
  }, 120_000);

  it("stages a dry run without touching the published release", async () => {
    const dir = packageRoot("dry", seeded);
    const before = digestTree(dir);
    const result = await prepareCandidate({
      sourceRoot: dir,
      declaration: declarationB,
      commit: commitB,
      acquire: acquireAt(commitB),
      outDir: join(scratch, "dry-out"),
    });
    expect(result.summary.outcome).toBe("ready");
    expect(result.installed).toBe(false);
    expect(digestTree(dir)).toEqual(before);
    expect(result.summary.phases.find((p) => p.name === "install")?.status).toBe("skipped");
    expect(result.artifact && existsSync(result.artifact.tarball)).toBe(true);
  }, 120_000);

  it("refuses carried authored content with a broken reference and changes nothing", async () => {
    const dir = packageRoot(
      "authored-broken",
      withAuthoredItems(seeded, [{ id: "notes", text: "Read `docs/missing/README.txt`.\n" }]),
    );
    const before = digestTree(dir);
    const result = await prepareCandidate({
      sourceRoot: dir,
      declaration: declarationB,
      commit: commitB,
      acquire: acquireAt(commitB),
      outDir: join(scratch, "authored-broken-out"),
      apply: true,
    });
    expect(result.summary.outcome).toBe("refused");
    expect(result.summary.refusal?.reason).toBe("integrity-failed");
    expect(result.summary.refusal?.message).toContain(
      "authored-references (unresolved notes readme docs/notes/README.txt:1 -> docs/missing/README.txt)",
    );
    expect(result.installed).toBe(false);
    expect(digestTree(dir)).toEqual(before);
    expect(result.summary.phases.find((p) => p.name === "integrity")?.status).toBe("failed");
  }, 60_000);

  it("refuses an incomplete inventory, records the failed run and changes nothing", async () => {
    const dir = packageRoot("incomplete", seeded);
    const before = digestTree(dir);
    const out = join(scratch, "incomplete-out");
    const result = await prepareCandidate({
      sourceRoot: dir,
      declaration: declarationB,
      commit: commitB,
      acquire: async () => {
        const tree = await acquireAt(commitB)();
        return {
          ...tree,
          inventory: {
            ...tree.inventory,
            complete: false,
            paths: new Set([...tree.inventory.paths].filter((p) => p !== skill("handoff"))),
          },
        };
      },
      outDir: out,
      apply: true,
    });
    expect(result.summary.outcome).toBe("refused");
    expect(result.summary.refusal?.reason).toBe("inventory-incomplete");
    expect(result.installed).toBe(false);
    expect(digestTree(dir)).toEqual(before);
    expect(result.summary.phases.find((p) => p.name === "affected-production")?.status).toBe(
      "failed",
    );
    expect(existsSync(join(out, "timing-summary.json"))).toBe(true);
  }, 60_000);

  it("never applies a candidate whose origin was not verified", async () => {
    const dir = packageRoot("unverified", seeded);
    const before = digestTree(dir);
    const result = await prepareCandidate({
      sourceRoot: dir,
      declaration: declarationB,
      commit: commitB,
      acquire: acquireAt(commitB, { originVerified: false }),
      outDir: join(scratch, "unverified-out"),
      apply: true,
    });
    expect(result.summary.refusal?.reason).toBe("origin-unverified");
    expect(digestTree(dir)).toEqual(before);
  }, 120_000);

  it("leaves the published release untouched when the swap fails", async () => {
    const dir = packageRoot("swap-fails", seeded);
    const before = digestTree(dir);
    await expect(
      prepareCandidate({
        sourceRoot: dir,
        declaration: declarationB,
        commit: commitB,
        acquire: acquireAt(commitB),
        outDir: join(scratch, "swap-out"),
        apply: true,
        beforeSwap: () => {
          throw new Error("disk failure before swap");
        },
      }),
    ).rejects.toThrow(/disk failure/);
    expect(digestTree(dir)).toEqual(before);
    expect(existsSync(join(dir, "release.next"))).toBe(false);
  }, 120_000);

  it("refuses a pin that differs from what was acquired", async () => {
    const dir = packageRoot("pin", seeded);
    const result = await prepareCandidate({
      sourceRoot: dir,
      declaration: declarationB,
      commit: commitA,
      acquire: acquireAt(commitB),
      outDir: join(scratch, "pin-out"),
    });
    expect(result.summary.refusal?.reason).toBe("commit-mismatch");
  }, 60_000);

  it("a candidate on a package with a damaged published release refuses before producing", async () => {
    const damaged = new Map(seeded);
    const [path] = [...damaged.keys()].filter((key) => key.endsWith("/grilling/SKILL.md"));
    damaged.set(path as string, Buffer.from("damaged"));
    const dir = packageRoot("damaged", damaged);
    const result = await prepareCandidate({
      sourceRoot: dir,
      declaration: declarationB,
      commit: commitB,
      acquire: acquireAt(commitB),
      outDir: join(scratch, "damaged-out"),
    });
    expect(result.summary.refusal?.reason).toBe("base-member-mismatch");
    expect(result.summary.phases.map((p) => p.name)).toEqual(["load-base"]);
  }, 60_000);
});

describe("timing summary", () => {
  /** A controllable clock: `sleep` advances it, so a fake slow phase costs no real time. */
  function fakeClock(startMs = Date.parse("2026-10-01T00:00:00Z")) {
    let mono = 0;
    return {
      clock: {
        now: () => mono,
        wall: () => new Date(startMs + mono),
        sleep: async (ms: number) => {
          mono += ms;
        },
      } satisfies Clock,
      advance: (ms: number) => {
        mono += ms;
      },
    };
  }

  it("counts queue time, labels simulated waits and reports a ceiling miss with its phase", async () => {
    const dir = packageRoot("timing", seeded);
    const { clock } = fakeClock();
    const result = await prepareCandidate({
      sourceRoot: dir,
      declaration: declarationB,
      commit: commitB,
      acquire: acquireAt(commitB),
      outDir: join(scratch, "timing-out"),
      clock,
      detectedAt: new Date(clock.wall().getTime() - 3_000_000),
      simulate: { "fetch-inputs": 700_000 },
      condition: "cold-install",
    });
    const { summary } = result;
    expect(summary.queue.queuedMs).toBe(3_000_000);
    expect(summary.clock.startedAt).toBe("2026-09-30T23:10:00.000Z");
    expect(summary.clock.elapsedSeconds).toBe(3_700);
    expect(summary.clock.withinCeiling).toBe(false);
    expect(summary.misses).toEqual([{ phase: "queue", overBySeconds: 100 }]);
    expect(summary.simulated).toEqual([
      {
        phase: "fetch-inputs",
        delayMs: 700_000,
        label: "SIMULATED delay requested explicitly; not real work",
      },
    ]);
    expect(summary.cache.condition).toBe("cold-install");
    expect(summary.clock.ceilingSeconds).toBe(3_600);
  }, 120_000);

  it("reports retries from acquisition and carries the required identity fields", async () => {
    const dir = packageRoot("retries", seeded);
    const result = await prepareCandidate({
      sourceRoot: dir,
      declaration: declarationB,
      commit: commitB,
      acquire: acquireAt(commitB, { attempts: 3 }),
      outDir: join(scratch, "retries-out"),
      git: { commit: "a".repeat(40), dirty: true },
    });
    const { summary } = result;
    expect(summary.retries).toEqual({ total: 2, byPhase: { "fetch-inputs": 2 } });
    expect(summary.candidate).toMatchObject({ commit: "a".repeat(40), dirty: true });
    expect(summary.candidate.artifactSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.package).toEqual({ name: "@aihq/catalog", version: "0.1.0" });
    expect(summary.runner).toMatchObject({ node: process.version });
    expect(summary.runner.npm).toMatch(/^\d+\.\d+\.\d+/);
    expect(summary.workload).toMatchObject({
      source: REPOSITORY,
      targetRevision: commitB,
      declaredItems: 6,
      releasedItemsBefore: 5,
      candidateItems: 5,
    });
    expect(summary.queue.queuedMs).toBeNull();
    expect(summary.simulated).toEqual([]);
    expect(summary.optionalScan).toMatchObject({ awaited: false, status: "not-awaited" });
    expect(summary.checks.length).toBeGreaterThan(10);
    expect(summary.clock.elapsedMs).toBeGreaterThan(0);
  }, 120_000);

  it("rejects a detection time later than the start of preparation", async () => {
    const dir = packageRoot("future", seeded);
    await expect(
      prepareCandidate({
        sourceRoot: dir,
        declaration: declarationB,
        commit: commitB,
        acquire: acquireAt(commitB),
        outDir: join(scratch, "future-out"),
        detectedAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow(/detected-at-invalid/);
  });
});
