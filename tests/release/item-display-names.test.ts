import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
};

// Every release the package ships: each `./release*.json` export.
const shipped = Object.entries(pkg.exports)
  .filter(([key, target]) => /^\.\/release[^/]*\.json$/.test(key) && typeof target === "string")
  .map(([, target]) => target as string)
  .sort();

type Item = { id: string; label?: unknown; name?: unknown };

/**
 * A display name must be a real name: never the item id itself, and never text
 * carrying the id's namespace prefix (`ecc.`, `superpowers.`), which is how a
 * raw id leaks onto the page.
 */
const idLikeNames = (path: string) => {
  const release = JSON.parse(readFileSync(resolve(root, path), "utf8")) as { items?: Item[] };
  return (release.items ?? []).flatMap((item) => {
    const prefix = `${item.id.split(".")[0]}.`;
    return (["label", "name"] as const)
      .filter((field) => typeof item[field] === "string")
      .filter((field) => item[field] === item.id || (item[field] as string).includes(prefix))
      .map((field) => `${item.id} ${field}=${JSON.stringify(item[field])}`);
  });
};

describe("shipped item display names", () => {
  it("covers every shipped release", () => {
    expect(shipped).toContain("./release/release-ecc.content.json");
    expect(shipped).toContain("./release/release-superpowers.json");
  });

  it.each(shipped)("%s names no item by its id or namespace", (path) => {
    expect(idLikeNames(path)).toEqual([]);
  });
});
