import { documentBytes, sha256Hex } from "../../src/producer/generate.js";

/** An input definition as a recipe and its catalog item both mirror it. */
export type InputDefinition = Record<string, unknown>;

export interface AuthoredSpec {
  readonly id: string;
  readonly requires?: readonly string[];
  readonly optional?: readonly string[];
  readonly conflicts?: readonly string[];
  readonly inputs?: Record<string, InputDefinition>;
  readonly prerequisites?: readonly Record<string, unknown>[];
  /** The delivered notes text; a fixed sentence naming the item by default. */
  readonly text?: string;
}

type Doc = {
  sources: { id: string; origin: Record<string, unknown> }[];
  items: Record<string, unknown>[];
  [key: string]: unknown;
};

export const AUTHORED_SOURCE = "local-authored";

/**
 * Adds items that did not come from the producer's declared repository, with real
 * Core-format recipes and material: configuration-required, sensitive, conflicting,
 * optional, platform-gated and dependent content, as the next tickets will carry.
 */
export function withAuthoredItems(
  base: ReadonlyMap<string, Buffer>,
  specs: readonly AuthoredSpec[],
): Map<string, Buffer> {
  const files = new Map(base);
  const document = JSON.parse(
    (files.get("release/release.json") as Buffer).toString("utf8"),
  ) as Doc;
  if (!document.sources.some((source) => source.id === AUTHORED_SOURCE)) {
    document.sources.push({ id: AUTHORED_SOURCE, origin: { kind: "authored" } });
    document.sources.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  for (const spec of specs) {
    const text = Buffer.from(spec.text ?? `Authored content for ${spec.id}.\n`);
    const materialPath = `release/materials/authored/${spec.id}/README.txt`;
    const material = { id: "readme", sha256: sha256Hex(text), byteLength: text.length };
    const target = {
      root: "project",
      segments: [{ literal: "docs" }, { literal: spec.id }, { literal: "README.txt" }],
    };
    const inputs = spec.inputs ?? {};
    const prerequisites = spec.prerequisites ?? [];
    const recipe = {
      schema: "urn:aihq:core:recipe:1.0.0",
      id: spec.id,
      description: `Write the ${spec.id} notes.`,
      inputs,
      materials: [material],
      targets: ["project"],
      prerequisites,
      operations: [
        {
          id: "write-readme",
          purpose: "Write the notes",
          kind: "file.write",
          scope: "project",
          target,
          material: "readme",
          requires: [],
          checks: ["readme-sha256"],
        },
      ],
      checks: [
        {
          id: "readme-sha256",
          purpose: "The notes have the pinned bytes",
          kind: "file.sha256",
          target,
          sha256: material.sha256,
        },
      ],
    };
    const recipeBytes = documentBytes(recipe);
    const recipePath = `release/recipes/${spec.id}.json`;
    files.set(materialPath, text);
    files.set(recipePath, recipeBytes);
    const refs = (ids: readonly string[] | undefined) => (ids ?? []).map((itemId) => ({ itemId }));
    document.items.push({
      id: spec.id,
      label: spec.id,
      description: `Authored item ${spec.id}`,
      kind: "tool",
      sourceIds: [AUTHORED_SOURCE],
      targets: prerequisites,
      scopes: ["project"],
      inputs,
      recipe: {
        id: spec.id,
        schema: "urn:aihq:core:recipe:1.0.0",
        path: recipePath,
        sha256: sha256Hex(recipeBytes),
        byteLength: recipeBytes.length,
      },
      materials: [{ ...material, path: materialPath }],
      dependencies: {
        requires: refs(spec.requires),
        optional: refs(spec.optional),
        conflicts: refs(spec.conflicts),
      },
      metadata: { note: "descriptive only" },
    });
  }
  document.items.sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1));
  files.set("release/release.json", documentBytes(document));
  return files;
}

/** A realistic mix: needs configuration, holds a secret, conflicts, optional, platform-gated. */
export const HETEROGENEOUS: readonly AuthoredSpec[] = [
  {
    id: "ext.server",
    inputs: {
      serverUrl: { type: "string", required: true, maxLength: 512 },
      token: { type: "string", required: true, sensitive: true },
    },
  },
  { id: "ext.alt-a", conflicts: ["ext.alt-b"] },
  { id: "ext.alt-b", conflicts: ["ext.alt-a"] },
  { id: "ext.with-optional", optional: ["ext.alt-a"] },
  { id: "ext.both", requires: ["ext.alt-a", "ext.alt-b"] },
  {
    id: "ext.windows-only",
    prerequisites: [{ kind: "platform", os: "win32", architectures: ["x64"] }],
  },
];

/** A release document with no items yet, for building authored-only releases. */
export function emptyRelease(identity: { name: string; version: string }): Map<string, Buffer> {
  return new Map([
    [
      "release/release.json",
      documentBytes({
        schema: "urn:aihq:catalog:release:1.0.0",
        package: identity,
        sources: [],
        items: [],
      }),
    ],
  ]);
}
