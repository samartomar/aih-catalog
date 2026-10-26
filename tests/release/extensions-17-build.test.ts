import { createHash } from "node:crypto";
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
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

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
  materials?: MaterialLike[];
  supersedes?: { itemId: string; match: string; sourcePath?: string; name?: string }[];
  contentSha256?: string;
}

/** Recomputes one projected copy's identities after a mutation, keeping it readable. */
const reidentify = (item: Record<string, unknown>) => {
  const materials = item.materials as MaterialLike[];
  const lines = (members: MaterialLike[]) =>
    members
      .map((member) => `${member.relPath}\t${member.sha256}\n`)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const content = materials.filter((member) => member.relPath !== "aih-behaviour.json");
  item.contentSha256 = sha256(lines(content).join(""));
  item.behaviourSha256 = sha256(lines(materials).join(""));
};

it("builds the committed content deterministically", async () => {
  const { buildExtensions17, EXTENSIONS_17_CONTENT_PATH } = await tool();
  const first = buildExtensions17({ root });
  const second = buildExtensions17({ root });
  expect(first.releaseSha256).toBe(second.releaseSha256);
  expect([...first.outputs.keys()]).toContain(EXTENSIONS_17_CONTENT_PATH);
  expect(first.release.items).toHaveLength(57);
  expect(first.release.sets).toHaveLength(8);
  expect(first.release.retired).toHaveLength(118);
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
  const MATT = "https://github.com/mattpocock/skills";
  const EXT = "https://github.com/samartomar/aih-extensions";
  const matt = release.items.filter((entry: { id: string }) =>
    entry.id.startsWith("extensions.matt."),
  );
  expect(matt).toHaveLength(27);
  for (const entry of matt as unknown as ItemLike[]) {
    expect(entry.source).toBe(MATT);
    expect(entry.selectedBy).toBe(EXT);
    expect(entry.derivedFrom).toBeUndefined();
  }
  expect(item("extensions.matt.setup-matt-pocock-skills").source).toBe(MATT);
  const grill = item("extensions.matt.grill-me");
  const frozenEntry = grill.supersedes?.find((entry) => entry.itemId === "mattpocock.grill-me");
  expect(frozenEntry?.match).toBe("name+sourcePath");
  expect(frozenEntry?.sourcePath).toBe("skills/productivity/grill-me/SKILL.md");
  expect(frozenEntry?.name).toBe("grill-me");
  // No skill sits outside Matt's two pinned buckets.
  for (const entry of matt as unknown as ItemLike[]) {
    const skill = entry.materials?.find((member) => member.sourcePath?.endsWith("/SKILL.md"));
    expect(["engineering", "productivity"]).toContain(skill?.sourcePath?.split("/")[1]);
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
