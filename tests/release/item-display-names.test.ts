import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractSourceFacts,
  firstHeading,
  headingName,
  isPathShapedName,
} from "../../src/release/source-facts.js";

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
  identifier: string;
  provenance: { path: string };
  name: { state: string; value?: string };
};
type Material = { path?: string; packagePath?: string; sourcePath?: string };
type Item = {
  id: string;
  kind?: string;
  label?: unknown;
  name?: unknown;
  nameBasis?: string;
  materials?: Material[];
  metadata?: { sourceFacts?: SourceFacts };
  provenance?: { source?: { path?: string } };
};
const readItems = (path: string) =>
  (JSON.parse(readFileSync(resolve(root, path), "utf8")) as { items?: Item[] }).items ?? [];

/**
 * The source's first level-one heading as written, outside frontmatter and fenced code,
 * read independently of the producer's reader so a heading it fails to use is caught.
 */
const writtenHeading = (bytes: Uint8Array): string | undefined => {
  let text = new TextDecoder().decode(bytes).replace(/\r\n/g, "\n");
  if (text.startsWith("---\n")) text = text.slice(text.indexOf("\n---", 3) + 4);
  let fence: string | undefined;
  for (const line of text.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (fence === undefined || marker.startsWith(fence))) {
      fence = fence === undefined ? marker : undefined;
      continue;
    }
    if (fence === undefined && /^# +\S/.test(line)) return line.replace(/^# +/, "").trim();
  }
  return undefined;
};

/**
 * What a source file offers as a name, keyed by the delivered material discovery read:
 * its author's name and its first heading made readable, each only when the reader
 * would accept it as a display name, and the heading as written. Release 1.7 items
 * carry no discovery and resolve through their recorded source path to the same
 * material.
 */
type Offer = { authored?: string; heading?: string; written?: string; key?: string };
const offerByMaterial = new Map<string, Offer>();
for (const path of shipped)
  for (const item of readItems(path)) {
    const facts = item.metadata?.sourceFacts;
    if (!facts) continue;
    const material = item.materials?.find((m) => m.path?.endsWith(`/${facts.provenance.path}`));
    if (!material?.path || offerByMaterial.has(material.path)) continue;
    const authored =
      facts.name.state === "authored" && facts.name.value && !isPathShapedName(facts.name.value)
        ? facts.name.value
        : undefined;
    const bytes = readFileSync(resolve(root, material.path));
    const heading = firstHeading(facts.profile, bytes);
    const written = /\.md$/.test(material.path) ? writtenHeading(bytes) : undefined;
    offerByMaterial.set(material.path, {
      ...(authored === undefined ? {} : { authored }),
      ...(heading === undefined ? {} : { heading }),
      ...(written === undefined ? {} : { written }),
    });
  }
/** A delivered source no discovery read: a Markdown file offers its name or heading. */
const undiscoveredOffer = (packagePath: string): Offer => {
  if (!packagePath.endsWith(".md")) return {};
  const bytes = readFileSync(resolve(root, packagePath));
  const facts = extractSourceFacts({
    profile: "markdown",
    path: "source.md",
    revision: "0".repeat(40),
    bytes,
  });
  const authored =
    facts.name.state === "authored" && facts.name.basis === "authored"
      ? facts.name.value
      : undefined;
  const heading = firstHeading("markdown", bytes);
  const written = writtenHeading(bytes);
  return {
    ...(authored === undefined || isPathShapedName(authored) ? {} : { authored }),
    ...(heading === undefined ? {} : { heading }),
    ...(written === undefined ? {} : { written }),
  };
};
const sourcePathOf = (item: Item) =>
  item.metadata?.sourceFacts?.provenance.path ?? item.provenance?.source?.path;
const offerOf = (item: Item): Offer | undefined => {
  const sourcePath = sourcePathOf(item);
  if (!sourcePath) return undefined;
  const material = item.materials?.find(
    (m) => m.sourcePath === sourcePath || m.path?.endsWith(`/${sourcePath}`),
  );
  const packagePath = material?.packagePath ?? material?.path;
  const offer = packagePath
    ? (offerByMaterial.get(packagePath) ?? undiscoveredOffer(packagePath))
    : undefined;
  // A key-discovered source (an MCP registration) names its item by the key.
  const facts = item.metadata?.sourceFacts;
  return offer && facts && facts.identifier !== facts.provenance.path
    ? { ...offer, key: facts.identifier }
    : offer;
};

const FILE_EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,4}$/;
const namespaceOf = (item: Item) => item.id.slice(0, item.id.lastIndexOf("."));

/**
 * A display name must be a real name in the Catalog order, never the item id (in any
 * case), its namespace prefix (`ecc.`, `superpowers.`) or a path. When the source offers
 * an author's name or a heading, the name is that offer unless the publisher named the
 * item. Items of the same kind and namespace sharing a heading each add their key in
 * parentheses. A source with a written heading never names its item by a file name.
 * Without an offer the name is the key or the source's file name, and a file extension
 * needs a known source to prove that. Label and name agree wherever both exist.
 */
const badNames = (path: string) => {
  const items = readItems(path);
  const headingKey = (item: Item, heading: string) =>
    `${item.kind}\u0000${namespaceOf(item)}\u0000${heading.toLowerCase()}`;
  const headingUses = new Map<string, number>();
  for (const item of items) {
    const offer = offerOf(item);
    if (offer?.heading !== undefined && offer.authored === undefined) {
      const key = headingKey(item, offer.heading);
      headingUses.set(key, (headingUses.get(key) ?? 0) + 1);
    }
  }
  return items.flatMap((item) => {
    const id = item.id.toLowerCase();
    const prefix = `${id.split(".")[0]}.`;
    const offer = offerOf(item);
    const heading =
      offer?.heading === undefined || (headingUses.get(headingKey(item, offer.heading)) ?? 0) < 2
        ? offer?.heading
        : `${offer.heading} (${item.id.slice(item.id.lastIndexOf(".") + 1)})`;
    const offered = [offer?.authored ?? heading].filter((v): v is string => v !== undefined);
    // The file-name level names one of the item's own delivered files.
    const fileNames = new Set(
      [sourcePathOf(item), ...(item.materials ?? []).map((m) => m.sourcePath ?? m.path)]
        .filter((p): p is string => typeof p === "string" && !p.startsWith("release/items/"))
        .map((p) => p.split("/").at(-1)),
    );
    const publisher = item.nameBasis === "publisher";
    const problems = (["label", "name"] as const).flatMap((field) => {
      const value = item[field];
      if (typeof value !== "string") return [];
      const lower = value.toLowerCase();
      const problem =
        lower === id
          ? "is the id"
          : lower.includes(prefix)
            ? "contains the namespace prefix"
            : isPathShapedName(value)
              ? "is path-shaped"
              : publisher
                ? undefined
                : offer?.written !== undefined && fileNames.has(value)
                  ? `is a file name while its source has the heading ${JSON.stringify(offer.written)}`
                  : offered.length
                    ? offered.includes(value)
                      ? undefined
                      : `is not the name its source offers, ${JSON.stringify(offered[0])}`
                    : offer !== undefined &&
                        !fileNames.has(value) &&
                        value !== offer.key &&
                        item.nameBasis !== "key"
                      ? "is neither its source's key nor one of its file names"
                      : offer === undefined && FILE_EXTENSION.test(value)
                        ? "ends in a file extension and its source is unknown"
                        : undefined;
      return problem ? [`${item.id} ${field}=${JSON.stringify(value)} ${problem}`] : [];
    });
    if (typeof item.name === "string" && typeof item.label === "string" && item.name !== item.label)
      problems.push(
        `${item.id} name=${JSON.stringify(item.name)} disagrees with label=${JSON.stringify(item.label)}`,
      );
    return problems;
  });
};

describe("shipped item display names", () => {
  it("covers every shipped release", () => {
    expect(shipped).toContain("./release/release-ecc.content.json");
    expect(shipped).toContain("./release/release-superpowers.json");
    expect(offerByMaterial.size).toBeGreaterThan(0);
  });

  it.each(shipped)("%s names no item by its id, namespace or a path", (path) => {
    expect(badNames(path)).toEqual([]);
  });

  it.each([
    ["/learn - Extract Reusable Patterns", "Extract Reusable Patterns"],
    ["/learn-eval: Extract, Evaluate, then Save", "Extract, Evaluate, then Save"],
    ["/ecc-guide", "ecc-guide"],
    ["TypeScript/JavaScript Patterns", "TypeScript and JavaScript Patterns"],
    ["HarmonyOS / ArkTS Hooks", "HarmonyOS and ArkTS Hooks"],
    ["Create Pull Request", "Create Pull Request"],
    ["/", undefined],
    ["a\\b", undefined],
  ])("reads the heading %j as the name %j", (heading, name) => {
    expect(headingName(heading)).toBe(name);
  });
});
