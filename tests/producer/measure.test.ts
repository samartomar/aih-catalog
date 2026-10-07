import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { npmCliPath } from "../../src/producer/package.js";
import { SNAPSHOT_FILE } from "../../src/producer/snapshot.js";
import { FixtureRepository } from "./git-fixture.js";
import { committedRelease, pinnedUpstreamFiles, root } from "./helpers.js";

const scratch = mkdtempSync(join(tmpdir(), "aih-producer-measure-"));
const upstream = new FixtureRepository();
afterAll(() => {
  upstream.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

const GRILLING = "skills/productivity/grilling/SKILL.md";
let commitB = "";
let toolRepo = "";

/** A committed repository holding the tools, manifest, lock and published release (no built output). */
function makeToolRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const entry of [
    "package-lock.json",
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    "tools",
    "schemas",
    "producer",
  ]) {
    cpSync(join(root, entry), join(dir, entry), { recursive: true });
  }
  for (const [path, bytes] of committedRelease()) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  // The build is the real one elsewhere; here it installs the already built output.
  manifest.scripts["build:dist"] =
    "node -e \"require('node:fs').cpSync(process.env.AIH_TEST_DIST, 'dist', {recursive: true})\"";
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(dir, ".gitignore"), "node_modules\ndist\n");
  const config = join(scratch, "empty.gitconfig");
  writeFileSync(config, "");
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-C",
        dir,
        "-c",
        "core.autocrlf=false",
        "-c",
        "user.name=T",
        "-c",
        "user.email=t@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      {
        env: { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" },
        encoding: "utf8",
      },
    );
  git("init", "-q", "--initial-branch=main");
  git("add", "-A");
  git("commit", "-q", "-m", "tool repository");
}

beforeAll(() => {
  if (!existsSync(join(root, "dist/producer/prepare.js")))
    throw new Error("run npm run build:dist first");
  upstream.commit({ ...pinnedUpstreamFiles() }, "carried bytes");
  commitB = upstream.commit(
    {
      [GRILLING]: `${pinnedUpstreamFiles()[GRILLING]?.toString("utf8")}\nAlso summarize.\n`,
    },
    "change grilling",
  );
  toolRepo = join(scratch, "tool-repo");
  makeToolRepo(toolRepo);
}, 60_000);

const env = () => {
  const { npm_execpath: _drop, ...rest } = process.env;
  return { ...rest, AIH_TEST_DIST: join(root, "dist") };
};
const measure = (...args: string[]) =>
  spawnSync(process.execPath, ["tools/measure-candidate.mjs", ...args], {
    cwd: root,
    env: env(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 280_000,
  });
const common = (workspace: string, out: string, condition: string) => [
  "--condition",
  condition,
  "--commit",
  commitB,
  "--workspace",
  workspace,
  "--out",
  out,
  "--source-root",
  toolRepo,
];
const pass = ["--", "--source-git-dir", "", "--allow-unverified-origin"];
const withUpstream = () => pass.map((arg) => (arg === "" ? upstream.dir : arg));

describe("a cold measurement records the committed code it ran", () => {
  const workspace = join(scratch, "ws");
  const cache = join(scratch, "ws-cache");
  const summaryAt = (out: string) =>
    JSON.parse(readFileSync(join(out, "measurement-summary.json"), "utf8"));
  let head = "";

  it("copies exactly the committed bytes, installs, builds and prepares", () => {
    head = execFileSync("git", ["-C", toolRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    writeFileSync(join(toolRepo, "untracked-live.txt"), "never part of the commit");
    const out = join(scratch, "cold-out");
    const result = measure(
      ...common(workspace, out, "cold-install"),
      "--cache-dir",
      cache,
      ...withUpstream(),
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const summary = summaryAt(out);
    expect(summary.outcome).toBe("ready");
    expect(summary.candidate).toMatchObject({ commit: head, dirty: false });
    expect(summary.measurement.snapshot).toMatchObject({ commit: head });
    expect(summary.measurement.snapshot.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.measurement.snapshot.distSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.measurement.originVerified).toBe(false);
    expect(summary.cache.condition).toBe("cold-install");
    expect(
      summary.phases
        .slice(0, 3)
        .map((p: { name: string; status: string }) => `${p.name}:${p.status}`),
    ).toEqual(["checkout:passed", "install-dependencies:passed", "build:passed"]);
    expect(existsSync(join(workspace, "untracked-live.txt"))).toBe(false);
    expect(existsSync(join(workspace, SNAPSHOT_FILE))).toBe(true);
    expect(summary.measurement.note).toContain("not a benchmark claim");
  }, 300_000);

  it("refuses a cold run from a working tree whose tracked files differ from HEAD", () => {
    appendFileSync(join(toolRepo, "tools", "check-release.mjs"), "// uncommitted edit\n");
    try {
      const fresh = join(scratch, "ws-dirty");
      const result = measure(
        ...common(fresh, join(scratch, "dirty-out"), "cold-install"),
        "--cache-dir",
        join(scratch, "dirty-cache"),
        ...withUpstream(),
      );
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/tracked files differ from HEAD/);
      expect(existsSync(fresh)).toBe(false);
    } finally {
      execFileSync("git", ["-C", toolRepo, "checkout", "--", "tools/check-release.mjs"]);
    }
  });

  it("accepts the untouched workspace as a retained-cache run and records the same code", () => {
    const out = join(scratch, "retained-out");
    const result = measure(
      ...common(workspace, out, "retained-cache"),
      "--cache-dir",
      cache,
      ...withUpstream(),
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const summary = summaryAt(out);
    expect(summary.cache.condition).toBe("retained-cache");
    expect(summary.candidate.commit).toBe(head);
    expect(
      summary.phases.slice(0, 3).every((p: { status: string }) => p.status === "skipped"),
    ).toBe(true);
    expect(summary.measurement.snapshot.snapshotSha256).toBe(
      summaryAt(join(scratch, "cold-out")).measurement.snapshot.snapshotSha256,
    );
  }, 300_000);

  it("refuses a changed, extended, rebuilt or reinstalled workspace before claiming anything", () => {
    const attempt = (label: string) => {
      const out = join(scratch, `stale-${label}`);
      const result = measure(
        ...common(workspace, out, "retained-cache"),
        "--cache-dir",
        cache,
        ...withUpstream(),
      );
      expect(result.status, label).toBe(2);
      expect(existsSync(join(out, "measurement-summary.json")), label).toBe(false);
      return result.stderr;
    };
    const file = join(workspace, "tools", "prepare-candidate.mjs");
    const original = readFileSync(file);
    appendFileSync(file, "\n// tampered after the cold run\n");
    expect(attempt("code")).toContain("changed: tools/prepare-candidate.mjs");
    writeFileSync(file, original);

    writeFileSync(join(workspace, "tools", "extra.mjs"), "export {};\n");
    expect(attempt("extra")).toContain("unexpected: tools/extra.mjs");
    rmSync(join(workspace, "tools", "extra.mjs"));

    const built = join(workspace, "dist", "release", "reader.js");
    const builtBytes = readFileSync(built);
    appendFileSync(built, "\n// stale build\n");
    expect(attempt("dist")).toContain("build output (dist) differs");
    writeFileSync(built, builtBytes);

    const hidden = join(workspace, "node_modules", ".package-lock.json");
    renameSync(hidden, `${hidden}.bak`);
    expect(attempt("modules")).toContain("installed dependencies (node_modules) are missing");
    renameSync(`${hidden}.bak`, hidden);

    const snapshot = join(workspace, SNAPSHOT_FILE);
    renameSync(snapshot, `${snapshot}.bak`);
    expect(attempt("unrecorded")).toContain("no recorded cold-install snapshot");
    renameSync(`${snapshot}.bak`, snapshot);

    // Restored byte for byte, the same workspace is accepted again.
    const ok = measure(
      ...common(workspace, join(scratch, "restored-out"), "retained-cache"),
      "--cache-dir",
      cache,
      ...withUpstream(),
    );
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
  }, 600_000);

  it("refuses an occupied output instead of reporting a previous candidate as a new success", () => {
    const out = join(scratch, "cold-out");
    const before = readFileSync(join(out, "measurement-summary.json"));
    const preparedBefore = readFileSync(join(out, "prepare", "timing-summary.json"));
    const result = measure(
      ...common(workspace, out, "retained-cache"),
      "--cache-dir",
      cache,
      ...withUpstream(),
    );
    expect(result.status, result.stdout + result.stderr).toBe(2);
    expect(result.stderr).toContain("out-not-empty");
    expect(readFileSync(join(out, "measurement-summary.json"))).toEqual(before);
    expect(readFileSync(join(out, "prepare", "timing-summary.json"))).toEqual(preparedBefore);
  }, 300_000);
});

describe("the measurement owns its own options", () => {
  const base = () => [
    "--condition",
    "retained-cache",
    "--commit",
    "a".repeat(40),
    "--workspace",
    join(scratch, "does-not-matter"),
  ];
  it.each([
    ["--root", "somewhere"],
    ["--out", "somewhere"],
    ["--cache-dir", "somewhere"],
    ["--condition", "cold-install"],
    ["--commit", "b".repeat(40)],
    ["--detected-at", "2026-01-01T00:00:00Z"],
    ["--dependencies", "text"],
    ["--apply"],
    ["--made-up-option"],
  ])("refuses %s after --", (...extra) => {
    const result = measure(...base(), "--", ...extra);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/cannot be passed through/);
  });

  it("refuses a repeated measurement option or a repeated passthrough value", () => {
    expect(measure(...base(), "--commit", "b".repeat(40)).status).toBe(2);
    expect(measure(...base(), "--", "--source-git-dir", "a", "--source-git-dir", "b").status).toBe(
      2,
    );
  });

  it("refuses a repeated option on the preparation tool itself (last-wins is not allowed)", () => {
    const result = spawnSync(
      process.execPath,
      ["tools/prepare-candidate.mjs", "--commit", "a".repeat(40), "--out", "x", "--out", "y"],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/more than once/);
  });

  it("needs a fresh workspace and cache for cold-install and an existing one for retained-cache", () => {
    const occupied = join(scratch, "occupied-ws");
    mkdirSync(occupied);
    writeFileSync(join(occupied, "keep.txt"), "keep");
    const cold = measure(
      ...common(occupied, join(scratch, "o1"), "cold-install"),
      ...withUpstream(),
    );
    expect(cold.status).toBe(2);
    expect(readFileSync(join(occupied, "keep.txt"), "utf8")).toBe("keep");
    expect(
      measure(...common(join(scratch, "nope"), join(scratch, "o2"), "retained-cache")).status,
    ).toBe(2);
    expect(
      measure("--condition", "warm", "--commit", "a".repeat(40), "--workspace", "x").status,
    ).toBe(2);
    expect(readdirSync(occupied)).toEqual(["keep.txt"]);
  });
});

describe("npm resolution is shared and layout-aware", () => {
  it("finds npm in the sibling and the lib/ layouts, and refuses anything else", () => {
    const savedExec = process.execPath;
    const savedNpm = process.env.npm_execpath;
    const resolveWith = (layout: string | null, npmExecpath?: string) => {
      const base = mkdtempSync(join(scratch, "layout-"));
      if (layout) {
        mkdirSync(dirname(join(base, layout)), { recursive: true });
        writeFileSync(join(base, layout), "// never executed");
      }
      Object.defineProperty(process, "execPath", {
        value: join(base, "bin", "node"),
        configurable: true,
      });
      if (npmExecpath === undefined) delete process.env.npm_execpath;
      else process.env.npm_execpath = npmExecpath;
      try {
        return { base, found: npmCliPath() };
      } catch (error) {
        return { base, found: (error as Error).message };
      }
    };
    try {
      const lib = resolveWith("lib/node_modules/npm/bin/npm-cli.js");
      expect(lib.found).toBe(join(lib.base, "lib", "node_modules", "npm", "bin", "npm-cli.js"));
      const sibling = resolveWith("bin/node_modules/npm/bin/npm-cli.js");
      expect(sibling.found).toBe(
        join(sibling.base, "bin", "node_modules", "npm", "bin", "npm-cli.js"),
      );
      expect(resolveWith(null).found).toMatch(/npm-unavailable/);
      expect(resolveWith(null, "relative/npm-cli.js").found).toMatch(/npm-unavailable/);
    } finally {
      Object.defineProperty(process, "execPath", { value: savedExec, configurable: true });
      if (savedNpm === undefined) delete process.env.npm_execpath;
      else process.env.npm_execpath = savedNpm;
    }
  });

  it("is the one resolver: the measurement tool carries no layout list of its own", () => {
    const source = readFileSync(join(root, "tools", "measure-candidate.mjs"), "utf8");
    expect(source).toContain("npmCliPath");
    expect(source).not.toMatch(/node_modules["'],\s*["']npm["']/);
    expect(source).not.toMatch(/npm_execpath/);
  });
});
