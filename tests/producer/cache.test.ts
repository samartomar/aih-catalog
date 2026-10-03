import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { defaultCacheDir, ensureOwnedCacheDir } from "../../src/producer/cache.js";
import { buildCandidate } from "../../src/producer/candidate.js";
import { parseDeclaration as fixtureDeclaration } from "../../src/producer/declaration.js";
import { ProducerRefusal } from "../../src/producer/errors.js";
import { fetchSourceTree } from "../../src/producer/fetch.js";
import { readCommitTree } from "../../src/producer/git-tree.js";
import { FixtureRepository, UPSTREAM_A, UPSTREAM_B_CHANGES } from "./git-fixture.js";
import { declaration, makePackageRoot, REPOSITORY, root } from "./helpers.js";

const scratch = mkdtempSync(join(tmpdir(), "aih-producer-cache-"));
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
const reason = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof ProducerRefusal) return error.reason;
    throw error;
  }
  return "no refusal";
};

const realGit = (args: readonly string[]) =>
  execFileSync("git", [...args], {
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });

describe("immutable cached bytes (planted replacement ref)", () => {
  it("serves the pinned commit's own bytes even when refs/replace redirects it", async () => {
    const upstream = new FixtureRepository();
    try {
      const a = upstream.commit(UPSTREAM_A, "first");
      const b = upstream.commit(UPSTREAM_B_CHANGES, "second");
      const cache = join(scratch, "replace-cache");
      mkdirSync(cache);
      const gitDir = join(cache, "mattpocock__skills.git");
      execFileSync("git", ["clone", "-q", "--bare", upstream.dir, gitDir]);
      execFileSync("git", ["-C", gitDir, "replace", a, b]);
      writeFileSync(join(cache, "mattpocock__skills.verified"), `${a}\n`);
      const tree = await fetchSourceTree({
        declaration: declaration(),
        repository: REPOSITORY,
        commit: a,
        cacheDir: cache,
        git: realGit,
        http: async () => {
          throw new Error("network must not be used");
        },
      });
      expect(tree.cache).toBe("hit");
      const skill = Buffer.from(tree.read("skills/productivity/grilling/SKILL.md")).toString();
      expect(skill).toBe(UPSTREAM_A["skills/productivity/grilling/SKILL.md"]);
      expect(tree.inventory.paths.has("skills/productivity/to-questionnaire/SKILL.md")).toBe(false);
    } finally {
      upstream.dispose();
    }
  });

  it("the preparation tool also reads a local git directory without honoring replacements", () => {
    const upstream = new FixtureRepository();
    try {
      const a = upstream.commit(UPSTREAM_A, "first");
      const b = upstream.commit(UPSTREAM_B_CHANGES, "second");
      const items = ["grill-me", "grilling", "handoff", "wait-what", "writing-for-agents"].map(
        (name) => ({
          id: `fixture.${name}`,
          source: "fixture-skills",
          label: name,
          skillPath: `skills/productivity/${name}/SKILL.md`,
          requires: name === "grill-me" ? ["fixture.grilling"] : [],
        }),
      );
      const declarationJson = {
        format: "aihq-catalog-producer-declaration",
        version: 1,
        sources: [
          { id: "fixture-skills", repository: REPOSITORY, licensePath: "LICENSE", license: "MIT" },
        ],
        items,
      };
      const file = join(scratch, "tool-declaration.json");
      writeFileSync(file, JSON.stringify(declarationJson));
      // Seed from the fixture declaration at A, then plant a replacement A -> B.
      const base = buildCandidate({
        declaration: fixtureDeclaration(declarationJson),
        tree: readCommitTree({ repository: REPOSITORY, commit: a, run: upstream.run }),
        package: { name: "@aihq/catalog", version: "0.1.0" },
      });
      const pkg = makePackageRoot(join(scratch, "tool-pkg"), base.files);
      upstream.git("replace", a, b);
      const result = spawnSync(
        process.execPath,
        [
          "tools/prepare-candidate.mjs",
          "--commit",
          a,
          "--root",
          pkg,
          "--declaration",
          file,
          "--out",
          join(scratch, "tool-out"),
          "--source-git-dir",
          upstream.dir,
          "--allow-unverified-origin",
        ],
        { cwd: root, encoding: "utf8", timeout: 120_000 },
      );
      expect(result.status, result.stderr).toBe(0);
      const report = JSON.parse(
        readFileSync(join(scratch, "tool-out", "candidate-report.json"), "utf8"),
      );
      expect(report.summary).toMatchObject({ unchanged: 5, changed: 0, added: 0, removed: 0 });
      expect(report.release.sha256).toBe(report.release.baseSha256);
    } finally {
      upstream.dispose();
    }
  }, 120_000);
});

describe("the retained cache location", () => {
  it("defaults to a per-user directory, never a shared temporary one", () => {
    const posix = defaultCacheDir({
      env: { HOME: "/home/maint" },
      platform: "linux",
      home: "/home/maint",
    });
    expect(posix).toBe(join("/home/maint", ".cache", "aihq-catalog", "source-objects"));
    const xdg = defaultCacheDir({
      env: { XDG_CACHE_HOME: "/var/xdg", HOME: "/home/maint" },
      platform: "linux",
      home: "/home/maint",
    });
    expect(xdg).toBe(join("/var/xdg", "aihq-catalog", "source-objects"));
    const win = defaultCacheDir({
      env: { LOCALAPPDATA: "C:\\Users\\m\\AppData\\Local" },
      platform: "win32",
      home: "C:\\Users\\m",
    });
    expect(win).toBe(join("C:\\Users\\m\\AppData\\Local", "aihq-catalog", "source-objects"));
    expect(
      defaultCacheDir({ env: {}, platform: process.platform, home: homedir() }).startsWith(
        tmpdir(),
      ),
    ).toBe(false);
    expect(() => defaultCacheDir({ env: {}, platform: "linux", home: "" })).toThrow(
      ProducerRefusal,
    );
  });

  it("creates a private directory and refuses a symlink, a file and (on POSIX) an open one", () => {
    const fresh = join(scratch, "owned", "cache");
    ensureOwnedCacheDir(fresh);
    expect(statSync(fresh).isDirectory()).toBe(true);
    if (process.platform !== "win32") expect(statSync(fresh).mode & 0o077).toBe(0);
    expect(() => ensureOwnedCacheDir(fresh)).not.toThrow();

    const file = join(scratch, "a-file");
    writeFileSync(file, "x");
    expect(reason(() => ensureOwnedCacheDir(file))).toBe("cache-unsafe");

    const link = join(scratch, "a-link");
    try {
      symlinkSync(fresh, link, "junction");
      links.push(link);
      expect(reason(() => ensureOwnedCacheDir(link))).toBe("cache-unsafe");
    } catch {
      // links unavailable on this host
    }
    if (process.platform !== "win32") {
      const open = join(scratch, "open-cache");
      mkdirSync(open);
      chmodSync(open, 0o777);
      expect(reason(() => ensureOwnedCacheDir(open))).toBe("cache-unsafe");
    }
    expect(existsSync(dirname(fresh))).toBe(true);
    expect(sep.length).toBe(1);
  });
});
