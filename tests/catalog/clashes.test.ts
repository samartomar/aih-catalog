import { describe, expect, it } from "vitest";
import type { DiscoveredItem } from "../../src/catalog/internal/model.js";
import { fetchSource, readLocalSource } from "../../src/catalog/node.js";
import { buildContent, checkContent } from "../../src/catalog/producer.js";
import {
  aihContent,
  type Content,
  type Plan,
  type PlanResult,
  planInstall,
  planRecipe,
  readContent,
  readRecipe,
  renderStep,
  type WriteStep,
} from "../../src/catalog/reader.js";
import { findItems } from "../../src/catalog/source.js";
import {
  folder,
  gitRepository,
  outDir,
  placements,
  profile,
  sha,
  sortKeys,
  type TreeEntry,
  utf8,
  writes,
} from "./helpers.js";

const skill = (name: string, body = `Use ${name}.`) =>
  `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`;

/** One own folder as framework `id`, read, discovered and built through the public functions. */
async function framework(
  id: string,
  tree: Readonly<Record<string, TreeEntry>>,
  authored: Record<string, Partial<DiscoveredItem>> = {},
) {
  const read = readLocalSource(folder(tree, id));
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  const found = findItems(read.files, { framework: id });
  if (found.status !== "ok") throw new Error(JSON.stringify(found));
  const items = found.items.map((item) => ({ ...item, ...authored[item.id] }));
  const built = await buildContent(read.source, read.files, items, { framework: id });
  if (built.status !== "ok") throw new Error(JSON.stringify(built));
  const reread = readContent(built.bytes);
  if (reread.status !== "ok") throw new Error(JSON.stringify(reread));
  return { content: reread.content as Content, files: read.files };
}

function planned(result: PlanResult): Plan {
  if (result.status !== "ok" && result.status !== "incomplete")
    throw new Error(JSON.stringify(result));
  return result;
}

describe("built-in names", () => {
  it("reports a chosen name that would shadow what the client provides, until it is renamed", async () => {
    const mine = await framework("mine", { "skills/plan/SKILL.md": skill("plan") });
    const result = planned(
      planInstall(["mine.skill.plan"], [mine.content], [profile("claude-code"), profile("kiro")], {
        scope: "project",
        data: null,
      }),
    );

    expect(result.status).toBe("incomplete");
    expect(result.clashes).toEqual([
      {
        root: "project",
        path: ".claude/skills/plan",
        reason: "built-in",
        builtIn: "plan",
        items: ["mine.skill.plan"],
        clis: ["claude-code"],
      },
      {
        root: "project",
        path: ".kiro/skills/plan",
        reason: "built-in",
        builtIn: "plan",
        items: ["mine.skill.plan"],
        clis: ["kiro"],
      },
    ]);
    // Reported, never silently dropped or renamed: the step is still planned as asked.
    expect(writes(result.plan).map((step) => step.path)).toContain(".claude/skills/plan/SKILL.md");

    const renamed = planned(
      planInstall(["mine.skill.plan"], [mine.content], [profile("claude-code")], {
        scope: "project",
        data: null,
        names: { "mine.skill.plan": "my-plan" },
      }),
    );
    expect(renamed.status).toBe("ok");
    expect(renamed.clashes).toEqual([]);
  });

  it("matches built-in agent names without regard to case", async () => {
    const mine = await framework("mine", {
      "agents/explore.md": "---\nname: explore\ndescription: Explores.\n---\nExplore.\n",
    });
    const result = planned(
      planInstall(["mine.agent.explore"], [mine.content], [profile("claude-code")], {
        scope: "project",
        data: null,
      }),
    );
    expect(result.clashes).toEqual([
      expect.objectContaining({ reason: "built-in", builtIn: "Explore", clis: ["claude-code"] }),
    ]);
  });
});

const encode = (value: unknown): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(sortKeys(value), null, 2)}\n`);
const PLUGIN = {
  name: "matt-base",
  version: "1.0.0",
  description: "Matt's skills.",
  author: { name: "Recipe authors" },
  license: "MIT",
  keywords: ["recipe"],
};
const DATA = { repository: "https://example.invalid/catalog-data", commit: "b".repeat(40) };
const SOURCE = { repository: "https://example.invalid/recipes", commit: "c".repeat(40) };

/** A framework read from a pinned local Git repository, as a recipe requires. */
async function pinned(
  id: string,
  tree: Readonly<Record<string, TreeEntry>>,
  plugins?: readonly string[],
) {
  const upstream = gitRepository(tree);
  const fetched = await fetchSource(
    { kind: "git", repository: upstream.path, ref: "main" },
    { outDir: outDir() },
  );
  if (fetched.status !== "ok") throw new Error(JSON.stringify(fetched));
  const found = findItems(fetched.files, { framework: id });
  if (found.status !== "ok") throw new Error(JSON.stringify(found));
  const built = await buildContent(fetched.source, fetched.files, found.items, {
    framework: id,
    ...(plugins ? { plugins } : {}),
  });
  if (built.status !== "ok") throw new Error(JSON.stringify(built));
  return {
    content: built.content,
    files: fetched.files,
    pin: { repository: upstream.path, commit: upstream.commits[0] as string },
  };
}

function recipe(document: Record<string, unknown>) {
  const read = readRecipe(encode(PLUGIN), encode(document));
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  return read.recipe;
}

const MATT = {
  "skills/code-review/SKILL.md": skill("code-review", "Review on standards and spec."),
  "skills/research/SKILL.md": skill("research", "Research from primary sources."),
  "skills/code-simplification/SKILL.md": skill("code-simplification", "Simplify the code."),
};

async function mattRecipe(overrides: readonly { item: string; replaces: string }[]) {
  const matt = await pinned("matt", MATT);
  const document = {
    schema: "urn:aihq:catalog:recipe:0.1.0",
    id: "matt-base",
    kind: "base",
    framework: "matt",
    content: matt.pin,
    routes: {},
    members: ["code-review", "research", "code-simplification"].map((name) => ({
      item: `matt.skill.${name}`,
      preTicked: true,
    })),
    overrides,
    data: DATA,
  };
  return { matt, recipe: recipe(document) };
}

const OVERRIDES = [
  { item: "matt.skill.code-review", replaces: "code-review" },
  { item: "matt.skill.research", replaces: "research" },
  { item: "matt.skill.code-simplification", replaces: "simplify" },
];
const CLIENTS = () => [profile("claude-code"), profile("copilot"), profile("codex")];

describe("intended built-in overrides", () => {
  it("are clashes until the recipe declares them", async () => {
    const { matt, recipe: read } = await mattRecipe([]);
    const plan = planned(
      planRecipe(read, [matt.content], CLIENTS(), {}, { scope: "project", source: SOURCE }),
    );
    expect(plan.status).toBe("incomplete");
    expect(plan.clashes.map(({ path, builtIn, clis }) => ({ path, builtIn, clis }))).toEqual([
      // Copilot shares Codex's .agents/skills folder and provides /research.
      { path: ".agents/skills/research", builtIn: "research", clis: ["copilot"] },
      { path: ".claude/skills/code-review", builtIn: "code-review", clis: ["claude-code"] },
    ]);
  });

  it("switch the built-in off where the client documents how, and warn where it cannot", async () => {
    const { matt, recipe: read } = await mattRecipe(OVERRIDES);
    const plan = planned(
      planRecipe(read, [matt.content], CLIENTS(), {}, { scope: "project", source: SOURCE }),
    );

    expect(plan.clashes).toEqual([]);
    expect(plan.status).toBe("ok");
    // A different name needs Claude's user-level skillOverrides; the same name replaces it.
    expect(
      placements(plan.plan).filter(
        (step) => step.op === "merge" && step.file === ".claude/settings.json",
      ),
    ).toEqual([
      {
        op: "merge",
        root: "user",
        file: ".claude/settings.json",
        format: "json",
        key: "/skillOverrides/simplify",
        entry: "off",
        item: "matt.skill.code-simplification",
        clis: ["claude-code"],
      },
    ]);
    const builtInCodes = ["built-in-both-show", "claude-alias-lost"];
    expect(plan.warnings.filter((warning) => builtInCodes.includes(warning.code))).toEqual([
      {
        code: "built-in-both-show",
        cli: "copilot",
        items: ["matt.skill.research"],
      },
      {
        code: "claude-alias-lost",
        cli: "claude-code",
        items: ["matt.skill.code-review", "matt.skill.code-simplification"],
      },
    ]);
    // The override never rewrites the upstream body: the skill is copied byte for byte.
    const review = writes(plan.plan).find(
      (step) => step.path === ".claude/skills/code-review/SKILL.md",
    );
    expect(review?.render).toBeUndefined();
    expect(review?.from?.sha256).toBe(sha(MATT["skills/code-review/SKILL.md"] as string));
  });

  it("must name an item the recipe installs", async () => {
    const { matt, recipe: read } = await mattRecipe([
      { item: "matt.skill.elsewhere", replaces: "plan" },
    ]);
    expect(
      planRecipe(read, [matt.content], CLIENTS(), {}, { scope: "project", source: SOURCE }),
    ).toMatchObject({ status: "invalid", problems: [{ path: "recipe/overrides/0" }] });
  });
});

describe("a client that reads another client's folder", () => {
  it("shares the folder only when its own render would give the same bytes", async () => {
    const mine = await framework("mine", {
      "skills/deploy/SKILL.md": skill("deploy", "Deploy $ARGUMENTS now."),
      "skills/plain/SKILL.md": skill("plain"),
    });
    const result = planned(
      planInstall(
        ["mine.skill.deploy", "mine.skill.plain"],
        [mine.content],
        [profile("claude-code"), profile("copilot")],
        { scope: "project", data: null },
      ),
    );

    // Claude keeps $ARGUMENTS; Copilot would reword it. Copilot must not silently take
    // Claude's bytes, so the shared folder is a clash, not a winner.
    expect(result.status).toBe("incomplete");
    expect(result.clashes).toEqual([
      {
        root: "project",
        path: ".claude/skills/deploy",
        reason: "different-content",
        items: ["mine.skill.deploy"],
        clis: ["claude-code", "copilot"],
      },
    ]);
    expect(writes(result.plan).find((step) => step.path.endsWith("plain/SKILL.md"))).toMatchObject({
      path: ".claude/skills/plain/SKILL.md",
      clis: ["claude-code", "copilot"],
    });
  });
});

const ALPHA = {
  LICENSE: "MIT\n",
  "skills/tdd/SKILL.md": skill("tdd", "Red, then green, alpha style."),
  "skills/teach/SKILL.md": skill("teach", "Teach one idea at a time."),
  "agents/helper.md": "---\nname: helper\ndescription: Helps.\n---\nHelp the user.\n",
};
const BETA = {
  "skills/tdd/SKILL.md": skill("tdd", "Tests first, beta style."),
  "skills/teach/SKILL.md": skill("teach", "Teach one idea at a time."),
};
const RESOLVER = "aih.agent.duplicate-resolver";

async function mixed() {
  const alpha = await framework("alpha", ALPHA);
  const beta = await framework("beta", BETA);
  return { alpha, beta, contents: [alpha.content, beta.content] };
}
const BOTH = ["alpha.skill.tdd", "alpha.skill.teach", "beta.skill.tdd", "beta.skill.teach"];

describe("mixing frameworks", () => {
  it("lists same-name and same-content duplicates as facts and picks no winner", async () => {
    const { contents } = await mixed();
    const result = planned(
      planInstall(BOTH, contents, [profile("claude-code")], { scope: "project", data: null }),
    );

    expect(result.duplicates).toEqual([
      {
        by: "content",
        kind: "skill",
        contentSha256: contents[0]?.items.find((item) => item.id === "alpha.skill.teach")
          ?.contentSha256,
        items: ["alpha.skill.teach", "beta.skill.teach"],
        frameworks: ["alpha", "beta"],
        clis: ["claude-code"],
      },
      {
        by: "name",
        kind: "skill",
        name: "tdd",
        items: ["alpha.skill.tdd", "beta.skill.tdd"],
        frameworks: ["alpha", "beta"],
        clis: ["claude-code"],
      },
      {
        by: "name",
        kind: "skill",
        name: "teach",
        items: ["alpha.skill.teach", "beta.skill.teach"],
        frameworks: ["alpha", "beta"],
        clis: ["claude-code"],
      },
    ]);
    // The same place from two frameworks is a clash for both: neither wins.
    expect(result.clashes.map((clash) => [clash.path, clash.items])).toEqual([
      [".claude/skills/tdd", ["alpha.skill.tdd", "beta.skill.tdd"]],
      [".claude/skills/teach", ["alpha.skill.teach", "beta.skill.teach"]],
    ]);
    expect(writes(result.plan).some((step) => step.path.startsWith(".claude/skills/t"))).toBe(
      false,
    );
  });

  it("keeps every renamed duplicate, copies upstream bodies unchanged and still reports content overlap", async () => {
    const { contents } = await mixed();
    const result = planned(
      planInstall(BOTH, contents, [profile("claude-code")], {
        scope: "project",
        data: null,
        names: { "beta.skill.tdd": "beta-tdd", "beta.skill.teach": "beta-teach" },
      }),
    );

    expect(result.status).toBe("ok");
    expect(result.clashes).toEqual([]);
    expect(result.duplicates.map((entry) => [entry.by, entry.items])).toEqual([
      ["content", ["alpha.skill.teach", "beta.skill.teach"]],
    ]);
    const skills = writes(result.plan).filter((step) => step.path.startsWith(".claude/skills/"));
    expect(skills.map((step) => step.path)).toEqual([
      ".claude/skills/beta-tdd/SKILL.md",
      ".claude/skills/beta-teach/SKILL.md",
      ".claude/skills/tdd/SKILL.md",
      ".claude/skills/teach/SKILL.md",
    ]);
    // Only the renamed copies get a name render; no body is rewritten.
    expect(skills.map((step) => step.render?.name ?? "copy")).toEqual([
      "skill",
      "skill",
      "copy",
      "copy",
    ]);
  });

  it("adds the duplicate resolver and its report where agents are supported, and only warns elsewhere", async () => {
    const { contents } = await mixed();
    const result = planned(
      planInstall(BOTH, contents, [profile("claude-code"), profile("codex"), profile("dsh")], {
        scope: "project",
        data: null,
        names: { "beta.skill.tdd": "beta-tdd", "beta.skill.teach": "beta-teach" },
      }),
    );

    expect(result.status).toBe("ok");
    expect(result.unavailable).toEqual([]);
    expect(result.warnings).toEqual([
      { code: "duplicate-resolver-unavailable", cli: "dsh", items: [RESOLVER] },
    ]);
    const resolver = writes(result.plan).filter((step) => step.item === RESOLVER);
    expect(resolver.map((step) => [step.path, step.clis, step.render?.name ?? "copy"])).toEqual([
      [".aihq/duplicates.json", ["claude-code", "codex", "dsh"], "duplicates-report"],
      [".claude/agents/aih-duplicate-resolver.md", ["claude-code"], "copy"],
      [".codex/agents/aih-duplicate-resolver.toml", ["codex"], "agent"],
    ]);
    expect(resolver[1]?.from).toMatchObject({
      sourceId: "aih",
      sourcePath: "agents/duplicate-resolver.md",
    });
  });

  it("renders the report and the resolver from the library's own authored content", async () => {
    const { contents } = await mixed();
    const clients = [profile("claude-code"), profile("codex")];
    const result = planned(
      planInstall(BOTH, contents, clients, {
        scope: "project",
        data: null,
        names: { "beta.skill.tdd": "beta-tdd", "beta.skill.teach": "beta-teach" },
      }),
    );
    const step = (path: string) =>
      writes(result.plan).find((candidate) => candidate.path === path) as WriteStep;

    const report = renderStep(step(".aihq/duplicates.json"), contents, clients, []);
    if (report.status !== "ok") throw new Error(JSON.stringify(report));
    expect(JSON.parse(utf8(report.bytes))).toEqual({ duplicates: result.duplicates });

    const toml = renderStep(
      step(".codex/agents/aih-duplicate-resolver.toml"),
      contents,
      clients,
      [],
    );
    if (toml.status !== "ok") throw new Error(JSON.stringify(toml));
    expect(utf8(toml.bytes)).toContain('name = "aih-duplicate-resolver"');
    expect(utf8(toml.bytes)).toContain(".aihq/duplicates.json");
  });

  it("records the authored resolver exactly as the producer would build it from its bytes", async () => {
    const read = readLocalSource(
      folder(
        Object.fromEntries(aihContent.files.map((file) => [file.sourcePath, utf8(file.bytes)])),
        "aih",
      ),
    );
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: "aih" });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const built = await buildContent(read.source, read.files, found.items, { framework: "aih" });
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    expect(aihContent.content.items).toEqual(built.content.items);
    expect(aihContent.content.items.map((item) => [item.id, item.name])).toEqual([
      [RESOLVER, "aih-duplicate-resolver"],
    ]);
  });

  it("adds nothing for one framework, and an unsupported agent the user chose still blocks", async () => {
    const { contents } = await mixed();
    const one = planned(
      planInstall(["alpha.skill.tdd"], contents, [profile("claude-code")], {
        scope: "project",
        data: null,
      }),
    );
    expect(one.duplicates).toEqual([]);
    expect(one.plan.some((step) => "item" in step && step.item === RESOLVER)).toBe(false);

    const chosen = planned(
      planInstall(["alpha.agent.helper", "beta.skill.tdd"], contents, [profile("dsh")], {
        scope: "project",
        data: null,
      }),
    );
    expect(chosen.status).toBe("incomplete");
    expect(chosen.unavailable).toEqual([
      expect.objectContaining({
        item: "alpha.agent.helper",
        cli: "dsh",
        reason: "unsupported-kind",
      }),
    ]);
    expect(chosen.warnings).toEqual([
      { code: "duplicate-resolver-unavailable", cli: "dsh", items: [RESOLVER] },
    ]);
  });
});

describe("items a route installs without placing them", () => {
  it("still count for duplicates: a native plugin's skills against another framework's", async () => {
    const sp = await pinned(
      "sp",
      {
        ".claude-plugin/plugin.json": '{"name":"sp"}\n',
        "skills/tdd/SKILL.md": skill("tdd", "Superpowered tests first."),
      },
      ["/"],
    );
    const beta = await framework("beta", BETA);
    const read = recipe({
      schema: "urn:aihq:catalog:recipe:0.1.0",
      id: "sp-base",
      kind: "base",
      framework: "sp",
      content: sp.pin,
      routes: { "claude-code": "plugin" },
      plugins: {
        "claude-code": {
          source: "sp",
          path: "/",
          plugin: "sp",
          commit: sp.pin.commit,
          marketplace: "https://example.invalid/sp-marketplace",
        },
      },
      members: [
        { item: "sp.skill.tdd", preTicked: true },
        { item: "beta.skill.tdd", preTicked: true },
      ],
      data: DATA,
    });
    const plan = planned(
      planRecipe(
        read,
        [sp.content, beta.content],
        [profile("claude-code"), profile("codex")],
        {},
        { scope: "project", source: SOURCE },
      ),
    );

    // Claude gets sp's tdd only through its plugin, and beta's not at all (its route is the
    // plugin); Claude is still listed, because the plugin installs a same-named skill.
    expect(plan.plan.filter((step) => step.op === "plugin").map((step) => step.cli)).toEqual([
      "claude-code",
    ]);
    expect(plan.duplicates).toEqual([
      {
        by: "name",
        kind: "skill",
        name: "tdd",
        items: ["beta.skill.tdd", "sp.skill.tdd"],
        frameworks: ["beta", "sp"],
        clis: ["claude-code", "codex"],
      },
    ]);
  });
});

describe("references an items route leaves unresolved", () => {
  const TREE = {
    "skills/tdd/SKILL.md": skill("tdd", "Ask alpha:helper to review, then read `docs/guide.md`."),
    "skills/plain/SKILL.md": skill("plain", "Hand off to alpha:helper when done."),
    "agents/helper.md": "---\nname: helper\ndescription: Helps.\n---\nHelp the user.\n",
    "docs/guide.md": "# Guide\n",
  };
  const authored = {
    "alpha.skill.tdd": { references: ["alpha:helper"] },
    "alpha.skill.plain": { references: ["alpha:helper"] },
  };

  it("records which files mention an authored plugin name, and refuses a name no file mentions", async () => {
    const alpha = await framework("alpha", TREE, authored);
    expect(alpha.content.items.find((item) => item.id === "alpha.skill.tdd")?.references).toEqual([
      { name: "alpha:helper", sourcePath: "skills/tdd/SKILL.md" },
    ]);
    await expect(
      framework("alpha", TREE, { "alpha.skill.tdd": { references: ["alpha:missing"] } }),
    ).rejects.toThrow(/no file of the item mentions alpha:missing/);
    // checkContent reads the mentions from the bytes again.
    expect(await checkContent(alpha.content, alpha.files)).toMatchObject({ status: "ok" });
    const tampered = {
      ...alpha.content,
      items: alpha.content.items.map((item) =>
        item.id === "alpha.skill.tdd"
          ? { ...item, references: [{ name: "alpha:helper", sourcePath: "docs/guide.md" }] }
          : item,
      ),
    };
    expect(await checkContent(tampered, alpha.files)).toMatchObject({ status: "invalid" });
  });

  it("warns about plugin names and blocks only on missing files", async () => {
    const alpha = await framework("alpha", TREE, authored);
    const clients = [profile("claude-code")];
    const names = planned(
      planInstall(["alpha.agent.helper", "alpha.skill.plain"], [alpha.content], clients, {
        scope: "project",
        data: null,
      }),
    );
    // A namespaced name is a warning: the plan stays ok and the upstream text is not edited.
    expect(names.status).toBe("ok");
    expect(names.references).toEqual([
      {
        kind: "name",
        item: "alpha.skill.plain",
        file: "skills/plain/SKILL.md",
        name: "alpha:helper",
        means: "alpha.agent.helper",
        clis: ["claude-code"],
      },
    ]);
    expect(
      writes(names.plan).find((step) => step.path === ".claude/skills/plain/SKILL.md")?.render,
    ).toBeUndefined();

    const both = planned(
      planInstall(["alpha.skill.tdd"], [alpha.content], clients, { scope: "project", data: null }),
    );
    expect(both.status).toBe("incomplete");
    expect(both.references.map((reference) => [reference.kind, reference.item])).toEqual([
      ["name", "alpha.skill.tdd"],
      ["path", "alpha.skill.tdd"],
    ]);
    // Without the agent chosen, nothing installed is the likely meaning.
    expect(both.references[0]).not.toHaveProperty("means");
  });
});
