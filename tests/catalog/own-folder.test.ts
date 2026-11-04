import { describe, expect, it } from "vitest";
import { planInstall, readContent, renderStep } from "../../src/catalog/reader.js";
import {
  FRAMEWORK,
  folder,
  gitTree,
  ownContent,
  profile,
  sha,
  sortKeys,
  utf8,
  writes,
} from "./helpers.js";

const LICENSE = "MIT Licence\n";
const REVIEW =
  "---\nname: revise\ndescription: Review the current change.\n---\n\nReview carefully.\n";
const CHECKLIST = "- tests\n";
const STYLE = "# Style\n\nUse two spaces.\n";

describe("planning an installation from your own folder", () => {
  it("copies a skill, an always-on rule and its notice into Claude's project folders", async () => {
    const root = folder({
      LICENSE,
      "skills/revise/SKILL.md": REVIEW,
      "skills/revise/references/checklist.md": CHECKLIST,
      "rules/style.md": STYLE,
    });
    const { built } = await ownContent(root);

    const plan = planInstall(
      [`${FRAMEWORK}.skill.revise`, `${FRAMEWORK}.rule.style`],
      [built.content],
      [profile("claude-code")],
      { scope: "project", data: null },
    );

    const review = `${FRAMEWORK}.skill.revise`;
    const style = `${FRAMEWORK}.rule.style`;
    expect(plan).toEqual({
      status: "ok",
      data: null,
      profiles: [{ id: "claude-code", version: 4 }],
      plan: [
        {
          op: "write",
          root: "project",
          path: `.aihq/notices/${FRAMEWORK}/LICENSE`,
          from: { sourceId: FRAMEWORK, sourcePath: "LICENSE", sha256: sha(LICENSE) },
          executable: false,
          items: [style, review],
          clis: ["claude-code"],
        },
        {
          op: "write",
          root: "project",
          path: ".claude/rules/style.md",
          from: {
            item: style,
            sourceId: FRAMEWORK,
            sourcePath: "rules/style.md",
            sha256: sha(STYLE),
          },
          executable: false,
          item: style,
          clis: ["claude-code"],
        },
        {
          op: "write",
          root: "project",
          path: ".claude/skills/revise/SKILL.md",
          from: {
            item: review,
            sourceId: FRAMEWORK,
            sourcePath: "skills/revise/SKILL.md",
            sha256: sha(REVIEW),
          },
          executable: false,
          item: review,
          clis: ["claude-code"],
        },
        {
          op: "write",
          root: "project",
          path: ".claude/skills/revise/references/checklist.md",
          from: {
            item: review,
            sourceId: FRAMEWORK,
            sourcePath: "skills/revise/references/checklist.md",
            sha256: sha(CHECKLIST),
          },
          executable: false,
          item: review,
          clis: ["claude-code"],
        },
      ],
      missing: [],
      unavailable: [],
      clashes: [],
      duplicates: [],
      references: [],
      warnings: [],
    });
  });
});

const SHIP =
  "---\nname: ship\ndescription: Ship the change.\ndisable-model-invocation: true\n---\n\nShip $ARGUMENTS now.\n";

const tree = {
  LICENSE,
  "skills/revise/SKILL.md": REVIEW,
  "skills/revise/references/checklist.md": CHECKLIST,
  "skills/ship/SKILL.md": SHIP,
  "rules/style.md": STYLE,
};
const review = `${FRAMEWORK}.skill.revise`;
const ship = `${FRAMEWORK}.skill.ship`;
const style = `${FRAMEWORK}.rule.style`;
const threeClis = () => [profile("claude-code"), profile("kiro"), profile("antigravity")];

describe("one own folder for Claude, Kiro and Antigravity", () => {
  it("records file identities, the user-only flag and notices in canonical content", async () => {
    const { built } = await ownContent(folder(tree));
    const content = built.content;
    expect(content.schema).toBe("urn:aihq:catalog:content:0.1.0");
    expect(content.framework).toEqual({ id: FRAMEWORK, name: FRAMEWORK });
    expect(content.sources).toEqual([
      {
        id: FRAMEWORK,
        kind: "local",
        notices: [{ sourcePath: "LICENSE", sha256: sha(LICENSE), covers: "/" }],
      },
    ]);
    expect(content.items.map((item) => [item.id, item.kind, item.name, item.description])).toEqual([
      [style, "rule", "style", "Style"],
      [review, "skill", "revise", "Review the current change."],
      [ship, "skill", "ship", "Ship the change."],
    ]);
    const byId = Object.fromEntries(content.items.map((item) => [item.id, item]));
    expect(byId[ship]).toMatchObject({ userOnly: true, arguments: true });
    expect(byId[review]).toMatchObject({ userOnly: false, arguments: false });
    expect(byId[style]).toMatchObject({ scope: "always" });
    expect(byId[review]?.files).toEqual([
      {
        sourceId: FRAMEWORK,
        sourcePath: "skills/revise/SKILL.md",
        sha256: sha(REVIEW),
        bytes: Buffer.byteLength(REVIEW),
        executable: false,
        role: "content",
      },
      {
        sourceId: FRAMEWORK,
        sourcePath: "skills/revise/references/checklist.md",
        sha256: sha(CHECKLIST),
        bytes: Buffer.byteLength(CHECKLIST),
        executable: false,
        role: "content",
      },
    ]);
    // contentSha256 is sha256 over canonical JSON of the sorted { executable, sha256, sourcePath }.
    const facts = `[{"executable":false,"sha256":"${sha(REVIEW)}","sourcePath":"skills/revise/SKILL.md"},{"executable":false,"sha256":"${sha(CHECKLIST)}","sourcePath":"skills/revise/references/checklist.md"}]`;
    expect(byId[review]?.contentSha256).toBe(sha(facts));
    expect(utf8(built.bytes)).toBe(`${JSON.stringify(sortKeys(content), null, 2)}\n`);
    const reread = readContent(built.bytes);
    expect(reread).toEqual({ status: "ok", content });
  });

  it("gives each item Scan's Git tree key for its folder at install paths", async () => {
    const root = folder(tree);
    const { built } = await ownContent(root);
    const expected = gitTree({ "SKILL.md": REVIEW, "references/checklist.md": CHECKLIST });
    expect(built.content.items.find((item) => item.id === review)?.scanKey).toBe(
      `git-sha1:${expected}`,
    );
    expect(built.content.items.find((item) => item.id === style)?.scanKey).toBe(
      `git-sha1:${gitTree({ "style.md": STYLE })}`,
    );
  });

  it("plans copies into each client's project folders with the client's user-only form", async () => {
    const { built } = await ownContent(folder(tree));
    const result = planInstall([ship, style, review], [built.content], threeClis(), {
      scope: "project",
      data: null,
    });
    if (result.status !== "ok") throw new Error(JSON.stringify(result));
    expect(result.profiles).toEqual([
      { id: "antigravity", version: 4 },
      { id: "claude-code", version: 4 },
      { id: "kiro", version: 5 },
    ]);
    expect(
      writes(result.plan).map((step) => [
        step.op,
        step.root,
        step.path,
        step.item ?? step.items,
        step.clis,
        step.render?.name ?? null,
      ]),
    ).toEqual([
      ["write", "project", `.agents/rules/style.md`, style, ["antigravity"], "rule"],
      ["write", "project", `.agents/skills/revise/SKILL.md`, review, ["antigravity"], null],
      [
        "write",
        "project",
        `.agents/skills/revise/references/checklist.md`,
        review,
        ["antigravity"],
        null,
      ],
      ["write", "project", `.agents/skills/ship/SKILL.md`, ship, ["antigravity"], "skill"],
      [
        "write",
        "project",
        `.aihq/notices/${FRAMEWORK}/LICENSE`,
        [style, review, ship],
        ["antigravity", "claude-code", "kiro"],
        null,
      ],
      ["write", "project", `.claude/rules/style.md`, style, ["claude-code"], null],
      ["write", "project", `.claude/skills/revise/SKILL.md`, review, ["claude-code"], null],
      [
        "write",
        "project",
        `.claude/skills/revise/references/checklist.md`,
        review,
        ["claude-code"],
        null,
      ],
      ["write", "project", `.claude/skills/ship/SKILL.md`, ship, ["claude-code"], "skill"],
      // Kiro renders fold every description to one plain line, so they always render.
      ["write", "project", `.kiro/prompts/ship.md`, ship, ["kiro"], "user-only-fallback"],
      ["write", "project", `.kiro/skills/revise/SKILL.md`, review, ["kiro"], "skill"],
      ["write", "project", `.kiro/skills/revise/references/checklist.md`, review, ["kiro"], null],
      ["write", "project", `.kiro/steering/ship.md`, ship, ["kiro"], "user-only-fallback"],
      ["write", "project", `.kiro/steering/style.md`, style, ["kiro"], "rule"],
    ]);
    // Kiro never receives the user-only skill as a skill (Kiro CLI ignores the flag).
    expect(writes(result.plan).some((step) => step.path.startsWith(".kiro/skills/ship"))).toBe(
      false,
    );
    for (const step of writes(result.plan))
      expect(step.scanned).toBe(step.render ? false : undefined);
  });

  it("renders each recorded step to the client's bytes without touching the upstream body", async () => {
    const { read, built } = await ownContent(folder(tree));
    const profiles = threeClis();
    const result = planInstall([ship, style], [built.content], profiles, {
      scope: "project",
      data: null,
    });
    if (result.status !== "ok") throw new Error(JSON.stringify(result));
    const files = read.files.map((file) => ({
      sourcePath: file.path,
      bytes: file.bytes as Uint8Array,
    }));
    const rendered = Object.fromEntries(
      writes(result.plan)
        .filter((step) => step.render !== undefined)
        .map((step) => {
          const output = renderStep(step, [built.content], profiles, files);
          if (output.status !== "ok") throw new Error(JSON.stringify(output));
          expect(output.sha256).toBe(sha(output.bytes));
          return [step.path, utf8(output.bytes)];
        }),
    );
    expect(rendered).toEqual({
      ".agents/rules/style.md": "---\ntrigger: always_on\n---\n# Style\n\nUse two spaces.\n",
      ".agents/skills/ship/SKILL.md":
        "---\nname: ship\ndescription: Ship the change.\ndisable-model-invocation: true\n---\n\nShip the text the user typed after the command now.\n",
      ".claude/skills/ship/SKILL.md": SHIP,
      ".kiro/prompts/ship.md": SHIP,
      ".kiro/steering/ship.md":
        "---\nname: ship\ndescription: Ship the change.\ndisable-model-invocation: true\ninclusion: manual\n---\n\nShip the text the user typed after the command now.\n",
      ".kiro/steering/style.md": "---\ninclusion: always\n---\n# Style\n\nUse two spaces.\n",
    });
    const prompt = writes(result.plan).find((step) => step.path === ".kiro/prompts/ship.md");
    expect(prompt?.from).toEqual({
      item: ship,
      sourceId: FRAMEWORK,
      sourcePath: "skills/ship/SKILL.md",
      sha256: sha(SHIP),
    });
  });

  it("gives byte-identical content and plans for identical input, in any input order", async () => {
    const first = await ownContent(folder(tree));
    const second = await ownContent(folder(tree, "my-skills"));
    expect(Buffer.from(second.built.bytes).equals(Buffer.from(first.built.bytes))).toBe(true);
    const one = planInstall([review, ship, style], [first.built.content], threeClis(), {
      scope: "project",
      data: null,
    });
    const two = planInstall([style, ship, review], [second.built.content], threeClis().reverse(), {
      scope: "project",
      data: null,
    });
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
  });

  it("installs an item under a caller-chosen name and reports a placement clash", async () => {
    const root = folder({ ...tree, "rules/ship.md": "# Ship rule\n" });
    const { built } = await ownContent(root);
    const renamed = planInstall([review], [built.content], [profile("claude-code")], {
      scope: "project",
      data: null,
      names: { [review]: "team-review" },
    });
    if (renamed.status !== "ok") throw new Error(JSON.stringify(renamed));
    expect(writes(renamed.plan).map((step) => step.path)).toContain(
      ".claude/skills/team-review/SKILL.md",
    );

    const clash = planInstall(
      [ship, `${FRAMEWORK}.rule.ship`],
      [built.content],
      [profile("kiro")],
      {
        scope: "project",
        data: null,
      },
    );
    expect(clash).toMatchObject({
      status: "incomplete",
      clashes: [
        {
          root: "project",
          path: ".kiro/steering/ship.md",
          items: [`${FRAMEWORK}.rule.ship`, ship],
          clis: ["kiro"],
        },
      ],
    });
  });
});
