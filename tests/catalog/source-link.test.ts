import { describe, expect, it } from "vitest";
import { formats, limits } from "../../src/catalog/contracts.js";
import { parseSourceLink } from "../../src/catalog/source.js";

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4";

const candidate = (text: string) => {
  const result = parseSourceLink(text);
  if (result.status !== "recognised") throw new Error(`${text}: ${JSON.stringify(result)}`);
  return result.candidate;
};

describe("parseSourceLink", () => {
  it("keeps the ref and subpath of a GitHub tree link", () => {
    expect(parseSourceLink("https://github.com/cursor/plugins/tree/main/pstack")).toEqual({
      schema: formats.sourceLink,
      status: "recognised",
      candidate: {
        kind: "git",
        repository: "https://github.com/cursor/plugins",
        ref: "main",
        subpath: "pstack",
      },
    });
  });

  it("reads local paths and file URLs as local folders, spaces included", () => {
    for (const path of ["./x", "../x", "~/x", "/x", "C:\\x", "/my skills/x"])
      expect(candidate(path)).toEqual({ kind: "local", path });
    expect(candidate("file:///srv/my%20skills")).toEqual({ kind: "local", path: "/srv/my skills" });
    expect(candidate("file:///C:/skills")).toEqual({ kind: "local", path: "C:/skills" });
  });

  it("reads any HTTPS Git host, SSH and owner/repo shorthand without .git", () => {
    expect(candidate("https://git.example.org/team/tools.git")).toEqual({
      kind: "git",
      repository: "https://git.example.org/team/tools",
    });
    expect(candidate("git@github.com:owner/repo.git")).toEqual({
      kind: "git",
      repository: "git@github.com:owner/repo.git",
    });
    expect(candidate("owner/repo")).toEqual({
      kind: "git",
      repository: "https://github.com/owner/repo",
    });
  });

  it("keeps blob and GitLab subpaths, and an exact commit ref", () => {
    expect(candidate(`https://github.com/owner/repo/blob/${SHA}/skills/a/SKILL.md`)).toEqual({
      kind: "git",
      repository: "https://github.com/owner/repo",
      ref: SHA,
      subpath: "skills/a/SKILL.md",
    });
    expect(candidate("https://gitlab.com/group/sub/repo/-/tree/v2/rules")).toEqual({
      kind: "git",
      repository: "https://gitlab.com/group/sub/repo",
      ref: "v2",
      subpath: "rules",
    });
    expect(candidate("https://gitlab.com/group/repo/-/blob/main/rules/a.md")).toEqual({
      kind: "git",
      repository: "https://gitlab.com/group/repo",
      ref: "main",
      subpath: "rules/a.md",
    });
  });

  it("reads npm specs as an exact version or a range, never pinning a range", () => {
    expect(candidate("pkg")).toEqual({ kind: "npm", package: "pkg" });
    expect(candidate("@s/pkg@1.2.0")).toEqual({ kind: "npm", package: "@s/pkg", version: "1.2.0" });
    expect(candidate("@s/pkg@^1")).toEqual({ kind: "npm", package: "@s/pkg", range: "^1" });
    expect(candidate("pkg@01.2.3")).toEqual({ kind: "npm", package: "pkg", range: "01.2.3" });
    expect(candidate("npx -y pkg@1.2.3")).toEqual({
      kind: "npm",
      package: "pkg",
      version: "1.2.3",
    });
    expect(candidate("npx @s/pkg@latest")).toEqual({
      kind: "npm",
      package: "@s/pkg",
      range: "latest",
    });
    expect(candidate("https://www.npmjs.com/package/@s/tool/v/1.2.3")).toEqual({
      kind: "npm",
      package: "@s/tool",
      version: "1.2.3",
    });
  });

  it("reads the source an installer command names with the same rules", () => {
    expect(
      candidate("npx skills add https://github.com/cursor/plugins/tree/main/pstack --skill x"),
    ).toEqual({
      kind: "git",
      repository: "https://github.com/cursor/plugins",
      ref: "main",
      subpath: "pstack",
    });
    expect(candidate("npx -y skills add owner/repo")).toEqual({
      kind: "git",
      repository: "https://github.com/owner/repo",
    });
    expect(candidate("git clone /srv/repos/tools")).toEqual({
      kind: "git",
      repository: "/srv/repos/tools",
    });
    expect(candidate("git clone -b main file:///srv/repos/tools.git")).toEqual({
      kind: "git",
      repository: "file:///srv/repos/tools.git",
      ref: "main",
    });
    expect(candidate("git clone --depth 1 -b v1.0 https://github.com/owner/repo.git")).toEqual({
      kind: "git",
      repository: "https://github.com/owner/repo",
      ref: "v1.0",
    });
  });

  it("returns unrecognised with a reason and never a guessed candidate", () => {
    for (const text of [
      "",
      "hello world",
      "http://github.com/owner/repo",
      "https://example.com/tool",
      "https://github.com/owner/repo/pulls/1",
      "https://github.com/owner/repo?tab=readme",
      "https://user:token@github.com/owner/repo",
      "https://github.com/owner/repo/tree/main/../escape",
      "ftp://example.com/a/b",
      "npx skills add not-a-repo",
      "npx skills list",
      "npm install tool",
      "github:owner/repo",
      "Owner/Repo/extra",
      "PKG",
      42 as unknown as string,
    ]) {
      const result = parseSourceLink(text);
      expect(result.status, String(text)).toBe("unrecognised");
      expect("candidate" in result).toBe(false);
      expect(result).toHaveProperty("reason");
    }
  });

  it("refuses text over the 2,048-character limit and accepts exactly 2,048", () => {
    const at = `./${"b".repeat(limits.sourceLinkCharacters - 2)}`;
    expect(parseSourceLink(at).status).toBe("recognised");
    const over = parseSourceLink(`${at}c`);
    expect(over).toMatchObject({ status: "refused", code: "limit", limit: "sourceLinkCharacters" });
    expect("candidate" in over).toBe(false);
  });

  it("returns the same frozen result each time", () => {
    const first = parseSourceLink("npx -y pkg@1.2.3");
    expect(JSON.stringify(parseSourceLink("npx -y pkg@1.2.3"))).toBe(JSON.stringify(first));
    expect(Object.isFrozen(first)).toBe(true);
  });
});
