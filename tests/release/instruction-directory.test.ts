import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseDeclaration } from "../../src/producer/declaration.js";
import { checkCandidateFiles } from "../../src/producer/integrity.js";
import type { CatalogRelease } from "../../src/release/contracts.js";
import {
  configureItem,
  getItem,
  listItems,
  readRelease,
  validateSelectionSet,
} from "../../src/release/reader.js";
import { committedRelease, packageIdentity, readTree, root, sha256 } from "../producer/helpers.js";

/**
 * The instruction directory is a generation-time configuration of the authored
 * project context (Catalog #55). These tests generate disposable package roots
 * through the owning generator with a default or custom declaration, then admit the
 * result through the public reader and the whole-candidate integrity checks.
 */

interface Generator {
  CONTEXT_SOURCE_ID: string;
  DECLARATION_PATH: string;
  GENERATION_INPUTS: readonly string[];
  retargetDeclaration(declaration: unknown, directory: string): Declaration;
}
interface Content {
  CONTEXT_DIR: string;
  CLIENTS: readonly { id: string }[];
  POINTERS: readonly { key: string; path: readonly string[]; delivery: string }[];
}
// @ts-expect-error The release generator is intentionally plain ESM JavaScript.
const generatorTool: Generator = await import("../../tools/generate-release.mjs");
// @ts-expect-error The context content source is intentionally plain ESM JavaScript.
const content: Content = await import("../../tools/context-content.mjs");
const CONTEXT_SOURCE = generatorTool.CONTEXT_SOURCE_ID;
const DEFAULT_DIR = content.CONTEXT_DIR;
const INPUTS = ["package.json", ...generatorTool.GENERATION_INPUTS];

const scratch = mkdtempSync(join(tmpdir(), "aih-instruction-directory-"));
let count = 0;

beforeAll(() => {
  if (!existsSync(join(root, "dist/producer/declaration.js")))
    throw new Error("run npm run build:dist first");
});
afterAll(() => {
  expect(scratch.startsWith(join(tmpdir(), "aih-instruction-directory-"))).toBe(true);
  rmSync(scratch, { recursive: true, force: true });
});

type Declaration = Record<string, unknown> & {
  authored: { source: string; externalPaths: string[]; templatePlaceholders: string[] }[];
};
const committedDeclaration = (): Declaration =>
  JSON.parse(readFileSync(join(root, "producer/declaration.json"), "utf8"));

/** The committed declaration retargeted at `directory`, its author-owned allowance moved along. */
const declarationFor = (directory: string): Declaration =>
  generatorTool.retargetDeclaration(committedDeclaration(), directory);

/** A disposable catalog root holding only the generation inputs and `declaration`. */
function stage(declaration: unknown): string {
  count += 1;
  const dir = join(scratch, `root-${count}`);
  for (const path of INPUTS) cpSync(join(root, path), join(dir, path), { recursive: true });
  mkdirSync(join(dir, "producer"), { recursive: true });
  writeFileSync(
    join(dir, "producer/declaration.json"),
    `${JSON.stringify(declaration, null, 2)}\n`,
  );
  return dir;
}

const generator = (...args: string[]) =>
  spawnSync(process.execPath, [join(root, "tools/generate-release.mjs"), ...args], {
    encoding: "utf8",
  });

function generate(declaration: unknown): { dir: string; files: Map<string, Buffer> } {
  const dir = stage(declaration);
  const result = generator(dir);
  if (result.status !== 0) throw new Error(result.stderr);
  return { dir, files: readTree(join(dir, "release"), dir) };
}

function releaseOf(files: Map<string, Buffer>): CatalogRelease {
  const bytes = files.get("release/release.json") as Buffer;
  const read = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!read.valid) throw new Error(JSON.stringify(read.diagnostics));
  return read.release;
}

const contextItems = (release: CatalogRelease) =>
  listItems(release).filter((item) => item.sourceIds.includes(CONTEXT_SOURCE));

type Target = { root: string; segments: { literal?: string }[] };
const targetPath = (target: Target) => target.segments.map((segment) => segment.literal).join("/");

const POINTER_PATHS = content.POINTERS.map((pointer) => pointer.path.join("/"));
/** The shared context item, one pointer item per entry file and one item per client. */
const FAMILY_SIZE = 1 + content.POINTERS.length + content.CLIENTS.length;

describe("retargetDeclaration", () => {
  it("sets the directory and moves only the project-context allowance under the old one", () => {
    const original = {
      ...committedDeclaration(),
      authored: [
        {
          source: CONTEXT_SOURCE,
          externalPaths: [`${DEFAULT_DIR}/PROJECT.md`, `${DEFAULT_DIR}/notes/A.md`],
          templatePlaceholders: ["<your-tool>"],
        },
        {
          source: "other-source",
          externalPaths: [`${DEFAULT_DIR}/X.md`],
          templatePlaceholders: [],
        },
      ],
    };
    const snapshot = JSON.stringify(original);
    const moved = generatorTool.retargetDeclaration(original, ".ai/context");
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(moved.instructionDirectory).toBe(".ai/context");
    expect(moved.authored).toEqual([
      {
        source: CONTEXT_SOURCE,
        externalPaths: [".ai/context/PROJECT.md", ".ai/context/notes/A.md"],
        templatePlaceholders: ["<your-tool>"],
      },
      { source: "other-source", externalPaths: [`${DEFAULT_DIR}/X.md`], templatePlaceholders: [] },
    ]);
    // Retargeting again moves from the declared directory, not from the default.
    expect(generatorTool.retargetDeclaration(moved, "docs/ai").authored[0]?.externalPaths).toEqual([
      "docs/ai/PROJECT.md",
      "docs/ai/notes/A.md",
    ]);
    expect(parseDeclaration(moved).instructionDirectory).toBe(".ai/context");
  });
});

describe("default instruction directory", () => {
  it("regenerates exactly the committed release bytes from the committed declaration", () => {
    const { files } = generate(committedDeclaration());
    const committed = committedRelease();
    expect([...files.keys()].sort()).toEqual([...committed.keys()].sort());
    for (const [path, bytes] of files)
      expect(bytes.equals(committed.get(path) as Buffer), path).toBe(true);
  });
});

describe("custom instruction directory", () => {
  const directory = ".ai/context";
  let generated: { dir: string; files: Map<string, Buffer> };
  beforeAll(() => {
    generated = generate(declarationFor(directory));
  });

  it("places every context target and material under the selected directory", () => {
    const release = releaseOf(generated.files);
    const targets: string[] = [];
    for (const item of contextItems(release)) {
      const recipe = JSON.parse((generated.files.get(item.recipe.path) as Buffer).toString("utf8"));
      for (const operation of recipe.operations) targets.push(targetPath(operation.target));
      for (const check of recipe.checks) targets.push(targetPath(check.target));
      for (const material of item.materials) {
        if (!material.path.startsWith("release/materials/aihq/project-context/pointers/")) {
          expect(material.path).toMatch(
            /^release\/materials\/aihq\/project-context\/\.ai\/context\//u,
          );
        }
      }
    }
    for (const target of new Set(targets)) {
      expect(target.startsWith(`${directory}/`) || POINTER_PATHS.includes(target), target).toBe(
        true,
      );
    }
    expect(targets).toContain(".ai/context/RULE_ROUTER.md");
    expect(targets).toContain(".ai/context/adapters/_shared-canonical-block.md");
    expect(targets).toContain(".ai/context/rules/agent-behavior-core.md");
    expect(targets).toContain(".ai/context/adapters/kiro.md");
    for (const path of POINTER_PATHS) expect(targets).toContain(path);
  });

  it("keeps item identities and leaves no default directory text anywhere in the context family", () => {
    const release = releaseOf(generated.files);
    const committed = releaseOf(committedRelease());
    expect(listItems(release).map((item) => item.id)).toEqual(
      listItems(committed).map((item) => item.id),
    );
    for (const item of contextItems(release)) {
      expect(JSON.stringify(item), item.id).not.toContain(DEFAULT_DIR);
      for (const path of [item.recipe.path, ...item.materials.map((member) => member.path)]) {
        expect((generated.files.get(path) as Buffer).toString("utf8"), path).not.toContain(
          DEFAULT_DIR,
        );
      }
    }
    // The upstream skill items are unaffected by the context configuration.
    for (const id of ["mattpocock.grill-me", "mattpocock.grilling"]) {
      const custom = getItem(release, id);
      const base = getItem(committed, id);
      expect(custom.found && base.found && custom.item.itemSha256 === base.item.itemSha256).toBe(
        true,
      );
    }
  });

  it("routes the router, pointers and adapter notes to the selected directory", () => {
    const release = releaseOf(generated.files);
    const text = (path: string) => (generated.files.get(path) as Buffer).toString("utf8");
    const material = (itemId: string, id: string) => {
      const found = getItem(release, itemId);
      if (!found.found) throw new Error(itemId);
      const member = found.item.materials.find((entry) => entry.id === id);
      if (member === undefined) throw new Error(`${itemId}/${id}`);
      return text(member.path);
    };
    const router = material("aihq.project-context", "rule-router");
    expect(router).toContain("`.ai/context/PROJECT.md`");
    expect(router).toContain("`.ai/context/rules/agent-behavior-core.md`");
    expect(router).toContain("`.ai/context/adapters/<your-tool>.md`");
    expect(router).toContain("The files under `.ai/context/`");
    const block = material("aihq.project-context", "shared-block");
    expect(block).toContain("`.ai/context/RULE_ROUTER.md`");
    const core = material("aihq.project-context", "behavior-core");
    expect(core).toContain("`.ai/context/RULE_ROUTER.md`");
    const cursor = material("aihq.project-context-pointer.cursor-rules", "pointer");
    expect(
      cursor.startsWith(
        '---\ndescription: Routes to the AI canon in .ai/context/ (RULE_ROUTER.md)\nglobs: ["**/*"]\nalwaysApply: true\n---',
      ),
    ).toBe(true);
    const kiro = material("aihq.project-context-pointer.kiro-steering", "pointer");
    expect(kiro).toContain("#[[file:.ai/context/RULE_ROUTER.md]]");
    expect(kiro).toContain("`.ai/context/adapters/kiro.md`");
    expect(kiro).toContain("source .ai/context/adapters/_shared-canonical-block.md");
    const found = getItem(release, "aihq.project-context-pointer.claude-md");
    if (!found.found) throw new Error("claude-md");
    const recipe = JSON.parse(text(found.item.recipe.path));
    const merged = recipe.operations[0].content.literal as string;
    expect(merged).toContain("`.ai/context/adapters/claude.md`");
    expect(merged).toContain(block.replace(/\n$/u, ""));
    expect(material("aihq.client.codex", "adapter-note")).toContain("`.ai/context/RULE_ROUTER.md`");
  });

  it("is admitted by the public reader, configuration and selection validation", () => {
    const release = releaseOf(generated.files);
    const materialSource = { kind: "local", input: "catalog" } as const;
    const selections = contextItems(release).map((item) => {
      const configured = configureItem({
        release,
        itemId: item.id,
        configuration: {},
        materialSource,
      });
      const provenance = configured.valid ? configured.provenance : undefined;
      if (provenance === undefined) throw new Error(JSON.stringify(configured.diagnostics));
      return {
        id: item.id,
        item: {
          releaseSha256: provenance.manifestSha256,
          itemId: item.id,
          itemSha256: provenance.itemSha256,
        },
        configuration: {},
      };
    });
    expect(selections).toHaveLength(FAMILY_SIZE);
    const validated = validateSelectionSet({ releases: { [release.sha256]: release }, selections });
    expect(validated.valid, JSON.stringify(validated.diagnostics)).toBe(true);
  });

  it("passes whole-candidate integrity with the moved author-owned allowance", () => {
    const declared = parseDeclaration(declarationFor(directory));
    const result = checkCandidateFiles(generated.files, packageIdentity(), {
      authored: declared.authored,
    });
    expect(result.checks.filter((check) => !check.ok)).toEqual([]);
    expect(result.checks.map((check) => check.name)).toContain("authored-references");
    expect(result.checks.map((check) => check.name)).toContain("authored-placeholders");
    expect(result.ok).toBe(true);
  });

  it("checks the generated root against its own declaration, also after the upstream pin advances", () => {
    expect(generator("--check", generated.dir).status).toBe(0);
    const releasePath = join(generated.dir, "release/release.json");
    const document = JSON.parse(readFileSync(releasePath, "utf8"));
    for (const source of document.sources) {
      if (source.origin.kind === "git") source.origin.revision = "d".repeat(40);
    }
    writeFileSync(releasePath, `${JSON.stringify(document)}\n`);
    const advanced = generator("--check", generated.dir);
    expect(advanced.status, advanced.stderr).toBe(0);
    expect(advanced.stdout).toContain("Checked authored context");
    // The same advanced root is stale for the default directory.
    const declarationPath = join(generated.dir, "producer/declaration.json");
    const custom = readFileSync(declarationPath);
    try {
      writeFileSync(declarationPath, JSON.stringify(committedDeclaration()));
      const stale = generator("--check", generated.dir);
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain("authored context records are stale");
    } finally {
      writeFileSync(declarationPath, custom);
    }
  });
});

describe("refused instruction directory configurations", () => {
  const refused = (declaration: unknown) => {
    const dir = stage(declaration);
    const result = generator(dir);
    expect(result.status).toBe(1);
    expect(existsSync(join(dir, "release"))).toBe(false);
    return result.stderr;
  };

  it.each([
    "AGENTS.md",
    "claude.md",
    ".windsurfrules",
    ".github/copilot-instructions.md",
    "GEMINI.md/context",
  ])("refuses %s, which collides with a generated entry file", (directory) => {
    expect(refused(declarationFor(directory))).toMatch(/collide/u);
  });

  it.each([
    ".cursor/rules",
    ".kiro/steering",
    ".Cursor/Rules",
    ".KIRO/Steering/context",
    ".cursor/rules/ai",
    ".cursor/rules/00-canon.mdc",
    ".KIRO/steering/00-canon.md/nested",
    ".cursor",
    ".CURSOR",
  ])("refuses %s, a client-native rule directory that would load the canon twice", (directory) => {
    expect(refused(declarationFor(directory))).toMatch(/natively loaded rule directory/u);
  });

  it("admits a sibling of a client-native rule directory", () => {
    for (const directory of [".cursor/context", ".kiro"]) {
      const { files } = generate(declarationFor(directory));
      expect(files.has(`release/materials/aihq/project-context/${directory}/RULE_ROUTER.md`)).toBe(
        true,
      );
    }
  });

  it("refuses an unsafe directory through the declaration parser", () => {
    for (const directory of ["../outside", "C:/abs", "/abs", "a b"]) {
      const stderr = refused({ ...committedDeclaration(), instructionDirectory: directory });
      expect(stderr).toContain("declaration-invalid");
      expect(stderr).toContain("instructionDirectory");
    }
  });

  it("refuses an author-owned allowance that was not moved with the directory", () => {
    const unmoved = { ...committedDeclaration(), instructionDirectory: ".ai" };
    expect(refused(unmoved)).toMatch(/stale.*\.ai\/PROJECT\.md/u);
  });

  it("refuses an allowance that keeps an external path outside the directory", () => {
    const declaration = declarationFor(".ai");
    for (const entry of declaration.authored) {
      if (entry.source === CONTEXT_SOURCE) entry.externalPaths.push("docs/OTHER.md");
    }
    expect(refused(declaration)).toMatch(/stale.*docs\/OTHER\.md/u);
  });

  it("refuses a declaration without the project-context allowance", () => {
    const declaration = declarationFor(".ai");
    declaration.authored = [];
    expect(refused(declaration)).toContain(CONTEXT_SOURCE);
  });
});
