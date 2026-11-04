/**
 * The contracts the remaining content families use, on ordinary upstream data: a small Git-pinned
 * framework that marks one skill upstream-only, carries a third-party notice and a notice-only
 * source, ships a second subpath copy as one client's edition, and publishes several plugins
 * from one root. Nothing here is specific to any real framework.
 */
import { describe, expect, it } from "vitest";
import { readLocalSource } from "../../src/catalog/node.js";
import { buildContent, checkContent } from "../../src/catalog/producer.js";
import { type PlanStep, planInstall, planRecipe, readRecipe } from "../../src/catalog/reader.js";
import { findItems } from "../../src/catalog/source.js";
import { folder, gitTree, profile, sha, sortKeys } from "./helpers.js";

const COMMIT = "2".repeat(40);
const upstream = (root: string) => {
  const read = readLocalSource(root);
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  return {
    files: read.files,
    source: { kind: "git" as const, repository: "https://example.invalid/kit", commit: COMMIT },
  };
};
const planned = (result: ReturnType<typeof planInstall>) => {
  if (result.status === "invalid" || result.status === "refused")
    throw new Error(JSON.stringify(result));
  return result;
};
const at = (plan: readonly PlanStep[], op: string) =>
  plan.filter((step) => step.op === op).map((step) => (step as { path: string }).path);

const ALPHA = "---\nname: alpha\ndescription: Alpha.\n---\nRead ref.md first.\n";
const BETA = "---\nname: beta\ndescription: Beta.\n---\nBody\n";
const KIT = {
  LICENSE: "MIT licence text\n",
  "skills/alpha/SKILL.md": ALPHA,
  "skills/alpha/ref.md": "Reference\n",
  "skills/alpha/LICENSE.txt": "All rights reserved.\n",
  "skills/beta/SKILL.md": BETA,
};

async function kit() {
  const own = upstream(folder(KIT));
  const found = findItems(own.files, { framework: "kit" });
  if (found.status !== "ok") throw new Error("find");
  const items = found.items.map((item) =>
    item.id === "kit.skill.alpha" ? { ...item, fetch: "upstream" as const } : item,
  );
  const built = await buildContent(own.source, own.files, items, { framework: "kit" });
  if (built.status !== "ok") throw new Error(JSON.stringify(built));
  return { own, content: built.content };
}

describe("an upstream-only item", () => {
  it("is planned as fetch steps from its pinned source, before every write", async () => {
    const { content } = await kit();
    const plan = planned(
      planInstall(
        ["kit.skill.alpha", "kit.skill.beta"],
        [content],
        [profile("claude-code"), profile("codex")],
        { scope: "project", data: null },
      ),
    );
    expect(plan.status).toBe("ok");
    expect(plan.unavailable).toEqual([]);
    const fetches = plan.plan.filter((step) => step.op === "fetch");
    expect(fetches).toEqual([
      {
        op: "fetch",
        root: "project",
        path: ".agents/skills/alpha/SKILL.md",
        source: "kit",
        sourcePath: "skills/alpha/SKILL.md",
        sha256: sha(ALPHA),
        executable: false,
        item: "kit.skill.alpha",
        clis: ["codex"],
        scanned: false,
      },
      {
        op: "fetch",
        root: "project",
        path: ".agents/skills/alpha/ref.md",
        source: "kit",
        sourcePath: "skills/alpha/ref.md",
        sha256: sha("Reference\n"),
        executable: false,
        item: "kit.skill.alpha",
        clis: ["codex"],
        scanned: false,
      },
      {
        op: "fetch",
        root: "project",
        path: ".aihq/notices/kit/skills/alpha/LICENSE.txt",
        source: "kit",
        sourcePath: "skills/alpha/LICENSE.txt",
        sha256: sha("All rights reserved.\n"),
        executable: false,
        items: ["kit.skill.alpha"],
        clis: ["claude-code", "codex"],
        scanned: false,
      },
      {
        op: "fetch",
        root: "project",
        path: ".claude/skills/alpha/SKILL.md",
        source: "kit",
        sourcePath: "skills/alpha/SKILL.md",
        sha256: sha(ALPHA),
        executable: false,
        item: "kit.skill.alpha",
        clis: ["claude-code"],
        scanned: false,
      },
      {
        op: "fetch",
        root: "project",
        path: ".claude/skills/alpha/ref.md",
        source: "kit",
        sourcePath: "skills/alpha/ref.md",
        sha256: sha("Reference\n"),
        executable: false,
        item: "kit.skill.alpha",
        clis: ["claude-code"],
        scanned: false,
      },
    ]);
    // Fetches are the first phase; the shipped item and the shared notice stay writes.
    expect(plan.plan.findIndex((step) => step.op === "write")).toBe(fetches.length);
    expect(at(plan.plan, "write")).toEqual([
      ".agents/skills/beta/SKILL.md",
      ".aihq/notices/kit/LICENSE",
      ".claude/skills/beta/SKILL.md",
    ]);
  });

  it("keeps a rendered file a write from its source bytes, unscanned", async () => {
    const { content } = await kit();
    const plan = planned(
      planInstall(["kit.skill.alpha"], [content], [profile("kiro")], {
        scope: "project",
        data: null,
      }),
    );
    expect(plan.status).toBe("ok");
    const skill = plan.plan.find(
      (step) => step.op === "write" && step.path === ".kiro/skills/alpha/SKILL.md",
    );
    expect(skill).toMatchObject({ render: { name: "skill" }, scanned: false });
    // With only upstream-only items chosen, even the source-wide notice is fetched.
    expect(at(plan.plan, "fetch")).toEqual([
      ".aihq/notices/kit/LICENSE",
      ".aihq/notices/kit/skills/alpha/LICENSE.txt",
      ".kiro/skills/alpha/ref.md",
    ]);
  });

  it("at user scope fetches into the shared version folder before linking it", async () => {
    const { content } = await kit();
    const plan = planned(
      planInstall(["kit.skill.alpha"], [content], [profile("claude-code")], {
        scope: "user",
        data: null,
      }),
    );
    expect(plan.status).toBe("ok");
    const ops = plan.plan.map((step) => step.op);
    expect(ops.lastIndexOf("fetch")).toBeLessThan(ops.indexOf("link"));
    expect(at(plan.plan, "fetch").filter((path) => path.startsWith(".aihq/shared/"))).toHaveLength(
      2,
    );
  });

  it("records its files and keys but leaves them out of the unscanned keys", async () => {
    const { own, content } = await kit();
    const checked = await checkContent(content, own.files, { scannedKeys: [] });
    if (checked.status !== "ok") throw new Error(JSON.stringify(checked));
    const alpha = content.items.find((item) => item.id === "kit.skill.alpha");
    const beta = content.items.find((item) => item.id === "kit.skill.beta");
    expect(alpha?.scanKey).toMatch(/^git-sha1:/);
    expect(checked.unscannedKeys).toEqual([beta?.scanKey]);
  });
});

const encode = (value: unknown) =>
  new TextEncoder().encode(`${JSON.stringify(sortKeys(value), null, 2)}\n`);
const RECIPE_PLUGIN = {
  name: "kit-recipe",
  version: "1.0.0",
  description: "A recipe for the contract checks.",
  author: { name: "Catalog tests" },
  license: "Apache-2.0",
  keywords: ["recipe"],
};
const DATA = { repository: "https://example.invalid/catalog", commit: "d".repeat(40) };
const SOURCE = { repository: "https://example.invalid/recipes", commit: "e".repeat(40) };
function recipe(document: Record<string, unknown>) {
  const read = readRecipe(
    encode(RECIPE_PLUGIN),
    encode({
      schema: "urn:aihq:catalog:recipe:0.1.0",
      kind: "base",
      framework: "kit",
      content: { repository: "https://example.invalid/kit", commit: COMMIT },
      members: [],
      data: DATA,
      ...document,
    }),
  );
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  return read.recipe;
}

describe("several plugins published from one root", () => {
  const MARKETPLACE = JSON.stringify({
    name: "kit",
    plugins: [
      { name: "kit-a", source: "./", skills: ["./skills/alpha"] },
      { name: "kit-b", source: "./", skills: ["./skills/beta"] },
    ],
  });
  const TREE = {
    ...KIT,
    "skills/beta/deep/notes.md": "Notes\n",
    "README.md": "Readme\n",
    ".claude-plugin/marketplace.json": MARKETPLACE,
  };
  async function plugins() {
    const own = upstream(folder(TREE));
    const found = findItems(own.files, { framework: "kit" });
    if (found.status !== "ok") throw new Error("find");
    const built = await buildContent(own.source, own.files, found.items, {
      framework: "kit",
      plugins: [
        {
          path: "/",
          plugin: "kit-a",
          include: ["skills/alpha/", ".claude-plugin/marketplace.json"],
        },
        {
          path: "/",
          plugin: "kit-b",
          include: ["skills/beta/", ".claude-plugin/marketplace.json"],
        },
      ],
    });
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    return { own, content: built.content };
  }

  it("records one allowlisted folder per plugin, a folder pattern taking every file below it", async () => {
    const { own, content } = await plugins();
    expect(
      content.plugins?.map((record) => ({
        plugin: record.plugin,
        files: record.files.map((file) => file.sourcePath),
      })),
    ).toEqual([
      {
        plugin: "kit-a",
        files: [
          ".claude-plugin/marketplace.json",
          "skills/alpha/LICENSE.txt",
          "skills/alpha/SKILL.md",
          "skills/alpha/ref.md",
        ],
      },
      {
        plugin: "kit-b",
        files: [
          ".claude-plugin/marketplace.json",
          "skills/beta/SKILL.md",
          "skills/beta/deep/notes.md",
        ],
      },
    ]);
    expect(content.plugins?.[1]?.scanKey).toBe(
      `git-sha1:${gitTree({
        ".claude-plugin/marketplace.json": MARKETPLACE,
        "skills/beta/SKILL.md": BETA,
        "skills/beta/deep/notes.md": "Notes\n",
      })}`,
    );
    expect(await checkContent(content, own.files)).toMatchObject({ status: "ok" });
  });

  it("routes a client to the named plugin, which contains only its own items", async () => {
    const { content } = await plugins();
    const plan = planRecipe(
      recipe({
        id: "kit-b",
        routes: { copilot: "plugin" },
        plugins: { copilot: { source: "kit", path: "/", plugin: "kit-b", commit: COMMIT } },
        members: [{ item: "kit.skill.beta", preTicked: true }],
      }),
      [content],
      [profile("copilot")],
      {},
      { scope: "user", source: SOURCE },
    );
    if (plan.status !== "ok") throw new Error(JSON.stringify(plan));
    const step = plan.plan.find((candidate) => candidate.op === "plugin");
    expect(step).toMatchObject({ plugin: "kit-b", scanKey: content.plugins?.[1]?.scanKey });
    expect(plan.warnings).toEqual([
      { code: "cli-only-plugin", cli: "copilot", items: ["kit.skill.beta"], framework: "kit" },
    ]);
  });

  it("refuses a recipe plugin that no record names", async () => {
    const { content } = await plugins();
    const plan = planRecipe(
      recipe({
        id: "kit-c",
        routes: { copilot: "plugin" },
        plugins: { copilot: { source: "kit", path: "/", plugin: "kit-c", commit: COMMIT } },
        members: [{ item: "kit.skill.beta", preTicked: true }],
      }),
      [content],
      [profile("copilot")],
      {},
      { scope: "user", source: SOURCE },
    );
    expect(plan).toMatchObject({
      status: "incomplete",
      missing: [{ framework: "kit", cli: "copilot", reason: "plugin-not-recorded" }],
    });
  });
});

describe("notices", () => {
  it("recognise a third-party notices file and a notice-only source for one item", async () => {
    const own = upstream(folder({ ...KIT, "THIRD_PARTY_NOTICES.md": "Third-party notices\n" }));
    const vendor = readLocalSource(folder({ "LICENSE.md": "Vendor MIT\n", "src/x.ts": "x\n" }));
    if (vendor.status !== "ok") throw new Error("vendor");
    const found = findItems(own.files, { framework: "kit" });
    if (found.status !== "ok") throw new Error("find");
    expect(found.leftOver.map((entry) => entry.path)).not.toContain("THIRD_PARTY_NOTICES.md");
    const built = await buildContent(own.source, own.files, found.items, {
      framework: "kit",
      sources: [
        {
          id: "vendor-notice",
          source: {
            kind: "git",
            repository: "https://example.invalid/vendor",
            commit: "3".repeat(40),
          },
          files: vendor.files.filter((file) => file.path === "LICENSE.md"),
          noticesFor: ["kit.skill.beta"],
        },
      ],
    });
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    expect(built.content.sources[0]?.notices).toContainEqual({
      sourcePath: "THIRD_PARTY_NOTICES.md",
      sha256: sha("Third-party notices\n"),
      covers: "/",
    });
    const plan = planned(
      planInstall(["kit.skill.beta"], [built.content], [profile("claude-code")], {
        scope: "project",
        data: null,
      }),
    );
    expect(at(plan.plan, "write")).toEqual([
      ".aihq/notices/kit/LICENSE",
      ".aihq/notices/kit/THIRD_PARTY_NOTICES.md",
      ".aihq/notices/kit/vendor-notice/LICENSE.md",
      ".claude/skills/beta/SKILL.md",
    ]);
    const alone = planned(
      planInstall(["kit.skill.alpha"], [built.content], [profile("claude-code")], {
        scope: "project",
        data: null,
      }),
    );
    expect(at(alone.plan, "write")).not.toContain(".aihq/notices/kit/vendor-notice/LICENSE.md");
  });
});

describe("a second subpath of the same pin as one client's edition", () => {
  const CLAUDE_BETA =
    "---\nname: beta\ndescription: Beta.\n---\nRead ../../docs/claude.md first.\nBody\n";
  async function editioned() {
    const own = upstream(folder(KIT));
    const copy = readLocalSource(
      folder({ "skills/beta/SKILL.md": CLAUDE_BETA, "docs/claude.md": "Claude notes\n" }),
    );
    if (copy.status !== "ok") throw new Error("copy");
    const found = findItems(own.files, { framework: "kit" });
    const copied = findItems(copy.files, { framework: "kit", sourceId: "kit-claude" });
    if (found.status !== "ok" || copied.status !== "ok") throw new Error("find");
    const edition = copied.items.find((item) => item.id === "kit.skill.beta");
    const items = found.items.map((item) =>
      item.id === "kit.skill.beta" && edition
        ? { ...item, editions: { "claude-code": { files: edition.files } } }
        : item,
    );
    const built = await buildContent(own.source, own.files, items, {
      framework: "kit",
      sources: [
        {
          id: "kit-claude",
          source: { ...own.source, subpath: "harness/claude" },
          files: copy.files,
        },
      ],
    });
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    return { own, copy, content: built.content };
  }

  it("records each copy's own bytes even where both copies use the same path", async () => {
    const { own, copy, content } = await editioned();
    const beta = content.items.find((item) => item.id === "kit.skill.beta");
    expect(beta?.files).toMatchObject([
      {
        sourceId: "kit",
        sourcePath: "skills/beta/SKILL.md",
        sha256: sha(BETA),
        bytes: BETA.length,
      },
    ]);
    expect(beta?.editions?.["claude-code"]).toMatchObject({
      files: [
        {
          sourceId: "kit-claude",
          sourcePath: "skills/beta/SKILL.md",
          sha256: sha(CLAUDE_BETA),
          bytes: CLAUDE_BETA.length,
        },
      ],
      scanKey: `git-sha1:${gitTree({ "SKILL.md": CLAUDE_BETA })}`,
    });
    expect(beta?.scanKey).toBe(`git-sha1:${gitTree({ "SKILL.md": BETA })}`);
    // The item's own file names no other file; the edition's mention is the edition's concern.
    expect(beta?.pathReferences).toBeUndefined();
    const files = [
      ...own.files,
      ...copy.files.map((file) => ({ ...file, sourceId: "kit-claude" })),
    ];
    expect(await checkContent(content, files)).toMatchObject({ status: "ok" });
  });

  it("gives that client the edition and every other client the item's own files", async () => {
    const { content } = await editioned();
    const plan = planned(
      planInstall(["kit.skill.beta"], [content], [profile("claude-code"), profile("codex")], {
        scope: "project",
        data: null,
      }),
    );
    const from = (path: string) =>
      (plan.plan.find((step) => step.op === "write" && step.path === path) as { from?: unknown })
        ?.from;
    expect(from(".claude/skills/beta/SKILL.md")).toMatchObject({
      sourceId: "kit-claude",
      sha256: sha(CLAUDE_BETA),
    });
    expect(from(".agents/skills/beta/SKILL.md")).toMatchObject({
      sourceId: "kit",
      sha256: sha(BETA),
    });
  });
});

describe("path references", () => {
  it("take bare root paths from instructions, not from program source, and explicit relative paths from any file", async () => {
    const own = upstream(
      folder({
        "skills/alpha/SKILL.md":
          "---\nname: alpha\ndescription: Alpha.\n---\nFollow docs/guide.md, then run run.py.\n",
        "skills/alpha/run.py":
          "# Checked by tests/conftest.py in the upstream's own suite.\nimport_path = '../../shared/util.py'\n",
        "docs/guide.md": "Guide\n",
        "tests/conftest.py": "pass\n",
        "shared/util.py": "pass\n",
      }),
    );
    const found = findItems(own.files, { framework: "kit" });
    if (found.status !== "ok") throw new Error("find");
    const built = await buildContent(own.source, own.files, found.items, { framework: "kit" });
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    expect(built.content.items[0]?.pathReferences).toEqual([
      { sourcePath: "skills/alpha/SKILL.md", path: "docs/guide.md" },
      { sourcePath: "skills/alpha/run.py", path: "shared/util.py" },
    ]);
  });
});
