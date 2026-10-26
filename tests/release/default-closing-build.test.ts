import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, expect, it } from "vitest";

// The owning build of the closing default; it reads the built dist modules.
const root = resolve(import.meta.dirname, "../..");
const load = async (path: string) => import(pathToFileURL(resolve(root, path)).href);
type Supersession = { itemId: string; sourcePath?: string; itemSha256?: string };
type Item = { id: string; kind?: string; name?: string; supersedes: Supersession[] };
type Release = { items: Item[] };
type Inputs = { frozen: Release; extensions: Release; projectBasics: Release };
let tool: {
  closingRetirements: (inputs: Inputs) => { id: string }[];
  EXPECTED_COUNTS: unknown;
  buildDefaultClosing: () => { outputs: Map<string, Uint8Array>; release: Release };
};
let base: Inputs;

beforeAll(async () => {
  tool = await load("tools/generate-default-closing-release.mjs");
  const { readRelease, readReleaseContent } = await load("dist/release/reader.js");
  const { sha256Hex } = await load("dist/release/sha256.js");
  const read = (path: string, reader: typeof readRelease): Release => {
    const bytes = readFileSync(resolve(root, path));
    const result = reader(bytes, { expectedSha256: sha256Hex(bytes) });
    expect(result.valid).toBe(true);
    return result.release;
  };
  base = {
    frozen: read("release/release.json", readRelease),
    extensions: read("release/release-extensions.content.json", readReleaseContent),
    projectBasics: read("release/release-project-basics.content.json", readReleaseContent),
  };
});

/** Mutable copies of the committed inputs, changed by `change`. */
const changed = (change: (inputs: Inputs) => void) => {
  const inputs = structuredClone(base);
  change(inputs);
  return inputs;
};
const one = <T>(found: T | undefined): T => {
  if (found === undefined) throw new Error("Expected the committed inputs to carry it");
  return found;
};
const survivorOf = (inputs: Inputs, itemId: string) =>
  one(inputs.extensions.items.find((item) => item.supersedes?.some((s) => s.itemId === itemId)));
const supersessionOf = (inputs: Inputs, itemId: string) =>
  one(survivorOf(inputs, itemId).supersedes.find((s) => s.itemId === itemId));
const firstBasics = (inputs: Inputs) => one(inputs.projectBasics.items[0]);
const refusal = (change: (inputs: Inputs) => void) => () =>
  tool.closingRetirements(changed(change));

it("gives each of the 46 frozen items exactly one disposition", () => {
  const retired = tool.closingRetirements(structuredClone(base));
  expect(retired.map((entry) => entry.id)).toEqual(base.frozen.items.map((item) => item.id));
  expect(tool.EXPECTED_COUNTS).toEqual({ matt: 27, perTool: 18, split: 1, total: 46 });
});

it("refuses a Matt copy without its Extensions successor", () => {
  expect(
    refusal((i) => {
      const survivor = survivorOf(i, "mattpocock.tdd");
      survivor.supersedes = survivor.supersedes.filter((s) => s.itemId !== "mattpocock.tdd");
    }),
  ).toThrow(/mattpocock\.tdd: expected one Extensions successor/);
});

it("refuses a successor whose source path, name or record differs from the frozen copy", () => {
  expect(
    refusal((i) => {
      supersessionOf(i, "mattpocock.tdd").sourcePath = "skills/misc/tdd/SKILL.md";
    }),
  ).toThrow(/mattpocock\.tdd: the successor's supersession names skills\/misc/);
  expect(
    refusal((i) => {
      survivorOf(i, "mattpocock.tdd").name = "test-first";
    }),
  ).toThrow(/mattpocock\.tdd: the successor is named test-first/);
  expect(
    refusal((i) => {
      supersessionOf(i, "mattpocock.tdd").itemSha256 = "0".repeat(64);
    }),
  ).toThrow(/mattpocock\.tdd: the successor names another record/);
});

it("refuses a successor for per-tool delivery", () => {
  expect(
    refusal((i) => {
      const item = firstBasics(i);
      item.supersedes.push({ ...one(item.supersedes[0]), itemId: "aihq.client.claude" });
    }),
  ).toThrow(/aihq\.client\.claude: per-tool delivery has no Catalog successor/);
});

it("refuses a project context split over other than three items", () => {
  expect(
    refusal((i) => {
      firstBasics(i).supersedes = [];
    }),
  ).toThrow(/aihq\.project-context: expected three Project basics items/);
});

it("refuses a frozen item of a kind with no closing disposition", () => {
  expect(
    refusal((i) => {
      const context = one(i.frozen.items.find((item) => item.id === "aihq.project-context"));
      i.frozen.items.push({ ...context, id: "aihq.extra", kind: "template" });
    }),
  ).toThrow(/aihq\.extra: a template with no closing disposition/);
});

it("builds the committed content deterministically", () => {
  const built = tool.buildDefaultClosing();
  for (const [path, bytes] of built.outputs)
    expect(Buffer.from(bytes).equals(readFileSync(resolve(root, path))), path).toBe(true);
  expect(built.release.items).toEqual([]);
});
