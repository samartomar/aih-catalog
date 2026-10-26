import { expect, it } from "vitest";
import {
  PARSE_SOURCE_LINK_MAX_CHARACTERS,
  parseSourceLink,
} from "../../src/release/parse-source-link.js";

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4";

const recognised = (input: string) => {
  const result = parseSourceLink(input);
  if (result.status !== "recognised")
    throw new Error(`Expected a recognised result for ${JSON.stringify(input)}`);
  return result;
};

const unrecognised = (input: string) => {
  const result = parseSourceLink(input);
  if (result.status !== "unrecognised")
    throw new Error(`Expected an unrecognised result for ${JSON.stringify(input)}`);
  return result;
};

it("publishes the 2,048-character input limit as a constant", () => {
  expect(PARSE_SOURCE_LINK_MAX_CHARACTERS).toBe(2048);
});

it("parses a GitHub permalink to an exact git candidate without diagnostics", () => {
  expect(parseSourceLink(`https://github.com/owner/repo/blob/${SHA}/docs/README.md`)).toEqual({
    status: "recognised",
    candidate: { kind: "git", repository: "https://github.com/owner/repo", ref: SHA },
    diagnostics: [],
  });
  expect(parseSourceLink(`https://github.com/owner/repo/tree/${SHA}`)).toEqual({
    status: "recognised",
    candidate: { kind: "git", repository: "https://github.com/owner/repo", ref: SHA },
    diagnostics: [],
  });
});

it("reports a GitHub branch or tag reference as recognised but not exact", () => {
  const parsed = recognised("https://github.com/owner/repo/tree/main/src");
  expect(parsed.candidate).toEqual({
    kind: "git",
    repository: "https://github.com/owner/repo",
    ref: "main",
  });
  expect(parsed.diagnostics).toEqual([
    {
      code: "reference-not-exact",
      message:
        'The reference "main" is a branch, tag or other mutable pointer; it is reported as not exact and is never silently pinned.',
    },
  ]);
});

it("reports a bare GitHub repository link as not exact through its default branch", () => {
  const parsed = recognised("https://github.com/owner/repo");
  expect(parsed.candidate).toEqual({ kind: "git", repository: "https://github.com/owner/repo" });
  expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["reference-not-exact"]);
});

it("normalises a .git suffix away from the repository identity", () => {
  expect(recognised("https://github.com/owner/repo.git").candidate).toEqual({
    kind: "git",
    repository: "https://github.com/owner/repo",
  });
});

it("parses an npm package page at an exact version", () => {
  expect(parseSourceLink("https://www.npmjs.com/package/@scope/tool/v/1.2.3")).toEqual({
    status: "recognised",
    candidate: { kind: "npm", package: "@scope/tool", version: "1.2.3" },
    diagnostics: [],
  });
});

it("parses an npm package page without a version as latest, never exact", () => {
  const parsed = recognised("https://www.npmjs.com/package/tool");
  expect(parsed.candidate).toEqual({ kind: "npm", package: "tool" });
  expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["reference-not-exact"]);
});

it("parses npx -y package@1.2.3 as an exact npm candidate", () => {
  expect(parseSourceLink("npx -y package@1.2.3")).toEqual({
    status: "recognised",
    candidate: { kind: "npm", package: "package", version: "1.2.3" },
    diagnostics: [],
  });
  expect(recognised("npx @scope/tool@2.0.0").candidate).toEqual({
    kind: "npm",
    package: "@scope/tool",
    version: "2.0.0",
  });
});

it("parses npx without a version or with latest as not exact, without pinning", () => {
  for (const input of ["npx -y package", "npx package", "npx package@latest"]) {
    const parsed = recognised(input);
    expect(parsed.candidate).toEqual({ kind: "npm", package: "package" });
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "reference-not-exact",
    ]);
  }
});

it("parses an npm version range as not exact without inventing a version", () => {
  const parsed = recognised("npx -y package@^1.2.3");
  expect(parsed.candidate).toEqual({ kind: "npm", package: "package" });
  expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["reference-not-exact"]);
});

it("parses npx skills add with a GitHub link and keeps the skill name as a discovery note", () => {
  const exact = recognised(
    `npx skills add https://github.com/owner/repo/tree/${SHA} --skill review`,
  );
  expect(exact.candidate).toEqual({
    kind: "git",
    repository: "https://github.com/owner/repo",
    ref: SHA,
  });
  expect(exact.diagnostics).toEqual([
    {
      code: "discovery-note",
      message:
        'The selector "--skill review" is a non-authoritative discovery note; it never changes the candidate source.',
    },
  ]);
  const mutable = recognised("npx skills add https://github.com/owner/repo --skill review");
  expect(mutable.candidate).toEqual({ kind: "git", repository: "https://github.com/owner/repo" });
  expect(mutable.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    "reference-not-exact",
    "discovery-note",
  ]);
});

it("parses the MCP servers directory page and keeps it apart from any listed source", () => {
  const parsed = recognised("https://github.com/modelcontextprotocol/servers");
  expect(parsed.candidate).toEqual({
    kind: "git",
    repository: "https://github.com/modelcontextprotocol/servers",
  });
  expect(parsed.diagnostics).toEqual([
    {
      code: "reference-not-exact",
      message:
        'The reference "default branch" is a branch, tag or other mutable pointer; it is reported as not exact and is never silently pinned.',
    },
    {
      code: "discovery-note",
      message:
        "The MCP servers directory is a discovery listing, not a source; a listed server's upstream is never derived from the directory.",
    },
  ]);
});

it("parses an MCP directory entry page without pretending it is the listed source", () => {
  const parsed = recognised(
    "https://github.com/modelcontextprotocol/servers/tree/main/src/everything",
  );
  expect(parsed.candidate).toEqual({
    kind: "git",
    repository: "https://github.com/modelcontextprotocol/servers",
    ref: "main",
  });
  expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    "reference-not-exact",
    "discovery-note",
  ]);
});

it("parses a bare npm package name, exact only with an exact version", () => {
  expect(parseSourceLink("@scope/tool@1.2.3")).toEqual({
    status: "recognised",
    candidate: { kind: "npm", package: "@scope/tool", version: "1.2.3" },
    diagnostics: [],
  });
  const latest = recognised("tool");
  expect(latest.candidate).toEqual({ kind: "npm", package: "tool" });
  expect(latest.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["reference-not-exact"]);
});

it("refuses input above 2,048 characters with the named refusal and no candidate", () => {
  const input = `npx ${"a".repeat(2045)}`;
  expect(input.length).toBe(2049);
  const parsed = unrecognised(input);
  expect("candidate" in parsed).toBe(false);
  expect(parsed.diagnostics).toEqual([
    {
      code: "input-too-long",
      message:
        "Input exceeds the published limit of 2,048 characters for parseSourceLink; nothing was parsed.",
    },
  ]);
});

it("does not refuse input at exactly 2,048 characters with the length refusal", () => {
  const input = `npx ${"A".repeat(2044)}`;
  expect(input.length).toBe(2048);
  const parsed = unrecognised(input);
  expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("input-too-long");
});

it("returns unrecognised with a diagnostic and never a guessed candidate", () => {
  for (const input of [
    "",
    "   ",
    "hello world",
    "ftp://example.com/tool",
    "https://example.com/tool",
    "http://github.com/owner/repo",
    "npx",
    "npx skills add not-a-url",
    "npm install tool",
    "github.com/owner/repo",
    "https://github.com/owner",
    "https://github.com/owner/repo/extra/segments/here",
  ]) {
    const parsed = unrecognised(input);
    expect("candidate" in parsed).toBe(false);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toContain("unrecognised");
  }
});

it("rejects a non-string input as a programming error", () => {
  expect(() => parseSourceLink(42 as unknown as string)).toThrow(TypeError);
});

it("returns the same frozen result for repeated parses", () => {
  const input = "npx -y package@1.2.3";
  const first = parseSourceLink(input);
  const second = parseSourceLink(input);
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(recognised(input).candidate)).toBe(true);
  expect(Object.isFrozen(first.diagnostics)).toBe(true);
});
