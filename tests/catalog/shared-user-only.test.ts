import { describe, expect, it } from "vitest";
import {
  type LinkStep,
  type Plan,
  type PlanStep,
  planInstall,
  readToolProfile,
  renderStep,
  type ToolProfile,
  type WriteStep,
} from "../../src/catalog/reader.js";
import {
  FRAMEWORK,
  folder,
  ownContent,
  placements,
  profile,
  sha,
  sortKeys,
  utf8,
} from "./helpers.js";

// An ECC-style command (a user-only skill by convention) and a skill flagged user-only.
const PLAN = "---\ndescription: Plan the next change.\n---\nWrite a plan for the change.\n";
const REVIEW = [
  "---",
  "name: revise",
  "description: Review the staged change.",
  "disable-model-invocation: true",
  "---",
  "Review it.",
  "",
].join("\n");
const DEPLOY = "---\ndescription: Deploy the branch.\n---\nDeploy $ARGUMENTS now.\n";
const TREE = {
  LICENSE: "MIT\n",
  "commands/release.md": PLAN,
  "commands/deploy.md": DEPLOY,
  "skills/revise/SKILL.md": REVIEW,
  "skills/revise/references/checklist.md": "Check it.\n",
  "skills/notes/SKILL.md": "---\nname: notes\ndescription: Take notes.\n---\nNote it.\n",
};

const id = (path: string) => `${FRAMEWORK}.skill.${path}`;
const short = (value: string) => value.replace(`${FRAMEWORK}.`, "");
const ids = (render: NonNullable<WriteStep["render"]>) =>
  "profiles" in render
    ? render.profiles.map((entry) => entry.id).join("+")
    : "profile" in render
      ? render.profile
      : "";

function rows(plan: readonly PlanStep[]): string[] {
  return placements(plan).map((step) => {
    if (step.op === "link")
      return `link ${step.path} -> ${step.to} ${short(step.item)} [${step.clis.join(",")}]`;
    const owner = step.item ? short(step.item) : `(${(step.items ?? []).length} items)`;
    const render = step.render ? ` ${step.render.name}@${ids(step.render)}` : "";
    const place = step.op === "merge" ? `${step.file} ${step.key}` : step.path;
    return `${step.op} ${place} ${owner} [${step.clis.join(",")}]${render}`;
  });
}

async function content() {
  const { read, built } = await ownContent(folder(TREE));
  const files = read.files.map((file) => ({
    sourcePath: file.path,
    bytes: file.bytes as Uint8Array,
  }));
  return { content: built.content, files };
}

function plan(
  selection: readonly string[],
  built: Awaited<ReturnType<typeof content>>["content"],
  profiles: readonly ToolProfile[],
  scope: "project" | "user",
): Plan {
  const result = planInstall(selection, [built], profiles, { scope, data: null });
  if (result.status === "invalid" || result.status === "refused")
    throw new Error(JSON.stringify(result));
  return result;
}

const step = (result: Plan, path: string) => {
  const found = result.plan.find(
    (candidate) => candidate.op === "write" && candidate.path === path,
  );
  if (found === undefined) throw new Error(`no step ${path}`);
  return found as WriteStep;
};

const five = () => ["codex", "claude-code", "kimi", "dsh", "cursor"].map((cli) => profile(cli));

/** A custom profile in the shipped format: a copy of one with some sections changed. */
function custom(base: string, changes: Record<string, unknown>): ToolProfile {
  const value = { ...JSON.parse(JSON.stringify(profile(base))), ...changes };
  const read = readToolProfile(
    new TextEncoder().encode(`${JSON.stringify(sortKeys(value), null, 2)}\n`),
  );
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  return read.profile;
}

describe("a user-only skill in a folder several clients share", () => {
  it("gets one combined render with every sharing client's marker at project scope", async () => {
    const { content: built, files } = await content();
    const result = plan([id("release"), id("revise")], built, five(), "project");
    const shared = "shared-skill@codex+cursor+dsh+kimi";
    const file = "shared-user-only-file@codex+cursor+dsh+kimi";
    expect(rows(result.plan)).toEqual([
      `write .agents/skills/release/SKILL.md skill.release [codex,cursor,dsh,kimi] ${shared}`,
      `write .agents/skills/release/agents/openai.yaml skill.release [codex,cursor,dsh,kimi] ${file}`,
      `write .agents/skills/revise/SKILL.md skill.revise [codex,cursor,dsh,kimi] ${shared}`,
      `write .agents/skills/revise/agents/openai.yaml skill.revise [codex,cursor,dsh,kimi] ${file}`,
      "write .agents/skills/revise/references/checklist.md skill.revise [codex,cursor,dsh,kimi]",
      "write .aihq/notices/local-my-skills/LICENSE (2 items) [claude-code,codex,cursor,dsh,kimi]",
      "write .claude/skills/release/SKILL.md skill.release [claude-code] skill@claude-code",
      "write .claude/skills/revise/SKILL.md skill.revise [claude-code] skill@claude-code",
      "write .claude/skills/revise/references/checklist.md skill.revise [claude-code]",
    ]);
    expect(result).toMatchObject({ status: "ok", clashes: [], unavailable: [] });
    // The record names the combined render and every participating profile version.
    expect(step(result, ".agents/skills/release/SKILL.md").render).toEqual({
      name: "shared-skill",
      profiles: [
        { id: "codex", version: 4 },
        { id: "cursor", version: 3 },
        { id: "dsh", version: 2 },
        { id: "kimi", version: 4 },
      ],
      installName: "release",
    });
    const bytes = (path: string) => {
      const output = renderStep(step(result, path), [built], five(), files);
      if (output.status !== "ok") throw new Error(JSON.stringify(output));
      return utf8(output.bytes);
    };
    // Frontmatter keys are added; the body is the upstream body byte for byte.
    expect(bytes(".agents/skills/release/SKILL.md")).toBe(
      "---\ndescription: Plan the next change.\ndisable-model-invocation: true\ndisableModelInvocation: true\nname: release\n---\nWrite a plan for the change.\n",
    );
    expect(bytes(".agents/skills/revise/SKILL.md")).toBe(
      "---\nname: revise\ndescription: Review the staged change.\ndisable-model-invocation: true\ndisableModelInvocation: true\n---\nReview it.\n",
    );
    expect(bytes(".agents/skills/release/agents/openai.yaml")).toBe(
      "policy:\n  allow_implicit_invocation: false\n",
    );
  });

  it("rewords $ARGUMENTS when every sharing client's profile rewords it", async () => {
    const { content: built, files } = await content();
    const clients = ["codex", "dsh", "cursor"].map((cli) => profile(cli));
    const result = plan([id("deploy")], built, clients, "project");
    expect(result).toMatchObject({ status: "ok", clashes: [] });
    const output = renderStep(
      step(result, ".agents/skills/deploy/SKILL.md"),
      [built],
      clients,
      files,
    );
    expect(output.status === "ok" && utf8(output.bytes)).toBe(
      "---\ndescription: Deploy the branch.\ndisable-model-invocation: true\nname: deploy\n---\nDeploy the text the user typed after the command now.\n",
    );
  });

  it("still reports a clash when the sharing clients disagree on rewording $ARGUMENTS", async () => {
    const { content: built } = await content();
    const result = plan([id("deploy"), id("release")], built, five(), "project");
    expect(result.status).toBe("incomplete");
    expect(result.clashes).toEqual([
      {
        root: "project",
        path: ".agents/skills/deploy",
        reason: "different-content",
        items: [id("deploy")],
        clis: ["codex", "cursor", "dsh", "kimi"],
      },
    ]);
    expect(rows(result.plan)).toContain(
      "write .agents/skills/release/SKILL.md skill.release [codex,cursor,dsh,kimi] shared-skill@codex+cursor+dsh+kimi",
    );
  });

  it("refuses rendering a combined step when any participating profile changed", async () => {
    const { content: built, files } = await content();
    const profiles = five();
    const result = plan([id("release")], built, profiles, "project");
    for (const path of [
      ".agents/skills/release/SKILL.md",
      ".agents/skills/release/agents/openai.yaml",
    ]) {
      const planned = step(result, path);
      expect(renderStep(planned, [built], profiles, files)).toMatchObject({ status: "ok" });
      for (const cli of ["codex", "cursor", "dsh", "kimi"]) {
        const drifted = profiles.map((entry) =>
          entry.id === cli ? { ...entry, version: entry.version + 1 } : entry,
        );
        expect(renderStep(planned, [built], drifted, files)).toMatchObject({
          status: "refused",
          code: "profile-mismatch",
        });
        const without = profiles.filter((entry) => entry.id !== cli);
        expect(renderStep(planned, [built], without, files)).toMatchObject({
          status: "refused",
          code: "profile-mismatch",
        });
      }
    }
  });

  it("serves the sharing clients from one version folder at user scope", async () => {
    const { content: built, files } = await content();
    // A Kimi build that reads the shared user folder, so Codex and it share ~/.agents/skills.
    const kimi = custom("kimi", {
      places: {
        ...profile("kimi").places,
        skill: { project: ".agents/skills/<name>/", user: ".agents/skills/<name>/" },
      },
    });
    const clients = [kimi, profile("codex")];
    const result = plan([id("release")], built, clients, "user");
    expect(result).toMatchObject({ status: "ok", clashes: [] });
    const link = result.plan.find((candidate) => candidate.op === "link") as LinkStep;
    const version = link.to.split("/").at(-1);
    expect(rows(result.plan)).toEqual([
      "write .aihq/notices/local-my-skills/LICENSE (1 items) [codex,kimi]",
      `write .aihq/shared/local-my-skills/skill/release/${version}/SKILL.md skill.release [codex,kimi] shared-skill@codex+kimi`,
      `write .aihq/shared/local-my-skills/skill/release/${version}/agents/openai.yaml skill.release [codex,kimi] shared-user-only-file@codex+kimi`,
      `link .agents/skills/release -> .aihq/shared/local-my-skills/skill/release/${version} skill.release [codex,kimi]`,
    ]);
    // The version key covers the combined render record, and so every participating profile.
    const item = built.items.find((candidate) => candidate.id === id("release"));
    const profiles = [
      { id: "codex", version: 4 },
      { id: "kimi", version: 4 },
    ];
    const facts = {
      behaviourSha256: item?.behaviourSha256,
      description: "Plan the next change.",
      files: [
        {
          executable: false,
          path: "SKILL.md",
          render: { installName: "release", name: "shared-skill", profiles },
          sha256: sha(PLAN),
        },
        {
          executable: false,
          path: "agents/openai.yaml",
          render: {
            entry: "agents/openai.yaml",
            installName: "release",
            name: "shared-user-only-file",
            profiles,
          },
        },
      ],
      name: "release",
    };
    expect(version).toBe(sha(JSON.stringify(facts)).slice(0, 12));
    const rendered = renderStep(step(result, `${link.to}/SKILL.md`), [built], clients, files);
    // Codex's marker is its openai.yaml, so only Kimi's flag enters the frontmatter.
    expect(rendered.status === "ok" && utf8(rendered.bytes)).toBe(
      "---\ndescription: Plan the next change.\ndisableModelInvocation: true\nname: release\n---\nWrite a plan for the change.\n",
    );

    // Shipped Codex and dsh share ~/.agents/skills; dsh takes no link, so it is one copy.
    const copy = plan([id("release")], built, [profile("dsh"), profile("codex")], "user");
    expect(copy.status).toBe("ok");
    expect(rows(copy.plan)).toEqual([
      "write .agents/skills/release/SKILL.md skill.release [codex,dsh] shared-skill@codex+dsh",
      "write .agents/skills/release/agents/openai.yaml skill.release [codex,dsh] shared-user-only-file@codex+dsh",
      "write .aihq/notices/local-my-skills/LICENSE (1 items) [codex,dsh]",
    ]);
  });

  it("gives the same plan in any client order and leaves a skill without the flag alone", async () => {
    const { content: built } = await content();
    const selection = [id("release"), id("revise"), id("deploy")];
    for (const scope of ["project", "user"] as const) {
      const one = plan(selection, built, five(), scope);
      const two = plan([...selection].reverse(), built, five().reverse(), scope);
      expect(JSON.stringify(two)).toBe(JSON.stringify(one));
    }
    // A skill that is not user-only is copied as before, with no render.
    const plain = plan([id("notes")], built, five(), "project");
    expect(rows(plain.plan)).toEqual([
      "write .agents/skills/notes/SKILL.md skill.notes [codex,cursor,dsh,kimi]",
      "write .aihq/notices/local-my-skills/LICENSE (1 items) [claude-code,codex,cursor,dsh,kimi]",
      "write .claude/skills/notes/SKILL.md skill.notes [claude-code]",
    ]);
  });
});
