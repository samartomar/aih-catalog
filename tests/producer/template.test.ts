import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBaseRelease } from "../../src/producer/base.js";
import { buildCandidate } from "../../src/producer/candidate.js";
import { parseDeclaration } from "../../src/producer/declaration.js";
import { checkCandidateFiles } from "../../src/producer/integrity.js";
import { memoryTree, packageIdentity, REPOSITORY, sha256 } from "./helpers.js";

const revision = "a".repeat(40);
const at = <T>(items: readonly T[], index: number): T => {
  const value = items[index];
  if (value === undefined) throw new Error(`fixture lacks entry ${index}`);
  return value;
};
const target = (name: string) => ({
  root: "userHome",
  segments: [{ literal: "framework" }, { literal: name }],
});
const recipe = (id: string) => ({
  schema: "urn:aihq:core:recipe:1.1.0",
  id,
  description: "Install a framework and its license.",
  inputs: {},
  materials: [],
  targets: ["user"],
  prerequisites: [],
  operations: ["content", "license"].map((material) => ({
    id: `write-${material}`,
    purpose: `Write ${material}`,
    kind: "file.write",
    scope: "user",
    target: target(`${id}-${material}.md`),
    material,
    requires: [],
    checks: [`check-${material}`],
  })),
  checks: ["content", "license"].map((material) => ({
    id: `check-${material}`,
    purpose: `Verify ${material}`,
    kind: "file.sha256",
    target: target(`${id}-${material}.md`),
    sha256: { materialSha256: material },
  })),
});
const item = (id: string, requires: string[] = []) => ({
  id,
  source: "framework-source",
  label: id,
  kind: "framework",
  recipePath: `recipes/${id}.json`,
  materials: [
    { id: "content", path: `${id}/README.md` },
    { id: "license", path: "LICENSE" },
  ],
  requires,
});
const declared = (
  items = [item("framework"), item("dependent", ["framework"]), item("untouched")],
) => ({
  format: "aihq-catalog-producer-declaration",
  version: 2,
  sources: [
    { id: "framework-source", repository: REPOSITORY, licensePath: "LICENSE", license: "MIT" },
  ],
  items,
});
const files = (): Record<string, string> => ({
  LICENSE: "MIT License\n",
  ...Object.fromEntries(
    ["framework", "dependent", "untouched"].flatMap((id) => [
      [`recipes/${id}.json`, JSON.stringify(recipe(id))],
      [`${id}/README.md`, `${id}\n`],
    ]),
  ),
});
const build = (
  content = files(),
  base?: ReturnType<typeof parseBaseRelease>,
  declaration = declared(),
) =>
  buildCandidate({
    declaration: parseDeclaration(declaration),
    tree: memoryTree(revision, content),
    package: packageIdentity(),
    ...(base ? { base } : {}),
  });

describe("generic framework templates", () => {
  it("compiles the readable authoring example as a complete candidate", () => {
    const root = resolve(import.meta.dirname, "../../producer/templates/framework");
    const content = Object.fromEntries(
      ["recipe.json", "guide.md", "LICENSE"].map((name) => [
        name,
        readFileSync(resolve(root, name)),
      ]),
    );
    const candidate = buildCandidate({
      declaration: parseDeclaration(readFileSync(resolve(root, "declaration.json"))),
      tree: memoryTree(revision, content, { repository: "example/framework" }),
      package: packageIdentity(),
    });
    expect(checkCandidateFiles(candidate.files, packageIdentity()).ok).toBe(true);
  });
  it("binds exact material bytes, input-independent user targets and checks through ordinary Core recipes", () => {
    const result = build();
    const base = parseBaseRelease(result.files);
    expect(base.checked.schema).toBe("urn:aihq:catalog:release:1.1.0");
    expect(base.items).toHaveLength(3);
    const compiled = JSON.parse(
      result.files.get("release/recipes/framework.json")?.toString() ?? "null",
    );
    expect(compiled.materials[0]).toMatchObject({ id: "content", sha256: sha256("framework\n") });
    expect(compiled.checks[0].sha256).toBe(sha256("framework\n"));
    expect(checkCandidateFiles(result.files, packageIdentity()).ok).toBe(true);
  });

  it("rebuilds changed materials, confirms dependents and preserves unrelated bytes and records", () => {
    const first = build();
    const base = parseBaseRelease(first.files);
    const result = build({ ...files(), "framework/README.md": "updated\n" }, base);
    expect(result.report.items.map(({ id, state }) => [id, state])).toEqual([
      ["dependent", "dependent-confirmed"],
      ["framework", "changed"],
      ["untouched", "unchanged"],
    ]);
    const after = parseBaseRelease(result.files);
    expect(after.items.find((entry) => entry.id === "untouched")).toEqual(
      base.items.find((entry) => entry.id === "untouched"),
    );
    expect(result.files.get("release/recipes/untouched.json")).toEqual(
      first.files.get("release/recipes/untouched.json"),
    );
  });

  it("tracks recipe content changes independently of unchanged material bytes", () => {
    const changed = recipe("framework");
    at(changed.operations, 0).target = target("different.md");
    expect(
      build(
        { ...files(), "recipes/framework.json": JSON.stringify(changed) },
        parseBaseRelease(build().files),
      ).report.summary.changed,
    ).toBe(1);
  });

  it("withdraws an absent template only from a complete inventory and checks resulting dependencies", () => {
    const initial = parseBaseRelease(build().files);
    const { "recipes/framework.json": _template, ...remaining } = files();
    expect(() => build(remaining, initial)).toThrow(/required-item-removed/);
    const result = build(
      remaining,
      initial,
      declared([item("framework"), item("dependent"), item("untouched")]),
    );
    expect(result.report.summary.removed).toBe(1);
    expect(() =>
      buildCandidate({
        declaration: parseDeclaration(declared()),
        tree: memoryTree(revision, remaining, { complete: false }),
        package: packageIdentity(),
        base: initial,
      }),
    ).toThrow(/inventory-incomplete/);
  });

  it.each([
    "unbound",
    "unused",
    "missing-license",
    "unsafe-path",
    "duplicate-id",
  ])("refuses %s material declarations", (kind) => {
    const declaration = declared();
    const members = at(declaration.items, 0).materials;
    if (kind === "unbound") at(members, 0).id = "wrong";
    if (kind === "unused") members.push({ id: "unused", path: "untouched/README.md" });
    if (kind === "missing-license") at(members, 1).path = "dependent/README.md";
    if (kind === "unsafe-path") at(members, 0).path = "../secret";
    if (kind === "duplicate-id") at(members, 1).id = "content";
    expect(() => build(files(), undefined, declaration)).toThrow(/template-|declaration-invalid/);
  });

  it("refuses missing material and malformed or ambiguous recipes", () => {
    const { "framework/README.md": _material, ...missing } = files();
    expect(() => build(missing)).toThrow(/source-file-unavailable/);
    for (const template of [
      "{}",
      '{"id":"framework","id":"other"}',
      JSON.stringify({ ...recipe("wrong") }),
      JSON.stringify({ ...recipe("framework"), extra: true }),
    ]) {
      expect(() => build({ ...files(), "recipes/framework.json": template })).toThrow(/template-/);
    }
  });

  it("refuses invalid material hash bindings", () => {
    const changed = recipe("framework");
    at(changed.checks, 0).sha256.materialSha256 = "absent";
    expect(() => build({ ...files(), "recipes/framework.json": JSON.stringify(changed) })).toThrow(
      /template-material-binding/,
    );
  });

  it("admits a recipe 1.3 input-bound hook through complete public package verification", () => {
    const changed = {
      ...recipe("framework"),
      schema: "urn:aihq:core:recipe:1.3.0",
      inputs: { command: { type: "string", required: true } },
      operations: [
        ...recipe("framework").operations,
        {
          id: "owned-hook",
          purpose: "Register the configured command",
          kind: "hook.group",
          scope: "user",
          target: target("settings.json"),
          format: "json",
          container: ["hooks", "BeforeTool"],
          groupId: "example-hook",
          selector: { path: ["hooks", 0, "command"], input: "command" },
          action: "set",
          group: { literal: { hooks: [{ type: "command", command: "unbound" }] } },
          groupBindings: [{ path: ["hooks", 0, "command"], value: { input: "command" } }],
          requires: [],
          checks: [],
        },
      ],
    };
    const result = build({ ...files(), "recipes/framework.json": JSON.stringify(changed) });
    expect(parseBaseRelease(result.files).checked.schema).toBe("urn:aihq:catalog:release:1.2.0");
    expect(checkCandidateFiles(result.files, packageIdentity()).ok).toBe(true);
  });

  it("binds literal examples to exact reviewed source files, tokens and actual bytes", () => {
    const raw = memoryTree(revision, { LICENSE: "MIT\n", "raw.md": "source\n" });
    const reviewed = "Example: [object Object]\n";
    const declaration = parseDeclaration({
      ...declared(),
      authored: [
        {
          source: "framework-source",
          externalPaths: [],
          templatePlaceholders: [],
          literalExamples: [
            { path: "framework/README.md", sha256: sha256(reviewed), tokens: ["[object Object]"] },
          ],
        },
      ],
    });
    const produce = (
      text: string,
      extraFiles: Record<string, string> = {},
      authoring = declaration,
    ) =>
      buildCandidate({
        declaration: authoring,
        package: packageIdentity(),
        tree: {
          ...memoryTree(revision, { ...files(), "framework/README.md": text, ...extraFiles }),
          derivation: {
            renderer: { name: "example", version: "1", bytes: Buffer.from("render") },
            inputs: [raw],
            configuration: {},
          },
        },
      });
    const allowed = produce(reviewed);
    expect(checkCandidateFiles(allowed.files, packageIdentity()).ok).toBe(false);
    expect(
      checkCandidateFiles(allowed.files, packageIdentity(), { authored: declaration.authored }).ok,
    ).toBe(true);
    expect(
      checkCandidateFiles(allowed.files, packageIdentity(), {
        authored: [{ ...at(declaration.authored, 0), source: "framework" }],
      }).ok,
    ).toBe(false);
    const elsewhere = produce(reviewed, { "dependent/README.md": reviewed });
    expect(
      checkCandidateFiles(elsewhere.files, packageIdentity(), { authored: declaration.authored })
        .ok,
    ).toBe(false);
    const changed = produce(`${reviewed} `);
    expect(
      checkCandidateFiles(changed.files, packageIdentity(), { authored: declaration.authored }).ok,
    ).toBe(false);
    const appended = produce(`${reviewed}[object Object]\n`);
    expect(
      checkCandidateFiles(appended.files, packageIdentity(), { authored: declaration.authored }).ok,
    ).toBe(false);
    const movedDeclaration = declared();
    at(at(movedDeclaration.items, 0).materials, 0).path = "framework/moved.md";
    const moved = produce(
      reviewed,
      { "framework/moved.md": reviewed },
      parseDeclaration({ ...movedDeclaration, authored: declaration.authored }),
    );
    expect(
      checkCandidateFiles(moved.files, packageIdentity(), { authored: declaration.authored }).ok,
    ).toBe(false);
    const extra = produce("Example: [object Object] and undefined\n");
    expect(
      checkCandidateFiles(extra.files, packageIdentity(), { authored: declaration.authored }).ok,
    ).toBe(false);
    const rehashed = [
      {
        ...at(declaration.authored, 0),
        literalExamples: [
          {
            path: "framework/README.md",
            sha256: sha256("Example: [object Object] and undefined\n"),
            tokens: ["[object Object]"],
          },
        ],
      },
    ];
    expect(checkCandidateFiles(extra.files, packageIdentity(), { authored: rehashed }).ok).toBe(
      false,
    );
    const tamperedFiles = new Map(allowed.files);
    const base = parseBaseRelease(allowed.files);
    const reviewedMember = base.checked.items
      .find((entry) => entry.id === "framework")
      ?.materials.find((entry) => entry.id === "content");
    if (!reviewedMember) throw new Error("fixture lacks reviewed member");
    tamperedFiles.set(
      String(
        (reviewedMember as { path?: string; packagePath?: string }).path ??
          (reviewedMember as { packagePath?: string }).packagePath,
      ),
      Buffer.from(`${reviewed} `),
    );
    expect(
      checkCandidateFiles(tamperedFiles, packageIdentity(), {
        authored: declaration.authored,
      }).checks.find((entry) => entry.name === "authored-placeholders")?.ok,
    ).toBe(false);
    const withLiteral = {
      ...recipe("framework"),
      operations: [
        ...recipe("framework").operations,
        {
          id: "literal-block",
          purpose: "Literal block",
          kind: "text.block",
          scope: "user",
          target: target("settings.txt"),
          blockId: "example",
          startMarker: "START",
          endMarker: "END",
          action: "set",
          content: { literal: "[object Object]" },
          requires: [],
          checks: [],
        },
      ],
    };
    const operation = produce(reviewed, { "recipes/framework.json": JSON.stringify(withLiteral) });
    expect(
      checkCandidateFiles(operation.files, packageIdentity(), { authored: declaration.authored })
        .ok,
    ).toBe(false);
    expect(() =>
      parseDeclaration({
        ...declared(),
        version: 1,
        items: [],
        authored: [
          {
            source: "framework-source",
            externalPaths: [],
            templatePlaceholders: ["[object Object]"],
          },
        ],
      }),
    ).toThrow(/declaration-invalid/);
  });

  it.each([
    { path: "../README.md", sha256: "a".repeat(64), tokens: ["undefined"] },
    { path: "guide.md", sha256: "not-a-hash", tokens: ["undefined"] },
    { path: "guide.md", sha256: "a".repeat(64), tokens: [] },
    { path: "guide.md", sha256: "a".repeat(64), tokens: ["undefined", "undefined"] },
    { path: "guide.md", sha256: "a".repeat(64), tokens: ["x".repeat(513)] },
    { path: "guide.md", sha256: "a".repeat(64), tokens: [42] },
    { path: "guide.md", sha256: "a".repeat(64), tokens: ["undefined"], extra: true },
  ])("refuses malformed literal-example metadata %$", (example) => {
    expect(() =>
      parseDeclaration({
        ...declared(),
        authored: [
          {
            source: "framework-source",
            externalPaths: [],
            templatePlaceholders: [],
            literalExamples: [example],
          },
        ],
      }),
    ).toThrow(/declaration-invalid/);
  });

  it("refuses duplicate literal-example paths and keeps version 1 unchanged", () => {
    const example = { path: "guide.md", sha256: "a".repeat(64), tokens: ["undefined"] };
    const allowance = {
      source: "framework-source",
      externalPaths: [],
      templatePlaceholders: [],
      literalExamples: [example, { ...example, path: "GUIDE.md" }],
    };
    expect(() => parseDeclaration({ ...declared(), authored: [allowance] })).toThrow(
      /declaration-invalid/,
    );
    expect(() =>
      parseDeclaration({
        ...declared(),
        version: 1,
        items: [],
        authored: [{ ...allowance, literalExamples: [example] }],
      }),
    ).toThrow(/declaration-invalid/);
  });

  it("refuses incomplete derived input closures instead of accepting claimed provenance", () => {
    expect(() =>
      buildCandidate({
        declaration: parseDeclaration(declared()),
        package: packageIdentity(),
        tree: {
          ...memoryTree(revision, files()),
          derivation: {
            renderer: { name: "example", version: "1", bytes: Buffer.from("render") },
            inputs: [memoryTree(revision, { LICENSE: "MIT\n" }, { complete: false })],
            configuration: {},
          },
        },
      }),
    ).toThrow(/derived-source-invalid/);
  });

  it("records computed derived provenance and preserves unaffected authored items", () => {
    const raw = memoryTree(revision, { LICENSE: "MIT\n", "source.txt": "raw source\n" });
    const derive = (content: ReturnType<typeof files>) => ({
      ...memoryTree(revision, content),
      derivation: {
        renderer: { name: "example-renderer", version: "1", bytes: Buffer.from("renderer source") },
        inputs: [raw],
        configuration: { clients: ["example"] },
      },
    });
    const declaration = parseDeclaration(declared());
    const first = buildCandidate({
      declaration,
      tree: derive(files()),
      package: packageIdentity(),
    });
    const base = parseBaseRelease(first.files);
    expect(base.sources[0]?.origin).toEqual({ kind: "authored" });
    expect(base.items[0]?.metadata).toMatchObject({
      upstream: {
        repository: `https://github.com/${REPOSITORY}`,
        revision,
        derivation: {
          renderer: { sha256: sha256("renderer source") },
          outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
    });
    const result = buildCandidate({
      declaration,
      tree: derive({ ...files(), "framework/README.md": "updated\n" }),
      package: packageIdentity(),
      base,
    });
    expect(result.report.summary.changed).toBe(1);
    expect(result.report.summary.unchanged).toBe(1);
    expect(result.report.summary["dependent-confirmed"]).toBe(1);
    expect(parseBaseRelease(result.files).items.find((entry) => entry.id === "untouched")).toEqual(
      base.items.find((entry) => entry.id === "untouched"),
    );
  });
});
