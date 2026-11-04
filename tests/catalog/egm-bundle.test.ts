import { describe, expect, it } from "vitest";
import { readLocalSource } from "../../src/catalog/node.js";
import { buildContent, checkContent } from "../../src/catalog/producer.js";
import {
  type Plan,
  type PlanStep,
  planInstall,
  planRecipe,
  type Recipe,
  renderStep,
} from "../../src/catalog/reader.js";
import { findItems } from "../../src/catalog/source.js";
import {
  AGENT_IDS,
  BUNDLE_INCLUDE,
  blobOf,
  EGM_UPSTREAM,
  egmContent,
  fixtureTree,
  matches,
  PLUGIN_INCLUDE,
  readEgm,
  SKILL_IDS,
  SKILLS,
} from "./egm.js";
import { folder, placements, profile, sha, utf8 } from "./helpers.js";

describe("the EGM fixture", () => {
  it("holds exactly the listed upstream files, byte for byte, with the upstream licence", () => {
    const read = readEgm();
    const paths = read.files.map((file) => file.path).sort();
    expect(paths).toEqual(EGM_UPSTREAM.entries.map((entry) => entry.path).sort());
    for (const entry of EGM_UPSTREAM.entries)
      expect(blobOf(entry.path), entry.path).toBe(entry.blob);
    expect(EGM_UPSTREAM.commit).toBe("403d8881d62022490637d740657b33f01e321ea8");
    expect(paths).toContain("LICENSE");
  });
});

describe("EGM content with its runtime bundle", () => {
  it("records the bundle's root files from the upstream allowlist, with Git's tree hash as scan key", async () => {
    const { read, content } = await egmContent();
    const expected = read.files
      .map((file) => file.path)
      .filter((path) => BUNDLE_INCLUDE.some((pattern) => matches(pattern, path)))
      .sort();
    expect(expected).toContain("agents/zoom_out.md");
    expect(expected).toContain("resources/document_standards/zoom-out-standard.md");
    expect(expected).toContain("docs/codex.md");
    expect(expected).not.toContain("docs/directory.md");

    const [bundle] = content.bundles ?? [];
    expect(bundle).toMatchObject({ id: "egm.runtime", sourceId: "egm", layout: "skills/<name>/" });
    expect(bundle?.files.map((file) => file.sourcePath)).toEqual(expected);
    expect(bundle?.scanKey).toBe(`git-sha1:${fixtureTree(expected)}`);
  });

  it("keeps dev files out of the items, marks all seven skills user-only and points every item at the bundle", async () => {
    const { content } = await egmContent();
    const ids = content.items.map((item) => item.id);
    expect(ids).toEqual([...AGENT_IDS, ...SKILL_IDS].sort());
    for (const item of content.items) {
      expect(item.bundle, item.id).toBe("egm.runtime");
      for (const file of item.files) expect(file.sourcePath).not.toMatch(/TEST\.md|test_scenarios/);
      if (item.kind === "skill") expect(item.userOnly, item.id).toBe(true);
    }
  });

  it("records the paths each item reads outside its own files", async () => {
    const { content } = await egmContent();
    const review = content.items.find((item) => item.id === "egm.skill.egm-review");
    expect(review?.pathReferences).toEqual(
      [
        "agents/comprehension.md",
        "agents/zoom_out.md",
        "docs/claude.md",
        "docs/codex.md",
        "docs/harnesses.md",
        "resources/document_standards/zoom-out-standard.md",
      ].map((path) => ({ sourcePath: "skills/egm-review/SKILL.md", path })),
    );
    const bootstrap = content.items.find((item) => item.id === "egm.skill.egm-bootstrap");
    const paths = (bootstrap?.pathReferences ?? []).map((entry) => entry.path);
    expect(paths).not.toContain("skills/egm-bootstrap/references/templates.md");
    expect(paths).toContain("agents/bootstrap_orchestrator.md");
    const persona = content.items.find((item) => item.id === "egm.agent.zoom_out");
    expect(persona?.pathReferences).toEqual([
      {
        sourcePath: "agents/zoom_out.md",
        path: "resources/document_standards/zoom-out-standard.md",
      },
    ]);
  });

  it("records the plugin folder as the upstream runtime allowlist, not the whole repository", async () => {
    const { read, content } = await egmContent();
    const expected = read.files
      .map((file) => file.path)
      .filter((path) => PLUGIN_INCLUDE.some((pattern) => matches(pattern, path)))
      .sort();
    const [plugin] = content.plugins ?? [];
    expect(plugin?.path).toBe("/");
    expect(plugin?.include).toEqual([...PLUGIN_INCLUDE].sort());
    expect(plugin?.files.map((file) => file.sourcePath)).toEqual(expected);
    for (const dev of ["TESTING.md", "scripts/pack_plugin.py", "skills/egm-review/TEST.md"])
      expect(expected).not.toContain(dev);
    expect(plugin?.scanKey).toBe(`git-sha1:${fixtureTree(expected)}`);
    // A native plugin install clones the whole folder, so the record also keys every file in it.
    const all = read.files.map((file) => file.path).sort();
    expect(plugin?.folderScanKey).toBe(`git-sha1:${fixtureTree(all)}`);
  });

  it("names the whole folder's key on a plugin step and the allowlist's key on local-plugin copies", async () => {
    const { content } = await egmContent();
    const [record] = content.plugins ?? [];
    const result = planRecipe(
      egmRecipe({ "claude-code": "plugin", codex: "plugin" }),
      [content],
      [profile("claude-code"), profile("codex")],
      {},
      { scope: "user", source: RECIPE_SOURCE },
    ) as Plan;
    const steps = result.plan.filter((step) => step.op === "plugin");
    expect(steps.map((step) => [step.cli, step.scanKey])).toEqual([
      ["claude-code", record?.folderScanKey],
      ["codex", record?.folderScanKey],
    ]);
    const local = planRecipe(
      egmRecipe(BASE_ROUTES),
      [content],
      [profile("claude-code")],
      {},
      { scope: "project", source: RECIPE_SOURCE },
    ) as Plan;
    const keys = new Set(
      local.plan.flatMap((step) =>
        step.op === "write" && "route" in step && step.route === "local-plugin"
          ? [step.scanKey]
          : [],
      ),
    );
    expect([...keys]).toEqual([record?.scanKey]);
  });

  it("lists both plugin keys among the unscanned keys until each has a scan", async () => {
    const { read, content } = await egmContent();
    const [record] = content.plugins ?? [];
    const others = [
      ...content.items.map((item) => item.scanKey as string),
      ...(content.bundles ?? []).map((bundle) => bundle.scanKey),
    ];
    const checked = await checkContent(content, read.files, { scannedKeys: others });
    expect(checked).toMatchObject({
      status: "ok",
      unscannedKeys: [record?.scanKey, record?.folderScanKey].sort(),
    });
    const all = await checkContent(content, read.files, {
      scannedKeys: [...others, record?.scanKey as string, record?.folderScanKey as string],
    });
    expect(all).toMatchObject({ status: "ok", unscannedKeys: [] });
  });

  it("checks against the files: a changed bundle file is invalid, and covered paths are not reported", async () => {
    const { read, content } = await egmContent();
    expect(await checkContent(content, read.files)).toEqual({ status: "ok", problems: [] });

    const changed = read.files.map((file) =>
      file.path === "docs/codex.md"
        ? { ...file, bytes: new TextEncoder().encode("changed\n"), sha256: sha("changed\n") }
        : file,
    );
    expect(await checkContent(content, changed)).toMatchObject({
      status: "invalid",
      problems: [{ path: "bundles/0" }],
    });
  });
});

const ALL = [...SKILL_IDS, ...AGENT_IDS];
const bundleFiles = (read: ReturnType<typeof readEgm>) =>
  read.files
    .map((file) => file.path)
    .filter((path) => BUNDLE_INCLUDE.some((pattern) => matches(pattern, path)))
    .sort();

describe("planning EGM items with its bundle", () => {
  it("places Codex and Antigravity skills in .agents/skills with the root files beside them", async () => {
    const { read, content } = await egmContent();
    const plan = planInstall(ALL, [content], [profile("codex"), profile("antigravity")], {
      scope: "project",
      data: null,
    }) as Plan;
    expect(plan).toMatchObject({
      status: "ok",
      missing: [],
      unavailable: [],
      clashes: [],
      references: [],
    });
    const steps = placements(plan.plan);
    const at = (path: string) => steps.filter((step) => "path" in step && step.path === path);

    // Root files at their upstream paths below .agents/, once, for both clients.
    for (const path of bundleFiles(read)) {
      const [step] = at(`.agents/${path}`);
      const file = read.files.find((entry) => entry.path === path);
      expect(step, path).toMatchObject({
        op: "write",
        root: "project",
        from: { sourceId: "egm", sourcePath: path, sha256: file?.sha256 },
        bundle: "egm.runtime",
        items: [...ALL].sort(),
        clis: ["antigravity", "codex"],
      });
      expect(step).not.toHaveProperty("render");
    }
    // Skills in the bundle layout; dev files stay out.
    expect(at(".agents/skills/egm-review/SKILL.md")[0]).toMatchObject({
      item: "egm.skill.egm-review",
      clis: ["antigravity", "codex"],
    });
    expect(at(".agents/skills/egm-review/TEST.md")).toEqual([]);
    // Personas: Antigravity reads them where the bundle puts them; Codex gets its own files.
    expect(at(".agents/agents/egm-zoom-out.md")).toEqual([]);
    expect(at(".codex/agents/egm-zoom-out.toml")[0]).toMatchObject({
      item: "egm.agent.zoom_out",
      clis: ["codex"],
      render: { name: "agent", profile: "codex" },
    });
    // The bundle-root rule in each client's always-on place.
    const rule = steps.filter(
      (step) =>
        (step.op === "merge" && step.key === "aih.rule.bundle-root") ||
        (step.op === "write" && step.path === ".agents/rules/aih-bundle-root.md"),
    );
    expect(rule).toEqual([
      {
        op: "write",
        root: "project",
        path: ".agents/rules/aih-bundle-root.md",
        executable: false,
        render: {
          name: "bundle-root",
          profile: "antigravity",
          version: profile("antigravity").version,
          bundles: [{ bundle: "egm.runtime", root: ".agents/" }],
        },
        scanned: false,
        items: [...ALL].sort(),
        clis: ["antigravity"],
      },
      {
        op: "merge",
        root: "project",
        file: "AGENTS.md",
        format: "markdown",
        key: "aih.rule.bundle-root",
        render: { name: "bundle-root", bundles: [{ bundle: "egm.runtime", root: ".agents/" }] },
        scanned: false,
        items: [...ALL].sort(),
        clis: ["codex"],
      },
    ]);
  });
});

describe("EGM on Kiro", () => {
  it("keeps the bundle in .kiro/aih/egm/ and starts each user-only skill through launchers", async () => {
    const { read, content } = await egmContent();
    const kiro = profile("kiro");
    const plan = planInstall(ALL, [content], [kiro], { scope: "project", data: null }) as Plan;
    expect(plan).toMatchObject({ status: "ok", unavailable: [], references: [], clashes: [] });
    const steps = placements(plan.plan);
    const paths = steps.map((step) => ("path" in step ? step.path : step.file));
    // Nothing in a folder Kiro scans for skills.
    expect(paths.filter((path) => path.startsWith(".kiro/skills/"))).toEqual([]);
    const at = (path: string) => steps.find((step) => "path" in step && step.path === path);
    expect(at(".kiro/aih/egm/skills/egm-review/SKILL.md")).toMatchObject({
      item: "egm.skill.egm-review",
      render: { name: "skill", profile: "kiro" },
      scanned: false,
    });
    expect(at(".kiro/aih/egm/skills/egm-review/TEST.md")).toBeUndefined();
    for (const path of bundleFiles(read))
      expect(at(`.kiro/aih/egm/${path}`), path).toMatchObject({
        bundle: "egm.runtime",
        clis: ["kiro"],
      });
    expect(at(".kiro/agents/egm-zoom-out.json")).toMatchObject({ item: "egm.agent.zoom_out" });

    const prompt = at(".kiro/prompts/egm-review.md");
    const steering = at(".kiro/steering/egm-review.md");
    expect(prompt).toEqual({
      op: "write",
      root: "project",
      path: ".kiro/prompts/egm-review.md",
      executable: false,
      render: {
        name: "launcher",
        profile: "kiro",
        version: kiro.version,
        installName: "egm-review",
        entry: "prompt",
        target: ".kiro/aih/egm/skills/egm-review/SKILL.md",
      },
      scanned: false,
      item: "egm.skill.egm-review",
      clis: ["kiro"],
    });
    const bytesOf = (step: unknown) => {
      const result = renderStep(step as PlanStep, [content], [kiro], []);
      if (result.status !== "ok") throw new Error(JSON.stringify(result));
      return utf8(result.bytes);
    };
    // The one-line launchers checked in Kiro CLI and IDE.
    expect(bytesOf(prompt)).toBe(
      "Read and follow `.kiro/aih/egm/skills/egm-review/SKILL.md`. The user's argument: $ARGUMENTS\n",
    );
    expect(bytesOf(steering)).toBe(
      "---\ninclusion: manual\n---\nRead and follow `.kiro/aih/egm/skills/egm-review/SKILL.md`.\n",
    );
    expect(bytesOf(at(".kiro/steering/aih-bundle-root.md"))).toBe(
      [
        "---",
        "inclusion: always",
        "---",
        "# Bundle roots",
        "",
        "Some installed skills read shared files from a bundle root. Resolve those paths against the root named here.",
        "",
        "- Elephant-Goldfish Model: its skills in `.kiro/aih/egm/skills/` and its agents read `agents/`, `docs/` and `resources/` relative to `.kiro/aih/egm/`.",
        "",
      ].join("\n"),
    );
  });
});

const RECIPE_SOURCE = { repository: "https://example.invalid/egm-recipes", commit: "c".repeat(40) };
/** EGM's base recipe: the upstream's own clients, each through its route. */
const egmRecipe = (routes: Record<string, string>): Recipe =>
  ({
    schema: "urn:aihq:catalog:recipe:0.1.0",
    id: "egm-base",
    kind: "base",
    framework: "egm",
    content: { repository: EGM_UPSTREAM.repository, commit: EGM_UPSTREAM.commit },
    routes,
    plugins: Object.fromEntries(
      Object.entries({
        "claude-code": { marketplace: "egm" },
        codex: { marketplace: EGM_UPSTREAM.repository },
        antigravity: {},
      })
        .filter(([cli]) => routes[cli] === "plugin" || routes[cli] === "local-plugin")
        .map(([cli, extra]) => [
          cli,
          { source: "egm", path: "/", plugin: "egm", commit: EGM_UPSTREAM.commit, ...extra },
        ]),
    ),
    members: ALL.map((item) => ({ item, preTicked: true })),
    data: { repository: "https://example.invalid/catalog-data", commit: "b".repeat(40) },
  }) as unknown as Recipe;
const BASE_ROUTES = { "claude-code": "local-plugin", codex: "plugin", antigravity: "local-plugin" };

describe("EGM's base recipe at project scope", () => {
  it("gives Claude the local plugin, and Codex and Antigravity one .agents layout with the bundle", async () => {
    const { content } = await egmContent();
    const result = planRecipe(
      egmRecipe(BASE_ROUTES),
      [content],
      [profile("claude-code"), profile("codex"), profile("antigravity")],
      {},
      { scope: "project", source: RECIPE_SOURCE },
    ) as Plan;
    expect(result).toMatchObject({
      status: "ok",
      missing: [],
      unavailable: [],
      clashes: [],
      references: [],
    });
    const steps = placements(result.plan);
    const paths = steps.map((step) => ("path" in step ? step.path : `${step.file}#${step.key}`));

    // Claude: the upstream runtime copied as a local plugin and registered.
    const [plugin] = content.plugins ?? [];
    const copied = paths.filter((path) => path.startsWith(".aihq/plugins/egm/")).sort();
    expect(copied).toEqual(
      (plugin?.files ?? []).map((file) => `.aihq/plugins/egm/${file.sourcePath}`).sort(),
    );
    expect(copied).toContain(".aihq/plugins/egm/.claude-plugin/marketplace.json");
    expect(copied).toContain(".aihq/plugins/egm/.claude-plugin/agents/zoom_out.md");
    expect(paths).toContain(".claude/settings.json#/extraKnownMarketplaces/egm");
    expect(paths).toContain(".claude/settings.json#/enabledPlugins/egm@egm");
    expect(paths.filter((path) => path.startsWith(".claude/skills/"))).toEqual([]);

    // Antigravity keeps the shared bundle layout and drops its own local plugin.
    expect(paths.filter((path) => path.startsWith(".agents/plugins/"))).toEqual([]);
    expect(
      steps.find((step) => "path" in step && step.path === ".agents/skills/egm-review/SKILL.md"),
    ).toMatchObject({ clis: ["antigravity", "codex"] });
    expect(
      steps.find((step) => "path" in step && step.path === ".agents/docs/codex.md"),
    ).toMatchObject({
      bundle: "egm.runtime",
      clis: ["antigravity", "codex"],
    });
    expect(paths).toContain(".agents/rules/aih-bundle-root.md");
    expect(paths).toContain("AGENTS.md#aih.rule.bundle-root");

    const codes = result.warnings.map((warning) => [warning.code, warning.cli, warning.route]);
    expect(codes).toEqual([
      ["claude-known-marketplaces", "claude-code", undefined],
      ["claude-start-at-root", "claude-code", undefined],
      ["local-plugin-overlap", "antigravity", { from: "local-plugin", to: "items" }],
      ["scope-fallback", "codex", { from: "plugin", to: "items" }],
    ]);
    const overlap = result.warnings.find((warning) => warning.code === "local-plugin-overlap");
    expect(overlap).toMatchObject({ framework: "egm", items: [...ALL].sort() });
  });

  it("uses Antigravity's local plugin when no other .agents/skills client is planned", async () => {
    const { content } = await egmContent();
    const result = planRecipe(
      egmRecipe(BASE_ROUTES),
      [content],
      [profile("antigravity")],
      {},
      {
        scope: "project",
        source: RECIPE_SOURCE,
      },
    ) as Plan;
    expect(result).toMatchObject({ status: "ok", warnings: [] });
    const paths = placements(result.plan).map((step) => ("path" in step ? step.path : step.file));
    expect(paths).toContain(".agents/plugins/egm/plugin.json");
    expect(paths.filter((path) => path.startsWith(".agents/skills/"))).toEqual([]);
    expect(paths).not.toContain(".agents/rules/aih-bundle-root.md");
  });

  it("with dsh added, gives dsh the same layout and the rule in AGENTS.md; its personas are unavailable", async () => {
    const { content } = await egmContent();
    const result = planRecipe(
      egmRecipe(BASE_ROUTES),
      [content],
      [profile("claude-code"), profile("codex"), profile("antigravity"), profile("dsh")],
      {},
      { scope: "project", source: RECIPE_SOURCE },
    ) as Plan;
    expect(result.status).toBe("incomplete");
    expect(result.unavailable).toEqual(
      AGENT_IDS.map((item) => ({
        item,
        cli: "dsh",
        reason: "unsupported-kind",
        detail: expect.any(String),
      })),
    );
    expect(result.references).toEqual([]);
    const steps = placements(result.plan);
    expect(
      steps.find((step) => "path" in step && step.path === ".agents/skills/egm-review/SKILL.md"),
    ).toMatchObject({ clis: ["antigravity", "codex", "dsh"] });
    expect(
      steps.find(
        (step) => "path" in step && step.path === ".agents/resources/execution_instructions.md",
      ),
    ).toMatchObject({ clis: ["antigravity", "codex", "dsh"] });
    expect(
      steps.find((step) => step.op === "merge" && step.key === "aih.rule.bundle-root"),
    ).toMatchObject({
      file: "AGENTS.md",
      clis: ["codex", "dsh"],
    });
  });
});

describe("EGM with its bundle removed", () => {
  it("plans the same recipe as incomplete and lists every path the skills and personas would miss", async () => {
    const { read, content } = await egmContent({ bundle: false });
    expect(content.bundles).toBeUndefined();
    const result = planRecipe(
      egmRecipe(BASE_ROUTES),
      [content],
      [profile("claude-code"), profile("codex"), profile("antigravity")],
      {},
      { scope: "project", source: RECIPE_SOURCE },
    ) as Plan;
    expect(result.status).toBe("incomplete");
    expect(result.references).toContainEqual({
      kind: "path",
      item: "egm.skill.egm-review",
      file: "skills/egm-review/SKILL.md",
      path: "docs/codex.md",
      clis: ["antigravity", "codex"],
    });
    expect(result.references).toContainEqual({
      kind: "path",
      item: "egm.agent.zoom_out",
      file: "agents/zoom_out.md",
      path: "resources/document_standards/zoom-out-standard.md",
      clis: ["antigravity", "codex"],
    });
    // Every recorded path, for the clients that place the item; the plugin route needs none.
    const expected = content.items.flatMap((item) =>
      (item.pathReferences ?? []).map((reference) => `${item.id} ${reference.path}`),
    );
    expect(
      result.references
        .map((entry) => `${entry.item} ${entry.kind === "path" ? entry.path : entry.name}`)
        .sort(),
    ).toEqual(expected.sort());
    for (const entry of result.references) expect(entry.clis).not.toContain("claude-code");
    const steps = placements(result.plan);
    expect(steps.filter((step) => step.op === "write" && step.bundle !== undefined)).toEqual([]);
    expect(
      steps.filter((step) => step.op === "merge" && step.key === "aih.rule.bundle-root"),
    ).toEqual([]);

    // checkContent reports the paths of items that have no bundle.
    const checked = await checkContent(content, read.files);
    expect(checked).toMatchObject({ status: "ok", problems: [] });
    expect((checked as { pathReferences?: unknown[] }).pathReferences).toContainEqual({
      item: "egm.skill.egm-review",
      sourcePath: "skills/egm-review/SKILL.md",
      path: "agents/zoom_out.md",
    });
  });
});

describe("EGM's user-only skills, personas and scopes", () => {
  const sources = (read: ReturnType<typeof readEgm>) =>
    read.files.map((file) => ({ sourcePath: file.path, bytes: file.bytes as Uint8Array }));

  it("keeps every skill user-only on Codex and Antigravity, with the body unchanged", async () => {
    const { read, content } = await egmContent();
    const profiles = [profile("codex"), profile("antigravity")];
    const plan = planInstall(SKILL_IDS, [content], profiles, {
      scope: "project",
      data: null,
    }) as Plan;
    const steps = placements(plan.plan);
    for (const name of SKILLS) {
      const at = (path: string) => steps.find((step) => "path" in step && step.path === path);
      const render = (path: string) => {
        const result = renderStep(at(path) as PlanStep, [content], profiles, sources(read));
        if (result.status !== "ok") throw new Error(JSON.stringify(result));
        return utf8(result.bytes);
      };
      const yaml = render(`.agents/skills/${name}/agents/openai.yaml`);
      expect(yaml).toMatch(/allow_implicit_invocation: false/);
      const skill = render(`.agents/skills/${name}/SKILL.md`);
      expect(skill).toMatch(/^---\n[\s\S]*disable-model-invocation: true\n[\s\S]*---\n/);
      const upstream = utf8(
        read.files.find((file) => file.path === `skills/${name}/SKILL.md`)?.bytes as Uint8Array,
      );
      const body = (text: string) => text.slice(text.indexOf("\n---\n") + 5);
      expect(body(skill)).toBe(body(upstream));
    }
  });

  it("warns that Kimi lists the bundle's personas as its own agents", async () => {
    const { content } = await egmContent();
    const plan = planInstall(ALL, [content], [profile("kimi")], {
      scope: "project",
      data: null,
    }) as Plan;
    expect(plan.status).toBe("ok");
    expect(plan.warnings).toEqual([
      { code: "kimi-lists-bundle-agents", cli: "kimi", items: [...ALL].sort() },
    ]);
    const paths = placements(plan.plan).map((step) => ("path" in step ? step.path : step.file));
    expect(paths).toContain(".agents/agents/zoom_out.md");
    expect(paths).not.toContain(".agents/agents/egm-zoom-out.md");
  });

  it("copies bundle skills in place at user scope, never through a shared link", async () => {
    const { content } = await egmContent();
    const claude = profile("claude-code");
    const plan = planInstall(ALL, [content], [claude], { scope: "user", data: null }) as Plan;
    expect(plan).toMatchObject({ status: "ok", references: [], unavailable: [] });
    const steps = placements(plan.plan);
    expect(steps.filter((step) => step.op === "link")).toEqual([]);
    const paths = steps.map((step) => ("path" in step ? step.path : step.file));
    expect(paths.filter((path) => path.startsWith(".aihq/shared/"))).toEqual([]);
    expect(paths).toContain(".claude/skills/egm-review/SKILL.md");
    expect(paths).toContain(".claude/agents/zoom_out.md");
    expect(paths).toContain(".claude/resources/execution_instructions.md");
    const rule = steps.find((step) => step.op === "merge" && step.key === "aih.rule.bundle-root");
    expect(rule).toMatchObject({ root: "user", file: ".claude/CLAUDE.md" });
    const bytes = renderStep(rule as PlanStep, [content], [claude], []);
    expect(bytes.status === "ok" && utf8(bytes.bytes)).toContain(
      "- Elephant-Goldfish Model: its skills in `~/.claude/skills/` and its agents read `agents/`, `docs/` and `resources/` relative to `~/.claude/`.",
    );

    // Codex documents no user-scope always-on rule place, so the root cannot be named there.
    const codex = planInstall(SKILL_IDS, [content], [profile("codex")], {
      scope: "user",
      data: null,
    }) as Plan;
    expect(codex.status).toBe("incomplete");
    expect(codex.unavailable).toEqual([
      {
        item: "aih.rule.bundle-root",
        cli: "codex",
        reason: "not-described",
        detail: expect.any(String),
      },
    ]);
  });

  it("lists the bundle's own scan key until it has a scan", async () => {
    const { read, content } = await egmContent();
    const itemKeys = [
      ...content.items.map((item) => item.scanKey as string),
      ...(content.plugins ?? []).flatMap((plugin) => [
        plugin.scanKey,
        plugin.folderScanKey as string,
      ]),
    ];
    const checked = await checkContent(content, read.files, { scannedKeys: itemKeys });
    expect(checked).toMatchObject({
      status: "ok",
      unscannedKeys: [content.bundles?.[0]?.scanKey],
    });
  });
});

describe("bundles from two frameworks", () => {
  /** A small own framework with one bundle skill that reads `docs/guide.md` from its root. */
  async function framework(id: string, guide: string) {
    const root = folder(
      {
        "skills/start/SKILL.md": `---\nname: ${id}-start\ndescription: Start ${id}.\n---\n\nRead \`../../docs/guide.md\` first.\n`,
        "docs/guide.md": guide,
      },
      id,
    );
    const read = readLocalSource(root);
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: id });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const built = await buildContent(
      read.source,
      read.files,
      found.items.map((item) => ({ ...item, bundle: `${id}.runtime` })),
      {
        framework: id,
        bundles: [{ id: `${id}.runtime`, layout: "skills/<name>/", include: ["docs/*.md"] }],
      },
    );
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    return built.content;
  }

  it("reports a clash when two bundles put different files at one root path", async () => {
    const alpha = await framework("alpha", "Alpha guide.\n");
    const beta = await framework("beta", "Beta guide.\n");
    expect(alpha.items[0]?.pathReferences).toEqual([
      { sourcePath: "skills/start/SKILL.md", path: "docs/guide.md" },
    ]);
    const plan = planInstall(
      ["alpha.skill.start", "beta.skill.start"],
      [alpha, beta],
      [profile("codex")],
      { scope: "project", data: null },
    ) as Plan;
    expect(plan.status).toBe("incomplete");
    expect(plan.clashes).toEqual([
      {
        root: "project",
        path: ".agents/docs/guide.md",
        reason: "different-content",
        items: ["alpha.skill.start", "beta.skill.start"],
        clis: ["codex"],
      },
    ]);
  });

  it("counts the bundle-root block toward Codex's 32 KiB AGENTS.md limit", async () => {
    const overhead = (id: string) =>
      `<!-- aih:begin ${id} -->\n`.length + `<!-- aih:end ${id} -->\n`.length;
    // The rule's own block fills AGENTS.md to within a few bytes of the limit.
    const ruleBytes = 32 * 1024 - overhead("gamma.rule.big") - 8;
    const heading = "# Big\n\n";
    const root = folder(
      {
        "skills/start/SKILL.md":
          "---\nname: gamma-start\ndescription: Start gamma.\n---\n\nRead `../../docs/guide.md` first.\n",
        "docs/guide.md": "Gamma guide.\n",
        "rules/big.md": `${heading}${"x".repeat(ruleBytes - heading.length - 1)}\n`,
      },
      "gamma",
    );
    const read = readLocalSource(root);
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: "gamma" });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const built = await buildContent(
      read.source,
      read.files,
      found.items.map((item) =>
        item.kind === "skill" ? { ...item, bundle: "gamma.runtime" } : item,
      ),
      {
        framework: "gamma",
        bundles: [{ id: "gamma.runtime", layout: "skills/<name>/", include: ["docs/*.md"] }],
      },
    );
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    const plan = (selection: string[]) =>
      planInstall(selection, [built.content], [profile("codex")], {
        scope: "project",
        data: null,
      }) as Plan;
    expect(plan(["gamma.rule.big"])).toMatchObject({ status: "ok", clashes: [] });
    const both = plan(["gamma.skill.start", "gamma.rule.big"]);
    expect(both.status).toBe("incomplete");
    expect(both.clashes).toEqual([
      {
        root: "project",
        path: "AGENTS.md",
        reason: "limit",
        items: ["aih.rule.bundle-root", "gamma.rule.big"],
        clis: ["codex"],
      },
    ]);
  });

  it("starts a user-only bundle skill on OpenCode through a command launcher", async () => {
    const { content } = await egmContent();
    const opencode = profile("opencode");
    const plan = planInstall(["egm.skill.egm-review"], [content], [opencode], {
      scope: "project",
      data: null,
    }) as Plan;
    expect(plan).toMatchObject({ status: "ok", references: [] });
    const steps = placements(plan.plan);
    const launcher = steps.find(
      (step) => "path" in step && step.path === ".opencode/commands/egm-review.md",
    );
    const result = renderStep(launcher as PlanStep, [content], [opencode], []);
    expect(result.status === "ok" && utf8(result.bytes)).toBe(
      "Read and follow `.agents/skills/egm-review/SKILL.md`. The user's argument: $ARGUMENTS\n",
    );
    expect(steps.some((step) => "path" in step && step.path === ".agents/docs/codex.md")).toBe(
      true,
    );
  });
});
