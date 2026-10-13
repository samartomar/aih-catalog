import { expect, it } from "vitest";
import type {
  DependencyRef,
  InputSpec,
  RecipeDescriptor,
  SelectionRoot,
} from "../../src/release/contracts.js";
import { readRelease, resolveSelections, validateSelectionSet } from "../../src/release/reader.js";
import { fixtureRelease, releaseBytes, sha256 } from "./fixtures.js";

const present = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("Fixture value missing");
  return value;
};
const at = <T>(values: readonly T[], index: number): T => present(values[index]);

it("resolves a configured root and its required item through the checked reader seam", () => {
  const bytes = releaseBytes(fixtureRelease());
  const read = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!read.valid) throw new Error("invalid fixture");
  const release = read.release;
  const root = {
    releaseSha256: release.sha256,
    itemId: "beta",
    scope: "project" as const,
    configuration: { serverUrl: "https://example.test" },
  };
  const result = resolveSelections({
    releases: { [release.sha256]: release },
    roots: [root],
    skips: [],
  });
  expect(result.status).toBe("ok");
  if (result.status !== "ok") return;
  expect(result.value.selections.map((s) => s.item.itemId)).toEqual(["alpha", "beta"]);
  expect(
    validateSelectionSet({
      releases: { [release.sha256]: release },
      selections: result.value.selections,
    }).valid,
  ).toBe(true);
  expect(
    result.value.inclusions.find((i) => i.item.itemId === "alpha")?.path.map((i) => i.itemId),
  ).toEqual(["beta", "alpha"]);
  expect(root.configuration).toEqual({ serverUrl: "https://example.test" });
});

function checked(document: unknown) {
  const bytes = releaseBytes(document);
  const result = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
  return result.release;
}
type Graph = {
  package: { name: string; version: string };
  items: {
    id: string;
    label: string;
    inputs: Record<string, InputSpec>;
    scopes: ("project" | "user")[];
    recipe: RecipeDescriptor;
    dependencies: {
      requires: DependencyRef[];
      optional: DependencyRef[];
      conflicts: DependencyRef[];
    };
    [key: string]: unknown;
  }[];
  [key: string]: unknown;
};
function graph() {
  const base = fixtureRelease() as unknown as Graph;
  const alpha = at(base.items, 0);
  alpha.inputs = {};
  const item = (id: string, requires: string[] = []) => ({
    ...structuredClone(alpha),
    id,
    label: id,
    recipe: { ...alpha.recipe, id, path: `release/recipes/${id}.json` },
    dependencies: { requires: requires.map((itemId) => ({ itemId })), optional: [], conflicts: [] },
  });
  base.items = [item("a"), item("b", ["a"]), item("c", ["a"]), item("d", ["b", "c"]), item("o")];
  at(base.items, 3).dependencies.optional = [{ itemId: "o" }];
  return base;
}
const ref = (
  release: ReturnType<typeof checked>,
  itemId: string,
  scope: "project" | "user" = "project",
) => ({ releaseSha256: release.sha256, itemId, scope });
const root = (release: ReturnType<typeof checked>, itemId: string, configuration = {}) => ({
  ...ref(release, itemId),
  configuration,
});

it("deduplicates shared selections while retaining each lexicographic inclusion path", () => {
  const release = checked(graph());
  const result = resolveSelections({
    releases: { [release.sha256]: release },
    roots: [root(release, "d")],
    skips: [ref(release, "o")],
    remove: [ref(release, "b")],
  });
  expect(result.status).toBe("ok");
  if (result.status !== "ok") return;
  expect(result.value.selections.map((s) => s.item.itemId)).toEqual(["a", "b", "c", "d"]);
  expect(
    result.value.inclusions
      .filter((i) => i.item.itemId === "a")
      .map((i) => i.path.map((r) => r.itemId)),
  ).toEqual([
    ["d", "b", "a"],
    ["d", "c", "a"],
  ]);
  expect(result.value.optional).toEqual([
    { from: ref(release, "d"), to: ref(release, "o"), skipped: true },
  ]);
  expect(result.value.removalImpact).toEqual([
    {
      item: ref(release, "b"),
      affectedRoots: [ref(release, "d")],
      orphaned: [ref(release, "a"), ref(release, "c")],
    },
  ]);
});

it("keeps shared requirements used by retained roots out of proposed orphan impact", () => {
  const release = checked(graph());
  const result = resolveSelections({
    releases: { [release.sha256]: release },
    roots: [root(release, "d"), root(release, "c")],
    skips: [],
    remove: [ref(release, "b")],
  });
  expect(result.status).toBe("ok");
  if (result.status !== "ok") return;
  expect(result.value.removalImpact[0]?.affectedRoots).toEqual([ref(release, "d")]);
  expect(result.value.removalImpact[0]?.orphaned).toEqual([]);
  expect(result.value.selections.map((s) => s.item.itemId)).toEqual(["a", "b", "c", "d"]);
});

it("reports required skip impact without returning runnable partial selections", () => {
  const release = checked(graph());
  const result = resolveSelections({
    releases: { [release.sha256]: release },
    roots: [root(release, "d")],
    skips: [ref(release, "b")],
    remove: [ref(release, "b")],
  });
  expect(result.status).toBe("refused");
  expect(result).not.toHaveProperty("value");
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "REQUIRED_ITEM_SKIPPED", path: "/skips" }),
  );
  expect(result.diagnostics.every((d) => d.reason === undefined)).toBe(true);
  if (result.status === "refused")
    expect(result.removalImpact[0]?.affectedRoots).toEqual([ref(release, "d")]);
});

it("uses independent exact cross-release references and deterministic digest ordering", () => {
  const primary = checked(graph());
  const secondaryDocument = graph();
  secondaryDocument.package = { name: "other-catalog", version: "1.0.0" };
  secondaryDocument.items = [at(secondaryDocument.items, 0)];
  at(secondaryDocument.items, 0).dependencies.requires = [
    {
      itemId: "d",
      itemSha256: present(primary.items.find((i) => i.id === "d")).itemSha256,
      release: {
        source: { kind: "local", input: "maintained" },
        manifest: {
          path: "release/release.json",
          sha256: primary.sha256,
          byteLength: primary.byteLength,
        },
      },
    },
  ];
  const secondary = checked(secondaryDocument);
  const request = {
    releases: { [secondary.sha256]: secondary, [primary.sha256]: primary },
    roots: [root(secondary, "a"), root(primary, "c")],
    skips: [],
  };
  const result = resolveSelections(request);
  expect(result.status).toBe("ok");
  if (result.status !== "ok") return;
  expect(result.value.selections).toHaveLength(5);
  expect(
    result.value.inclusions.some(
      (i) => i.item.itemId === "d" && i.root.releaseSha256 === secondary.sha256,
    ),
  ).toBe(true);
  expect(
    resolveSelections({
      ...request,
      roots: [...request.roots].reverse(),
      releases: { [primary.sha256]: primary, [secondary.sha256]: secondary },
    }),
  ).toEqual(result);
  expect(
    resolveSelections({ ...request, releases: { [secondary.sha256]: secondary } }).diagnostics.some(
      (d) => d.code === "RELEASE_UNAVAILABLE",
    ),
  ).toBe(true);
  const wrong = structuredClone(secondaryDocument);
  at(wrong.items, 0).dependencies.requires[0] = {
    ...(at(wrong.items, 0).dependencies.requires[0] as Extract<
      DependencyRef,
      { release: unknown }
    >),
    itemSha256: "f".repeat(64),
  };
  const ambiguous = checked(wrong);
  expect(
    resolveSelections({
      releases: { [ambiguous.sha256]: ambiguous, [primary.sha256]: primary },
      roots: [root(ambiguous, "a")],
      skips: [],
    }).diagnostics.some((d) => d.code === "REFERENCE_AMBIGUOUS"),
  ).toBe(true);
});

it("refuses unknown referenced releases and items, including skip/remove identities", () => {
  const release = checked(graph());
  const request = {
    releases: { [release.sha256]: release },
    roots: [root(release, "d")],
    skips: [],
  };
  expect(
    resolveSelections({ ...request, skips: [ref(release, "missing")] }).diagnostics[0]?.code,
  ).toBe("ITEM_UNAVAILABLE");
  expect(
    resolveSelections({
      ...request,
      remove: [{ ...ref(release, "a"), releaseSha256: "e".repeat(64) }],
    }).diagnostics[0]?.code,
  ).toBe("RELEASE_UNAVAILABLE");
});

it("refuses item conflicts and contradictory configurations, leaving roots intact", () => {
  const document = graph();
  at(document.items, 1).dependencies.conflicts = [{ itemId: "c" }];
  const release = checked(document);
  const result = resolveSelections({
    releases: { [release.sha256]: release },
    roots: [root(release, "d")],
    skips: [],
  });
  expect(result.status).toBe("refused");
  expect(result.diagnostics.some((d) => d.code === "ITEM_CONFLICT")).toBe(true);
  const configurable = checked(fixtureRelease());
  const collision = resolveSelections({
    releases: { [configurable.sha256]: configurable },
    roots: [
      root(configurable, "alpha", { agentDirectory: ".claude" }),
      root(configurable, "alpha", { agentDirectory: ".other" }),
    ],
    skips: [],
  });
  expect(collision.diagnostics.some((d) => d.code === "CONFIGURATION_CONFLICT")).toBe(true);
  expect(collision).not.toHaveProperty("value");
});

it("retains final validator diagnostics verbatim in tagged Catalog details", () => {
  const release = checked(fixtureRelease());
  const result = resolveSelections({
    releases: { [release.sha256]: release },
    roots: [root(release, "beta")],
    skips: [],
  });
  expect(result.status).toBe("refused");
  const wrapper = result.diagnostics.find((d) => d.details);
  expect(wrapper?.details?.owner).toBe("catalog");
  expect(wrapper?.details?.diagnostics).toContainEqual(
    expect.objectContaining({
      reason: "input-required",
      blocking: true,
      itemId: "beta",
      path: "/selections/1/configuration/serverUrl",
    }),
  );
});

it("refuses serialized and forged release handles with the existing reader diagnostic shape", () => {
  const release = checked(graph());
  const result = resolveSelections({
    releases: { [release.sha256]: structuredClone(release) },
    roots: [root(release, "d")],
    skips: [],
  });
  expect(result.status).toBe("refused");
  expect(result.diagnostics[0]?.details?.diagnostics[0]).toMatchObject({
    code: "INPUT_INVALID",
    reason: "release-unchecked",
    blocking: true,
  });
});

it("the reader refuses required cycles before any handle or runnable closure is issued", () => {
  const document = graph();
  at(document.items, 0).dependencies.requires = [{ itemId: "d" }];
  const bytes = releaseBytes(document);
  const result = readRelease(bytes, { expectedSha256: sha256(bytes) });
  expect(result.valid).toBe(false);
  expect(result.diagnostics.some((d) => d.reason === "dependency-cycle")).toBe(true);
});

it("deduplicates equal roots and supports distinct scopes through the final validator", () => {
  const document = graph();
  for (const item of document.items) item.scopes = ["project", "user"];
  const release = checked(document);
  const result = resolveSelections({
    releases: { [release.sha256]: release },
    roots: [root(release, "d"), root(release, "d"), { ...root(release, "d"), scope: "user" }],
    skips: [],
  });
  expect(result.status).toBe("ok");
  if (result.status === "ok") expect(result.value.selections).toHaveLength(8);
});

it.each([
  null,
  {},
  { releases: {}, roots: [], skips: [], unknown: true },
  {
    releases: {},
    roots: [{ releaseSha256: "a", itemId: "x", scope: "project", configuration: {} }],
    skips: [],
  },
  { releases: {}, roots: [], skips: new Date() },
])("strictly refuses malformed requests %$", (request) => {
  expect(resolveSelections(request as never).status).toBe("refused");
});

it("refuses accessors without invoking them and rejects non-JSON configuration", () => {
  let invoked = false;
  const request = {
    get releases() {
      invoked = true;
      return {};
    },
    roots: [],
    skips: [],
  };
  expect(resolveSelections(request).status).toBe("refused");
  expect(invoked).toBe(false);
  const release = checked(graph());
  expect(
    resolveSelections({
      releases: { [release.sha256]: release },
      roots: [root(release, "d", { invalid: undefined })],
      skips: [],
    }).status,
  ).toBe("refused");
});

it("refuses inherited array behavior before walking plain JSON roots", () => {
  let calls = 0;
  class NonPlainRoots extends Array<SelectionRoot> {
    [Symbol.iterator]() {
      calls += 1;
      return super[Symbol.iterator]();
    }
  }
  const result = resolveSelections({ releases: {}, roots: new NonPlainRoots(), skips: [] });
  expect(result.status).toBe("refused");
  expect(calls).toBe(0);
});
