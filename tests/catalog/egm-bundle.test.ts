import { describe, expect, it } from "vitest";
import { checkContent } from "../../src/catalog/producer.js";
import { type Plan, type PlanStep, planInstall, renderStep } from "../../src/catalog/reader.js";
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
} from "./egm.js";
import { placements, profile, sha, utf8 } from "./helpers.js";

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
