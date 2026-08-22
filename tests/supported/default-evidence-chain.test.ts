import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function canonicalJson(value: Json): string {
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as Json)}`)
    .join(",")}}`;
}

const domainDigest = (domain: string, value: Json) =>
  `sha256:${sha256(`${domain}\0${canonicalJson(value)}`)}`;

describe("default CatalogHead V2 evidence chain", () => {
  it("uses public V2 creation and basis APIs to bind default artifact bytes", async () => {
    const seedPath = resolve(root, "defaults", "default-catalog-v2.json");
    expect(existsSync(seedPath)).toBe(true);
    const seed = JSON.parse(readFileSync(seedPath, "utf8")) as {
      artifacts: Record<"profile" | "recipe" | "closure" | "prose", string>;
      entryId: string;
      subject: { id: string; kind: "profile" };
    };
    const artifactDigests = Object.fromEntries(
      Object.entries(seed.artifacts).map(([kind, relativePath]) => [
        kind,
        sha256(readFileSync(resolve(dirname(seedPath), relativePath))),
      ]),
    );
    const { publicKey } = generateKeyPairSync("ed25519");
    const spkiSha256 = sha256(publicKey.export({ format: "der", type: "spki" }));
    const signer = {
      class: "administrator-ed25519",
      identity: "administrator:aih-supported/catalog-v2",
      keyId: `ed25519:${spkiSha256}`,
      publicKeySpkiSha256: spkiSha256,
    };
    const source = { release: "1.0.0", revision: `sha256:${artifactDigests.profile}`, type: "aih" };
    const sourceDigest = domainDigest("aih-governance-decision-source/v2", source);
    const subject = {
      id: seed.subject.id,
      kind: seed.subject.kind,
      source,
      sourceDigest,
      subjectDigest: domainDigest("aih-governance-decision-subject/v2", {
        id: seed.subject.id,
        kind: seed.subject.kind,
        sourceDigest,
      }),
    };
    const api = (await import("../../src/index.js")) as {
      createCatalogHeadV2(value: unknown): Record<string, unknown>;
      deriveQualificationBasisV2(value: unknown): Record<string, unknown>;
    };
    const head = api.createCatalogHeadV2({
      claims: {
        environment: "catalog-signing",
        eventName: "workflow_dispatch",
        issuer: "https://token.actions.githubusercontent.com",
        jobWorkflowRef:
          "samartomar/aih-supported/.github/workflows/signed-catalog-v2.yml@refs/heads/main",
        ref: "refs/heads/main",
        repository: "samartomar/aih-supported",
        repositoryId: "987654321",
        repositoryOwnerId: "123456789",
      },
      compatibleEffectVersions: ["2"],
      compatibleSchemaVersions: ["2"],
      effectVersion: "2",
      entries: [
        {
          capabilities: {
            commands: ["catalog.verify"],
            egress: ["https://api.github.com"],
            hooks: ["hook.catalog.verify"],
            mcpTools: ["github.get_workflow_run"],
            permissions: ["contents:read"],
          },
          closure: {
            identity: `artifact:${seed.artifacts.closure}`,
            sha256: artifactDigests.closure,
          },
          entryId: seed.entryId,
          platforms: [{ architecture: "amd64", os: "linux" }],
          prose: { identity: `artifact:${seed.artifacts.prose}`, sha256: artifactDigests.prose },
          qualification: {
            findings: [{ identity: "finding:clean", sha256: sha256("finding:clean") }],
            gaps: [{ identity: "gap:none", sha256: sha256("gap:none") }],
            rights: [{ identity: "right:catalog.read", sha256: sha256("right:catalog.read") }],
          },
          recipe: { identity: `artifact:${seed.artifacts.recipe}`, sha256: artifactDigests.recipe },
          subject,
          versions: { effect: "2", schema: "2" },
        },
      ],
      previousCatalogHeadSha256: "0".repeat(64),
      protocol: "CatalogHeadV2",
      schemaVersion: "2",
      sequence: 0,
      signer,
      validFrom: "2026-08-22T00:00:00Z",
      validUntil: "2026-08-23T00:00:00Z",
    });
    const entry = (head.entries as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      closure: { identity: `artifact:${seed.artifacts.closure}`, sha256: artifactDigests.closure },
      prose: { identity: `artifact:${seed.artifacts.prose}`, sha256: artifactDigests.prose },
      recipe: { identity: `artifact:${seed.artifacts.recipe}`, sha256: artifactDigests.recipe },
      subject: { source },
    });
    const qualificationBasis = api.deriveQualificationBasisV2({ entryId: seed.entryId, head });
    const verificationMode = "cold-external-admin";
    expect(qualificationBasis).toMatchObject({ kind: "aih-supported", subjectKind: "profile" });
    expect(verificationMode).toBe("cold-external-admin");
  });
});
