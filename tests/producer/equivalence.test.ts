import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseBaseRelease } from "../../src/producer/base.js";
import { buildCandidate } from "../../src/producer/candidate.js";
import {
  committedRelease,
  declaration,
  memoryTree,
  PINNED_REVISION,
  packageIdentity,
  pinnedUpstreamFiles,
  root,
  SKILL_GRILLING,
  sha256,
} from "./helpers.js";

describe("genesis candidate from the pinned upstream tree", () => {
  it("reproduces the declared upstream items and members from the committed upstream bytes", () => {
    const tree = memoryTree(PINNED_REVISION, pinnedUpstreamFiles());
    const { files } = buildCandidate({
      declaration: declaration(),
      tree,
      package: packageIdentity(),
    });
    const committed = committedRelease();
    const generated = parseBaseRelease(files);
    const base = parseBaseRelease(committed);
    expect(generated.checked.items.map((item) => item.id)).toEqual(
      declaration()
        .items.map((item) => item.id)
        .sort(),
    );
    for (const item of generated.items) {
      const existing = base.items.find((found) => found.id === item.id);
      expect({ ...item, sourceIds: [] }).toEqual({ ...existing, sourceIds: [] });
      // A genesis source ID has no historical collision suffix; its exact origin is the same.
      expect(
        (item.sourceIds as string[]).map(
          (id) => generated.sources.find((source) => source.id === id)?.origin,
        ),
      ).toEqual(
        (existing?.sourceIds as string[]).map(
          (id) => base.sources.find((source) => source.id === id)?.origin,
        ),
      );
    }
    for (const [path, bytes] of files) {
      if (path !== "release/release.json")
        expect(sha256(bytes), path).toBe(sha256(committed.get(path) ?? ""));
    }
  });
});

const scratch = mkdtempSync(join(tmpdir(), "aih-context-producer-"));
afterAll(() => {
  expect(scratch.startsWith(join(tmpdir(), "aih-context-producer-"))).toBe(true);
  rmSync(scratch, { recursive: true, force: true });
});

describe("upstream refresh with authored context", () => {
  const advance = () => {
    const upstream = pinnedUpstreamFiles();
    upstream[SKILL_GRILLING] = Buffer.concat([
      upstream[SKILL_GRILLING] ?? Buffer.alloc(0),
      Buffer.from("\nUpdated upstream guidance.\n"),
    ]);
    return buildCandidate({
      declaration: declaration(),
      tree: memoryTree("b".repeat(40), upstream),
      base: parseBaseRelease(committedRelease()),
      package: packageIdentity(),
    });
  };

  it("preserves every authored context record, source and member during a targeted skill update", () => {
    const base = parseBaseRelease(committedRelease());
    const candidate = advance();
    const next = parseBaseRelease(candidate.files);
    expect(candidate.report.items.find((item) => item.id === "mattpocock.grilling")?.state).toBe(
      "changed",
    );
    const context = base.checked.items.filter((item) =>
      item.sourceIds.includes("aihq-project-context"),
    );
    expect(context).toHaveLength(19);
    for (const item of context) {
      expect(next.checked.items.find((found) => found.id === item.id)).toEqual(item);
      for (const member of [item.recipe, ...item.materials]) {
        expect(candidate.files.get(member.path)).toEqual(base.files.get(member.path));
      }
    }
    expect(next.sources.find((source) => source.id === "aihq-project-context")).toEqual(
      base.sources.find((source) => source.id === "aihq-project-context"),
    );
  });

  it("still checks authored context after the upstream pin advances without rewriting that candidate", () => {
    const candidate = advance();
    for (const [path, bytes] of candidate.files) {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), bytes);
    }
    const snapshot = "src/production/data/mattpocock.snapshot.json";
    mkdirSync(dirname(join(scratch, snapshot)), { recursive: true });
    writeFileSync(join(scratch, snapshot), readFileSync(join(root, snapshot)));
    const args = [join(root, "tools/generate-release.mjs"), "--check", scratch];
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key !== "AIHQ_RELEASE_BASELINE"),
    );
    expect(execFileSync(process.execPath, args, { encoding: "utf8", env })).toContain(
      "Checked authored context",
    );
    const router = join(scratch, "release/materials/aihq/project-context/ai-coding/RULE_ROUTER.md");
    writeFileSync(router, "changed authored template");
    const refused = spawnSync(process.execPath, args, { encoding: "utf8", env });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("is stale");
    expect(readFileSync(router, "utf8")).toBe("changed authored template");
    expect(readFileSync(join(scratch, "release/release.json"))).toEqual(
      candidate.files.get("release/release.json"),
    );
  });
});
