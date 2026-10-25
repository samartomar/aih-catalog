import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readRecipe } from "../../src/release/node.js";

const root = resolve(import.meta.dirname, "../..");
const fixture = (name: string) => readFileSync(resolve(root, "fixtures", name));
const bytes = (text: string) => new TextEncoder().encode(text);
const guidance = (schema: string) =>
  JSON.stringify({
    schema,
    id: "guidance-file",
    description: "Deliver project guidance",
    inputs: { text: { type: "string", required: true, maxLength: 65536 } },
    materials: [],
    targets: ["project"],
    prerequisites: [],
    operations: [
      {
        id: "write",
        purpose: "Write shared project guidance",
        kind: "file.write",
        scope: "project",
        target: { root: "project", segments: [{ literal: "TEAM.md" }] },
        content: { input: "text" },
        requires: [],
        checks: [],
      },
    ],
    checks: [],
  });

describe("standalone Core recipe reader", () => {
  it.each(["1.0.0", "1.1.0", "1.3.0"])("admits the exported valid recipe %s", (version) => {
    const result = readRecipe(fixture(`core-recipe-${version}-valid.json`));
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.valid && result.recipe.schema).toBe(`urn:aihq:core:recipe:${version}`);
  });

  it.each(["1.0.0", "1.1.0", "1.3.0"])("refuses the exported invalid recipe %s", (version) => {
    const result = readRecipe(fixture(`core-recipe-${version}-invalid.json`));
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "INPUT_INVALID", reason: "recipe-invalid", blocking: true }),
    ]);
  });

  it.each(["1.0.0", "1.1.0", "1.3.0"])("admits a recipe with no Catalog item %s", (version) => {
    expect(readRecipe(bytes(guidance(`urn:aihq:core:recipe:${version}`))).valid).toBe(true);
  });

  it("refuses an unknown member under an admitted format", () => {
    const result = readRecipe(bytes('{"schema":"urn:aihq:core:recipe:1.1.0","unexpected":true}'));
    expect(result).toEqual({
      valid: false,
      diagnostics: [expect.objectContaining({ code: "INPUT_INVALID", reason: "recipe-invalid" })],
    });
  });

  it("refuses a Core recipe format Catalog does not admit, naming the admitted formats", () => {
    const result = readRecipe(bytes(guidance("urn:aihq:core:recipe:1.2.0")));
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "SCHEMA_UNSUPPORTED",
        reason: "recipe-schema-unsupported",
        encountered: "urn:aihq:core:recipe:1.2.0",
        supported: [
          "urn:aihq:core:recipe:1.0.0",
          "urn:aihq:core:recipe:1.1.0",
          "urn:aihq:core:recipe:1.3.0",
        ],
      }),
    ]);
  });

  it.each([
    ["duplicate keys", guidance("urn:aihq:core:recipe:1.0.0").replace("{", '{"id":"ignored",')],
    [
      "a number that loses its authored value",
      guidance("urn:aihq:core:recipe:1.0.0").replace("65536", "1e400"),
    ],
    ["invalid JSON", "{"],
    ["a byte-order mark", String.fromCharCode(0xfeff) + guidance("urn:aihq:core:recipe:1.0.0")],
    ["a non-object document", "[]"],
  ])("refuses %s as unreadable", (_name, text) => {
    expect(readRecipe(bytes(text)).diagnostics).toEqual([
      expect.objectContaining({ code: "INPUT_INVALID", reason: "recipe-unreadable" }),
    ]);
  });

  it("refuses malformed UTF-8 and non-byte input", () => {
    expect(readRecipe(new Uint8Array([0x7b, 0xff, 0x7d])).valid).toBe(false);
    expect(readRecipe("{}" as unknown as Uint8Array).diagnostics).toEqual([
      expect.objectContaining({ code: "INPUT_INVALID", reason: "recipe-unreadable" }),
    ]);
  });

  it("returns an immutable result", () => {
    const result = readRecipe(fixture("core-recipe-1.0.0-valid.json"));
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.valid && Object.isFrozen(result.recipe)).toBe(true);
  });
});
