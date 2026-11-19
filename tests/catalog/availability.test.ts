import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readLocalSource } from "../../src/catalog/node.js";
import { buildContent } from "../../src/catalog/producer.js";
import {
  availability,
  type Content,
  getItem,
  type Item,
  listItems,
  planInstall,
  readContent,
  readQualification,
} from "../../src/catalog/reader.js";
import { findItems } from "../../src/catalog/source.js";
import { folder, profile } from "./helpers.js";

function content(framework: string): Content {
  const result = readContent(
    readFileSync(join(import.meta.dirname, "../../data", framework, "content.json")),
  );
  if (result.status !== "ok") throw new Error(JSON.stringify(result));
  return result.content;
}

function itemIn(content: Content, id: string): Item {
  const result = getItem(content, id);
  if (result.status !== "ok") throw new Error(JSON.stringify(result));
  return result.item;
}

describe("item availability in its framework", () => {
  it("checks a wrapper's own context without rebinding its shared reader items", () => {
    const egm = content("egm");
    const item = itemIn(egm, "egm.agent.bootstrap_orchestrator");
    const claude = profile("claude-code");
    const wrapper = { ...egm, bundles: [] };
    expect(getItem(wrapper, item.id)).toMatchObject({ status: "ok" });
    expect(availability(item, claude)).toEqual({ available: true, how: "rendered" });
    expect(listItems(wrapper, { cli: claude })).toEqual([]);
    expect(availability(item, claude)).toEqual({ available: true, how: "rendered" });
    expect(availability(item, claude, { contents: [wrapper] })).toEqual({
      available: false,
      how: "none",
      reason: "invalid",
    });
    expect(listItems(egm, { cli: claude }).map((item) => item.id)).toContain(item.id);
  });

  it("reports a missing selected dependency and a built-in clash as incomplete", async () => {
    const source = readLocalSource(
      folder({
        "skills/deploy/SKILL.md": "---\nname: deploy\ndescription: Deploy.\n---\nDeploy.\n",
        "skills/checks/SKILL.md": "---\nname: checks\ndescription: Check.\n---\nCheck.\n",
        "skills/plan/SKILL.md": "---\nname: plan\ndescription: Plan.\n---\nPlan.\n",
      }),
    );
    if (source.status !== "ok") throw new Error(JSON.stringify(source));
    const found = findItems(source.files, { framework: "kit" });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const built = await buildContent(
      source.source,
      source.files,
      found.items.map((item) =>
        item.id === "kit.skill.deploy" ? { ...item, dependencies: ["kit.skill.checks"] } : item,
      ),
      { framework: "kit" },
    );
    if (built.status !== "ok") throw new Error(JSON.stringify(built));
    const selected = getItem(built.content, "kit.skill.deploy");
    if (selected.status !== "ok") throw new Error(JSON.stringify(selected));
    const claude = profile("claude-code");
    expect(
      planInstall([selected.item.id], [built.content], [claude], {
        scope: "project",
        data: null,
      }),
    ).toMatchObject({
      status: "incomplete",
      missing: [
        {
          item: "kit.skill.deploy",
          dependency: "kit.skill.checks",
          reason: "dependency-not-selected",
        },
      ],
    });
    expect(availability(selected.item, claude)).toEqual({
      available: false,
      how: "none",
      reason: "incomplete",
    });
    const clash = getItem(built.content, "kit.skill.plan");
    if (clash.status !== "ok") throw new Error(JSON.stringify(clash));
    expect(availability(clash.item, claude)).toEqual({
      available: false,
      how: "none",
      reason: "incomplete",
    });
    expect(
      availability(clash.item, claude, {
        contents: [built.content],
        scope: "user",
        copy: true,
        names: { [clash.item.id]: "my-plan" },
      }),
    ).toEqual({ available: true, how: "rendered" });
  });

  it.each([
    "mutable",
    "shallow-frozen",
    "wrapper",
  ])("revalidates changes within %s content instead of reusing admitted validation", (shape) => {
    const admitted = content("egm");
    const mutable =
      shape === "wrapper"
        ? { ...admitted, items: structuredClone(admitted.items) }
        : structuredClone(admitted);
    if (shape === "shallow-frozen") Object.freeze(mutable);
    const item = itemIn(mutable, "egm.agent.bootstrap_orchestrator");
    const claude = profile("claude-code");
    expect(availability(item, claude, { contents: [mutable] }).available).toBe(true);
    Object.assign(item, { name: "INVALID NAME" });
    expect(availability(item, claude, { contents: [mutable] })).toEqual({
      available: false,
      how: "none",
      reason: "invalid",
    });
    const original = itemIn(admitted, item.id);
    expect(availability(original, claude)).toEqual({ available: true, how: "rendered" });
  });

  it("rechecks stricter options, profile changes and invalid bytes after successful admission", () => {
    const egm = content("egm");
    const item = itemIn(egm, "egm.agent.bootstrap_orchestrator");
    const claude = structuredClone(profile("claude-code"));
    const context = { contents: [egm] };
    expect(availability(item, claude, context).available).toBe(true);
    expect(
      availability(item, claude, {
        ...context,
        names: { [item.id]: "INVALID NAME" },
      }),
    ).toEqual({ available: false, how: "none", reason: "invalid" });
    expect(availability(item, claude, { ...context, scope: "invalid" as never }).reason).toBe(
      "invalid",
    );
    Object.assign(claude, { version: -1 });
    expect(availability(item, claude, context).reason).toBe("invalid");
    const invalid = structuredClone(egm);
    Object.assign(itemIn(invalid, item.id), { name: "INVALID NAME" });
    expect(readContent(new TextEncoder().encode(JSON.stringify(invalid))).status).toBe("invalid");
    expect(availability(item, profile("claude-code"), context).available).toBe(true);
  });

  it("uses the item selected by id from explicit content, including its edition metadata", () => {
    const egm = content("egm");
    const claude = profile("claude-code");
    const item = itemIn(egm, "egm.agent.bootstrap_orchestrator");
    const standalone = structuredClone(item);
    expect(availability(standalone, claude)).toEqual({
      available: false,
      how: "none",
      reason: "invalid",
    });
    const edited = {
      ...standalone,
      editions: itemIn(content("pstack"), "pstack.agent.comment-sicko").editions,
    };
    expect(availability(edited, claude, { contents: [egm] })).toEqual({
      available: true,
      how: "rendered",
    });
    expect(availability(standalone, profile("dsh"), { contents: [egm] })).toEqual({
      available: false,
      how: "none",
      reason: "unsupported-kind",
    });
    expect(availability(standalone, claude, { contents: [] }).available).toBe(false);
  });

  it("requires a platform and uses the supplied qualifications for AI setups and filtering", () => {
    const cbm = content("cbm");
    const codex = profile("codex");
    const item = itemIn(cbm, "cbm.ai-setup.codebase-memory-mcp");
    const qualifications = readdirSync(join(import.meta.dirname, "../../data/qualifications")).map(
      (file) => {
        const read = readQualification(
          readFileSync(join(import.meta.dirname, "../../data/qualifications", file)),
        );
        if (read.status !== "ok") throw new Error(JSON.stringify(read));
        return read.qualification;
      },
    );
    expect(availability(item, codex)).toEqual({
      available: false,
      how: "none",
      reason: "platform-required",
    });
    const context = { contents: [cbm], cell: "linux-x64", qualifications };
    expect(availability(item, codex, context)).toEqual({ available: true, how: "rendered" });
    expect(
      listItems(cbm, { kind: "ai-setup", cli: codex, context }).map((item) => item.id),
    ).toEqual(["cbm.ai-setup.codebase-memory-mcp"]);
    expect(availability(item, codex, { ...context, qualifications: [] })).toEqual({
      available: false,
      how: "none",
      reason: "no-qualification",
    });
    expect(availability(item, codex, { ...context, cell: "windows-x64" })).toEqual({
      available: false,
      how: "none",
      reason: "not-qualified",
    });
  });

  it("excludes an item whose plan has an unresolved sibling path", () => {
    const pstack = content("pstack");
    const claude = profile("claude-code");
    const found = getItem(pstack, "pstack.agent.poteto-agent");
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const plan = planInstall([found.item.id], [pstack], [claude], { scope: "project", data: null });
    expect(plan).toMatchObject({ status: "incomplete", unavailable: [], missing: [], clashes: [] });
    expect(availability(found.item, claude)).toEqual({
      available: false,
      how: "none",
      reason: "incomplete",
    });
    expect(listItems(pstack, { kind: "agent", cli: claude }).map((item) => item.id)).toEqual([
      "pstack.agent.comment-sicko",
    ]);
  });

  it("keeps the bundle context through item lookup and client-filtered lists", () => {
    const egm = content("egm");
    const claude = profile("claude-code");
    const found = getItem(egm, "egm.agent.bootstrap_orchestrator");
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    expect(
      planInstall([found.item.id], [egm], [claude], { scope: "project", data: null }).status,
    ).toBe("ok");
    expect(availability(found.item, claude)).toEqual({ available: true, how: "rendered" });
    expect(listItems(egm, { kind: "agent", cli: claude }).map((item) => item.id)).toContain(
      found.item.id,
    );
    const listed = listItems(egm).find((item) => item.id === found.item.id);
    if (listed === undefined) throw new Error("the agent is listed");
    expect(availability(listed, claude)).toEqual({ available: true, how: "rendered" });
  });
});
