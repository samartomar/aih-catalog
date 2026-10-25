import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createContentInventory } from "../../src/release/inventory.js";
import { readRelease } from "../../src/release/reader.js";

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
};
const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const releaseBytes = (document: unknown): Uint8Array => encode(`${canonical(document)}\n`);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const hex = (seed: string) => sha256(seed);

const BEHAVIOUR_REL_PATH = "aih-behaviour.json";
const FRAMEWORK_ID = "example-framework";
const itemFolder = (itemId: string) => `release/items/${itemId}`;

function material(
  itemId: string,
  id: string,
  relPath: string,
  sourcePath: string | null,
  executable: boolean | "unknown",
): Record<string, Json> {
  return {
    id,
    relPath,
    sourcePath,
    packagePath: `${itemFolder(itemId)}/${relPath}`,
    sha256: hex(`${itemId}:${relPath}`),
    byteLength: 100,
    executable,
    sourceId: relPath === BEHAVIOUR_REL_PATH ? FRAMEWORK_ID : "upstream",
    role: relPath === BEHAVIOUR_REL_PATH ? "behaviour" : "content",
  };
}

function buildItem(options: {
  id: string;
  kind: string;
  payload?: Json;
  requirements?: Json;
  dependencies?: Json;
  executable?: Record<string, true | false | "unknown">;
  contentSeeds?: string[];
  withBehaviour?: boolean;
  extra?: Record<string, unknown>;
}): Record<string, Json> {
  const { id, kind } = options;
  const relPaths = options.contentSeeds ?? ["LICENSE", "SKILL.md"];
  const declaredExecutable: Record<string, true | false | "unknown"> = {};
  const contentMaterials = relPaths.map((relPath) => {
    const state = options.executable?.[relPath] ?? false;
    declaredExecutable[relPath] = state;
    return material(
      id,
      relPath === "LICENSE" ? "license" : `skill-${relPaths.indexOf(relPath)}`,
      relPath,
      relPath,
      state,
    );
  });
  const dependencies = options.dependencies ?? { requires: [], optional: [], conflicts: [] };
  const requirements = options.requirements ?? { inputs: {} };
  const payload = options.payload ?? null;
  const behaviourValue = {
    kind,
    payload,
    requirements,
    dependencies,
    executable: declaredExecutable,
  };
  const behaviourText = `${canonical(behaviourValue)}\n`;
  const behaviourMember = material(id, "behaviour", BEHAVIOUR_REL_PATH, null, false);
  const behaviourEncoded = encode(behaviourText);
  behaviourMember.sha256 = sha256(behaviourEncoded);
  behaviourMember.byteLength = behaviourEncoded.length;
  const withBehaviour = options.withBehaviour ?? true;
  const materials = (
    withBehaviour ? [...contentMaterials, behaviourMember] : contentMaterials
  ).sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
  const lines = (members: Record<string, Json>[]) =>
    members
      .map((member) => `${String(member.relPath)}\t${String(member.sha256)}\n`)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const item: Record<string, Json> = {
    id,
    label: typeof options.extra?.label === "string" ? options.extra.label : id,
    kind,
    sourceIds: ["upstream"],
    targets: [],
    scopes: ["project"],
    inputs: {},
    recipe: {
      id,
      schema: "urn:aihq:core:recipe:1.0.0",
      path: `release/recipes/${id}.json`,
      sha256: hex(`${id}-recipe`),
      byteLength: 900,
    },
    materials,
    dependencies,
    requirements,
    executable: declaredExecutable,
    contentSha256: sha256(encode(lines(contentMaterials).join(""))),
    behaviourSha256: sha256(
      encode(
        lines(withBehaviour ? [...contentMaterials, behaviourMember] : contentMaterials).join(""),
      ),
    ),
  };
  if (options.payload !== undefined) item.payload = options.payload;
  if (options.extra) Object.assign(item, options.extra);
  return item;
}

/** Independent freeze: the exact content-inventory 1.1 projection plus a test binding. */
function bindAny(release: Record<string, Json>): Record<string, Json> {
  const { baseline: _omit, ...content } = release;
  const inventoryDoc = {
    schema: "urn:aihq:catalog:content-inventory:1.1.0",
    projection: "urn:aihq:catalog:release-content:1.1.0",
    release: content,
  };
  const bytes = releaseBytes(inventoryDoc);
  return {
    ...release,
    baseline: {
      schema: "urn:aihq:catalog:scan-baseline:1.0.0",
      inventory: {
        path: "release/content-inventory.json",
        sha256: sha256(bytes),
        byteLength: bytes.length,
      },
      scanId: `scan:sha256:${"a".repeat(64)}`,
      artifact: {
        sha256: "b".repeat(64),
        byteLength: 200,
        location: { kind: "package", path: "release/baseline.json" },
      },
      scope: { namespace: "package-relative", paths: ["release"], excludedPaths: [] },
    },
  };
}

/** Public freeze through createContentInventory; asserts the document is well formed. */
function bindFrozen(release: Record<string, Json>): Record<string, Json> {
  const bytes = releaseBytes(release);
  const inventory = createContentInventory(bytes, { expectedSha256: sha256(bytes) });
  if (!inventory.valid) throw new Error(JSON.stringify(inventory));
  return {
    ...release,
    baseline: {
      schema: "urn:aihq:catalog:scan-baseline:1.0.0",
      inventory: {
        path: "release/content-inventory.json",
        sha256: inventory.sha256,
        byteLength: inventory.byteLength,
      },
      scanId: `scan:sha256:${"a".repeat(64)}`,
      artifact: {
        sha256: "b".repeat(64),
        byteLength: 200,
        location: { kind: "package", path: "release/baseline.json" },
      },
      scope: { namespace: "package-relative", paths: ["release"], excludedPaths: [] },
    },
  };
}

function release16(items: Json[], extra: Record<string, Json> = {}): Record<string, Json> {
  return {
    schema: "urn:aihq:catalog:release:1.6.0",
    package: { name: "@example/catalog", version: "1.2.0" },
    sources: [
      {
        id: "upstream",
        license: "MIT",
        origin: {
          kind: "git",
          repository: "https://github.com/example/skills",
          revision: "0123456789abcdef0123456789abcdef01234567",
        },
      },
    ],
    framework: {
      id: FRAMEWORK_ID,
      name: "Example Framework",
      version: "1.2.0",
      description: "Framework used by the release 1.6 tests.",
    },
    items,
    ...extra,
  };
}

const read = (document: unknown) => {
  const bytes = releaseBytes(document);
  return readRelease(bytes, { expectedSha256: sha256(bytes) });
};

const reasons = (result: {
  valid: boolean;
  diagnostics: ReadonlyArray<{ readonly reason: string }>;
}) => result.diagnostics.map((diagnostic) => diagnostic.reason);

describe("release 1.6.0 admission", () => {
  it("reads a release with framework, behaviour files, identities and typed payloads", () => {
    const item = buildItem({
      id: "alpha",
      kind: "skill",
      payload: {
        dirName: "alpha",
        invocation: "user-only",
        invocationBasis: "authored frontmatter",
      },
      extra: { name: "Alpha", nameBasis: "authored" },
    });
    const result = read(bindFrozen(release16([item])));
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.release.framework?.id).toBe(FRAMEWORK_ID);
    const alpha = result.release.items[0] as unknown as Record<string, unknown>;
    expect(alpha.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(alpha.behaviourSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(alpha.itemSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps itemSha256 meaning: it is not either new identity", () => {
    const item = buildItem({ id: "alpha", kind: "skill" });
    const result = read(bindFrozen(release16([item])));
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const alpha = result.release.items[0] as unknown as Record<string, unknown>;
    expect(alpha.itemSha256).not.toBe(alpha.contentSha256);
    expect(alpha.itemSha256).not.toBe(alpha.behaviourSha256);
  });

  it("refuses an item whose declarations differ from the behaviour file", () => {
    const item = buildItem({ id: "alpha", kind: "skill" });
    const tampered = {
      ...item,
      payload: { dirName: "alpha", invocation: "model-allowed", invocationBasis: "changed" },
    };
    const result = read(bindAny(release16([tampered])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("behaviour-mismatch");
  });

  it("refuses a changed dependency list against the frozen behaviour file", () => {
    const item = buildItem({ id: "alpha", kind: "skill" });
    const tampered = {
      ...item,
      dependencies: { requires: [{ itemId: "other" }], optional: [], conflicts: [] },
    };
    const result = read(bindAny(release16([tampered])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("behaviour-mismatch");
  });

  it("requires exactly one behaviour material at the reserved path", () => {
    const item = buildItem({ id: "alpha", kind: "skill" });
    const materials = (item.materials as Record<string, Json>[]).filter(
      (member) => member.role !== "behaviour",
    );
    const tampered = { ...item, materials };
    const result = read(bindAny(release16([tampered])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("behaviour-count");
  });

  it("refuses a content material at the reserved behaviour path", () => {
    const item = buildItem({ id: "alpha", kind: "skill" });
    const materials = (item.materials as Record<string, Json>[]).map((member) =>
      member.role === "content" && member.relPath === "SKILL.md"
        ? { ...member, relPath: BEHAVIOUR_REL_PATH }
        : member,
    );
    const tampered = { ...item, materials };
    const result = read(bindAny(release16([tampered])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("reserved-behaviour-path");
  });

  it("requires the behaviour file to be synthesised by the publishing framework", () => {
    const item = buildItem({ id: "alpha", kind: "skill" });
    const materials = (item.materials as Record<string, Json>[]).map((member) =>
      member.role === "behaviour" ? { ...member, sourceId: "other" } : member,
    );
    const tampered = { ...item, materials };
    const result = read(bindAny(release16([tampered])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("behaviour-source-id");
  });

  it("requires the behaviour file to sit under the item's package folder", () => {
    const item = buildItem({ id: "alpha", kind: "skill" });
    const materials = (item.materials as Record<string, Json>[]).map((member) =>
      member.role === "behaviour"
        ? { ...member, packagePath: "release/elsewhere/aih-behaviour.json" }
        : member,
    );
    const tampered = { ...item, materials };
    const result = read(bindAny(release16([tampered])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("behaviour-package-path");
  });

  it("requires the framework identity when items carry behaviour files", () => {
    const item = buildItem({ id: "alpha", kind: "skill" });
    const document = release16([item]);
    delete document.framework;
    const result = read(bindAny(document));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("framework-required");
  });

  it("requires an SPDX licence on every source hop once behaviour is published", () => {
    const item = buildItem({ id: "alpha", kind: "skill" });
    const document = release16([item]);
    const sources = document.sources as Record<string, Json>[];
    delete sources[0]?.license;
    const result = read(bindAny(document));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("missing-license");
  });
});

describe("release 1.6.0 identity vectors", () => {
  const baseOptions = {
    id: "alpha",
    kind: "skill",
    payload: { dirName: "alpha", invocation: "user-only", invocationBasis: "basis" },
  };

  it("changes only behaviourSha256 on a payload-only change", () => {
    const first = buildItem(baseOptions);
    const second = buildItem({
      ...baseOptions,
      payload: { dirName: "alpha", invocation: "model-allowed", invocationBasis: "basis" },
    });
    expect(second.contentSha256).toBe(first.contentSha256);
    expect(second.behaviourSha256).not.toBe(first.behaviourSha256);
  });

  it("changes only behaviourSha256 on a dependency-only change", () => {
    const first = buildItem(baseOptions);
    const second = buildItem({
      ...baseOptions,
      dependencies: { requires: [{ itemId: "beta" }], optional: [], conflicts: [] },
    });
    expect(second.contentSha256).toBe(first.contentSha256);
    expect(second.behaviourSha256).not.toBe(first.behaviourSha256);
  });

  it("changes only behaviourSha256 on an executable-only change", () => {
    const first = buildItem(baseOptions);
    const second = buildItem({ ...baseOptions, executable: { "SKILL.md": true, LICENSE: false } });
    expect(second.contentSha256).toBe(first.contentSha256);
    expect(second.behaviourSha256).not.toBe(first.behaviourSha256);
  });

  it("changes both identities on a content byte change", () => {
    const first = buildItem(baseOptions);
    const second = buildItem({ ...baseOptions, contentSeeds: ["LICENSE", "SKILL.md", "extra.md"] });
    expect(second.contentSha256).not.toBe(first.contentSha256);
    expect(second.behaviourSha256).not.toBe(first.behaviourSha256);
  });

  it("freezes refuse a recomputed contentSha256 mismatch", () => {
    const item = buildItem(baseOptions);
    const document = release16([{ ...item, contentSha256: hex("wrong") }]);
    const bytes = releaseBytes(document);
    const inventory = createContentInventory(bytes, { expectedSha256: sha256(bytes) });
    expect(inventory.valid).toBe(false);
    if (inventory.valid) return;
    expect(reasons(inventory)).toContain("content-hash-mismatch");
  });

  it("freezes refuse a recomputed behaviourSha256 mismatch", () => {
    const item = buildItem(baseOptions);
    const document = release16([{ ...item, behaviourSha256: hex("wrong") }]);
    const bytes = releaseBytes(document);
    const inventory = createContentInventory(bytes, { expectedSha256: sha256(bytes) });
    expect(inventory.valid).toBe(false);
    if (inventory.valid) return;
    expect(reasons(inventory)).toContain("behaviour-hash-mismatch");
  });
});

describe("release 1.6.0 coexistence", () => {
  it("reads a plain 1.6.0 item exactly like a 1.5 item", () => {
    const legacyItem = {
      id: "legacy",
      label: "Legacy",
      kind: "skill",
      sourceIds: ["upstream"],
      targets: [],
      scopes: ["project"],
      inputs: {},
      recipe: {
        id: "legacy",
        schema: "urn:aihq:core:recipe:1.0.0",
        path: "release/recipes/legacy.json",
        sha256: hex("legacy-recipe"),
        byteLength: 500,
      },
      materials: [
        {
          id: "skill",
          path: "release/materials/legacy/SKILL.md",
          sha256: hex("legacy"),
          byteLength: 100,
        },
      ],
      dependencies: { requires: [], optional: [], conflicts: [] },
    } as unknown as Json;
    const document = bindAny(release16([legacyItem]));
    const result = read(document);
    expect(result.valid).toBe(true);
  });

  it("reads 1.5.0 and 1.6.0 releases side by side with one package", () => {
    const item = buildItem({ id: "alpha", kind: "skill" });
    const read16 = read(bindFrozen(release16([item])));
    expect(read16.valid).toBe(true);
    const release15 = {
      schema: "urn:aihq:catalog:release:1.5.0",
      package: { name: "@example/catalog", version: "1.0.0" },
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
          id: "plain",
          label: "Plain",
          kind: "skill",
          sourceIds: ["upstream"],
          targets: [],
          scopes: ["project"],
          inputs: {},
          recipe: {
            id: "plain",
            schema: "urn:aihq:core:recipe:1.0.0",
            path: "release/recipes/plain.json",
            sha256: hex("plain-recipe"),
            byteLength: 500,
          },
          materials: [
            {
              id: "skill",
              path: "release/materials/plain/SKILL.md",
              sha256: hex("plain"),
              byteLength: 100,
            },
          ],
          dependencies: { requires: [], optional: [], conflicts: [] },
        },
      ],
    };
    const bytes15 = releaseBytes(release15);
    const inventory15 = createContentInventory(bytes15, { expectedSha256: sha256(bytes15) });
    expect(inventory15.valid).toBe(true);
    if (!inventory15.valid) return;
    const bound15 = {
      ...release15,
      baseline: {
        schema: "urn:aihq:catalog:scan-baseline:1.0.0",
        inventory: {
          path: "release/content-inventory.json",
          sha256: inventory15.sha256,
          byteLength: inventory15.byteLength,
        },
        scanId: `scan:sha256:${"c".repeat(64)}`,
        artifact: {
          sha256: "d".repeat(64),
          byteLength: 200,
          location: { kind: "package", path: "release/baseline.json" },
        },
        scope: { namespace: "package-relative", paths: ["release"], excludedPaths: [] },
      },
    };
    const read15 = read(bound15);
    expect(read15.valid).toBe(true);
  });

  it("refuses unknown fields as a whole, naming the encounter", () => {
    const item = buildItem({ id: "alpha", kind: "skill" });
    const document = bindAny(release16([{ ...item, unexpectedField: true }]));
    const result = read(document);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    const unknown = result.diagnostics.find((diagnostic) => diagnostic.reason === "unknown-field");
    expect(unknown?.path).toContain("unexpectedField");
  });
});

describe("release 1.6.0 typed payloads", () => {
  it("refuses a hook placeholder outside the closed list", () => {
    const item = buildItem({
      id: "hook-item",
      kind: "hook",
      payload: {
        event: "pre-commit",
        protocol: "claude-code-hooks",
        command: {
          interpreter: "node",
          script: "skill-1",
          args: ["--dir", "{workspaceRoot}"],
        },
      },
    });
    const result = read(bindAny(release16([item])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("unknown-placeholder");
  });

  it("accepts the four closed hook placeholders", () => {
    const item = buildItem({
      id: "hook-item",
      kind: "hook",
      payload: {
        event: "pre-commit",
        protocol: "claude-code-hooks",
        command: {
          interpreter: "node",
          script: "skill-1",
          args: ["{projectDir}", "{homeDir}", "{itemDir}", "{pluginRoot}"],
        },
      },
    });
    const result = read(bindFrozen(release16([item])));
    expect(result.valid).toBe(true);
  });

  it("refuses an MCP stdio transport without a command", () => {
    const item = buildItem({
      id: "mcp-item",
      kind: "mcp-server",
      payload: { key: "github", transport: "stdio" },
    });
    const result = read(bindAny(release16([item])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("mcp-command-required");
  });

  it("refuses an MCP http transport without a url", () => {
    const item = buildItem({
      id: "mcp-item",
      kind: "mcp-server",
      payload: { key: "github", transport: "http", command: "npx" },
    });
    const result = read(bindAny(release16([item])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("mcp-url-required");
  });

  it("refuses a secret-bearing MCP literal value", () => {
    const item = buildItem({
      id: "mcp-item",
      kind: "mcp-server",
      payload: {
        key: "github",
        transport: "http",
        url: "https://example.test/mcp",
        env: { api_token: { value: "hardcoded" } },
      },
    });
    const result = read(bindAny(release16([item])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("secret-literal");
  });

  it("requires an MCP environment input to be a declared requirements input", () => {
    const item = buildItem({
      id: "mcp-item",
      kind: "mcp-server",
      requirements: { inputs: {} },
      payload: {
        key: "github",
        transport: "stdio",
        command: "npx",
        env: { github_pat: { input: "githubPat" } },
      },
    });
    const result = read(bindAny(release16([item])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("unknown-input");
  });

  it("accepts MCP environment inputs declared by the server", () => {
    const item = buildItem({
      id: "mcp-item",
      kind: "mcp-server",
      requirements: {
        inputs: { githubPat: { type: "string", required: true, sensitive: true } },
      },
      payload: {
        key: "github",
        transport: "stdio",
        command: "npx",
        env: { github_pat: { input: "githubPat" } },
        headers: { "x-static": { value: "plain" } },
      },
    });
    const result = read(bindFrozen(release16([item])));
    expect(result.valid).toBe(true);
  });
});

describe("release 1.6.0 names and provenance", () => {
  it("rejects a path-shaped display name", () => {
    const item = buildItem({ id: "alpha", kind: "skill", extra: { name: "some/path" } });
    const result = read(bindAny(release16([item])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("path-shaped-name");
  });

  it("rejects a duplicate display name within one framework, kind and namespace", () => {
    const first = buildItem({
      id: "alpha",
      kind: "skill",
      payload: {
        dirName: "alpha",
        namespace: "core",
        invocation: "user-only",
        invocationBasis: "b",
      },
      extra: { name: "Coding Style" },
    });
    const second = buildItem({
      id: "beta",
      kind: "skill",
      payload: {
        dirName: "beta",
        namespace: "core",
        invocation: "user-only",
        invocationBasis: "b",
      },
      extra: { name: "Coding Style" },
    });
    const result = read(bindAny(release16([first, second])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("duplicate-name");
  });

  it("allows the same display name in a different namespace", () => {
    const first = buildItem({
      id: "alpha",
      kind: "skill",
      payload: {
        dirName: "alpha",
        namespace: "core",
        invocation: "user-only",
        invocationBasis: "b",
      },
      extra: { name: "Coding Style" },
    });
    const second = buildItem({
      id: "beta",
      kind: "skill",
      payload: {
        dirName: "beta",
        namespace: "tests",
        invocation: "user-only",
        invocationBasis: "b",
      },
      extra: { name: "Coding Style" },
    });
    const result = read(bindFrozen(release16([first, second])));
    expect(result.valid).toBe(true);
  });

  it("refuses a verified derivation without per-material proof", () => {
    const item = buildItem({
      id: "alpha",
      kind: "skill",
      extra: { derivedFrom: [{ itemId: "upstream-item", status: "verified" }] },
    });
    const result = read(bindAny(release16([item])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("unverified-derivation");
  });

  it("refuses derivation proof that names a relPath the item does not carry", () => {
    const item = buildItem({
      id: "alpha",
      kind: "skill",
      extra: {
        derivedFrom: [
          {
            itemId: "upstream-item",
            status: "verified",
            proof: { materials: [{ relPath: "missing.md", sha256: hex("source-hash") }] },
          },
        ],
      },
    });
    const result = read(bindAny(release16([item])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("unverified-derivation");
  });

  it("accepts a real patched copy whose proof records the source hashes", () => {
    // A modified copy: the proof names this item's materials with the
    // derived-from source's digests, which the reader cannot recompute.
    const item = buildItem({ id: "alpha", kind: "skill" });
    const withProof = {
      ...item,
      derivedFrom: [
        {
          itemId: "upstream-item",
          status: "verified",
          proof: {
            materials: [
              { relPath: "SKILL.md", sha256: hex("source-skill-bytes") },
              { relPath: "LICENSE", sha256: hex("source-license-bytes") },
            ],
          },
        },
      ],
    };
    const result = read(bindFrozen(release16([withProof])));
    expect(result.valid).toBe(true);
  });

  it("accepts a declared derivation without proof and a verified one with matching proof", () => {
    const item = buildItem({ id: "alpha", kind: "skill" });
    const skillMaterial = (item.materials as Record<string, Json>[]).find(
      (member) => member.relPath === "SKILL.md",
    ) as Record<string, Json>;
    const withProvenance = {
      ...item,
      derivedFrom: [
        { itemId: "other-item", status: "declared" },
        {
          itemId: "upstream-item",
          status: "verified",
          proof: { materials: [{ relPath: "SKILL.md", sha256: skillMaterial.sha256 }] },
        },
      ] as Json[],
    };
    const result = read(bindFrozen(release16([withProvenance])));
    expect(result.valid).toBe(true);
  });

  it("requires the item executable map to equal the content materials' states", () => {
    const item = buildItem({ id: "alpha", kind: "skill" });
    const tampered = { ...item, executable: { "SKILL.md": true, LICENSE: false } };
    const result = read(bindAny(release16([tampered])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("executable-map-mismatch");
  });
});

describe("release 1.6.0 consumer flow", () => {
  it("configureItem resolves extended materials by their package path", async () => {
    const { configureItem } = await import("../../src/release/reader.js");
    const item = buildItem({ id: "alpha", kind: "skill" });
    const document = bindFrozen(release16([item]));
    const result = read(document);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const configured = configureItem({
      release: result.release,
      itemId: "alpha",
      configuration: {},
      materialSource: {
        kind: "archive",
        url: "https://example.test/pkg.tgz",
        sha256: hex("pkg"),
        byteLength: 1000,
      },
    });
    expect(configured.valid).toBe(true);
    if (!configured.valid) return;
    const reference = configured.selection?.recipe.reference;
    const behaviour = reference?.materials.find(
      (member) => member.path === "package/release/items/alpha/aih-behaviour.json",
    );
    expect(behaviour).toBeDefined();
    const skill = reference?.materials.find(
      (member) => member.path === "package/release/items/alpha/SKILL.md",
    );
    expect(skill).toBeDefined();
  });
});

describe("release 1.6.0 closed admission", () => {
  it("refuses an unknown nested payload field as a whole", () => {
    const item = buildItem({
      id: "alpha",
      kind: "skill",
      payload: {
        dirName: "alpha",
        invocation: "user-only",
        invocationBasis: "basis",
        unexpected: true,
      },
    });
    const result = read(bindAny(release16([item])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("unknown-field");
  });

  it("refuses an explicit null payload", () => {
    const item = buildItem({ id: "alpha", kind: "skill", payload: null });
    const result = read(bindAny(release16([item])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("invalid-payload");
  });

  it("refuses an absolute sourcePath on an extended material", () => {
    const item = buildItem({ id: "alpha", kind: "skill" });
    const materials = (item.materials as Record<string, Json>[]).map((member) =>
      member.role === "content" ? { ...member, sourcePath: "/etc/passwd" } : member,
    );
    const result = read(bindAny(release16([{ ...item, materials }])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("invalid-source-path");
  });

  it("requires clientId on a 1.6 client-adapter item", () => {
    const item = buildItem({
      id: "alpha",
      kind: "client-adapter",
      payload: { files: ["skill-1"] },
      extra: {},
    });
    delete (item as Record<string, Json>).payload;
    const result = read(bindAny(release16([item])));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(reasons(result)).toContain("missing-field");
  });

  it("accepts a non-ASCII behaviour file by its UTF-8 byte length", () => {
    const item = buildItem({
      id: "alpha",
      kind: "skill",
      payload: { dirName: "alpha", invocation: "user-only", invocationBasis: "bäsis" },
    });
    const result = read(bindFrozen(release16([item])));
    expect(result.valid).toBe(true);
  });

  it("derives the Scan item evidence descriptor with recomputed identities", async () => {
    const { itemEvidenceDescriptor } = await import("../../src/release/reader.js");
    const item = buildItem({
      id: "alpha",
      kind: "skill",
      executable: { "SKILL.md": true, "LICENSE": false },
    });
    const document = bindFrozen(release16([item]));
    const result = read(document);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const evidence = itemEvidenceDescriptor(result.release, { itemId: "alpha" });
    expect(evidence.valid).toBe(true);
    if (!evidence.valid) return;
    expect(evidence.descriptor.frameworkId).toBe(FRAMEWORK_ID);
    expect(evidence.descriptor.itemId).toBe("alpha");
    const checked = result.release.items[0];
    expect(checked).toBeDefined();
    if (checked === undefined) return;
    expect(evidence.descriptor.contentSha256).toBe(checked.contentSha256);
    const behaviour = evidence.descriptor.materials.find((member) => member.role === "behaviour");
    expect(behaviour?.path).toBe("release/items/alpha/aih-behaviour.json");
    const skill = evidence.descriptor.materials.find((member) => member.path.endsWith("/SKILL.md"));
    expect(skill?.executable).toBe(true);
  });

  it("refuses the evidence descriptor for an unknown or identity-less item", async () => {
    const { itemEvidenceDescriptor } = await import("../../src/release/reader.js");
    const item = buildItem({ id: "alpha", kind: "skill" });
    const document = bindFrozen(release16([item]));
    const result = read(document);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const unknown = itemEvidenceDescriptor(result.release, { itemId: "unknown" });
    expect(unknown.valid).toBe(false);
    const legacyItem = {
      id: "legacy",
      label: "Legacy",
      kind: "skill",
      sourceIds: ["upstream"],
      targets: [],
      scopes: ["project"],
      inputs: {},
      recipe: {
        id: "legacy",
        schema: "urn:aihq:core:recipe:1.0.0",
        path: "release/recipes/legacy.json",
        sha256: hex("legacy-recipe"),
        byteLength: 500,
      },
      materials: [
        { id: "skill", path: "release/materials/legacy/SKILL.md", sha256: hex("legacy"), byteLength: 100 },
      ],
      dependencies: { requires: [], optional: [], conflicts: [] },
    } as unknown as Json;
    const mixed = read(bindAny(release16([item, legacyItem])));
    expect(mixed.valid).toBe(true);
    if (!mixed.valid) return;
    const identityLess = itemEvidenceDescriptor(mixed.release, { itemId: "legacy" });
    expect(identityLess.valid).toBe(false);
    if (identityLess.valid) return;
    expect(reasons(identityLess)).toContain("no-item-identities");
  });
});
