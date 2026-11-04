import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readLocalSource } from "../../src/catalog/node.js";
import { checkContent } from "../../src/catalog/producer.js";
import {
  type Content,
  type Plan,
  type PlanResult,
  type PlanStep,
  planInstall,
  planRecipe,
  readContent,
  readRecipe,
} from "../../src/catalog/reader.js";
import type { SourceFile } from "../../src/catalog/source.js";
import { EGM_UPSTREAM, egmContent } from "./egm.js";
import { fetches, placements, profile, sha, sortKeys } from "./helpers.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const FAMILIES = ["anthropic", "egm", "gstack", "guide", "pstack", "web-artifacts"] as const;
const FIXTURE = join(repositoryRoot, "tests/fixtures/port-remaining");
const UPSTREAM = JSON.parse(
  readFileSync(join(repositoryRoot, "tests/fixtures/port-remaining.upstream.json"), "utf8"),
) as Record<
  string,
  {
    repository: string;
    commit: string;
    subpath?: string;
    entries: { path: string; mode: string; blob: string }[];
  }
>;
/**
 * The sha256 of the upstream's "all rights reserved" notice of its document skills, as read at
 * the pin. Its text is restricted, so no copy is kept here; only this identity is checked.
 */
const RESERVED_NOTICE = "79f6d8f5b427252fa3b1c11ecdbdb6bf610b944f7530b4de78f770f38741cfaa";
const REPORT = JSON.parse(readFileSync(join(repositoryRoot, "port-report/remaining.json"), "utf8"));
const MAINTAINED = JSON.parse(
  readFileSync(join(repositoryRoot, "port-report/maintained.json"), "utf8"),
);

/** The exact pins the port records; written out here, independently of the port tool. */
const PINS = {
  anthropic: ["https://github.com/anthropics/skills", "34040c9c568585f6929bedeaad110ad08f079624"],
  "shadcn-notice": ["https://github.com/shadcn-ui/ui", "f3d14c48cbad1b6a3b3c9c81db9f198a4188f712"],
  guide: [
    "https://github.com/samartomar/aih-extensions",
    "2481164a51ea7f9e480d51ef52f3d5cf15b017fa",
  ],
  pstack: ["https://github.com/cursor/plugins", "ae5650febf4320793844c12c4adaa937f417f8da"],
  "pstack-claude": [
    "https://github.com/cursor/plugins",
    "ae5650febf4320793844c12c4adaa937f417f8da",
  ],
  gstack: ["https://github.com/garrytan/gstack", "1ea86923a86129d1f32828b36acfe6f91f17c8e6"],
  egm: [
    "https://github.com/google/elephant-goldfish-model",
    "403d8881d62022490637d740657b33f01e321ea8",
  ],
} as const;

function data(family: string): Content {
  const read = readContent(readFileSync(join(repositoryRoot, "data", family, "content.json")));
  if (read.status !== "ok") throw new Error(`${family}: ${JSON.stringify(read).slice(0, 500)}`);
  return read.content;
}

function filesIn(folder: string, sourceId: string): SourceFile[] {
  const read = readLocalSource(folder);
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  return read.files.map((file) => ({ ...file, sourceId }));
}
const fixture = (name: string, sourceId: string = name) => filesIn(join(FIXTURE, name), sourceId);

/** The content with only these items (and no plugin record), for checks over a byte subset. */
function subset(content: Content, ids: readonly string[]): Content {
  const items = content.items.filter((item) => ids.includes(item.id));
  expect(items.map((item) => item.id).sort()).toEqual([...ids].sort());
  const { plugins: _plugins, ...rest } = content;
  return { ...rest, items };
}

function planned(result: PlanResult): Plan {
  if (result.status !== "ok" && result.status !== "incomplete")
    throw new Error(JSON.stringify(result).slice(0, 2000));
  return result as Plan;
}
const pathsOf = (plan: readonly PlanStep[], op: string) =>
  plan.filter((step) => step.op === op).map((step) => (step as { path: string }).path);
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
/** One of the report's draft base recipes, completed with a data commit. */
function draft(id: string) {
  const read = readRecipe(
    encode(PLUGIN),
    encode({ schema: "urn:aihq:catalog:recipe:0.1.0", data: DATA, ...REPORT.recipes[id] }),
  );
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  return read.recipe;
}
const plan = (id: string, clis: string[], scope: "project" | "user" = "project") =>
  planned(
    planRecipe(
      draft(id),
      [data(REPORT.recipes[id].framework)],
      clis.map((cli) => profile(cli)),
      {},
      { scope, source: SOURCE },
    ),
  );

describe("the remaining-port fixture", () => {
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
        const blob = execFileSync("git", ["hash-object", "--no-filters", path], {
          encoding: "utf8",
        }).trim();
        expect(blob, entry.path).toBe(entry.blob);
        expect((statSync(path).mode & 0o111) !== 0, entry.path).toBe(entry.mode === "100755");
      }
    }
    expect(UPSTREAM.pstack?.subpath).toBe("pstack");
    expect(UPSTREAM["pstack-claude"]?.subpath).toBe("harness/pstack/claude-code");
  });
});

describe("the ported candidate data", () => {
  it("reads canonically and pins every source at its exact commit", async () => {
    const sources = Object.fromEntries(
      FAMILIES.map((family) => [
        family,
        data(family).sources.map(({ id, kind, repository, commit, subpath, noticesFor }) => ({
          id,
          kind,
          ...(repository ? { repository, commit } : {}),
          ...(subpath ? { subpath } : {}),
          ...(noticesFor ? { noticesFor } : {}),
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
      anthropic: [
        git("anthropic"),
        { ...git("shadcn-notice"), noticesFor: ["anthropic.skill.web-artifacts-builder"] },
      ],
      egm: [git("egm")],
      gstack: [git("gstack")],
      guide: [git("guide")],
      pstack: [
        { ...git("pstack"), subpath: "pstack" },
        { ...git("pstack-claude"), subpath: "harness/pstack/claude-code" },
      ],
      "web-artifacts": [{ id: "web-artifacts", kind: "authored" }],
    });
    for (const family of FAMILIES)
      expect(await checkContent(data(family)), family).toMatchObject({ status: "ok" });
  });

  it("checks representative items byte for byte against the pinned upstream files", async () => {
    const cases: [string, string[], SourceFile[]][] = [
      [
        "anthropic",
        ["anthropic.skill.webapp-testing", "anthropic.skill.web-artifacts-builder"],
        fixture("anthropic"),
      ],
      ["guide", ["guide.agent.aih-guide", "guide.document.manual"], fixture("guide")],
      [
        "pstack",
        ["pstack.skill.arena", "pstack.agent.comment-sicko"],
        [...fixture("pstack"), ...fixture("pstack-claude")],
      ],
      ["gstack", ["gstack.skill.guard"], fixture("gstack")],
      [
        "web-artifacts",
        ["web-artifacts.skill.web-artifacts-builder"],
        filesIn(join(repositoryRoot, "data/web-artifacts/authored/web-artifacts"), "web-artifacts"),
      ],
    ];
    for (const [family, ids, files] of cases) {
      const result = await checkContent(subset(data(family), ids), files);
      expect(result, family).toMatchObject({ status: "ok" });
    }
    // Notices are the pinned licence and notice files, by sha256, each covering its folder.
    const notices = (family: string, source: string) =>
      data(family).sources.find((entry) => entry.id === source)?.notices ?? [];
    const shaOf = (name: string, path: string) => sha(readFileSync(join(FIXTURE, name, path)));
    expect(notices("anthropic", "anthropic")).toContainEqual({
      sourcePath: "THIRD_PARTY_NOTICES.md",
      sha256: shaOf("anthropic", "THIRD_PARTY_NOTICES.md"),
      covers: "/",
    });
    // The document skills' notices reserve all rights: only their recorded identity is kept,
    // never their text (the plan fetches them with the skills).
    for (const name of ["docx", "pdf", "pptx", "xlsx"])
      expect(notices("anthropic", "anthropic")).toContainEqual({
        sourcePath: `skills/${name}/LICENSE.txt`,
        sha256: RESERVED_NOTICE,
        covers: `skills/${name}`,
      });
    // Each skill's LICENSE.txt (claude-api's too, though it is no item) and the root notices.
    expect(notices("anthropic", "anthropic")).toHaveLength(19);
    expect(notices("anthropic", "shadcn-notice")).toEqual([
      { sourcePath: "LICENSE.md", sha256: shaOf("shadcn-notice", "LICENSE.md"), covers: "/" },
    ]);
    expect(notices("gstack", "gstack").map((notice) => notice.sourcePath)).toEqual(
      UPSTREAM.gstack?.entries
        .map((entry) => entry.path)
        .filter((path) => !path.startsWith("guard/")),
    );
    expect(notices("guide", "guide")).toEqual([
      { sourcePath: "LICENSE", sha256: shaOf("guide", "LICENSE"), covers: "/" },
    ]);
    expect(notices("pstack", "pstack-claude")).toEqual([]);
  });

  it("records EGM exactly as its pinned runtime fixture builds it", async () => {
    const { content } = await egmContent();
    const recorded = data("egm");
    // The fixture holds the runtime files only. What the real data adds is the whole upstream
    // tree: the plugin folder's own key, which is the commit's root tree, and the notice of the
    // upstream's generated distributions/ copy, which covers no item.
    const [plugin] = recorded.plugins ?? [];
    expect(plugin?.folderScanKey).toBe(`git-sha1:${EGM_UPSTREAM.tree}`);
    const [source] = recorded.sources;
    expect(source?.notices.map((notice) => notice.sourcePath)).toContain(
      "distributions/claude/LICENSE",
    );
    const trimmed = {
      ...recorded,
      sources: recorded.sources.map((each) => ({
        ...each,
        notices: each.notices.filter(
          (notice) => !notice.sourcePath.startsWith("distributions/"),
        ),
      })),
      plugins: (recorded.plugins ?? []).map(({ folderScanKey: _, ...rest }) => rest),
    };
    expect(trimmed).toEqual({
      ...content,
      plugins: (content.plugins ?? []).map(({ folderScanKey: _, ...rest }) => rest),
    });
  });

  it("records the upstream-only skills without shipping their bytes, and their Claude copies as editions", () => {
    const anthropic = data("anthropic");
    const upstreamOnly = anthropic.items.filter((item) => item.fetch === "upstream");
    expect(upstreamOnly.map((item) => item.id)).toEqual([
      "anthropic.skill.doc-coauthoring",
      "anthropic.skill.docx",
      "anthropic.skill.pdf",
      "anthropic.skill.pptx",
      "anthropic.skill.xlsx",
    ]);
    // claude-api's own description is over the 1024-character limit; template/ is the skeleton.
    expect(anthropic.items.map((item) => item.id)).not.toContain("anthropic.skill.claude-api");
    expect(anthropic.items.map((item) => item.id)).not.toContain("anthropic.skill.template");
    expect(anthropic.plugins?.map((record) => record.plugin)).toEqual([
      "academy-guide",
      "claude-api",
      "discernment-nudge",
      "document-skills",
      "example-skills",
    ]);
    const pstack = data("pstack");
    expect(pstack.items).toHaveLength(60);
    for (const item of pstack.items)
      expect(
        item.editions?.["claude-code"]?.files.every((file) => file.sourceId === "pstack-claude"),
        item.id,
      ).toBe(true);
    expect(pstack.items.find((item) => item.id === "pstack.skill.poteto-help")?.references).toEqual(
      [{ name: "pstack:poteto-mode", sourcePath: "skills/poteto-help/SKILL.md" }],
    );
    expect(data("gstack").items).toHaveLength(62);
  });
});

describe("representative plans of the remaining families", () => {
  it("installs Anthropic's example skills as Claude's pinned plugin and as items elsewhere", () => {
    const result = plan("anthropic-base", ["claude-code", "codex", "kiro"]);
    expect(result).toMatchObject({ status: "ok", clashes: [], references: [] });
    const anthropic = data("anthropic");
    const record = anthropic.plugins?.find((entry) => entry.plugin === "example-skills");
    expect(result.plan.filter((step) => step.op === "plugin")).toEqual([
      expect.objectContaining({
        cli: "claude-code",
        plugin: "example-skills",
        marketplace: PINS.anthropic[0],
        commit: PINS.anthropic[1],
        // Claude clones the whole marketplace folder, not the plugin's skill list.
        scanKey: record?.folderScanKey,
      }),
    ]);
    const writes = pathsOf(result.plan, "write");
    expect(writes.filter((path) => path.startsWith(".claude/"))).toEqual([]);
    expect(writes).toContain(".agents/skills/webapp-testing/SKILL.md");
    expect(writes).toContain(".aihq/notices/anthropic/THIRD_PARTY_NOTICES.md");
    expect(writes).toContain(".aihq/notices/anthropic/shadcn-notice/LICENSE.md");
    // Codex already provides skill-creator: the recipe offers it unticked, never forced.
    expect(writes).not.toContain(".agents/skills/skill-creator/SKILL.md");
    // doc-coauthoring is upstream-only: fetched on Codex, a rendered write on Kiro.
    expect(fetches(result.plan).map((step) => step.path)).toEqual([
      ".agents/skills/doc-coauthoring/SKILL.md",
    ]);
    expect(
      placements(result.plan).find(
        (step) => step.op === "write" && step.path === ".kiro/skills/doc-coauthoring/SKILL.md",
      ),
    ).toMatchObject({ render: { name: "skill" }, scanned: false });
  });

  it("fetches the document skills from their pin wherever Catalog places them", () => {
    const result = plan("anthropic-document-skills", ["claude-code", "codex"]);
    expect(result).toMatchObject({ status: "ok", clashes: [], unavailable: [] });
    const fetched = fetches(result.plan);
    expect(placements(result.plan)).toEqual([]);
    expect(fetched.length).toBeGreaterThan(100);
    expect(fetched.every((step) => step.scanned === false && step.clis.includes("codex"))).toBe(
      true,
    );
    expect(
      fetched.find((step) => step.path === ".aihq/notices/anthropic/skills/docx/LICENSE.txt"),
    ).toEqual({
      op: "fetch",
      root: "project",
      path: ".aihq/notices/anthropic/skills/docx/LICENSE.txt",
      source: "anthropic",
      sourcePath: "skills/docx/LICENSE.txt",
      sha256: RESERVED_NOTICE,
      executable: false,
      items: ["anthropic.skill.docx"],
      clis: ["codex"],
      scanned: false,
    });
    expect(result.plan.find((step) => step.op === "plugin")).toMatchObject({
      plugin: "document-skills",
    });
  });

  it("gives gstack's Codex install one approval-requiring upstream setup", () => {
    const result = plan("gstack-base", ["codex"]);
    expect(result).toMatchObject({ status: "ok", references: [], warnings: [] });
    expect(result.plan).toEqual([
      {
        op: "upstream-setup",
        cli: "codex",
        framework: "gstack",
        root: "project",
        repository: PINS.gstack[0],
        commit: PINS.gstack[1],
        into: ".aihq/setup/gstack",
        command: ["./setup", "--host", "codex"],
        needs: ["bun>=1.4.2"],
        scanned: false,
        approval: "required",
      },
    ]);
  });

  it("places gstack's skills as prefixed items on Kimi, incomplete while they name its built tools", () => {
    const result = plan("gstack-base", ["kimi"]);
    expect(result.status).toBe("incomplete");
    expect(pathsOf(result.plan, "write")).toContain(".agents/skills/gstack-guard/SKILL.md");
    const paths = result.references.filter((reference) => reference.kind === "path");
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((reference) => reference.path.startsWith("bin/gstack-"))).toBe(true);
    expect(paths.map((reference) => reference.item)).not.toContain("gstack.skill.guard");
  });

  it("gives pstack its Claude copy as Claude's edition, prefixed, with the namespaced name a warning", () => {
    const result = planned(
      planRecipe(
        draft("pstack-base"),
        [data("pstack")],
        [profile("claude-code"), profile("codex")],
        {},
        { scope: "project", source: SOURCE },
      ),
    );
    const arena = (path: string) =>
      placements(result.plan).find((step) => step.op === "write" && step.path === path);
    expect(arena(".claude/skills/pstack-arena/SKILL.md")).toMatchObject({
      from: { sourceId: "pstack-claude", sourcePath: "skills/arena/SKILL.md" },
    });
    expect(arena(".agents/skills/pstack-arena/SKILL.md")).toMatchObject({
      from: { sourceId: "pstack", sourcePath: "skills/arena/SKILL.md" },
    });
    expect(result.references.filter((reference) => reference.kind === "name")).toEqual([
      expect.objectContaining({
        item: "pstack.skill.poteto-help",
        name: "pstack:poteto-mode",
        means: "pstack.skill.poteto-mode",
      }),
    ]);
    // The prefix moves siblings away from the relative links pstack's skills use between them.
    expect(result.status).toBe("incomplete");
    expect(result.references).toContainEqual(
      expect.objectContaining({
        kind: "path",
        item: "pstack.skill.principle-attack-the-premise",
        path: "skills/principle-build-the-lever/SKILL.md",
      }),
    );
  });

  it("keeps EGM's real runtime bundle whole for Claude, Codex and Antigravity", () => {
    const result = plan("egm-base", ["claude-code", "codex", "antigravity"]);
    expect(result).toMatchObject({
      status: "ok",
      missing: [],
      unavailable: [],
      clashes: [],
      references: [],
    });
    const writes = pathsOf(result.plan, "write");
    expect(writes).toContain(".aihq/plugins/egm/.claude-plugin/marketplace.json");
    expect(writes).toContain(".agents/skills/egm-review/SKILL.md");
    expect(writes).toContain(".agents/resources/execution_instructions.md");
  });

  it("plans the AIH Guide agent from its client editions, the manual optional with no document place", () => {
    const result = plan("guide-base", ["claude-code", "kimi", "opencode"]);
    expect(result).toMatchObject({ status: "ok", unavailable: [] });
    const from = (path: string) =>
      (
        placements(result.plan).find((step) => step.op === "write" && step.path === path) as {
          from?: { sourcePath: string };
        }
      )?.from?.sourcePath;
    expect(from(".claude/agents/aih-guide.md")).toBe("guide/generated/claude/aih-guide.md");
    expect(from(".agents/agents/aih-guide.md")).toBe("guide/generated/kimi/aih-guide.md");
    expect(from(".opencode/agents/aih-guide.md")).toBe("guide/generated/opencode/aih-guide.md");
    const manual = planned(
      planInstall(["guide.document.manual"], [data("guide")], [profile("claude-code")], {
        scope: "project",
        data: null,
      }),
    );
    expect(manual.unavailable).toEqual([
      expect.objectContaining({ item: "guide.document.manual", reason: "not-described" }),
    ]);
  });

  it("plans Catalog's web-artifacts skill from its authored files with its licence once", () => {
    const result = planned(
      planInstall(
        ["web-artifacts.skill.web-artifacts-builder"],
        [data("web-artifacts")],
        [profile("claude-code"), profile("codex")],
        { scope: "project", data: DATA },
      ),
    );
    expect(result).toMatchObject({ status: "ok", clashes: [], references: [] });
    const writes = pathsOf(result.plan, "write");
    expect(writes).toContain(".claude/skills/web-artifacts-builder-modern/template/build.mjs");
    expect(writes).toContain(
      ".aihq/notices/web-artifacts/skills/web-artifacts-builder/LICENSE.txt",
    );
  });
});

describe("the remaining-port report", () => {
  it("disposes every earlier item of these families once, outside the measured baseline", () => {
    const earlier = REPORT.dispositions.map(
      (entry: { earlier: { id: string } }) => entry.earlier.id,
    );
    expect(new Set(earlier).size).toBe(earlier.length);
    expect(earlier).toHaveLength(96);
    const baseline = new Set(
      MAINTAINED.dispositions.map((entry: { baseline: { id: string } }) => entry.baseline.id),
    );
    expect(earlier.filter((id: string) => baseline.has(id))).toEqual([]);
    expect(REPORT.counts).toMatchObject({
      earlierItems: 96,
      mapped: 69,
      split: 2,
      notice: 3,
      dropped: 22,
      upstreamOnly: 5,
      contentItems: 159,
    });
    const byId = new Map(
      REPORT.dispositions.map((entry: { earlier: { id: string } }) => [entry.earlier.id, entry]),
    );
    expect(byId.get("anthropic.kiro.skill.claude-api")).toMatchObject({
      disposition: "dropped",
      reason: "unrepresentable-description",
    });
    expect(byId.get("anthropic.skill.docx")).toBeUndefined();
    expect(byId.get("anthropic.copilot.skill.webapp-testing")).toMatchObject({
      disposition: "mapped",
      item: "anthropic.skill.webapp-testing",
    });
    expect(byId.get("aihq.project-context")).toMatchObject({
      disposition: "split",
      items: [
        "project-basics.document.rule-router",
        "project-basics.rule.agent-behavior-core",
        "project-basics.rule.shared-block",
      ],
    });
    expect(byId.get("mattpocock.tdd")).toMatchObject({
      disposition: "mapped",
      item: "extensions.skill.engineering.tdd",
    });
    // The upstream-only items are new: none was in an earlier release.
    expect(
      REPORT.added.filter((entry: { fetch?: string }) => entry.fetch === "upstream"),
    ).toHaveLength(5);
  });
});
