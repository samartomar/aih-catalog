import { describe, expect, it } from "vitest";
import type { DiscoveredItem } from "../../src/catalog/internal/model.js";
import { fetchSource, readLocalSource } from "../../src/catalog/node.js";
import { buildContent } from "../../src/catalog/producer.js";
import {
  type Content,
  type Plan,
  type PlanResult,
  planInstall,
  planRecipe,
  readContent,
  readRecipe,
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
async function pinned(id: string, tree: Readonly<Record<string, TreeEntry>>) {
  const upstream = gitRepository(tree);
  const fetched = await fetchSource(
    { kind: "git", repository: upstream.path, ref: "main" },
    { outDir: outDir() },
  );
  if (fetched.status !== "ok") throw new Error(JSON.stringify(fetched));
  const found = findItems(fetched.files, { framework: id });
  if (found.status !== "ok") throw new Error(JSON.stringify(found));
  const built = await buildContent(fetched.source, fetched.files, found.items, { framework: id });
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
