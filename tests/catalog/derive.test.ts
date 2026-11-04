import { describe, expect, it } from "vitest";
import { fixtures } from "../../src/catalog/contracts.js";
import { derive, getItem, readContent } from "../../src/catalog/reader.js";
import { folder, ownContent } from "./helpers.js";

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("derive", () => {
  it("gives the sources, install-relative paths and size of an item's own files", () => {
    const read = readContent(utf8(fixtures["content-valid"]));
    if (read.status !== "ok") throw new Error(read.status);
    const found = getItem(read.content, "example.skill.review-notes");
    if (found.status !== "ok") throw new Error(found.status);
    expect(derive(found.item, read.content)).toEqual({
      sourceIds: ["example"],
      packagePath: ["SKILL.md"],
      size: 199,
    });
  });

  it("keeps a skill's support files under its folder and sums every file", async () => {
    const built = await ownContent(
      folder({
        "skills/release/SKILL.md": "---\nname: release\ndescription: Cut a release.\n---\nSteps.\n",
        "skills/release/scripts/check.sh": { text: "echo ok\n", executable: true },
        "skills/release/docs/notes.md": "Notes.\n",
      }),
    );
    const item = built.built.content.items.find((entry) => entry.kind === "skill");
    if (item === undefined) throw new Error("no skill");
    expect(derive(item, built.built.content)).toEqual({
      sourceIds: ["local-my-skills"],
      packagePath: ["SKILL.md", "docs/notes.md", "scripts/check.sh"],
      size: 72,
    });
  });
});
