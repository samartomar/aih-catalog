import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { readReleaseContent, resolveSelections } from "../../src/release/reader.js";

const bytes = readFileSync("release/release-ecc.content.json");
const checked = readReleaseContent(bytes, {
  expectedSha256: createHash("sha256").update(bytes).digest("hex"),
});
if (!checked.valid) throw new Error(JSON.stringify(checked.diagnostics));
const release = checked.release;

const setChoice = (setId: string, options?: Record<string, readonly string[]>) => {
  const set = release.sets?.find((candidate) => candidate.id === setId);
  if (!set) throw new Error(`Missing ECC set: ${setId}`);
  return {
    release: { releaseSha256: release.sha256, scope: "project" as const },
    setId,
    setSha256: set.setSha256,
    ...(options ? { options } : {}),
  };
};

const expectResolvedCount = (
  label: string,
  sets: readonly ReturnType<typeof setChoice>[],
  count: number,
) => {
  const resolved = resolveSelections({
    releases: { [release.sha256]: release },
    roots: [],
    skips: [],
    sets,
  });
  expect(resolved.status, `${label}: ${JSON.stringify(resolved.diagnostics)}`).toBe("ok");
  expect(resolved.diagnostics, label).toEqual([]);
  if (resolved.status === "ok") expect(resolved.value.selections, label).toHaveLength(count);
};

it("accepts ECC's pre-ticked sets with TypeScript rules", () => {
  expectResolvedCount(
    "default ECC pick",
    [
      "ecc.rules.common",
      "ecc.module.rules-core",
      "ecc.module.agents-core",
      "ecc.module.commands-core",
      "ecc.module.hooks-runtime",
      "ecc.module.platform-configs",
      "ecc.module.workflow-quality",
      "ecc.rules.typescript",
    ].map((setId) => setChoice(setId)),
    246,
  );
});

it.each([
  ["ecc.profile.minimal", 315],
  ["ecc.profile.core", 315],
  ["ecc.profile.developer", 323],
  ["ecc.profile.security", 334],
  ["ecc.profile.research", 341],
  ["ecc.profile.full", 476],
])("accepts %s with TypeScript rules", (profile, count) => {
  expectResolvedCount(profile, [setChoice(profile, { languages: ["typescript"] })], count);
});

it("keeps npm-acquired MCP servers as explicit choices with required inputs", () => {
  const acquisition = JSON.parse(readFileSync("producer/ecc/mcp-acquisition.json", "utf8")) as {
    providers: Record<string, unknown>;
  };
  const itemIds = Object.keys(acquisition.providers).map((key) => `ecc.mcp.${key}`);
  expect(itemIds).toHaveLength(15);
  for (const itemId of itemIds) {
    expect(
      release.items.some((item) => item.id === itemId),
      itemId,
    ).toBe(true);
    const resolved = resolveSelections({
      releases: { [release.sha256]: release },
      roots: [
        {
          releaseSha256: release.sha256,
          itemId,
          scope: "project",
          configuration: {},
        },
      ],
      skips: [],
    });
    expect(resolved.status, itemId).toBe("refused");
    if (resolved.status !== "refused") continue;
    const diagnostics = resolved.diagnostics.flatMap(
      (diagnostic) => diagnostic.details?.diagnostics ?? [],
    );
    expect(
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.reason === "input-required" &&
          diagnostic.blocking &&
          ["/selections/0/configuration/npmCache", "/selections/0/configuration/npmCli"].includes(
            diagnostic.path ?? "",
          ),
      ),
      itemId,
    ).toHaveLength(2);
  }
});
