import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const coreCommit = "e27a55dcebb635c8298aa4fd6fd871f59089bcf7";
const schemaSha256 = "27295aee8d8be333abe2c73adc72884b534b1c9980a9b7a39d12be8d34c5caff";
const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

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
  planCatalogPromotionV2: (value: unknown) =>
    | Readonly<{ readonly kind: "promoted"; readonly head: CatalogHeadV2 }>
    | Readonly<{ readonly kind: "unchanged"; readonly head: CatalogHeadV2 }>
    | Readonly<{
        readonly facts: readonly Readonly<{
          readonly identity: string;
          readonly surface: string;
        }>[];
        readonly head: CatalogHeadV2;
        readonly kind: "last-good";
      }>;
}>;

type SigningFixture = Readonly<{
  readonly administratorRoot: Readonly<Record<string, unknown>>;
  readonly signer: Readonly<Record<string, unknown>>;
}>;

async function api(): Promise<SignedCatalogV2Api> {
  return (await import("../../src/index.js")) as SignedCatalogV2Api;
}

function signingFixture(): SigningFixture {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spkiDer = publicKey.export({ format: "der", type: "spki" });
  const publicKeySpkiSha256 = sha(spkiDer);
  const keyId = `ed25519:${publicKeySpkiSha256}`;
  const identity = "administrator:aih-supported/catalog-v2";
  const keyClass = "administrator-ed25519";
  const publicKeySpkiDerBase64 = spkiDer.toString("base64");
  return {
    administratorRoot: {
      identity,
      keyClass,
      keyId,
      publicKeySpkiDerBase64,
      publicKeySpkiSha256,
    },
    signer: { identity, keyClass, keyId, privateKey, publicKey, publicKeySpkiSha256 },
  };
}

function evidence(identity: string): Readonly<Record<string, unknown>> {
  return { identity, sha256: sha(identity) };
}

function catalogHeadInput(
  signer: Readonly<Record<string, unknown>>,
  versions: Readonly<{ effectVersion?: string; schemaVersion?: string }> = {},
): Record<string, unknown> {
  const effectVersion = versions.effectVersion ?? "2";
  const schemaVersion = versions.schemaVersion ?? "2";
  return {
    catalog: {
      entries: [
        {
          capabilities: {
            commands: ["catalog.verify"],
            egress: ["https://api.github.com"],
            hooks: ["hook.catalog.verify"],
            mcpTools: ["github.get_workflow_run"],
            permissions: ["contents:read"],
          },
          closure: evidence("closure:default"),
          entryId: "recipe.default",
          evidence: [
            evidence("command:catalog.verify"),
            evidence("effect:2"),
            evidence("egress:https://api.github.com"),
            evidence("finding:clean"),
            evidence("gap:none"),
            evidence("hook:catalog.verify"),
            evidence("mcp-tool:github.get_workflow_run"),
            evidence("permission:contents:read"),
            evidence("platform:linux/amd64"),
            evidence("prose:default"),
            evidence("recipe:default"),
            evidence("right:catalog.read"),
            evidence("schema:2"),
          ],
          platforms: [{ architecture: "amd64", os: "linux" }],
          profile: evidence("profile:default"),
          prose: evidence("prose:default"),
          qualification: {
            findings: [evidence("finding:clean")],
            gaps: [evidence("gap:none")],
            rights: [evidence("right:catalog.read")],
          },
          recipe: evidence("recipe:default"),
          subject: {
            commitSha256: sha("subject:default:commit"),
            identity: "subject:github.com/samartomar/aih-supported/default",
            repository: "github.com/samartomar/aih-supported",
          },
          versions: { effectVersion, schemaVersion },
        },
        {
          capabilities: {
            commands: ["catalog.verify"],
            egress: ["https://api.github.com"],
            hooks: ["hook.catalog.verify"],
            mcpTools: ["github.get_workflow_run"],
            permissions: ["contents:read"],
          },
          closure: evidence("closure:alpha"),
          entryId: "Recipe.Alpha",
          evidence: [
            evidence("command:catalog.verify"),
            evidence("effect:2"),
            evidence("egress:https://api.github.com"),
            evidence("finding:alpha"),
            evidence("gap:none"),
            evidence("hook:catalog.verify"),
            evidence("mcp-tool:github.get_workflow_run"),
            evidence("permission:contents:read"),
            evidence("platform:linux/amd64"),
            evidence("prose:alpha"),
            evidence("recipe:alpha"),
            evidence("right:catalog.read"),
            evidence("schema:2"),
          ],
          platforms: [{ architecture: "amd64", os: "linux" }],
          profile: evidence("profile:alpha"),
          prose: evidence("prose:alpha"),
          qualification: {
            findings: [evidence("finding:alpha")],
            gaps: [evidence("gap:none")],
            rights: [evidence("right:catalog.read")],
          },
          recipe: evidence("recipe:alpha"),
          subject: {
            commitSha256: sha("subject:alpha:commit"),
            identity: "subject:github.com/samartomar/aih-supported/alpha",
            repository: "github.com/samartomar/aih-supported",
          },
          versions: { effectVersion, schemaVersion },
        },
      ],
      schemaVersion,
    },
    claims: {
      github: {
        commitSha256: sha("github:commit"),
        environment: "catalog-signing",
        issuer: "https://token.actions.githubusercontent.com",
        ref: "refs/heads/main",
        repository: "samartomar/aih-supported",
        run: { attempt: 1, id: "123456789", workflowSha256: sha("workflow") },
        workflow: ".github/workflows/signed-catalog-v2.yml",
      },
    },
    compatibleEffectVersions: [effectVersion],
    compatibleSchemaVersions: [schemaVersion],
    effectVersion,
    previousCatalogHeadSha256: sha("predecessor"),
    protocol: "CatalogHeadV2",
    schemaVersion,
    sequence: 7,
    signer: {
      identity: signer.identity,
      keyClass: signer.keyClass,
      keyId: signer.keyId,
      publicKeySpkiSha256: signer.publicKeySpkiSha256,
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

function withEvidenceDigest(
  input: Record<string, unknown>,
  identity: string,
): Record<string, unknown> {
  const catalog = input.catalog as { entries: readonly Record<string, unknown>[] };
  return {
    ...input,
    catalog: {
      ...catalog,
      entries: catalog.entries.map((entry) => {
        if (entry.entryId !== "recipe.default") return entry;
        return {
          ...entry,
          evidence: (entry.evidence as readonly Record<string, unknown>[]).map((item) =>
            item.identity === identity ? { ...item, sha256: sha(`${identity}:changed`) } : item,
          ),
        };
      }),
    },
  };
}

function nextHeadInput(
  lastGood: CatalogHeadV2,
  signer: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    ...catalogHeadInput(signer),
    previousCatalogHeadSha256: lastGood.catalogHeadSha256,
    sequence: (lastGood.sequence as number) + 1,
  };
}

function dssePae(payloadType: string, payload: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `DSSEv1 ${String(Buffer.byteLength(payloadType, "utf8"))} ${payloadType} ${String(payload.length)} `,
      "utf8",
    ),
    payload,
  ]);
}

describe("public signed catalog V2 acceptance contract", () => {
  it("exposes only the Core-locked public V2 package API", async () => {
    const publicApi = await api();
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;

    expect(packageJson.name).toBe("@aihq/supported");
    expect(packageJson.bin).toEqual({ "aih-supported": "dist/cli.js" });
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

  it("binds sorted complete entries, exact GitHub claims, and the predecessor into canonical head bytes", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const head = publicApi.createCatalogHeadV2(catalogHeadInput(fixture.signer));

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
    expect(
      (
        (head.catalog as { entries: readonly { evidence: readonly { identity: string }[] }[] })
          .entries[1]?.evidence ?? []
      ).map((item) => item.identity),
    ).toEqual(
      [
        "command:catalog.verify",
        "effect:2",
        "egress:https://api.github.com",
        "finding:clean",
        "gap:none",
        "hook:catalog.verify",
        "mcp-tool:github.get_workflow_run",
        "permission:contents:read",
        "platform:linux/amd64",
        "prose:default",
        "recipe:default",
        "right:catalog.read",
        "schema:2",
      ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    );
    expect(publicApi.canonicalCatalogHeadV2Bytes(head)).toEqual(
      publicApi.canonicalCatalogHeadV2Bytes(head),
    );
    expect(
      publicApi.parseCatalogHeadV2Json(
        publicApi.canonicalCatalogHeadV2Bytes(head).toString("utf8"),
      ),
    ).toEqual(head);

    for (const changed of [
      { ...catalogHeadInput(fixture.signer), previousCatalogHeadSha256: sha("other-predecessor") },
      withGithubClaim(catalogHeadInput(fixture.signer), { ref: "refs/tags/v2" }),
      withGithubClaim(catalogHeadInput(fixture.signer), { commitSha256: sha("other-commit") }),
      {
        ...catalogHeadInput(fixture.signer),
        signer: { ...fixture.signer, publicKeySpkiSha256: sha("rotated") },
      },
    ])
      expect(publicApi.createCatalogHeadV2(changed).catalogHeadSha256).not.toBe(
        head.catalogHeadSha256,
      );
  });

  it("signs the exact DSSE PAE once with Ed25519 and verifies it against an exact administrator root, claims, freshness, and replay state", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const head = publicApi.createCatalogHeadV2(catalogHeadInput(fixture.signer));
    const signed = publicApi.signCatalogHeadV2({
      head,
      now: "2026-08-22T12:00:00Z",
      signer: fixture.signer,
    });
    const envelope = signed.envelope as {
      payload: string;
      payloadType: string;
      signatures: readonly { keyid: string; sig: string }[];
    };
    const payload = Buffer.from(envelope.payload, "base64");

    expect(envelope.payloadType).toBe("application/vnd.in-toto+json");
    expect(envelope.signatures).toHaveLength(1);
    expect(envelope.signatures[0]?.keyid).toBe(fixture.signer.keyId);
    expect(
      verify(
        null,
        dssePae(envelope.payloadType, payload),
        fixture.signer.publicKey as Parameters<typeof verify>[2],
        Buffer.from(envelope.signatures[0]?.sig ?? "", "base64"),
      ),
    ).toBe(true);
    expect(
      publicApi.verifySignedCatalogV2({
        expectedClaims: catalogHeadInput(fixture.signer).claims,
        now: "2026-08-22T12:00:00Z",
        replay: { seenCatalogHeadSha256: [] },
        signed,
        trustedAdministratorRoots: [fixture.administratorRoot],
      }),
    ).toEqual(head);
    expect(() =>
      publicApi.signCatalogHeadV2({
        candidate: {
          execute: () => {
            throw new Error("candidate must not execute");
          },
        },
        head,
        now: "2026-08-22T12:00:00Z",
        signer: fixture.signer,
      }),
    ).toThrow();
    for (const rejected of [
      {
        expectedClaims: withGithubClaim(catalogHeadInput(fixture.signer), {
          environment: "different-environment",
        }).claims,
        now: "2026-08-22T12:00:00Z",
        replay: { seenCatalogHeadSha256: [] },
        signed,
        trustedAdministratorRoots: [fixture.administratorRoot],
      },
      {
        expectedClaims: catalogHeadInput(fixture.signer).claims,
        now: "2026-08-23T12:00:00Z",
        replay: { seenCatalogHeadSha256: [] },
        signed,
        trustedAdministratorRoots: [fixture.administratorRoot],
      },
      {
        expectedClaims: catalogHeadInput(fixture.signer).claims,
        now: "2026-08-22T12:00:00Z",
        replay: { seenCatalogHeadSha256: [head.catalogHeadSha256] },
        signed,
        trustedAdministratorRoots: [fixture.administratorRoot],
      },
      {
        expectedClaims: catalogHeadInput(fixture.signer).claims,
        now: "2026-08-22T12:00:00Z",
        replay: { seenCatalogHeadSha256: [] },
        signed,
        trustedAdministratorRoots: [
          { ...fixture.administratorRoot, publicKeySpkiSha256: sha("wrong-root") },
        ],
      },
    ])
      expect(() => publicApi.verifySignedCatalogV2(rejected)).toThrow();
  });

  it("keeps an actually signed unknown schema/effect record visible but non-materializable", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const unknownHead = publicApi.createCatalogHeadV2(
      catalogHeadInput(fixture.signer, { effectVersion: "999", schemaVersion: "999" }),
    );
    const signed = publicApi.signCatalogHeadV2({
      head: unknownHead,
      now: "2026-08-22T12:00:00Z",
      signer: fixture.signer,
    });

    expect(
      publicApi.inspectSignedCatalogV2({
        expectedClaims: catalogHeadInput(fixture.signer, {
          effectVersion: "999",
          schemaVersion: "999",
        }).claims,
        now: "2026-08-22T12:00:00Z",
        signed,
        trustedAdministratorRoots: [fixture.administratorRoot],
      }),
    ).toEqual({ kind: "unsupported-version", record: signed });
  });

  it("preserves last-good with factual exception surfaces and only promotes a complete, clean successor", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const lastGood = publicApi.createCatalogHeadV2(catalogHeadInput(fixture.signer));
    const next = publicApi.createCatalogHeadV2(nextHeadInput(lastGood, fixture.signer));

    expect(
      publicApi.planCatalogPromotionV2({
        candidate: { head: next, qualification: { complete: true, exceptions: [] } },
        lastGood,
        now: "2026-08-22T12:00:00Z",
      }),
    ).toEqual({ head: next, kind: "promoted" });
    expect(
      publicApi.planCatalogPromotionV2({
        candidate: { head: lastGood, qualification: { complete: true, exceptions: [] } },
        lastGood,
        now: "2026-08-22T12:00:00Z",
      }),
    ).toEqual({ head: lastGood, kind: "unchanged" });

    for (const surface of [
      "finding",
      "gap",
      "right",
      "signer",
      "closure",
      "command",
      "hook",
      "mcp-tool",
      "egress",
      "permission",
      "effect",
      "schema",
      "platform",
      "recipe",
      "prose",
    ]) {
      const evidenceIdentity = {
        closure: "closure:default",
        command: "command:catalog.verify",
        effect: "effect:2",
        egress: "egress:https://api.github.com",
        finding: "finding:clean",
        gap: "gap:none",
        hook: "hook:catalog.verify",
        "mcp-tool": "mcp-tool:github.get_workflow_run",
        permission: "permission:contents:read",
        platform: "platform:linux/amd64",
        prose: "prose:default",
        recipe: "recipe:default",
        right: "right:catalog.read",
        schema: "schema:2",
        signer: "signer:changed",
      }[surface];
      const candidateHead = publicApi.createCatalogHeadV2(
        surface === "signer"
          ? {
              ...nextHeadInput(lastGood, fixture.signer),
              signer: { ...fixture.signer, keyId: `ed25519:${sha("rotated")}` },
            }
          : withEvidenceDigest(
              nextHeadInput(lastGood, fixture.signer),
              evidenceIdentity ?? surface,
            ),
      );
      expect(
        publicApi.planCatalogPromotionV2({
          candidate: {
            head: candidateHead,
            qualification: {
              complete: false,
              exceptions: [{ identity: `${surface}:changed`, surface }],
            },
          },
          lastGood,
          now: "2026-08-22T12:00:00Z",
        }),
      ).toMatchObject({
        facts: [{ identity: `${surface}:changed`, surface }],
        head: lastGood,
        kind: "last-good",
      });
    }
    expect(() =>
      publicApi.planCatalogPromotionV2({
        candidate: {
          head: next,
          qualification: { complete: true, exceptions: [] },
          sign: () => undefined,
          writeCatalog: () => undefined,
        },
        lastGood,
        now: "2026-08-22T12:00:00Z",
      }),
    ).toThrow();
  });

  it("defines a manual-only exact-SHA-gated OIDC/keyless workflow while normal CI verifies the default evidence chain", () => {
    const packageJson = readFileSync(resolve(root, "package.json"), "utf8");
    const verificationWorkflow = readFileSync(
      resolve(root, ".github", "workflows", "verify.yml"),
      "utf8",
    );
    const publicationWorkflowPath = resolve(root, ".github", "workflows", "signed-catalog-v2.yml");

    expect(packageJson).toContain('"verify:default-evidence-chain"');
    expect(verificationWorkflow).toContain("npm run verify:default-evidence-chain");
    expect(existsSync(publicationWorkflowPath)).toBe(true);
    if (!existsSync(publicationWorkflowPath)) return;
    const workflow = readFileSync(publicationWorkflowPath, "utf8");
    expect(workflow).toMatch(/^on:\s*\n\s*workflow_dispatch:/m);
    expect(workflow).not.toMatch(/^\s*(pull_request|push|schedule):/m);
    expect(workflow).toMatch(/permissions:[\s\S]*id-token:\s*write/);
    expect(workflow).toMatch(/(commit|sha).*(input|required|exact)|input.*(commit|sha)/i);
    expect(workflow).toMatch(/(sigstore|cosign|keyless)/i);
    expect(workflow).not.toMatch(/\b(release|publish|create-release|git tag)\b/i);
    expect(workflow).toMatch(/verify.*default.*evidence.*chain/i);
  });
});
