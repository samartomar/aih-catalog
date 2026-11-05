import { describe, expect, it } from "vitest";
import { fetchSource } from "../../src/catalog/node.js";
import { buildContent, checkContent } from "../../src/catalog/producer.js";
import {
  type Content,
  type MarketplaceRender,
  type Plan,
  type PlanResult,
  planRecipe,
  type Recipe,
  readContent,
  readRecipe,
  renderStep,
  type WriteStep,
} from "../../src/catalog/reader.js";
import type { DiscoveredItem } from "../../src/catalog/source.js";
import { findItems } from "../../src/catalog/source.js";
import {
  gitRepository,
  gitTree,
  outDir,
  placements,
  profile,
  published,
  publishedAddress,
  sha,
  sortKeys,
  type TreeEntry,
  utf8,
} from "./helpers.js";

const encode = (value: unknown, canonical = true): Uint8Array =>
  new TextEncoder().encode(
    canonical ? `${JSON.stringify(sortKeys(value), null, 2)}\n` : JSON.stringify(value),
  );

const PLUGIN = {
  name: "pack-base",
  version: "1.0.0",
  description: "The whole pack, one click.",
  author: { name: "Pack authors" },
  license: "MIT",
  keywords: ["recipe"],
};
const COMMIT = "a".repeat(40);
const DATA = { repository: "https://example.invalid/catalog-data", commit: "b".repeat(40) };
const RECIPE = {
  schema: "urn:aihq:catalog:recipe:0.1.0",
  id: "pack-base",
  kind: "base",
  framework: "pack",
  content: { repository: "https://example.invalid/pack", commit: COMMIT },
  routes: { "claude-code": "items" },
  plugins: {},
  setup: {},
  clis: {},
  members: [{ item: "pack.skill.revise", preTicked: true }],
  options: [],
  namePrefix: {},
  overrides: [],
  requires: [],
  aiSetup: {},
  data: DATA,
};

describe("reading a recipe", () => {
  it("reads plugin metadata and a canonical recipe document, binding the recipe bytes' sha256", () => {
    const bytes = encode(RECIPE);
    const read = readRecipe(encode(PLUGIN, false), bytes);

    expect(read).toEqual({ status: "ok", recipe: RECIPE, plugin: PLUGIN, sha256: sha(bytes) });
    if (read.status === "ok") expect(Object.isFrozen(read.recipe)).toBe(true);
  });

  it("reads a recipe its author wrote in any strict JSON spelling, identified by its canonical form", () => {
    const written = encode(RECIPE, false);
    const read = readRecipe(encode(PLUGIN, false), written);
    expect(read).toEqual({
      status: "ok",
      recipe: RECIPE,
      plugin: PLUGIN,
      sha256: sha(encode(RECIPE)),
    });
    const duplicate = new TextEncoder().encode(`{"id":"x",${JSON.stringify(RECIPE).slice(1)}`);
    expect(readRecipe(encode(PLUGIN), duplicate)).toMatchObject({ status: "invalid" });
    const trailing = new TextEncoder().encode(`${JSON.stringify(RECIPE)} // note\n`);
    expect(readRecipe(encode(PLUGIN), trailing)).toMatchObject({ status: "invalid" });
  });

  it("rejects a recipe from another format version, or malformed", () => {
    const plugin = encode(PLUGIN);
    expect(
      readRecipe(plugin, encode({ ...RECIPE, schema: "urn:aihq:catalog:recipe:0.2.0" })),
    ).toEqual({ status: "unsupported-version", schema: "urn:aihq:catalog:recipe:0.2.0" });
    expect(
      readRecipe(plugin, encode({ ...RECIPE, routes: { "claude-code": "magic" } })),
    ).toMatchObject({ status: "invalid", problems: [{ path: "/routes/claude-code" }] });
    expect(readRecipe(plugin, encode({ ...RECIPE, usage: "daily" }))).toMatchObject({
      status: "invalid",
      problems: [{ path: "/usage" }],
    });
  });

  it("requires the plugin metadata fields and refuses duplicate keys in plugin.json", () => {
    const { license: _license, ...unlicensed } = PLUGIN;
    expect(readRecipe(encode(unlicensed), encode(RECIPE))).toMatchObject({
      status: "invalid",
      problems: [{ path: "plugin.json/license" }],
    });
    const duplicate = new TextEncoder().encode('{"name":"a","name":"b"}');
    expect(readRecipe(duplicate, encode(RECIPE))).toMatchObject({ status: "invalid" });
  });
});

const skill = (name: string, body = "Do it.") =>
  `---\nname: ${name}\ndescription: The ${name} skill.\n---\n\n${body}\n`;

/**
 * A pinned upstream fixture: a Git repository read at its exact commit, discovered and built
 * through the public producer. `authored` adds dependencies (or other authored fields) by id.
 */
async function pinnedContent(
  framework: string,
  tree: Readonly<Record<string, TreeEntry>>,
  build: {
    authored?: Record<string, Partial<DiscoveredItem>>;
    plugins?: readonly string[];
    /** Hooks have no discovery convention: their author proposes them by id and files. */
    hooks?: Record<string, readonly string[]>;
  } = {},
) {
  const upstream = gitRepository(tree);
  const fetched = await fetchSource(
    { kind: "git", repository: upstream.path, ref: "main" },
    { outDir: outDir(), fromUser: true },
  );
  if (fetched.status !== "ok") throw new Error(JSON.stringify(fetched));
  const found = findItems(fetched.files, { framework });
  if (found.status !== "ok") throw new Error(JSON.stringify(found));
  const file = (path: string) => {
    const entry = fetched.files.find((candidate) => candidate.path === path);
    if (!entry) throw new Error(path);
    return {
      sourceId: framework,
      sourcePath: path,
      sha256: entry.sha256 as string,
      executable: entry.mode === "100755",
      role: "content" as const,
    };
  };
  const hooks = Object.entries(build.hooks ?? {}).map(
    ([id, paths]): DiscoveredItem => ({ id, kind: "hook", files: paths.map(file) }),
  );
  const items = [
    ...found.items.map((item) => ({ ...item, ...build.authored?.[item.id] })),
    ...hooks,
  ];
  const built = await buildContent(published(fetched.source), fetched.files, items, {
    framework,
    ...(build.plugins ? { plugins: build.plugins } : {}),
  });
  if (built.status !== "ok") throw new Error(JSON.stringify(built));
  const reread = readContent(built.bytes);
  if (reread.status !== "ok") throw new Error(JSON.stringify(reread));
  return {
    content: reread.content as Content,
    repository: publishedAddress(upstream.path),
    commit: upstream.commits[0] as string,
    files: fetched.files,
  };
}

/** A recipe read through the public reader from canonical bytes. */
function recipeOf(document: Record<string, unknown>) {
  const read = readRecipe(encode(PLUGIN), encode(document));
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  return read;
}

function planned(result: PlanResult): Plan & { recipe?: unknown } {
  if (result.status !== "ok" && result.status !== "incomplete")
    throw new Error(JSON.stringify(result));
  return result as Plan;
}

const PACK_TREE = {
  LICENSE: "MIT\n",
  "skills/revise/SKILL.md": skill("revise"),
  "skills/deploy/SKILL.md": skill("deploy"),
  "skills/checks/SKILL.md": skill("checks"),
  "skills/lint/SKILL.md": skill("lint"),
  "skills/guard/SKILL.md": skill("guard"),
  "rules/style.md": "# Style\n\nTwo spaces.\n",
};

async function pack() {
  const pinned = await pinnedContent("pack", PACK_TREE, {
    authored: { "pack.skill.deploy": { dependencies: ["pack.skill.checks"] } },
  });
  const document = {
    ...RECIPE,
    content: { repository: pinned.repository, commit: pinned.commit },
    routes: { "claude-code": "items" },
    members: [
      { item: "pack.rule.style", preTicked: true },
      { item: "pack.skill.revise", preTicked: true },
    ],
    options: [
      {
        id: "extras",
        pick: "several",
        items: [
          { item: "pack.skill.deploy", preTicked: false },
          { item: "pack.skill.lint", preTicked: true },
        ],
      },
      {
        id: "safety",
        pick: "one",
        items: [
          { item: "pack.skill.checks", preTicked: false },
          { item: "pack.skill.guard", preTicked: false },
        ],
      },
    ],
  };
  return { ...pinned, document, read: recipeOf(document) };
}

const RECIPE_SOURCE = {
  repository: "https://example.invalid/pack-recipes",
  commit: "c".repeat(40),
};

describe("planning a recipe on the items route", () => {
  it("records the recipe's exact origin and its data identity, and installs members and picks", async () => {
    const { content, read } = await pack();

    const plan = planned(
      planRecipe(
        read.recipe,
        [content],
        [profile("claude-code")],
        { extras: ["pack.skill.lint"] },
        {
          scope: "project",
          source: RECIPE_SOURCE,
        },
      ),
    );

    expect(plan.status).toBe("ok");
    expect(plan.recipe).toEqual({ id: "pack-base", sha256: read.sha256, ...RECIPE_SOURCE });
    expect(plan.data).toEqual(DATA);
    expect(plan.plan.map((step) => ("path" in step ? step.path : step.op))).toEqual([
      ".aihq/notices/pack/LICENSE",
      ".claude/rules/style.md",
      ".claude/skills/lint/SKILL.md",
      ".claude/skills/revise/SKILL.md",
    ]);
  });

  it("refuses a data identity other than the recipe's and requires the recipe's source", async () => {
    const { content, read } = await pack();
    const other = { ...DATA, commit: "d".repeat(40) };

    expect(
      planRecipe(
        read.recipe,
        [content],
        [profile("claude-code")],
        {},
        {
          scope: "project",
          source: RECIPE_SOURCE,
          data: other,
        },
      ),
    ).toMatchObject({ status: "refused", code: "data-mismatch" });
    expect(
      planRecipe(read.recipe, [content], [profile("claude-code")], {}, {
        scope: "project",
      } as never),
    ).toMatchObject({ status: "invalid", problems: [{ path: "options/source" }] });
  });

  it("treats an explicitly skipped option as valid and a dropped dependency as missing", async () => {
    const { content, read } = await pack();
    const plan = (choices: Record<string, string[]>) =>
      planned(
        planRecipe(read.recipe, [content], [profile("claude-code")], choices, {
          scope: "project",
          source: RECIPE_SOURCE,
        }),
      );

    expect(plan({ extras: [], safety: [] }).status).toBe("ok");
    const dropped = plan({ extras: ["pack.skill.deploy"], safety: [] });
    expect(dropped.status).toBe("incomplete");
    expect(dropped.missing).toEqual([
      {
        item: "pack.skill.deploy",
        reason: "dependency-not-selected",
        dependency: "pack.skill.checks",
      },
    ]);
    expect(plan({ extras: ["pack.skill.deploy"], safety: ["pack.skill.checks"] }).status).toBe(
      "ok",
    );
  });

  it("rejects picks outside a group, two picks in a pick-one group and content at another pin", async () => {
    const { content, read, document } = await pack();
    const plan = (recipe: Recipe, choices: Record<string, string[]>) =>
      planRecipe(recipe, [content], [profile("claude-code")], choices, {
        scope: "project",
        source: RECIPE_SOURCE,
      });

    expect(plan(read.recipe, { extras: ["pack.skill.revise"] })).toMatchObject({
      status: "invalid",
      problems: [{ path: "choices/extras" }],
    });
    expect(plan(read.recipe, { safety: ["pack.skill.checks", "pack.skill.guard"] })).toMatchObject({
      status: "invalid",
      problems: [{ path: "choices/safety" }],
    });
    expect(plan(read.recipe, { unknown: [] })).toMatchObject({
      status: "invalid",
      problems: [{ path: "choices/unknown" }],
    });
    const moved = recipeOf({
      ...document,
      content: { ...document.content, commit: "e".repeat(40) },
    });
    expect(plan(moved.recipe, {})).toMatchObject({ status: "refused", code: "content-mismatch" });
  });
});

// A minimal Superpowers-style upstream: one repository that is its own plugin for several
// clients, with a Claude marketplace, a Codex manifest and a hook the plugin ships.
const SP_TREE: Record<string, string> = {
  LICENSE: "MIT\n",
  ".claude-plugin/plugin.json": '{"name":"sp","version":"1.0.0"}\n',
  ".claude-plugin/marketplace.json":
    '{"name":"sp-dev","owner":{"name":"sp"},"plugins":[{"name":"sp","source":"./"}]}\n',
  ".codex-plugin/plugin.json": '{"name":"sp","version":"1.0.0"}\n',
  "hooks/hooks.json": '{"hooks":{}}\n',
  "skills/brainstorming/SKILL.md": skill("brainstorming"),
  "skills/debugging/SKILL.md": skill("debugging"),
};

async function superpowers(routes: Record<string, string>) {
  const pinned = await pinnedContent("sp", SP_TREE, { plugins: ["/"] });
  const entry = { source: "sp", path: "/", plugin: "sp", commit: pinned.commit };
  const plugins = Object.fromEntries(
    Object.entries(routes)
      .filter(([, route]) => route === "plugin" || route === "local-plugin")
      .map(([cli]) => [
        cli,
        cli === "claude-code"
          ? routes[cli] === "plugin"
            ? entry
            : { ...entry, marketplace: "sp-dev" }
          : cli === "codex"
            ? { ...entry, marketplace: pinned.repository, marketplaceName: "sp-dev" }
            : entry,
      ]),
  );
  const document = {
    ...RECIPE,
    id: "sp-base",
    framework: "sp",
    content: { repository: pinned.repository, commit: pinned.commit },
    routes,
    plugins,
    members: [
      { item: "sp.skill.brainstorming", preTicked: true },
      { item: "sp.skill.debugging", preTicked: true },
    ],
  };
  return { ...pinned, document, read: recipeOf(document) };
}

const SP_ROUTES = {
  "claude-code": "plugin",
  codex: "plugin",
  copilot: "plugin",
  opencode: "plugin",
  kiro: "items",
  kimi: "plugin",
};

describe("planning a native plugin route", () => {
  it("records the whole plugin folder at its pin with Scan's tree key", async () => {
    const { content } = await superpowers(SP_ROUTES);

    expect(
      content.plugins?.map(({ sourceId, path, scanKey }) => ({ sourceId, path, scanKey })),
    ).toEqual([{ sourceId: "sp", path: "/", scanKey: `git-sha1:${gitTree(SP_TREE)}` }]);
    expect(content.plugins?.[0]?.files.map((file) => file.sourcePath)).toEqual(
      Object.keys(SP_TREE).sort(),
    );
  });

  it("gives pinned plugin steps, Copilot's local marketplace and honest presence checks at user scope", async () => {
    const { content, read, repository, commit } = await superpowers(SP_ROUTES);
    const profiles = ["claude-code", "codex", "copilot", "kimi", "kiro", "opencode"].map(profile);

    const plan = planned(
      planRecipe(read.recipe, [content], profiles, {}, { scope: "user", source: RECIPE_SOURCE }),
    );

    const scanKey = `git-sha1:${gitTree(SP_TREE)}`;
    const common = {
      op: "plugin",
      framework: "sp",
      plugin: "sp",
      repository,
      commit,
      scanKey,
      verify: "none",
    };
    expect(plan.plan.filter((step) => step.op === "plugin")).toEqual([
      // Claude, like Copilot, installs from a marketplace the plan writes with the plugin
      // pinned by sha: a marketplace it adds by URL is cloned at its current head.
      {
        ...common,
        cli: "claude-code",
        marketplace: { root: "user", path: ".aihq/marketplaces/claude-code/sp" },
        marketplaceName: "aihq-sp",
      },
      { ...common, cli: "codex", marketplace: repository, marketplaceName: "sp-dev" },
      {
        ...common,
        cli: "copilot",
        marketplace: { root: "user", path: ".aihq/marketplaces/sp" },
        marketplaceName: "aihq-sp",
      },
    ]);
    const marketplace = plan.plan.find(
      (step) =>
        step.op === "write" &&
        step.path === ".aihq/marketplaces/sp/.claude-plugin/marketplace.json",
    );
    expect(marketplace).toMatchObject({
      root: "user",
      framework: "sp",
      clis: ["copilot"],
      scanned: false,
      render: { name: "plugin-marketplace", profile: "copilot", version: 4, plugin: "sp", commit },
    });
    // Kimi's pin is not held and OpenCode pins only in a project: both take the items route.
    expect(plan.warnings).toEqual([
      {
        code: "cli-only-plugin",
        cli: "copilot",
        items: ["sp.skill.brainstorming", "sp.skill.debugging"],
        framework: "sp",
      },
      {
        code: "route-unavailable",
        cli: "kimi",
        items: ["sp.skill.brainstorming", "sp.skill.debugging"],
        framework: "sp",
        route: { from: "plugin", to: "items" },
      },
      {
        code: "scope-fallback",
        cli: "opencode",
        items: ["sp.skill.brainstorming", "sp.skill.debugging"],
        framework: "sp",
        route: { from: "plugin", to: "items" },
      },
    ]);
    const placed = (cli: string) =>
      placements(plan.plan).filter(
        (step) => step.op === "write" && step.clis.includes(cli) && step.path.includes("SKILL.md"),
      );
    expect(placed("kiro").length).toBeGreaterThan(0);
    expect(placed("kimi").length).toBeGreaterThan(0);
    expect(placed("claude-code")).toEqual([]);
    expect(placed("copilot")).toEqual([]);
    expect(plan.status).toBe("ok");
  });

  it("renders Copilot's marketplace with the plugin source pinned by sha", async () => {
    const { content, read, commit } = await superpowers(SP_ROUTES);
    const plan = planned(
      planRecipe(
        read.recipe,
        [content],
        [profile("copilot")],
        {},
        { scope: "user", source: RECIPE_SOURCE },
      ),
    );
    const step = plan.plan.find((candidate) => candidate.op === "write") as WriteStep;
    const github = {
      ...step,
      render: {
        ...(step.render as MarketplaceRender),
        repository: "https://github.com/example/sp",
      },
    };

    const rendered = renderStep(github, [content], [profile("copilot")], []);

    if (rendered.status !== "ok") throw new Error(JSON.stringify(rendered));
    expect(JSON.parse(utf8(rendered.bytes))).toEqual({
      name: "aihq-sp",
      owner: { name: "aihq" },
      plugins: [{ name: "sp", source: { source: "github", repo: "example/sp", sha: commit } }],
    });
    expect(renderStep(step, [content], [{ ...profile("copilot"), version: 1 }], [])).toMatchObject({
      status: "refused",
      code: "profile-mismatch",
    });
  });

  it("falls back at project scope where the client installs plugins only for the user", async () => {
    const { content, read } = await superpowers(SP_ROUTES);
    const profiles = ["claude-code", "codex", "copilot", "opencode"].map(profile);

    const plan = planned(
      planRecipe(read.recipe, [content], profiles, {}, { scope: "project", source: RECIPE_SOURCE }),
    );

    expect(plan.plan.filter((step) => step.op === "plugin").map((step) => step.cli)).toEqual([
      "claude-code",
      "opencode",
    ]);
    expect(
      plan.plan.find((step) => step.op === "plugin" && step.cli === "opencode"),
    ).not.toHaveProperty("marketplace");
    expect(plan.warnings.map((warning) => [warning.code, warning.cli, warning.route?.to])).toEqual([
      ["scope-fallback", "codex", "items"],
      ["scope-fallback", "copilot", "items"],
    ]);
    // Only Claude's own pinned marketplace is written, in the project; Copilot fell back.
    expect(
      plan.plan
        .filter((step) => step.op === "write" && step.path.startsWith(".aihq/marketplaces"))
        .map((step) => [(step as WriteStep).root, (step as WriteStep).path]),
    ).toEqual([["project", ".aihq/marketplaces/claude-code/sp/.claude-plugin/marketplace.json"]]);
  });

  it("requires the marketplace's declared name where the client installs <plugin>@<marketplace-name>", async () => {
    const { content, document } = await superpowers({ "claude-code": "plugin", codex: "plugin" });
    const { marketplaceName: _name, ...unnamed } = document.plugins.codex as Record<
      string,
      unknown
    >;
    const read = recipeOf({ ...document, plugins: { ...document.plugins, codex: unnamed } });
    const result = planRecipe(
      read.recipe,
      [content],
      ["claude-code", "codex"].map(profile),
      {},
      { scope: "user", source: RECIPE_SOURCE },
    );
    expect(result).toEqual({
      status: "invalid",
      problems: [
        {
          path: "recipe/plugins/codex/marketplaceName",
          message:
            "codex installs <plugin>@<marketplace-name>: name the marketplace's declared name",
        },
      ],
    });
    // Only a plugin route installs from a named marketplace.
    const local = { ...document, routes: { "claude-code": "local-plugin" } };
    const named = {
      ...local,
      plugins: {
        "claude-code": {
          ...document.plugins["claude-code"],
          marketplace: "sp-dev",
          marketplaceName: "sp-dev",
        },
      },
    };
    expect(readRecipe(encode(PLUGIN), encode(named))).toMatchObject({
      status: "invalid",
      problems: [{ path: "/plugins/claude-code/marketplaceName" }],
    });
  });

  it("reports a plugin folder the content does not record as missing", async () => {
    const pinned = await pinnedContent("sp", SP_TREE);
    const { document } = await superpowers({ "claude-code": "plugin" });
    const read = recipeOf({
      ...document,
      content: { repository: pinned.repository, commit: pinned.commit },
      plugins: { "claude-code": { ...document.plugins["claude-code"], commit: pinned.commit } },
    });

    const plan = planned(
      planRecipe(
        read.recipe,
        [pinned.content],
        [profile("claude-code")],
        {},
        { scope: "user", source: RECIPE_SOURCE },
      ),
    );

    expect(plan.status).toBe("incomplete");
    expect(plan.missing).toEqual([
      { framework: "sp", cli: "claude-code", reason: "plugin-not-recorded" },
    ]);
  });
});

describe("planning a local-plugin route", () => {
  it("copies the plugin folder as one unit, registers it and lists its items on the first step", async () => {
    const { content, read } = await superpowers({ "claude-code": "local-plugin" });

    const plan = planned(
      planRecipe(
        read.recipe,
        [content],
        [profile("claude-code")],
        {},
        { scope: "project", source: RECIPE_SOURCE },
      ),
    );

    expect(plan.status).toBe("ok");
    const routed = placements(plan.plan).filter(
      (step) => step.op !== "link" && step.route === "local-plugin",
    );
    expect(
      routed.map((step) => (step.op === "merge" ? `${step.file}#${step.key}` : step.path)),
    ).toEqual([
      ...Object.keys(SP_TREE)
        .sort()
        .map((path) => `.aihq/plugins/sp/${path}`),
      ".claude/settings.json#/enabledPlugins/sp@sp-dev",
      ".claude/settings.json#/extraKnownMarketplaces/sp-dev",
    ]);
    for (const step of routed) {
      expect(step).toMatchObject({ framework: "sp", route: "local-plugin", clis: ["claude-code"] });
      expect("item" in step).toBe(false);
    }
    expect((routed[0] as WriteStep).contains).toEqual([
      "sp.skill.brainstorming",
      "sp.skill.debugging",
    ]);
    expect(routed.slice(1).every((step) => !("contains" in step))).toBe(true);
    expect(routed.filter((step) => step.op === "merge").map((step) => step.entry)).toEqual([
      true,
      { source: { source: "directory", path: "./.aihq/plugins/sp" } },
    ]);
    const license = plan.plan.find(
      (step) => step.op === "write" && step.path === ".aihq/notices/sp/LICENSE",
    );
    expect(license).toMatchObject({
      items: ["sp.skill.brainstorming", "sp.skill.debugging"],
      clis: ["claude-code"],
    });
    expect(plan.warnings.map((warning) => warning.code)).toEqual([
      "claude-known-marketplaces",
      "claude-start-at-root",
    ]);
    expect(
      placements(plan.plan).some(
        (step) => step.op === "write" && step.path.startsWith(".claude/skills"),
      ),
    ).toBe(false);
  });

  it("requires the client's manifest in the copied plugin, and copies one that has it", async () => {
    const without = await superpowers({ antigravity: "local-plugin" });
    const missing = planned(
      planRecipe(
        without.read.recipe,
        [without.content],
        [profile("antigravity")],
        {},
        {
          scope: "project",
          source: RECIPE_SOURCE,
        },
      ),
    );
    expect(missing.status).toBe("incomplete");
    expect(missing.missing).toEqual([
      { framework: "sp", cli: "antigravity", reason: "no-plugin-manifest" },
    ]);

    const pinned = await pinnedContent(
      "sp",
      { ...SP_TREE, "plugin.json": '{"name":"sp"}\n' },
      { plugins: ["/"] },
    );
    const read = recipeOf({
      ...without.document,
      content: { repository: pinned.repository, commit: pinned.commit },
      plugins: { antigravity: { source: "sp", path: "/", plugin: "sp", commit: pinned.commit } },
    });
    const both = planned(
      planRecipe(
        read.recipe,
        [pinned.content],
        [profile("antigravity")],
        {},
        { scope: "user", source: RECIPE_SOURCE },
      ),
    );
    expect(both.status).toBe("ok");
    const steps = placements(both.plan).filter(
      (step) => step.op === "write" && step.route === "local-plugin",
    );
    expect(steps.map((step) => (step.op === "write" ? step.path : ""))).toContain(
      ".gemini/config/plugins/sp/plugin.json",
    );
    expect(both.plan.some((step) => step.op === "merge")).toBe(false);
  });

  it("falls back from an unpinnable native plugin to a local plugin the client can load", async () => {
    const pinned = await pinnedContent(
      "sp",
      { ...SP_TREE, "plugin.json": '{"name":"sp"}\n' },
      { plugins: ["/"] },
    );
    const { document } = await superpowers({ antigravity: "plugin" });
    const read = recipeOf({
      ...document,
      content: { repository: pinned.repository, commit: pinned.commit },
      plugins: { antigravity: { source: "sp", path: "/", plugin: "sp", commit: pinned.commit } },
    });

    const plan = planned(
      planRecipe(
        read.recipe,
        [pinned.content],
        [profile("antigravity")],
        {},
        {
          scope: "project",
          source: RECIPE_SOURCE,
        },
      ),
    );

    expect(plan.warnings.map((warning) => [warning.code, warning.route])).toEqual([
      ["route-unavailable", { from: "plugin", to: "local-plugin" }],
    ]);
    expect(plan.plan.some((step) => step.op === "plugin")).toBe(false);
    expect(
      placements(plan.plan).some(
        (step) => step.op === "write" && step.path === ".agents/plugins/sp/plugin.json",
      ),
    ).toBe(true);
  });

  it("falls back to items at a scope without a local-plugin place, keeping the scope", async () => {
    const { content, read } = await superpowers({ "claude-code": "local-plugin" });

    const plan = planned(
      planRecipe(
        read.recipe,
        [content],
        [profile("claude-code")],
        {},
        { scope: "user", source: RECIPE_SOURCE },
      ),
    );

    expect(plan.warnings).toEqual([
      {
        code: "scope-fallback",
        cli: "claude-code",
        items: ["sp.skill.brainstorming", "sp.skill.debugging"],
        framework: "sp",
        route: { from: "local-plugin", to: "items" },
      },
    ]);
    expect(placements(plan.plan).every((step) => step.root === "user")).toBe(true);
    expect(
      placements(plan.plan).some(
        (step) => step.op === "link" && step.path === ".claude/skills/brainstorming",
      ),
    ).toBe(true);
  });

  it("gives byte-identical plans for identical inputs", async () => {
    const { content, read } = await superpowers({
      "claude-code": "local-plugin",
      copilot: "plugin",
      kiro: "items",
    });
    const once = () =>
      JSON.stringify(
        planRecipe(
          read.recipe,
          [content],
          ["kiro", "copilot", "claude-code"].map(profile),
          {},
          {
            scope: "project",
            source: RECIPE_SOURCE,
          },
        ),
      );
    expect(once()).toBe(once());
  });
});

describe("planning an upstream setup route", () => {
  async function gstack(marker: string) {
    const tree = {
      LICENSE: "MIT\n",
      setup: { text: `#!/bin/sh\ntouch '${marker}'\n`, executable: true },
      "skills/browse/SKILL.md": skill("browse"),
      "skills/ship/SKILL.md": skill("ship"),
    };
    const pinned = await pinnedContent("gs", tree);
    const setup = (host: string, into: string) => ({
      repository: pinned.repository,
      commit: pinned.commit,
      into,
      command: ["./setup", "--host", host],
      needs: ["bun>=1.4.2"],
    });
    const document = {
      ...RECIPE,
      id: "gs-base",
      framework: "gs",
      content: { repository: pinned.repository, commit: pinned.commit },
      routes: { "claude-code": "setup", codex: "setup", kimi: "items", dsh: "items" },
      setup: {
        "claude-code": setup("claude", ".claude/skills/gstack"),
        codex: setup("codex", ".agents/skills/gstack"),
      },
      namePrefix: { "claude-code": "", codex: "gs-", dsh: "gs-", kimi: "gs-" },
      members: [
        { item: "gs.skill.browse", preTicked: true },
        { item: "gs.skill.ship", preTicked: true },
      ],
    };
    return { ...pinned, document, read: recipeOf(document) };
  }

  it("plans an exact approval-requiring setup step and runs nothing", async () => {
    const marker = `${outDir()}/RAN`;
    const { content, read, repository, commit } = await gstack(marker);
    const profiles = ["claude-code", "codex", "dsh", "kimi"].map(profile);

    const plan = planned(
      planRecipe(read.recipe, [content], profiles, {}, { scope: "project", source: RECIPE_SOURCE }),
    );

    expect(plan.status).toBe("ok");
    expect(plan.plan.filter((step) => step.op === "upstream-setup")).toEqual([
      {
        op: "upstream-setup",
        cli: "claude-code",
        framework: "gs",
        root: "project",
        repository,
        commit,
        into: ".claude/skills/gstack",
        command: ["./setup", "--host", "claude"],
        needs: ["bun>=1.4.2"],
        scanned: false,
        approval: "required",
      },
      expect.objectContaining({ cli: "codex", command: ["./setup", "--host", "codex"] }),
    ]);
    expect(plan.plan.at(-1)?.op).toBe("upstream-setup");
    // Kimi and dsh share `.agents/skills`: one prefixed copy serves both.
    expect(
      placements(plan.plan)
        .filter((step) => step.op === "write" && step.path.endsWith("SKILL.md"))
        .map((step) => [step.op === "write" ? step.path : "", step.clis]),
    ).toEqual([
      [".agents/skills/gs-browse/SKILL.md", ["dsh", "kimi"]],
      [".agents/skills/gs-ship/SKILL.md", ["dsh", "kimi"]],
    ]);
    const { existsSync } = await import("node:fs");
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses a setup whose repository pin is not the supplied content's", async () => {
    const { content, document } = await gstack(`${outDir()}/RAN`);
    const read = recipeOf({
      ...document,
      setup: { ...document.setup, codex: { ...document.setup.codex, commit: "f".repeat(40) } },
    });

    expect(
      planRecipe(
        read.recipe,
        [content],
        [profile("codex")],
        {},
        { scope: "project", source: RECIPE_SOURCE },
      ),
    ).toMatchObject({ status: "refused", code: "content-mismatch" });
  });
});

describe("recipe prefixes and recorded plugin folders", () => {
  it("prefixes install names by kind on the items route", async () => {
    const { content, document } = await pack();
    const read = recipeOf({ ...document, namePrefix: { skill: "pk-" } });

    const plan = planned(
      planRecipe(
        read.recipe,
        [content],
        [profile("claude-code")],
        {},
        { scope: "project", source: RECIPE_SOURCE },
      ),
    );

    expect(
      placements(plan.plan).flatMap((step) => (step.op === "write" ? [step.path] : [])),
    ).toEqual([
      ".aihq/notices/pack/LICENSE",
      ".claude/rules/style.md",
      ".claude/skills/pk-lint/SKILL.md",
      ".claude/skills/pk-revise/SKILL.md",
    ]);
  });

  it("checks a recorded plugin folder against the files", async () => {
    const { content, files } = await superpowers({ "claude-code": "plugin" });
    expect(await checkContent(content, files)).toEqual({ status: "ok", problems: [] });

    const changed = new TextEncoder().encode('{"hooks":{"changed":true}}\n');
    const altered = files.map((file) =>
      file.path === "hooks/hooks.json" ? { ...file, bytes: changed, sha256: sha(changed) } : file,
    );
    expect(await checkContent(content, altered)).toMatchObject({
      status: "invalid",
      problems: [{ path: "plugins/0" }],
    });
  });
});

describe("recipe choices that are never valid", () => {
  it("refuses a pre-ticked hook, and plans the same hook left unticked", async () => {
    const HOOK = `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] }] } })}\n`;
    const pinned = await pinnedContent(
      "hk",
      {
        "skills/a/SKILL.md": skill("a"),
        "hooks/guard/hooks.json": HOOK,
        "hooks/guard/guard.sh": { text: "#!/bin/sh\n", executable: true },
      },
      { hooks: { "hk.hook.guard": ["hooks/guard/guard.sh", "hooks/guard/hooks.json"] } },
    );
    const recipe = (preTicked: boolean) =>
      recipeOf({
        ...RECIPE,
        id: "hk-base",
        framework: "hk",
        content: { repository: pinned.repository, commit: pinned.commit },
        members: [{ item: "hk.skill.a", preTicked: true }],
        options: [{ id: "hooks", pick: "several", items: [{ item: "hk.hook.guard", preTicked }] }],
      }).recipe;
    const plan = (preTicked: boolean) =>
      planRecipe(
        recipe(preTicked),
        [pinned.content],
        [profile("claude-code")],
        {},
        {
          scope: "project",
          source: RECIPE_SOURCE,
        },
      );

    expect(plan(true)).toMatchObject({
      status: "invalid",
      problems: [{ path: "recipe/hk.hook.guard" }],
    });
    expect(plan(false)).toMatchObject({ status: "ok" });
  });
});
