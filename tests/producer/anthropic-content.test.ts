import { expect, it } from "vitest";

it("carries the optional Anthropic release and every retained release member through targeted refresh", async () => {
  const { buildCandidate } = await import("../../src/producer/candidate.js");
  const { parseBaseRelease } = await import("../../src/producer/base.js");
  const {
    committedRelease,
    declaration,
    memoryTree,
    packageIdentity,
    pinnedUpstreamFiles,
    SKILL_GRILLING,
  } = await import("./helpers.js");
  const retained = committedRelease();
  const upstream = pinnedUpstreamFiles();
  upstream[SKILL_GRILLING] = Buffer.concat([
    upstream[SKILL_GRILLING] ?? Buffer.alloc(0),
    Buffer.from("\nReviewed compatible source update.\n"),
  ]);
  const candidate = buildCandidate({
    declaration: declaration(),
    tree: memoryTree("b".repeat(40), upstream),
    base: parseBaseRelease(retained),
    package: packageIdentity(),
  });
  for (const [path, bytes] of retained) {
    if (
      path.startsWith("release/materials/github.com/mattpocock/") ||
      path.startsWith("release/recipes/mattpocock.") ||
      path === "release/release.json"
    )
      continue;
    expect(candidate.files.get(path), path).toEqual(bytes);
  }
  expect(candidate.files.get("release/release-anthropic.json")).toEqual(
    retained.get("release/release-anthropic.json"),
  );
}, 90_000);
