import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256 } from "./fixtures.js";
import { installedRoot } from "./installed-fixture.js";

const root = resolve(import.meta.dirname, "../..");
const RELEASE = "release/release.json";
const SNAPSHOT = "src/production/data/mattpocock.snapshot.json";
const NOTE = "release/materials/aihq/project-context/ai-coding/adapters/codex.md";

const env = () => {
  const copy = { ...process.env };
  delete copy.AIHQ_RELEASE_BASELINE;
  return copy;
};
const run = (dir: string, mode: "--check" | "--context-only") =>
  spawnSync(process.execPath, ["tools/generate-release.mjs", mode, dir], {
    cwd: root,
    env: env(),
    encoding: "utf8",
  });
/** The release tree of a disposable installed root, with the snapshot the advanced-state check reads. */
function scratchCopy() {
  const fixture = installedRoot("context-only");
  const snapshot = join(fixture.root, SNAPSHOT);
  mkdirSync(dirname(snapshot), { recursive: true });
  cpSync(resolve(root, SNAPSHOT), snapshot);
  return fixture;
}
const tree = (dir: string) => {
  const files = new Map<string, string>();
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(relative(dir, path).replaceAll("\\", "/"), sha256(readFileSync(path)));
    }
  };
  walk(join(dir, "release"));
  return files;
};
type Release = { schema: string; items: { id: string; kind: string; clientId?: string }[] };
const rewriteRelease = (dir: string, change: (release: Release) => void) => {
  const path = join(dir, RELEASE);
  const release = JSON.parse(readFileSync(path, "utf8")) as Release;
  change(release);
  writeFileSync(path, `${JSON.stringify(release)}\n`);
};

describe("context-only generation in a scratch copy", () => {
  it("restores the authored context and its 1.4 format while keeping every other item", () => {
    const fixture = scratchCopy();
    try {
      const before = tree(fixture.root);
      rewriteRelease(fixture.root, (release) => {
        release.schema = "urn:aihq:catalog:release:1.0.0";
        for (const item of release.items) delete item.clientId;
      });
      writeFileSync(join(fixture.root, NOTE), "stale\n");
      const result = run(fixture.root, "--context-only");
      expect(result.status, result.stderr).toBe(0);
      expect(tree(fixture.root)).toEqual(before);
      const check = run(fixture.root, "--check");
      expect(check.status, check.stderr).toBe(0);
    } finally {
      fixture.cleanup();
    }
  }, 120_000);

  it("refuses a release without the authored context source", () => {
    const fixture = scratchCopy();
    try {
      const path = join(fixture.root, RELEASE);
      const release = JSON.parse(readFileSync(path, "utf8")) as { sources: { id: string }[] };
      release.sources = release.sources.filter((source) => source.id !== "aihq-project-context");
      writeFileSync(path, `${JSON.stringify(release)}\n`);
      const result = run(fixture.root, "--context-only");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("aihq-project-context");
    } finally {
      fixture.cleanup();
    }
  }, 120_000);
});
