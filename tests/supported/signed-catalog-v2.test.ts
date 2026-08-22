import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const coreRoot = "C:\\dev\\ai-harness";
const coreCommit = "e27a55dcebb635c8298aa4fd6fd871f59089bcf7";
const schemaSha256 = "27295aee8d8be333abe2c73adc72884b534b1c9980a9b7a39d12be8d34c5caff";
const zeroDigest = "0".repeat(64);
const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Head = Readonly<Record<string, unknown>>;
type Signed = Readonly<Record<string, unknown>>;
type Api = Readonly<{
  readonly STRICT_V2_CORE_LOCK: { readonly coreCommit: string; readonly schemaSha256: string };
  createCatalogHeadV2: (value: unknown) => Head;
  canonicalCatalogHeadV2Bytes: (value: unknown) => Buffer;
  parseCatalogHeadV2Json: (value: string) => Head;
  signCatalogHeadV2: (value: unknown) => Signed;
  verifySignedCatalogV2: (value: unknown) => Head;
  inspectSignedCatalogV2: (value: unknown) => unknown;
  planCatalogPromotionV2: (value: unknown) => unknown;
  deriveQualificationBasisV2: (value: unknown) => unknown;
}>;

type Fixture = Readonly<{
  readonly catalogSignerRoot: Readonly<Record<string, unknown>>;
  readonly privateKey: unknown;
  readonly publicKey: unknown;
  readonly signer: Readonly<Record<string, unknown>>;
}>;

async function api(): Promise<Api> {
  return (await import("../../src/index.js")) as Api;
}

function canonicalJson(value: Json): string {
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as Json)}`)
    .join(",")}}`;
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

function signingFixture(): Fixture {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const publicKeySpkiSha256 = sha(spki);
  const signer = {
    class: "administrator-ed25519",
    identity: "administrator:aih-supported/catalog-v2",
    keyId: `ed25519:${publicKeySpkiSha256}`,
    publicKeySpkiSha256,
  };
  return {
    catalogSignerRoot: { ...signer, publicKeySpkiDerBase64: spki.toString("base64") },
    privateKey,
    publicKey,
    signer,
  };
}

function claims(runId = "123456789", runAttempt = 1): Record<string, unknown> {
  return {
    environment: "catalog-signing",
    eventName: "workflow_dispatch",
    issuer: "https://token.actions.githubusercontent.com",
    jobWorkflowRef:
      "samartomar/aih-supported/.github/workflows/signed-catalog-v2.yml@refs/heads/main",
    jobWorkflowSha: "0123456789abcdef0123456789abcdef01234567",
    ref: "refs/heads/main",
    repository: "samartomar/aih-supported",
    repositoryId: "987654321",
    repositoryOwnerId: "123456789",
    runAttempt,
    runId,
    sha: "89abcdef0123456789abcdef0123456789abcdef",
  };
}

function changedClaimValues(): Readonly<Record<string, unknown>> {
  return {
    environment: "different-environment",
    eventName: "push",
    issuer: "https://issuer.invalid",
    jobWorkflowRef: "samartomar/aih-supported/.github/workflows/other.yml@refs/heads/main",
    jobWorkflowSha: "fedcba9876543210fedcba9876543210fedcba98",
    ref: "refs/tags/v2",
    repository: "samartomar/other",
    repositoryId: "111111111",
    repositoryOwnerId: "222222222",
    runAttempt: 2,
    runId: "123456790",
    sha: "fedcba9876543210fedcba9876543210fedcba98",
  };
}

function subject(kind = "profile", id = "default-profile"): Record<string, unknown> {
  return {
    id,
    kind,
    source: {
      commit: "0123456789abcdef0123456789abcdef01234567",
      path: "profiles/default.json",
      repository: "samartomar/aih-supported",
      type: "github",
    },
  };
}

function entry(id = "recipe.default"): Record<string, unknown> {
  return {
    capabilities: {
      commands: ["catalog.verify"],
      egress: ["https://api.github.com"],
      hooks: ["hook.catalog.verify"],
      mcpTools: ["github.get_workflow_run"],
      permissions: ["contents:read"],
    },
    closure: { identity: "closure:default", sha256: sha("closure:default") },
    entryId: id,
    platforms: [{ architecture: "amd64", os: "linux" }],
    prose: { identity: "prose:default", sha256: sha("prose:default") },
    qualification: {
      findings: [{ identity: "finding:clean", sha256: sha("finding:clean") }],
      gaps: [{ identity: "gap:none", sha256: sha("gap:none") }],
      rights: [{ identity: "right:catalog.read", sha256: sha("right:catalog.read") }],
    },
    recipe: { identity: "recipe:default", sha256: sha("recipe:default") },
    subject: subject(),
    versions: { effect: "2", schema: "2" },
  };
}

function headInput(
  signer: Readonly<Record<string, unknown>>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    claims: claims(),
    entries: [
      entry("recipe.default"),
      { ...entry("Recipe.Alpha"), subject: subject("profile", "alpha-profile") },
    ],
    previousCatalogHeadSha256: zeroDigest,
    protocol: "CatalogHeadV2",
    sequence: 0,
    signer,
    validFrom: "2026-08-22T00:00:00Z",
    validUntil: "2026-08-23T00:00:00Z",
    ...overrides,
  };
}

function nextInput(
  lastGood: Head,
  signer: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return headInput(signer, {
    claims: claims("123456790", 2),
    previousCatalogHeadSha256: lastGood.catalogHeadSha256,
    sequence: (lastGood.sequence as number) + 1,
    validFrom: "2026-08-22T01:00:00Z",
    validUntil: "2026-08-24T00:00:00Z",
  });
}

function changedSurface(lastGood: Head, surface: string): Record<string, unknown> {
  const candidate = structuredClone(
    nextInput(lastGood, lastGood.signer as Record<string, unknown>),
  );
  const first = (candidate.entries as Record<string, unknown>[])[0] as Record<string, unknown>;
  const capabilities = first.capabilities as Record<string, string[]>;
  const qualification = first.qualification as Record<string, Record<string, unknown>[]>;
  switch (surface) {
    case "finding":
      qualification.findings = [{ identity: "finding:changed", sha256: sha("finding:changed") }];
      break;
    case "gap":
      qualification.gaps = [{ identity: "gap:changed", sha256: sha("gap:changed") }];
      break;
    case "right":
      qualification.rights = [{ identity: "right:changed", sha256: sha("right:changed") }];
      break;
    case "signer":
      candidate.signer = { ...(candidate.signer as object), identity: "administrator:rotated" };
      break;
    case "closure":
      first.closure = { identity: "closure:changed", sha256: sha("closure:changed") };
      break;
    case "command":
      capabilities.commands = ["catalog.changed"];
      break;
    case "hook":
      capabilities.hooks = ["hook.catalog.changed"];
      break;
    case "mcp-tool":
      capabilities.mcpTools = ["github.changed"];
      break;
    case "egress":
      capabilities.egress = ["https://changed.example"];
      break;
    case "permission":
      capabilities.permissions = ["issues:read"];
      break;
    case "effect":
      first.versions = { effect: "999", schema: "2" };
      break;
    case "schema":
      first.versions = { effect: "2", schema: "999" };
      break;
    case "platform":
      first.platforms = [{ architecture: "arm64", os: "linux" }];
      break;
    case "recipe":
      first.recipe = { identity: "recipe:changed", sha256: sha("recipe:changed") };
      break;
    case "prose":
      first.prose = { identity: "prose:changed", sha256: sha("prose:changed") };
      break;
    default:
      throw new Error(`unknown surface ${surface}`);
  }
  return candidate;
}

function opaqueUnknownEnvelope(fixture: Fixture): Record<string, unknown> {
  const opaque = JSON.parse(
    readFileSync(resolve(root, "tests/contracts/opaque-catalog-head-v2.json"), "utf8"),
  ) as Json;
  const catalogHeadSha256 = sha(canonicalJson(opaque));
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    predicate: {
      catalogHeadSha256,
      claims: claims(),
      effectVersion: "999",
      protocol: "CatalogHeadV2",
      rawCatalogHead: opaque,
      schemaVersion: "999",
      signer: fixture.signer,
    },
    predicateType: "https://aih.dev/SupportedCatalogV2",
    subject: [{ digest: { sha256: catalogHeadSha256 }, name: "aih-supported/CatalogHeadV2" }],
  };
  const payload = Buffer.from(canonicalJson(statement as unknown as Json), "utf8");
  return {
    payload: payload.toString("base64"),
    payloadType: "application/vnd.in-toto+json",
    signatures: [
      {
        keyid: fixture.signer.keyId,
        sig: sign(
          null,
          dssePae("application/vnd.in-toto+json", payload),
          fixture.privateKey as never,
        ).toString("base64"),
      },
    ],
  };
}

describe("public signed catalog V2 acceptance contract", () => {
  it("exposes the public V2 package/CLI and a Core lock only for qualification-basis derivation", async () => {
    const publicApi = await api();
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;

    expect(packageJson.name).toBe("@aihq/supported");
    expect(packageJson.bin).toEqual({ "aih-supported": "dist/cli.js" });
    expect(packageJson).not.toHaveProperty("publishConfig");
    expect(publicApi.STRICT_V2_CORE_LOCK).toEqual({ coreCommit, schemaSha256 });
    for (const operation of [
      "createCatalogHeadV2",
      "canonicalCatalogHeadV2Bytes",
      "parseCatalogHeadV2Json",
      "signCatalogHeadV2",
      "verifySignedCatalogV2",
      "inspectSignedCatalogV2",
      "planCatalogPromotionV2",
      "deriveQualificationBasisV2",
    ] as const)
      expect(publicApi[operation]).toBeTypeOf("function");
  });

  it("creates only strict V2 heads with derived Core subjects, member/catalog digests, sorted surfaces, and a zero-digest genesis", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const head = publicApi.createCatalogHeadV2(headInput(fixture.signer));
    const entries = head.entries as readonly Record<string, unknown>[];

    expect(head.previousCatalogHeadSha256).toBe(zeroDigest);
    expect(head).toHaveProperty("catalogSha256");
    expect(head).toHaveProperty("catalogHeadSha256");
    expect(head.catalogSha256).not.toBe(head.catalogHeadSha256);
    expect(Object.keys(head.signer as object).sort()).toEqual([
      "class",
      "identity",
      "keyId",
      "publicKeySpkiSha256",
    ]);
    expect(entries.map((item) => item.entryId)).toEqual(["Recipe.Alpha", "recipe.default"]);
    expect(entries[1]).toMatchObject({
      memberSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      subject: {
        id: "default-profile",
        kind: "profile",
        source: { type: "github" },
        sourceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        subjectDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect((entries[1]?.capabilities as Record<string, string[]>).commands).toEqual([
      "catalog.verify",
    ]);
    expect(
      publicApi.parseCatalogHeadV2Json(
        publicApi.canonicalCatalogHeadV2Bytes(head).toString("utf8"),
      ),
    ).toEqual(head);
    for (const malformed of [
      headInput({ ...fixture.signer, keyId: "ed25519:wrong" }),
      headInput({ ...fixture.signer, privateKey: "forbidden" }),
      headInput(fixture.signer, { entries: [{ ...entry(), evidence: [] }] }),
      headInput(fixture.signer, {
        entries: [
          {
            ...entry(),
            capabilities: { ...(entry().capabilities as object), commands: ["z", "a"] },
          },
        ],
      }),
      headInput(fixture.signer, { previousCatalogHeadSha256: sha("not-genesis") }),
      headInput(fixture.signer, { entries: [{ ...entry(), entryId: "UPPER" }] }),
    ])
      expect(() => publicApi.createCatalogHeadV2(malformed)).toThrow();
  });

  it("signs the exact in-toto DSSE PAE once with a matching private Ed25519 key and verifies exact root, claims, continuity, replay, and time", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const head = publicApi.createCatalogHeadV2(headInput(fixture.signer));
    const signed = publicApi.signCatalogHeadV2({ head, privateKey: fixture.privateKey });
    const envelope = signed.envelope as {
      payload: string;
      payloadType: string;
      signatures: readonly { keyid: string; sig: string }[];
    };
    const payload = Buffer.from(envelope.payload, "base64");
    const statement = JSON.parse(payload.toString("utf8")) as Record<string, unknown>;

    expect(envelope.signatures).toHaveLength(1);
    expect(envelope.signatures[0]?.keyid).toBe(fixture.signer.keyId);
    expect(
      verify(
        null,
        dssePae(envelope.payloadType, payload),
        fixture.publicKey as never,
        Buffer.from(envelope.signatures[0]?.sig ?? "", "base64"),
      ),
    ).toBe(true);
    expect(statement).toMatchObject({
      _type: "https://in-toto.io/Statement/v1",
      predicate: { protocol: "CatalogHeadV2" },
      predicateType: "https://aih.dev/SupportedCatalogV2",
      subject: [
        { digest: { sha256: head.catalogHeadSha256 }, name: "aih-supported/CatalogHeadV2" },
      ],
    });
    const verification = {
      catalogSignerRoots: [fixture.catalogSignerRoot, { ...signingFixture().catalogSignerRoot }],
      expectedClaims: claims(),
      lastAccepted: null,
      now: "2026-08-22T12:00:00Z",
      signed,
    };
    expect(publicApi.verifySignedCatalogV2(verification)).toEqual(head);
    expect(publicApi.inspectSignedCatalogV2(verification)).toEqual({
      kind: "materializable",
      head,
    });
    expect(publicApi.verifySignedCatalogV2({ ...verification, lastAccepted: head })).toEqual(head);
    for (const [key, value] of Object.entries(changedClaimValues())) {
      const changedHead = publicApi.createCatalogHeadV2(
        headInput(fixture.signer, { claims: { ...claims(), [key]: value } }),
      );
      expect(changedHead.catalogHeadSha256).not.toBe(head.catalogHeadSha256);
    }
    for (const rejected of [
      ...Object.entries(changedClaimValues()).map(([key, value]) => ({
        ...verification,
        expectedClaims: { ...claims(), [key]: value },
      })),
      { ...verification, now: "2026-08-24T00:00:00Z" },
      { ...verification, now: "2026-08-21T23:59:59Z" },
      {
        ...verification,
        catalogSignerRoots: [{ ...fixture.catalogSignerRoot, identity: "administrator:wrong" }],
      },
      {
        ...verification,
        catalogSignerRoots: [{ ...fixture.catalogSignerRoot, class: "administrator-other" }],
      },
      {
        ...verification,
        catalogSignerRoots: [{ ...fixture.catalogSignerRoot, keyId: "ed25519:wrong" }],
      },
      {
        ...verification,
        signed: {
          ...signed,
          envelope: { ...envelope, signatures: [...envelope.signatures, envelope.signatures[0]] },
        },
      },
      {
        ...verification,
        signed: {
          ...signed,
          envelope: { ...envelope, payload: Buffer.from("tampered").toString("base64") },
        },
      },
      {
        ...verification,
        signed: {
          ...signed,
          envelope: {
            ...envelope,
            payload: Buffer.from(JSON.stringify({ ...statement, subject: [] })).toString("base64"),
          },
        },
      },
      {
        ...verification,
        signed: { ...signed, head: { ...head, catalogHeadSha256: sha("wrong-head") } },
      },
      {
        ...verification,
        signed: { ...signed, envelope: { ...envelope, payload: `${envelope.payload} ` } },
      },
    ])
      expect(() => publicApi.verifySignedCatalogV2(rejected)).toThrow();
  });

  it("returns an authenticated opaque unknown-version record but never materializes or verifies it as V2", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const envelope = opaqueUnknownEnvelope(fixture);
    const request = {
      catalogSignerRoots: [fixture.catalogSignerRoot],
      expectedClaims: claims(),
      lastAccepted: null,
      now: "2026-08-22T12:00:00Z",
      signed: { envelope },
    };

    expect(publicApi.inspectSignedCatalogV2(request)).toMatchObject({
      kind: "unsupported-version",
      record: { effectVersion: "999", schemaVersion: "999" },
    });
    expect(() => publicApi.verifySignedCatalogV2(request)).toThrow();
    expect(() =>
      publicApi.inspectSignedCatalogV2({
        ...request,
        signed: { envelope: { ...envelope, payload: Buffer.from("tampered").toString("base64") } },
      }),
    ).toThrow();
  });

  it("derives promotion differences from closed head surfaces and preserves last-good for every material exception", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const lastGood = publicApi.createCatalogHeadV2(headInput(fixture.signer));
    const cleanSuccessor = publicApi.createCatalogHeadV2(nextInput(lastGood, fixture.signer));

    expect(
      publicApi.planCatalogPromotionV2({
        candidateHead: cleanSuccessor,
        lastGood,
        now: "2026-08-22T12:00:00Z",
      }),
    ).toEqual({ head: cleanSuccessor, kind: "promoted" });
    expect(
      publicApi.planCatalogPromotionV2({
        candidateHead: lastGood,
        lastGood,
        now: "2026-08-22T12:00:00Z",
      }),
    ).toEqual({ head: lastGood, kind: "unchanged" });
    for (const invalidContinuity of [
      { ...nextInput(lastGood, fixture.signer), sequence: (lastGood.sequence as number) + 2 },
      { ...nextInput(lastGood, fixture.signer), previousCatalogHeadSha256: sha("wrong-parent") },
    ])
      expect(() =>
        publicApi.planCatalogPromotionV2({
          candidateHead: invalidContinuity,
          lastGood,
          now: "2026-08-22T12:00:00Z",
        }),
      ).toThrow();
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
      const result = publicApi.planCatalogPromotionV2({
        candidateHead: changedSurface(lastGood, surface),
        lastGood,
        now: "2026-08-22T12:00:00Z",
      }) as Record<string, unknown>;
      expect(result.kind).toBe("last-good");
      expect(result.head).toBe(lastGood);
      expect(result.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            candidateSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            identity: expect.any(String),
            lastGoodSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            surface,
          }),
        ]),
      );
    }
    for (const forbidden of [
      {
        candidateHead: cleanSuccessor,
        lastGood,
        now: "2026-08-22T12:00:00Z",
        qualification: { complete: true },
      },
      {
        candidateHead: cleanSuccessor,
        lastGood,
        now: "2026-08-22T12:00:00Z",
        sign: () => undefined,
      },
      {
        candidateHead: cleanSuccessor,
        lastGood,
        now: "2026-08-22T12:00:00Z",
        writeCatalog: () => undefined,
      },
    ])
      expect(() => publicApi.planCatalogPromotionV2(forbidden)).toThrow();
  });

  it("pins Core only as a qualification-basis schema target, never as an asserted V2 consumer", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const head = publicApi.createCatalogHeadV2(headInput(fixture.signer));
    const fixtureJson = JSON.parse(
      readFileSync(resolve(root, "tests/contracts/core-qualification-basis-v2.json"), "utf8"),
    ) as Record<string, unknown>;
    const expected = fixtureJson.qualificationBasis as Record<string, unknown>;
    const derived = publicApi.deriveQualificationBasisV2({
      entryId: "recipe.default",
      head,
    }) as Record<string, unknown>;

    expect(fixtureJson.core).toEqual({ commit: coreCommit, schemaSha256 });
    expect(Object.keys(expected).sort()).toEqual([
      "catalogDigest",
      "catalogHeadDigest",
      "catalogMemberDigest",
      "catalogSignerIdentity",
      "kind",
      "subjectDigest",
      "subjectKind",
    ]);
    expect(derived).toMatchObject({ kind: "aih-supported", subjectKind: "profile" });
    expect(Object.keys(derived).sort()).toEqual(Object.keys(expected).sort());
    const coreSchemaPath = resolve(coreRoot, "schemas/aih-governance-decision-v2.schema.json");
    if (existsSync(coreSchemaPath)) {
      const coreSchema = readFileSync(coreSchemaPath, "utf8");
      for (const key of Object.keys(expected)) expect(coreSchema).toContain(`"${key}"`);
    }
  });

  it("requires a manual exact-SHA OIDC/keyless workflow split into no-authority candidate, protected signer, and independent verifier jobs", () => {
    const packageJson = readFileSync(resolve(root, "package.json"), "utf8");
    const verificationWorkflow = readFileSync(
      resolve(root, ".github/workflows/verify.yml"),
      "utf8",
    );
    const workflowPath = resolve(root, ".github/workflows/signed-catalog-v2.yml");

    expect(packageJson).toContain('"verify:default-evidence-chain"');
    expect(verificationWorkflow).toContain("npm run verify:default-evidence-chain");
    expect(existsSync(workflowPath)).toBe(true);
    if (!existsSync(workflowPath)) return;
    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).toMatch(/^on:\s*\n\s*workflow_dispatch:/m);
    expect(workflow).toMatch(/commit_sha:[\s\S]*required:\s*true/);
    expect(workflow).toMatch(/[0-9a-f]\{40\}/);
    expect(workflow).toMatch(/git rev-parse HEAD/);
    expect(workflow).toMatch(/candidate:[\s\S]*permissions:\s*contents:\s*read/);
    expect(workflow).not.toMatch(/candidate:[\s\S]*id-token:\s*write/);
    expect(workflow).toMatch(/sign:[\s\S]*environment:/);
    expect(workflow).toMatch(/sign:[\s\S]*id-token:\s*write/);
    expect(workflow).toMatch(/(sigstore|cosign|keyless)/i);
    expect(workflow).toMatch(/verify:[\s\S]*needs:\s*\[candidate, sign\]/);
    expect(workflow).not.toMatch(/\b(release|publish|create-release|git tag)\b/i);
  });
});
