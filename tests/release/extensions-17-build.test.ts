import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

// The owning build of the Extensions release 1.7.0 content; it reads the built dist modules.
const tool = async () =>
  import(
    pathToFileURL(resolve(import.meta.dirname, "../../tools/generate-extensions-17-release.mjs"))
      .href
  );
const root = resolve(import.meta.dirname, "../..");

interface MaterialLike {
  relPath?: string;
  sha256?: string;
  sourcePath?: string | null;
}
interface ItemLike {
  id: string;
  kind: string;
  source?: string;
  selectedBy?: string;
  derivedFrom?: unknown;
  provenance?: {
    source: { sourceId: string; path: string };
    selectedBy?: { sourceId: string };
    derivedFrom: unknown[];
  };
  materials?: MaterialLike[];
  supersedes?: { itemId: string; match: string; sourcePath?: string; name?: string }[];
  contentSha256?: string;
}

/** Recomputes one projected copy's identities after a mutation, keeping it readable. */
const { computeBehaviourIdentity } = await import(
  pathToFileURL(resolve(import.meta.dirname, "../../dist/release/document.js")).href
);
const reidentify = (item: Record<string, unknown>) => {
  const identity = computeBehaviourIdentity(item);
  item.contentSha256 = identity.contentSha256;
  item.behaviourSha256 = identity.behaviourSha256;
};

it("builds the committed content deterministically", async () => {
  const { buildExtensions17, EXTENSIONS_17_CONTENT_PATH } = await tool();
  const first = buildExtensions17({ root });
  const second = buildExtensions17({ root });
  expect(first.releaseSha256).toBe(second.releaseSha256);
  expect([...first.outputs.keys()]).toContain(EXTENSIONS_17_CONTENT_PATH);
  expect(first.release.items).toHaveLength(67);
  expect(first.release.sets).toHaveLength(6);
  expect(first.release.retired).toHaveLength(138);
  // The committed document is the build output.
  const committed = readFileSync(resolve(root, EXTENSIONS_17_CONTENT_PATH));
  const rendered = first.outputs.get(EXTENSIONS_17_CONTENT_PATH);
  expect(rendered).toBeDefined();
  expect(Buffer.from(rendered?.bytes ?? Buffer.alloc(0)).equals(committed)).toBe(true);
});

it("renders the accepted Matt grouping, provenance and supersession facts", async () => {
  const { buildExtensions17 } = await tool();
  const { release } = buildExtensions17({ root });
  const item = (id: string): ItemLike => {
    const found = release.items.find((entry: { id: string }) => entry.id === id) as unknown as
      | ItemLike
      | undefined;
    if (!found) throw new Error(`The release carries no ${id}`);
    return found;
  };
  const matt = release.items.filter((entry: { id: string }) =>
    entry.id.startsWith("extensions.matt."),
  );
  // The 27 skills of Matt's plugin, selected by AIH-Extensions, and the 10 of his
  // pinned in-progress and misc buckets, which only his own grouping offers.
  expect(matt).toHaveLength(37);
  for (const entry of matt as unknown as ItemLike[]) {
    // Provenance is hops; the URL `source` of release 1.6 is gone.
    expect(entry.source).toBeUndefined();
    expect(entry.selectedBy).toBeUndefined();
    expect(entry.provenance?.source.sourceId).toBe("matt");
    expect(entry.provenance?.derivedFrom).toEqual([]);
    const plugin = ["engineering", "productivity"].includes(
      entry.provenance?.source.path.split("/")[1] ?? "",
    );
    expect(entry.provenance?.selectedBy?.sourceId).toBe(plugin ? "extensions" : undefined);
  }
  expect(item("extensions.matt.setup-matt-pocock-skills").provenance?.source.path).toBe(
    "skills/engineering/setup-matt-pocock-skills",
  );
  const grill = item("extensions.matt.grill-me");
  const frozenEntry = grill.supersedes?.find((entry) => entry.itemId === "mattpocock.grill-me");
  expect(frozenEntry?.match).toBe("name+sourcePath");
  expect(frozenEntry?.sourcePath).toBe("skills/productivity/grill-me/SKILL.md");
  expect(frozenEntry?.name).toBe("grill-me");
  // No skill sits outside the buckets Matt's pinned tree holds skills in.
  for (const entry of matt as unknown as ItemLike[]) {
    const skill = entry.materials?.find((member) => member.sourcePath?.endsWith("/SKILL.md"));
    expect(["engineering", "productivity", "in-progress", "misc"]).toContain(
      skill?.sourcePath?.split("/")[1],
    );
  }
});

it("refuses the build when one copy conflicts with another", async () => {
  const { buildExtensions17 } = await tool();
  // Give one copy different bytes at the skill path, keeping that copy readable:
  // the build must refuse rather than silently pick a winner between the copies.
  expect(
    () =>
      buildExtensions17({
        root,
        mutate16: (document: Record<string, unknown>) => {
          const items = document.items as Record<string, unknown>[];
          const copy = items.find(
            (entry: Record<string, unknown>) => entry.id === "extensions.kiro.matt.grill-me",
          );
          if (!copy) throw new Error("mutated copy missing");
          const materials = copy.materials as MaterialLike[];
          const skill = materials.find((member) => member.relPath === "SKILL.md");
          if (!skill?.sha256) throw new Error("mutated skill missing");
          skill.sha256 = skill.sha256.replace(/^./, (char) => (char === "0" ? "1" : "0"));
          reidentify(copy);
        },
      }),
    // The checked reader refuses the shared path with divergent bytes before the
    // transition build's own conflicting-copies check; either refusal fails the build.
  ).toThrow(/inconsistent-material-path|conflicting-copies/);
});
