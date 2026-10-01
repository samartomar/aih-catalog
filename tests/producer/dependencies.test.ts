import { describe, expect, it } from "vitest";
import { parseBaseRelease } from "../../src/producer/base.js";
import { buildCandidate } from "../../src/producer/candidate.js";
import { parseDeclaration } from "../../src/producer/declaration.js";
import { ProducerRefusal } from "../../src/producer/errors.js";
import { checkCandidateFiles } from "../../src/producer/integrity.js";
import { withAuthoredItems } from "./authored.js";
import { MIT } from "./git-fixture.js";
import { memoryTree, REPOSITORY } from "./helpers.js";

const PACKAGE = { name: "@aihq/catalog", version: "0.3.0" };
const A = "a".repeat(40);
const B = "b".repeat(40);
const skill = (name: string, body = "Body.") =>
  `---\nname: ${name}\ndescription: ${name} description\n---\n\n${body}\n`;
const path = (name: string) => `skills/productivity/${name}/SKILL.md`;
const entry = (name: string, requires: string[] = []) => ({
  id: `fx.${name}`,
  source: "fx",
  label: name,
  skillPath: path(name),
  requires: requires.map((required) => `fx.${required}`),
});
const declare = (...items: ReturnType<typeof entry>[]) =>
  parseDeclaration({
    format: "aihq-catalog-producer-declaration",
    version: 1,
    sources: [{ id: "fx", repository: REPOSITORY, licensePath: "LICENSE", license: "MIT" }],
    items,
  });
const upstream = (names: string[], extra: Record<string, string> = {}) => ({
  LICENSE: MIT,
  ...Object.fromEntries(names.map((name) => [path(name), skill(name)])),
  ...extra,
});
const declaration = declare(entry("one", ["two"]), entry("two"), entry("three"));
const genesis = () =>
  buildCandidate({
    declaration,
    tree: memoryTree(A, upstream(["one", "two", "three"])),
    package: PACKAGE,
  }).files as Map<string, Buffer>;
const refusal = (run: () => unknown): ProducerRefusal => {
  try {
    run();
  } catch (error) {
    if (error instanceof ProducerRefusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
};

describe("removal is evaluated on the resulting graph", () => {
  it("allows removing an item in the same step that drops its dependent's edge", () => {
    const next = declare(entry("one"), entry("two"), entry("three"));
    const result = buildCandidate({
      declaration: next,
      tree: memoryTree(B, upstream(["one", "three"])),
      base: parseBaseRelease(genesis()),
      package: PACKAGE,
    });
    const states = Object.fromEntries(result.report.items.map((e) => [e.id, e.state]));
    expect(states).toEqual({ "fx.one": "changed", "fx.three": "unchanged", "fx.two": "removed" });
    expect(checkCandidateFiles(result.files, PACKAGE).ok).toBe(true);
  });

  it("still refuses when a retained declared item keeps its edge to a removed one", () => {
    const error = refusal(() =>
      buildCandidate({
        declaration,
        tree: memoryTree(B, upstream(["one", "three"])),
        base: parseBaseRelease(genesis()),
        package: PACKAGE,
      }),
    );
    expect(error.reason).toBe("required-item-removed");
    expect(error.details).toMatchObject({ removed: ["fx.two"], blocked: ["fx.one"] });
  });

  it("refuses when another source's released item requires the removed one", () => {
    const base = withAuthoredItems(genesis(), [{ id: "ext.uses-two", requires: ["fx.two"] }]);
    const next = declare(entry("one"), entry("two"), entry("three"));
    const error = refusal(() =>
      buildCandidate({
        declaration: next,
        tree: memoryTree(B, upstream(["one", "three"])),
        base: parseBaseRelease(base),
        package: PACKAGE,
      }),
    );
    expect(error.reason).toBe("required-item-removed");
    expect(error.details).toMatchObject({ blocked: ["ext.uses-two"] });
  });
});

describe("dependents in other sources", () => {
  const base = () =>
    withAuthoredItems(genesis(), [
      { id: "ext.uses-two", requires: ["fx.two"] },
      { id: "ext.uses-ext", requires: ["ext.uses-two"] },
      { id: "ext.independent" },
    ]);

  it("are revalidated and reported without changing their bytes or provenance", () => {
    const baseRelease = parseBaseRelease(base());
    const result = buildCandidate({
      declaration,
      tree: memoryTree(B, {
        ...upstream(["one", "two", "three"]),
        [path("two")]: skill("two", "New."),
      }),
      base: baseRelease,
      package: PACKAGE,
    });
    const byId = Object.fromEntries(result.report.items.map((e) => [e.id, e]));
    expect(byId["fx.two"]?.state).toBe("changed");
    expect(byId["ext.uses-two"]).toMatchObject({
      state: "dependent-confirmed",
      dependsOnChanged: ["fx.two"],
    });
    expect(byId["ext.uses-ext"]).toMatchObject({
      state: "dependent-confirmed",
      dependsOnChanged: ["fx.two"],
    });
    expect(byId["ext.independent"]?.state).toBe("unchanged");
    for (const id of ["ext.uses-two", "ext.uses-ext", "ext.independent"]) {
      expect(byId[id]?.itemSha256After, id).toBe(byId[id]?.itemSha256Before);
    }
    for (const [file, bytes] of baseRelease.files) {
      if (file.includes("/authored/") || file.includes("ext.")) {
        expect(result.files.get(file)?.equals(bytes), file).toBe(true);
      }
    }
  });

  it("are not reported as dependents when nothing they depend on changed", () => {
    const result = buildCandidate({
      declaration,
      tree: memoryTree(B, upstream(["one", "two", "three"])),
      base: parseBaseRelease(base()),
      package: PACKAGE,
    });
    expect(result.report.summary["dependent-confirmed"]).toBe(0);
    expect(result.report.summary.unchanged).toBe(6);
  });
});

describe("item identity belongs to its source", () => {
  it("refuses a declaration that takes over another source's released item id", () => {
    const base = withAuthoredItems(genesis(), [{ id: "fx.takeover" }]);
    const next = declare(entry("one", ["two"]), entry("two"), entry("three"), entry("takeover"));
    const error = refusal(() =>
      buildCandidate({
        declaration: next,
        tree: memoryTree(B, upstream(["one", "two", "three", "takeover"])),
        base: parseBaseRelease(base),
        package: PACKAGE,
      }),
    );
    expect(error.reason).toBe("item-id-collision");
    expect(error.details).toMatchObject({ itemId: "fx.takeover" });
  });

  it("does not remove another source's item when its path is missing upstream", () => {
    const base = withAuthoredItems(genesis(), [{ id: "fx.takeover" }]);
    const next = declare(entry("one", ["two"]), entry("two"), entry("three"), entry("takeover"));
    expect(
      refusal(() =>
        buildCandidate({
          declaration: next,
          tree: memoryTree(B, upstream(["one", "two", "three"])),
          base: parseBaseRelease(base),
          package: PACKAGE,
        }),
      ).reason,
    ).toBe("item-id-collision");
  });
});
