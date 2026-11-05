import { describe, expect, it } from "vitest";
import { readLocalSource } from "../../src/catalog/node.js";
import { buildContent } from "../../src/catalog/producer.js";
import { findItems } from "../../src/catalog/source.js";
import { FRAMEWORK, folder } from "./helpers.js";

const SKILL = "---\nname: tidy\ndescription: Tidy the code.\n---\n\nTidy $ARGUMENTS.\n";

describe("bundle include patterns", () => {
  it("matches a many-star pattern against a long name in linear time", async () => {
    const name = `${"a".repeat(200)}.md`;
    const root = folder({ "skills/tidy/SKILL.md": SKILL, [`docs/${name}`]: "x\n" });
    const read = readLocalSource(root);
    if (read.status !== "ok") throw new Error(JSON.stringify(read));
    const found = findItems(read.files, { framework: FRAMEWORK });
    if (found.status !== "ok") throw new Error(JSON.stringify(found));
    const pattern = `docs/${"*a".repeat(40)}*b`;
    const started = performance.now();
    const built = await buildContent(
      read.source,
      read.files,
      found.items.map((item) => ({ ...item, bundle: "local.runtime" })),
      {
        framework: FRAMEWORK,
        bundles: [
          { id: "local.runtime", layout: "skills/<name>/", include: [pattern, "docs/*.md"] },
        ],
      },
    );
    expect(performance.now() - started).toBeLessThan(2000);
    expect(built.status).toBe("ok");
    if (built.status !== "ok") return;
    expect(built.content.bundles?.[0]?.files.map((file) => file.sourcePath)).toEqual([
      `docs/${name}`,
    ]);
  });
});
