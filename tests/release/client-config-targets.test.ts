import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codexConfigBlockProblems } from "../../src/release/client-config-targets.js";

const literal = (value: string) => ({ literal: value });
const block = (id: string, segments: unknown[], root = "project") => ({
  id,
  kind: "text.block",
  target: { root, segments },
});
const recipeOf = (...operations: unknown[]) => ({ itemId: "item.a", recipe: { operations } });

describe("codexConfigBlockProblems", () => {
  it("names a text.block that targets .codex/config.toml", () => {
    expect(
      codexConfigBlockProblems([
        recipeOf(block("op", [literal(".codex"), literal("config.toml")])),
      ]),
    ).toEqual([{ reason: "codex-config-target", itemId: "item.a", operationId: "op" }]);
  });

  it.each([
    [".CODEX", "Config.TOML"],
    [".Codex", "config.toml"],
  ])("compares case-insensitively (%s/%s)", (directory, file) => {
    expect(
      codexConfigBlockProblems([recipeOf(block("op", [literal(directory), literal(file)]))]),
    ).toHaveLength(1);
  });

  it.each(["project", "userHome", "userState"])("matches under the %s root", (root) => {
    expect(
      codexConfigBlockProblems([
        recipeOf(block("op", [literal("deep"), literal(".codex"), literal("config.toml")], root)),
      ]),
    ).toHaveLength(1);
  });

  it("does not match a config.toml that is not inside a .codex directory", () => {
    expect(
      codexConfigBlockProblems([
        recipeOf(
          block("a", [literal("config.toml")]),
          block("b", [literal("app"), literal("config.toml")]),
        ),
      ]),
    ).toEqual([]);
  });

  it("fails closed when the last segment is an input slot", () => {
    expect(
      codexConfigBlockProblems([recipeOf(block("op", [literal(".codex"), { input: "file" }]))]),
    ).toEqual([{ reason: "codex-config-target-unresolved", itemId: "item.a", operationId: "op" }]);
  });

  it("fails closed when the segment before a literal config.toml is an input slot", () => {
    expect(
      codexConfigBlockProblems([recipeOf(block("op", [{ input: "dir" }, literal("config.toml")]))]),
    ).toEqual([{ reason: "codex-config-target-unresolved", itemId: "item.a", operationId: "op" }]);
  });

  it("does not fail closed on an input slot that cannot reach a config.toml leaf", () => {
    expect(
      codexConfigBlockProblems([recipeOf(block("op", [{ input: "dir" }, literal("AGENTS.md")]))]),
    ).toEqual([]);
  });

  it("does not fail closed on an input leaf outside a possible .codex directory", () => {
    expect(
      codexConfigBlockProblems([recipeOf(block("op", [literal("docs"), { input: "file" }]))]),
    ).toEqual([]);
  });

  it.each([
    [[literal(".codex"), { input: "file" }], { file: ["AGENTS.md"] }, 0],
    [[literal(".codex"), { input: "file" }], { file: ["notes.md", "Config.toml"] }, 1],
    [[{ input: "dir" }, literal("config.toml")], { dir: ["app"] }, 0],
    [[{ input: "dir" }, literal("config.toml")], { dir: [".codex"] }, 1],
    [[{ input: "dir" }, { input: "file" }], { dir: ["docs"] }, 0],
  ])("narrows an input slot to its enum (%j, %j)", (segments, enums, count) => {
    const inputs = Object.fromEntries(
      Object.entries(enums).map(([name, values]) => [
        name,
        { type: "string", required: true, enum: values },
      ]),
    );
    expect(
      codexConfigBlockProblems([
        { itemId: "item.a", recipe: { inputs, operations: [block("op", segments)] } },
      ]),
    ).toHaveLength(count);
  });

  it("names an operation without an id by its position", () => {
    expect(
      codexConfigBlockProblems([
        recipeOf(block("a", [literal("AGENTS.md")]), {
          kind: "text.block",
          target: { root: "project", segments: [literal(".codex"), literal("config.toml")] },
        }),
      ]),
    ).toEqual([{ reason: "codex-config-target", itemId: "item.a", operationId: "#1" }]);
  });

  it("ignores unrelated text.block targets and other .codex files", () => {
    expect(
      codexConfigBlockProblems([
        recipeOf(
          block("a", [literal("AGENTS.md")]),
          block("b", [literal(".codex"), literal("AGENTS.md")]),
          block("c", [literal("config.toml.bak")]),
          block("d", [literal("docs"), literal("config.toml"), literal("notes.md")]),
        ),
      ]),
    ).toEqual([]);
  });

  it("ignores other operation kinds that target the same path", () => {
    const target = { root: "project", segments: [literal(".codex"), literal("config.toml")] };
    expect(
      codexConfigBlockProblems([
        recipeOf(
          { id: "f", kind: "file.write", target },
          { id: "c", kind: "config.entries", target },
        ),
      ]),
    ).toEqual([]);
  });

  it("reports every offending operation of every recipe in order", () => {
    const target = [literal(".codex"), literal("config.toml")];
    expect(
      codexConfigBlockProblems([
        { itemId: "one", recipe: { operations: [block("x", target), block("y", target)] } },
        { itemId: "two", recipe: { operations: [block("z", target)] } },
      ]).map((problem) => `${problem.itemId}/${problem.operationId}`),
    ).toEqual(["one/x", "one/y", "two/z"]);
  });

  it("ignores recipes it cannot read as an operation list", () => {
    expect(
      codexConfigBlockProblems([
        { itemId: "a", recipe: undefined },
        { itemId: "b", recipe: { operations: "no" } },
        { itemId: "c", recipe: { operations: [null, 7, { id: "t", kind: "text.block" }] } },
      ]),
    ).toEqual([]);
  });
});

describe("Catalog Codex MCP recipes", () => {
  const recipes = readdirSync("release/recipes")
    .filter((name) => name.startsWith("ecc.codex.mcp."))
    .map((name) => ({
      itemId: name.replace(/\.json$/, ""),
      recipe: JSON.parse(readFileSync(`release/recipes/${name}`, "utf8")) as {
        operations: { id: string; kind: string; format?: string; target: unknown }[];
      },
    }));

  it("register servers through TOML config.entries on the Codex user configuration without a refusal", () => {
    expect(recipes).toHaveLength(32);
    for (const { recipe } of recipes) {
      const register = recipe.operations.find((operation) => operation.id === "register-server");
      expect(register).toMatchObject({
        kind: "config.entries",
        format: "toml",
        target: { root: "userHome", segments: [literal(".codex"), literal("config.toml")] },
      });
    }
    expect(codexConfigBlockProblems(recipes)).toEqual([]);
  });

  it("would refuse the same target as a text.block", () => {
    const swapped = recipes.map(({ itemId, recipe }) => ({
      itemId,
      recipe: {
        operations: recipe.operations.map((operation) =>
          operation.id === "register-server" ? { ...operation, kind: "text.block" } : operation,
        ),
      },
    }));
    expect(codexConfigBlockProblems(swapped)).toHaveLength(32);
  });
});
