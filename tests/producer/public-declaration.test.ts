import { expect, it } from "vitest";
import {
  checkProducerDeclaration,
  compileProducerDeclaration,
} from "../../src/release/producer.js";

const present = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("Fixture value missing");
  return value;
};
const at = <T>(values: readonly T[], index: number): T => present(values[index]);

const publicDeclaration = () => ({
  schema: "urn:aihq:catalog:producer-declaration:3.0.0",
  format: "aihq-catalog-producer-declaration",
  version: 3,
  sources: [{ id: "notes", repository: "example/notes", licensePath: "LICENSE", license: "MIT" }],
  items: [
    {
      id: "consumer-proof.review-note",
      source: "notes",
      label: "Review note",
      description: "An independently supplied note",
      kind: "instruction",
      recipePath: "recipe.json",
      materials: [
        { id: "license", path: "LICENSE" },
        { id: "note", path: "note.md" },
      ],
      requires: [],
      optional: [],
      conflicts: [],
      clientCapabilities: [
        {
          client: "example",
          surface: "instructions",
          capability: "load",
          support: "unknown" as "supported" | "unsupported" | "unknown",
        },
      ],
      activation: [],
      configuration: {},
    },
  ],
});
const target = (file: string) => ({ root: "project", segments: [{ literal: file }] });
const sourceFiles = () => [
  {
    source: "notes",
    revision: "a".repeat(40),
    files: {
      LICENSE: new TextEncoder().encode("MIT license fixture\n"),
      "note.md": new TextEncoder().encode("Review the proposed setup.\n"),
      "recipe.json": new TextEncoder().encode(
        JSON.stringify({
          schema: "urn:aihq:core:recipe:1.0.0",
          id: "consumer-proof.review-note",
          description: "Write note and license",
          inputs: {},
          materials: [],
          targets: ["project"],
          prerequisites: [],
          operations: ["license", "note"].map((material) => ({
            id: `write-${material}`,
            purpose: "Write supplied bytes",
            kind: "file.write",
            scope: "project",
            target: target(`${material}.md`),
            material,
            requires: [],
            checks: [`check-${material}`],
          })),
          checks: ["license", "note"].map((material) => ({
            id: `check-${material}`,
            purpose: "Verify supplied bytes",
            kind: "file.sha256",
            target: target(`${material}.md`),
            sha256: { materialSha256: material },
          })),
        }),
      ),
    },
  },
];
it("checks the exact v3 declaration and compiles supplied bytes without acquiring or installing", () => {
  const declaration = publicDeclaration();
  expect(checkProducerDeclaration(declaration).status).toBe("ok");
  const result = compileProducerDeclaration({ declaration, sourceFiles: sourceFiles() });
  expect(result.status, JSON.stringify(result.diagnostics)).toBe("ok");
  if (result.status !== "ok") return;
  expect(result.value.release.items[0]?.id).toBe("consumer-proof.review-note");
  expect(result.value.release.items[0]?.metadata).toMatchObject({
    discovery: {
      clientCapabilities: [{ support: "unknown" as "supported" | "unsupported" | "unknown" }],
    },
  });
  expect(result.value.materials.some((member) => member.path.endsWith("note.md"))).toBe(true);
  expect(declaration.items[0]?.requires).toEqual([]);
});

it("refuses unsupported versions and preserves the original declaration for explicit migration", () => {
  const original = {
    ...publicDeclaration(),
    schema: "urn:aihq:catalog:producer-declaration:4.0.0",
  };
  const before = JSON.stringify(original);
  const result = checkProducerDeclaration(original);
  expect(result.status).toBe("refused");
  expect(result.diagnostics[0]).toMatchObject({ code: "SCHEMA_UNSUPPORTED", path: "/schema" });
  expect(JSON.stringify(original)).toBe(before);
  expect(
    checkProducerDeclaration({
      format: "aihq-catalog-producer-declaration",
      version: 2,
      sources: [],
      items: [],
    }).status,
  ).toBe("refused");
});

it("never promotes unknown capabilities and requires a reason for unsupported declarations", () => {
  const declaration = publicDeclaration();
  at(at(declaration.items, 0).clientCapabilities, 0).support = "unsupported";
  const result = checkProducerDeclaration(declaration);
  expect(result.status).toBe("refused");
  expect(result.diagnostics.some((d) => d.path.includes("clientCapabilities"))).toBe(true);
});

it("refuses inconsistent input bounds before compilation", () => {
  const declaration = publicDeclaration();
  at(declaration.items, 0).configuration = {
    mode: { type: "string", required: false, minLength: 5, maxLength: 2 },
  } as never;
  expect(checkProducerDeclaration(declaration).status).toBe("refused");
});

it("binds source byte provenance and remains deterministic across source-map order", () => {
  const declaration = publicDeclaration();
  const first = compileProducerDeclaration({ declaration, sourceFiles: sourceFiles() });
  const sources = sourceFiles();
  at(sources, 0).files = Object.fromEntries(
    Object.entries(at(sources, 0).files).reverse(),
  ) as (typeof sources)[0]["files"];
  const second = compileProducerDeclaration({ declaration, sourceFiles: sources });
  expect(second).toEqual(first);
  expect(first.status).toBe("ok");
  if (first.status !== "ok") return;
  expect(first.value.release.items[0]?.metadata).toMatchObject({
    suppliedSource: {
      source: "notes",
      revision: "a".repeat(40),
      files: expect.arrayContaining([expect.objectContaining({ path: "note.md", byteLength: 27 })]),
    },
  });
});

it("refuses missing source bytes, malformed recipes and unsupported recipe versions", () => {
  const missing = sourceFiles();
  delete (at(missing, 0).files as Partial<(typeof missing)[0]["files"]>)["note.md"];
  expect(
    compileProducerDeclaration({ declaration: publicDeclaration(), sourceFiles: missing }).status,
  ).toBe("refused");
  for (const change of [
    { operations: [] },
    { schema: "urn:aihq:core:recipe:99.0.0" },
    { id: "wrong" },
  ]) {
    const sources = sourceFiles();
    const recipe = JSON.parse(new TextDecoder().decode(at(sources, 0).files["recipe.json"]));
    at(sources, 0).files["recipe.json"] = new TextEncoder().encode(
      JSON.stringify({ ...recipe, ...change }),
    );
    expect(
      compileProducerDeclaration({ declaration: publicDeclaration(), sourceFiles: sources }).status,
    ).toBe("refused");
  }
});

it("checks release relationships and refuses prose-only guessed relationships or unsafe paths", () => {
  const declaration = publicDeclaration();
  expect(
    checkProducerDeclaration({
      ...declaration,
      items: [{ ...declaration.items[0], requires: ["guessed-from-prose"] }],
    }).status,
  ).toBe("refused");
  expect(
    checkProducerDeclaration({
      ...declaration,
      items: [{ ...declaration.items[0], optional: [{ itemId: "missing" }] }],
    }).status,
  ).toBe("refused");
  expect(
    checkProducerDeclaration({
      ...declaration,
      items: [{ ...declaration.items[0], recipePath: "../recipe.json" }],
    }).status,
  ).toBe("refused");
  expect(
    checkProducerDeclaration({
      ...declaration,
      items: [{ ...declaration.items[0], other: "unsupported override" }],
    }).status,
  ).toBe("refused");
});

it("keeps discovery labels and help display-only while checking the recipe input mirror", () => {
  const declaration = publicDeclaration();
  const sources = sourceFiles();
  const recipe = JSON.parse(new TextDecoder().decode(at(sources, 0).files["recipe.json"]));
  recipe.inputs = {
    mode: { type: "string", required: false, enum: ["safe", "fast"], default: "safe" },
  };
  at(sources, 0).files["recipe.json"] = new TextEncoder().encode(JSON.stringify(recipe));
  at(declaration.items, 0).configuration = {
    mode: { ...recipe.inputs.mode, label: "Mode", help: "Select a declared mode" },
  };
  const result = compileProducerDeclaration({ declaration, sourceFiles: sources });
  expect(result.status).toBe("ok");
  if (result.status !== "ok") return;
  expect(result.value.release.items[0]?.inputs.mode).not.toHaveProperty("label");
  const changed = {
    ...declaration,
    items: [
      { ...declaration.items[0], configuration: { mode: { type: "string", required: false } } },
    ],
  };
  expect(compileProducerDeclaration({ declaration: changed, sourceFiles: sources }).status).toBe(
    "refused",
  );
});

it("refuses non-JSON declaration values and does not invoke accessors", () => {
  let read = false;
  const value = {
    ...publicDeclaration(),
    get sources() {
      read = true;
      return [];
    },
  };
  expect(checkProducerDeclaration(value).status).toBe("refused");
  expect(read).toBe(false);
  expect(checkProducerDeclaration(new Date()).status).toBe("refused");
  const sources = sourceFiles();
  Object.defineProperty(at(sources, 0).files, "side-effect", {
    enumerable: true,
    get() {
      read = true;
      return new Uint8Array();
    },
  });
  expect(
    compileProducerDeclaration({ declaration: publicDeclaration(), sourceFiles: sources }).status,
  ).toBe("refused");
  expect(read).toBe(false);
});

it("refuses non-plain source snapshot envelopes and accessor array entries without execution", () => {
  const source = at(sourceFiles(), 0);
  const malformed = Object.assign(Object.create({ inherited: true }), source);
  expect(
    compileProducerDeclaration({ declaration: publicDeclaration(), sourceFiles: [malformed] })
      .status,
  ).toBe("refused");
  let invoked = false;
  const snapshots = sourceFiles();
  Object.defineProperty(snapshots, 0, {
    get() {
      invoked = true;
      return source;
    },
  });
  const result = compileProducerDeclaration({
    declaration: publicDeclaration(),
    sourceFiles: snapshots,
  });
  expect(result.status).toBe("refused");
  expect(invoked).toBe(false);
});

it("migrates V2 shorthand explicitly and preserves all three declared relationship kinds", () => {
  const v3 = publicDeclaration();
  const first = at(v3.items, 0);
  const second = {
    ...first,
    id: "consumer-proof.other",
    recipePath: "other-recipe.json",
    requires: [],
    optional: [],
    conflicts: [],
  };
  const legacy = {
    format: v3.format,
    version: 2,
    sources: v3.sources,
    items: [
      {
        id: first.id,
        source: first.source,
        label: first.label,
        kind: first.kind,
        recipePath: first.recipePath,
        materials: first.materials,
        requires: [second.id],
      },
      {
        id: second.id,
        source: second.source,
        label: second.label,
        kind: second.kind,
        recipePath: second.recipePath,
        materials: second.materials,
        requires: [],
      },
    ],
  };
  const before = JSON.stringify(legacy);
  expect(checkProducerDeclaration(legacy).status).toBe("refused");
  const declaration = {
    ...v3,
    items: [
      {
        ...first,
        requires: legacy.items[0]?.requires.map((itemId) => ({ itemId })) ?? [],
        optional: [{ itemId: second.id }],
        conflicts: [{ itemId: second.id }],
      },
      second,
    ],
  };
  const sources = sourceFiles();
  const recipe = JSON.parse(new TextDecoder().decode(at(sources, 0).files["recipe.json"]));
  recipe.id = second.id;
  const files: Record<string, Uint8Array> = {
    ...at(sources, 0).files,
    "other-recipe.json": new TextEncoder().encode(JSON.stringify(recipe)),
  };
  const result = compileProducerDeclaration({
    declaration,
    sourceFiles: [{ ...at(sources, 0), files }],
  });
  expect(result.status).toBe("ok");
  if (result.status === "ok")
    expect(result.value.release.items.find((item) => item.id === first.id)?.dependencies).toEqual({
      requires: [{ itemId: second.id }],
      optional: [{ itemId: second.id }],
      conflicts: [{ itemId: second.id }],
    });
  expect(JSON.stringify(legacy)).toBe(before);
});
