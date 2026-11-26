import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
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
import { type EGM_UPSTREAM, egmContent } from "./egm.js";
import { fetches, placements, profile, sha, sortKeys } from "./helpers.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const FAMILIES = ["anthropic", "egm", "gstack", "guide", "pstack", "web-artifacts"] as const;
const FIXTURE = join(repositoryRoot, "tests/fixtures/port-remaining");
const ACTIVE_EGM_ROOT = join(repositoryRoot, "tests/fixtures/egm-46933754");
const ACTIVE_EGM = JSON.parse(
  readFileSync(`${ACTIVE_EGM_ROOT}.upstream.json`, "utf8"),
) as typeof EGM_UPSTREAM;
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
/** SHA-256 of the Apache-2.0 notice shared by the four document skill folders at this pin. */
const DOCUMENT_SKILLS_NOTICE = "58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd";
const REPORT = JSON.parse(readFileSync(join(repositoryRoot, "port-report/remaining.json"), "utf8"));
const MAINTAINED = JSON.parse(
  readFileSync(join(repositoryRoot, "port-report/maintained.json"), "utf8"),
);

/** The exact pins the port records; written out here, independently of the port tool. */
const PINS = {
  anthropic: ["https://github.com/anthropics/skills", "e4bb5d960d87126ff3b3a8af1a104b7db67560ba"],
  "shadcn-notice": ["https://github.com/shadcn-ui/ui", "0e5b2e621a9ee4cf6a604bbe6c5c0d5b70561eb4"],
  guide: [
    "https://github.com/samartomar/aih-extensions",
    "c89adaad320d679c905e7122b908c1bc9c8c1904",
  ],
  pstack: ["https://github.com/cursor/plugins", "b1fbf4b60ac6813b4583ccc356850dafcf492665"],
  "pstack-claude": [
    "https://github.com/cursor/plugins",
    "b1fbf4b60ac6813b4583ccc356850dafcf492665",
  ],
  gstack: ["https://github.com/garrytan/gstack", "e6dd567349e85506127c2f4cf69a0392923c032c"],
  egm: [
    "https://github.com/google/elephant-goldfish-model",
    "46933754e63c0424daa9c270d7e0734245d79560",
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
        .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"))
        .sort();
      expect(present).toEqual(upstream.entries.map((entry) => entry.path));
      for (const entry of upstream.entries) {
        const path = join(root, entry.path);
        const blob = execFileSync("git", ["hash-object", "--no-filters", path], {
          encoding: "utf8",
        }).trim();
        expect(blob, entry.path).toBe(entry.blob);
        const tracked = execFileSync("git", ["ls-files", "--stage", "--", path], {
          cwd: repositoryRoot,
          encoding: "utf8",
        });
        expect(tracked.split(" ")[0], entry.path).toBe(entry.mode);
        if (process.platform !== "win32")
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
    // All four document skills now carry an Apache-2.0 notice at the selected source.
    for (const name of ["docx", "pdf", "pptx", "xlsx"])
      expect(notices("anthropic", "anthropic")).toContainEqual({
        sourcePath: `skills/${name}/LICENSE.txt`,
        sha256: DOCUMENT_SKILLS_NOTICE,
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
    expect(ACTIVE_EGM).toMatchObject({ repository: PINS.egm[0], commit: PINS.egm[1] });
    const { content } = await egmContent({
      root: ACTIVE_EGM_ROOT,
      source: { kind: "git", repository: PINS.egm[0], commit: PINS.egm[1] },
    });
    const recorded = data("egm");
    // The real declaration additionally binds the full upstream Git tree, which the fixture
    // does not materialize. The shipped-file scan keys and source notices must still agree.
    const [plugin] = recorded.plugins ?? [];
    expect(plugin?.folderScanKey).toBe(`git-sha1:${ACTIVE_EGM.tree}`);
    const fixtureOnly = ({ plugins, ...rest }: Content) => ({
      ...rest,
      plugins: (plugins ?? []).map(({ folderScanKey: _, ...entry }) => entry),
    });
    expect(fixtureOnly(recorded)).toEqual(fixtureOnly(content));
  });

  it("records the upstream-only skills without shipping their bytes, and their Claude copies as editions", () => {
    const anthropic = data("anthropic");
    const upstreamOnly = anthropic.items.filter((item) => item.fetch === "upstream");
    expect(upstreamOnly.map((item) => item.id)).toEqual(["anthropic.skill.doc-coauthoring"]);
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
    expect(pstack.items).toHaveLength(61);
    for (const item of pstack.items)
      expect(
        item.editions?.["claude-code"]?.files.every((file) => file.sourceId === "pstack-claude"),
        item.id,
      ).toBe(true);
    expect(pstack.items.find((item) => item.id === "pstack.skill.poteto-help")?.references).toEqual(
      [{ name: "pstack:poteto-mode", sourcePath: "skills/poteto-help/SKILL.md" }],
    );
    expect(data("gstack").items).toHaveLength(61);
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
        marketplace: { root: "project", path: ".aihq/marketplaces/claude-code/anthropic" },
        marketplaceName: "aihq-anthropic",
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

  it("places each licensed document skill on Codex and registers the pinned Claude plugin", () => {
    const result = plan("anthropic-document-skills", ["claude-code", "codex"]);
    expect(result).toMatchObject({ status: "ok", clashes: [], unavailable: [] });
    expect(fetches(result.plan)).toEqual([]);
    expect(pathsOf(result.plan, "write")).toContain(
      ".aihq/marketplaces/claude-code/anthropic/.claude-plugin/marketplace.json",
    );
    for (const name of ["docx", "pdf", "pptx", "xlsx"]) {
      expect(result.plan).toContainEqual(
        expect.objectContaining({ op: "write", path: `.agents/skills/${name}/SKILL.md` }),
      );
      expect(result.plan).toContainEqual(
        expect.objectContaining({
          op: "write",
          path: `.aihq/notices/anthropic/skills/${name}/LICENSE.txt`,
          from: expect.objectContaining({ sha256: DOCUMENT_SKILLS_NOTICE }),
        }),
      );
    }
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

  it("gives pstack its Claude copy as Claude's edition, unprefixed, with the namespaced name a warning", () => {
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
    expect(arena(".claude/skills/arena/SKILL.md")).toMatchObject({
      from: { sourceId: "pstack-claude", sourcePath: "skills/arena/SKILL.md" },
    });
    expect(arena(".agents/skills/arena/SKILL.md")).toMatchObject({
      from: { sourceId: "pstack", sourcePath: "skills/arena/SKILL.md" },
    });
    expect(result.references.filter((reference) => reference.kind === "name")).toEqual([
      expect.objectContaining({
        item: "pstack.skill.poteto-help",
        name: "pstack:poteto-mode",
        means: "pstack.skill.poteto-mode",
      }),
    ]);
    // Without a prefix the skills keep their upstream names, so the relative links between
    // sibling skills resolve where they are copied side by side.
    expect(
      result.references.filter(
        (reference) =>
          reference.kind === "path" &&
          reference.item.startsWith("pstack.skill.") &&
          reference.path.startsWith("skills/"),
      ),
    ).toEqual([]);
    // What is left is an agent's prose naming a skill's path ("a file whose path ends in"),
    // which no folder layout of Codex's agent file can satisfy.
    expect(
      result.references.filter(
        (reference) => reference.kind === "path" && reference.path.startsWith("skills/"),
      ),
    ).toEqual([expect.objectContaining({ item: "pstack.agent.poteto-agent", clis: ["codex"] })]);
  });

  it("places EGM's packed runtime and reports the optional project index as unresolved for copies", () => {
    const result = plan("egm-base", ["claude-code", "codex", "antigravity"]);
    expect(result).toMatchObject({
      status: "incomplete",
      missing: [],
      unavailable: [],
      clashes: [],
      references: [
        {
          clis: ["antigravity", "codex"],
          file: "skills/egm-brainstorm/SKILL.md",
          item: "egm.skill.egm-brainstorm",
          kind: "path",
          path: "docs/designs/README.md",
        },
      ],
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
      upstreamOnly: 1,
      contentItems: 161,
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
    expect(REPORT.added.filter((entry: { fetch?: string }) => entry.fetch === "upstream")).toEqual([
      expect.objectContaining({
        fetch: "upstream",
        item: "anthropic.skill.doc-coauthoring",
      }),
    ]);
  });
});
