import { createHash } from "node:crypto";

/** Test-side helpers. Independent of the implementation: node:crypto hashes, local canonical form. */
export const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

export const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
export const releaseBytes = (document: unknown): Uint8Array => encode(`${canonical(document)}\n`);

const hex = (seed: string) => sha256(seed);

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A small release with two items; `beta` requires `alpha`. Hashes are well formed, not real bytes. */
export function fixtureRelease(): { [key: string]: Json } {
  return {
    schema: "urn:aihq:catalog:release:1.0.0",
    package: { name: "@example/catalog", version: "1.2.0" },
    sources: [
      {
        id: "upstream",
        origin: {
          kind: "git",
          repository: "https://github.com/example/skills",
          revision: "0123456789abcdef0123456789abcdef01234567",
        },
      },
    ],
    items: [
      {
        id: "alpha",
        label: "Alpha",
        description: "First example item",
        kind: "skill",
        sourceIds: ["upstream"],
        targets: [],
        scopes: ["project"],
        inputs: {
          agentDirectory: {
            type: "string",
            required: true,
            default: ".claude",
            minLength: 1,
            maxLength: 64,
            description: "Directory that receives the skill",
          },
        },
        recipe: {
          id: "alpha",
          schema: "urn:aihq:core:recipe:1.0.0",
          path: "release/recipes/alpha.json",
          sha256: hex("alpha-recipe"),
          byteLength: 900,
        },
        materials: [
          {
            id: "license",
            path: "release/materials/LICENSE",
            sha256: hex("license"),
            byteLength: 1068,
          },
          {
            id: "skill",
            path: "release/materials/alpha/SKILL.md",
            sha256: hex("alpha"),
            byteLength: 157,
          },
        ],
        dependencies: { requires: [], optional: [], conflicts: [] },
      },
      {
        id: "beta",
        label: "Beta",
        kind: "skill",
        sourceIds: ["upstream"],
        targets: [],
        scopes: ["project"],
        inputs: {
          serverUrl: { type: "string", required: true, maxLength: 512 },
          enabled: { type: "boolean", required: false, default: true },
          retries: { type: "integer", required: false, minimum: 0, maximum: 5 },
          token: { type: "string", required: true, sensitive: true },
          mode: { type: "string", required: false, enum: ["fast", "safe"] },
        },
        recipe: {
          id: "beta",
          schema: "urn:aihq:core:recipe:1.0.0",
          path: "release/recipes/beta.json",
          sha256: hex("beta-recipe"),
          byteLength: 1200,
        },
        materials: [
          {
            id: "license",
            path: "release/materials/LICENSE",
            sha256: hex("license"),
            byteLength: 1068,
          },
        ],
        dependencies: { requires: [{ itemId: "alpha" }], optional: [], conflicts: [] },
        metadata: { note: "descriptive only" },
      },
    ],
  };
}
