import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect } from "vitest";
import * as api from "../../src/index.js";
import { runCatalogV2Cli } from "../../src/supported/signed-catalog-v2.js";

type Json = Record<string, unknown>;

export const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const item = value as Json;
  return `{${Object.keys(item)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`)
    .join(",")}}`;
};
export const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const digest = (domain: string, value: unknown) =>
  `sha256:${sha(`${domain}\0${canonical(value)}`)}`;

export interface Row {
  seedPath: string;
  entryId: string;
  id: string;
  sourceId?: string;
}

export const ROWS: Row[] = [
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
export function signedCatalogRunFixture(temporaryRoots: string[], rows: readonly Row[] = ROWS) {
  const base = mkdtempSync(join(tmpdir(), "aih-catalog-qualification-inputs-"));
  temporaryRoots.push(base);
  const catalogRoot = join(base, "catalog");
  const write = (path: string, text: string | Buffer) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  for (const row of rows) {
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
      seeds: rows.map((row) => row.seedPath).sort(),
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
