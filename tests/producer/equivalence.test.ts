import { describe, expect, it } from "vitest";
import { buildCandidate } from "../../src/producer/candidate.js";
import {
  committedRelease,
  declaration,
  memoryTree,
  PINNED_REVISION,
  packageIdentity,
  pinnedUpstreamFiles,
  sha256,
} from "./helpers.js";

describe("genesis candidate from the pinned upstream tree", () => {
  it("reproduces the committed release byte for byte from the committed upstream bytes", () => {
    const tree = memoryTree(PINNED_REVISION, pinnedUpstreamFiles());
    const { files } = buildCandidate({
      declaration: declaration(),
      tree,
      package: packageIdentity(),
    });
    const committed = committedRelease();
    expect([...files.keys()].sort()).toEqual([...committed.keys()].sort());
    for (const [path, bytes] of committed) {
      expect(sha256(files.get(path) ?? ""), path).toBe(sha256(bytes));
    }
  });
});
