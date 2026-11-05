import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readLocalSource } from "../../src/catalog/node.js";
import { buildContent, checkContent } from "../../src/catalog/producer.js";
import {
  type Content,
  type Plan,
  type PlanResult,
  type PlanStep,
  planInstall,
  planRecipe,
  readContent,
  readRecipe,
  renderStep,
} from "../../src/catalog/reader.js";
import type { SourceFile } from "../../src/catalog/source.js";
import { placements, profile, sha, sortKeys, utf8 } from "./helpers.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const FAMILIES = ["ecc", "extensions", "project-basics", "superpowers"] as const;
const FIXTURE = join(repositoryRoot, "tests/fixtures/port-maintained");
const UPSTREAM = JSON.parse(
  readFileSync(join(repositoryRoot, "tests/fixtures/port-maintained.upstream.json"), "utf8"),
) as Record<
  string,
  { repository: string; commit: string; entries: { path: string; mode: string; blob: string }[] }
>;
const REPORT = JSON.parse(
  readFileSync(join(repositoryRoot, "port-report/maintained.json"), "utf8"),
);

/** The exact pins the port records; written out here, independently of the port tool. */
const PINS = {
  ecc: ["https://github.com/affaan-m/ECC", "5064474d4d762dc9640234a41617cccb79185cec"],
  superpowers: ["https://github.com/obra/superpowers", "5bf4e78011075bcfc0dc295f0724994cd123ee71"],
  extensions: [
    "https://github.com/samartomar/aih-extensions",
    "2481164a51ea7f9e480d51ef52f3d5cf15b017fa",
  ],
  matt: ["https://github.com/mattpocock/skills", "59db609eb1e18aaf59b63284d0e52255aff0c63c"],
} as const;

function data(family: string): Content {
  const read = readContent(readFileSync(join(repositoryRoot, "data", family, "content.json")));
  if (read.status !== "ok") throw new Error(`${family}: ${JSON.stringify(read).slice(0, 500)}`);
  return read.content;
}

/** Every regular file under a folder, as source files tagged with a source id. */
function filesIn(folder: string, sourceId: string): SourceFile[] {
  const read = readLocalSource(folder);
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  return read.files.map((file) => ({ ...file, sourceId }));
}

const generated = (family: string) =>
  filesIn(join(repositoryRoot, "data", family, "generated"), `${family}-generated`);
const authored = (family: string, sourceId: string) =>
  filesIn(join(repositoryRoot, "data", family, "authored", sourceId), sourceId);
const fixture = (name: keyof typeof PINS, sourceId: string = name) =>
  filesIn(join(FIXTURE, name), sourceId);

/** The content with only these items (and no plugin record), for checks over a byte subset. */
function subset(content: Content, ids: readonly string[]): Content {
  const items = content.items.filter((item) => ids.includes(item.id));
  expect(items.map((item) => item.id).sort()).toEqual([...ids].sort());
  const { plugins: _plugins, bundles, ...rest } = content;
  const used = (bundles ?? []).filter((bundle) => items.some((item) => item.bundle === bundle.id));
  return { ...rest, ...(used.length > 0 ? { bundles: used } : {}), items };
}

function planned(result: PlanResult): Plan {
  if (result.status !== "ok" && result.status !== "incomplete")
    throw new Error(JSON.stringify(result).slice(0, 2000));
  return result as Plan;
}
const writesAt = (plan: readonly PlanStep[]) =>
  placements(plan)
    .filter((step) => step.op === "write")
    .map((step) => (step as { path: string }).path);
const encode = (value: unknown) =>
  new TextEncoder().encode(`${JSON.stringify(sortKeys(value), null, 2)}\n`);
const PLUGIN = {
  name: "port-check",
  version: "1.0.0",
  description: "A recipe written for the port checks.",
  author: { name: "Catalog tests" },
  license: "Apache-2.0",
  keywords: ["recipe"],
};
const DATA = { repository: "https://github.com/samartomar/aih-catalog", commit: "d".repeat(40) };
const SOURCE = { repository: "https://example.invalid/recipes", commit: "e".repeat(40) };
function recipe(document: Record<string, unknown>) {
  const read = readRecipe(
    encode(PLUGIN),
    encode({
      schema: "urn:aihq:catalog:recipe:0.1.0",
      kind: "base",
      plugins: {},
      setup: {},
      clis: {},
      options: [],
      namePrefix: {},
      overrides: [],
      requires: [],
      aiSetup: {},
      data: DATA,
      ...document,
    }),
  );
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  return read.recipe;
}

describe("the maintained-port fixture", () => {
  it("holds exactly the listed upstream files with their upstream blob ids and modes", () => {
    for (const [name, upstream] of Object.entries(UPSTREAM)) {
      const [repository, commit] = PINS[name as keyof typeof PINS];
      expect(upstream).toMatchObject({ repository, commit });
      const root = join(FIXTURE, name);
      const present = readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(root, join(entry.parentPath, entry.name)))
        .sort();
      expect(present).toEqual(upstream.entries.map((entry) => entry.path));
      for (const entry of upstream.entries) {
        const path = join(root, entry.path);
        const blob = execFileSync("git", ["hash-object", path], { encoding: "utf8" }).trim();
        expect(blob, entry.path).toBe(entry.blob);
        expect((statSync(path).mode & 0o111) !== 0, entry.path).toBe(entry.mode === "100755");
      }
    }
  });
});

describe("the ported candidate data", () => {
  it("reads canonically and pins every upstream source at its exact commit", async () => {
    const sources = Object.fromEntries(
      FAMILIES.map((family) => [
        family,
        data(family).sources.map(({ id, kind, repository, commit }) => ({
          id,
          kind,
          ...(repository ? { repository, commit } : {}),
        })),
      ]),
    );
    const git = (id: keyof typeof PINS) => ({
      id,
      kind: "git",
      repository: PINS[id][0],
      commit: PINS[id][1],
    });
    expect(sources).toEqual({
      ecc: [git("ecc"), { id: "ecc-generated", kind: "authored" }],
      extensions: [
        git("extensions"),
        git("matt"),
        { id: "extensions-generated", kind: "authored" },
      ],
      "project-basics": [{ id: "project-basics", kind: "authored" }],
      superpowers: [
        git("superpowers"),
        { id: "superpowers-catalog", kind: "authored" },
        { id: "superpowers-generated", kind: "authored" },
      ],
    });
    for (const family of FAMILIES)
      expect(await checkContent(data(family)), family).toMatchObject({ status: "ok" });
  });

  it("commits every generated cut-out and authored file the records name, and nothing else", async () => {
    for (const family of FAMILIES) {
      const content = data(family);
      const committed = [
        ...(family === "project-basics" ? [] : generated(family)),
        ...(family === "project-basics" ? authored(family, "project-basics") : []),
        ...(family === "superpowers" ? authored(family, "superpowers-catalog") : []),
      ];
      const local = new Set(committed.map((file) => `${file.sourceId}\0${file.path}`));
      const named = new Set<string>();
      const own = content.items.filter((item) =>
        [...item.files, ...Object.values(item.editions ?? {}).flatMap((e) => e.files)].every(
          (file) => local.has(`${file.sourceId}\0${file.sourcePath}`),
        ),
      );
      for (const item of content.items)
        for (const file of [
          ...item.files,
          ...Object.values(item.editions ?? {}).flatMap((e) => e.files),
        ])
          if (local.has(`${file.sourceId}\0${file.sourcePath}`))
            named.add(`${file.sourceId}\0${file.sourcePath}`);
      expect([...local].sort(), family).toEqual([...named].sort());
      // Items made only of committed files check fully against those bytes.
      const ids = own
        .filter((item) => (item.pathReferences ?? []).length === 0)
        .map((item) => item.id);
      const result = await checkContent(subset(content, ids), committed);
      expect(result, family).toMatchObject({ status: "ok" });
    }
  });

  it("checks representative upstream items byte for byte against the pinned upstream files", async () => {
    const cases: [string, string[], SourceFile[]][] = [
      [
        "ecc",
        [
          "ecc.agent.architect",
          "ecc.skill.api-design",
          "ecc.skill.gan-build",
          "ecc.skill.team-builder",
          "ecc.rule.steering.python-patterns",
          "ecc.hook.tdd-reminder",
          "ecc.mcp.context7",
          "ecc.mcp.memxus",
        ],
        [...fixture("ecc"), ...generated("ecc")],
      ],
      [
        "superpowers",
        [
          "superpowers.skill.using-git-worktrees",
          "superpowers.skill.requesting-code-review",
          "superpowers.skill.subagent-driven-development",
          "superpowers.rule.session-bootstrap",
        ],
        [...fixture("superpowers"), ...authored("superpowers", "superpowers-catalog")],
      ],
      [
        "extensions",
        [
          "extensions.skill.security-and-hardening",
          "extensions.skill.ship",
          "extensions.agent.security-auditor",
          "extensions.skill.engineering.tdd",
        ],
        [...fixture("extensions"), ...fixture("matt")],
      ],
    ];
    for (const [family, ids, files] of cases) {
      const result = await checkContent(subset(data(family), ids), files);
      expect(result, family).toMatchObject({ status: "ok" });
    }
    // Notices are the pinned licence and notice files, by sha256.
    const notices = (family: string, source: string) =>
      data(family).sources.find((entry) => entry.id === source)?.notices;
    const shaOf = (name: keyof typeof PINS, path: string) =>
      sha(readFileSync(join(FIXTURE, name, path)));
    expect(notices("ecc", "ecc")).toEqual([
      { sourcePath: "LICENSE", sha256: shaOf("ecc", "LICENSE"), covers: "/" },
    ]);
    expect(notices("extensions", "extensions")).toEqual(
      [
        "LICENSE",
        "NOTICE.md",
        "licenses/addyosmani-agent-skills.LICENSE",
        "licenses/mattpocock-skills.LICENSE",
      ].map((path) => ({ sourcePath: path, sha256: shaOf("extensions", path), covers: "/" })),
    );
    expect(notices("extensions", "matt")).toEqual([
      { sourcePath: "LICENSE", sha256: shaOf("matt", "LICENSE"), covers: "/" },
    ]);
  });

  it("re-derives the committed cut-outs from the upstream shared files", async () => {
    const files = fixture("ecc");
    const shaOf = (path: string) => files.find((file) => file.path === path)?.sha256 as string;
    const cut = (path: string, pointer: string, as: "hook" | "mcp", version?: string) => ({
      sourceId: "ecc",
      sourcePath: path,
      sha256: shaOf(path),
      executable: false,
      role: "content" as const,
      cut: { pointer, as, ...(version ? { version } : {}) },
    });
    const built = await buildContent(
      { kind: "git", repository: PINS.ecc[0], commit: PINS.ecc[1] },
      files,
      [
        {
          id: "ecc.hook.session-start",
          kind: "hook",
          files: [cut("hooks/hooks.json", "/hooks/SessionStart/0", "hook")],
          editions: {
            "claude-code": { files: [cut("hooks/hooks.json", "/hooks/SessionStart/0", "hook")] },
            codex: { files: [cut("hooks/codex-hooks.json", "/hooks/SessionStart/0", "hook")] },
          },
        },
        {
          id: "ecc.mcp.context7",
          kind: "mcp",
          files: [cut("mcp-configs/mcp-servers.json", "/mcpServers/context7", "mcp", "4.4.4")],
        },
      ],
      { framework: { id: "ecc", name: "ECC" } },
    );
    expect(built.status).toBe("ok");
    if (built.status !== "ok") return;
    const committed = new Map(generated("ecc").map((file) => [file.path, file.sha256]));
    expect(built.generated.map((file) => file.path)).toEqual([
      "ecc.hook.session-start/codex/hooks.json",
      "ecc.hook.session-start/hooks.json",
      "ecc.mcp.context7/server.json",
    ]);
    for (const file of built.generated)
      expect(file.sha256, file.path).toBe(committed.get(file.path));
    const record = data("ecc").items.find((item) => item.id === "ecc.mcp.context7");
    expect(built.content.items.find((item) => item.id === "ecc.mcp.context7")).toEqual(record);
    expect(
      JSON.parse(utf8(built.generated[2]?.bytes ?? new Uint8Array())).packages[0],
    ).toMatchObject({ identifier: "@upstash/context7-mcp", version: "4.4.4" });
  });
});

describe("representative plans of the ported frameworks", () => {
  it("plans ECC on Kiro with its editions, prefixed names, command launch files and notices once", () => {
    const ecc = data("ecc");
    const base = recipe({
      id: "ecc-port-check",
      framework: "ecc",
      content: { repository: PINS.ecc[0], commit: PINS.ecc[1] },
      routes: { kiro: "items" },
      namePrefix: { skill: "ecc-", agent: "ecc-" },
      members: [
        "ecc.agent.architect",
        "ecc.skill.api-design",
        "ecc.skill.gan-build",
        "ecc.skill.team-builder",
        "ecc.rule.steering.python-patterns",
        "ecc.hook.tdd-reminder",
      ].map((item) => ({ item, preTicked: !item.includes(".hook.") })),
    });
    const plan = planned(
      planRecipe(base, [ecc], [profile("kiro")], {}, { scope: "project", source: SOURCE }),
    );
    const steps = placements(plan.plan).filter((step) => step.op === "write") as unknown as {
      path: string;
      from?: { sourcePath: string };
    }[];
    const from = (path: string) => steps.find((step) => step.path === path)?.from?.sourcePath;
    // Upstream Kiro editions are copied as they are.
    expect(from(".kiro/agents/architect.json")).toBe(".kiro/agents/architect.json");
    expect(from(".kiro/agents/architect.md")).toBe(".kiro/agents/architect.md");
    expect(from(".kiro/skills/ecc-api-design/SKILL.md")).toBe(".kiro/skills/api-design/SKILL.md");
    expect(from(".kiro/steering/python-patterns.md")).toBe(".kiro/steering/python-patterns.md");
    expect(from(".kiro/hooks/tdd-reminder.kiro.hook")).toBe(".kiro/hooks/tdd-reminder.kiro.hook");
    // A former command is a Kiro prompt file plus manual steering, never a Kiro skill.
    expect(from(".kiro/prompts/ecc-gan-build.md")).toBe("commands/gan-build.md");
    expect(writesAt(plan.plan).filter((path) => path.includes("gan-build"))).toEqual([
      ".kiro/prompts/ecc-gan-build.md",
      ".kiro/steering/ecc-gan-build.md",
    ]);
    expect(writesAt(plan.plan).filter((path) => path.startsWith(".aihq/notices/"))).toEqual([
      ".aihq/notices/ecc/LICENSE",
    ]);
    // ECC's namespaced names are listed, not rewritten.
    expect(
      plan.references
        .filter((reference) => reference.kind === "name")
        .map((reference) => (reference as { name: string }).name),
    ).toEqual(["ecc:architect", "ecc:security-reviewer"]);
    expect(plan.status).toBe("ok");
  });

  it("plans an ECC MCP server with its exact package version and a Claude hook as unavailable", () => {
    const plan = planned(
      planInstall(
        ["ecc.mcp.context7", "ecc.hook.pre-compact"],
        [data("ecc")],
        [profile("claude-code")],
        {
          scope: "project",
          data: null,
        },
      ),
    );
    expect(plan.plan.find((step) => step.op === "merge")).toMatchObject({
      file: ".mcp.json",
      key: "/mcpServers/context7",
      entry: { command: "npx", args: ["-y", "@upstash/context7-mcp@4.4.4"] },
    });
    // Claude keeps hooks in a list-valued settings file that a keyed merge cannot own.
    expect(plan.unavailable).toEqual([
      expect.objectContaining({
        item: "ecc.hook.pre-compact",
        cli: "claude-code",
        reason: "no-edition-place",
      }),
    ]);
    expect(plan.status).toBe("incomplete");
  });

  it("plans one ECC command on Codex at user scope as a shared, implicit-invocation-off skill", () => {
    const base = recipe({
      id: "ecc-port-check",
      framework: "ecc",
      content: { repository: PINS.ecc[0], commit: PINS.ecc[1] },
      routes: { codex: "items" },
      namePrefix: { skill: "ecc-", agent: "ecc-" },
      members: [{ item: "ecc.skill.gan-build", preTicked: true }],
    });
    const plan = planned(
      planRecipe(base, [data("ecc")], [profile("codex")], {}, { scope: "user", source: SOURCE }),
    );
    const link = plan.plan.find((step) => step.op === "link") as
      | { path: string; to: string }
      | undefined;
    expect(link?.path).toBe(".agents/skills/ecc-gan-build");
    const yaml = placements(plan.plan).find(
      (step) => step.op === "write" && step.path.endsWith("/agents/openai.yaml"),
    ) as { path: string; render?: { name: string } } | undefined;
    // The version folder in the shared folder holds Codex's implicit-invocation switch.
    expect(yaml?.path).toBe(`${link?.to}/agents/openai.yaml`);
    expect(yaml?.render?.name).toBe("user-only-file");
    expect(link?.to.startsWith(".aihq/shared/ecc/skill/gan-build/")).toBe(true);
    const upstream = fixture("ecc").map((file) => ({
      sourceId: "ecc",
      sourcePath: file.path,
      bytes: file.bytes as Uint8Array,
    }));
    const render = (path: string) => {
      const step = placements(plan.plan).find(
        (entry) => entry.op === "write" && entry.path === path,
      );
      const result = renderStep(step as PlanStep, [data("ecc")], [profile("codex")], upstream);
      if (result.status !== "ok") throw new Error(JSON.stringify(result));
      return utf8(result.bytes);
    };
    expect(render(`${link?.to}/agents/openai.yaml`)).toContain("allow_implicit_invocation: false");
    const skill = render(`${link?.to}/SKILL.md`);
    expect(skill).not.toContain("$ARGUMENTS");
    expect(skill).toContain("the text the user typed after the command");
    expect(plan.status).toBe("ok");
  });

  it("plans the contract's own example, ECC's plan command on Codex at user scope, as ok", () => {
    // Its file names `agents/planner.md` only as where that agent lives for manual installs.
    const plan = planned(
      planInstall(["ecc.skill.plan"], [data("ecc")], [profile("codex")], {
        scope: "user",
        data: null,
        names: { "ecc.skill.plan": "ecc-plan" },
      }),
    );
    expect(plan).toMatchObject({ status: "ok", references: [], unavailable: [], clashes: [] });
    expect(plan.plan.find((step) => step.op === "link")).toMatchObject({
      path: ".agents/skills/ecc-plan",
    });
  });

  const superpowersRecipe = (routes: Record<string, string>, kiro: string[]) => {
    const superpowers = data("superpowers");
    const entry = {
      source: "superpowers",
      path: "/",
      plugin: "superpowers",
      commit: PINS.superpowers[1],
    };
    const skills = superpowers.items.filter((item) => item.kind === "skill").map((item) => item.id);
    const plugins = {
      // Claude installs through a pinned marketplace the plan writes; Codex names the
      // marketplace's declared name, from its own marketplace.json.
      "claude-code": entry,
      codex: { ...entry, marketplace: PINS.superpowers[0], marketplaceName: "superpowers-dev" },
      copilot: entry,
    };
    return recipe({
      id: "superpowers-port-check",
      framework: "superpowers",
      content: { repository: PINS.superpowers[0], commit: PINS.superpowers[1] },
      routes,
      plugins: Object.fromEntries(
        Object.entries(plugins).filter(([cli]) => routes[cli] === "plugin"),
      ),
      clis: { kiro },
      members: [...skills, "superpowers.rule.session-bootstrap"].map((item) => ({
        item,
        preTicked: true,
      })),
    });
  };

  it("plans Superpowers whole as pinned plugins on Claude, Codex and Copilot and items on Kiro", () => {
    const whole = superpowersRecipe(
      { "claude-code": "plugin", codex: "plugin", copilot: "plugin", kiro: "items" },
      ["skill", "rule"],
    );
    const profiles = ["claude-code", "codex", "copilot", "kiro"].map(profile);
    const plan = planned(
      planRecipe(whole, [data("superpowers")], profiles, {}, { scope: "user", source: SOURCE }),
    );
    expect(
      plan.plan.filter((step) => step.op === "plugin").map((step) => (step as { cli: string }).cli),
    ).toEqual(["claude-code", "codex", "copilot"]);
    expect(
      plan.plan.some((step) => step.op === "link" && step.path === ".kiro/skills/brainstorming"),
    ).toBe(true);
    expect(plan.references.some((reference) => reference.kind === "name")).toBe(true);
    // Kiro reads global steering from ~/.kiro/steering/, so the session-bootstrap rule lands there.
    expect(
      placements(plan.plan).find(
        (step) => step.op === "write" && step.path === ".kiro/steering/session-bootstrap.md",
      ),
    ).toMatchObject({ root: "user", item: "superpowers.rule.session-bootstrap", clis: ["kiro"] });
    expect(plan.unavailable).toEqual([]);
    // Sibling-skill paths resolve only between copies side by side: at user scope a linked
    // folder resolves `..` inside its version folder, so the skills they join are copied in
    // place on Kiro, with a warning, and every other skill stays linked.
    expect(plan.references.filter((reference) => reference.kind === "path")).toEqual([]);
    const copied = plan.warnings.find((warning) => warning.code === "copied-for-references");
    expect(copied).toEqual({
      code: "copied-for-references",
      cli: "kiro",
      items: [
        "superpowers.skill.executing-plans",
        "superpowers.skill.requesting-code-review",
        "superpowers.skill.subagent-driven-development",
        "superpowers.skill.using-superpowers",
        "superpowers.skill.writing-skills",
      ],
    });
    for (const item of copied?.items ?? [])
      expect(
        plan.plan.some((step) => step.op === "link" && step.item === item),
        item,
      ).toBe(false);
    expect(plan.status).toBe("ok");
  });

  it("resolves sibling skill files in place at user scope too when the skills are copied", () => {
    const items = superpowersRecipe({ kiro: "items" }, ["skill", "rule"]);
    const plan = planned(
      planRecipe(
        items,
        [data("superpowers")],
        [profile("kiro")],
        {},
        { scope: "user", source: SOURCE, copy: true },
      ),
    );
    expect(plan.plan.some((step) => step.op === "link")).toBe(false);
    expect(writesAt(plan.plan)).toContain(".kiro/skills/requesting-code-review/code-reviewer.md");
    expect(plan.references.filter((reference) => reference.kind === "path")).toEqual([]);
    expect(plan.status).toBe("ok");
  });

  it("plans Superpowers on Kiro at project scope with sibling skill files resolved in place", () => {
    const items = superpowersRecipe({ kiro: "items" }, ["skill", "rule"]);
    const plan = planned(
      planRecipe(
        items,
        [data("superpowers")],
        [profile("kiro")],
        {},
        { scope: "project", source: SOURCE },
      ),
    );
    expect(writesAt(plan.plan)).toContain(".kiro/skills/requesting-code-review/code-reviewer.md");
    expect(writesAt(plan.plan)).toContain(".kiro/steering/session-bootstrap.md");
    // ../requesting-code-review/code-reviewer.md and the like resolve beside the skills.
    expect(plan.references.filter((reference) => reference.kind === "path")).toEqual([]);
    expect(plan.status).toBe("ok");
  });

  it("plans Extensions items with the references bundle beside the skills, and supplies no route", () => {
    const plan = planned(
      planInstall(
        [
          "extensions.skill.security-and-hardening",
          "extensions.skill.ship",
          "extensions.agent.security-auditor",
          "extensions.skill.engineering.tdd",
        ],
        [data("extensions")],
        [profile("claude-code")],
        { scope: "project", data: null },
      ),
    );
    const paths = writesAt(plan.plan);
    expect(paths).toContain(".claude/references/security-checklist.md");
    expect(paths).toContain(".claude/skills/security-and-hardening/SKILL.md");
    expect(paths).toContain(".claude/skills/tdd/SKILL.md");
    expect(paths.filter((path) => path.startsWith(".aihq/notices/"))).toEqual([
      ".aihq/notices/extensions/LICENSE",
      ".aihq/notices/extensions/NOTICE.md",
      ".aihq/notices/extensions/licenses/addyosmani-agent-skills.LICENSE",
      ".aihq/notices/extensions/licenses/mattpocock-skills.LICENSE",
      ".aihq/notices/extensions/matt/LICENSE",
    ]);
    expect(plan.status).toBe("ok");
    expect(
      REPORT.notPorted.find(
        (entry: { family: string; paths: string[] }) =>
          entry.family === "extensions" && entry.paths.includes("routes"),
      )?.reason,
    ).toMatch(/installation not-declared/);
  });

  it("plans project-basics' shared rules and reports the router reference honestly", () => {
    const content = data("project-basics");
    const shared = planned(
      planInstall(
        ["project-basics.rule.shared-block"],
        [content],
        [profile("claude-code"), profile("codex")],
        {
          scope: "project",
          data: null,
        },
      ),
    );
    expect(shared.status).toBe("ok");
    expect(
      placements(shared.plan).map((step) => [
        step.op,
        (step as { path?: string; file?: string }).path ?? (step as { file?: string }).file,
      ]),
    ).toEqual([
      ["write", ".claude/rules/shared-block.md"],
      ["merge", "AGENTS.md"],
    ]);
    const core = planned(
      planInstall(
        ["project-basics.rule.agent-behavior-core"],
        [content],
        [profile("claude-code")],
        {
          scope: "project",
          data: null,
        },
      ),
    );
    expect(core.references).toEqual([
      expect.objectContaining({ kind: "path", path: "RULE_ROUTER.md" }),
    ]);
    expect(core.status).toBe("incomplete");
  });
});

describe("the port report for these families", () => {
  const entries = REPORT.dispositions as {
    baseline: { id: string; kind: string };
    disposition: string;
    item?: string;
    edition?: string;
    reason?: string;
    bundle?: string;
    note?: string;
  }[];

  it("gives each of the 777 measured baseline items exactly one disposition", () => {
    expect(entries).toHaveLength(777);
    expect(new Set(entries.map((entry) => entry.baseline.id)).size).toBe(777);
    // The measured baseline (contract §13): 392 skills, 147 rules, 96 commands, 72 agents,
    // 37 MCP servers, 28 hooks and 5 documents.
    expect(REPORT.baseline.byKind).toEqual({
      agent: 72,
      command: 96,
      document: 5,
      hook: 28,
      "mcp-server": 37,
      rule: 147,
      skill: 392,
    });
    const ids = new Set(FAMILIES.flatMap((family) => data(family).items.map((item) => item.id)));
    for (const entry of entries)
      if (entry.disposition === "mapped")
        expect(ids.has(entry.item as string), entry.baseline.id).toBe(true);
    expect(REPORT.counts).toMatchObject({
      mapped: 687,
      edition: 43,
      steering: 22,
      notice: 3,
      bundle: 1,
      dropped: 21,
    });
  });

  it("names the intended drops and the folded, edition and bundle dispositions", () => {
    const of = (id: string) => entries.find((entry) => entry.baseline.id === id);
    const shadowed = entries.filter((entry) => entry.reason === "command-shadowed-by-skill");
    expect(shadowed).toHaveLength(9);
    expect(of("ecc.rule.README")).toMatchObject({ disposition: "dropped", reason: "not-an-item" });
    expect(of("ecc.command.plan")).toMatchObject({ disposition: "mapped", item: "ecc.skill.plan" });
    expect(of("ecc.skill.api-design.kiro-variant")).toMatchObject({
      disposition: "mapped",
      item: "ecc.skill.api-design",
      edition: "kiro",
    });
    expect(of("ecc.steering.python-patterns")).toMatchObject({
      item: "ecc.rule.steering.python-patterns",
      edition: "kiro",
    });
    expect(of("ecc.notices")).toMatchObject({ disposition: "notice" });
    expect(of("extensions.references")).toMatchObject({
      disposition: "bundle",
      bundle: "extensions.references",
    });
    expect(of("extensions.matt.tdd")).toMatchObject({ item: "extensions.skill.engineering.tdd" });
    expect(of("extensions.command.ship")).toMatchObject({ item: "extensions.skill.ship" });
    expect(of("project-basics.working-rules")).toMatchObject({
      item: "project-basics.rule.agent-behavior-core",
    });
    expect(of("ecc.mcp.github-local")).toMatchObject({
      disposition: "dropped",
      reason: "catalog-variant",
    });
    expect(
      entries
        .filter((entry) => entry.reason === "mcp-not-representable")
        .map((entry) => entry.baseline.id),
    ).toEqual([
      "ecc.mcp.ecc-memory-vault",
      "ecc.mcp.evalview",
      "ecc.mcp.ito-compute",
      "ecc.mcp.longhand",
      "ecc.mcp.nexus",
    ]);
    // An entry whose upstream package npm marks deprecated is not represented, and no
    // replacement package is put in its place.
    const deprecated = entries.filter((entry) => entry.reason === "mcp-package-deprecated");
    expect(deprecated.map((entry) => entry.baseline.id)).toEqual([
      "ecc.mcp.browserbase",
      "ecc.mcp.github",
      "ecc.mcp.railway",
      "ecc.mcp.token-optimizer",
    ]);
    expect(of("ecc.mcp.github")?.note).toMatch(
      /@modelcontextprotocol\/server-github.*Package no longer supported/,
    );
    expect(of("ecc.mcp.token-optimizer")?.note).toMatch(
      /token-optimizer-mcp.*Package no longer supported/,
    );
    expect(of("ecc.mcp.browserbase")?.note).toMatch(/moved to @browserbasehq\/mcp/);
    expect(of("ecc.mcp.railway")?.note).toMatch(/bundled into the Railway CLI/);
    for (const entry of deprecated) expect(entry.item, entry.baseline.id).toBeUndefined();
    const ids = new Set(data("ecc").items.map((item) => item.id));
    for (const name of ["browserbase", "github", "railway", "token-optimizer"])
      expect(ids.has(`ecc.mcp.${name}`), name).toBe(false);
  });

  it("records, per MCP item, where its exact version came from", () => {
    const entries = REPORT.dispositions as Array<Record<string, unknown> & { item?: string }>;
    const pins = Object.fromEntries(
      entries
        .filter((entry) => entry.item?.startsWith("ecc.mcp.") && entry.disposition === "mapped")
        .map((entry) => [
          entry.item,
          {
            pinBasis: entry.pinBasis,
            pinnedVersion: entry.pinnedVersion,
          },
        ]),
    );
    // The version the previous Catalog release reviewed for the same package.
    expect(pins["ecc.mcp.context7"]).toEqual({
      pinBasis: "previous-release-review",
      pinnedVersion: "4.4.4",
    });
    // The upstream's own exact version.
    expect(pins["ecc.mcp.jira"]).toEqual({
      pinBasis: "upstream",
      pinnedVersion: "0.21.0",
    });
    // A remote server has no package to pin.
    expect(pins["ecc.mcp.vercel"]).toEqual({
      pinBasis: undefined,
      pinnedVersion: undefined,
    });
    // Every packaged MCP item says where its version came from.
    for (const item of data("ecc").items.filter((entry) => entry.kind === "mcp")) {
      const packages = (item.server as { packages?: Array<{ version: string }> }).packages ?? [];
      if (packages.length > 0)
        expect(pins[item.id]?.pinnedVersion, item.id).toBe(packages[0]?.version);
    }
  });
});
