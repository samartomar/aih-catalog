import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getItem, listItems, readRelease } from "../../src/release/reader.js";
import { sha256 } from "./fixtures.js";

const root = resolve(import.meta.dirname, "../..");
const bytesAt = (path: string) => readFileSync(resolve(root, path));
const textAt = (path: string) => bytesAt(path).toString("utf8");

/**
 * The shared project-owned context content (Catalog #49): one `aihq.project-context`
 * item delivers the routing entry point, the single shared-block source and the
 * long-form behavior core as pinned material with byte checks. Client pointers and
 * per-client adapter notes build on it. These tests pin the adapted canon: the
 * single-source invariants stay byte-identical across both depths (donor drift
 * guard), and retired vendor/engine routes stay out of the shipped text.
 */

function carried() {
  const bytes = bytesAt("release/release.json");
  const result = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
  return result.release;
}

function contextMaterial(id: string): { path: string; text: string } {
  const found = getItem(carried(), "aihq.project-context");
  if (!found.found) throw new Error("aihq.project-context missing from the carried release");
  const material = found.item.materials.find((member) => member.id === id);
  if (material === undefined) throw new Error(`aihq.project-context/${id} missing`);
  return { path: material.path, text: textAt(material.path) };
}

const RETIRED_ROUTES = [
  "aih bootstrap",
  "aih secrets",
  "aih init",
  "aih contract",
  "aih ecc",
  "aih superpowers",
  "ECC",
  "Superpowers",
  "code-review-graph",
  "codebase-memory",
];

describe("aihq.project-context item", () => {
  it("is carried with exactly the router, shared block source and behavior core as pinned material", () => {
    const found = getItem(carried(), "aihq.project-context");
    expect(found.found).toBe(true);
    if (!found.found) return;
    expect(found.item.dependencies).toEqual({ requires: [], optional: [], conflicts: [] });
    expect(found.item.scopes).toEqual(["project"]);
    const materials = Object.fromEntries(
      found.item.materials.map((member) => [member.id, member.path]),
    );
    expect(materials).toEqual({
      "behavior-core":
        "release/materials/aihq/project-context/ai-coding/rules/agent-behavior-core.md",
      "rule-router": "release/materials/aihq/project-context/ai-coding/RULE_ROUTER.md",
      "shared-block":
        "release/materials/aihq/project-context/ai-coding/adapters/_shared-canonical-block.md",
    });
    for (const member of found.item.materials) {
      const bytes = bytesAt(member.path);
      expect(sha256(bytes), member.path).toBe(member.sha256);
      expect(bytes.byteLength, member.path).toBe(member.byteLength);
    }
  });

  it("keeps the single-source invariants byte-identical between the shared block and the behavior core", () => {
    const section = (doc: string, heading: string) =>
      doc.split(`\n## ${heading}\n\n`)[1]?.split("\n\n## ")[0] ?? "";
    const block = contextMaterial("shared-block").text;
    const core = contextMaterial("behavior-core").text;
    const shared = section(block, "Invariants")
      .split("\n")
      .filter((line) => line.length > 0);
    expect(shared.length).toBeGreaterThanOrEqual(5);
    for (const line of shared) expect(core).toContain(`\n${line}\n`);
    // The behavior core appends its core-only evidence invariant after the shared list.
    const coreInvariants = section(core, "Invariants (always hold)").split("\n");
    expect(coreInvariants.slice(0, shared.length)).toEqual(shared);
    expect(coreInvariants[shared.length]).toMatch(/^- Repo evidence /);
    // The compact and long-form reporting renderings both come from the one authored pair.
    expect(block).toContain("## Reporting\n");
    expect(core).toContain("## Reporting a change\n");
  });

  it("routes the shared block through the router and the behavior core", () => {
    const block = contextMaterial("shared-block").text;
    expect(block).toContain("`ai-coding/RULE_ROUTER.md`");
    expect(block).toContain("`ai-coding/rules/agent-behavior-core.md`");
    expect(block).toContain("## External action boundary");
    const router = contextMaterial("rule-router").text;
    expect(router).toContain("`ai-coding/rules/agent-behavior-core.md`");
    expect(router).toContain("`ai-coding/adapters/<your-tool>.md`");
  });

  it("carries the accepted session and incomplete-context guidance in the shared entry body", () => {
    const block = contextMaterial("shared-block").text;
    expect(block).toContain("next new session");
    expect(block).toContain("missing or exceeds loading limits");
    expect(block).toContain("warn and continue with the context that loaded");
    expect(block).toContain("author-declared fallback");
    expect(block).toContain("author requires stopping");
  });

  it("routes every client to shared author-owned project guidance without managing that file", () => {
    const block = contextMaterial("shared-block").text;
    const router = contextMaterial("rule-router").text;
    expect(block).toContain("`ai-coding/PROJECT.md`");
    expect(router).toContain("`ai-coding/PROJECT.md`");
    expect(router).toContain("author-owned");
    const release = carried();
    for (const item of listItems(release)) {
      expect(item.materials.some((material) => material.path.endsWith("/PROJECT.md"))).toBe(false);
      const recipe = JSON.parse(textAt(item.recipe.path));
      for (const operation of recipe.operations) {
        expect(
          operation.target?.segments?.some(
            (segment: { literal?: string }) => segment.literal === "PROJECT.md",
          ),
        ).not.toBe(true);
      }
    }
  });

  it("keeps the retained principle order aligned in compact and long-form guidance", () => {
    const block = contextMaterial("shared-block").text;
    const core = contextMaterial("behavior-core").text;
    expect([...block.matchAll(/^- \*\*(.+?)\*\*/gm)].map((match) => match[1])).toEqual([
      "Think before coding",
      "Simplicity first",
      "Surgical changes",
      "Goal-driven",
    ]);
    expect([...core.matchAll(/^## \d+\. (.+)$/gm)].map((match) => match[1])).toEqual([
      "Think before coding",
      "Simplicity first",
      "Surgical changes",
      "Goal-driven execution",
    ]);
  });

  it("keeps retired engine and vendor routes out of every context file", () => {
    for (const id of ["rule-router", "shared-block", "behavior-core"]) {
      const { path, text } = contextMaterial(id);
      for (const route of RETIRED_ROUTES)
        expect(text, `${path} must not contain ${route}`).not.toContain(route);
    }
  });
});

/** One pointer item's parsed Core recipe. */
function pointerRecipe(key: string) {
  const found = getItem(carried(), `aihq.project-context-pointer.${key}`);
  if (!found.found) throw new Error(`pointer item ${key} missing`);
  return { item: found.item, recipe: JSON.parse(textAt(found.item.recipe.path)) };
}

type Material = { id: string; path: string; sha256: string; byteLength: number };

/** The item's single declared material, or a test failure. */
function onlyMaterial(item: { materials: readonly Material[] }): Material {
  if (item.materials.length !== 1) throw new Error("expected exactly one material");
  const [material] = item.materials;
  if (material === undefined) throw new Error("material missing");
  return material;
}

/** A successful configureItem result's provenance, or a test failure. */
function provenanceOf(configured: {
  valid: boolean;
  provenance?: { manifestSha256: string; itemSha256: string };
  diagnostics?: unknown;
}) {
  if (!configured.valid || configured.provenance === undefined) {
    throw new Error(JSON.stringify(configured.diagnostics));
  }
  return configured.provenance;
}

const MERGED_POINTERS: Array<[string, string[]]> = [
  ["agents-md", ["AGENTS.md"]],
  ["claude-md", ["CLAUDE.md"]],
  ["copilot-instructions", [".github", "copilot-instructions.md"]],
  ["gemini-md", ["GEMINI.md"]],
  ["windsurfrules", [".windsurfrules"]],
];
const OWNED_POINTERS: Array<[string, string[]]> = [
  ["cursor-rules", [".cursor", "rules", "00-canon.mdc"]],
  ["kiro-steering", [".kiro", "steering", "00-canon.md"]],
];
const START_MARKER = "<!-- BEGIN aihq:context:shared -->";
const END_MARKER = "<!-- END aihq:context:shared -->";

describe("aihq.project-context-pointer items", () => {
  it("carries exactly the seven native entry files of the approved client baseline, each requiring the shared context", () => {
    const ids = listItems(carried())
      .filter((item) => item.id.startsWith("aihq.project-context-pointer."))
      .map((item) => item.id);
    expect(ids).toEqual(
      [...MERGED_POINTERS, ...OWNED_POINTERS]
        .map(([key]) => `aihq.project-context-pointer.${key}`)
        .sort(),
    );
    for (const id of ids) {
      const found = getItem(carried(), id);
      if (!found.found) throw new Error(id);
      expect(found.item.dependencies.requires).toEqual([{ itemId: "aihq.project-context" }]);
      expect(found.item.scopes).toEqual(["project"]);
    }
  });

  it.each(
    MERGED_POINTERS,
  )("merges %s as one text.block with literal pinned content and no claimed check", (key, path) => {
    const { item, recipe } = pointerRecipe(key);
    expect(item.materials).toEqual([]);
    expect(recipe.materials).toEqual([]);
    expect(recipe.checks).toEqual([]);
    expect(recipe.operations).toHaveLength(1);
    const [op] = recipe.operations;
    expect(op).toMatchObject({
      kind: "text.block",
      scope: "project",
      blockId: "aih-context-shared",
      startMarker: START_MARKER,
      endMarker: END_MARKER,
      action: "set",
      requires: [],
      checks: [],
    });
    expect(op.target).toEqual({
      root: "project",
      segments: path.map((segment) => ({ literal: segment })),
    });
    const content = op.content.literal as string;
    // A merged block can never promise whole-file bytes: user text outside the
    // markers is preserved, so the operation honestly supplies no check.
    expect(content).not.toContain(START_MARKER);
    expect(content).not.toContain(END_MARKER);
    // The shared essentials ride inline — native clients compose the entry file's
    // own bytes, and a bare link would deliver nothing loadable.
    expect(content).toContain(contextMaterial("shared-block").text.replace(/\n$/, ""));
    expect(content).toContain(`\`ai-coding/RULE_ROUTER.md\``);
  });

  it.each(
    OWNED_POINTERS,
  )("delivers %s as a canon-owned file with activation frontmatter and a byte check", (key, path) => {
    const { item, recipe } = pointerRecipe(key);
    const material = onlyMaterial(item);
    const bytes = bytesAt(material.path);
    expect(sha256(bytes)).toBe(material.sha256);
    expect(recipe.operations).toHaveLength(1);
    const [op] = recipe.operations;
    expect(op).toMatchObject({
      kind: "file.write",
      scope: "project",
      material: material.id,
      checks: ["pointer-sha256"],
    });
    expect(op.target).toEqual({
      root: "project",
      segments: path.map((segment) => ({ literal: segment })),
    });
    expect(recipe.checks).toEqual([
      expect.objectContaining({ kind: "file.sha256", sha256: material.sha256, target: op.target }),
    ]);
    const text = bytes.toString("utf8");
    // Activation frontmatter must be the file's first bytes; a merged block
    // cannot guarantee that on creation, which is why these two are canon-owned.
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain(START_MARKER);
    expect(text).toContain(END_MARKER);
    expect(text).toContain(contextMaterial("shared-block").text.replace(/\n$/, ""));
  });

  it("pins the exact Cursor and Kiro activation facts from the approved baseline", () => {
    const cursor = pointerRecipe("cursor-rules");
    const cursorText = textAt(onlyMaterial(cursor.item).path);
    expect(
      cursorText.startsWith(
        '---\ndescription: Routes to the AI canon in ai-coding/ (RULE_ROUTER.md)\nglobs: ["**/*"]\nalwaysApply: true\n---',
      ),
    ).toBe(true);
    const kiro = pointerRecipe("kiro-steering");
    const kiroText = textAt(onlyMaterial(kiro.item).path);
    expect(kiroText.startsWith("---\ninclusion: always\n---")).toBe(true);
    expect(kiroText).toContain("#[[file:ai-coding/RULE_ROUTER.md]]");
  });

  it("derives the AGENTS.md reader list from the carried baseline", () => {
    const { recipe } = pointerRecipe("agents-md");
    const content = recipe.operations[0].content.literal as string;
    expect(content).toContain("Codex CLI, Antigravity, OpenCode, Zed, Kimi Code, and Kiro");
  });
});

/** The approved eleven-client baseline: id, label and required pointer keys, in registry order. */
const CLIENT_BASELINE: Array<[string, string, string[]]> = [
  ["claude", "Claude Code", ["claude-md"]],
  ["codex", "Codex CLI", ["agents-md"]],
  ["cursor", "Cursor", ["cursor-rules"]],
  ["antigravity", "Antigravity", ["agents-md", "gemini-md"]],
  ["gemini", "Gemini CLI", ["gemini-md"]],
  ["copilot", "GitHub Copilot", ["copilot-instructions"]],
  ["windsurf", "Windsurf", ["windsurfrules"]],
  ["opencode", "OpenCode", ["agents-md"]],
  ["zed", "Zed", ["agents-md"]],
  ["kimi", "Kimi Code", ["agents-md"]],
  ["kiro", "Kiro", ["kiro-steering"]],
];

describe("aihq.client items", () => {
  it("carries every approved client with its adapter note and explicit pointer dependencies", () => {
    const items = listItems(carried());
    expect(items).toHaveLength(2 + 1 + 7 + 11);
    for (const [id, label, pointers] of CLIENT_BASELINE) {
      const found = getItem(carried(), `aihq.client.${id}`);
      expect(found.found, id).toBe(true);
      if (!found.found) continue;
      expect(found.item.label).toBe(`${label} context wiring`);
      expect(found.item.dependencies.requires).toEqual(
        pointers.map((key) => ({ itemId: `aihq.project-context-pointer.${key}` })),
      );
      expect(found.item.materials).toHaveLength(1);
      const material = onlyMaterial(found.item);
      expect(material.path).toBe(
        `release/materials/aihq/project-context/ai-coding/adapters/${id}.md`,
      );
      const note = textAt(material.path);
      expect(sha256(bytesAt(material.path))).toBe(material.sha256);
      expect(note).toContain(`# ${label} adapter`);
      expect(note).toContain("- Entry:");
      expect(note).toContain("- Rule loading:");
      expect(note).toContain("`ai-coding/RULE_ROUTER.md`");
      expect(note).toContain("must not push,");
      // Delivery is not loading; the note must say so for every client.
      expect(note).toContain(`Delivering this wiring does not prove ${label} loads it`);
      for (const route of RETIRED_ROUTES) expect(note, `${id}: ${route}`).not.toContain(route);
    }
  });

  it("validates the fully selected context family into an exact policy requires mapping", async () => {
    const { configureItem, validateSelectionSet } = await import("../../src/release/reader.js");
    const release = carried();
    const materialSource = { kind: "local", input: "catalog" } as const;
    const ids = [
      "aihq.project-context",
      ...[...MERGED_POINTERS, ...OWNED_POINTERS].map(
        ([key]) => `aihq.project-context-pointer.${key}`,
      ),
      ...CLIENT_BASELINE.map(([id]) => `aihq.client.${id}`),
    ];
    const selections = [];
    for (const itemId of ids) {
      const configured = configureItem({ release, itemId, configuration: {}, materialSource });
      const provenance = provenanceOf(configured);
      selections.push({
        id: itemId,
        item: {
          releaseSha256: provenance.manifestSha256,
          itemId,
          itemSha256: provenance.itemSha256,
        },
        configuration: {},
      });
    }
    const validated = validateSelectionSet({ releases: { [release.sha256]: release }, selections });
    if (!validated.valid || validated.requiresBySelectionId === undefined) {
      throw new Error(JSON.stringify(validated.diagnostics));
    }
    const requiresMap = validated.requiresBySelectionId;
    for (const [id, , pointers] of CLIENT_BASELINE) {
      expect(requiresMap[`aihq.client.${id}`]).toEqual(
        pointers.map((key) => `aihq.project-context-pointer.${key}`),
      );
    }
    for (const [key] of [...MERGED_POINTERS, ...OWNED_POINTERS]) {
      expect(requiresMap[`aihq.project-context-pointer.${key}`]).toEqual(["aihq.project-context"]);
    }
    expect(requiresMap["aihq.project-context"]).toEqual([]);
  });

  it("diagnoses a client selected without its pointer and a pointer without the context", async () => {
    const { configureItem, validateSelectionSet } = await import("../../src/release/reader.js");
    const release = carried();
    const materialSource = { kind: "local", input: "catalog" } as const;
    const select = (itemId: string) => {
      const configured = configureItem({ release, itemId, configuration: {}, materialSource });
      const provenance = provenanceOf(configured);
      return {
        id: itemId,
        item: {
          releaseSha256: provenance.manifestSha256,
          itemId,
          itemSha256: provenance.itemSha256,
        },
        configuration: {},
      };
    };
    const clientOnly = validateSelectionSet({
      releases: { [release.sha256]: release },
      selections: [select("aihq.client.claude")],
    });
    expect(clientOnly.valid).toBe(false);
    const pointerOnly = validateSelectionSet({
      releases: { [release.sha256]: release },
      selections: [select("aihq.project-context-pointer.claude-md")],
    });
    expect(pointerOnly.valid).toBe(false);
  });
});
