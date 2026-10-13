import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { compileProducerDeclaration } from "../../src/release/producer.js";
import { readRelease, resolveSelections } from "../../src/release/reader.js";

it("compiles pinned Superpowers writing-skills with explicit TDD background and exact support closure", () => {
  const declaration = JSON.parse(readFileSync("producer/superpowers/declaration.json", "utf8"));
  const snapshot = JSON.parse(readFileSync("producer/superpowers/snapshot.json", "utf8"));
  const source = snapshot.sources[0];
  const compiled = compileProducerDeclaration({
    declaration,
    sourceFiles: [
      {
        source: source.id,
        revision: source.revision,
        files: {
          ...Object.fromEntries(
            source.files.map((file: { path: string; base64: string }) => [
              file.path,
              new Uint8Array(Buffer.from(file.base64, "base64")),
            ]),
          ),
          ...Object.fromEntries(
            Object.entries(snapshot.recipes.superpowers).map(([path, text]) => [
              path,
              new TextEncoder().encode(text as string),
            ]),
          ),
        },
      },
    ],
  });
  expect(compiled.status, JSON.stringify(compiled.diagnostics)).toBe("ok");
  if (compiled.status !== "ok") return;
  const checked = readRelease(compiled.value.releaseBytes, {
    expectedSha256: compiled.value.releaseSha256,
  });
  expect(checked.valid).toBe(true);
  if (!checked.valid) return;
  const resolved = resolveSelections({
    releases: { [checked.release.sha256]: checked.release },
    roots: [
      {
        releaseSha256: checked.release.sha256,
        itemId: "superpowers.skill.writing-skills",
        scope: "project",
        configuration: {},
      },
    ],
    skips: [],
  });
  expect(resolved.status).toBe("ok");
  if (resolved.status !== "ok") return;
  expect(resolved.value.selections.map((selection) => selection.item.itemId)).toEqual(
    expect.arrayContaining(["superpowers.skill.test-driven-development", "superpowers.notices"]),
  );
  const item = checked.release.items.find((item) => item.id === "superpowers.skill.writing-skills");
  expect(
    item?.materials.some((file) => file.path.endsWith("writing-skills/render-graphs.js")),
  ).toBe(true);
  expect(
    checked.release.sources.some(
      (source) =>
        source.origin.kind === "git" &&
        source.origin.revision === "5bf4e78011075bcfc0dc295f0724994cd123ee71",
    ),
  ).toBe(true);
});

it("carries the optional Superpowers release and every retained release member through targeted refresh", async () => {
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
  expect(candidate.files.get("release/release-superpowers.json")).toEqual(
    retained.get("release/release-superpowers.json"),
  );
}, 90_000);
