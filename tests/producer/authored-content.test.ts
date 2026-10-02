import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AuthoredAllowance,
  type AuthoredFinding,
  checkAuthoredContent,
  describeFinding,
} from "../../src/producer/authored.js";
import { parseDeclaration } from "../../src/producer/declaration.js";
import { ProducerRefusal } from "../../src/producer/errors.js";
import { documentBytes } from "../../src/producer/generate.js";
import { assertCandidateIntegrity, checkCandidateFiles } from "../../src/producer/integrity.js";
import type { CatalogRelease } from "../../src/release/contracts.js";
import { readRelease } from "../../src/release/reader.js";
import { AUTHORED_SOURCE, withAuthoredItems } from "./authored.js";
import { committedRelease, declaration, packageIdentity, root, sha256 } from "./helpers.js";

const identity = packageIdentity();

/** The allowances the committed declaration declares for the committed authored content. */
const COMMITTED_ALLOWANCES: readonly AuthoredAllowance[] = [
  {
    source: "aihq-project-context",
    externalPaths: ["ai-coding/PROJECT.md"],
    templatePlaceholders: ["<your-tool>"],
  },
];

const TEMPLATE_ALLOWANCES: readonly AuthoredAllowance[] = [
  ...COMMITTED_ALLOWANCES,
  { source: AUTHORED_SOURCE, externalPaths: [], templatePlaceholders: ["<tool-name>"] },
];

interface ItemDoc {
  id: string;
  sourceIds: string[];
  recipe: { path: string; sha256: string; byteLength: number };
  materials: { id: string; path: string; sha256: string; byteLength: number }[];
}
interface Doc {
  items: ItemDoc[];
}
type RecipeJson = Record<string, unknown> & {
  operations: Record<string, unknown>[];
  materials: { id: string; sha256: string; byteLength: number }[];
  checks: Record<string, unknown>[];
};

const readDoc = (files: Map<string, Buffer>): Doc =>
  JSON.parse((files.get("release/release.json") as Buffer).toString("utf8")) as Doc;
const itemOf = (document: Doc, id: string) =>
  document.items.find((item) => item.id === id) as ItemDoc;

function releaseOf(files: Map<string, Buffer>): CatalogRelease {
  const bytes = files.get("release/release.json") as Buffer;
  const read = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!read.valid) throw new Error("the fixture release is unreadable");
  return read.release;
}

function writeRecipe(files: Map<string, Buffer>, item: ItemDoc, recipe: RecipeJson): void {
  const bytes = documentBytes(recipe);
  files.set(item.recipe.path, bytes);
  item.recipe.sha256 = sha256(bytes);
  item.recipe.byteLength = bytes.length;
}

/** Rewrites one item's recipe JSON and re-hashes it so member-bytes stays valid. */
function rewriteRecipe(
  files: Map<string, Buffer>,
  itemId: string,
  mutate: (recipe: RecipeJson) => void,
): Map<string, Buffer> {
  const next = new Map(files);
  const document = readDoc(next);
  const item = itemOf(document, itemId);
  const recipe = JSON.parse((next.get(item.recipe.path) as Buffer).toString("utf8")) as RecipeJson;
  mutate(recipe);
  writeRecipe(next, item, recipe);
  next.set("release/release.json", documentBytes(document));
  return next;
}

/** Replaces one material's text and re-hashes material, recipe and sha checks. */
function withMaterialText(
  files: Map<string, Buffer>,
  itemId: string,
  materialId: string,
  text: string,
): Map<string, Buffer> {
  const bytes = Buffer.from(text, "utf8");
  const digest = sha256(bytes);
  const next = rewriteRecipe(files, itemId, (recipe) => {
    const targets = new Set(
      recipe.operations
        .filter((op) => op.kind === "file.write" && op.material === materialId)
        .map((op) => JSON.stringify(op.target)),
    );
    for (const material of recipe.materials) {
      if (material.id === materialId) {
        material.sha256 = digest;
        material.byteLength = bytes.length;
      }
    }
    for (const check of recipe.checks) {
      if (check.kind === "file.sha256" && targets.has(JSON.stringify(check.target))) {
        check.sha256 = digest;
      }
    }
  });
  const document = readDoc(next);
  const member = itemOf(document, itemId).materials.find((m) => m.id === materialId);
  if (member === undefined) throw new Error(`no material ${materialId} on ${itemId}`);
  next.set(member.path, bytes);
  member.sha256 = digest;
  member.byteLength = bytes.length;
  next.set("release/release.json", documentBytes(document));
  return next;
}

/** The committed release plus two sibling local-authored items; one carries `text`. */
const authoredPair = (text: string) =>
  withMaterialText(
    withAuthoredItems(committedRelease(), [{ id: "one" }, { id: "two" }]),
    "one",
    "readme",
    text,
  );

const authoredChecks = (files: Map<string, Buffer>, allowances: readonly AuthoredAllowance[]) =>
  checkCandidateFiles(files, identity, { authored: allowances }).checks.filter((check) =>
    check.name.startsWith("authored-"),
  );

describe("authored content checks", () => {
  it("passes the committed release with its declared allowances and fails closed without them", () => {
    const files = committedRelease();
    const allowed = checkCandidateFiles(files, identity, { authored: declaration().authored });
    expect(allowed.checks.filter((c) => c.name.startsWith("authored-")).map((c) => c.name)).toEqual(
      ["authored-references", "authored-placeholders"],
    );
    expect(allowed.checks.filter((c) => c.name.startsWith("authored-") && !c.ok)).toEqual([]);
    const direct = checkAuthoredContent(releaseOf(files), files, declaration().authored);
    expect(direct.references).toEqual([]);
    expect(direct.placeholders).toEqual([]);

    const closed = checkCandidateFiles(files, identity);
    const failed = closed.checks.filter((c) => c.name.startsWith("authored-"));
    expect(failed.map((c) => c.name)).toEqual(["authored-references", "authored-placeholders"]);
    expect(failed.every((c) => !c.ok)).toBe(true);
    // The allowances are exactly what admit the committed content.
    expect(failed[0]?.detail).toContain("ai-coding/PROJECT.md");
    expect(failed[1]?.detail).toContain("<your-tool>");
    const raw = checkAuthoredContent(releaseOf(files), files, []);
    expect(raw.references.some((f) => f.text === "ai-coding/PROJECT.md")).toBe(true);
    expect(raw.placeholders.some((f) => f.text === "<your-tool>")).toBe(true);
  });

  it("resolves relative links, directory forms, kiro file refs and code-span paths", () => {
    const files = authoredPair(
      [
        "See [the sibling](../two/README.txt) and ![its badge](../two/README.txt).",
        "Per-tool notes under `docs/two/`.",
        "Kiro ref #[[file:docs/two/README.txt]] here.",
        "Code span `docs/two/README.txt` here.",
        "",
      ].join("\n"),
    );
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.references).toEqual([]);
    expect(result.placeholders).toEqual([]);
  });

  it("reports a code-span path to an undelivered file precisely", () => {
    const files = authoredPair("Intro.\nMissing: `docs/nope/missing.txt`.\n");
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.references).toEqual([
      {
        itemId: "one",
        member: "readme",
        target: "docs/one/README.txt",
        line: 2,
        text: "docs/nope/missing.txt",
      },
    ]);
  });

  it("reports a broken relative link inside the project", () => {
    const files = authoredPair("Intro.\n\nSee [the guide](../nope/README.txt#usage).\n");
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.references).toEqual([
      {
        itemId: "one",
        member: "readme",
        target: "docs/one/README.txt",
        line: 3,
        text: "../nope/README.txt#usage",
      },
    ]);
  });

  it("checks the destination of links whose label holds brackets or an image", () => {
    const files = authoredPair(
      "[![badge](../two/README.txt)](gone.md) and [see [x] here](lost.md).\n",
    );
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.references.map((f) => f.text)).toEqual(["gone.md", "lost.md"]);
  });

  it("checks link reference definitions and angle-bracket destinations", () => {
    const files = authoredPair(
      [
        "Read [the guide][g] and [the sibling](<../two/README.txt>).",
        "",
        "[g]: ../nope/guide.md",
        "[s]: <../two/README.txt>",
        "[^1]: See the note.",
        "Spaced: [x](<docs/no such.md>).",
        "```js",
        "const o = {",
        "[key]: value,",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample carries literal residue.
        'const greeting = "${name}";',
        "};",
        "See [sample](missing.md) and `docs/nope/x.md`.",
        "```",
        "",
      ].join("\n"),
    );
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.references.map((f) => [f.line, f.text])).toEqual([
      [3, "../nope/guide.md"],
      [6, "<docs/no such.md>"],
    ]);
    // A code sample quotes no references, but residue in it is still reported.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the reported token is literal residue.
    expect(result.placeholders.map((f) => [f.line, f.text])).toEqual([[10, "${name}"]]);
  });

  it("closes a fence on a longer closing fence and checks what follows", () => {
    const files = authoredPair(
      ["```", "[sample](missing.md)", "````", "After: [x](docs/after.md)", ""].join("\n"),
    );
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.references.map((f) => [f.line, f.text])).toEqual([[4, "docs/after.md"]]);
  });

  it("checks residue but resolves no references in a text installed outside the project", () => {
    const files = rewriteRecipe(
      authoredPair("User notes: `docs/nope/missing.txt` {{left}}.\n"),
      "one",
      (recipe) => {
        for (const operation of recipe.operations) {
          operation.target = { ...(operation.target as Record<string, unknown>), root: "userHome" };
        }
      },
    );
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.references).toEqual([]);
    expect(result.placeholders.map((f) => f.text)).toEqual(["{{left}}"]);
  });

  it("ignores URI and fragment-only links and strips a query or fragment before resolving", () => {
    const files = authoredPair(
      [
        "[web](https://example.com/x.md) [mail](mailto:a@example.com) [top](#intro)",
        "[part](../two/README.txt#part) [raw](../two/README.txt?raw=1)",
        "",
      ].join("\n"),
    );
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.references).toEqual([]);
  });

  it("resolves through an input target segment by its default, or any segment without one", () => {
    const placed = (input: Record<string, unknown>) =>
      rewriteRecipe(
        authoredPair(
          "Read `docs/fixed/README.txt`, `docs/other/README.txt` and `docs/a/b/README.txt`.\n",
        ),
        "two",
        (recipe) => {
          recipe.inputs = { place: input };
          for (const operation of recipe.operations) {
            operation.target = {
              root: "project",
              segments: [{ literal: "docs" }, { input: "place" }, { literal: "README.txt" }],
            };
          }
        },
      );
    const unresolved = (files: Map<string, Buffer>) =>
      checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES).references.map(
        (f) => f.text,
      );
    // With a default only that segment is delivered.
    expect(unresolved(placed({ type: "string", required: true, default: "fixed" }))).toEqual([
      "docs/a/b/README.txt",
      "docs/other/README.txt",
    ]);
    // Without one the wildcard stands for exactly one segment.
    expect(unresolved(placed({ type: "string", required: true }))).toEqual(["docs/a/b/README.txt"]);
  });

  it("reports an authored recipe that cannot be parsed instead of throwing", () => {
    const files = authoredPair("Plain notes.\n");
    files.set(itemOf(readDoc(files), "one").recipe.path, Buffer.from("not json"));
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.references).toEqual([
      {
        itemId: "one",
        member: "recipe",
        target: "release/recipes/one.json",
        line: 0,
        text: "recipe unreadable",
      },
    ]);
  });

  it("reports a relative link that escapes the project root", () => {
    const files = authoredPair("Up: [outside](../../../outside.txt).\n");
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.references).toEqual([
      {
        itemId: "one",
        member: "readme",
        target: "docs/one/README.txt",
        line: 1,
        text: "../../../outside.txt",
      },
    ]);
  });

  it("reports a reference to a target only a different source delivers", () => {
    // .claude/skills/grilling/SKILL.md is installed by mattpocock.grilling (git source),
    // so it sits outside the local-authored content boundary.
    const files = authoredPair("Skill: `.claude/skills/grilling/SKILL.md`.\n");
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.references).toEqual([
      {
        itemId: "one",
        member: "readme",
        target: "docs/one/README.txt",
        line: 1,
        text: ".claude/skills/grilling/SKILL.md",
      },
    ]);
  });

  it("makes the integrity check detail actionable for an unresolved reference", () => {
    const files = authoredPair("Missing: `docs/nope/missing.txt`.\n");
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.references).toHaveLength(1);
    const finding = result.references[0] as AuthoredFinding;
    expect(describeFinding(finding)).toBe(
      "one readme docs/one/README.txt:1 -> docs/nope/missing.txt",
    );
    const check = authoredChecks(files, COMMITTED_ALLOWANCES).find(
      (c) => c.name === "authored-references",
    );
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain(`unresolved ${describeFinding(finding)}`);
  });

  it("allows a declared placeholder token as text and inside a reference", () => {
    const files = authoredPair("Install for <tool-name>: `docs/<tool-name>/README.txt`.\n");
    const result = checkAuthoredContent(releaseOf(files), files, TEMPLATE_ALLOWANCES);
    expect(result.references).toEqual([]);
    expect(result.placeholders).toEqual([]);
  });

  it("rejects the same token when it is not declared", () => {
    const files = authoredPair("Install for <tool-name>: `docs/<tool-name>/README.txt`.\n");
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.placeholders.map((f) => f.text)).toContain("<tool-name>");
    expect(result.references.map((f) => f.text)).toContain("docs/<tool-name>/README.txt");
  });

  it("reports generation residue tokens, also inside comments, but not comment markers", () => {
    const files = authoredPair(
      [
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture must carry literal residue.
        'const dir = "${CONTEXT_DIR}";',
        'const name = "{{name}}";',
        "const bad = [object Object];",
        "const value = undefined;",
        "const tool = <TOOL_NAME>;",
        "const token = __PLACEHOLDER__;",
        "<!-- BEGIN aihq:context:shared -->",
        "<!-- generated; source {{dir}}/block.md -->",
        "Inline `{{inline}}`, HTML <BR>, <IMG>, <A> and <details> stay; <VERSION> does not.",
        "",
      ].join("\n"),
    );
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.placeholders.map((f) => [f.line, f.text])).toEqual([
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the reported token is literal residue.
      [1, "${CONTEXT_DIR}"],
      [2, "{{name}}"],
      [3, "[object Object]"],
      [4, "undefined"],
      [5, "<TOOL_NAME>"],
      [6, "__PLACEHOLDER__"],
      [8, "{{dir}}"],
      [9, "<VERSION>"],
      [9, "{{inline}}"],
    ]);
    expect(result.placeholders.some((f) => f.text.includes("BEGIN"))).toBe(false);
  });

  it("treats link and Kiro syntax quoted in inline code as a description, not a reference", () => {
    const files = authoredPair(
      "Kiro expands `#[[file:...]]`; Markdown uses `[label](missing/target.md)`.\n",
    );
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.references).toEqual([]);
    const live = authoredPair("Live: #[[file:docs/nope/missing.txt]]\n");
    expect(
      checkAuthoredContent(releaseOf(live), live, COMMITTED_ALLOWANCES).references.map(
        (f) => f.text,
      ),
    ).toEqual(["docs/nope/missing.txt"]);
  });

  it("examines text.block literal content with an operation member label", () => {
    const files = rewriteRecipe(
      committedRelease(),
      "aihq.project-context-pointer.agents-md",
      (recipe) => {
        const operation = recipe.operations.find((op) => op.id === "merge-context-block");
        if (operation === undefined) throw new Error("pointer operation missing");
        operation.content = { literal: "Pointer mentions `ai-coding/nope.md`.\n" };
      },
    );
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.references).toEqual([
      {
        itemId: "aihq.project-context-pointer.agents-md",
        member: "operation:merge-context-block",
        target: "AGENTS.md",
        line: 1,
        text: "ai-coding/nope.md",
      },
    ]);
  });

  it("does not examine upstream git-sourced skill items", () => {
    const files = withMaterialText(
      committedRelease(),
      "mattpocock.grilling",
      "skill",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture must carry literal residue.
      "Residue ${CONTEXT_DIR} and a broken `docs/nope/missing.txt` mention.\n",
    );
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.references).toEqual([]);
    expect(result.placeholders).toEqual([]);
    // The re-hashed skill bytes still pass every whole-candidate check.
    const integrity = checkCandidateFiles(files, identity, { authored: COMMITTED_ALLOWANCES });
    expect(integrity.checks.filter((c) => !c.ok)).toEqual([]);
    expect(integrity.ok).toBe(true);
  });

  it("does not mutate the files map or the committed bytes", () => {
    const files = committedRelease();
    const before = new Map([...files].map(([path, bytes]) => [path, sha256(bytes)]));
    const result = checkAuthoredContent(releaseOf(files), files, COMMITTED_ALLOWANCES);
    expect(result.references).toEqual([]);
    expect(result.placeholders).toEqual([]);
    expect([...files.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [path, digest] of before) {
      expect(sha256(files.get(path) as Buffer)).toBe(digest);
    }
  });

  it("assertCandidateIntegrity names authored-references and the missing target", () => {
    const files = authoredPair("Missing: `docs/nope/missing.txt`.\n");
    try {
      assertCandidateIntegrity(files, identity, { authored: COMMITTED_ALLOWANCES });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ProducerRefusal);
      expect((error as ProducerRefusal).reason).toBe("integrity-failed");
      expect((error as ProducerRefusal).message).toContain("authored-references");
      expect((error as ProducerRefusal).message).toContain("docs/nope/missing.txt");
    }
  });
});

describe("declaration authored allowances", () => {
  const committedJson = () =>
    JSON.parse(readFileSync(resolve(root, "producer/declaration.json"), "utf8")) as Record<
      string,
      unknown
    >;
  const withAuthored = (authored: unknown) => ({ ...committedJson(), authored });
  const entry = (over: Record<string, unknown>) => ({
    source: "local-authored",
    externalPaths: [],
    templatePlaceholders: [],
    ...over,
  });
  const refusal = (value: unknown): ProducerRefusal => {
    try {
      parseDeclaration(value);
    } catch (error) {
      expect(error).toBeInstanceOf(ProducerRefusal);
      return error as ProducerRefusal;
    }
    throw new Error("expected a declaration refusal");
  };

  it("defaults to no allowances when the key is absent", () => {
    const raw = committedJson();
    delete raw.authored;
    expect(parseDeclaration(raw).authored).toEqual([]);
  });

  it("parses the committed authored allowance", () => {
    expect(declaration().authored).toEqual([
      {
        source: "aihq-project-context",
        externalPaths: ["ai-coding/PROJECT.md"],
        templatePlaceholders: ["<your-tool>"],
      },
    ]);
  });

  it("refuses an unknown key and a missing key in an entry", () => {
    expect(refusal(withAuthored([entry({ extra: true })])).reason).toBe("declaration-invalid");
    const incomplete = entry({});
    delete (incomplete as Record<string, unknown>).templatePlaceholders;
    expect(refusal(withAuthored([incomplete])).reason).toBe("declaration-invalid");
  });

  it("refuses a duplicate source across entries", () => {
    expect(refusal(withAuthored([entry({}), entry({})])).reason).toBe("declaration-invalid");
  });

  it("refuses duplicate external paths and duplicate placeholder tokens", () => {
    expect(
      refusal(withAuthored([entry({ externalPaths: ["docs/a.md", "docs/a.md"] })])).reason,
    ).toBe("declaration-invalid");
    expect(
      refusal(withAuthored([entry({ templatePlaceholders: ["<x-y>", "<x-y>"] })])).reason,
    ).toBe("declaration-invalid");
  });

  it("refuses an unsafe external path", () => {
    expect(refusal(withAuthored([entry({ externalPaths: ["../escape.md"] })])).reason).toBe(
      "declaration-invalid",
    );
  });

  it("refuses whitespace, empty and over-long placeholder tokens", () => {
    for (const token of ["<your tool>", "", "x".repeat(65)]) {
      expect(refusal(withAuthored([entry({ templatePlaceholders: [token] })])).reason).toBe(
        "declaration-invalid",
      );
    }
  });
});
