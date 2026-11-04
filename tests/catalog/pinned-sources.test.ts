import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { limits } from "../../src/catalog/contracts.js";
import { fetchSource, readLocalSource } from "../../src/catalog/node.js";
import { buildContent, checkContent } from "../../src/catalog/producer.js";
import { planInstall, readContent } from "../../src/catalog/reader.js";
import { findItems, parseSourceLink } from "../../src/catalog/source.js";
import {
  folder,
  git,
  gitRepository,
  outDir,
  profile,
  sha,
  sortKeys,
  utf8,
  writes,
} from "./helpers.js";
import { integrity, manifest, registry, tar, tarball } from "./npm-fixture.js";

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
  "---\nname: revise\ndescription: Review the current change.\n---\n\nReview carefully.\n";
const STYLE = "# Style\n\nUse two spaces.\n";

describe("fetching a pinned Git source", () => {
  it("resolves a branch to its exact commit and keeps only the subfolder", async () => {
    const upstream = gitRepository(
      { "pack/skills/revise/SKILL.md": "old\n" },
      {
        "README.md": "outside\n",
        "pack/LICENSE": LICENSE,
        "pack/skills/revise/SKILL.md": REVIEW,
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
      { path: "skills/revise/SKILL.md", mode: "100644", sha256: sha(REVIEW) },
    ]);
    expect(utf8(fetched.files[3]?.bytes as Uint8Array)).toBe(REVIEW);
  });

  it("plans the subfolder's items with its notice and the exact commit as source identity", async () => {
    const upstream = gitRepository({
      "pack/LICENSE": LICENSE,
      "pack/skills/revise/SKILL.md": REVIEW,
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
      "pack.skill.revise",
    ]);
    const reread = readContent(built.bytes);
    if (reread.status !== "ok") throw new Error(JSON.stringify(reread));
    expect(
      await checkContent(reread.content, fetched.status === "ok" ? fetched.files : []),
    ).toEqual({ status: "ok", problems: [] });

    const plan = planInstall(["pack.skill.revise"], [reread.content], [profile("claude-code")], {
      scope: "project",
      data: null,
    });
    if (!("plan" in plan)) throw new Error(JSON.stringify(plan));
    expect(plan.status).toBe("ok");
    expect(writes(plan.plan).map((step) => [step.path, step.from])).toEqual([
      [
        ".aihq/notices/pack/LICENSE",
        { sourceId: "pack", sourcePath: "LICENSE", sha256: sha(LICENSE) },
      ],
      [
        ".claude/skills/revise/SKILL.md",
        {
          item: "pack.skill.revise",
          sourceId: "pack",
          sourcePath: "skills/revise/SKILL.md",
          sha256: sha(REVIEW),
        },
      ],
    ]);
  });

  it("pins pasted text naming the default branch, and never records a branch, tag or range", async () => {
    const upstream = gitRepository({ "skills/revise/SKILL.md": REVIEW });
    const link = parseSourceLink(`git clone ${upstream.path}`);
    if (link.status !== "recognised") throw new Error(JSON.stringify(link));
    const fetched = await fetchSource(link.candidate, { outDir: outDir() });
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
      "skills/revise/SKILL.md": REVIEW,
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
      "skills/revise/SKILL.md": REVIEW,
      "skills/revise/escape": { link: "/etc/passwd" },
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
    expect(fetched.files.find((file) => file.path === "skills/revise/escape")).toEqual({
      path: "skills/revise/escape",
      mode: "link",
    });
    expect(fetched.skipped).toEqual([{ path: "vendor/sub", reason: "submodule" }]);
    const found = findItems(fetched.files, { framework: "up" });
    expect(found).toMatchObject({
      status: "ok",
      leftOver: [{ path: "skills/revise/escape", reason: "link" }],
    });
  });

  it("refuses a tree entry that escapes the source, before reading any file", async () => {
    for (const name of ["..", "a\\b", ".git"]) {
      const upstream = gitRepository({ "skills/revise/SKILL.md": REVIEW });
      const blob = git(upstream.path, "rev-parse", "HEAD:skills/revise/SKILL.md");
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
    const upstream = gitRepository({ "pack/skills/revise/SKILL.md": REVIEW, "README.md": "r\n" });
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
      "skills/revise/SKILL.md": REVIEW,
      "skills/revise/big.bin": "\0".repeat(limits.sourceFileBytes + 1),
    });
    const fetched = await fetchSource(
      { kind: "git", repository: upstream.path },
      { outDir: outDir() },
    );
    expect(fetched).toMatchObject({ status: "refused", code: "limit", limit: "sourceFileBytes" });
    expect("files" in fetched).toBe(false);
  });
});

describe("fetching a local candidate", () => {
  it("reads a pasted file URL like readLocalSource, recording no machine path", async () => {
    const root = folder({ "skills/revise/SKILL.md": REVIEW });
    const link = parseSourceLink(pathToFileURL(root).href);
    if (link.status !== "recognised") throw new Error(JSON.stringify(link));
    const fetched = await fetchSource(link.candidate, { outDir: outDir() });
    expect(fetched).toEqual(readLocalSource(root));
    const { built } = await contentFrom(fetched, "mine");
    expect(built.content.sources).toEqual([{ id: "mine", kind: "local", notices: [] }]);
  });
});

const PACKAGE = "@fixture/skills";

describe("fetching a pinned npm source", () => {
  it("resolves a range to one exact version and plans it without running package scripts", async () => {
    const { marker } = tripwire();
    const scripts = Object.fromEntries(
      ["preinstall", "install", "postinstall", "prepack", "prepare", "postpack"].map((name) => [
        name,
        `touch '${marker}'`,
      ]),
    );
    const version = (number: string, review = REVIEW) =>
      tarball([
        { path: "package.json", text: manifest(PACKAGE, number, scripts) },
        { path: "LICENSE", text: LICENSE },
        { path: "skills/revise/SKILL.md", text: review },
        { path: "rules/style.md", text: STYLE },
        {
          path: "bin/setup.js",
          text: `require("fs").writeFileSync('${marker}', "")\n`,
          mode: 0o755,
        },
      ]);
    const served = await registry({
      [PACKAGE]: {
        latest: "2.0.0",
        versions: {
          "1.0.0": version("1.0.0"),
          "1.2.0": version("1.2.0"),
          "2.0.0": version("2.0.0"),
        },
      },
    });

    const link = parseSourceLink(`npx -y ${PACKAGE}@^1`);
    if (link.status !== "recognised") throw new Error(JSON.stringify(link));
    expect(link.candidate).toEqual({ kind: "npm", package: PACKAGE, range: "^1" });
    const fetched = await fetchSource(link.candidate, { outDir: outDir(), registry: served.url });

    if (fetched.status !== "ok") throw new Error(JSON.stringify(fetched));
    expect(fetched.source).toEqual({ kind: "npm", package: PACKAGE, version: "1.2.0" });
    expect(fetched.integrity).toBe(integrity(version("1.2.0")));
    expect(existsSync(marker)).toBe(false);
    expect(fetched.files.map(({ path, mode }) => [path, mode])).toEqual([
      ["LICENSE", "100644"],
      ["bin/setup.js", "100755"],
      ["package.json", "100644"],
      ["rules/style.md", "100644"],
      ["skills/revise/SKILL.md", "100644"],
    ]);

    const { built } = await contentFrom(fetched, "fixture");
    expect(built.content.sources).toEqual([
      {
        id: "fixture",
        kind: "npm",
        package: PACKAGE,
        version: "1.2.0",
        notices: [{ sourcePath: "LICENSE", sha256: sha(LICENSE), covers: "/" }],
      },
    ]);
    const plan = planInstall(["fixture.rule.style"], [built.content], [profile("kiro")], {
      scope: "project",
      data: null,
    });
    if (!("plan" in plan)) throw new Error(JSON.stringify(plan));
    expect(plan.status).toBe("ok");
    expect(
      writes(plan.plan).map((step) => [step.path, step.from?.sourceId, step.from?.sourcePath]),
    ).toEqual([
      [".aihq/notices/fixture/LICENSE", "fixture", "LICENSE"],
      [".kiro/steering/style.md", "fixture", "rules/style.md"],
    ]);
    expect(existsSync(marker)).toBe(false);
  });

  /** Serves `bytes` as PACKAGE@1.0.0 and fetches that exact version. */
  async function fetchServed(bytes: Buffer) {
    const served = await registry({ [PACKAGE]: { latest: "1.0.0", versions: { "1.0.0": bytes } } });
    return fetchSource(
      { kind: "npm", package: PACKAGE, version: "1.0.0" },
      { outDir: outDir(), registry: served.url },
    );
  }
  const packageJson = { path: "package.json", text: manifest(PACKAGE, "1.0.0") };

  it("refuses absolute and parent-traversing tarball entries", async () => {
    for (const path of ["package/../../escape", "/etc/escape", "package/a/../../../escape"]) {
      const bytes = gzipSync(
        tar([
          { path: "package/package.json", text: manifest(PACKAGE, "1.0.0") },
          { path, text: "x" },
        ]),
      );
      expect(await fetchServed(bytes), path).toMatchObject({
        status: "refused",
        code: "path-escape",
      });
    }
  });

  it("lists links and special files without following them", async () => {
    const fetched = await fetchServed(
      tarball([
        packageJson,
        { path: "skills/revise/SKILL.md", text: REVIEW },
        { path: "skills/revise/passwd", type: "2", link: "/etc/passwd" },
        { path: "skills/revise/hard", type: "1", link: "package/package.json" },
        { path: "skills/revise/pipe", type: "6" },
      ]),
    );
    if (fetched.status !== "ok") throw new Error(JSON.stringify(fetched));
    const found = findItems(fetched.files, { framework: "fixture" });
    expect(found).toMatchObject({
      status: "ok",
      leftOver: [
        { path: "package.json", reason: "unrecognised" },
        { path: "skills/revise/hard", reason: "link" },
        { path: "skills/revise/passwd", reason: "link" },
        { path: "skills/revise/pipe", reason: "special-file" },
      ],
    });
  });

  it("holds the unpacked package to the source limits", async () => {
    // A repeated random block: compressible, but under npm's own decompression-ratio guard.
    const block = randomBytes(20_000);
    const filled = (size: number) => {
      const bytes = new Uint8Array(size);
      for (let at = 0; at < size; at += block.byteLength)
        bytes.set(block.subarray(0, size - at), at);
      return bytes;
    };
    const big = await fetchServed(
      tarball([packageJson, { path: "big.bin", bytes: filled(limits.sourceFileBytes + 1) }]),
    );
    expect(big).toMatchObject({ status: "refused", code: "limit", limit: "sourceFileBytes" });
    const many = await fetchServed(
      tarball([
        packageJson,
        ...Array.from({ length: limits.sourceFiles }, (_, index) => ({ path: `f/${index}` })),
      ]),
    );
    expect(many).toMatchObject({ status: "refused", code: "limit", limit: "sourceFiles" });
    const chunk = filled(limits.sourceFileBytes);
    const bomb = await fetchServed(
      gzipSync(
        tar([
          { path: "package/package.json", text: manifest(PACKAGE, "1.0.0") },
          ...Array.from(
            { length: limits.sourceBytes / limits.sourceFileBytes + 1 },
            (_, index) => ({
              path: `package/part-${index}`,
              bytes: chunk,
            }),
          ),
        ]),
        { level: 1 },
      ),
    );
    expect(bomb).toMatchObject({ status: "refused", code: "limit", limit: "sourceBytes" });
    expect("files" in bomb).toBe(false);
  }, 60_000);

  it("refuses a tarball whose package.json names another package or version", async () => {
    const fetched = await fetchServed(
      tarball([{ path: "package.json", text: manifest(PACKAGE, "9.9.9") }]),
    );
    expect(fetched).toMatchObject({ status: "refused", code: "source-mismatch" });
  });

  it("refuses a version the registry does not have and never runs npm for unusable specs", async () => {
    const served = await registry({
      [PACKAGE]: { latest: "1.0.0", versions: { "1.0.0": tarball([packageJson]) } },
    });
    expect(
      await fetchSource(
        { kind: "npm", package: PACKAGE, version: "3.0.0" },
        { outDir: outDir(), registry: served.url },
      ),
    ).toMatchObject({ status: "refused", code: "fetch-failed" });
    const before = served.requests.length;
    for (const candidate of [
      { kind: "npm", package: "../escape" },
      { kind: "npm", package: "file:../x" },
      { kind: "npm", package: PACKAGE, range: "file:../x" },
      { kind: "npm", package: PACKAGE, version: "latest" },
    ]) {
      expect(
        await fetchSource(candidate as never, { outDir: outDir(), registry: served.url }),
        JSON.stringify(candidate),
      ).toMatchObject({ status: "invalid" });
    }
    expect(served.requests.length).toBe(before);
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
