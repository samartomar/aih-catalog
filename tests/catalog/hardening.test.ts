import { describe, expect, it } from "vitest";
import { readLocalSource } from "../../src/catalog/node.js";
import { buildContent } from "../../src/catalog/producer.js";
import { type Content, type Plan, planInstall } from "../../src/catalog/reader.js";
import { findItems } from "../../src/catalog/source.js";
import { FRAMEWORK, folder, profile, sha } from "./helpers.js";

const SKILL = "---\nname: tidy\ndescription: Tidy the code.\n---\n\nTidy $ARGUMENTS.\n";

/** Own content from `tree`, with every item pointed at one runtime bundle of `include`. */
async function bundled(
  id: string,
  tree: Record<string, string>,
  include: readonly string[],
): Promise<Content> {
  const read = readLocalSource(folder(tree, id));
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  const found = findItems(read.files, { framework: id });
  if (found.status !== "ok") throw new Error(JSON.stringify(found));
  const built = await buildContent(
    read.source,
    read.files,
    found.items.map((item) => ({ ...item, bundle: `${id}.runtime` })),
    { framework: id, bundles: [{ id: `${id}.runtime`, layout: "skills/<name>/", include }] },
  );
  if (built.status !== "ok") throw new Error(JSON.stringify(built));
  return built.content;
}

const startSkill = (id: string, guide: string) =>
  `---\nname: ${id}-start\ndescription: Start ${id}.\n---\n\nRead \`../../docs/${guide}\` first.\n`;

describe("bundle include patterns", () => {
  it("matches a many-star pattern against a long name in linear time", async () => {
    const name = `${"a".repeat(200)}.md`;
    const root = folder({ "skills/tidy/SKILL.md": SKILL, [`docs/${name}`]: "x\n" });
    const read = readLocalSource(root);
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: FRAMEWORK });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const pattern = `docs/${"*a".repeat(40)}*b`;
    const started = performance.now();
    const built = await buildContent(
      read.source,
      read.files,
      found.items.map((item) => ({ ...item, bundle: "local.runtime" })),
      {
        framework: FRAMEWORK,
        bundles: [
          { id: "local.runtime", layout: "skills/<name>/", include: [pattern, "docs/*.md"] },
        ],
      },
    );
    expect(performance.now() - started).toBeLessThan(2000);
    expect(built.status).toBe("ok");
    if (built.status !== "ok") return;
    expect(built.content.bundles?.[0]?.files.map((file) => file.sourcePath)).toEqual([
      `docs/${name}`,
    ]);
  });
});

describe("portable paths", () => {
  it("refuses entry paths some supported file system cannot hold under that name", () => {
    for (const path of [
      "skills/a:b/SKILL.md",
      "docs/what?.md",
      "docs/a<b>.md",
      'docs/"x".md',
      "docs/a|b.md",
      "docs/a*b.md",
      "docs/tab\there.md",
      "docs/trailing.",
      "docs/trailing ",
      "docs/con",
      "docs/NUL.md",
      "com1/x.md",
      "docs/lpt9.txt",
    ]) {
      const result = findItems([{ path, mode: "100644", sha256: sha("x") }], {
        framework: FRAMEWORK,
      });
      expect(result, path).toMatchObject({ status: "refused", code: "path-escape" });
    }
  });

  it("keeps ordinary names that only resemble reserved ones", () => {
    const result = findItems(
      ["docs/console.md", "docs/com10.md", "docs/.hidden"].map((path) => ({
        path,
        mode: "100644" as const,
        sha256: sha("x"),
      })),
      { framework: FRAMEWORK },
    );
    expect(result.status).toBe("ok");
  });

  it("refuses two entry paths that differ only in case or Unicode form", () => {
    for (const pair of [
      ["docs/Guide.md", "docs/guide.md"],
      ["docs/café.md", "docs/café.md"],
    ]) {
      const result = findItems(
        pair.map((path) => ({ path, mode: "100644" as const, sha256: sha("x") })),
        { framework: FRAMEWORK },
      );
      expect(result, pair.join()).toMatchObject({ status: "invalid" });
    }
  });

  it("reports a clash when two bundles place files that differ only in case", async () => {
    const content = (id: string, guide: string) =>
      bundled(
        id,
        { "skills/start/SKILL.md": startSkill(id, guide), [`docs/${guide}`]: `${id}\n` },
        ["docs/*.md"],
      );
    const plan = planInstall(
      ["alpha.skill.start", "beta.skill.start"],
      [await content("alpha", "guide.md"), await content("beta", "Guide.md")],
      [profile("codex")],
      { scope: "project", data: null },
    ) as Plan;
    expect(plan.status).toBe("incomplete");
    expect(plan.clashes).toMatchObject([
      {
        root: "project",
        reason: "different-content",
        items: ["alpha.skill.start", "beta.skill.start"],
      },
    ]);
  });
});

describe("bundle files on client configuration", () => {
  const surfaces = [
    { cli: "claude-code", scope: "project", file: "settings.json" },
    { cli: "claude-code", scope: "project", file: "settings.local.json" },
    { cli: "claude-code", scope: "project", file: "hooks/start.sh" },
    { cli: "claude-code", scope: "user", file: "CLAUDE.md" },
  ] as const;

  it("refuses a bundle whose file would land on a client's configuration", async () => {
    for (const { cli, scope, file } of surfaces) {
      const content = await bundled(
        "alpha",
        {
          "skills/start/SKILL.md": startSkill("alpha", "guide.md"),
          "docs/guide.md": "x\n",
          [file]: "{}\n",
        },
        ["docs/", file],
      );
      const plan = planInstall(["alpha.skill.start"], [content], [profile(cli)], {
        scope,
        data: null,
      }) as Plan;
      expect(plan.status, file).toBe("incomplete");
      expect(plan.unavailable, file).toMatchObject([
        { item: "alpha.skill.start", cli, reason: "no-bundle-place" },
      ]);
      const paths = plan.plan.flatMap((step) => ("path" in step ? [step.path] : []));
      expect(
        paths.some((path) => path.endsWith(file)),
        file,
      ).toBe(false);
    }
  });

  it("refuses a bundle file on another planned client's shared rule file", async () => {
    const content = await bundled(
      "alpha",
      {
        "skills/start/SKILL.md": startSkill("alpha", "guide.md"),
        "docs/guide.md": "x\n",
        "AGENTS.md": "# x\n",
      },
      ["docs/", "AGENTS.md"],
    );
    const plan = planInstall(
      ["alpha.skill.start"],
      [content],
      [profile("codex"), profile("kimi")],
      {
        scope: "user",
        data: null,
      },
    ) as Plan;
    expect(plan.unavailable).toContainEqual(
      expect.objectContaining({
        item: "alpha.skill.start",
        cli: "codex",
        reason: "no-bundle-place",
      }),
    );
    expect(plan.plan.some((step) => step.op === "write" && step.path === ".agents/AGENTS.md")).toBe(
      false,
    );
  });
});
