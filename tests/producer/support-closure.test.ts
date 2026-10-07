import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBaseRelease } from "../../src/producer/base.js";
import { buildCandidate } from "../../src/producer/candidate.js";
import { parseDeclaration } from "../../src/producer/declaration.js";
import { readInstalledRelease } from "../../src/release/node.js";
import { getItem } from "../../src/release/reader.js";
import { memoryTree, packageIdentity, REPOSITORY, sha256 } from "./helpers.js";

const REVISION = "d81f3a183412e71a5b1e84ca21bc1a35eea03a60";
const SKILL_PATH = "skills/engineering/tdd/SKILL.md";
const SUPPORT_PATH = "skills/engineering/tdd/tests.md";
const SUPPORT_BYTES = Buffer.from("# Test examples\n", "utf8");

const fixtureDeclaration = () =>
  parseDeclaration({
    format: "aihq-catalog-producer-declaration",
    version: 1,
    sources: [
      {
        id: "mattpocock-skills",
        repository: REPOSITORY,
        licensePath: "LICENSE",
        license: "MIT",
        pluginManifestPath: ".claude-plugin/plugin.json",
      },
    ],
    items: [
      {
        id: "mattpocock.tdd",
        source: "mattpocock-skills",
        label: "Test-driven development",
        skillPath: SKILL_PATH,
        supportPaths: ["tests.md"],
        requires: [],
      },
    ],
  });
const fixtureFiles = (manifest: string | Uint8Array) => ({
  LICENSE: "MIT License\n",
  ".claude-plugin/plugin.json": manifest,
  [SKILL_PATH]:
    "---\nname: tdd\ndescription: Test-driven development.\n---\n\nRead [test examples](tests.md).\n",
  [SUPPORT_PATH]: SUPPORT_BYTES,
});

describe("declared Matt Pocock support files", () => {
  it("accepts a wide valid manifest inside the advertised byte and nesting bounds", () => {
    const manifest = JSON.stringify({
      skills: ["./skills/engineering/tdd"],
      extra: Array(150000).fill(0),
    });
    const candidate = buildCandidate({
      declaration: fixtureDeclaration(),
      package: packageIdentity(),
      tree: memoryTree(REVISION, fixtureFiles(manifest)),
    });
    expect(candidate.report.summary.added).toBe(1);
  });
  it("refuses an ambiguous manifest instead of silently taking the last skills list", () => {
    expect(() =>
      buildCandidate({
        declaration: fixtureDeclaration(),
        package: packageIdentity(),
        tree: memoryTree(
          REVISION,
          fixtureFiles('{"skills":[],"skills":["./skills/engineering/tdd"]}'),
        ),
      }),
    ).toThrow(/plugin-manifest-invalid/);
  });
  it.each([
    '{"skills":["./skills/engineering/tdd"],"metadata":{"x":1,"x":2}}',
    `{"skills":["./skills/engineering/tdd"],"extra":${"[".repeat(33)}0${"]".repeat(33)}}`,
    '{"skills":["./skills/engineering/tdd"],"extra":9007199254740992}',
    '{"skills":["./skills/engineering/tdd"],"extra":"\\ud800"}',
    '{"skills":["./skills/engineering/tdd"],}',
    Buffer.from([0xff]),
    Buffer.alloc(1024 * 1024 + 1, 32),
  ])("refuses malformed or unbounded manifest input %$", (manifest) => {
    expect(() =>
      buildCandidate({
        declaration: fixtureDeclaration(),
        package: packageIdentity(),
        tree: memoryTree(REVISION, fixtureFiles(manifest)),
      }),
    ).toThrow(/plugin-manifest-invalid/);
  });
  it("removes a plugin-excluded skill even when its file remains, without inferring removal from an incomplete inventory", () => {
    const declared = fixtureDeclaration();
    const first = declared.items[0];
    if (first === undefined) throw new Error("fixture requires its skill");
    const declaration = {
      ...declared,
      items: [
        ...declared.items,
        {
          ...first,
          id: "mattpocock.keep",
          entry: "keep",
          directory: "skills/engineering/keep",
          skillPath: "skills/engineering/keep/SKILL.md",
          supportPaths: [],
        },
      ],
    };
    const files = {
      ...fixtureFiles('{"skills":["./skills/engineering/tdd","./skills/engineering/keep"]}'),
      "skills/engineering/keep/SKILL.md": "---\nname: keep\ndescription: Retained skill.\n---\n",
    };
    const initial = buildCandidate({
      declaration,
      package: packageIdentity(),
      tree: memoryTree(REVISION, files),
    });
    const base = parseBaseRelease(initial.files);
    const excluded = {
      ...files,
      ".claude-plugin/plugin.json": '{"skills":["./skills/engineering/keep"]}',
    };
    const result = buildCandidate({
      declaration,
      package: packageIdentity(),
      base,
      tree: memoryTree(REVISION, excluded),
    });
    expect(result.report.summary.removed).toBe(1);
    expect(
      JSON.parse(
        Buffer.from(result.files.get("release/release.json") as Buffer).toString(),
      ).items.map((item: { id: string }) => item.id),
    ).toEqual(["mattpocock.keep"]);
    expect(() =>
      buildCandidate({
        declaration,
        package: packageIdentity(),
        base,
        tree: memoryTree(REVISION, excluded, { complete: false }),
      }),
    ).toThrow(/inventory-incomplete/);
  });
  it("rebuilds the recipe and material when a referenced support file changes", () => {
    const files = fixtureFiles('{"skills":["./skills/engineering/tdd"]}');
    const initial = buildCandidate({
      declaration: fixtureDeclaration(),
      package: packageIdentity(),
      tree: memoryTree(REVISION, files),
    });
    const result = buildCandidate({
      declaration: fixtureDeclaration(),
      package: packageIdentity(),
      base: parseBaseRelease(initial.files),
      tree: memoryTree("a".repeat(40), { ...files, [SUPPORT_PATH]: "# Updated examples\n" }),
    });
    expect(result.report.summary.changed).toBe(1);
    expect(result.files.get("release/recipes/mattpocock.tdd.json")).not.toEqual(
      initial.files.get("release/recipes/mattpocock.tdd.json"),
    );
  });
  it.each([
    "absent",
    "irregular",
    "unknown",
  ] as const)("refuses a %s support member instead of producing partial content", (status) => {
    const files = fixtureFiles('{"skills":["./skills/engineering/tdd"]}');
    const { [SUPPORT_PATH]: _support, ...missing } = files;
    expect(() =>
      buildCandidate({
        declaration: fixtureDeclaration(),
        package: packageIdentity(),
        tree: memoryTree(REVISION, missing, {
          complete: status !== "unknown",
          irregular: status === "irregular" ? [SUPPORT_PATH] : [],
        }),
      }),
    ).toThrow(/support|inventory-incomplete|irregular/);
  });
  it("installs a skill's referenced support file through the checked package release", async () => {
    const skillBytes = Buffer.from(
      "---\nname: tdd\ndescription: Test-driven development.\n---\n\nRead [test examples](tests.md).\n",
      "utf8",
    );
    const declaration = parseDeclaration({
      format: "aihq-catalog-producer-declaration",
      version: 1,
      sources: [
        {
          id: "mattpocock-skills",
          repository: REPOSITORY,
          licensePath: "LICENSE",
          license: "MIT",
          pluginManifestPath: ".claude-plugin/plugin.json",
        },
      ],
      items: [
        {
          id: "mattpocock.tdd",
          source: "mattpocock-skills",
          label: "Test-driven development",
          skillPath: SKILL_PATH,
          supportPaths: ["tests.md"],
          requires: [],
        },
      ],
    });
    const tree = memoryTree(REVISION, {
      LICENSE: "MIT License\n",
      ".claude-plugin/plugin.json": JSON.stringify({
        name: "mattpocock-skills",
        version: "1.2.3",
        skills: ["./skills/engineering/tdd"],
      }),
      [SKILL_PATH]: skillBytes,
      [SUPPORT_PATH]: SUPPORT_BYTES,
    });
    const candidate = buildCandidate({
      declaration,
      tree,
      package: packageIdentity(),
    });
    const packageRoot = mkdtempSync(join(tmpdir(), "catalog-support-"));
    try {
      writeFileSync(
        join(packageRoot, "package.json"),
        JSON.stringify({
          ...packageIdentity(),
          exports: { "./release.json": "./release/release.json" },
        }),
      );
      for (const [path, bytes] of candidate.files) {
        const target = join(packageRoot, ...path.split("/"));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes);
      }
      const read = await readInstalledRelease({ root: packageRoot });

      expect(read.valid, JSON.stringify(read.diagnostics)).toBe(true);
      if (!read.valid || read.release === undefined) return;
      const item = getItem(read.release, "mattpocock.tdd");
      expect(item.found).toBe(true);
      if (!item.found) return;

      const support = item.item.materials.find((member) =>
        member.path.endsWith(`/${SUPPORT_PATH}`),
      );
      expect(support).toMatchObject({
        sha256: sha256(SUPPORT_BYTES),
        byteLength: SUPPORT_BYTES.byteLength,
      });
      expect(candidate.files.get(support?.path ?? "")).toEqual(SUPPORT_BYTES);

      const recipe = JSON.parse(
        (candidate.files.get(item.item.recipe.path) as Buffer).toString("utf8"),
      ) as {
        operations: { kind: string; material?: string; target: { segments: unknown[] } }[];
      };
      expect(recipe.operations).toContainEqual(
        expect.objectContaining({
          kind: "file.write",
          material: support?.id,
          target: {
            root: "project",
            segments: [
              { input: "agentDirectory" },
              { literal: "skills" },
              { literal: "tdd" },
              { literal: "tests.md" },
            ],
          },
        }),
      );
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });
});
