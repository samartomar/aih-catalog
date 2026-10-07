import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getItem, readRelease, validateSelectionSet } from "../../src/release/reader.js";
import { sha256 } from "./fixtures.js";

describe("carried skill composition", () => {
  it("requires both mandatory callees of grill-with-docs and maps their explicit selections", () => {
    const bytes = readFileSync(resolve(import.meta.dirname, "../../release/release.json"));
    const checked = readRelease(bytes, { expectedSha256: sha256(bytes) });
    if (!checked.valid) throw new Error(JSON.stringify(checked.diagnostics));
    const release = checked.release;
    const select = (itemId: string, id: string) => {
      const found = getItem(release, itemId);
      if (!found.found) throw new Error(itemId);
      return {
        id,
        item: { releaseSha256: release.sha256, itemId, itemSha256: found.item.itemSha256 },
        configuration: {},
      };
    };
    const wrapper = select("mattpocock.grill-with-docs", "wrapper");
    const releases = { [release.sha256]: release };
    expect(validateSelectionSet({ releases, selections: [wrapper] }).valid).toBe(false);
    const complete = validateSelectionSet({
      releases,
      selections: [
        wrapper,
        select("mattpocock.domain-modeling", "domain"),
        select("mattpocock.grilling", "questions"),
      ],
    });
    expect(complete.valid, JSON.stringify(complete.diagnostics)).toBe(true);
    expect(complete.requiresBySelectionId).toEqual({
      wrapper: ["domain", "questions"],
      domain: [],
      questions: [],
    });
  });
});
