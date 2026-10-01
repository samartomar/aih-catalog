import { describe, expect, it } from "vitest";
import { parseBaseRelease } from "../../src/producer/base.js";
import { buildCandidate } from "../../src/producer/candidate.js";
import { parseDeclaration } from "../../src/producer/declaration.js";
import { ProducerRefusal } from "../../src/producer/errors.js";
import { MIT } from "./git-fixture.js";
import { memoryTree, REPOSITORY, sha256 } from "./helpers.js";

const PACKAGE = { name: "@aihq/catalog", version: "0.3.0" };
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const skill = (name: string, body = "Body.") =>
  `---\nname: ${name}\ndescription: ${name} description\n---\n\n${body}\n`;
const path = (name: string, group = "productivity") => `skills/${group}/${name}/SKILL.md`;
const entry = (name: string, requires: string[] = [], group = "productivity") => ({
  id: `fx.${name}`,
  source: "fx",
  label: name,
  skillPath: path(name, group),
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
const baseFiles = () =>
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

describe("shared material", () => {
  it("changes every item that carries a changed shared license", () => {
    const result = buildCandidate({
      declaration,
      tree: memoryTree(B, { ...upstream(["one", "two", "three"]), LICENSE: `${MIT}Amended.\n` }),
      base: parseBaseRelease(baseFiles()),
      package: PACKAGE,
    });
    expect(result.report.items.map((e) => [e.id, e.state, e.operational])).toEqual([
      ["fx.one", "changed", ["material:license"]],
      ["fx.three", "changed", ["material:license"]],
      ["fx.two", "changed", ["material:license"]],
    ]);
  });
});

describe("provenance", () => {
  it("keeps unaffected provenance by default and reports a deliberate re-pin separately", () => {
    const tree = memoryTree(B, upstream(["one", "two", "three"]));
    const base = parseBaseRelease(baseFiles());
    const kept = buildCandidate({ declaration, tree, base, package: PACKAGE });
    expect(kept.report.summary.unchanged).toBe(3);
    expect(kept.report.files.written).toEqual(["release/release.json"].filter(() => false));
    expect(sha256(kept.files.get("release/release.json") as Buffer)).toBe(base.checked.sha256);

    const repinned = buildCandidate({
      declaration,
      tree,
      base,
      package: PACKAGE,
      advanceProvenance: true,
    });
    expect(repinned.report.summary).toMatchObject({ "provenance-only": 3, changed: 0, added: 0 });
    expect(repinned.report.items.every((e) => e.operational.length === 0)).toBe(true);
    expect(repinned.report.baseRevisions).toEqual([A]);
    const text = repinned.files.get("release/release.json")?.toString("utf8") ?? "";
    expect(text).toContain(B);
    expect(text).not.toContain(A);
  });

  it("reports a moved upstream directory as provenance only and a renamed directory as operational", () => {
    const base = parseBaseRelease(baseFiles());
    const moved = buildCandidate({
      declaration: declare(entry("one", ["two"], "engineering"), entry("two"), entry("three")),
      tree: memoryTree(B, {
        ...upstream(["two", "three"]),
        [path("one", "engineering")]: skill("one"),
      }),
      base,
      package: PACKAGE,
    });
    const one = moved.report.items.find((e) => e.id === "fx.one");
    expect(one).toMatchObject({
      state: "provenance-only",
      operational: [],
      provenance: ["upstream-path"],
    });

    const renamed = buildCandidate({
      declaration: declare(
        { ...entry("uno", ["two"]), id: "fx.one", label: "one" },
        entry("two"),
        entry("three"),
      ),
      tree: memoryTree(B, { ...upstream(["two", "three"]), [path("uno")]: skill("one") }),
      base: parseBaseRelease(baseFiles()),
      package: PACKAGE,
    });
    expect(renamed.report.items.find((e) => e.id === "fx.one")).toMatchObject({
      state: "changed",
      operational: ["upstream-path"],
    });
  });

  it("reports changed dependency declarations and labels as operational", () => {
    const next = declare(
      { ...entry("one", ["two"]), label: "One!" },
      entry("two"),
      entry("three", ["two"]),
    );
    const result = buildCandidate({
      declaration: next,
      tree: memoryTree(B, upstream(["one", "two", "three"])),
      base: parseBaseRelease(baseFiles()),
      package: PACKAGE,
    });
    const byId = Object.fromEntries(result.report.items.map((e) => [e.id, e]));
    expect(byId["fx.one"]).toMatchObject({ state: "changed", operational: ["label"] });
    expect(byId["fx.three"]).toMatchObject({ state: "changed", operational: ["requires"] });
    expect(byId["fx.two"]).toMatchObject({ state: "unchanged" });
  });
});

describe("refusals leave no candidate", () => {
  const run = (
    overrides: Partial<Parameters<typeof buildCandidate>[0]> & {
      tree?: ReturnType<typeof memoryTree>;
    },
  ) =>
    buildCandidate({
      declaration,
      tree: memoryTree(B, upstream(["one", "two", "three"])),
      base: parseBaseRelease(baseFiles()),
      package: PACKAGE,
      ...overrides,
    });

  it("refuses a repository the declaration does not carry", () => {
    expect(
      refusal(() => run({ tree: memoryTree(B, upstream([]), { repository: "evil/skills" }) }))
        .reason,
    ).toBe("repository-not-declared");
  });

  it("refuses to remove an item a retained item still requires", () => {
    const tree = memoryTree(B, upstream(["one", "three"]));
    const error = refusal(() => run({ tree }));
    expect(error.reason).toBe("required-item-removed");
    expect(error.details).toMatchObject({ removed: ["fx.two"], blocked: ["fx.one"] });
  });

  it("refuses a pin that would remove every item of a source", () => {
    expect(refusal(() => run({ tree: memoryTree(B, { LICENSE: MIT }) })).reason).toBe(
      "removal-of-every-item",
    );
  });

  it("removes a required item together with its dependent", () => {
    const result = run({ tree: memoryTree(B, upstream(["three"])) });
    expect(result.report.summary).toMatchObject({ removed: 2, unchanged: 1 });
  });

  it("refuses a declared item that is neither released nor upstream", () => {
    const next = declare(entry("one", ["two"]), entry("two"), entry("three"), entry("ghost"));
    expect(
      refusal(() =>
        run({ declaration: next, tree: memoryTree(B, upstream(["one", "two", "three"])) }),
      ).reason,
    ).toBe("declared-item-not-found");
  });

  it("refuses a released item that the declaration no longer lists", () => {
    const next = declare(entry("one", ["two"]), entry("two"));
    expect(refusal(() => run({ declaration: next })).reason).toBe("undeclared-base-item");
  });

  it("refuses a non-regular upstream file and non-UTF-8 or description-less skills", () => {
    expect(
      refusal(() =>
        run({ tree: memoryTree(B, upstream(["one", "two"]), { irregular: [path("three")] }) }),
      ).reason,
    ).toBe("source-file-unavailable");
    expect(
      refusal(() =>
        run({
          tree: memoryTree(B, {
            ...upstream(["one", "two", "three"]),
            [path("three")]: new Uint8Array([0xff, 0xfe]),
          }),
        }),
      ).reason,
    ).toBe("skill-not-utf8");
    expect(
      refusal(() =>
        run({
          tree: memoryTree(B, {
            ...upstream(["one", "two", "three"]),
            [path("three")]: "---\nname: three\n---\nBody\n",
          }),
        }),
      ).reason,
    ).toBe("skill-description");
  });

  it("refuses an upstream file above the material member ceiling", () => {
    const huge = Buffer.alloc(16 * 1024 * 1024 + 1, 97);
    expect(
      refusal(() =>
        run({
          tree: memoryTree(B, { ...upstream(["one", "two", "three"]), [path("three")]: huge }),
        }),
      ).reason,
    ).toBe("source-file-too-large");
  });

  it("refuses a damaged base before reusing anything from it", () => {
    const files = baseFiles();
    const [member] = [...files.keys()].filter((key) => key.endsWith("/three/SKILL.md"));
    files.set(member as string, Buffer.from("tampered"));
    expect(refusal(() => parseBaseRelease(files)).reason).toBe("base-member-mismatch");
    const missing = baseFiles();
    missing.delete(member as string);
    expect(refusal(() => parseBaseRelease(missing)).reason).toBe("base-member-missing");
    const extra = baseFiles();
    extra.set("release/stray.txt", Buffer.from("stray"));
    expect(refusal(() => parseBaseRelease(extra)).reason).toBe("base-orphan-file");
    const none = baseFiles();
    none.delete("release/release.json");
    expect(refusal(() => parseBaseRelease(none)).reason).toBe("base-invalid");
  });

  it("does not modify the base it was given", () => {
    const files = baseFiles();
    const snapshot = new Map([...files].map(([k, v]) => [k, sha256(v)]));
    run({ base: parseBaseRelease(files), tree: memoryTree(C, upstream(["one", "two"])) });
    expect(new Map([...files].map(([k, v]) => [k, sha256(v)]))).toEqual(snapshot);
  });
});

describe("declaration", () => {
  const base = {
    format: "aihq-catalog-producer-declaration",
    version: 1,
    sources: [{ id: "fx", repository: REPOSITORY, licensePath: "LICENSE", license: "MIT" }],
    items: [entry("one"), entry("two")],
  };
  it("refuses unknown keys, unknown requirements, cycles and unsafe paths", () => {
    const bad = (mutate: (value: typeof base) => unknown) => {
      const value = structuredClone(base);
      return refusal(() => parseDeclaration(mutate(value))).reason;
    };
    expect(bad((v) => ({ ...v, extra: true }))).toBe("declaration-invalid");
    expect(bad((v) => ({ ...v, items: [{ ...v.items[0], requires: ["fx.ghost"] }] }))).toBe(
      "declaration-invalid",
    );
    expect(
      bad((v) => ({
        ...v,
        items: [
          { ...v.items[0], requires: ["fx.two"] },
          { ...v.items[1], requires: ["fx.one"] },
        ],
      })),
    ).toBe("dependency-cycle");
    expect(
      bad((v) => ({ ...v, items: [{ ...v.items[0], skillPath: "../escape/SKILL.md" }] })),
    ).toBe("declaration-invalid");
    expect(
      bad((v) => ({ ...v, items: [{ ...v.items[0], skillPath: "skills/x/README.md" }] })),
    ).toBe("declaration-invalid");
  });
});
