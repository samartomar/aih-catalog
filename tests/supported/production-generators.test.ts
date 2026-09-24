import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJsonV1 } from "../../src/production/strict-json-v1.js";
import {
  compileMattPocockSkillCollectionV1,
  prepareMattPocockCollectionV1,
} from "../../src/production/workbench/mattpocock-provider-v1.js";
import { compilePonytailComponentCollectionV1 } from "../../src/production/workbench/ponytail-provider-v1.js";
import { compileCatalogProviderV1 } from "../../src/production/workbench/provider-compilation-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const data = (name: string) => resolve(root, "src", "production", "data", name);
const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

describe("Catalog production generators", () => {
  it("derives the Matt Pocock collection from the fetched snapshot", () => {
    const snapshot = json(data("mattpocock.snapshot.json"));
    const published = json(resolve(root, "defaults", "catalog-scanner-providers-v1.json")) as {
      collections: { mattpocock: unknown };
    };
    expect(canonicalJsonV1(prepareMattPocockCollectionV1(snapshot))).toBe(
      canonicalJsonV1(published.collections.mattpocock),
    );
  });

  it("compiles every pinned Matt Pocock skill with its frontmatter description", () => {
    const compiled = compileMattPocockSkillCollectionV1(
      prepareMattPocockCollectionV1(json(data("mattpocock.snapshot.json"))),
    );
    expect(compiled.declarations).toHaveLength(25);
    const detail = JSON.parse(compiled.detailBytes["detail:mattpocock/skill:tdd"] as string) as {
      skill: { description: string };
    };
    expect(detail.skill.description).toMatch(/^Test-driven development\./u);
  });

  it("rejects a snapshot whose bytes do not match its recorded digest", () => {
    const snapshot = json(data("mattpocock.snapshot.json")) as {
      entries: { sha256: string }[];
    };
    (snapshot.entries[0] as { sha256: string }).sha256 = "0".repeat(64);
    expect(() => prepareMattPocockCollectionV1(snapshot)).toThrow(/integrity mismatch/u);
  });

  it("curates only the skills the pinned upstream plugin ships, never its in-progress bucket", () => {
    const snapshot = json(data("mattpocock.snapshot.json")) as {
      upstream: { pin: string; pluginVersion: string };
      inclusion: { canonicalSkillPaths: string[] };
      entries: { path: string }[];
    };
    // mattpocock/skills@c55ee460: skills/in-progress (the new pr, the stub retro)
    // is beta, excluded from the plugin, and installed only one by one by name.
    expect(snapshot.upstream).toMatchObject({
      pin: "c55ee46073ed923f86ce59a5eb3b6d895095d1b7",
      pluginVersion: "1.2.3",
    });
    expect(snapshot.inclusion.canonicalSkillPaths).toHaveLength(25);
    expect(
      [
        ...snapshot.inclusion.canonicalSkillPaths,
        ...snapshot.entries.map((entry) => entry.path),
      ].filter((path) => path.startsWith("skills/in-progress/")),
    ).toEqual([]);
  });

  it("keeps no frozen derived Matt Pocock collection beside its snapshot", () => {
    expect(existsSync(data("mattpocock-collection-v1.json"))).toBe(false);
  });

  it("compiles the Ponytail components from the fetched snapshot deterministically", () => {
    const compile = () =>
      compileCatalogProviderV1(
        "ponytail",
        (input: unknown) => [compilePonytailComponentCollectionV1(input)],
        json(data("ponytail.snapshot.json")),
      );
    const first = compile();
    expect(canonicalJsonV1(compile())).toBe(canonicalJsonV1(first));
    const declarations = first.inputs[0]?.declarations ?? [];
    expect(declarations.map((entry) => entry.declaration.id)).toContain("ponytail/skill:ponytail");
    expect(Object.keys(first.inputs[0]?.sources ?? {})).toEqual(["source:ponytail"]);
  });

  it("declares the v4.10.0 Cursor hooks as their own components beside the Claude/Codex ones", () => {
    const snapshot = json(data("ponytail.snapshot.json")) as {
      source: { commit: string; version: string };
      files: { path: string }[];
      components: { id: string; fileRefs: string[]; metadata?: Record<string, unknown> }[];
    };
    expect(snapshot.source).toMatchObject({
      commit: "1d95ff7d39de12d87014ea40d4e22201bddc501b",
      version: "4.10.0",
    });
    const hooks = snapshot.components.filter((component) => component.id.startsWith("hook:"));
    expect(
      hooks.map((hook) => [hook.id, hook.metadata?.declaredHosts, hook.metadata?.event]),
    ).toEqual([
      ["hook:session-start", ["ClaudeCode", "Codex"], "SessionStart"],
      ["hook:subagent-start", ["ClaudeCode", "Codex"], "SubagentStart"],
      ["hook:user-prompt-submit", ["ClaudeCode", "Codex"], "UserPromptSubmit"],
      ["hook:cursor-session-start", ["Cursor"], "sessionStart"],
      ["hook:cursor-before-submit-prompt", ["Cursor"], "beforeSubmitPrompt"],
    ]);
    const cursor = hooks.filter((hook) => hook.id.startsWith("hook:cursor-"));
    // biome-ignore lint/style/noNonNullAssertion: both rows are asserted above
    expect(cursor.map((hook) => hook.metadata!.command)).toEqual([
      'node "PONYTAIL_DIR/hooks/ponytail-activate.js"',
      'node "PONYTAIL_DIR/hooks/ponytail-mode-tracker.js"',
    ]);
    for (const hook of cursor) {
      expect(hook.fileRefs.slice(0, 2)).toEqual([
        "hooks/cursor-hooks.json",
        "scripts/cursor-hooks.js",
      ]);
      for (const path of hook.fileRefs)
        expect(snapshot.files.map((file) => file.path)).toContain(path);
    }
  });

  it("rejects Ponytail file bytes that do not match their recorded digest", () => {
    const snapshot = json(data("ponytail.snapshot.json")) as { files: { sha256: string }[] };
    (snapshot.files[0] as { sha256: string }).sha256 = `sha256:${"0".repeat(64)}`;
    expect(() => compilePonytailComponentCollectionV1(snapshot)).toThrow(/digest mismatch/u);
  });

  it("rejects a Ponytail snapshot that names another repository", () => {
    const snapshot = json(data("ponytail.snapshot.json")) as { source: { repository: string } };
    snapshot.source.repository = "https://github.com/example/ponytail";
    expect(() => compilePonytailComponentCollectionV1(snapshot)).toThrow(/exact source identity/u);
  });
});
