// Canonical Extensions bytes are imported from a reviewed committed source snapshot.
// This generator never renders, fetches, or executes Extensions content.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GUIDE_RELEASE_PATH = "release/release-guide.json";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`;
const document = (value) => Buffer.from(`${canonical(value)}\n`);

export function generateGuideRelease(root, identity) {
  const pkg = identity ?? JSON.parse(readFileSync(resolve(root, "package.json")));
  const source = JSON.parse(readFileSync(resolve(root, "producer/guide/source.json")));
  if (
    source.repository !== "https://github.com/samartomar/aih-extensions" ||
    !/^[0-9a-f]{40}$/.test(source.revision)
  )
    throw new Error("Guide source identity invalid");
  const members = new Map();
  for (const file of source.files) {
    if (
      !/^[a-zA-Z0-9./_-]+$/.test(file.path) ||
      file.path.split("/").some((p) => p === "." || p === ".." || !p) ||
      members.has(file.path)
    )
      throw new Error("Guide source path invalid or duplicated");
    const bytes = Buffer.from(file.base64, "base64");
    if (sha(bytes) !== file.sha256) throw new Error(`Guide source hash mismatch: ${file.path}`);
    members.set(file.path, bytes);
  }
  const manifest = JSON.parse(members.get("guide/manifest.json"));
  if (
    manifest.version !== source.version ||
    manifest.source.dirty !== false ||
    manifest.source.repository !== source.repository
  )
    throw new Error("Guide source manifest identity mismatch");
  for (const [path, hash] of Object.entries({ ...manifest.inputs, ...manifest.files })) {
    if (!members.has(path) || sha(members.get(path)) !== hash)
      throw new Error(`Guide manifest hash mismatch: ${path}`);
  }
  if (sha(`${JSON.stringify(manifest.inputs, null, 2)}\n`) !== manifest.source.sha256)
    throw new Error("Guide source-set identity mismatch");
  const delivered = [
    ["manual", "guide/MANUAL.md", "MANUAL.md"],
    ["claude-profile", "guide/generated/claude/aih-guide.md", "profiles/claude/aih-guide.md"],
    ["kimi-profile", "guide/generated/kimi/aih-guide.md", "profiles/kimi/aih-guide.md"],
    ["opencode-profile", "guide/generated/opencode/aih-guide.md", "profiles/opencode/aih-guide.md"],
    ["source", "guide/source.md", "source.md"],
    ["metadata", "guide/metadata.json", "metadata.json"],
    ["icon", "guide/compass.svg", "compass.svg"],
    ["manifest", "guide/manifest.json", "manifest.json"],
    ["evidence", "docs/guide-evidence.md", "guide-evidence.md"],
    ["license", "LICENSE", "LICENSE"],
  ];
  const files = new Map();
  const materials = delivered
    .map(([id, path]) => {
      const bytes = members.get(path);
      if (!bytes) throw new Error(`Guide source missing: ${path}`);
      const material = {
        id,
        path: `release/materials/github.com/samartomar/aih-extensions/${source.revision}/${path}`,
        sha256: sha(bytes),
        byteLength: bytes.length,
      };
      files.set(material.path, bytes);
      return material;
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  // A segment input is intentionally a single directory name, never an arbitrary path.
  const inputs = {
    guideDirectory: {
      type: "string",
      required: true,
      default: "aih-guide",
      minLength: 1,
      maxLength: 64,
      description:
        "Project directory for the offline manual and reference profiles; no client registration.",
    },
  };
  const target = (path) => ({
    root: "project",
    segments: [{ input: "guideDirectory" }, ...path.split("/").map((literal) => ({ literal }))],
  });
  const recipe = {
    schema: "urn:aihq:core:recipe:1.0.0",
    id: "aihq.guide",
    description:
      "Install the pinned Ask AIH Guide offline manual and reference agent profiles. No native conversation entry is registered.",
    inputs,
    materials: materials.map(({ id, sha256, byteLength }) => ({ id, sha256, byteLength })),
    targets: ["project"],
    prerequisites: [],
    operations: delivered.map(([id, , path]) => ({
      id: `write-${id}`,
      purpose: `Save canonical Guide ${path}`,
      kind: "file.write",
      scope: "project",
      target: target(path),
      material: id,
      requires: [],
      checks: [`${id}-sha256`],
    })),
    checks: delivered.map(([id, , path]) => ({
      id: `${id}-sha256`,
      purpose: `Verify canonical Guide ${path}`,
      kind: "file.sha256",
      target: target(path),
      sha256: materials.find((m) => m.id === id).sha256,
    })),
  };
  const recipeBytes = document(recipe);
  const recipePath = "release/recipes/aihq.guide.json";
  files.set(recipePath, recipeBytes);
  files.set(
    GUIDE_RELEASE_PATH,
    document({
      schema: "urn:aihq:catalog:release:1.0.0",
      package: { name: pkg.name, version: pkg.version },
      sources: [
        {
          id: "aih-extensions-guide",
          origin: { kind: "git", repository: source.repository, revision: source.revision },
        },
      ],
      items: [
        {
          id: "aihq.guide",
          label: "Ask AIH Guide",
          description: recipe.description,
          kind: "agent",
          sourceIds: ["aih-extensions-guide"],
          targets: [],
          scopes: ["project"],
          inputs,
          recipe: {
            id: recipe.id,
            schema: recipe.schema,
            path: recipePath,
            sha256: sha(recipeBytes),
            byteLength: recipeBytes.length,
          },
          materials,
          dependencies: { requires: [], optional: [], conflicts: [] },
          metadata: {
            extensions: {
              version: source.version,
              sourceInputCommit: manifest.source.commit,
              sourceSetSha256: manifest.source.sha256,
            },
            distribution: {
              entry: "manual",
              nativeConversation: "unverified-for-exact-packaged-bytes",
              profiles: "reference-only",
            },
          },
        },
      ],
    }),
  );
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const check = process.argv[2] === "--check";
  if (process.argv.length > (check ? 3 : 2))
    throw new Error("Usage: node tools/generate-guide-release.mjs [--check]");
  for (const [path, bytes] of generateGuideRelease(root)) {
    const output = resolve(root, path);
    if (check) {
      if (!readFileSync(output).equals(bytes)) throw new Error(`${path} is stale`);
    } else {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, bytes);
    }
  }
  console.log(`${check ? "Checked" : "Generated"} ${GUIDE_RELEASE_PATH}`);
}
