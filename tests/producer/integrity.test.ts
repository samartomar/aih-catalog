import { describe, expect, it } from "vitest";
import { buildCandidate } from "../../src/producer/candidate.js";
import { ProducerRefusal } from "../../src/producer/errors.js";
import { documentBytes } from "../../src/producer/generate.js";
import {
  assertCandidateIntegrity,
  checkCandidateFiles,
  INTEGRITY_CHECKS,
} from "../../src/producer/integrity.js";
import {
  committedRelease,
  declaration,
  memoryTree,
  PINNED_REVISION,
  packageIdentity,
  pinnedUpstreamFiles,
  sha256,
} from "./helpers.js";

const identity = packageIdentity();
const genesis = () =>
  new Map<string, Buffer>(
    buildCandidate({
      declaration: declaration(),
      tree: memoryTree(PINNED_REVISION, pinnedUpstreamFiles()),
      package: identity,
    }).files,
  );

interface ItemDoc {
  id: string;
  recipe: { sha256: string; byteLength: number };
  materials: { path: string }[];
  dependencies: { requires: { itemId: string }[] };
}
interface Doc {
  schema: string;
  items: ItemDoc[];
  sources: { id: string; origin: { kind: string } }[];
}
const itemOf = (document: Doc, id: string) => document.items.find((i) => i.id === id) as ItemDoc;
function rewrite(files: Map<string, Buffer>, mutate: (document: Doc) => void): Map<string, Buffer> {
  const next = new Map(files);
  const document = JSON.parse((next.get("release/release.json") as Buffer).toString("utf8")) as Doc;
  mutate(document);
  next.set("release/release.json", documentBytes(document));
  return next;
}
const failing = (files: Map<string, Buffer>) =>
  checkCandidateFiles(files, identity)
    .checks.filter((check) => !check.ok)
    .map((c) => c.name);
const member = (files: Map<string, Buffer>, suffix: string) =>
  [...files.keys()].find((path) => path.endsWith(suffix)) as string;

describe("whole-candidate integrity", () => {
  it("passes every check for a produced candidate and for the committed release", () => {
    for (const files of [genesis(), committedRelease()]) {
      const result = checkCandidateFiles(files, identity, { authored: declaration().authored });
      expect(result.checks.map((c) => c.name)).toEqual([...INTEGRITY_CHECKS]);
      expect(result.checks.filter((c) => !c.ok)).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it("fails altered, truncated, missing and undeclared members", () => {
    const base = genesis();
    const skill = member(base, "/grilling/SKILL.md");
    const altered = new Map(base).set(
      skill,
      Buffer.from("X".repeat((base.get(skill) as Buffer).length)),
    );
    expect(failing(altered)).toEqual(["member-bytes"]);
    const truncated = new Map(base).set(skill, (base.get(skill) as Buffer).subarray(0, 10));
    expect(failing(truncated)).toEqual(["member-bytes"]);
    const missing = new Map(base);
    missing.delete(skill);
    expect(failing(missing)).toContain("member-bytes");
    expect(failing(missing)).toContain("inventory-exact");
    expect(failing(new Map(base).set("release/stray.txt", Buffer.from("x")))).toEqual([
      "inventory-exact",
    ]);
  });

  it("fails recipe/configuration disagreement even when hashes are consistent", () => {
    const base = genesis();
    const recipePath = member(base, "recipes/mattpocock.grilling.json");
    const recipe = JSON.parse((base.get(recipePath) as Buffer).toString("utf8"));
    recipe.inputs.agentDirectory.default = ".other";
    const bytes = documentBytes(recipe);
    const files = rewrite(new Map(base).set(recipePath, bytes), (document) => {
      const item = itemOf(document, "mattpocock.grilling");
      item.recipe.sha256 = sha256(bytes);
      item.recipe.byteLength = bytes.length;
    });
    expect(failing(files)).toEqual(["recipe-configuration-agreement"]);
  });

  it("refuses a missing required dependency and a dependency cycle", () => {
    const base = genesis();
    const missing = rewrite(base, (document) => {
      itemOf(document, "mattpocock.grilling").dependencies.requires = [
        { itemId: "mattpocock.ghost" },
      ];
    });
    // The release reader itself refuses a dangling or cyclic required reference.
    expect(failing(missing)).toEqual(["release-envelope"]);
    const cycle = rewrite(base, (document) => {
      itemOf(document, "mattpocock.grilling").dependencies.requires = [
        { itemId: "mattpocock.grill-me" },
      ];
    });
    expect(failing(cycle)).toEqual(["release-envelope"]);
  });

  it("fails an unsupported format, another package and an unreferenced source", () => {
    const base = genesis();
    expect(
      failing(
        rewrite(base, (d) => {
          d.schema = "urn:aihq:catalog:release:9.0.0";
        }),
      ),
    ).toEqual(["release-envelope"]);
    const other = checkCandidateFiles(base, { name: "@aihq/other", version: identity.version });
    expect(other.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["package-identity"]);
    const extra = rewrite(base, (d) => {
      d.sources.push({ id: "zzz", origin: { kind: "authored" } });
    });
    expect(failing(extra)).toEqual(["source-references"]);
  });

  it("fails unsafe member paths and members outside their pinned revision", () => {
    const base = genesis();
    expect(
      failing(
        rewrite(base, (d) => {
          ((d.items[0] as ItemDoc).materials[0] as { path: string }).path = "release/../escape";
        }),
      ),
    ).toEqual(["release-envelope"]);
    const moved = new Map(base);
    const from = member(base, "/grilling/SKILL.md");
    const to = "release/materials/elsewhere/SKILL.md";
    moved.set(to, base.get(from) as Buffer);
    moved.delete(from);
    const files = rewrite(moved, (document) => {
      for (const item of document.items)
        for (const m of item.materials) if (m.path === from) m.path = to;
    });
    expect(failing(files)).toEqual(["provenance-paths"]);
  });

  it("throws a single refusal that names every failed check", () => {
    const base = genesis();
    base.set("release/stray.txt", Buffer.from("x"));
    try {
      assertCandidateIntegrity(base, identity);
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ProducerRefusal);
      expect((error as ProducerRefusal).reason).toBe("integrity-failed");
      expect((error as ProducerRefusal).message).toContain("inventory-exact");
    }
  });
});
