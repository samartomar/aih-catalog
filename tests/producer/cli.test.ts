import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCandidate } from "../../src/producer/candidate.js";
import { parseDeclaration } from "../../src/producer/declaration.js";
import { readCommitTree } from "../../src/producer/git-tree.js";
import { FixtureRepository, UPSTREAM_A, UPSTREAM_B_CHANGES } from "./git-fixture.js";
import { committedRelease, makePackageRoot, REPOSITORY, root, sha256 } from "./helpers.js";

const skill = (name: string) => `skills/productivity/${name}/SKILL.md`;
const item = (name: string, requires: string[] = []) => ({
  id: `fixture.${name}`,
  source: "fixture-skills",
  label: name,
  skillPath: skill(name),
  requires: requires.map((required) => `fixture.${required}`),
});
const declarationJson = (items: ReturnType<typeof item>[]) => ({
  format: "aihq-catalog-producer-declaration",
  version: 1,
  sources: [
    { id: "fixture-skills", repository: REPOSITORY, licensePath: "LICENSE", license: "MIT" },
  ],
  items,
});
const ITEMS_A = [
  item("grill-me", ["grilling"]),
  item("grilling"),
  item("handoff"),
  item("wait-what"),
  item("writing-for-agents"),
];
const ITEMS_B = [
  item("grill-me", ["grilling"]),
  item("grilling"),
  item("handoff"),
  item("to-questionnaire"),
  item("wait-what"),
  item("writing-for-agents"),
];

const scratch = mkdtempSync(join(tmpdir(), "aih-producer-cli-"));
const upstream = new FixtureRepository();
let commitA = "";
let commitB = "";
let seeded: Map<string, Buffer>;
let declarationFile = "";

beforeAll(() => {
  if (!existsSync(join(root, "dist/producer/prepare.js")))
    throw new Error("run npm run build:dist first");
  commitA = upstream.commit(UPSTREAM_A, "first fixed commit");
  commitB = upstream.commit(UPSTREAM_B_CHANGES, "second fixed commit");
  seeded = new Map(
    buildCandidate({
      declaration: parseDeclaration(declarationJson(ITEMS_A)),
      tree: readCommitTree({ repository: REPOSITORY, commit: commitA, run: upstream.run }),
      package: JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
    }).files,
  );
  declarationFile = join(scratch, "declaration.json");
  writeFileSync(declarationFile, JSON.stringify(declarationJson(ITEMS_B)));
}, 60_000);
const junctions: string[] = [];
/** Removes a link without ever following it (a junction on Windows, a symlink elsewhere). */
const detach = (link: string) => {
  try {
    unlinkSync(link);
  } catch {
    rmdirSync(link);
  }
};
afterAll(() => {
  // Remove the links first so recursive cleanup can never reach the real node_modules.
  for (const link of junctions) detach(link);
  upstream.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

const node = (args: string[], cwd = root) =>
  spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 280_000,
  });
const prepare = (...args: string[]) => node(["tools/prepare-candidate.mjs", ...args]);

describe("tools/prepare-candidate.mjs", () => {
  it("prepares a dry-run candidate from a local git directory and leaves release/ alone", () => {
    const dir = makePackageRoot(join(scratch, "dry"), seeded);
    const before = readFileSync(join(dir, "release/release.json"));
    const out = join(scratch, "dry-out");
    const result = prepare(
      "--commit",
      commitB,
      "--root",
      dir,
      "--declaration",
      declarationFile,
      "--out",
      out,
      "--source-git-dir",
      upstream.dir,
      "--allow-unverified-origin",
      "--condition",
      "retained-cache",
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("READY:");
    expect(result.stdout).toContain("dry run: release/ is unchanged");
    expect(readFileSync(join(dir, "release/release.json")).equals(before)).toBe(true);
    const report = JSON.parse(readFileSync(join(out, "candidate-report.json"), "utf8"));
    expect(report.summary).toMatchObject({
      added: 1,
      changed: 2,
      removed: 1,
      "dependent-confirmed": 1,
      unchanged: 1,
    });
    const summary = JSON.parse(readFileSync(join(out, "timing-summary.json"), "utf8"));
    expect(summary.outcome).toBe("ready");
    expect(summary.cache.condition).toBe("retained-cache");
    expect(
      summary.phases.find((p: { name: string }) => p.name === "fetch-inputs").detail,
    ).toContain("origin NOT verified");
    expect(existsSync(join(out, "candidate-review.md"))).toBe(true);
  }, 300_000);

  it("refuses at usage level: no pin, partial pin, unverified apply, output inside release/", () => {
    const dir = makePackageRoot(join(scratch, "usage"), seeded);
    const common = ["--root", dir, "--declaration", declarationFile];
    expect(prepare(...common).status).toBe(2);
    expect(prepare("--commit", commitB.slice(0, 12), ...common).status).toBe(2);
    expect(prepare("--commit", "main", ...common).status).toBe(2);
    expect(prepare("--commit", commitB, ...common, "--source-git-dir", upstream.dir).status).toBe(
      2,
    );
    const applied = prepare(
      "--commit",
      commitB,
      ...common,
      "--source-git-dir",
      upstream.dir,
      "--allow-unverified-origin",
      "--apply",
    );
    expect(applied.status).toBe(2);
    expect(applied.stderr).toContain("cannot be applied");
    const inside = prepare(
      "--commit",
      commitB,
      ...common,
      "--out",
      join(dir, "release", "out"),
      "--source-git-dir",
      upstream.dir,
      "--allow-unverified-origin",
    );
    expect(inside.status).toBe(2);
    expect(prepare("--commit", commitB, ...common, "--simulate-delay", "nonsense").status).toBe(2);
    expect(
      readFileSync(join(dir, "release/release.json")).equals(
        seeded.get("release/release.json") as Buffer,
      ),
    ).toBe(true);
  }, 120_000);

  it("exits non-zero with the named reason when the upstream commit cannot be read", () => {
    const dir = makePackageRoot(join(scratch, "missing"), seeded);
    const result = prepare(
      "--commit",
      "9".repeat(40),
      "--root",
      dir,
      "--declaration",
      declarationFile,
      "--out",
      join(scratch, "missing-out"),
      "--source-git-dir",
      upstream.dir,
      "--allow-unverified-origin",
    );
    expect(result.status).toBe(1);
    expect(
      readFileSync(join(dir, "release/release.json")).equals(
        seeded.get("release/release.json") as Buffer,
      ),
    ).toBe(true);
    const summary = JSON.parse(
      readFileSync(join(scratch, "missing-out", "timing-summary.json"), "utf8"),
    );
    expect(summary.outcome).toBe("failed");
    expect(
      summary.phases.map((p: { name: string; status: string }) => `${p.name}:${p.status}`),
    ).toEqual(["load-base:passed", "fetch-inputs:failed"]);
  }, 120_000);
});

describe("tools/measure-candidate.mjs", () => {
  /** An earlier cold run leaves its workspace behind; its installed dependencies are linked in here. */
  function retainedWorkspace(name: string) {
    const ws = makePackageRoot(join(scratch, name), seeded, ["dist", "tools"]);
    mkdirSync(join(ws, "producer"), { recursive: true });
    writeFileSync(
      join(ws, "producer", "declaration.json"),
      JSON.stringify(declarationJson(ITEMS_B)),
    );
    // A retained workspace keeps its installed dependencies: link the already-installed ones.
    symlinkSync(join(root, "node_modules"), join(ws, "node_modules"), "junction");
    junctions.push(join(ws, "node_modules"));
    return ws;
  }
  const measure = (...args: string[]) => node(["tools/measure-candidate.mjs", ...args]);

  it("measures a retained-cache run end to end and records the condition", () => {
    const ws = retainedWorkspace("retained");
    const out = join(scratch, "retained-out");
    const result = measure(
      "--condition",
      "retained-cache",
      "--commit",
      commitB,
      "--workspace",
      ws,
      "--out",
      out,
      "--cache-dir",
      join(scratch, "retained-cache"),
      "--detected-at",
      new Date(Date.now() - 60_000).toISOString(),
      "--",
      "--source-git-dir",
      upstream.dir,
      "--allow-unverified-origin",
    );
    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(readFileSync(join(out, "measurement-summary.json"), "utf8"));
    expect(summary.outcome).toBe("ready");
    expect(summary.cache.condition).toBe("retained-cache");
    expect(summary.cache.dependencies).toContain("retained");
    expect(
      summary.phases
        .slice(0, 3)
        .map((p: { name: string; status: string }) => `${p.name}:${p.status}`),
    ).toEqual(["checkout:skipped", "install-dependencies:skipped", "build:skipped"]);
    expect(summary.phases.some((p: { name: string }) => p.name === "verify-packed")).toBe(true);
    expect(summary.queue.queuedMs).toBeGreaterThanOrEqual(60_000);
    expect(summary.clock.elapsedSeconds).toBeGreaterThanOrEqual(60);
    expect(summary.clock.ceilingSeconds).toBe(3600);
    expect(summary.candidate.artifactSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.runner).toMatchObject({ node: process.version });
    expect(summary.measurement.note).toContain("not a benchmark claim");
  }, 300_000);

  it("labels an explicitly simulated delay and never hides it", () => {
    const ws = retainedWorkspace("simulated");
    const out = join(scratch, "simulated-out");
    const result = measure(
      "--condition",
      "retained-cache",
      "--commit",
      commitB,
      "--workspace",
      ws,
      "--out",
      out,
      "--cache-dir",
      join(scratch, "simulated-cache"),
      "--",
      "--source-git-dir",
      upstream.dir,
      "--allow-unverified-origin",
      "--simulate-delay",
      "fetch-inputs=1500",
    );
    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(readFileSync(join(out, "measurement-summary.json"), "utf8"));
    expect(summary.simulated).toEqual([
      {
        phase: "fetch-inputs",
        delayMs: 1500,
        label: "SIMULATED delay requested explicitly; not real work",
      },
    ]);
    const fetchPhase = summary.phases.find((p: { name: string }) => p.name === "fetch-inputs");
    expect(fetchPhase.durationMs).toBeGreaterThanOrEqual(1400);
  }, 300_000);

  it("requires a fresh workspace for cold-install and an existing one for retained-cache", () => {
    const ws = retainedWorkspace("conditions");
    const common = ["--commit", commitB, "--workspace", ws];
    expect(measure("--condition", "cold-install", ...common).status).toBe(2);
    expect(
      measure(
        "--condition",
        "retained-cache",
        "--commit",
        commitB,
        "--workspace",
        join(scratch, "nope"),
      ).status,
    ).toBe(2);
    expect(measure("--condition", "warm", ...common).status).toBe(2);
  });
});

describe("tools/check-release.mjs and the donor generator guard", () => {
  it("passes the committed release and fails a damaged package", () => {
    expect(node(["tools/check-release.mjs"]).status).toBe(0);
    const dir = makePackageRoot(join(scratch, "damaged-release"), committedRelease());
    const [path] = [...committedRelease().keys()].filter((key) =>
      key.endsWith("/grilling/SKILL.md"),
    );
    writeFileSync(join(dir, path as string), "tampered");
    const result = node(["tools/check-release.mjs", dir]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL member-bytes");
  });

  it("does not fail the donor equality check once a candidate has advanced release/", () => {
    const dir = join(scratch, "advanced");
    mkdirSync(join(dir, "src/production/data"), { recursive: true });
    mkdirSync(join(dir, "release"), { recursive: true });
    writeFileSync(
      join(dir, "src/production/data/mattpocock.snapshot.json"),
      JSON.stringify({ upstream: { pin: "c55ee46073ed923f86ce59a5eb3b6d895095d1b7" } }),
    );
    const advanced = JSON.stringify({ sources: [{ origin: { revision: "d".repeat(40) } }] });
    writeFileSync(join(dir, "release/release.json"), advanced);
    const result = node(["tools/generate-release.mjs", "--check", dir]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("advanced beyond the donor snapshot");
    // Unchanged for the committed release: still compared against the donor inputs.
    expect(sha256(readFileSync(join(root, "release/release.json")))).toMatch(/^[0-9a-f]{64}$/);
    expect(node(["tools/generate-release.mjs", "--check"]).stdout).toContain(
      "Checked release/release.json",
    );
  });
});
