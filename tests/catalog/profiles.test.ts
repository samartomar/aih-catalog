import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readToolProfile } from "../../src/catalog/reader.js";
import { profile } from "./helpers.js";

const NINE = [
  "antigravity",
  "claude-code",
  "codex",
  "copilot",
  "cursor",
  "dsh",
  "kimi",
  "kiro",
  "opencode",
];
const profilesFolder = resolve(import.meta.dirname, "../../profiles");

describe("the nine shipped tool profiles", () => {
  it("read as canonical profile data with dated checks and no per-kind minimum versions", () => {
    for (const id of NINE) {
      const read = profile(id);
      expect(read.id).toBe(id);
      expect(read.checkedWith.length).toBeGreaterThan(0);
      for (const entry of read.checkedWith) expect(entry.date).toBe("2026-11-02");
    }
  });

  it("states dsh's unsupported kinds explicitly instead of inventing places", () => {
    const dsh = profile("dsh");
    expect(Object.keys(dsh.unsupported ?? {}).sort()).toEqual(["agent", "hook", "mcp"]);
    expect(dsh.places.agent).toBeUndefined();
    expect(dsh.places.mcp).toBeUndefined();
    expect(dsh.links.skill).toBe("not-documented");
  });

  it("documents links only where a client was seen loading a linked skill folder", () => {
    const linked = NINE.filter((id) => profile(id).links.skill === "documented");
    expect(linked).toEqual(["claude-code", "codex", "copilot", "kimi", "kiro", "opencode"]);
  });

  it("declares native input references only where evidenced", () => {
    expect(profile("claude-code").inputReferences["mcp-env"]).toEqual({ syntax: "$" + "{<name>}" });
    // Cursor's mcp.json and OpenCode's config documents expand these forms themselves.
    expect(profile("cursor").inputReferences["mcp-env"]).toEqual({ syntax: "$" + "{env:<name>}" });
    expect(profile("opencode").inputReferences["mcp-env"]).toEqual({ syntax: "{env:<name>}" });
    const recorded = ["claude-code", "cursor", "opencode"];
    for (const id of NINE.filter((candidate) => !recorded.includes(candidate))) {
      expect(profile(id).inputReferences["mcp-env"], id).toBe("unknown");
    }
  });

  it("offers a native plugin route only where a commit pin holds, with no presence check claimed", () => {
    const pins = Object.fromEntries(NINE.map((id) => [id, profile(id).plugins?.pin ?? "absent"]));
    expect(pins).toEqual({
      antigravity: "none",
      "claude-code": "holds",
      codex: "holds",
      copilot: "holds",
      cursor: "none",
      dsh: "absent",
      kimi: "drops-on-update",
      kiro: "absent",
      opencode: "holds",
    });
    expect(profile("kimi").plugins?.install).toBeUndefined();
    expect(profile("copilot").plugins).toMatchObject({
      pinForm: "local-marketplace",
      marketplaceFolder: ".aihq/marketplaces/<framework>/",
      warnings: ["cli-only-plugin"],
    });
    // Claude adds a marketplace at its current head, so it pins through a marketplace the plan
    // writes itself, in a folder of its own beside Copilot's.
    expect(profile("claude-code").plugins).toMatchObject({
      pinForm: "local-marketplace",
      marketplaceFolder: ".aihq/marketplaces/claude-code/<framework>/",
    });
    // Codex removes a plugin only by its marketplace-qualified name.
    expect(profile("codex").plugins?.remove).toEqual([
      ["codex", "plugin", "remove", "<plugin>@<marketplace-name>"],
    ]);
    for (const id of NINE) expect(profile(id).plugins?.verify ?? "none", id).toBe("none");
    const local = NINE.filter((id) => profile(id).localPlugins !== undefined);
    expect(local).toEqual(["antigravity", "claude-code"]);
    expect(Object.keys(profile("claude-code").localPlugins ?? {})).toEqual(["project"]);
  });

  it("refuses a profile with an unknown section or a place outside the project", () => {
    const bytes = readFileSync(join(profilesFolder, "codex.json"));
    const value = JSON.parse(new TextDecoder().decode(bytes));
    const encode = (document: unknown) =>
      new TextEncoder().encode(`${JSON.stringify(sortKeys(document), null, 2)}\n`);
    expect(readToolProfile(encode({ ...value, executes: ["rm"] }))).toMatchObject({
      status: "invalid",
      problems: [{ path: "/executes" }],
    });
    expect(
      readToolProfile(
        encode({
          ...value,
          places: { ...value.places, skill: { project: "../escape/<name>/" } },
        }),
      ),
    ).toMatchObject({ status: "invalid" });
  });
});

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  return value;
}
