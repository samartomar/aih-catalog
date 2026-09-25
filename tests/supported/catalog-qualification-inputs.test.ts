import { createHash, generateKeyPairSync } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as api from "../../src/index.js";
import { runCatalogV2Cli } from "../../src/supported/signed-catalog-v2.js";

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

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const item = value as Json;
  return `{${Object.keys(item)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`)
    .join(",")}}`;
};
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const digest = (domain: string, value: unknown) =>
  `sha256:${sha(`${domain}\0${canonical(value)}`)}`;

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

interface Row {
  seedPath: string;
  entryId: string;
  id: string;
  sourceId?: string;
}

const ROWS: Row[] = [
  {
    seedPath: "workbench/anthropic/skill.anthropic.canvas/seed.json",
    entryId: "skill.anthropic.canvas",
    id: "canvas",
    sourceId: "source:anthropics-skills",
  },
  {
    seedPath: "workbench/mattpocock/skill.mattpocock.alpha/seed.json",
    entryId: "skill.mattpocock.alpha",
    id: "alpha",
    sourceId: "source:mattpocock",
  },
  {
    seedPath: "workbench/mattpocock/skill.mattpocock.beta/seed.json",
    entryId: "skill.mattpocock.beta",
    id: "beta",
    sourceId: "source:mattpocock",
  },
  {
    seedPath: "workbench/npm/tool.npm.picocolors/seed.json",
    entryId: "tool.npm.picocolors",
    id: "picocolors",
  },
];

/**
 * A Catalog checkout of four seeds and the artifacts of one signed-catalog-v2 run over it,
 * produced by the Catalog's own CLI steps (generate-candidate, sign, emit-qualification-receipt-set)
 * with a throwaway key.
 */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "aih-catalog-qualification-inputs-"));
  temporaryRoots.push(base);
  const catalogRoot = join(base, "catalog");
  const write = (path: string, text: string | Buffer) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  for (const row of ROWS) {
    const directory = join(catalogRoot, "defaults", dirname(row.seedPath));
    const source = {
      commit: "0123456789abcdef0123456789abcdef01234567",
      path: `skills/${row.id}/SKILL.md`,
      repository: "example/skills",
      type: "github",
    };
    const sourceDigest = digest("aih-governance-decision-source/v2", source);
    const subjectDigest = digest("aih-governance-decision-subject/v2", {
      id: row.id,
      kind: row.entryId.split(".")[0],
      sourceDigest,
    });
    const evidence = (kind: string, id: string) =>
      canonical({
        attestor: "operator:fixture",
        format: "aih-supported-evidence/v2",
        id,
        kind,
        subjectDigest,
        summary: `Synthetic ${kind}.`,
      });
    write(
      join(directory, "artifacts", "closure.json"),
      canonical({
        assetId: `${row.sourceId ?? "npm"}/${row.id}`,
        format: "aih-supported-catalog-member-closure",
        ...(row.sourceId === undefined ? {} : { sourceId: row.sourceId }),
        version: 1,
      }),
    );
    write(join(directory, "artifacts", "profile.json"), canonical({ id: row.id }));
    write(join(directory, "artifacts", "recipe.json"), canonical({ recipe: row.id }));
    write(join(directory, "artifacts", "prose.md"), `Prose for ${row.id}.\n`);
    write(join(directory, "evidence", "report.json"), evidence("report", "report"));
    write(join(directory, "evidence", "right.json"), evidence("right", "right"));
    write(
      join(directory, "seed.json"),
      canonical({
        artifacts: {
          closure: "artifacts/closure.json",
          profile: "artifacts/profile.json",
          prose: "artifacts/prose.md",
          recipe: "artifacts/recipe.json",
        },
        capabilities: { commands: [], egress: [], hooks: [], mcpTools: [], permissions: [] },
        entryId: row.entryId,
        platforms: [{ architecture: "amd64", os: "linux" }],
        qualification: {
          findings: [],
          gaps: [],
          report: "evidence/report.json",
          rights: ["evidence/right.json"],
        },
        subject: { id: row.id, kind: row.entryId.split(".")[0], source },
      }),
    );
  }
  const manifestPath = join(catalogRoot, "defaults", "default-catalog-seed-manifest-v2.json");
  write(
    manifestPath,
    canonical({
      format: "aih-supported-candidate-seed-manifest",
      seeds: ROWS.map((row) => row.seedPath).sort(),
      version: 1,
    }),
  );

  // The run, as .github/workflows/signed-catalog-v2.yml produces it.
  const work = join(base, "work");
  mkdirSync(work);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const signer = {
    class: "administrator-ed25519",
    identity: "administrator:aih-supported/catalog-v2",
    keyId: `ed25519:${sha(spki)}`,
    publicKeySpkiSha256: sha(spki),
  };
  const claims = {
    environment: "catalog-signing",
    eventName: "workflow_dispatch",
    issuer: "https://token.actions.githubusercontent.com",
    jobWorkflowRef:
      "samartomar/aih-catalog/.github/workflows/signed-catalog-v2.yml@refs/heads/main",
    ref: "refs/heads/main",
    repository: "samartomar/aih-catalog",
    repositoryId: "987654321",
    repositoryOwnerId: "123456789",
  };
  write(join(work, "signer.json"), canonical(signer));
  write(join(work, "claims.json"), canonical(claims));
  write(
    join(work, "root.json"),
    canonical({ ...signer, publicKeySpkiDerBase64: spki.toString("base64") }),
  );
  write(join(work, "replay.json"), canonical({ acceptedIdentities: [] }));
  expect(
    runCatalogV2Cli([
      "generate-candidate",
      "--seed-manifest",
      manifestPath,
      "--signer",
      join(work, "signer.json"),
      "--claims",
      join(work, "claims.json"),
      "--valid-from",
      "2026-08-22T00:00:00Z",
      "--valid-until",
      "2026-08-23T00:00:00Z",
      "--sequence",
      "0",
      "--previous-catalog-head-sha256",
      "0".repeat(64),
      "--output",
      join(work, "head.json"),
    ]),
  ).toBe(0);
  const head = JSON.parse(readFileSync(join(work, "head.json"), "utf8"));
  const runDirectory = join(base, "run");
  mkdirSync(join(runDirectory, "receipts"), { recursive: true });
  write(
    join(runDirectory, "signed-catalog-v2.json"),
    canonical(api.signCatalogHeadV2({ head, privateKey })),
  );
  write(join(runDirectory, "promotion-plan.json"), canonical({ kind: "genesis" }));
  expect(
    runCatalogV2Cli([
      "emit-qualification-receipt-set",
      "--signed-catalog",
      join(runDirectory, "signed-catalog-v2.json"),
      "--catalog-signer-root",
      join(work, "root.json"),
      "--expected-claims",
      join(work, "claims.json"),
      "--now",
      "2026-08-22T12:00:00Z",
      "--continuity",
      "genesis",
      "--replay-state",
      join(work, "replay.json"),
      "--output-dir",
      join(runDirectory, "receipts"),
      "--manifest-output",
      join(runDirectory, "qualification-receipt-set.json"),
    ]),
  ).toBe(0);
  return { catalogRoot, runDirectory, outputRoot: join(base, "t5"), api, head };
}

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
