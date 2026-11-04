import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { fixtures, formats, schemas, toolProfiles } from "../../src/catalog/contracts.js";
import { canonicalDocument } from "../../src/catalog/internal/json.js";
import {
  readContent,
  readQualification,
  readRecipe,
  readToolProfile,
} from "../../src/catalog/reader.js";
import { parseSourceLink } from "../../src/catalog/source.js";

const root = resolve(import.meta.dirname, "../..");
const utf8 = (text: string) => new TextEncoder().encode(text);
const json = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));
const NAMES = ["content", "qualification", "recipe", "source-link", "tool-profile"] as const;
type Name = (typeof NAMES)[number];
const URN: Record<Name, string> = {
  content: formats.content,
  qualification: formats.qualification,
  recipe: formats.recipe,
  "source-link": formats.sourceLink,
  "tool-profile": formats.toolProfile,
};

/** A recipe folder is a Git plugin: its Agent Plugins metadata, beside `recipe.json`. */
const PLUGIN_JSON = utf8(
  JSON.stringify({
    name: "example-recipe",
    version: "0.1.0",
    description: "An example recipe plugin.",
    author: "Example",
    license: "Apache-2.0",
    keywords: ["aihq-recipe"],
  }),
);

const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
const validators = Object.fromEntries(
  NAMES.map((name) => [name, ajv.compile(schemas[name] as object)]),
) as Record<Name, ReturnType<typeof ajv.compile>>;
const conforms = (name: Name, value: unknown): string[] => {
  const validate = validators[name];
  return validate(value)
    ? []
    : (validate.errors ?? []).map((error) => `${error.instancePath} ${error.message}`);
};

/** The reader each format has; a source-link result is produced by `parseSourceLink`. */
function read(name: Name, text: string): string {
  const bytes = utf8(text);
  if (name === "content") return readContent(bytes).status;
  if (name === "tool-profile") return readToolProfile(bytes).status;
  if (name === "qualification") return readQualification(bytes).status;
  if (name === "recipe") return readRecipe(PLUGIN_JSON, bytes).status;
  return conforms(name, JSON.parse(text)).length === 0 ? "ok" : "invalid";
}

describe("@aihq/catalog/contracts publishes exactly five schemas and ten fixtures", () => {
  it("names one schema per format, identified by its URN", () => {
    expect(Object.keys(schemas).sort()).toEqual([...NAMES]);
    for (const name of NAMES) {
      const schema = schemas[name] as { $id: string; $schema: string };
      expect(schema.$id).toBe(URN[name]);
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    }
  });

  it("gives one valid and one invalid fixture per schema", () => {
    expect(Object.keys(fixtures).sort()).toEqual(
      NAMES.flatMap((name) => [`${name}-invalid`, `${name}-valid`]),
    );
  });

  for (const name of NAMES) {
    it(`${name}: the valid fixture reads ok and conforms; the invalid one reads invalid and does not`, () => {
      const valid = fixtures[`${name}-valid`];
      const invalid = fixtures[`${name}-invalid`];
      expect(read(name, valid)).toBe("ok");
      expect(conforms(name, JSON.parse(valid))).toEqual([]);
      expect(JSON.parse(valid).schema).toBe(URN[name]);
      expect(read(name, invalid)).toBe("invalid");
      expect(conforms(name, JSON.parse(invalid))).not.toEqual([]);
    });
  }

  it("the valid source-link fixture is what parseSourceLink returns for its link", () => {
    const fixture = JSON.parse(fixtures["source-link-valid"]);
    const result = parseSourceLink(
      "https://github.com/example-org/example-skills/tree/v1.2.0/skills/review-notes",
    );
    expect(result).toEqual(fixture);
  });
});

describe("the shipped tool profiles", () => {
  it("are the nine committed profile documents, byte for byte, and each reads ok", () => {
    const committed = readdirSync(join(root, "profiles"))
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -".json".length))
      .sort();
    expect(committed).toEqual([
      "antigravity",
      "claude-code",
      "codex",
      "copilot",
      "cursor",
      "dsh",
      "kimi",
      "kiro",
      "opencode",
    ]);
    expect(Object.keys(toolProfiles).sort()).toEqual(committed);
    for (const id of committed) {
      const text = toolProfiles[id as keyof typeof toolProfiles];
      expect(text).toBe(readFileSync(join(root, "profiles", `${id}.json`), "utf8"));
      const read = readToolProfile(utf8(text));
      expect(read.status, id).toBe("ok");
      expect(conforms("tool-profile", JSON.parse(text)), id).toEqual([]);
    }
  });
});

describe("the schemas describe every committed document", () => {
  it("every data content file conforms to the content schema", () => {
    const frameworks = readdirSync(join(root, "data"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "qualifications")
      .map((entry) => entry.name);
    expect(frameworks.length).toBeGreaterThanOrEqual(13);
    for (const framework of frameworks)
      expect(conforms("content", json(`data/${framework}/content.json`)), framework).toEqual([]);
  });

  it("every committed qualification conforms to the qualification schema", () => {
    const files = readdirSync(join(root, "data", "qualifications"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files)
      expect(conforms("qualification", json(`data/qualifications/${file}`)), file).toEqual([]);
  });

  it("every drafted recipe, once given its format and data commit, conforms and reads ok", () => {
    const drafts = [
      ...Object.values(json("port-report/remaining.json").recipes as Record<string, object>),
      ...(json("port-report/ai-setup.json").recipes as object[]),
    ];
    expect(drafts.length).toBeGreaterThanOrEqual(8);
    const data = {
      repository: "https://github.com/samartomar/aih-catalog",
      commit: "0".repeat(40),
    };
    for (const draft of drafts) {
      const recipe = { schema: formats.recipe, ...draft, data };
      const id = (draft as { id: string }).id;
      expect(conforms("recipe", recipe), id).toEqual([]);
      expect(readRecipe(PLUGIN_JSON, utf8(canonicalDocument(recipe))).status, id).toBe("ok");
    }
  });
});
