import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, type KeyObject, sign, verify } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
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
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
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
    compatibleEffectVersions: ["2"],
    compatibleSchemaVersions: ["2"],
    effectVersion: "2",
    entries: [
      entry("recipe.default"),
      { ...entry("recipe.alpha"), subject: subject("profile", "alpha-profile") },
    ],
    previousCatalogHeadSha256: zeroDigest,
    protocol: "CatalogHeadV2",
    schemaVersion: "2",
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
      catalogHead: opaque,
      catalogHeadSha256,
      claims: claims(),
      effectVersion: "999",
      protocol: "CatalogHeadV2",
      replayIdentity: "opaque:catalog-head:999",
      schemaVersion: "999",
      signer: fixture.signer,
      validFrom: "2026-08-22T00:00:00Z",
      validUntil: "2026-08-23T00:00:00Z",
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

function workflowJob(workflow: string, name: string): string {
  const lines = workflow.split(/\r?\n/);
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) throw new Error(`missing ${name} job`);
  const end = lines.findIndex(
    (line, index) => index > start && /^ {2}[a-z][a-z0-9_-]*:$/.test(line),
  );
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

function npmCli(): string {
  const candidates = [
    process.env.npm_execpath,
    resolve(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(process.execPath, "..", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates) {
    if (
      candidate &&
      isAbsolute(candidate) &&
      basename(candidate) === "npm-cli.js" &&
      existsSync(candidate)
    )
      return candidate;
  }
  throw new Error("unable to resolve a local npm-cli.js");
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
    expect(Object.keys(publicApi).sort()).toEqual([
      "STRICT_V2_CORE_LOCK",
      "canonicalCatalogHeadV2Bytes",
      "createCatalogHeadV2",
      "deriveQualificationBasisV2",
      "inspectSignedCatalogV2",
      "parseCatalogHeadV2Json",
      "planCatalogPromotionV2",
      "signCatalogHeadV2",
      "verifySignedCatalogV2",
    ]);
    expect(Object.keys(publicApi)).not.toEqual(expect.arrayContaining(["isSupported", "isMember"]));
  });

  it("creates only strict V2 heads with derived Core subjects, member/catalog digests, sorted surfaces, and a zero-digest genesis", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const head = publicApi.createCatalogHeadV2(headInput(fixture.signer));
    const entries = head.entries as readonly Record<string, unknown>[];

    expect(head.previousCatalogHeadSha256).toBe(zeroDigest);
    expect(head).toMatchObject({
      compatibleEffectVersions: ["2"],
      compatibleSchemaVersions: ["2"],
      effectVersion: "2",
      schemaVersion: "2",
    });
    expect(head).toHaveProperty("catalogSha256");
    expect(head).toHaveProperty("catalogHeadSha256");
    expect(head.catalogSha256).not.toBe(head.catalogHeadSha256);
    expect(Object.keys(head.signer as object).sort()).toEqual([
      "class",
      "identity",
      "keyId",
      "publicKeySpkiSha256",
    ]);
    expect(entries.map((item) => item.entryId)).toEqual(["recipe.alpha", "recipe.default"]);
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
      headInput(fixture.signer, { effectVersion: "999" }),
      headInput(fixture.signer, { schemaVersion: "999" }),
      headInput(fixture.signer, { entries: [] }),
      headInput(fixture.signer, { entries: [entry("recipe.default"), entry("recipe.default")] }),
      headInput(fixture.signer, { entries: [{ ...entry(), entryId: "UPPER" }] }),
    ])
      expect(() => publicApi.createCatalogHeadV2(malformed)).toThrow();
    for (const malformedClaims of [
      {},
      { ...claims(), extra: "forbidden" },
      { ...claims(), issuer: "https://issuer.invalid" },
      { ...claims(), repositoryId: "not-a-decimal-id" },
      { ...claims(), repositoryOwnerId: "not-a-decimal-id" },
      { ...claims(), sha: "not-a-40-hex-sha" },
      { ...claims(), jobWorkflowSha: "not-a-40-hex-sha" },
      { ...claims(), runAttempt: 0 },
      { ...claims(), runAttempt: 1.5 },
    ])
      expect(() =>
        publicApi.createCatalogHeadV2(headInput(fixture.signer, { claims: malformedClaims })),
      ).toThrow();
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
    expect(Object.keys(statement.predicate as object).sort()).toEqual([
      "catalogHead",
      "catalogHeadSha256",
      "claims",
      "effectVersion",
      "protocol",
      "replayIdentity",
      "schemaVersion",
      "signer",
      "validFrom",
      "validUntil",
    ]);
    expect(
      canonicalJson((statement.predicate as Record<string, unknown>).catalogHead as Json),
    ).toBe(publicApi.canonicalCatalogHeadV2Bytes(head).toString("utf8"));
    expect((statement.predicate as Record<string, unknown>).catalogHeadSha256).toBe(
      sha(canonicalJson((statement.predicate as Record<string, unknown>).catalogHead as Json)),
    );
    const verification = {
      catalogSignerRoots: [fixture.catalogSignerRoot, { ...signingFixture().catalogSignerRoot }],
      expectedClaims: claims(),
      lastAccepted: null,
      now: "2026-08-22T12:00:00Z",
      signed,
    };
    const verifiedHead = publicApi.verifySignedCatalogV2(verification);
    expect(verifiedHead).toEqual(head);
    expect(canonicalJson(verifiedHead as Json)).toBe(
      canonicalJson((statement.predicate as Record<string, unknown>).catalogHead as Json),
    );
    expect(publicApi.inspectSignedCatalogV2(verification)).toEqual({
      kind: "materializable",
      head,
    });
    expect(publicApi.verifySignedCatalogV2({ ...verification, lastAccepted: head })).toEqual(head);
    const successor = publicApi.createCatalogHeadV2(nextInput(head, fixture.signer));
    const signedSuccessor = publicApi.signCatalogHeadV2({
      head: successor,
      privateKey: fixture.privateKey,
    });
    const successorVerification = {
      ...verification,
      expectedClaims: claims("123456790", 2),
      lastAccepted: head,
      signed: signedSuccessor,
    };
    expect(publicApi.verifySignedCatalogV2(successorVerification)).toEqual(successor);
    expect(
      publicApi.verifySignedCatalogV2({ ...successorVerification, lastAccepted: successor }),
    ).toEqual(successor);
    const wrongPredecessor = publicApi.createCatalogHeadV2({
      ...nextInput(head, fixture.signer),
      previousCatalogHeadSha256: sha("wrong-predecessor"),
    });
    const skippedSequence = publicApi.createCatalogHeadV2({
      ...nextInput(head, fixture.signer),
      sequence: 2,
    });
    const sameSequenceFork = publicApi.createCatalogHeadV2(
      headInput(fixture.signer, { validUntil: "2026-08-23T01:00:00Z" }),
    );
    const zeroPredecessorSuccessor = publicApi.createCatalogHeadV2(
      headInput(fixture.signer, {
        claims: claims("123456790", 2),
        sequence: 1,
      }),
    );
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
        catalogSignerRoots: [
          {
            ...fixture.catalogSignerRoot,
            publicKeySpkiDerBase64: signingFixture().catalogSignerRoot
              .publicKeySpkiDerBase64 as string,
          },
        ],
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
        signed: { ...signed, head: { ...head, validUntil: "2026-08-23T01:00:00Z" } },
      },
      {
        ...verification,
        signed: {
          ...signed,
          head: {
            ...head,
            entries: [
              {
                ...(head.entries as Record<string, unknown>[])[0],
                capabilities: {
                  ...((head.entries as Record<string, unknown>[])[0]?.capabilities as object),
                  commands: ["catalog.changed"],
                },
              },
              (head.entries as Record<string, unknown>[])[1],
            ],
          },
        },
      },
      {
        ...verification,
        signed: { ...signed, envelope: { ...envelope, payload: `${envelope.payload} ` } },
      },
      {
        ...verification,
        signed: {
          envelope: {
            payload: publicApi.canonicalCatalogHeadV2Bytes(head).toString("base64"),
            payloadType: "application/vnd.in-toto+json",
            signatures: [
              {
                keyid: fixture.signer.keyId,
                sig: sign(
                  null,
                  publicApi.canonicalCatalogHeadV2Bytes(head),
                  fixture.privateKey as never,
                ).toString("base64"),
              },
            ],
          },
          head,
        },
      },
      {
        ...successorVerification,
        signed: publicApi.signCatalogHeadV2({
          head: wrongPredecessor,
          privateKey: fixture.privateKey,
        }),
      },
      {
        ...successorVerification,
        signed: publicApi.signCatalogHeadV2({
          head: skippedSequence,
          privateKey: fixture.privateKey,
        }),
      },
      {
        ...verification,
        lastAccepted: head,
        signed: publicApi.signCatalogHeadV2({
          head: sameSequenceFork,
          privateKey: fixture.privateKey,
        }),
      },
      {
        ...verification,
        lastAccepted: head,
        signed: publicApi.signCatalogHeadV2({
          head: zeroPredecessorSuccessor,
          privateKey: fixture.privateKey,
        }),
      },
      { ...verification, lastAccepted: successor },
      { ...verification, provider: "forbidden" },
      { ...verification, fetch: () => undefined },
      { ...verification, skipContinuity: true },
    ])
      expect(() => publicApi.verifySignedCatalogV2(rejected)).toThrow();
    for (const signingInput of [
      { head, privateKey: signingFixture().privateKey },
      { head, privateKey: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey },
      { head: headInput(fixture.signer), privateKey: fixture.privateKey },
      {
        head: { ...head, catalogHeadSha256: sha("self-declared-wrong-digest") },
        privateKey: fixture.privateKey,
      },
      {
        head: {
          ...head,
          entries: [...(head.entries as Record<string, unknown>[]), entry("recipe.default")],
        },
        privateKey: fixture.privateKey,
      },
      { head: { ...head, effectVersion: "999" }, privateKey: fixture.privateKey },
      { head, privateKey: fixture.privateKey, provider: "forbidden" },
      { head, privateKey: fixture.privateKey, source: "forbidden" },
      { head, privateKey: fixture.privateKey, authority: "forbidden" },
    ])
      expect(() => publicApi.signCatalogHeadV2(signingInput)).toThrow();
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
      replay: { acceptedIdentities: [] },
      signed: { envelope },
    };
    const opaqueStatement = JSON.parse(
      Buffer.from(envelope.payload as string, "base64").toString("utf8"),
    ) as { predicate: Record<string, unknown> };
    expect(Object.keys(opaqueStatement.predicate).sort()).toEqual([
      "catalogHead",
      "catalogHeadSha256",
      "claims",
      "effectVersion",
      "protocol",
      "replayIdentity",
      "schemaVersion",
      "signer",
      "validFrom",
      "validUntil",
    ]);

    expect(publicApi.inspectSignedCatalogV2(request)).toMatchObject({
      kind: "unsupported-version",
      record: { effectVersion: "999", schemaVersion: "999" },
    });
    expect(() => publicApi.verifySignedCatalogV2(request)).toThrow();
    for (const rejected of [
      { ...request, expectedClaims: { ...claims(), runId: "other" } },
      { ...request, now: "2026-08-21T23:59:59Z" },
      { ...request, now: "2026-08-24T00:00:00Z" },
      { ...request, replay: { acceptedIdentities: ["opaque:catalog-head:999"] } },
      {
        ...request,
        catalogSignerRoots: [{ ...fixture.catalogSignerRoot, publicKeySpkiSha256: sha("wrong") }],
      },
      {
        ...request,
        signed: { envelope: { ...envelope, payload: Buffer.from("tampered").toString("base64") } },
      },
      { ...request, provider: "forbidden" },
      { ...request, fetch: () => undefined },
      { ...request, skipContinuity: true },
    ])
      expect(() => publicApi.inspectSignedCatalogV2(rejected)).toThrow();
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
    for (const now of ["2026-08-21T23:59:59Z", "2026-08-25T00:00:00Z"])
      expect(() =>
        publicApi.planCatalogPromotionV2({ candidateHead: cleanSuccessor, lastGood, now }),
      ).toThrow();
    expect(() =>
      publicApi.planCatalogPromotionV2({
        candidateHead: {
          ...nextInput(lastGood, fixture.signer),
          entries: [
            {
              ...(nextInput(lastGood, fixture.signer).entries as Record<string, unknown>[])[0],
              capabilities: {
                ...((nextInput(lastGood, fixture.signer).entries as Record<string, unknown>[])[0]
                  ?.capabilities as object),
                unknownCapability: ["forbidden"],
              },
            },
          ],
        },
        lastGood,
        now: "2026-08-22T12:00:00Z",
      }),
    ).toThrow();
    for (const invalidContinuity of [
      { ...nextInput(lastGood, fixture.signer), sequence: (lastGood.sequence as number) + 2 },
      { ...nextInput(lastGood, fixture.signer), previousCatalogHeadSha256: sha("wrong-parent") },
      { ...nextInput(lastGood, fixture.signer), previousCatalogHeadSha256: zeroDigest },
      { ...nextInput(lastGood, fixture.signer), sequence: 0 },
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
    const entryAdded = publicApi.createCatalogHeadV2({
      ...nextInput(lastGood, fixture.signer),
      entries: [
        ...(nextInput(lastGood, fixture.signer).entries as Record<string, unknown>[]),
        entry("recipe.beta"),
      ],
    });
    const entryRemoved = publicApi.createCatalogHeadV2({
      ...nextInput(lastGood, fixture.signer),
      entries: (nextInput(lastGood, fixture.signer).entries as Record<string, unknown>[]).filter(
        (candidate) => candidate.entryId !== "recipe.alpha",
      ),
    });
    const subjectChanged = publicApi.createCatalogHeadV2({
      ...nextInput(lastGood, fixture.signer),
      entries: (nextInput(lastGood, fixture.signer).entries as Record<string, unknown>[]).map(
        (candidate) =>
          candidate.entryId === "recipe.default"
            ? { ...candidate, subject: subject("profile", "changed-default-profile") }
            : candidate,
      ),
    });
    for (const [candidateHead, surface, identity] of [
      [entryAdded, "entry-added", "recipe.beta"],
      [entryRemoved, "entry-removed", "recipe.alpha"],
      [subjectChanged, "subject", "recipe.default"],
    ]) {
      const result = publicApi.planCatalogPromotionV2({
        candidateHead,
        lastGood,
        now: "2026-08-22T12:00:00Z",
      }) as Record<string, unknown>;
      expect(result).toMatchObject({ head: lastGood, kind: "last-good" });
      expect(result.facts).toEqual(
        expect.arrayContaining([expect.objectContaining({ identity, surface })]),
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

  it("requires a portable exact-Core lock verifier for qualification-basis shape, without asserting Core consumes V2", async () => {
    const publicApi = await api();
    const fixture = signingFixture();
    const head = publicApi.createCatalogHeadV2(headInput(fixture.signer));
    const fixtureJson = JSON.parse(
      readFileSync(resolve(root, "tests/contracts/core-qualification-basis-v2.json"), "utf8"),
    ) as Record<string, unknown>;
    const expectedKeys = fixtureJson.qualificationBasisKeys as string[];
    const derived = publicApi.deriveQualificationBasisV2({
      entryId: "recipe.default",
      head,
    }) as Record<string, unknown>;

    expect(fixtureJson.core).toEqual({
      commit: coreCommit,
      repository: "samartomar/ai-harness",
      schemaPath: "schemas/aih-governance-decision-v2.schema.json",
      schemaSha256,
    });
    expect(expectedKeys).toEqual([
      "catalogDigest",
      "catalogHeadDigest",
      "catalogMemberDigest",
      "catalogSignerIdentity",
      "kind",
      "subjectDigest",
      "subjectKind",
    ]);
    const defaultEntry = (head.entries as Record<string, unknown>[]).find(
      (candidate) => candidate.entryId === "recipe.default",
    ) as Record<string, unknown>;
    expect(derived).toMatchObject({
      catalogDigest: `sha256:${head.catalogSha256}`,
      catalogHeadDigest: `sha256:${head.catalogHeadSha256}`,
      catalogMemberDigest: `sha256:${defaultEntry.memberSha256}`,
      catalogSignerIdentity: fixture.signer.identity,
      kind: "aih-supported",
      subjectDigest: `sha256:${(defaultEntry.subject as Record<string, unknown>).subjectDigest}`,
      subjectKind: "profile",
    });
    for (const key of [
      "catalogDigest",
      "catalogHeadDigest",
      "catalogMemberDigest",
      "subjectDigest",
    ])
      expect(derived[key]).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(derived.catalogSignerIdentity).toMatch(/^administrator:aih-supported\/catalog-v2$/);
    expect(derived.subjectKind).toMatch(/^(tool|skill|mcp|package|profile)$/);
    expect(Object.keys(derived).sort()).toEqual([...expectedKeys].sort());
    expect(() =>
      publicApi.deriveQualificationBasisV2({ entryId: "recipe.unknown", head }),
    ).toThrow();
    const packageJson = readFileSync(resolve(root, "package.json"), "utf8");
    const packageScripts = JSON.parse(packageJson).scripts as Record<string, string>;
    const verificationWorkflow = readFileSync(
      resolve(root, ".github/workflows/verify.yml"),
      "utf8",
    );
    const verifierPath = resolve(root, "tools/verify-core-v2-lock.mjs");
    const schemaPath = resolve(root, "tests/contracts/core/aih-governance-decision-v2.schema.json");
    expect(packageJson).toContain('"verify:core-v2-lock"');
    expect(packageScripts.verify).toBe(
      "npm run typecheck && npm run lint && npm run build && npm test",
    );
    expect(packageScripts["verify:core-v2-lock"]).toMatch(/^node tools\/verify-core-v2-lock\.mjs$/);
    expect(verificationWorkflow).toContain("npm run verify:core-v2-lock");
    expect(existsSync(verifierPath)).toBe(true);
    const verifier = readFileSync(verifierPath, "utf8");
    expect(verifier).toContain(coreCommit);
    expect(verifier).toContain("samartomar/ai-harness");
    expect(verifier).toContain(schemaSha256);
    expect(verifier).toContain("aih-governance-decision-v2.schema.json");
    expect(verifier).toContain("tests/contracts/core/aih-governance-decision-v2.schema.json");
    expect(existsSync(schemaPath)).toBe(true);
    expect(sha(readFileSync(schemaPath))).toBe(schemaSha256);
    expect(
      spawnSync(process.execPath, [verifierPath], { cwd: root, encoding: "utf8" }).status,
    ).toBe(0);
    const validationTemp = mkdtempSync(join(tmpdir(), "aih-supported-core-lock-"));
    try {
      const basisPath = resolve(validationTemp, "qualification-basis.json");
      const driftedSchemaPath = resolve(validationTemp, "drifted-schema.json");
      writeFileSync(basisPath, canonicalJson(derived as unknown as Json));
      writeFileSync(driftedSchemaPath, `${readFileSync(schemaPath, "utf8")}\n`);
      expect(
        spawnSync(
          process.execPath,
          [verifierPath, "--schema", schemaPath, "--qualification-basis", basisPath],
          { cwd: root, encoding: "utf8" },
        ).status,
      ).toBe(0);
      expect(
        spawnSync(
          process.execPath,
          [verifierPath, "--schema", driftedSchemaPath, "--qualification-basis", basisPath],
          { cwd: root, encoding: "utf8" },
        ).status,
      ).not.toBe(0);
    } finally {
      rmSync(validationTemp, { force: true, recursive: true });
    }
  });

  it("derives one deterministic default profile/recipe evidence chain and supports a packed disposable cold external-admin journey", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const defaultCatalogText = readFileSync(
      resolve(root, "tests/contracts/default-catalog-v2.json"),
      "utf8",
    );
    const defaultCatalog = JSON.parse(defaultCatalogText) as Record<string, unknown>;
    const coldAdminText = readFileSync(
      resolve(root, "tests/contracts/cold-external-admin-v2.json"),
      "utf8",
    );
    const coldAdmin = JSON.parse(coldAdminText) as Record<string, unknown>;
    const defaultRecipeArtifact = defaultCatalog.recipe as Record<string, unknown>;
    expect(defaultCatalog).toMatchObject({
      entryId: "recipe.default",
      installedSeed: "defaults/default-catalog-v2.json",
      profile: { id: "default-profile", kind: "profile" },
      recipe: defaultRecipeArtifact,
    });
    expect(defaultRecipeArtifact).toEqual({ id: "default-recipe", kind: "recipe" });
    expect(defaultRecipeArtifact.kind).not.toBe("profile");
    expect(defaultCatalogText.trim()).toBe(canonicalJson(defaultCatalog as unknown as Json));
    expect(coldAdmin).toMatchObject({
      organizationAdmission: "not-authoritative",
      verificationMode: "cold-external-admin",
    });
    expect(coldAdminText.trim()).toBe(canonicalJson(coldAdmin as unknown as Json));
    expect(packageJson.version).toBe("1.0.0");
    expect(packageJson.bin).toEqual({ "aih-supported": "dist/cli.js" });
    expect(packageJson.files).toEqual(["dist", "defaults", "README.md"]);
    expect(packageJson.dependencies).toEqual({});
    expect(packageJson).toMatchObject({
      scripts: {
        "generate:default-candidate": expect.any(String),
        "sign:candidate": expect.any(String),
        "verify:cold-external-admin": expect.any(String),
      },
    });
    const temp = mkdtempSync(join(tmpdir(), "aih-supported-cold-"));
    try {
      const buildStarted = Date.now();
      const build = spawnSync(process.execPath, [npmCli(), "run", "build"], {
        cwd: root,
        encoding: "utf8",
      });
      expect(build.status).toBe(0);
      for (const output of ["dist/cli.js", "dist/index.js"] as const) {
        const outputPath = resolve(root, output);
        expect(existsSync(outputPath)).toBe(true);
        expect(statSync(outputPath).mtimeMs).toBeGreaterThanOrEqual(buildStarted - 1_000);
      }
      const packed = spawnSync(
        process.execPath,
        [npmCli(), "pack", "--json", "--pack-destination", temp],
        {
          cwd: root,
          encoding: "utf8",
        },
      );
      expect(packed.status).toBe(0);
      const packedManifest = (
        JSON.parse(packed.stdout) as {
          filename: string;
          files: { path: string }[];
        }[]
      )[0];
      const tarball = resolve(temp, packedManifest?.filename ?? "");
      const tarFiles = packedManifest?.files.map((file) => file.path) ?? [];
      expect(tarFiles).not.toHaveLength(0);
      for (const file of tarFiles)
        expect(file).toMatch(
          /^(dist\/|defaults\/|package\.json$|README(?:\.md)?$|LICENSE(?:\.md)?$)/,
        );
      expect(tarFiles.join("\n")).not.toMatch(/\.pem$|^tests\/|^ai-coding\/|^tools\/|hooks\//m);
      expect(tarFiles).toEqual(
        expect.arrayContaining([
          "dist/cli.js",
          "dist/cli.d.ts",
          "dist/index.js",
          "dist/index.d.ts",
          "dist/supported/signed-catalog-v2.js",
          "dist/supported/signed-catalog-v2.d.ts",
          "package.json",
        ]),
      );
      expect(tarFiles.join("\n")).not.toMatch(
        /(?:^|\/)v1(?:\/|\.|$)|records-v1|provider-watcher-v1/i,
      );
      const consumer = resolve(temp, "consumer");
      mkdirSync(consumer);
      writeFileSync(`${consumer}/package.json`, '{"name":"cold-admin-consumer","private":true}');
      const installed = spawnSync(
        process.execPath,
        [npmCli(), "install", "--offline", "--no-audit", "--no-fund", "--ignore-scripts", tarball],
        {
          cwd: consumer,
          encoding: "utf8",
        },
      );
      expect(installed.status).toBe(0);

      const fixture = signingFixture();
      const wrongFixture = signingFixture();
      const claimsPath = resolve(temp, "claims.json");
      const changedClaimsPath = resolve(temp, "changed-claims.json");
      const rootPath = resolve(temp, "catalog-signer-root.json");
      const signerPath = resolve(temp, "catalog-signer.json");
      const changedSignerPath = resolve(temp, "changed-catalog-signer.json");
      const privateKeyPath = resolve(temp, "catalog-signer-private.pem");
      const wrongPrivateKeyPath = resolve(temp, "wrong-catalog-signer-private.pem");
      const insecurePrivateKeyPath = resolve(temp, "insecure-catalog-signer-private.pem");
      const candidatePath = resolve(temp, "candidate.json");
      const repeatedCandidatePath = resolve(temp, "candidate-repeated.json");
      const changedClaimsCandidatePath = resolve(temp, "changed-claims-candidate.json");
      const changedSignerCandidatePath = resolve(temp, "changed-signer-candidate.json");
      const signedCatalogPath = resolve(temp, "signed-catalog.json");
      const candidateInputs = [
        "--valid-from",
        "2026-08-22T00:00:00Z",
        "--valid-until",
        "2026-08-23T00:00:00Z",
        "--sequence",
        "0",
        "--previous-catalog-head-sha256",
        zeroDigest,
      ];
      writeFileSync(claimsPath, canonicalJson(claims() as unknown as Json));
      writeFileSync(changedClaimsPath, canonicalJson(claims("123456790", 2) as unknown as Json));
      writeFileSync(rootPath, canonicalJson(fixture.catalogSignerRoot as unknown as Json));
      writeFileSync(signerPath, canonicalJson(fixture.signer as unknown as Json));
      writeFileSync(changedSignerPath, canonicalJson(wrongFixture.signer as unknown as Json));
      expect(Object.keys(JSON.parse(readFileSync(signerPath, "utf8")) as object).sort()).toEqual([
        "class",
        "identity",
        "keyId",
        "publicKeySpkiSha256",
      ]);
      writeFileSync(privateKeyPath, fixture.privateKey.export({ format: "pem", type: "pkcs8" }));
      writeFileSync(
        wrongPrivateKeyPath,
        wrongFixture.privateKey.export({ format: "pem", type: "pkcs8" }),
      );
      const cliPath = resolve(consumer, "node_modules/@aihq/supported/dist/cli.js");
      const installedPackage = resolve(consumer, "node_modules/@aihq/supported");
      const installedSeed = resolve(installedPackage, defaultCatalog.installedSeed as string);
      expect(existsSync(installedSeed)).toBe(true);
      const installedSeedCatalog = JSON.parse(readFileSync(installedSeed, "utf8")) as {
        artifacts: Record<string, string>;
      };
      const artifactDigests = Object.fromEntries(
        Object.entries(installedSeedCatalog.artifacts).map(([kind, path]) => [
          kind,
          sha(readFileSync(resolve(installedPackage, path))),
        ]),
      );
      expect(Object.keys(installedSeedCatalog.artifacts).sort()).toEqual([
        "closure",
        "profile",
        "prose",
        "recipe",
      ]);
      for (const digest of Object.values(artifactDigests)) expect(digest).toMatch(/^[a-f0-9]{64}$/);
      expect((installedSeedCatalog as Record<string, unknown>).entryId).toBe("recipe.default");
      expect((installedSeedCatalog as Record<string, unknown>).subject).toMatchObject({
        id: "default-profile",
        kind: "profile",
      });
      const installedProfileArtifact = JSON.parse(
        readFileSync(
          resolve(installedPackage, installedSeedCatalog.artifacts.profile as string),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const installedRecipeArtifact = JSON.parse(
        readFileSync(
          resolve(installedPackage, installedSeedCatalog.artifacts.recipe as string),
          "utf8",
        ),
      ) as Record<string, unknown>;
      expect(installedProfileArtifact.id).toBe(
        (defaultCatalog.profile as Record<string, unknown>).id,
      );
      expect(installedRecipeArtifact.id).toBe(defaultRecipeArtifact.id);
      if (process.platform !== "win32") {
        chmodSync(privateKeyPath, 0o600);
        chmodSync(wrongPrivateKeyPath, 0o600);
        expect(statSync(privateKeyPath).mode & 0o777).toBe(0o600);
      }
      const unsignedInspection = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--catalog",
          installedSeed,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--qualification-basis",
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(unsignedInspection.status).not.toBe(0);
      for (const rejectedAuthority of [
        ["--private-key", privateKeyPath],
        ["--sign-callback", "https://signer.invalid/callback"],
        ["--write-catalog", "https://catalog.invalid/write"],
      ]) {
        const rejectsCandidateSigningAuthority = spawnSync(
          process.execPath,
          [
            cliPath,
            "generate-candidate",
            "--seed",
            installedSeed,
            ...rejectedAuthority,
            "--output",
            candidatePath,
          ],
          { cwd: consumer, encoding: "utf8" },
        );
        expect(rejectsCandidateSigningAuthority.status).not.toBe(0);
      }
      const rejectsCandidateProvider = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          installedSeed,
          "--provider-callback",
          "https://provider.invalid/candidate",
          "--output",
          candidatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(rejectsCandidateProvider.status).not.toBe(0);
      const generated = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          installedSeed,
          "--signer",
          signerPath,
          "--claims",
          claimsPath,
          ...candidateInputs,
          "--output",
          candidatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(generated.status).toBe(0);
      const candidateText = readFileSync(candidatePath, "utf8");
      const candidate = JSON.parse(candidateText) as Record<string, unknown>;
      expect(candidateText).toBe(canonicalJson(candidate as unknown as Json));
      expect(candidate).not.toHaveProperty("signature");
      expect(candidate).not.toHaveProperty("catalogSignerRoot");
      expect(candidate).not.toHaveProperty("privateKey");
      expect(candidate.signer).toEqual(fixture.signer);
      expect(candidate.claims).toEqual(claims());
      expect(candidate.validFrom).toBe("2026-08-22T00:00:00Z");
      expect(candidate.validUntil).toBe("2026-08-23T00:00:00Z");
      expect(candidate.sequence).toBe(0);
      expect(candidate.previousCatalogHeadSha256).toBe(zeroDigest);
      const repeatedCandidate = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          installedSeed,
          "--signer",
          signerPath,
          "--claims",
          claimsPath,
          ...candidateInputs,
          "--output",
          repeatedCandidatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(repeatedCandidate.status).toBe(0);
      expect(readFileSync(repeatedCandidatePath, "utf8")).toBe(candidateText);
      const inspectionNow = new Date(
        Date.parse(candidate.validFrom as string) + 12 * 60 * 60 * 1_000,
      ).toISOString();
      expect(inspectionNow < (candidate.validUntil as string)).toBe(true);
      const changedClaimsCandidate = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          installedSeed,
          "--signer",
          signerPath,
          "--claims",
          changedClaimsPath,
          ...candidateInputs,
          "--output",
          changedClaimsCandidatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(changedClaimsCandidate.status).toBe(0);
      const changedSignerCandidate = spawnSync(
        process.execPath,
        [
          cliPath,
          "generate-candidate",
          "--seed",
          installedSeed,
          "--signer",
          changedSignerPath,
          "--claims",
          claimsPath,
          ...candidateInputs,
          "--output",
          changedSignerCandidatePath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(changedSignerCandidate.status).toBe(0);
      expect(
        (JSON.parse(readFileSync(changedClaimsCandidatePath, "utf8")) as Record<string, unknown>)
          .catalogHeadSha256,
      ).not.toBe(candidate.catalogHeadSha256);
      expect(
        (JSON.parse(readFileSync(changedSignerCandidatePath, "utf8")) as Record<string, unknown>)
          .catalogHeadSha256,
      ).not.toBe(candidate.catalogHeadSha256);
      const mutatedCandidatePath = resolve(temp, "mutated-candidate.json");
      writeFileSync(mutatedCandidatePath, `${candidateText} `);
      expect(
        spawnSync(
          process.execPath,
          [
            cliPath,
            "sign-candidate",
            "--candidate",
            mutatedCandidatePath,
            "--private-key",
            privateKeyPath,
            "--output",
            signedCatalogPath,
          ],
          { cwd: consumer, encoding: "utf8" },
        ).status,
      ).not.toBe(0);
      for (const rejectedCandidateInput of [
        ["--seed", installedSeed],
        ["--artifact", installedSeed],
        ["--artifacts", installedSeed],
        ["--provider-callback", "https://provider.invalid/sign"],
        ["--signer", signerPath],
        ["--claims", claimsPath],
      ]) {
        const rejectsSigningCandidateInput = spawnSync(
          process.execPath,
          [
            cliPath,
            "sign-candidate",
            "--candidate",
            candidatePath,
            "--private-key",
            privateKeyPath,
            ...rejectedCandidateInput,
            "--output",
            signedCatalogPath,
          ],
          { cwd: consumer, encoding: "utf8" },
        );
        expect(rejectsSigningCandidateInput.status).not.toBe(0);
      }
      if (process.platform !== "win32") {
        writeFileSync(
          insecurePrivateKeyPath,
          fixture.privateKey.export({ format: "pem", type: "pkcs8" }),
        );
        chmodSync(insecurePrivateKeyPath, 0o644);
        const rejectsInsecurePrivateKey = spawnSync(
          process.execPath,
          [
            cliPath,
            "sign-candidate",
            "--candidate",
            candidatePath,
            "--private-key",
            insecurePrivateKeyPath,
            "--output",
            signedCatalogPath,
          ],
          { cwd: consumer, encoding: "utf8" },
        );
        expect(rejectsInsecurePrivateKey.status).not.toBe(0);
      }
      const rejectsWrongPrivateKey = spawnSync(
        process.execPath,
        [
          cliPath,
          "sign-candidate",
          "--candidate",
          candidatePath,
          "--private-key",
          wrongPrivateKeyPath,
          "--output",
          signedCatalogPath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(rejectsWrongPrivateKey.status).not.toBe(0);
      const signed = spawnSync(
        process.execPath,
        [
          cliPath,
          "sign-candidate",
          "--candidate",
          candidatePath,
          "--private-key",
          privateKeyPath,
          "--output",
          signedCatalogPath,
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(signed.status).toBe(0);
      const signedCatalog = readFileSync(signedCatalogPath, "utf8");
      const signedArtifact = JSON.parse(signedCatalog) as {
        envelope: { payload: string; payloadType: string };
        head: Record<string, unknown>;
      };
      expect(canonicalJson(signedArtifact.head as Json)).toBe(candidateText);
      const statement = JSON.parse(
        Buffer.from(signedArtifact.envelope.payload, "base64").toString("utf8"),
      ) as {
        predicate: { candidateSha256: string; catalogHead: Record<string, unknown> };
        subject: readonly { digest: { sha256: string }; name: string }[];
      };
      expect(signedArtifact.envelope.payloadType).toBe("application/vnd.in-toto+json");
      expect(statement.predicate.candidateSha256).toBe(sha(candidateText));
      expect(canonicalJson(statement.predicate.catalogHead as Json)).toBe(candidateText);
      expect(statement.subject).toEqual([
        {
          digest: { sha256: candidate.catalogHeadSha256 },
          name: "aih-supported/CatalogHeadV2",
        },
      ]);
      for (const digest of Object.values(artifactDigests)) expect(signedCatalog).toContain(digest);
      const inspected = spawnSync(
        process.execPath,
        [
          cliPath,
          "inspect",
          "--signed-catalog",
          signedCatalogPath,
          "--catalog-signer-root",
          rootPath,
          "--expected-claims",
          claimsPath,
          "--now",
          inspectionNow,
          "--continuity",
          "genesis",
          "--qualification-basis",
        ],
        { cwd: consumer, encoding: "utf8" },
      );
      expect(inspected.status).toBe(0);
      expect(inspected.stdout).toContain('"kind":"aih-supported"');
      expect(inspected.stdout).toContain('"organizationAdmission":"not-authoritative"');
      const inspectedOutput = JSON.parse(inspected.stdout) as Record<string, unknown>;
      expect(inspectedOutput).toMatchObject({
        organizationAdmission: coldAdmin.organizationAdmission,
        verificationMode: coldAdmin.verificationMode,
      });
      const tamperedSignedCatalogPath = resolve(temp, "tampered-signed-catalog.json");
      const wrongRootPath = resolve(temp, "wrong-catalog-signer-root.json");
      writeFileSync(tamperedSignedCatalogPath, `${signedCatalog} `);
      writeFileSync(
        wrongRootPath,
        canonicalJson(wrongFixture.catalogSignerRoot as unknown as Json),
      );
      for (const [flag, value] of [
        ["--expected-claims", changedClaimsPath],
        ["--catalog-signer-root", wrongRootPath],
        ["--now", "2026-08-24T00:00:00Z"],
        ["--signed-catalog", tamperedSignedCatalogPath],
      ] as const) {
        const rejectedInspection = spawnSync(
          process.execPath,
          [
            cliPath,
            "inspect",
            "--signed-catalog",
            flag === "--signed-catalog" ? value : signedCatalogPath,
            "--catalog-signer-root",
            flag === "--catalog-signer-root" ? value : rootPath,
            "--expected-claims",
            flag === "--expected-claims" ? value : claimsPath,
            "--now",
            flag === "--now" ? value : inspectionNow,
            "--continuity",
            "genesis",
            "--qualification-basis",
          ],
          { cwd: consumer, encoding: "utf8" },
        );
        expect(rejectedInspection.status).not.toBe(0);
      }
    } finally {
      rmSync(temp, { force: true, recursive: true });
    }
  }, 180_000);

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
    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).toMatch(/^on:\s*\n\s*workflow_dispatch:/m);
    expect(workflow).toMatch(/commit_sha:[\s\S]*required:\s*true/);
    expect(workflow).toMatch(/signed_catalog_sha256:[\s\S]*required:\s*true/);
    const candidate = workflowJob(workflow, "candidate");
    const signer = workflowJob(workflow, "sign");
    const verifier = workflowJob(workflow, "verify");
    expect(candidate).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(candidate).toMatch(/\[0-9a-f\]\{40\}/);
    expect(candidate).not.toMatch(
      /id-token:\s*write|contents:\s*write|\b(sign|cosign|sigstore)\b/i,
    );
    expect(candidate).toMatch(/actions\/checkout[\s\S]*ref:\s*\$\{\{\s*inputs\.commit_sha\s*\}\}/);
    expect(candidate).toMatch(/actual_commit\s*=\s*["']?\$\(git rev-parse HEAD\)/i);
    expect(candidate).toMatch(
      /(?:if|test)\s+[^\n]*actual_commit[^\n]*(?:!=|==|=)[^\n]*inputs\.commit_sha/i,
    );
    expect(candidate).toMatch(/sha256sum|shasum/);
    expect(signer).toMatch(/environment:\s*catalog-signing/);
    expect(signer).toMatch(/\[0-9a-f\]\{64\}/);
    expect(signer).toMatch(/id-token:\s*write/);
    expect(signer).toMatch(/sha256sum|shasum/);
    expect(signer).toMatch(/signed_catalog_sha256/);
    expect(signer).toMatch(/actual_catalog_sha256\s*=\s*["']?\$\((?:sha256sum|shasum)/i);
    expect(signer).toMatch(
      /(?:if|test)\s+[^\n]*actual_catalog_sha256[^\n]*(?:!=|==|=)[^\n]*inputs\.signed_catalog_sha256/i,
    );
    expect(signer).toMatch(/(sigstore|cosign|keyless)/i);
    expect(signer).toMatch(
      /(provenance|attestation).*(signed-catalog|artifact)|(signed-catalog|artifact).*(provenance|attestation)/i,
    );
    expect(signer).not.toMatch(
      /actions\/checkout|npm\s|candidate\.ts|contents:\s*write|catalogSignerRoot|ed25519.*generate|private.*key/i,
    );
    expect(signer).toMatch(/administrator.*ed25519.*DSSE|DSSE.*administrator.*ed25519/i);
    expect(signer).toMatch(/keyless.*(provenance|publication)|(provenance|publication).*keyless/i);
    expect(verifier).toMatch(/actions\/download-artifact/);
    expect(verifier).toMatch(/npm\s+(ci|run)/);
    expect(verifier).not.toMatch(/needs:\s*\[?candidate/i);
    expect(workflow).not.toMatch(/\b(release|publish|create-release|git tag)\b/i);
  });
});
