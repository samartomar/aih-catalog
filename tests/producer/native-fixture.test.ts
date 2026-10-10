import { describe, expect, it } from "vitest";
import { parseBaseRelease } from "../../src/producer/base.js";
import { buildCandidate } from "../../src/producer/candidate.js";
import { ProducerRefusal } from "../../src/producer/errors.js";
import { checkCandidateFiles } from "../../src/producer/integrity.js";
import {
  committedRelease,
  declaration,
  memoryTree,
  PINNED_REVISION,
  packageIdentity,
  pinnedUpstreamFiles,
  sha256,
} from "./helpers.js";

const FIXTURE_DOC = "release/release-native-fixture.json";
const BUNDLES_DOC = "release/release-native-bundles.json";
const identity = packageIdentity();

const refusal = (run: () => unknown): ProducerRefusal => {
  try {
    run();
  } catch (error) {
    if (error instanceof ProducerRefusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
};
const memberOf = (id: string) =>
  [...committedRelease().keys()].find((path) => path.includes(id)) as string;

describe("a base carrying the native-fixture documents", () => {
  it("accepts the committed base and keeps both documents", () => {
    const base = parseBaseRelease(committedRelease());
    expect([...base.nativeDocuments.keys()].sort()).toEqual([BUNDLES_DOC, FIXTURE_DOC]);
  });

  it("refuses an invalid native document as base-invalid", () => {
    const files = committedRelease();
    files.set(FIXTURE_DOC, Buffer.from("{}\n"));
    expect(refusal(() => parseBaseRelease(files)).reason).toBe("base-invalid");
  });

  it("refuses an absent native member as base-member-missing", () => {
    const files = committedRelease();
    files.delete(memberOf("native-fixtures/aihq.mcp.claude.graph-fixture/graph-server.mjs"));
    expect(refusal(() => parseBaseRelease(files)).reason).toBe("base-member-missing");
  });

  it("refuses a changed native member as base-member-mismatch", () => {
    const files = committedRelease();
    files.set(
      memberOf("native-bundles/aihq.native-bundle.claude.graph-fixture/expected-mcp.json"),
      Buffer.from("{}\n"),
    );
    expect(refusal(() => parseBaseRelease(files)).reason).toBe("base-member-mismatch");
  });

  it("refuses an undeclared file beside the native members as base-orphan-file", () => {
    const files = committedRelease().set(
      "release/materials/aihq/native-fixtures/stray.txt",
      Buffer.from("x"),
    );
    expect(refusal(() => parseBaseRelease(files)).reason).toBe("base-orphan-file");
  });
});

describe("a candidate for a different package version", () => {
  const version = "9.9.9";
  const result = buildCandidate({
    declaration: declaration(),
    tree: memoryTree(PINNED_REVISION, pinnedUpstreamFiles()),
    base: parseBaseRelease(committedRelease()),
    package: { ...identity, version },
  });
  const bytes = (path: string) => result.files.get(path) as Buffer;
  const bundleItem = JSON.parse(bytes(BUNDLES_DOC).toString("utf8")).items[0] as {
    materials: { id: string; path: string }[];
  };
  const bundle = JSON.parse(
    bytes(bundleItem.materials.find((m) => m.id === "bundle")?.path as string).toString("utf8"),
  );

  it("re-renders both documents for the candidate identity", () => {
    for (const path of [FIXTURE_DOC, BUNDLES_DOC]) {
      expect(JSON.parse(bytes(path).toString("utf8")).package.version).toBe(version);
    }
  });

  it("carries a bundle that pins the candidate's own fixture document", () => {
    expect(bundle.package).toEqual({ name: identity.name, version });
    expect(bundle.release).toEqual({
      path: `package/${FIXTURE_DOC}`,
      sha256: sha256(bytes(FIXTURE_DOC)),
      byteLength: bytes(FIXTURE_DOC).length,
    });
    // A restamp would keep the committed bundle, whose release pin names the old document.
    const committedBundle = JSON.parse(
      (
        committedRelease().get(
          bundleItem.materials.find((m) => m.id === "bundle")?.path as string,
        ) as Buffer
      ).toString("utf8"),
    );
    expect(bundle.release.sha256).not.toBe(committedBundle.release.sha256);
  });

  it("passes every whole-package check", () => {
    const failed = checkCandidateFiles(
      result.files,
      { ...identity, version },
      {
        authored: declaration().authored,
      },
    ).checks.filter((check) => !check.ok);
    expect(failed).toEqual([]);
  });
});
