import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJsonV1 } from "../../src/production/strict-json-v1.js";
import {
  compileMattPocockSkillCollectionV1,
  prepareMattPocockCollectionV1,
} from "../../src/production/workbench/mattpocock-provider-v1.js";
import { compilePonytailComponentCollectionV1 } from "../../src/production/workbench/ponytail-provider-v1.js";
import { compileCatalogProviderV1 } from "../../src/production/workbench/provider-compilation-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const data = (name: string) => resolve(root, "src", "production", "data", name);
const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

describe("Catalog production generators", () => {
  it("derives the Matt Pocock collection from the fetched snapshot", () => {
    const snapshot = json(data("mattpocock.snapshot.json"));
    const published = json(resolve(root, "defaults", "catalog-scanner-providers-v1.json")) as {
      collections: { mattpocock: unknown };
    };
    expect(canonicalJsonV1(prepareMattPocockCollectionV1(snapshot))).toBe(
      canonicalJsonV1(published.collections.mattpocock),
    );
  });

  it("compiles every pinned Matt Pocock skill with its frontmatter description", () => {
    const compiled = compileMattPocockSkillCollectionV1(
      prepareMattPocockCollectionV1(json(data("mattpocock.snapshot.json"))),
    );
    expect(compiled.declarations).toHaveLength(25);
    const detail = JSON.parse(compiled.detailBytes["detail:mattpocock/skill:tdd"] as string) as {
      skill: { description: string };
    };
    expect(detail.skill.description).toMatch(/^Test-driven development\./u);
  });

  it("rejects a snapshot whose bytes do not match its recorded digest", () => {
    const snapshot = json(data("mattpocock.snapshot.json")) as {
      entries: { sha256: string }[];
    };
    (snapshot.entries[0] as { sha256: string }).sha256 = "0".repeat(64);
    expect(() => prepareMattPocockCollectionV1(snapshot)).toThrow(/integrity mismatch/u);
  });

  it("keeps no frozen derived Matt Pocock collection beside its snapshot", () => {
    expect(existsSync(data("mattpocock-collection-v1.json"))).toBe(false);
  });

  it("compiles the Ponytail components from the fetched snapshot deterministically", () => {
    const compile = () =>
      compileCatalogProviderV1(
        "ponytail",
        (input: unknown) => [compilePonytailComponentCollectionV1(input)],
        json(data("ponytail.snapshot.json")),
      );
    const first = compile();
    expect(canonicalJsonV1(compile())).toBe(canonicalJsonV1(first));
    const declarations = first.inputs[0]?.declarations ?? [];
    expect(declarations.map((entry) => entry.declaration.id)).toContain("ponytail/skill:ponytail");
    expect(Object.keys(first.inputs[0]?.sources ?? {})).toEqual(["source:ponytail"]);
  });

  it("rejects Ponytail file bytes that do not match their recorded digest", () => {
    const snapshot = json(data("ponytail.snapshot.json")) as { files: { sha256: string }[] };
    (snapshot.files[0] as { sha256: string }).sha256 = `sha256:${"0".repeat(64)}`;
    expect(() => compilePonytailComponentCollectionV1(snapshot)).toThrow(/digest mismatch/u);
  });

  it("rejects a Ponytail snapshot that names another repository", () => {
    const snapshot = json(data("ponytail.snapshot.json")) as { source: { repository: string } };
    snapshot.source.repository = "https://github.com/example/ponytail";
    expect(() => compilePonytailComponentCollectionV1(snapshot)).toThrow(/exact source identity/u);
  });
});
