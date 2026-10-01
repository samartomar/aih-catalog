import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBaseRelease } from "../../src/producer/base.js";
import { buildCandidate } from "../../src/producer/candidate.js";
import { parseDeclaration } from "../../src/producer/declaration.js";
import { classifyDelta } from "../../src/producer/delta.js";
import { ProducerRefusal } from "../../src/producer/errors.js";
import { readCommitTree } from "../../src/producer/git-tree.js";
import { getItem, listItems, readRelease } from "../../src/release/reader.js";
import { FixtureRepository, UPSTREAM_A, UPSTREAM_B_CHANGES } from "./git-fixture.js";
import { REPOSITORY, sha256 } from "./helpers.js";

const PACKAGE = { name: "@aihq/catalog", version: "0.3.0" };
const skill = (name: string) => `skills/productivity/${name}/SKILL.md`;
const item = (name: string, requires: string[] = []) => ({
  id: `fixture.${name}`,
  source: "fixture-skills",
  label: name,
  skillPath: skill(name),
  requires: requires.map((required) => `fixture.${required}`),
});
const declare = (items: ReturnType<typeof item>[]) =>
  parseDeclaration({
    format: "aihq-catalog-producer-declaration",
    version: 1,
    sources: [
      { id: "fixture-skills", repository: REPOSITORY, licensePath: "LICENSE", license: "MIT" },
    ],
    items,
  });

const declarationA = declare([
  item("grill-me", ["grilling"]),
  item("grilling"),
  item("handoff"),
  item("wait-what"),
  item("writing-for-agents"),
]);
const declarationB = declare([
  item("grill-me", ["grilling"]),
  item("grilling"),
  item("handoff"),
  item("to-questionnaire"),
  item("wait-what"),
  item("writing-for-agents"),
]);

describe("targeted delta between two fixed immutable upstream commits", () => {
  const upstream = new FixtureRepository();
  let commitA = "";
  let commitB = "";
  let baseFiles: Map<string, Buffer>;

  const treeAt = (commit: string) =>
    readCommitTree({ repository: REPOSITORY, commit, run: upstream.run });

  beforeAll(() => {
    commitA = upstream.commit(UPSTREAM_A, "first fixed commit");
    commitB = upstream.commit(UPSTREAM_B_CHANGES, "second fixed commit");
    baseFiles = buildCandidate({
      declaration: declarationA,
      tree: treeAt(commitA),
      package: PACKAGE,
    }).files as Map<string, Buffer>;
  });
  afterAll(() => upstream.dispose());

  it("records two distinct immutable commits", () => {
    // Fixed author/dates make these ids reproducible: they are the recorded inputs.
    expect(commitA).toBe("9731d71f24e2308bb3ed715bf246a9c9d196ea63");
    expect(commitB).toBe("83a02e44425568a0e66b4270008bfa65e908f068");
  });

  it("classifies change, add, remove and a shared dependency, and preserves the rest", () => {
    const base = parseBaseRelease(baseFiles);
    const result = buildCandidate({
      declaration: declarationB,
      tree: treeAt(commitB),
      base,
      package: PACKAGE,
    });
    const states = Object.fromEntries(result.report.items.map((entry) => [entry.id, entry.state]));
    expect(states).toEqual({
      "fixture.grill-me": "dependent-confirmed",
      "fixture.grilling": "changed",
      "fixture.handoff": "changed",
      "fixture.to-questionnaire": "added",
      "fixture.wait-what": "removed",
      "fixture.writing-for-agents": "unchanged",
    });
    const dependent = result.report.items.find((entry) => entry.id === "fixture.grill-me");
    expect(dependent?.dependsOnChanged).toEqual(["fixture.grilling"]);
    expect(result.report.summary).toEqual({
      added: 1,
      changed: 2,
      removed: 1,
      unchanged: 1,
      "dependent-confirmed": 1,
      "provenance-only": 0,
    });

    // The candidate is a valid release in which the removed item is simply not found.
    const releaseBytes = result.files.get("release/release.json") as Buffer;
    const read = readRelease(releaseBytes, { expectedSha256: sha256(releaseBytes) });
    expect(read.valid).toBe(true);
    if (!read.valid) return;
    expect(listItems(read.release).map((entry) => entry.id)).toEqual([
      "fixture.grill-me",
      "fixture.grilling",
      "fixture.handoff",
      "fixture.to-questionnaire",
      "fixture.writing-for-agents",
    ]);
    expect(getItem(read.release, "fixture.wait-what").found).toBe(false);
  });

  it("keeps unaffected and dependent records, members and provenance byte for byte", () => {
    const base = parseBaseRelease(baseFiles);
    const result = buildCandidate({
      declaration: declarationB,
      tree: treeAt(commitB),
      base,
      package: PACKAGE,
    });
    const before = new Map(listItems(base.checked).map((entry) => [entry.id, entry]));
    const after = new Map(
      listItems(
        (
          readRelease(result.files.get("release/release.json") as Buffer, {
            expectedSha256: sha256(result.files.get("release/release.json") as Buffer),
          }) as { release: Parameters<typeof listItems>[0] }
        ).release,
      ).map((entry) => [entry.id, entry]),
    );
    for (const id of ["fixture.writing-for-agents", "fixture.grill-me"]) {
      expect(after.get(id)?.itemSha256, id).toBe(before.get(id)?.itemSha256);
      expect(after.get(id)?.sourceIds).toEqual(before.get(id)?.sourceIds);
      for (const member of [before.get(id)?.recipe, ...(before.get(id)?.materials ?? [])]) {
        expect(sha256(result.files.get(member?.path ?? "") ?? ""), member?.path).toBe(
          member?.sha256,
        );
        expect(
          result.files.get(member?.path ?? "")?.equals(baseFiles.get(member?.path ?? "") as Buffer),
        ).toBe(true);
      }
    }
    // Changed items moved to the new immutable revision; unaffected ones stayed on the old.
    expect(after.get("fixture.handoff")?.materials[1]?.path).toContain(commitB);
    expect(after.get("fixture.writing-for-agents")?.materials[1]?.path).toContain(commitA);
    expect(result.report.baseRevisions).toEqual([commitA]);
  });

  it("drops only superseded members and keeps the license shared with retained items", () => {
    const base = parseBaseRelease(baseFiles);
    const result = buildCandidate({
      declaration: declarationB,
      tree: treeAt(commitB),
      base,
      package: PACKAGE,
    });
    const prefixA = `release/materials/github.com/${REPOSITORY}/${commitA}/`;
    expect(result.report.files.dropped).toContain(`${prefixA}${skill("wait-what")}`);
    expect(result.report.files.dropped).toContain(`${prefixA}${skill("handoff")}`);
    expect(result.report.files.dropped).not.toContain(`${prefixA}LICENSE`);
    expect(result.files.has(`${prefixA}LICENSE`)).toBe(true);
    expect(result.files.has(`${prefixA}${skill("wait-what")}`)).toBe(false);
  });

  it("is reproducible: the same pin and base yield identical bytes", () => {
    const run = () =>
      buildCandidate({
        declaration: declarationB,
        tree: treeAt(commitB),
        base: parseBaseRelease(baseFiles),
        package: PACKAGE,
      });
    const first = run();
    const second = run();
    expect([...second.files.keys()]).toEqual([...first.files.keys()]);
    expect(sha256(second.files.get("release/release.json") as Buffer)).toBe(
      sha256(first.files.get("release/release.json") as Buffer),
    );
  });

  it("never turns an incomplete inventory into a removal", () => {
    const complete = treeAt(commitB);
    const partial = {
      ...complete,
      inventory: {
        ...complete.inventory,
        complete: false,
        paths: new Set([...complete.inventory.paths].filter((path) => path !== skill("handoff"))),
      },
    };
    const plan = classifyDelta({
      declaration: declarationB,
      tree: partial,
      base: parseBaseRelease(baseFiles),
    });
    const unknown = plan.items.filter((entry) => entry.state === "unknown").map((e) => e.id);
    expect(unknown).toContain("fixture.handoff");
    expect(plan.items.some((entry) => entry.state === "removed")).toBe(false);
    expect(() =>
      buildCandidate({
        declaration: declarationB,
        tree: partial,
        base: parseBaseRelease(baseFiles),
        package: PACKAGE,
      }),
    ).toThrow(ProducerRefusal);
  });

  it("treats a path below a submodule prefix as unknown, not removed", () => {
    const complete = treeAt(commitB);
    const tree = {
      ...complete,
      inventory: {
        ...complete.inventory,
        paths: new Set([...complete.inventory.paths].filter((path) => path !== skill("handoff"))),
        opaquePrefixes: ["skills/productivity"],
      },
    };
    const plan = classifyDelta({
      declaration: declarationB,
      tree,
      base: parseBaseRelease(baseFiles),
    });
    expect(plan.items.find((entry) => entry.id === "fixture.handoff")?.state).toBe("unknown");
  });
});
