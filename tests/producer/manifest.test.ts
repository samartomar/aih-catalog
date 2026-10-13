import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { candidateManifestBytes } from "../../src/producer/package.js";
import { committedRelease, root } from "./helpers.js";

const manifest = readFileSync(join(root, "package.json"));
const all = committedRelease();
const document = JSON.parse(all.get("release/release.json")?.toString() ?? "null");
const members = new Set<string>([
  "release/release.json",
  ...document.items.flatMap((item: { recipe: { path: string }; materials: { path: string }[] }) => [
    item.recipe.path,
    ...item.materials.map((member) => member.path),
  ]),
]);
const primary = new Map([...all].filter(([path]) => members.has(path)));

describe("candidate manifest derives optional release exports", () => {
  it("preserves source bytes exactly when all optional documents are present", () => {
    expect(candidateManifestBytes(manifest, all)).toEqual(manifest);
  });
  it("removes only absent canonical optional document exports and keeps primary required", () => {
    const next = JSON.parse(candidateManifestBytes(manifest, primary).toString());
    expect(next.exports["./release.json"]).toBe("./release/release.json");
    expect(next.exports["./release-1.1.json"]).toBeUndefined();
    expect(next.exports["./release-native-fixture.json"]).toBeUndefined();
    expect(next.exports["./release-native-bundles.json"]).toBeUndefined();
    expect(next.exports["./release-guide.json"]).toBeUndefined();
    expect(JSON.parse(manifest.toString()).exports["./release-1.1.json"]).toBeDefined();
    const missing = new Map(primary);
    missing.delete("release/release.json");
    expect(() => candidateManifestBytes(manifest, missing)).toThrow(/base-invalid/);
  });
  it("does not hide malformed or unknown exports and refuses damaged inventory", () => {
    const source = JSON.parse(manifest.toString());
    source.exports["./release-1.1.json"] = "./broken.json";
    source.exports["./custom.json"] = "./release/custom.json";
    source.exports["./release-guide.json"] = "./broken-guide.json";
    const next = JSON.parse(
      candidateManifestBytes(Buffer.from(JSON.stringify(source)), primary).toString(),
    );
    expect(next.exports["./release-1.1.json"]).toBe("./broken.json");
    expect(next.exports["./custom.json"]).toBe("./release/custom.json");
    expect(next.exports["./release-guide.json"]).toBe("./broken-guide.json");
    const damaged = new Map(primary);
    damaged.set(document.items[0].recipe.path, Buffer.from("changed"));
    expect(() => candidateManifestBytes(manifest, damaged)).toThrow(/base-member-mismatch/);
  });
});
