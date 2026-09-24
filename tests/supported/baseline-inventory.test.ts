import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  baselineInventoryFromTreeV1,
  emitBaselineInventoryV1,
  type GitTreeEntryV1,
} from "../../src/production/catalog/baseline-inventory-v1.js";

const COMMIT = "a".repeat(40);
const hash = (key: string) => createHash("sha256").update(key, "utf8").digest("hex").slice(0, 12);
const blob = (path: string, mode = "100644"): GitTreeEntryV1 => ({ mode, type: "blob", path });
const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("whole-repository baseline inventory", () => {
  it("partitions every regular file into disjoint skill and runtime components", () => {
    const inventory = baselineInventoryFromTreeV1("ecc", COMMIT, [
      blob("README.md"),
      blob("package.json"),
      blob("AGENTS.md", "120000"),
      blob("agents/planner.md"),
      blob("agents/nested/reviewer.md"),
      blob("skills/tdd/SKILL.md"),
      blob("skills/tdd/references/a.md"),
      blob("skills/deep/inner/SKILL.md"),
      blob("skills/README.md"),
      blob("docs/guide.md"),
      blob("docs/zh/skills/translate/SKILL.md"),
      blob("docs/zh/intro.md"),
      blob(".cursor/rules/a.mdc", "100755"),
    ]);
    expect(Object.keys(inventory)).toEqual(["components", "id", "owner", "pinnedSha", "repo"]);
    expect(inventory).toMatchObject({
      id: "ecc",
      owner: "affaan-m",
      repo: "ECC",
      pinnedSha: COMMIT,
    });
    expect(inventory.components).toEqual(
      [
        { id: `runtime:cursor-${hash(".cursor")}`, paths: [".cursor"] },
        { id: `runtime:agents-${hash("agents")}`, paths: ["agents"] },
        { id: `runtime:docs-${hash("docs")}`, paths: ["docs/guide.md", "docs/zh/intro.md"] },
        { id: `runtime:root-${hash("root")}`, paths: ["README.md", "package.json"] },
        { id: `runtime:skills-${hash("skills")}`, paths: ["skills/README.md"] },
        {
          id: `skill:docs-zh-skills-translate-${hash("docs/zh/skills/translate")}`,
          paths: ["docs/zh/skills/translate"],
          skillContent: true,
        },
        {
          id: `skill:skills-deep-inner-${hash("skills/deep/inner")}`,
          paths: ["skills/deep/inner"],
          skillContent: true,
        },
        { id: `skill:skills-tdd-${hash("skills/tdd")}`, paths: ["skills/tdd"], skillContent: true },
      ].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    );
  });

  it("orders component paths by code unit, as Scan normalizes them", () => {
    const inventory = baselineInventoryFromTreeV1("superpowers", COMMIT, [
      blob("b.md"),
      blob("_a.md"),
      blob("B.md"),
      blob("a.md"),
    ]);
    expect(inventory.components[0]?.paths).toEqual(["B.md", "_a.md", "a.md", "b.md"]);
  });

  it.each([
    ["a SKILL.md at the repository root", [blob("SKILL.md")], /repository root/],
    [
      "a skill inside another skill",
      [blob("skills/a/SKILL.md"), blob("skills/a/b/SKILL.md")],
      /skill skills\/a\/b is inside skill skills\/a/,
    ],
    [
      "a symbolic link inside a directory component",
      [blob("hooks/run.sh"), blob("hooks/link", "120000")],
      /hooks\/link is a symbolic link inside component directory hooks/,
    ],
    [
      "a symbolic link inside a skill",
      [blob("skills/a/SKILL.md"), blob("skills/a/link", "120000")],
      /skills\/a\/link is a symbolic link inside component directory skills\/a/,
    ],
    [
      "a submodule",
      [{ mode: "160000", type: "commit", path: "vendor/lib" }],
      /unsupported tree entry/,
    ],
    [
      "a top-level directory that collides with the root key",
      [blob("x.md"), blob("root/a.md")],
      /repeats component id/,
    ],
    ["a path whose component slug is empty", [blob("__/a.md")], /empty component slug/],
    ["no regular file", [blob("AGENTS.md", "120000")], /no regular file/],
    ["an unsafe path", [blob("../x.md")], /unsafe tree path/],
  ] as const)("refuses %s", (_label, entries, reason) => {
    expect(() => baselineInventoryFromTreeV1("ecc", COMMIT, [...entries])).toThrow(reason);
  });

  it("rejects an unknown subject or a malformed commit", () => {
    expect(() => baselineInventoryFromTreeV1("anthropics-skills", COMMIT, [blob("a.md")])).toThrow(
      /unknown subject/,
    );
    expect(() => baselineInventoryFromTreeV1("ecc", "5064474d", [blob("a.md")])).toThrow(/commit/);
  });

  describe("from a pinned git checkout", () => {
    const git = (cwd: string, ...args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "-c",
          "core.autocrlf=false",
          "-c",
          "core.symlinks=true",
          ...args,
        ],
        { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();

    function checkout(origin = "https://github.com/obra/Superpowers.git") {
      const root = mkdtempSync(join(tmpdir(), "aih-baseline-inventory-"));
      temporary.push(root);
      const write = (path: string, text: string) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
      };
      write("README.md", "# r\n");
      write("skills/brainstorming/SKILL.md", "---\nname: b\n---\n");
      write("hooks/session-start", "#!/bin/sh\n");
      git(root, "init", "-q");
      git(root, "remote", "add", "origin", origin);
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", "fixture");
      return { root, commit: git(root, "rev-parse", "HEAD") };
    }

    it("emits the inventory of the commit's tracked tree", () => {
      const { root, commit } = checkout();
      // Untracked files are not part of the pinned tree.
      writeFileSync(join(root, "untracked.md"), "x\n");
      expect(emitBaselineInventoryV1("superpowers", commit, root)).toEqual({
        components: [
          { id: `runtime:hooks-${hash("hooks")}`, paths: ["hooks"] },
          { id: `runtime:root-${hash("root")}`, paths: ["README.md"] },
          {
            id: `skill:skills-brainstorming-${hash("skills/brainstorming")}`,
            paths: ["skills/brainstorming"],
            skillContent: true,
          },
        ],
        id: "superpowers",
        owner: "obra",
        pinnedSha: commit,
        repo: "Superpowers",
      });
    });

    it("excludes a tracked symbolic link at the top level", () => {
      const { root } = checkout();
      try {
        symlinkSync("README.md", join(root, "AGENTS.md"));
      } catch {
        return; // This host cannot create symbolic links; the tree-level case above covers it.
      }
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", "link");
      const commit = git(root, "rev-parse", "HEAD");
      const inventory = emitBaselineInventoryV1("superpowers", commit, root);
      expect(inventory.components.flatMap((component) => component.paths)).not.toContain(
        "AGENTS.md",
      );
    });

    it("refuses a checkout of another repository or a commit it does not hold", () => {
      const other = checkout("https://github.com/someone/Superpowers.git");
      expect(() => emitBaselineInventoryV1("superpowers", other.commit, other.root)).toThrow(
        /origin is https:\/\/github.com\/someone\/Superpowers.git, not obra\/Superpowers/,
      );
      const { root } = checkout();
      expect(() => emitBaselineInventoryV1("superpowers", "b".repeat(40), root)).toThrow(
        /does not hold commit/,
      );
    });
  });
});
