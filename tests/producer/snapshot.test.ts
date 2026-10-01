import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ProducerRefusal } from "../../src/producer/errors.js";
import {
  assertCleanTracked,
  readCommittedFiles,
  readSnapshot,
  SNAPSHOT_FILE,
  snapshotOf,
  verifyWorkspace,
  withBuild,
  writeCommittedFiles,
  writeSnapshot,
} from "../../src/producer/snapshot.js";

const scratch = mkdtempSync(join(tmpdir(), "aih-producer-snapshot-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const reason = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof ProducerRefusal) return error.reason;
    throw error;
  }
  return "no refusal";
};

function repo(name: string): string {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  const config = join(scratch, "empty.gitconfig");
  writeFileSync(config, "");
  const run = (...args: string[]) =>
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
    ).trim();
  run("init", "-q", "--initial-branch=main");
  writeFileSync(join(dir, "package.json"), '{"name":"x"}\n');
  writeFileSync(join(dir, "package-lock.json"), '{"lockfileVersion":3}\n');
  mkdirSync(join(dir, "tools"));
  writeFileSync(join(dir, "tools", "run.mjs"), "export const v = 1;\n");
  run("add", "-A");
  run("commit", "-q", "-m", "first");
  return dir;
}
const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

describe("a cold measurement records a commit, not a working tree", () => {
  it("refuses a dirty tracked file but ignores untracked files", () => {
    const dir = repo("clean");
    writeFileSync(join(dir, "untracked.txt"), "not part of the commit");
    expect(() => assertCleanTracked(dir)).not.toThrow();
    appendFileSync(join(dir, "tools", "run.mjs"), "// edit\n");
    expect(reason(() => assertCleanTracked(dir))).toBe("source-dirty");
  });

  it("reads the committed bytes even when the working tree has moved on", () => {
    const dir = repo("committed");
    writeFileSync(join(dir, "untracked.txt"), "live only");
    appendFileSync(join(dir, "tools", "run.mjs"), "// live edit, not committed\n");
    const committed = readCommittedFiles(dir);
    expect(committed.commit).toBe(git(dir, "rev-parse", "HEAD"));
    expect([...committed.files.keys()].sort()).toEqual([
      "package-lock.json",
      "package.json",
      "tools/run.mjs",
    ]);
    expect(committed.files.get("tools/run.mjs")?.bytes.toString()).toBe("export const v = 1;\n");
    const target = join(scratch, "committed-copy");
    writeCommittedFiles(target, committed.files);
    expect(readFileSync(join(target, "tools", "run.mjs"), "utf8")).toBe("export const v = 1;\n");
    expect(() => readFileSync(join(target, "untracked.txt"))).toThrow();
  });

  it("refuses to copy into a workspace that already holds files", () => {
    const dir = repo("occupied");
    const target = join(scratch, "occupied-ws");
    mkdirSync(target);
    writeFileSync(join(target, "keep.txt"), "keep");
    expect(reason(() => writeCommittedFiles(target, readCommittedFiles(dir).files))).toBe(
      "workspace-not-empty",
    );
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("keep");
  });

  it("derives an identity that follows the commit", () => {
    const dir = repo("identity");
    const first = snapshotOf(readCommittedFiles(dir));
    expect(first.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshotOf(readCommittedFiles(dir)).snapshotSha256).toBe(first.snapshotSha256);
    writeFileSync(join(dir, "tools", "run.mjs"), "export const v = 2;\n");
    git(dir, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qam", "second");
    expect(snapshotOf(readCommittedFiles(dir)).snapshotSha256).not.toBe(first.snapshotSha256);
  });
});

describe("a retained workspace must still be the recorded cold one", () => {
  /** A workspace as a cold run leaves it: committed files, build output, installed dependencies. */
  function coldWorkspace(name: string) {
    const dir = repo(`${name}-src`);
    const ws = join(scratch, `${name}-ws`);
    const committed = readCommittedFiles(dir);
    writeCommittedFiles(ws, committed.files);
    mkdirSync(join(ws, "dist", "release"), { recursive: true });
    writeFileSync(join(ws, "dist", "release", "reader.js"), "export {};\n");
    mkdirSync(join(ws, "node_modules"), { recursive: true });
    writeFileSync(join(ws, "node_modules", ".package-lock.json"), '{"packages":{}}\n');
    const snapshot = withBuild(snapshotOf(committed), ws);
    writeSnapshot(ws, snapshot);
    return { ws, snapshot };
  }

  it("accepts the untouched workspace", () => {
    const { ws, snapshot } = coldWorkspace("ok");
    expect(readSnapshot(ws)).toEqual(snapshot);
    expect(verifyWorkspace(ws, snapshot)).toEqual([]);
  });

  it("names a changed or deleted tracked file, an extra file, and stale build or dependencies", () => {
    const { ws, snapshot } = coldWorkspace("stale");
    appendFileSync(join(ws, "tools", "run.mjs"), "// changed after the cold run\n");
    unlinkSync(join(ws, "package-lock.json"));
    writeFileSync(join(ws, "tools", "extra.mjs"), "export {};\n");
    writeFileSync(join(ws, "dist", "release", "reader.js"), "export const stale = true;\n");
    writeFileSync(join(ws, "node_modules", ".package-lock.json"), '{"packages":{"x":{}}}\n');
    expect(verifyWorkspace(ws, snapshot).sort()).toEqual([
      "build output (dist) differs from the cold run",
      "changed: tools/run.mjs",
      "installed dependencies differ from the cold run",
      "missing: package-lock.json",
      "unexpected: tools/extra.mjs",
    ]);
  });

  it("reports missing build output and dependencies, and a missing record", () => {
    const { ws, snapshot } = coldWorkspace("gone");
    rmSync(join(ws, "dist"), { recursive: true });
    rmSync(join(ws, "node_modules"), { recursive: true });
    expect(verifyWorkspace(ws, snapshot)).toEqual([
      "build output (dist) is missing",
      "installed dependencies (node_modules) are missing",
    ]);
    unlinkSync(join(ws, SNAPSHOT_FILE));
    expect(reason(() => readSnapshot(ws))).toBe("workspace-unrecorded");
  });
});
