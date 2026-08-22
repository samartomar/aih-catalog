import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const coreCommit = "e27a55dcebb635c8298aa4fd6fd871f59089bcf7";
const schemaSha256 = "27295aee8d8be333abe2c73adc72884b534b1c9980a9b7a39d12be8d34c5caff";

const sha = (label: string): string => createHash("sha256").update(label).digest("hex");

type CatalogHeadV2 = Readonly<Record<string, unknown>>;
type SignedCatalogV2 = Readonly<Record<string, unknown>>;

type SignedCatalogV2Api = Readonly<{
  readonly STRICT_V2_CORE_LOCK: Readonly<{
    readonly coreCommit: string;
    readonly schemaSha256: string;
  }>;
  createCatalogHeadV2: (value: unknown) => CatalogHeadV2;
  canonicalCatalogHeadV2Bytes: (value: unknown) => Buffer;
  parseCatalogHeadV2Json: (text: string) => CatalogHeadV2;
  signCatalogHeadV2: (value: unknown) => SignedCatalogV2;
  verifySignedCatalogV2: (value: unknown) => CatalogHeadV2;
  inspectSignedCatalogV2: (
    value: unknown,
  ) =>
    | Readonly<{ readonly kind: "materializable"; readonly head: CatalogHeadV2 }>
    | Readonly<{ readonly kind: "unsupported-version"; readonly record: SignedCatalogV2 }>;
  planCatalogPromotionV2: (
    value: unknown,
  ) =>
    | Readonly<{ readonly kind: "candidate"; readonly head: CatalogHeadV2 }>
    | Readonly<{ readonly kind: "last-good"; readonly head: CatalogHeadV2 }>;
}>;

async function api(): Promise<SignedCatalogV2Api> {
  return (await import("../../src/index.js")) as SignedCatalogV2Api;
}

function catalogHeadInput(): Record<string, unknown> {
  return {
    catalog: {
      entries: [
        {
          closure: { identity: "closure:default", sha256: sha("closure:default") },
          entryId: "recipe.default",
          evidence: [
            { identity: "evidence:recipe", sha256: sha("evidence:recipe") },
            { identity: "evidence:profile", sha256: sha("evidence:profile") },
          ],
          profile: { identity: "profile:default", sha256: sha("profile:default") },
          prose: { identity: "prose:default", sha256: sha("prose:default") },
          recipe: { identity: "recipe:default", sha256: sha("recipe:default") },
        },
        {
          closure: { identity: "closure:alpha", sha256: sha("closure:alpha") },
          entryId: "Recipe.Alpha",
          evidence: [{ identity: "evidence:alpha", sha256: sha("evidence:alpha") }],
          profile: { identity: "profile:alpha", sha256: sha("profile:alpha") },
          prose: { identity: "prose:alpha", sha256: sha("prose:alpha") },
          recipe: { identity: "recipe:alpha", sha256: sha("recipe:alpha") },
        },
      ],
      schemaVersion: "2",
    },
    claims: {
      github: {
        environment: "catalog-signing",
        issuer: "https://token.actions.githubusercontent.com",
        ref: "refs/heads/main",
        repository: "samartomar/aih-supported",
        run: {
          attempt: 1,
          id: "123456789",
          workflowSha256: sha("workflow"),
        },
        workflow: ".github/workflows/signed-catalog-v2.yml",
      },
    },
    compatibleEffectVersions: ["2"],
    compatibleSchemaVersions: ["2"],
    effectVersion: "2",
    previousCatalogHeadSha256: sha("predecessor"),
    protocol: "CatalogHeadV2",
    schemaVersion: "2",
    sequence: 7,
    signer: {
      identity: "signer:github-actions/catalog-v2",
      keyClass: "ed25519",
      publicKeySpkiSha256: sha("signer-spki"),
    },
    validFrom: "2026-08-22T00:00:00Z",
    validUntil: "2026-08-23T00:00:00Z",
  };
}

function withGithubClaim(
  input: Record<string, unknown>,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  const github = (input.claims as { github: Record<string, unknown> }).github;
  return { ...input, claims: { github: { ...github, ...changes } } };
}

function withSigner(
  input: Record<string, unknown>,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  return { ...input, signer: { ...(input.signer as object), ...changes } };
}

function withDefaultProseDigest(
  input: Record<string, unknown>,
  digest: string,
): Record<string, unknown> {
  const catalog = input.catalog as { entries: readonly Record<string, unknown>[] };
  return {
    ...input,
    catalog: {
      ...catalog,
      entries: catalog.entries.map((entry) =>
        entry.entryId === "recipe.default"
          ? { ...entry, prose: { ...(entry.prose as object), sha256: digest } }
          : entry,
      ),
    },
  };
}

describe("public signed catalog V2 acceptance contract", () => {
  it("exposes the Core-locked V2 API from the package entrypoint", async () => {
    const publicApi = await api();

    expect(publicApi.STRICT_V2_CORE_LOCK).toEqual({ coreCommit, schemaSha256 });
    for (const operation of [
      "createCatalogHeadV2",
      "canonicalCatalogHeadV2Bytes",
      "parseCatalogHeadV2Json",
      "signCatalogHeadV2",
      "verifySignedCatalogV2",
      "inspectSignedCatalogV2",
      "planCatalogPromotionV2",
    ] as const)
      expect(publicApi[operation]).toBeTypeOf("function");
  });

  it("creates a deterministic predecessor-bound head with closed, code-unit-sorted entries", async () => {
    const publicApi = await api();
    const head = publicApi.createCatalogHeadV2(catalogHeadInput());

    expect(head).toMatchObject({
      effectVersion: "2",
      previousCatalogHeadSha256: sha("predecessor"),
      protocol: "CatalogHeadV2",
      schemaVersion: "2",
    });
    expect(
      (head.catalog as { entries: readonly { entryId: string }[] }).entries.map(
        (entry) => entry.entryId,
      ),
    ).toEqual(["Recipe.Alpha", "recipe.default"]);
    expect(publicApi.canonicalCatalogHeadV2Bytes(head)).toEqual(
      publicApi.canonicalCatalogHeadV2Bytes(head),
    );
    expect(
      publicApi.parseCatalogHeadV2Json(
        publicApi.canonicalCatalogHeadV2Bytes(head).toString("utf8"),
      ),
    ).toEqual(head);

    for (const changed of [
      { ...catalogHeadInput(), previousCatalogHeadSha256: sha("other-predecessor") },
      withGithubClaim(catalogHeadInput(), { ref: "refs/tags/v2" }),
      withSigner(catalogHeadInput(), { publicKeySpkiSha256: sha("rotated") }),
    ])
      expect(
        (publicApi.createCatalogHeadV2(changed).catalogHeadSha256 as string) !==
          (head.catalogHeadSha256 as string),
      ).toBe(true);
    expect(() =>
      publicApi.createCatalogHeadV2({
        ...catalogHeadInput(),
        catalog: {
          ...(catalogHeadInput().catalog as object),
          entries: [{ entryId: "recipe.default" }],
        },
      }),
    ).toThrow();
  });

  it("uses one Ed25519 DSSE PAE signature, enforces exact trust claims, and retains unsupported versions as non-materializable", async () => {
    const publicApi = await api();
    const head = publicApi.createCatalogHeadV2(catalogHeadInput());
    const signed = publicApi.signCatalogHeadV2({
      head,
      signer: {
        identity: "signer:github-actions/catalog-v2",
        keyClass: "ed25519",
        privateKey: "test-only-key-handle",
        publicKeySpkiSha256: sha("signer-spki"),
      },
      signCanonicalPae: (paeBytes: Buffer) => Buffer.from(sha(paeBytes.toString("hex")), "hex"),
    });

    expect(signed).toMatchObject({
      envelope: { payloadType: "application/vnd.in-toto+json" },
    });
    expect((signed.envelope as { signatures: readonly unknown[] }).signatures).toHaveLength(1);
    expect(
      publicApi.verifySignedCatalogV2({
        expectedClaims: catalogHeadInput().claims,
        expectedSigner: catalogHeadInput().signer,
        now: "2026-08-22T12:00:00Z",
        signed,
      }),
    ).toEqual(head);
    expect(() =>
      publicApi.verifySignedCatalogV2({
        expectedClaims: withGithubClaim(catalogHeadInput(), { environment: "other" }).claims,
        expectedSigner: catalogHeadInput().signer,
        now: "2026-08-22T12:00:00Z",
        signed,
      }),
    ).toThrow();
    expect(
      publicApi.inspectSignedCatalogV2({
        ...signed,
        head: { ...head, effectVersion: "999", schemaVersion: "999" },
      }),
    ).toMatchObject({ kind: "unsupported-version" });
  });

  it("only preserves last-good for a byte-equivalent candidate and does not give candidates signing or write authority", async () => {
    const publicApi = await api();
    const lastGood = publicApi.createCatalogHeadV2(catalogHeadInput());
    const candidate = publicApi.createCatalogHeadV2(catalogHeadInput());

    expect(
      publicApi.planCatalogPromotionV2({ candidate, lastGood, now: "2026-08-22T12:00:00Z" }),
    ).toEqual({ head: lastGood, kind: "last-good" });
    for (const changed of [
      { ...catalogHeadInput(), validUntil: "2026-08-24T00:00:00Z" },
      withDefaultProseDigest(catalogHeadInput(), sha("prose:changed")),
      withGithubClaim(catalogHeadInput(), {
        run: { attempt: 2, id: "123456789", workflowSha256: sha("workflow") },
      }),
      withSigner(catalogHeadInput(), { identity: "signer:rotated" }),
    ])
      expect(
        publicApi.planCatalogPromotionV2({
          candidate: publicApi.createCatalogHeadV2(changed),
          lastGood,
          now: "2026-08-22T12:00:00Z",
        }),
      ).toMatchObject({ kind: "candidate" });
    expect(() =>
      publicApi.signCatalogHeadV2({ candidate, writeCatalog: () => undefined }),
    ).toThrow();
  });

  it("declares a never-triggered OIDC/keyless publication workflow and independently verifies one default evidence chain in CI", () => {
    const packageJson = readFileSync(resolve(root, "package.json"), "utf8");
    const workflow = readFileSync(
      resolve(root, ".github", "workflows", "signed-catalog-v2.yml"),
      "utf8",
    );

    expect(packageJson).toContain('"bin"');
    expect(workflow).toMatch(/permissions:[\s\S]*id-token:\s*write/);
    expect(workflow).toMatch(/workflow_dispatch/);
    expect(workflow).toMatch(/if:\s*\$\{\{\s*false\s*\}\}/);
    expect(workflow).not.toMatch(/\b(release|publish|create-release|git tag)\b/i);
    expect(workflow).toMatch(/verify.*default.*evidence.*chain/i);
  });
});
