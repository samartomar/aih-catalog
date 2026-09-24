import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJsonV1 } from "../../src/production/strict-json-v1.js";
import {
  compileMattPocockSkillCollectionV1,
  prepareMattPocockCollectionV1,
} from "../../src/production/workbench/mattpocock-provider-v1.js";

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
});
