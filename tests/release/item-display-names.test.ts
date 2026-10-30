import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { firstHeading, isPathShapedName } from "../../src/release/source-facts.js";

const root = resolve(import.meta.dirname, "../..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
};

// Every release the package ships: each `./release*.json` export.
const shipped = Object.entries(pkg.exports)
  .filter(([key, target]) => /^\.\/release[^/]*\.json$/.test(key) && typeof target === "string")
  .map(([, target]) => target as string)
  .sort();

type SourceFacts = {
  profile: string;
  provenance: { path: string };
  name: { state: string; value?: string };
};
type Material = { path?: string; packagePath?: string; sourcePath?: string };
type Item = {
  id: string;
  label?: unknown;
  name?: unknown;
  materials?: Material[];
  metadata?: { sourceFacts?: SourceFacts };
  provenance?: { source?: { path?: string } };
};
const readItems = (path: string) =>
  (JSON.parse(readFileSync(resolve(root, path), "utf8")) as { items?: Item[] }).items ?? [];

/**
 * The names a source file offers: its author's name and its first usable heading,
 * keyed by the delivered material that discovery read. Release 1.7 items carry no
 * discovery and resolve through their recorded source path to the same material.
 */
const offeredByMaterial = new Map<string, string[]>();
for (const path of shipped)
  for (const item of readItems(path)) {
    const facts = item.metadata?.sourceFacts;
    if (!facts) continue;
    const material = item.materials?.find((m) => m.path?.endsWith(`/${facts.provenance.path}`));
    if (!material?.path || offeredByMaterial.has(material.path)) continue;
    const heading = firstHeading(facts.profile, readFileSync(resolve(root, material.path)));
    offeredByMaterial.set(
      material.path,
      [facts.name.state === "authored" ? facts.name.value : undefined, heading].filter(
        (value): value is string => typeof value === "string",
      ),
    );
  }
const offered = (item: Item): string[] | undefined => {
  const facts = item.metadata?.sourceFacts;
  const sourcePath = facts?.provenance.path ?? item.provenance?.source?.path;
  if (!sourcePath) return undefined;
  const material = item.materials?.find(
    (m) => m.sourcePath === sourcePath || m.path?.endsWith(`/${sourcePath}`),
  );
  const packagePath = material?.packagePath ?? material?.path;
  return packagePath ? offeredByMaterial.get(packagePath) : undefined;
};

const FILE_EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,4}$/;

/**
 * A display name must be a real name, never the item id, its namespace prefix
 * (`ecc.`, `superpowers.`) or a path. A separator survives only inside the author's
 * own prose name or heading; a bare file name with its extension only when the
 * source offers neither, and the source must be known to prove that.
 */
const badNames = (path: string) =>
  readItems(path).flatMap((item) => {
    const prefix = `${item.id.split(".")[0]}.`;
    const names = offered(item);
    return (["label", "name"] as const).flatMap((field) => {
      const value = item[field];
      if (typeof value !== "string") return [];
      const problem =
        value === item.id
          ? "is the id"
          : value.includes(prefix)
            ? "contains the namespace prefix"
            : isPathShapedName(value)
              ? "is path-shaped"
              : /[\\/]/.test(value) && !names?.includes(value)
                ? "contains a path separator that is not the author's own text"
                : FILE_EXTENSION.test(value) && names === undefined
                  ? "ends in a file extension and its source is unknown"
                  : FILE_EXTENSION.test(value) && names?.length && !names.includes(value)
                    ? `ends in a file extension although the source offers ${JSON.stringify(names[0])}`
                    : undefined;
      return problem ? [`${item.id} ${field}=${JSON.stringify(value)} ${problem}`] : [];
    });
  });

describe("shipped item display names", () => {
  it("covers every shipped release", () => {
    expect(shipped).toContain("./release/release-ecc.content.json");
    expect(shipped).toContain("./release/release-superpowers.json");
    expect(offeredByMaterial.size).toBeGreaterThan(0);
  });

  it.each(shipped)("%s names no item by its id, namespace or a path", (path) => {
    expect(badNames(path)).toEqual([]);
  });
});
