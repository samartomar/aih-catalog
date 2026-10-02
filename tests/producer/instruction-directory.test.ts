import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSTRUCTION_DIRECTORY,
  instructionDirectoryProblem,
  parseDeclaration,
} from "../../src/producer/declaration.js";
import { ProducerRefusal } from "../../src/producer/errors.js";
import { declaration, root } from "./helpers.js";

/**
 * The instruction directory is a generation-time configuration of the authored
 * project context: an optional top-level declaration key, `ai-coding` when absent,
 * admitted only as a portable project-relative directory.
 */
const committedJson = (): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(root, "producer/declaration.json"), "utf8"));

const withDirectory = (value: unknown) => ({ ...committedJson(), instructionDirectory: value });

const refusal = (value: unknown): ProducerRefusal => {
  try {
    parseDeclaration(value);
  } catch (error) {
    expect(error).toBeInstanceOf(ProducerRefusal);
    return error as ProducerRefusal;
  }
  throw new Error("expected a declaration refusal");
};

describe("declaration instructionDirectory", () => {
  it("defaults to ai-coding when the key is absent, as in the committed declaration", () => {
    expect(DEFAULT_INSTRUCTION_DIRECTORY).toBe("ai-coding");
    expect("instructionDirectory" in committedJson()).toBe(false);
    expect(declaration().instructionDirectory).toBe("ai-coding");
  });

  it.each([
    "ai-coding",
    ".ai",
    ".ai/context",
    ".github/ai-context",
    "docs/AI_Context",
    "a.b/c-d/e_f",
    "x".repeat(128),
  ])("admits the project-relative directory %s", (value) => {
    expect(instructionDirectoryProblem(value)).toBeUndefined();
    expect(parseDeclaration(withDirectory(value)).instructionDirectory).toBe(value);
  });

  it.each([
    ["absolute", "/x"],
    ["drive", "C:/x"],
    ["drive-relative", "C:x"],
    ["escaping", ".."],
    ["escaping inside", "a/../b"],
    ["dot segment", "./a"],
    ["backslash", "a\\b"],
    ["empty", ""],
    ["empty segment", "a//b"],
    ["trailing slash", "a/"],
    ["trailing dot", "a."],
    ["git directory", ".git"],
    ["nested git directory", "a/.GIT/b"],
    ["space", "my dir"],
    ["backtick", "a`b"],
    ["colon", "a:b"],
    ["hash", "a#b"],
    ["bracket", "a]b"],
    ["leading dash", "-ai"],
    ["non-ASCII", "café"],
    ["control character", "a\u0001b"],
    ["Windows-reserved name", "con"],
    ["over-long", "x".repeat(129)],
  ])("refuses the %s directory", (_, value) => {
    expect(instructionDirectoryProblem(value)).toEqual(expect.any(String));
    const refused = refusal(withDirectory(value));
    expect(refused.reason).toBe("declaration-invalid");
    expect(refused.message).toContain("instructionDirectory");
  });

  it.each([
    ["number", 1],
    ["null", null],
    ["array", ["ai-coding"]],
    ["object", { path: "ai-coding" }],
  ])("refuses the %s value", (_, value) => {
    expect(instructionDirectoryProblem(value)).toEqual(expect.any(String));
    expect(refusal(withDirectory(value)).reason).toBe("declaration-invalid");
  });
});
