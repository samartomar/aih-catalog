import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { limits } from "../../src/catalog/contracts.js";
import { fetchSource } from "../../src/catalog/node.js";
import { buildContent, checkContent } from "../../src/catalog/producer.js";
import { planInstall, readContent } from "../../src/catalog/reader.js";
import { findItems } from "../../src/catalog/source.js";
import { folder, git, gitRepository, outDir, profile, sha, sortKeys, utf8 } from "./helpers.js";

const savedEnvironment = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env))
    if (!(key in savedEnvironment)) delete process.env[key];
  Object.assign(process.env, savedEnvironment);
});

/** A program that records it ran by creating `marker`, then runs its arguments. */
function tripwire(): { script: string; marker: string } {
  const root = folder({}, "tripwire");
  const marker = join(root, "RAN");
  const script = join(root, "run.sh");
  writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\nexec "$@"\n`, { mode: 0o755 });
  return { script, marker };
}

/** fetch → findItems → buildContent, failing loudly on any non-ok step. */
async function contentFrom(fetched: Awaited<ReturnType<typeof fetchSource>>, framework: string) {
  if (fetched.status !== "ok") throw new Error(JSON.stringify(fetched));
  const found = findItems(fetched.files, { framework });
  if (found.status !== "ok") throw new Error(JSON.stringify(found));
  const built = await buildContent(fetched.source, fetched.files, found.items, { framework });
  if (built.status !== "ok") throw new Error(JSON.stringify(built));
  return { found, built };
}

const LICENSE = "MIT Licence\n";
const REVIEW =
  "---\nname: review\ndescription: Review the current change.\n---\n\nReview carefully.\n";
const STYLE = "# Style\n\nUse two spaces.\n";

describe("fetching a pinned Git source", () => {
  it("resolves a branch to its exact commit and keeps only the subfolder", async () => {
    const upstream = gitRepository(
      { "pack/skills/review/SKILL.md": "old\n" },
      {
        "README.md": "outside\n",
        "pack/LICENSE": LICENSE,
        "pack/skills/review/SKILL.md": REVIEW,
        "pack/rules/style.md": STYLE,
        "pack/bin/run.sh": { text: "#!/bin/sh\n", executable: true },
      },
    );
    const commit = upstream.commits[1];

    const fetched = await fetchSource(
      { kind: "git", repository: upstream.path, ref: "main", subpath: "pack" },
      { outDir: outDir() },
    );

    if (fetched.status !== "ok") throw new Error(JSON.stringify(fetched));
    expect(fetched.source).toEqual({
      kind: "git",
      repository: upstream.path,
      commit,
      subpath: "pack",
    });
    expect(fetched.files.map(({ path, mode, sha256 }) => ({ path, mode, sha256 }))).toEqual([
      { path: "LICENSE", mode: "100644", sha256: sha(LICENSE) },
      { path: "bin/run.sh", mode: "100755", sha256: sha("#!/bin/sh\n") },
      { path: "rules/style.md", mode: "100644", sha256: sha(STYLE) },
      { path: "skills/review/SKILL.md", mode: "100644", sha256: sha(REVIEW) },
    ]);
    expect(utf8(fetched.files[3]?.bytes as Uint8Array)).toBe(REVIEW);
  });

  it("plans the subfolder's items with its notice and the exact commit as source identity", async () => {
    const upstream = gitRepository({
      "pack/LICENSE": LICENSE,
      "pack/skills/review/SKILL.md": REVIEW,
      "pack/rules/style.md": STYLE,
      "other/skills/elsewhere/SKILL.md": REVIEW,
    });
    const commit = upstream.commits[0] as string;
    const fetched = await fetchSource(
      { kind: "git", repository: upstream.path, ref: "main", subpath: "pack" },
      { outDir: outDir() },
    );
    const { built } = await contentFrom(fetched, "pack");

    expect(built.content.sources).toEqual([
      {
        id: "pack",
        kind: "git",
        repository: upstream.path,
        commit,
        subpath: "pack",
        notices: [{ sourcePath: "LICENSE", sha256: sha(LICENSE), covers: "/" }],
      },
    ]);
    expect(built.content.items.map((item) => item.id)).toEqual([
      "pack.rule.style",
      "pack.skill.review",
    ]);
    const reread = readContent(built.bytes);
    if (reread.status !== "ok") throw new Error(JSON.stringify(reread));
    expect(
      await checkContent(reread.content, fetched.status === "ok" ? fetched.files : []),
    ).toEqual({ status: "ok", problems: [] });

    const plan = planInstall(["pack.skill.review"], [reread.content], [profile("claude-code")], {
      scope: "project",
      data: null,
    });
    if (!("plan" in plan)) throw new Error(JSON.stringify(plan));
    expect(plan.status).toBe("ok");
    expect(plan.plan.map((step) => [step.path, step.from])).toEqual([
      [
        ".aihq/notices/pack/LICENSE",
        { sourceId: "pack", sourcePath: "LICENSE", sha256: sha(LICENSE) },
      ],
      [
        ".claude/skills/review/SKILL.md",
        {
          item: "pack.skill.review",
          sourceId: "pack",
          sourcePath: "skills/review/SKILL.md",
          sha256: sha(REVIEW),
        },
      ],
    ]);
  });

  it("never records a branch, tag or range as a source identity", async () => {
    const upstream = gitRepository({ "skills/review/SKILL.md": REVIEW });
    const fetched = await fetchSource(
      { kind: "git", repository: upstream.path },
      { outDir: outDir() },
    );
    const { built, found } = await contentFrom(fetched, "up");
    expect(built.content.sources[0]).toMatchObject({ commit: upstream.commits[0] });
    if (fetched.status !== "ok") throw new Error("unreachable");

    for (const mutable of [
      { kind: "git", repository: upstream.path, ref: "main" },
      { kind: "git", repository: upstream.path, commit: "main" },
      { kind: "npm", package: "pkg", range: "^1" },
      { kind: "npm", package: "pkg", version: "^1" },
    ]) {
      const result = await buildContent(mutable as never, fetched.files, found.items, {
        framework: "up",
      });
      expect(result.status, JSON.stringify(mutable)).toBe("invalid");
    }

    const document = JSON.parse(utf8(built.bytes));
    const canonical = (value: unknown) =>
      new TextEncoder().encode(`${JSON.stringify(sortKeys(value), null, 2)}\n`);
    expect(readContent(canonical(document)).status).toBe("ok");
    const { commit: _commit, ...unpinned } = document.sources[0];
    for (const source of [
      { ...document.sources[0], commit: "main" },
      unpinned,
      { id: "up", kind: "npm", package: "pkg", version: "^1", notices: [] },
      { id: "up", kind: "npm", package: "pkg", notices: [] },
    ]) {
      const result = readContent(canonical({ ...document, sources: [source] }));
      expect(result, JSON.stringify(source)).toMatchObject({
        status: "invalid",
        problems: [{ path: expect.stringMatching(/^\/sources\/0\/(commit|version)$/) }],
      });
    }
  });

  it("runs no hooks or configured programs and reads upstream scripts only as data", async () => {
    const { script, marker } = tripwire();
    const hooks = folder({}, "hooks");
    for (const hook of ["reference-transaction", "post-checkout", "post-merge", "pre-push"])
      writeFileSync(join(hooks, hook), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    const config = join(folder({}, "config"), "gitconfig");
    writeFileSync(
      config,
      `[uploadpack]\n\tpackObjectsHook = ${script}\n[core]\n\thooksPath = ${hooks}\n\tfsmonitor = ${script}\n[init]\n\ttemplateDir = ${hooks}\n`,
    );
    process.env.GIT_CONFIG_GLOBAL = config;
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "uploadpack.packObjectsHook";
    process.env.GIT_CONFIG_VALUE_0 = script;
    const upstream = gitRepository({
      "skills/review/SKILL.md": REVIEW,
      ".githooks/post-checkout": { text: `#!/bin/sh\ntouch '${marker}'\n`, executable: true },
      "install.sh": { text: `#!/bin/sh\ntouch '${marker}'\n`, executable: true },
      "package.json": JSON.stringify({ scripts: { postinstall: `touch '${marker}'` } }),
    });

    const fetched = await fetchSource(
      { kind: "git", repository: `file://${upstream.path}` },
      { outDir: outDir() },
    );

    expect(fetched.status).toBe("ok");
    expect(existsSync(marker)).toBe(false);
    if (fetched.status !== "ok") return;
    expect(fetched.files.find((file) => file.path === "install.sh")?.mode).toBe("100755");
  });

  it("lists links and submodules without following them", async () => {
    const upstream = gitRepository({
      "skills/review/SKILL.md": REVIEW,
      "skills/review/escape": { link: "/etc/passwd" },
    });
    git(
      upstream.path,
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${upstream.commits[0]},vendor/sub`,
    );
    git(upstream.path, "commit", "--quiet", "-m", "submodule");

    const fetched = await fetchSource(
      { kind: "git", repository: upstream.path },
      { outDir: outDir() },
    );

    if (fetched.status !== "ok") throw new Error(JSON.stringify(fetched));
    expect(fetched.files.find((file) => file.path === "skills/review/escape")).toEqual({
      path: "skills/review/escape",
      mode: "link",
    });
    expect(fetched.skipped).toEqual([{ path: "vendor/sub", reason: "submodule" }]);
    const found = findItems(fetched.files, { framework: "up" });
    expect(found).toMatchObject({
      status: "ok",
      leftOver: [{ path: "skills/review/escape", reason: "link" }],
    });
  });

  it("refuses a tree entry that escapes the source, before reading any file", async () => {
    for (const name of ["..", "a\\b", ".git"]) {
      const upstream = gitRepository({ "skills/review/SKILL.md": REVIEW });
      const blob = git(upstream.path, "rev-parse", "HEAD:skills/review/SKILL.md");
      const tree = execTree(upstream.path, [`100644 blob ${blob}\t${name}`]);
      const commit = git(upstream.path, "commit-tree", tree, "-m", "escape");
      git(upstream.path, "update-ref", "refs/heads/main", commit);

      const fetched = await fetchSource(
        { kind: "git", repository: upstream.path, ref: "main" },
        { outDir: outDir() },
      );
      expect(fetched, name).toMatchObject({ status: "refused", code: "path-escape" });
    }
  });

  it("refuses a missing ref, a missing subpath and a subpath that is a file", async () => {
    const upstream = gitRepository({ "pack/skills/review/SKILL.md": REVIEW, "README.md": "r\n" });
    const fetch = (candidate: object) =>
      fetchSource({ kind: "git", repository: upstream.path, ...candidate }, { outDir: outDir() });
    expect(await fetch({ ref: "no-such-branch" })).toMatchObject({ code: "fetch-failed" });
    expect(await fetch({ ref: "0".repeat(40) })).toMatchObject({ code: "fetch-failed" });
    expect(await fetch({ subpath: "missing" })).toMatchObject({ code: "not-found" });
    expect(await fetch({ subpath: "README.md" })).toMatchObject({ code: "not-a-directory" });
    expect(await fetch({ ref: "--upload-pack=touch" })).toMatchObject({ status: "invalid" });
    expect(
      await fetchSource({ kind: "git", repository: "ext::sh -c touch" }, { outDir: outDir() }),
    ).toMatchObject({ status: "invalid" });
  });

  it("refuses a file over the source file limit without a partial result", async () => {
    const upstream = gitRepository({
      "skills/review/SKILL.md": REVIEW,
      "skills/review/big.bin": "\0".repeat(limits.sourceFileBytes + 1),
    });
    const fetched = await fetchSource(
      { kind: "git", repository: upstream.path },
      { outDir: outDir() },
    );
    expect(fetched).toMatchObject({ status: "refused", code: "limit", limit: "sourceFileBytes" });
    expect("files" in fetched).toBe(false);
  });
});

/** Writes a raw tree object (entries as `ls-tree` lines) without Git's name checks. */
function execTree(cwd: string, lines: readonly string[]): string {
  const parts: Buffer[] = [];
  for (const line of lines) {
    const [meta, name] = line.split("\t") as [string, string];
    const [mode, , oid] = meta.split(" ") as [string, string, string];
    parts.push(
      Buffer.from(`${mode === "040000" ? "40000" : mode} ${name}\0`),
      Buffer.from(oid, "hex"),
    );
  }
  const file = join(folder({}, "tree"), "tree");
  writeFileSync(file, Buffer.concat(parts));
  return git(cwd, "hash-object", "-t", "tree", "-w", "--literally", file);
}
