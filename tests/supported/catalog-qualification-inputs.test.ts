import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type * as api from "../../src/index.js";
import { canonical, sha, signedCatalogRunFixture } from "./signed-catalog-run-fixture.js";

type Json = Record<string, unknown>;
type Stager = {
  stageCatalogQualificationInputsV1(input: {
    catalogRoot: string;
    runDirectory: string;
    outputRoot: string;
    api: typeof api;
  }): {
    catalogHeadSha256: string;
    sequence: number;
    receiptSetSha256: string;
    entries: number;
    groups: Record<string, string[]>;
  };
};

async function stager(): Promise<Stager> {
  // @ts-expect-error The maintenance tool is intentionally plain ESM JavaScript.
  return (await import("../../tools/stage-catalog-qualification-inputs.mjs")) as Stager;
}

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

const fixture = () => signedCatalogRunFixture(temporaryRoots);

const walk = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(directory, entry.name)).map((path) => `${entry.name}/${path}`)
      : [entry.name],
  );

describe("step-9 T5 input directories from a signed-catalog-v2 run", () => {
  it("writes exactly the four verified files per entry, grouped by the closure's source", async () => {
    const tool = await stager();
    const item = fixture();
    const result = tool.stageCatalogQualificationInputsV1(item);
    const receiptSet = readFileSync(join(item.runDirectory, "qualification-receipt-set.json"));
    expect(result).toEqual({
      catalogHeadSha256: item.head.catalogHeadSha256,
      sequence: 0,
      receiptSetSha256: sha(receiptSet),
      entries: 4,
      groups: {
        _unsourced: ["tool.npm.picocolors"],
        "anthropics-skills": ["skill.anthropic.canvas"],
        mattpocock: ["skill.mattpocock.alpha", "skill.mattpocock.beta"],
      },
    });
    const out = item.outputRoot;
    expect(walk(out).sort()).toEqual(
      [
        "_unsourced/tool.npm.picocolors",
        "anthropics-skills/skill.anthropic.canvas",
        "mattpocock/skill.mattpocock.alpha",
        "mattpocock/skill.mattpocock.beta",
      ].flatMap((directory) =>
        ["closure.json", "member.json", "receipt-set.json", "receipt.json"].map(
          (name) => `${directory}/${name}`,
        ),
      ),
    );
    const entry = join(out, "mattpocock", "skill.mattpocock.alpha");
    expect(readFileSync(join(entry, "receipt.json"))).toEqual(
      readFileSync(join(item.runDirectory, "receipts", "skill.mattpocock.alpha.json")),
    );
    expect(readFileSync(join(entry, "receipt-set.json"))).toEqual(receiptSet);
    expect(readFileSync(join(entry, "closure.json"))).toEqual(
      readFileSync(
        join(
          item.catalogRoot,
          "defaults/workbench/mattpocock/skill.mattpocock.alpha/artifacts/closure.json",
        ),
      ),
    );
    // The member is the head entry without its digest, in canonical bytes, and its domain
    // digest is the one the receipt and the receipt set bind.
    const member = readFileSync(join(entry, "member.json"), "utf8");
    const headEntry = (item.head.entries as Json[]).find(
      (value) => value.entryId === "skill.mattpocock.alpha",
    ) as Json;
    const { memberSha256, ...unsigned } = headEntry;
    expect(member).toBe(canonical(unsigned));
    expect(`sha256:${sha(`aih-supported-catalog-member/v2\0${member}`)}`).toBe(
      `sha256:${memberSha256}`,
    );
    const receipt = JSON.parse(readFileSync(join(entry, "receipt.json"), "utf8"));
    expect(receipt.qualificationBasis.catalogMemberDigest).toBe(`sha256:${memberSha256}`);
  });

  it("refuses a receipt, receipt set or closure whose bytes do not match, naming every entry, and writes nothing", async () => {
    const tool = await stager();
    const receipt = fixture();
    const path = join(receipt.runDirectory, "receipts", "skill.mattpocock.beta.json");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace("skill.mattpocock.beta", "skill.mattpocock.gamma"),
    );
    expect(() => tool.stageCatalogQualificationInputsV1(receipt)).toThrow(
      "catalog-qualification-inputs:unverified skill.mattpocock.beta (receipt-digest)",
    );
    expect(existsSync(receipt.outputRoot)).toBe(false);

    const closure = fixture();
    for (const name of ["skill.anthropic.canvas", "skill.mattpocock.alpha"])
      writeFileSync(
        join(
          closure.catalogRoot,
          "defaults",
          "workbench",
          name.split(".")[1] === "anthropic" ? "anthropic" : "mattpocock",
          name,
          "artifacts",
          "closure.json",
        ),
        "{}",
      );
    expect(() => tool.stageCatalogQualificationInputsV1(closure)).toThrow(
      "catalog-qualification-inputs:unverified skill.anthropic.canvas (closure-digest); skill.mattpocock.alpha (closure-digest)",
    );
    expect(existsSync(closure.outputRoot)).toBe(false);

    // A receipt set that is not the run's own (another head member digest) is refused.
    const set = fixture();
    const setPath = join(set.runDirectory, "qualification-receipt-set.json");
    const parsed = JSON.parse(readFileSync(setPath, "utf8"));
    parsed.entries[0].memberDigest = `sha256:${"0".repeat(64)}`;
    writeFileSync(setPath, canonical(parsed));
    expect(() => tool.stageCatalogQualificationInputsV1(set)).toThrow(
      "catalog-qualification-inputs:unverified skill.anthropic.canvas (member-digest, receipt-member)",
    );
  });

  it("refuses a run directory with anything but the workflow's artifacts, a head entry without a receipt, and an existing output", async () => {
    const tool = await stager();
    const extra = fixture();
    writeFileSync(join(extra.runDirectory, "notes.txt"), "x");
    expect(() => tool.stageCatalogQualificationInputsV1(extra)).toThrow(
      "catalog-qualification-inputs:run-layout notes.txt",
    );
    const stray = fixture();
    writeFileSync(join(stray.runDirectory, "receipts", "skill.other.json"), "{}");
    expect(() => tool.stageCatalogQualificationInputsV1(stray)).toThrow(
      "catalog-qualification-inputs:receipts",
    );
    const missing = fixture();
    const setPath = join(missing.runDirectory, "qualification-receipt-set.json");
    const parsed = JSON.parse(readFileSync(setPath, "utf8"));
    parsed.entries = parsed.entries.filter(
      (entry: Json) => entry.entryId !== "skill.mattpocock.beta",
    );
    writeFileSync(setPath, canonical(parsed));
    rmSync(join(missing.runDirectory, "receipts", "skill.mattpocock.beta.json"));
    expect(() => tool.stageCatalogQualificationInputsV1(missing)).toThrow(
      "catalog-qualification-inputs:receipt-set-coverage skill.mattpocock.beta",
    );
    const existing = fixture();
    mkdirSync(existing.outputRoot);
    expect(() => tool.stageCatalogQualificationInputsV1(existing)).toThrow(
      "catalog-qualification-inputs:output-exists",
    );
    // The same run over a copy stays valid: the checks read content, not locations.
    const copy = fixture();
    const moved = `${copy.runDirectory}-copy`;
    cpSync(copy.runDirectory, moved, { recursive: true });
    expect(tool.stageCatalogQualificationInputsV1({ ...copy, runDirectory: moved }).entries).toBe(
      4,
    );
  });
});
