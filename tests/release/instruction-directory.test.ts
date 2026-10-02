import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkCandidateFiles } from "../../src/producer/integrity.js";
import { CLIENTS, POINTERS } from "../../src/release/context-content.js";
import type { CatalogRelease } from "../../src/release/contracts.js";
import {
  type PreparedProjectContextResult,
  prepareProjectContext,
  readInstalledRelease,
} from "../../src/release/node.js";
import {
  CONTEXT_SOURCE_ID,
  DEFAULT_INSTRUCTION_DIRECTORY,
  instructionDirectoryProblems,
  PROJECT_CONTEXT_RENDERER,
  renderContextFamily,
} from "../../src/release/project-context.js";
import {
  configureItem,
  getItem,
  listItems,
  readRelease,
  validateSelectionSet,
} from "../../src/release/reader.js";
import { sha256 } from "./fixtures.js";
import { installedRoot } from "./installed-fixture.js";

/**
 * A consuming project chooses its instruction directory (Catalog #55) through the
 * Node helper prepareProjectContext: it renders the authored context family for that
 * directory into caller-owned staging output as a derived release, without
 * regenerating or changing the installed Catalog release.
 */

const repository = resolve(import.meta.dirname, "../..");
const scratch = mkdtempSync(join(tmpdir(), "aih-instruction-directory-"));
const cleanups: (() => void)[] = [];
afterAll(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  expect(scratch.startsWith(join(tmpdir(), "aih-instruction-directory-"))).toBe(true);
  rmSync(scratch, { recursive: true, force: true });
});
let count = 0;
/** A fresh absent output path whose parent exists. */
const output = (name = "out") => {
  count += 1;
  const parent = join(scratch, `case-${count}`);
  mkdirSync(parent);
  return join(parent, name);
};

function installed() {
  const fixture = installedRoot("context-source");
  cleanups.push(fixture.cleanup);
  return fixture.root;
}

/** Every regular file under `dir`, package-relative path → bytes. */
function tree(dir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(relative(dir, path).replaceAll("\\", "/"), readFileSync(path));
    }
  };
  if (existsSync(dir)) walk(dir);
  return files;
}
const digest = (files: Map<string, Buffer>) =>
  [...files].map(([path, bytes]) => `${path}:${sha256(bytes)}`).sort();

async function source(root = installed()) {
  const read = await readInstalledRelease({ root });
  if (!read.valid || read.release === undefined) throw new Error(JSON.stringify(read.diagnostics));
  return { root, release: read.release, materialRoots: read.materialRoots ?? {} };
}

async function prepared(
  instructionDirectory: string,
  outputDirectory = output(),
): Promise<PreparedProjectContextResult & { outputDirectory: string }> {
  const from = await source();
  const result = await prepareProjectContext({
    release: from.release,
    instructionDirectory,
    outputDirectory,
    sourceMaterialRoots: from.materialRoots,
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.valid).toBe(true);
  return { ...result, outputDirectory };
}

const reasons = (result: { diagnostics: readonly { reason: string }[] }) =>
  result.diagnostics.map((d) => d.reason);
const contextItems = (release: CatalogRelease) =>
  listItems(release).filter((item) => item.sourceIds.includes(CONTEXT_SOURCE_ID));
type Target = { segments: { literal?: string }[] };
const targetPath = (target: Target) => target.segments.map((segment) => segment.literal).join("/");
const POINTER_PATHS = POINTERS.map((pointer) => pointer.path.join("/"));
/** The shared context item, one pointer item per entry file and one item per client. */
const FAMILY_SIZE = 1 + POINTERS.length + CLIENTS.length;

function carried(): CatalogRelease {
  const bytes = readFileSync(join(repository, "release/release.json"));
  const read = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!read.valid) throw new Error(JSON.stringify(read.diagnostics));
  return read.release;
}

describe("the internal context renderer", () => {
  it("renders exactly the published context items and bytes for the default directory", () => {
    expect(DEFAULT_INSTRUCTION_DIRECTORY).toBe("ai-coding");
    const family = renderContextFamily(DEFAULT_INSTRUCTION_DIRECTORY);
    const published = contextItems(carried());
    expect(family.items.map((item) => item.id)).toEqual(published.map((item) => item.id));
    const document = JSON.parse(readFileSync(join(repository, "release/release.json"), "utf8"));
    const records = document.items.filter((item: { sourceIds: string[] }) =>
      item.sourceIds.includes(CONTEXT_SOURCE_ID),
    );
    expect(family.items).toEqual(records);
    for (const [path, bytes] of family.files) {
      expect(Buffer.from(bytes).equals(readFileSync(join(repository, path))), path).toBe(true);
    }
  });

  it("is deterministic and names its renderer version", () => {
    expect(PROJECT_CONTEXT_RENDERER).toBe("aihq-project-context-renderer@1");
    const first = renderContextFamily(".ai/context");
    const second = renderContextFamily(".ai/context");
    expect(second.items).toEqual(first.items);
    expect([...second.files.keys()]).toEqual([...first.files.keys()]);
    for (const [path, bytes] of first.files) {
      expect(Buffer.from(second.files.get(path) as Uint8Array).equals(Buffer.from(bytes))).toBe(
        true,
      );
    }
  });

  it("stays portable: no Node built-ins, process, Buffer or network", () => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      const specifiers = [
        ...text.matchAll(
          /\b(?:import|export)\b[^"';]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g,
        ),
      ].map((match) => (match[1] ?? match[2]) as string);
      for (const specifier of specifiers) {
        expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.\.?\//);
        visit(resolve(dirname(file), specifier.replace(/\.js$/u, ".ts")));
      }
      expect(text, file).not.toMatch(/\b(?:require\s*\(|process\.|Buffer\b|fetch\s*\()/);
    };
    visit(join(repository, "src/release/project-context.ts"));
    expect([...seen].map((file) => relative(repository, file).replaceAll("\\", "/"))).not.toContain(
      "src/release/node.ts",
    );
    // The portable reader does not reach the renderer either.
    const reader = readFileSync(join(repository, "src/release/reader.ts"), "utf8");
    expect(reader).not.toMatch(/project-context|context-content/u);
  });

  it.each([
    ["../outside", "instruction-directory-invalid"],
    ["C:/abs", "instruction-directory-invalid"],
    ["/abs", "instruction-directory-invalid"],
    ["a b", "instruction-directory-invalid"],
    ["a\\b", "instruction-directory-invalid"],
    ["-rules", "instruction-directory-invalid"],
    ["docs/.git/ai", "instruction-directory-invalid"],
    ["", "instruction-directory-invalid"],
    ["x".repeat(129), "instruction-directory-invalid"],
    [Array.from({ length: 60 }, () => "a").join("/"), "instruction-directory-invalid"],
    ["AGENTS.md", "instruction-directory-collision"],
    ["claude.md", "instruction-directory-collision"],
    [".windsurfrules", "instruction-directory-collision"],
    [".github/copilot-instructions.md", "instruction-directory-collision"],
    ["GEMINI.md/context", "instruction-directory-collision"],
    ["pointers/.cursor/rules/00-canon.mdc", "instruction-directory-collision"],
    [".cursor/rules", "instruction-directory-native-rules"],
    [".kiro/steering", "instruction-directory-native-rules"],
    [".Cursor/Rules", "instruction-directory-native-rules"],
    [".KIRO/Steering/context", "instruction-directory-native-rules"],
    [".cursor", "instruction-directory-native-rules"],
    [".CURSOR", "instruction-directory-native-rules"],
  ])("refuses %s as %s", (directory, reason) => {
    const problems = instructionDirectoryProblems(directory);
    expect(problems.map((problem) => problem.reason)).toContain(reason);
    expect(() => renderContextFamily(directory)).toThrow(TypeError);
  });

  it("admits siblings of client-native rule directories and nested project paths", () => {
    for (const directory of [".cursor/context", ".kiro", ".ai/context", "docs/ai_rules-1"]) {
      expect(instructionDirectoryProblems(directory), directory).toEqual([]);
    }
  });
});

describe("prepareProjectContext with the default directory", () => {
  it("writes a derived release whose context items equal the published ones", async () => {
    const from = await source();
    const out = output();
    const result = await prepareProjectContext({
      release: from.release,
      instructionDirectory: "ai-coding",
      outputDirectory: out,
      sourceMaterialRoots: from.materialRoots,
    });
    expect(reasons(result)).toEqual([]);
    expect(result.valid).toBe(true);
    const release = result.release as CatalogRelease;
    // New release identity, distinct from the source release.
    expect(release.sha256).not.toBe(from.release.sha256);
    const written = readFileSync(join(out, "release/release.json"));
    expect(release.sha256).toBe(sha256(written));
    expect(release.package).toEqual(from.release.package);
    expect(release.sources).toEqual([{ id: CONTEXT_SOURCE_ID, origin: { kind: "authored" } }]);
    expect(release.metadata).toEqual({
      derived: {
        kind: "project-context",
        from: { package: from.release.package, manifestSha256: from.release.sha256 },
        renderer: PROJECT_CONTEXT_RENDERER,
        instructionDirectory: "ai-coding",
      },
    });
    // Only the authored context family; item identities equal the published records.
    expect(listItems(release).map((item) => [item.id, item.itemSha256])).toEqual(
      contextItems(from.release).map((item) => [item.id, item.itemSha256]),
    );
    expect(result.source).toEqual({ kind: "local", input: "catalog-project-context" });
    expect(result.materialRoots).toEqual({ "catalog-project-context": realpathSync.native(out) });
    expect(result.provenance).toEqual({
      kind: "derived",
      from: { package: from.release.package, manifestSha256: from.release.sha256 },
      renderer: PROJECT_CONTEXT_RENDERER,
      instructionDirectory: "ai-coding",
      manifestPath: "release/release.json",
      manifestSha256: release.sha256,
    });
    expect(Object.isFrozen(result)).toBe(true);
    // The output holds exactly the release document and its declared members.
    const declared = new Set([
      "release/release.json",
      ...listItems(release).flatMap((item) => [
        item.recipe.path,
        ...item.materials.map((member) => member.path),
      ]),
    ]);
    expect([...tree(out).keys()].sort()).toEqual([...declared].sort());
  });
});

describe("prepareProjectContext with a custom directory", () => {
  const directory = ".ai/context";

  it("routes every target, material and reference to the directory with no default left", async () => {
    const result = await prepared(directory);
    const release = result.release as CatalogRelease;
    expect(contextItems(release)).toHaveLength(FAMILY_SIZE);
    const files = tree(result.outputDirectory);
    const targets: string[] = [];
    for (const item of listItems(release)) {
      expect(JSON.stringify(item), item.id).not.toContain("ai-coding");
      const recipe = JSON.parse((files.get(item.recipe.path) as Buffer).toString("utf8"));
      for (const operation of recipe.operations) targets.push(targetPath(operation.target));
      for (const check of recipe.checks) targets.push(targetPath(check.target));
    }
    for (const [path, bytes] of files) {
      expect(path).not.toContain("ai-coding");
      expect(bytes.toString("utf8"), path).not.toContain("ai-coding");
    }
    for (const target of new Set(targets)) {
      expect(target.startsWith(`${directory}/`) || POINTER_PATHS.includes(target), target).toBe(
        true,
      );
    }
    expect(targets).toContain(".ai/context/RULE_ROUTER.md");
    expect(targets).toContain(".ai/context/adapters/kiro.md");
    const text = (itemId: string, id: string) => {
      const found = getItem(release, itemId);
      if (!found.found) throw new Error(itemId);
      const member = found.item.materials.find((entry) => entry.id === id);
      return (files.get(member?.path as string) as Buffer).toString("utf8");
    };
    expect(text("aihq.project-context", "rule-router")).toContain("`.ai/context/PROJECT.md`");
    expect(text("aihq.project-context-pointer.kiro-steering", "pointer")).toContain(
      "#[[file:.ai/context/RULE_ROUTER.md]]",
    );
    expect(text("aihq.project-context-pointer.cursor-rules", "pointer")).toContain(
      "description: Routes to the AI canon in .ai/context/ (RULE_ROUTER.md)",
    );
    // Derived identities differ from the published ones for a changed directory.
    const published = new Map(contextItems(carried()).map((item) => [item.id, item]));
    for (const item of listItems(release)) {
      expect(item.itemSha256).not.toBe(published.get(item.id)?.itemSha256);
    }
    expect(release.metadata).toMatchObject({ derived: { instructionDirectory: directory } });
  });

  it("is byte-identical across preparations", async () => {
    const first = await prepared(directory);
    const second = await prepared(directory);
    expect(second.release?.sha256).toBe(first.release?.sha256);
    expect(digest(tree(second.outputDirectory))).toEqual(digest(tree(first.outputDirectory)));
  });

  it("configures and validates context items beside installed items, keyed by release", async () => {
    const from = await source();
    const out = output();
    const result = await prepareProjectContext({
      release: from.release,
      instructionDirectory: directory,
      outputDirectory: out,
      sourceMaterialRoots: from.materialRoots,
    });
    const derived = result.release as CatalogRelease;
    const choose = (release: CatalogRelease, itemId: string, input: string) => {
      const configured = configureItem({
        release,
        itemId,
        configuration: {},
        materialSource: { kind: "local", input },
      });
      expect(configured.valid, JSON.stringify(configured.diagnostics)).toBe(true);
      return {
        id: itemId,
        item: {
          releaseSha256: configured.provenance?.manifestSha256 as string,
          itemId,
          itemSha256: configured.provenance?.itemSha256 as string,
        },
        configuration: {},
      };
    };
    const selections = [
      ...listItems(derived).map((item) => choose(derived, item.id, "catalog-project-context")),
      choose(from.release, "mattpocock.grill-me", "catalog"),
      choose(from.release, "mattpocock.grilling", "catalog"),
    ];
    const set = validateSelectionSet({
      releases: { [derived.sha256]: derived, [from.release.sha256]: from.release },
      selections,
    });
    expect(set.valid, JSON.stringify(set.diagnostics)).toBe(true);
    expect(set.requiresBySelectionId?.["aihq.client.claude"]).toEqual([
      "aihq.project-context-pointer.claude-md",
    ]);
    // Context dependencies resolve within the derived release only.
    const mixed = validateSelectionSet({
      releases: { [derived.sha256]: derived, [from.release.sha256]: from.release },
      selections: [
        choose(derived, "aihq.client.claude", "catalog-project-context"),
        choose(derived, "aihq.project-context-pointer.claude-md", "catalog-project-context"),
        { ...choose(from.release, "aihq.project-context", "catalog"), id: "published-context" },
      ],
    });
    expect(reasons(mixed)).toContain("dependency-missing");
  });

  it("passes whole-candidate integrity with the author allowance moved to the directory", async () => {
    const result = await prepared(directory);
    const release = result.release as CatalogRelease;
    const checked = checkCandidateFiles(tree(result.outputDirectory), release.package, {
      authored: [
        {
          source: CONTEXT_SOURCE_ID,
          externalPaths: [`${directory}/PROJECT.md`],
          templatePlaceholders: ["<your-tool>"],
        },
      ],
    });
    expect(checked.checks.filter((check) => !check.ok)).toEqual([]);
    expect(checked.checks.map((check) => check.name)).toContain("authored-references");
    expect(checked.ok).toBe(true);
  });

  it("leaves the installed package root untouched", async () => {
    const from = await source();
    const before = digest(tree(from.root));
    const result = await prepareProjectContext({
      release: from.release,
      instructionDirectory: directory,
      outputDirectory: output(),
      sourceMaterialRoots: from.materialRoots,
    });
    expect(result.valid).toBe(true);
    expect(digest(tree(from.root))).toEqual(before);
    expect(existsSync(join(from.root, "IMPORTED"))).toBe(false);
  });
});

describe("prepareProjectContext refusals", () => {
  const refuse = async (
    request: Partial<Parameters<typeof prepareProjectContext>[0]>,
    expected: string,
  ) => {
    const from = await source();
    const result = await prepareProjectContext({
      release: from.release,
      instructionDirectory: ".ai/context",
      outputDirectory: output(),
      ...request,
    } as Parameters<typeof prepareProjectContext>[0]);
    expect(result.valid).toBe(false);
    expect(result.release).toBeUndefined();
    expect(reasons(result)).toContain(expected);
    for (const d of result.diagnostics) expect(d.code).toBe("INPUT_INVALID");
    return result;
  };

  it.each([
    ["../outside", "instruction-directory-invalid"],
    ["AGENTS.md", "instruction-directory-collision"],
    [".cursor/rules", "instruction-directory-native-rules"],
  ])("returns %s as a %s diagnostic and writes nothing", async (directory, reason) => {
    const out = output();
    const result = await refuse({ instructionDirectory: directory, outputDirectory: out }, reason);
    expect(result.diagnostics[0]?.path).toBe("/instructionDirectory");
    expect(existsSync(out)).toBe(false);
  });

  it("refuses an unchecked release and an invalid source input", async () => {
    await refuse({ release: { ...(await source()).release } }, "release-unchecked");
    await refuse({ sourceInput: "bad input" }, "invalid-source-input");
    await refuse(
      { sourceInput: "catalog", sourceMaterialRoots: { catalog: scratch } },
      "source-input-conflict",
    );
  });

  it("refuses a source whose authored context differs from this renderer", async () => {
    const document = JSON.parse(readFileSync(join(repository, "release/release.json"), "utf8"));
    const changed = structuredClone(document);
    for (const item of changed.items) {
      if (item.id === "aihq.project-context") item.label = "Changed context";
    }
    const without = structuredClone(document);
    without.items = without.items.filter(
      (item: { sourceIds: string[] }) => !item.sourceIds.includes(CONTEXT_SOURCE_ID),
    );
    without.sources = without.sources.filter(
      (entry: { id: string }) => entry.id !== CONTEXT_SOURCE_ID,
    );
    for (const value of [changed, without]) {
      const bytes = Buffer.from(`${canonicalText(value)}\n`);
      const read = readRelease(bytes, { expectedSha256: sha256(bytes) });
      if (!read.valid) throw new Error(JSON.stringify(read.diagnostics));
      const out = output();
      await refuse({ release: read.release, outputDirectory: out }, "renderer-mismatch");
      expect(existsSync(out)).toBe(false);
    }
  });

  it("refuses a relative, missing-parent, non-directory, linked or non-empty output", async () => {
    await refuse({ outputDirectory: "relative/out" }, "invalid-output-directory");
    await refuse(
      { outputDirectory: join(output(), "missing", "out") },
      "output-parent-unavailable",
    );
    const file = output();
    writeFileSync(file, "not a directory");
    await refuse({ outputDirectory: file }, "unsafe-output-directory");
    expect(readFileSync(file, "utf8")).toBe("not a directory");
    const target = output();
    mkdirSync(target);
    const link = output();
    symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    await refuse({ outputDirectory: link }, "unsafe-output-directory");
    expect(readdirSync(target)).toEqual([]);
    const full = output();
    mkdirSync(full);
    writeFileSync(join(full, "keep.txt"), "unrelated");
    await refuse({ outputDirectory: full }, "output-not-empty");
    expect(readdirSync(full)).toEqual(["keep.txt"]);
  });

  it("refuses output overlapping a source material root", async () => {
    const from = await source();
    const inside = join(from.root, "staging");
    await refuse(
      { release: from.release, outputDirectory: inside, sourceMaterialRoots: from.materialRoots },
      "output-overlaps-source",
    );
    expect(existsSync(inside)).toBe(false);
    const parent = dirname(from.root);
    const around = join(parent, "around");
    await refuse(
      {
        release: from.release,
        outputDirectory: around,
        sourceMaterialRoots: { catalog: join(around, "nested") },
      },
      "output-overlaps-source",
    );
  });

  it("accepts an existing empty directory and keeps it", async () => {
    const out = output();
    mkdirSync(out);
    const result = await prepared(".ai/context", out);
    expect(existsSync(join(result.outputDirectory, "release/release.json"))).toBe(true);
  });

  it("removes only what it created when cancelled partway", async () => {
    for (const existing of [false, true]) {
      const out = output();
      if (existing) mkdirSync(out);
      let checks = 0;
      const signal = {
        get aborted() {
          checks += 1;
          return checks > 12;
        },
        addEventListener() {},
        removeEventListener() {},
      } as unknown as AbortSignal;
      const result = await refuse({ outputDirectory: out, signal }, "cancelled");
      expect(result.valid).toBe(false);
      expect(checks).toBeGreaterThan(12);
      if (existing) expect(readdirSync(out)).toEqual([]);
      else expect(existsSync(out)).toBe(false);
    }
  });

  it("is cancelled before any work when the signal is already aborted", async () => {
    const out = output();
    await refuse({ outputDirectory: out, signal: AbortSignal.abort() }, "cancelled");
    expect(existsSync(out)).toBe(false);
  });
});

/** Canonical release text for a parsed release document (sorted keys, no whitespace). */
function canonicalText(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalText).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalText(record[key])}`)
    .join(",")}}`;
}
