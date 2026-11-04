import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixtures, limits } from "../../src/catalog/contracts.js";
import { readContentFile, readLocalSource } from "../../src/catalog/node.js";
import { buildContent, checkContent } from "../../src/catalog/producer.js";
import {
  availability,
  planInstall,
  readContent,
  readQualification,
  readRecipe,
  readToolProfile,
  renderStep,
} from "../../src/catalog/reader.js";
import { findItems } from "../../src/catalog/source.js";
import { FRAMEWORK, folder, ownContent, profile, sha, writes } from "./helpers.js";

const planSteps = (result: ReturnType<typeof planInstall>) =>
  result.status === "ok" || result.status === "incomplete" ? result.plan : [];
const SKILL = "---\nname: tidy\ndescription: Tidy the code.\n---\n\nTidy $ARGUMENTS.\n";
const tidy = `${FRAMEWORK}.skill.tidy`;

describe("bad paths", () => {
  it("refuses a missing folder, a file and a linked root", () => {
    const root = folder({
      "skills/tidy/SKILL.md": SKILL,
      "target/x.md": "x\n",
      linked: { link: "target" },
    });
    expect(readLocalSource(join(root, "absent"))).toMatchObject({
      status: "refused",
      code: "not-found",
    });
    expect(readLocalSource(join(root, "skills/tidy/SKILL.md"))).toMatchObject({
      status: "refused",
      code: "not-a-directory",
    });
    expect(readLocalSource(join(root, "linked"))).toMatchObject({
      status: "refused",
      code: "link",
    });
  });

  it("refuses absolute, parent-traversing and backslash entry paths", () => {
    for (const path of [
      "../escape.md",
      "/etc/passwd",
      "skills/../../x.md",
      "skills\\tidy\\SKILL.md",
      "C:/x.md",
      "a//b.md",
    ]) {
      const result = findItems([{ path, mode: "100644", sha256: sha("x") }], {
        framework: FRAMEWORK,
      });
      expect(result, path).toMatchObject({ status: "refused", code: "path-escape" });
    }
  });

  it("refuses a file over the per-file limit instead of returning a partial source", () => {
    const root = folder({ "skills/tidy/SKILL.md": SKILL });
    writeFileSync(join(root, "big.bin"), Buffer.alloc(limits.sourceFileBytes + 1));
    expect(readLocalSource(root)).toMatchObject({
      status: "refused",
      code: "limit",
      limit: "sourceFileBytes",
    });
  });

  it("refuses a document over its byte or depth limit, naming the limit", () => {
    const over = (limit: number) => new Uint8Array(limit + 1).fill(0x20);
    expect(readContent(over(limits.contentFileBytes))).toMatchObject({
      status: "refused",
      code: "limit",
      limit: "contentFileBytes",
    });
    expect(readToolProfile(over(limits.toolProfileBytes))).toMatchObject({
      status: "refused",
      limit: "toolProfileBytes",
    });
    expect(readQualification(over(limits.qualificationBytes))).toMatchObject({
      status: "refused",
      limit: "qualificationBytes",
    });
    const plugin = new TextEncoder().encode("{}");
    expect(readRecipe(plugin, over(limits.recipeBytes))).toMatchObject({
      status: "refused",
      limit: "recipeBytes",
    });
    const recipe = new TextEncoder().encode(fixtures["recipe-valid"]);
    expect(readRecipe(over(limits.recipeBytes), recipe)).toMatchObject({
      status: "refused",
      limit: "recipeBytes",
    });
    const deep = new TextEncoder().encode(
      `${"[".repeat(limits.documentDepth + 1)}${"]".repeat(limits.documentDepth + 1)}\n`,
    );
    expect(readContent(deep)).toMatchObject({
      status: "refused",
      code: "limit",
      limit: "documentDepth",
    });
  });

  it("refuses invalid planning input and unknown items", async () => {
    const { built } = await ownContent(folder({ "skills/tidy/SKILL.md": SKILL }));
    const claude = profile("claude-code");
    expect(
      planInstall(["local-my-skills.skill.absent"], [built.content], [claude], {
        scope: "project",
        data: null,
      }),
    ).toMatchObject({
      status: "refused",
      code: "unknown-item",
    });
    expect(
      planInstall([tidy], [built.content], [claude], { scope: "everywhere", data: null } as never),
    ).toMatchObject({ status: "invalid" });
    expect(
      planInstall([tidy], [built.content], [claude], {
        scope: "project",
        data: null,
        names: { [tidy]: "../up" },
      }),
    ).toMatchObject({ status: "invalid" });
    expect(
      planInstall([tidy], [built.content], [claude], {
        scope: "project",
        data: { repository: "x", commit: "main" },
      }),
    ).toMatchObject({
      status: "invalid",
    });
    expect(
      planInstall([tidy], [built.content], [claude], {
        scope: "user",
        data: null,
        copy: "yes",
      } as never),
    ).toMatchObject({ status: "invalid", problems: [{ path: "options/copy" }] });
  });
});

describe("changed bytes", () => {
  it("refuses building from bytes that differ from the read sha256", async () => {
    const root = folder({ "skills/tidy/SKILL.md": SKILL });
    const read = readLocalSource(root);
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: FRAMEWORK });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const changed = read.files.map((file) => ({
      ...file,
      bytes: new TextEncoder().encode(SKILL.replace("Tidy", "Wipe")),
    }));
    expect(
      await buildContent(read.source, changed, found.items, { framework: FRAMEWORK }),
    ).toMatchObject({
      status: "refused",
      code: "source-mismatch",
    });
  });

  it("refuses rendering from a changed source file or another profile version", async () => {
    const { read, built } = await ownContent(folder({ "skills/tidy/SKILL.md": SKILL }));
    const antigravity = profile("antigravity");
    const plan = planInstall([tidy], [built.content], [antigravity], {
      scope: "project",
      data: null,
    });
    if (plan.status !== "ok") throw new Error(JSON.stringify(plan));
    const step = writes(plan.plan).find((candidate) => candidate.render !== undefined);
    if (step === undefined) throw new Error("expected a render step for the argument rewording");
    const original = [
      { sourcePath: "skills/tidy/SKILL.md", bytes: read.files[0]?.bytes as Uint8Array },
    ];
    expect(renderStep(step, [built.content], [antigravity], original)).toMatchObject({
      status: "ok",
    });
    const changed = [
      { sourcePath: "skills/tidy/SKILL.md", bytes: new TextEncoder().encode(`${SKILL}x`) },
    ];
    expect(renderStep(step, [built.content], [antigravity], changed)).toMatchObject({
      status: "refused",
      code: "source-mismatch",
    });
    expect(
      renderStep(
        step,
        [built.content],
        [{ ...antigravity, version: antigravity.version + 1 }],
        original,
      ),
    ).toMatchObject({
      status: "refused",
      code: "profile-mismatch",
    });
  });

  it("reports content whose recorded file facts differ from the files", async () => {
    const root = folder({ "skills/tidy/SKILL.md": SKILL });
    const { read, built } = await ownContent(root);
    expect(await checkContent(built.content, read.files)).toEqual({ status: "ok", problems: [] });
    writeFileSync(
      join(root, "skills/tidy/SKILL.md"),
      SKILL.replace("Tidy the code.", "Delete the code."),
    );
    const reread = readLocalSource(root);
    if (reread.status !== "ok") throw new Error(JSON.stringify(reread));
    const checked = await checkContent(built.content, reread.files);
    expect(checked.status).toBe("invalid");
    expect(
      checked.status === "invalid" && checked.problems.map((problem) => problem.path),
    ).toContain(`${tidy}/skills/tidy/SKILL.md`);
  });

  it("reads own content and own profiles in any strict JSON spelling, never with duplicate keys", async () => {
    const root = folder({ "skills/tidy/SKILL.md": SKILL });
    const { built } = await ownContent(root);
    const compact = new TextEncoder().encode(JSON.stringify(built.content));
    expect(readContent(compact)).toEqual({ status: "ok", content: built.content });
    const twice = new TextEncoder().encode(
      `{"schema":"x",${JSON.stringify(built.content).slice(1)}`,
    );
    expect(readContent(twice)).toMatchObject({ status: "invalid" });
    const nested = JSON.stringify(built.content).replace(
      '"framework":{',
      '"framework":{"name":"Other",',
    );
    expect(readContent(new TextEncoder().encode(nested))).toMatchObject({ status: "invalid" });
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...compact]);
    expect(readContent(withBom)).toMatchObject({ status: "invalid" });
    const own = profile("codex");
    expect(readToolProfile(new TextEncoder().encode(JSON.stringify(own)))).toEqual({
      status: "ok",
      profile: own,
    });
  });

  it("reads content back only in its digest-consistent form", async () => {
    const root = folder({ "skills/tidy/SKILL.md": SKILL });
    const { built } = await ownContent(root);
    const path = join(root, "..", "content.json");
    writeFileSync(path, built.bytes);
    expect(readContentFile(path)).toEqual({ status: "ok", content: built.content });
    const text = new TextDecoder().decode(built.bytes);
    expect(
      readContent(new TextEncoder().encode(text.replace('"userOnly": false', '"userOnly": true'))),
    ).toMatchObject({
      status: "invalid",
      problems: [{ path: "/items/0/behaviourSha256" }],
    });
    expect(
      readContent(
        new TextEncoder().encode(
          text.replace("urn:aihq:catalog:content:0.1.0", "urn:aihq:catalog:content:0.2.0"),
        ),
      ),
    ).toEqual({ status: "unsupported-version", schema: "urn:aihq:catalog:content:0.2.0" });
  });
});

describe("explicit leftovers and unimplemented kinds", () => {
  it("lists every entry that did not become an item, with its reason", () => {
    const root = folder({
      "skills/tidy/SKILL.md": SKILL,
      "skills/tidy/inner/SKILL.md": "---\nname: inner\ndescription: Inner.\n---\n",
      "SKILL.md": "---\nname: root\ndescription: Root.\n---\n",
      "README.md": "# Mine\n",
      "agents/helper.md": "---\nname: helper\n---\n",
      "commands/go.md": "Go.\n",
      "hooks/hooks.json": "{}\n",
      ".mcp.json": "{}\n",
      "rules/Bad Name.md": "x\n",
      outside: { link: "/etc" },
      ".git/HEAD": "ref: refs/heads/main\n",
    });
    if (process.platform !== "win32") execFileSync("mkfifo", [join(root, "pipe")]);
    const read = readLocalSource(root);
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    expect(read.skipped).toEqual([{ path: ".git", reason: "vcs-metadata" }]);
    const found = findItems(read.files, { framework: FRAMEWORK });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    expect(found.items.map((item) => item.id)).toEqual([
      `${FRAMEWORK}.agent.helper`,
      `${FRAMEWORK}.skill.go`,
      tidy,
    ]);
    expect(
      found.items.find((item) => item.id === tidy)?.files.map((file) => file.sourcePath),
    ).toEqual(["skills/tidy/SKILL.md"]);
    expect(found.leftOver).toEqual([
      { path: ".mcp.json", reason: "not-implemented", kind: "mcp" },
      { path: "README.md", reason: "unrecognised" },
      { path: "SKILL.md", reason: "ambiguous-skill" },
      { path: "hooks/hooks.json", reason: "not-implemented", kind: "hook" },
      { path: "outside", reason: "link" },
      ...(process.platform === "win32" ? [] : [{ path: "pipe", reason: "special-file" as const }]),
      { path: "rules/Bad Name.md", reason: "unrepresentable-id" },
      { path: "skills/tidy/inner/SKILL.md", reason: "ambiguous-skill" },
    ]);
  });

  it("never follows a link out of the folder", () => {
    const secret = folder({ "secret.md": "do not read\n" }, "elsewhere");
    const root = folder({
      "skills/tidy/SKILL.md": SKILL,
      "skills/tidy/notes.md": { link: join(secret, "secret.md") },
    });
    const read = readLocalSource(root);
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    expect(read.files.find((file) => file.path === "skills/tidy/notes.md")).toEqual({
      path: "skills/tidy/notes.md",
      mode: "link",
    });
  });

  it("places scoped rules and launches a Kiro user-only skill with support files from its own folder", async () => {
    const root = folder({
      "rules/python.md": '---\npaths:\n  - "**/*.py"\n---\n# Python\n',
      "skills/deploy/SKILL.md":
        "---\nname: deploy\ndescription: Deploy.\ndisable-model-invocation: true\n---\nGo.\n",
      "skills/deploy/script.sh": { text: "#!/bin/sh\n", executable: true },
    });
    mkdirSync(join(root, "empty"));
    const { built } = await ownContent(root);
    const deploy = `${FRAMEWORK}.skill.deploy`;
    const python = `${FRAMEWORK}.rule.python`;
    expect(built.content.items.find((item) => item.id === python)?.scope).toEqual({
      paths: ["**/*.py"],
    });
    expect(
      built.content.items.find((item) => item.id === deploy)?.files.map((file) => file.executable),
    ).toEqual([false, true]);
    const kiro = profile("kiro");
    const result = planInstall([deploy, python], [built.content], [kiro, profile("claude-code")], {
      scope: "project",
      data: null,
    });
    // A user-only skill with support files keeps its folder where Kiro does not load skills
    // (as a bundle skill does), and its prompt file and manual steering launch it.
    expect(result).toMatchObject({ status: "ok", unavailable: [] });
    const paths = writes(planSteps(result)).map((step) => step.path);
    expect(paths).toContain(`.kiro/aih/${FRAMEWORK}/skills/deploy/SKILL.md`);
    expect(paths).toContain(`.kiro/aih/${FRAMEWORK}/skills/deploy/script.sh`);
    expect(paths).not.toContain(".kiro/skills/deploy/SKILL.md");
    const launcher = writes(planSteps(result)).find(
      (step) => step.path === ".kiro/prompts/deploy.md",
    );
    expect(launcher).toMatchObject({
      render: { name: "launcher", target: `.kiro/aih/${FRAMEWORK}/skills/deploy/SKILL.md` },
    });
    expect(paths).toContain(".kiro/steering/deploy.md");
    const item = built.content.items.find((candidate) => candidate.id === deploy);
    if (item === undefined) throw new Error("deploy missing");
    expect(availability(item, profile("claude-code"))).toEqual({
      available: true,
      how: "rendered",
    });
    expect(availability(item, kiro)).toEqual({ available: true, how: "rendered" });
    // OpenCode keeps the folder in its skill place and launches it from a command.
    const opencode = planInstall([deploy], [built.content], [profile("opencode")], {
      scope: "project",
      data: null,
    });
    expect(opencode).toMatchObject({ status: "ok" });
    expect(
      writes(planSteps(opencode)).find((step) => step.path === ".opencode/commands/deploy.md"),
    ).toMatchObject({ render: { name: "launcher", target: ".agents/skills/deploy/SKILL.md" } });
  });
});

describe("frontmatter the bytes cannot support", () => {
  it("refuses duplicate keys, aliases, a missing description and a bad name", async () => {
    const cases: Record<string, string> = {
      duplicate: "---\nname: dup\nname: dup\ndescription: Twice.\n---\n",
      alias: "---\nname: alias\ndescription: &d Shared.\nwhen_to_use: *d\n---\n",
      undescribed: "---\nname: undescribed\n---\nBody.\n",
      badname: "---\nname: Bad_Name\ndescription: Bad.\n---\n",
    };
    for (const [folderName, text] of Object.entries(cases)) {
      const root = folder({ [`skills/${folderName}/SKILL.md`]: text });
      const read = readLocalSource(root);
      if (read.status !== "ok") throw new Error(JSON.stringify(read));
      const found = findItems(read.files, { framework: FRAMEWORK });
      if (found.status !== "ok") throw new Error(JSON.stringify(found));
      const built = await buildContent(read.source, read.files, found.items, {
        framework: FRAMEWORK,
      });
      expect(built, folderName).toMatchObject({
        status: "invalid",
        problems: [{ path: `${FRAMEWORK}.skill.${folderName}` }],
      });
    }
  });

  it("keeps CRLF line endings and unknown frontmatter when rendering", async () => {
    const text =
      "---\r\nname: crlf\r\ndescription: Windows lines.\r\nmetadata:\r\n  team: core\r\ndisable-model-invocation: true\r\n---\r\nRun $ARGUMENTS.\r\n";
    const { read, built } = await ownContent(folder({ "skills/crlf/SKILL.md": text }));
    const antigravity = profile("antigravity");
    const plan = planInstall([`${FRAMEWORK}.skill.crlf`], [built.content], [antigravity], {
      scope: "project",
      data: null,
    });
    if (plan.status !== "ok") throw new Error(JSON.stringify(plan));
    const step = writes(plan.plan).find((candidate) => candidate.render !== undefined);
    if (step === undefined) throw new Error("expected a render");
    const output = renderStep(
      step,
      [built.content],
      [antigravity],
      [{ sourcePath: "skills/crlf/SKILL.md", bytes: read.files[0]?.bytes as Uint8Array }],
    );
    expect(output.status === "ok" && new TextDecoder().decode(output.bytes)).toBe(
      "---\r\nname: crlf\r\ndescription: Windows lines.\r\nmetadata:\r\n  team: core\r\ndisable-model-invocation: true\r\n---\r\nRun the text the user typed after the command.\r\n",
    );
  });
});
