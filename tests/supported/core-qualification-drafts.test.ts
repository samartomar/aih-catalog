import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type * as api from "../../src/index.js";
import { parseCoreQualificationDataV1 } from "../../src/production/workbench-producers-v1.js";
import {
  canonical,
  digest,
  ROWS,
  sha,
  signedCatalogRunFixture,
} from "./signed-catalog-run-fixture.js";

type Json = Record<string, unknown>;
type Merger = {
  mergeCoreQualificationDraftsV1(input: {
    catalogRoot: string;
    signedCatalogPath: string;
    draftsDirectory: string;
    outputPath: string;
    api: typeof api;
  }): {
    records: number;
    sequence: number;
    catalogHeadSha256: string;
    receiptSetSha256: string;
    withoutDraft: string[];
    candidateCatalogUseRecords: number;
  };
  encodeCoreQualificationDataV2(data: Json): string;
  expandCoreQualificationDataV2(data: Json): Json;
  pruneUnreferencedCoreQualificationArtifactsV2(data: Json): string;
};
type Stager = {
  stageCatalogQualificationInputsV1(input: {
    catalogRoot: string;
    runDirectory: string;
    outputRoot: string;
    api: typeof api;
  }): { groups: Record<string, string[]> };
};

async function merger(): Promise<Merger> {
  // @ts-expect-error The maintenance tool is intentionally plain ESM JavaScript.
  return (await import("../../tools/merge-core-qualification-drafts.mjs")) as Merger;
}

async function stager(): Promise<Stager> {
  // @ts-expect-error The maintenance tool is intentionally plain ESM JavaScript.
  return (await import("../../tools/stage-catalog-qualification-inputs.mjs")) as Stager;
}

async function indexGenerator(): Promise<{
  generateCatalogIndex(root: string): unknown;
  serializeCatalogIndex(value: unknown): string;
}> {
  // @ts-expect-error The maintenance generator is intentionally plain ESM JavaScript.
  return import("../../tools/generate-catalog-index.mjs");
}

const repository = resolve(import.meta.dirname, "..", "..");
const temporaryRoots: string[] = [];
afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

const PUBLISHER = {
  commit: "c".repeat(40),
  issuer: "https://token.actions.githubusercontent.com",
  ref: "refs/heads/main",
  repository: "samartomar/aih-catalog",
  workflow: "samartomar/aih-catalog/.github/workflows/signed-catalog-v2.yml",
};
const b64 = (bytes: Buffer) => bytes.toString("base64");

/** What Core's T5 writes for one staged entry (catalogQualificationDraftDataV1), canonical plus a newline. */
function draftFor(directory: string): string {
  const read = (name: string) => readFileSync(join(directory, name));
  const receiptBytes = read("receipt.json");
  const receiptSetBytes = read("receipt-set.json");
  const memberBytes = read("member.json");
  const closureBytes = read("closure.json");
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  const member = JSON.parse(memberBytes.toString("utf8"));
  const closure = JSON.parse(closureBytes.toString("utf8"));
  const asset = {
    assetId: closure.assetId,
    contentDigest: `sha256:${sha(closure.assetId)}`,
    sourceId: closure.sourceId ?? "source:npm",
    sourceRevisionId: "0123456789abcdef0123456789abcdef01234567",
  };
  const binding = {
    asset,
    compiler: {
      id: "pinned-component-collection",
      inputFormat: "pinned-component-collection/v1",
      version: "1",
    },
    format: "aih-compiler-qualification-binding",
    material: { files: [], kind: "source-files" },
    sourceContentDigest: `sha256:${"1".repeat(64)}`,
    subject: receipt.subject,
    version: 1,
  };
  const summary = {
    ...asset,
    catalogDigest: receipt.qualificationBasis.catalogDigest,
    catalogHeadDigest: receipt.qualificationBasis.catalogHeadDigest,
    catalogMemberDigest: receipt.qualificationBasis.catalogMemberDigest,
    closureDigest: `sha256:${sha(closureBytes)}`,
    compilerBindingDigest: digest("aih-compiler-qualification-binding/v1", binding),
    contextDigest: `sha256:${"2".repeat(64)}`,
    notBefore: receipt.notBefore,
    originalIssuedAt: receipt.issuedAt,
    projectionVersion: "catalog-qualification-summary/v1",
    publisher: PUBLISHER,
    receiptDigest: `sha256:${sha(receiptBytes)}`,
    receiptSetDigest: `sha256:${sha(receiptSetBytes)}`,
    scope: { description: "Exact files.", kind: "source-files" },
    sourceContentDigest: binding.sourceContentDigest,
    state: "qualified",
    subjectDigest: receipt.subject.subjectDigest,
    validUntil: receipt.expiresAt,
    verifiedAt: "2026-08-22T12:00:00Z",
  };
  return `${canonical({
    bindings: [binding],
    projections: [{ [asset.assetId]: summary }],
    records: [
      {
        closureBytesByIdentityBase64: { [member.closure.identity]: b64(closureBytes) },
        memberBytesBase64: b64(memberBytes),
        publisher: { ...PUBLISHER, subjectName: `${receipt.entryId}.json` },
        receiptBytesBase64: b64(receiptBytes),
        receiptSetBytesBase64: b64(receiptSetBytes),
        receiptSetPublisher: { ...PUBLISHER, subjectName: "qualification-receipt-set.json" },
      },
    ],
    version: 1,
  })}\n`;
}

/**
 * A signed run over four seeds, its index, its T5 input directories, and T5 drafts for three of
 * them (the npm row has none), in per-provider directories next to a candidate Catalog use record.
 */
async function fixture() {
  const run = signedCatalogRunFixture(temporaryRoots);
  writeFileSync(
    join(run.catalogRoot, "package.json"),
    JSON.stringify({ name: "@aihq/catalog", version: "0.0.0" }),
  );
  const index = await indexGenerator();
  writeFileSync(
    join(run.catalogRoot, "defaults", "catalog-index-v1.json"),
    index.serializeCatalogIndex(index.generateCatalogIndex(run.catalogRoot)),
  );
  const { groups } = (await stager()).stageCatalogQualificationInputsV1(run);
  const draftsDirectory = join(run.outputRoot, "..", "drafts");
  for (const [group, entryIds] of Object.entries(groups)) {
    if (group === "_unsourced") continue;
    mkdirSync(join(draftsDirectory, group), { recursive: true });
    for (const entryId of entryIds) {
      const target = join(draftsDirectory, group, `qual-${entryId}.json`);
      writeFileSync(target, draftFor(join(run.outputRoot, group, entryId)));
      writeFileSync(`${target}.candidate-catalog.json`, "{}\n");
    }
  }
  const outputPath = join(run.outputRoot, "..", "core-qualification-data-v1.json");
  writeFileSync(outputPath, "previous\n");
  return {
    ...run,
    signedCatalogPath: join(run.runDirectory, "signed-catalog-v2.json"),
    draftsDirectory,
    outputPath,
  };
}

/** Rewrites one fixture draft (canonical plus a newline) through `change`. */
function rewrite(draftsDirectory: string, name: string, change: (draft: Json) => void) {
  const path = join(draftsDirectory, ...name.split("/"));
  const draft = JSON.parse(readFileSync(path, "utf8")) as Json;
  change(draft);
  writeFileSync(path, `${canonical(draft)}\n`);
}
const firstRecord = (draft: Json) => (draft.records as Json[])[0] as Json;
const firstSummary = (draft: Json) =>
  Object.values((draft.projections as Json[])[0] as Json)[0] as Json;

describe("merging Core T5 drafts into the core qualification data", () => {
  it("writes one exact, sorted, canonical version-2 file from the drafts and names head entries without one", async () => {
    const tool = await merger();
    const item = await fixture();
    const result = tool.mergeCoreQualificationDraftsV1(item);
    expect(result).toEqual({
      records: 3,
      sequence: 0,
      catalogHeadSha256: item.head.catalogHeadSha256,
      receiptSetSha256: sha(
        readFileSync(join(item.runDirectory, "qualification-receipt-set.json")),
      ),
      withoutDraft: ["tool.npm.picocolors"],
      candidateCatalogUseRecords: 3,
    });
    const text = readFileSync(item.outputPath, "utf8");
    const data = JSON.parse(text) as {
      artifacts: Record<string, string>;
      records: { receipt: string; publisher: { subjectName: string } }[];
      bindings: { asset: { assetId: string } }[];
      projections: Record<string, unknown>[];
    };
    expect(text).toBe(`${canonical(data)}\n`);
    expect(() => parseCoreQualificationDataV1(data)).not.toThrow();
    expect(data.records.map((record) => record.publisher.subjectName)).toEqual([
      "skill.anthropic.canvas.json",
      "skill.mattpocock.alpha.json",
      "skill.mattpocock.beta.json",
    ]);
    // Bindings follow their records; the one projection holds every summary.
    expect(data.bindings.map((binding) => binding.asset.assetId)).toEqual([
      "source:anthropics-skills/canvas",
      "source:mattpocock/alpha",
      "source:mattpocock/beta",
    ]);
    expect(Object.keys(data.projections[0] as Json)).toEqual(
      data.bindings.map((binding) => binding.asset.assetId),
    );
    // Content addressing loses nothing: expanding gives back every draft's exact record.
    const expanded = tool.expandCoreQualificationDataV2(data as unknown as Json) as {
      records: Json[];
    };
    const drafts = ["anthropics-skills/qual-skill.anthropic.canvas.json"].map(
      (path) => JSON.parse(readFileSync(join(item.draftsDirectory, path), "utf8")).records[0],
    );
    expect(expanded.records[0]).toEqual(drafts[0]);
    // The shared receipt set is stored once.
    expect(new Set(Object.keys(data.artifacts)).size).toBe(Object.keys(data.artifacts).length);
    expect(Object.keys(data.artifacts)).toHaveLength(1 + 3 * 3);
  });

  it("refuses duplicates, entries absent from the signed head, a subject other than the index entry's, and a non-canonical draft, writing nothing", async () => {
    const tool = await merger();
    const duplicate = await fixture();
    writeFileSync(
      join(duplicate.draftsDirectory, "copy.json"),
      readFileSync(
        join(duplicate.draftsDirectory, "mattpocock", "qual-skill.mattpocock.alpha.json"),
      ),
    );
    expect(() => tool.mergeCoreQualificationDraftsV1(duplicate)).toThrow(
      "core-qualification-drafts:duplicate skill.mattpocock.alpha",
    );
    expect(readFileSync(duplicate.outputPath, "utf8")).toBe("previous\n");

    // Drafts of one run against the head of another run that has no beta row.
    const absent = await fixture();
    const other = signedCatalogRunFixture(
      temporaryRoots,
      ROWS.filter((row) => row.entryId !== "skill.mattpocock.beta"),
    );
    expect(() =>
      tool.mergeCoreQualificationDraftsV1({
        ...absent,
        signedCatalogPath: join(other.runDirectory, "signed-catalog-v2.json"),
      }),
    ).toThrow(/skill\.mattpocock\.beta \(absent-from-head\)/);

    const subject = await fixture();
    const indexPath = join(subject.catalogRoot, "defaults", "catalog-index-v1.json");
    const index = JSON.parse(readFileSync(indexPath, "utf8"));
    const alpha = index.entries.find((entry: Json) => entry.entryId === "skill.mattpocock.alpha");
    alpha.subject.subjectDigest = `sha256:${"0".repeat(64)}`;
    writeFileSync(indexPath, `${canonical(index)}\n`);
    expect(() => tool.mergeCoreQualificationDraftsV1(subject)).toThrow(
      "core-qualification-drafts:unmatched skill.mattpocock.alpha (index-subject)",
    );
    expect(readFileSync(subject.outputPath, "utf8")).toBe("previous\n");

    const noncanonical = await fixture();
    const path = join(
      noncanonical.draftsDirectory,
      "mattpocock",
      "qual-skill.mattpocock.beta.json",
    );
    writeFileSync(path, `${JSON.stringify(JSON.parse(readFileSync(path, "utf8")), null, 2)}\n`);
    expect(() => tool.mergeCoreQualificationDraftsV1(noncanonical)).toThrow(
      "core-qualification-drafts:draft mattpocock/qual-skill.mattpocock.beta.json is not canonical",
    );
  });

  it("refuses a summary publisher or receipt-set publisher that does not join its record, writing nothing", async () => {
    const tool = await merger();
    const item = await fixture();
    // Core's summary publisher is exactly five fields (contracts.ts); a subject name there,
    // here another entry's, does not join the record publisher.
    rewrite(item.draftsDirectory, "mattpocock/qual-skill.mattpocock.alpha.json", (draft) => {
      firstSummary(draft).publisher = { ...PUBLISHER, subjectName: "skill.mattpocock.beta.json" };
    });
    // A receipt-set publisher that is not Core's publisher shape.
    rewrite(item.draftsDirectory, "mattpocock/qual-skill.mattpocock.beta.json", (draft) => {
      firstRecord(draft).receiptSetPublisher = { garbage: true };
    });
    // A well-formed receipt-set publisher from another commit than the receipt's.
    rewrite(item.draftsDirectory, "anthropics-skills/qual-skill.anthropic.canvas.json", (draft) => {
      firstRecord(draft).receiptSetPublisher = {
        ...PUBLISHER,
        commit: "d".repeat(40),
        subjectName: "qualification-receipt-set.json",
      };
    });
    expect(() => tool.mergeCoreQualificationDraftsV1(item)).toThrow(
      "core-qualification-drafts:unmatched skill.anthropic.canvas (receipt-set-publisher); skill.mattpocock.alpha (publisher); skill.mattpocock.beta (receipt-set-publisher)",
    );
    expect(readFileSync(item.outputPath, "utf8")).toBe("previous\n");
  });

  it("refuses an unreadable, oversized or malformed signed catalog or index with a typed message", async () => {
    const tool = await merger();
    const item = await fixture();
    const indexPath = join(item.catalogRoot, "defaults", "catalog-index-v1.json");
    const cases: [string, string, string | Buffer | undefined][] = [
      [item.signedCatalogPath, "signed-catalog unreadable", undefined],
      [item.signedCatalogPath, "signed-catalog unreadable", Buffer.alloc(16 * 1024 * 1024 + 1)],
      [
        item.signedCatalogPath,
        "signed-catalog (catalog-qualification-inputs:signed-catalog json)",
        "{",
      ],
      [indexPath, "index unreadable", undefined],
      [indexPath, "index json", "{"],
      [indexPath, "index", canonical({ entries: {} })],
      [indexPath, "index", canonical({ entries: [{ entryId: 7 }] })],
    ];
    for (const [path, message, bytes] of cases) {
      const saved = readFileSync(path);
      if (bytes === undefined) rmSync(path);
      else writeFileSync(path, bytes);
      expect(() => tool.mergeCoreQualificationDraftsV1(item)).toThrow(
        new TypeError(`core-qualification-drafts:${message}`),
      );
      writeFileSync(path, saved);
    }
    expect(readFileSync(item.outputPath, "utf8")).toBe("previous\n");
  });

  it("refuses, naming it, a temporary file a killed run left beside the output", async () => {
    const tool = await merger();
    const item = await fixture();
    writeFileSync(`${item.outputPath}.tmp`, "partial");
    expect(() => tool.mergeCoreQualificationDraftsV1(item)).toThrow(
      new TypeError(`core-qualification-drafts:leftover-temporary ${item.outputPath}.tmp`),
    );
    expect(readFileSync(item.outputPath, "utf8")).toBe("previous\n");
    expect(readFileSync(`${item.outputPath}.tmp`, "utf8")).toBe("partial");
  });

  it("encodes version 2 exactly as the committed Core data does", async () => {
    const tool = await merger();
    const committed = readFileSync(
      join(repository, "src", "production", "data", "core-qualification-data-v1.json"),
      "utf8",
    );
    const expanded = tool.expandCoreQualificationDataV2(JSON.parse(committed));
    expect((expanded.records as unknown[]).length).toBe(429);
    expect(tool.encodeCoreQualificationDataV2(expanded)).toBe(committed);
  });

  it("prunes orphaned compact artifacts only through an explicit maintenance step", async () => {
    const tool = await merger();
    const committed = readFileSync(
      join(repository, "src", "production", "data", "core-qualification-data-v1.json"),
      "utf8",
    );
    const data = JSON.parse(committed) as Json & { artifacts: Record<string, string> };
    const orphan = Buffer.from("removed current row");
    data.artifacts[sha(orphan)] = b64(orphan);
    expect(() => tool.expandCoreQualificationDataV2(data)).toThrow("unreferenced artifact");
    expect(tool.pruneUnreferencedCoreQualificationArtifactsV2(data)).toBe(committed);
  });

  it("refuses absent and malformed compact artifacts before pruning", async () => {
    const tool = await merger();
    const committed = readFileSync(
      join(repository, "src", "production", "data", "core-qualification-data-v1.json"),
      "utf8",
    );
    const base = JSON.parse(committed) as Json & { artifacts: Record<string, string>; records: Json[] };
    const absent = structuredClone(base);
    const first = absent.records[0];
    if (first === undefined) throw new Error("committed qualification has no records");
    first.receipt = "0".repeat(64);
    expect(() => tool.pruneUnreferencedCoreQualificationArtifactsV2(absent)).toThrow("absent artifact");

    const malformed = structuredClone(base);
    const address = Object.keys(malformed.artifacts)[0];
    if (address === undefined) throw new Error("committed qualification has no artifacts");
    malformed.artifacts[address] = "not canonical base64";
    expect(() => tool.pruneUnreferencedCoreQualificationArtifactsV2(malformed)).toThrow(`artifact ${address}`);
  });
});
