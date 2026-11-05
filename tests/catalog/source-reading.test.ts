import type * as Fs from "node:fs";
import { renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSource, readLocalSource } from "../../src/catalog/node.js";
import { folder, git, gitRepository, outDir } from "./helpers.js";
import { manifest, registry, tar } from "./npm-fixture.js";

/** Called once, just before the real call, when the named fs function touches `target`. */
const races: { fn: "openSync" | "readdirSync"; target: string; swap: () => void }[] = [];
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof Fs>();
  const racing =
    (fn: "openSync" | "readdirSync") =>
    (path: Fs.PathLike, ...rest: unknown[]) => {
      const index = races.findIndex((race) => race.fn === fn && race.target === String(path));
      if (index !== -1) races.splice(index, 1)[0]?.swap();
      return (actual[fn] as (...args: unknown[]) => unknown)(path, ...rest);
    };
  return { ...actual, openSync: racing("openSync"), readdirSync: racing("readdirSync") };
});
afterEach(() => {
  races.splice(0);
});

const folderLink = (target: string, path: string) =>
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");

describe("reading a local folder that changes while it is read", () => {
  it("refuses a file replaced by another file between listing and reading", () => {
    const root = folder({ "notes/a.md": "mine\n" });
    const outside = folder({ "secret.md": "outside\n" }, "elsewhere");
    const target = join(root, "notes", "a.md");
    races.push({
      fn: "openSync",
      target,
      swap: () => renameSync(join(outside, "secret.md"), target),
    });
    const read = readLocalSource(root);
    expect(read).toMatchObject({ status: "refused", code: "source-mismatch" });
    expect(JSON.stringify(read)).not.toContain("outside");
  });

  it("refuses a folder replaced by a link to another folder before it is listed", () => {
    const root = folder({ "notes/a.md": "mine\n" });
    const outside = folder({ "secret.md": "outside\n" }, "elsewhere");
    const notes = join(root, "notes");
    races.push({
      fn: "readdirSync",
      target: notes,
      swap: () => {
        renameSync(notes, join(root, "moved"));
        folderLink(outside, notes);
      },
    });
    const read = readLocalSource(root);
    expect(read).toMatchObject({ status: "refused" });
    expect(JSON.stringify(read)).not.toContain("secret.md");
  });

  it("refuses a file reached through a folder swapped for a link after it was listed", () => {
    const root = folder({ "notes/a.md": "mine\n" });
    const outside = folder({ "a.md": "outside\n" }, "elsewhere");
    const notes = join(root, "notes");
    races.push({
      fn: "openSync",
      target: join(notes, "a.md"),
      swap: () => {
        renameSync(notes, join(root, "moved"));
        folderLink(outside, notes);
      },
    });
    const read = readLocalSource(root);
    expect(read).toMatchObject({ status: "refused" });
    expect(JSON.stringify(read)).not.toContain("outside");
  });
});

describe("one rule for Git metadata in every source", () => {
  it("skips a .git folder or file at any depth and in any case in a local folder", () => {
    const root = folder({
      "skills/tidy/SKILL.md": "---\nname: tidy\ndescription: Tidy.\n---\n",
      ".GIT/config": "[core]\n",
      "vendor/lib/.git/HEAD": "ref: refs/heads/main\n",
      "vendor/other/.Git": "gitdir: ../../.git/modules/other\n",
    });
    const read = readLocalSource(root);
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    expect(read.files.map((file) => file.path)).toEqual(["skills/tidy/SKILL.md"]);
    expect(read.skipped).toEqual([
      { path: ".GIT", reason: "vcs-metadata" },
      { path: "vendor/lib/.git", reason: "vcs-metadata" },
      { path: "vendor/other/.Git", reason: "vcs-metadata" },
    ]);
  });

  it("refuses a Git tree entry named .git in any case", async () => {
    const upstream = gitRepository({ "README.md": "r\n" });
    const blob = git(upstream.path, "rev-parse", "HEAD:README.md");
    const file = join(folder({}, "tree"), "tree");
    writeFileSync(file, Buffer.concat([Buffer.from("100644 .GiT\0"), Buffer.from(blob, "hex")]));
    const tree = git(upstream.path, "hash-object", "-t", "tree", "-w", "--literally", file);
    const commit = git(upstream.path, "commit-tree", tree, "-m", "metadata");
    git(upstream.path, "update-ref", "refs/heads/main", commit);
    const fetched = await fetchSource(
      { kind: "git", repository: upstream.path, ref: "main" },
      { outDir: outDir() },
    );
    expect(fetched).toMatchObject({ status: "refused", code: "path-escape" });
  });

  it("refuses an npm tarball entry under .git in any case", async () => {
    for (const path of ["package/.git/config", "package/lib/.GIT/hooks/post-checkout"]) {
      const bytes = gzipSync(
        tar([
          { path: "package/package.json", text: manifest("@fixture/skills", "1.0.0") },
          { path, text: "x" },
        ]),
      );
      const served = await registry({
        "@fixture/skills": { latest: "1.0.0", versions: { "1.0.0": bytes } },
      });
      expect(
        await fetchSource(
          { kind: "npm", package: "@fixture/skills", version: "1.0.0" },
          { outDir: outDir(), registry: served.url },
        ),
        path,
      ).toMatchObject({ status: "refused", code: "path-escape" });
    }
  }, 30_000);
});
