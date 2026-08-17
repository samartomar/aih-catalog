import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalCandidateV1Bytes,
  canonicalCatalogHeadV1Bytes,
  canonicalDsseEnvelopeV1Bytes,
  canonicalPromotionDecisionV1Bytes,
  canonicalQualificationBundleV1Bytes,
  canonicalSourceWatchPolicyV1Bytes,
  createCandidateV1,
  createCatalogHeadV1,
  createDsseEnvelopeV1,
  createPromotionDecisionV1,
  createQualificationBundleV1,
  createSourceWatchPolicyV1,
  parseCandidateV1Json,
  parseCatalogHeadV1Json,
  parseDsseEnvelopeV1Json,
  parsePromotionDecisionV1Json,
  parseQualificationBundleV1Json,
  parseSourceWatchPolicyV1Json,
  resolveCatalogHeadV1,
  verifyCatalogHeadV1,
  verifyDsseEnvelopeV1,
} from "../../src/supported/records-v1.js";

const sha = (label: string): string => createHash("sha256").update(label).digest("hex");
const digest = /^[a-f0-9]{64}$/;

function source(label = "candidate"): Record<string, unknown> {
  return {
    commitSha256: sha(`${label}:commit`),
    closureMembers: [
      { path: "catalog/component.json", sha256: sha(`${label}:component`) },
      { path: "catalog/lock.json", sha256: sha(`${label}:lock`) },
    ],
    closureSha256: sha(`${label}:closure`),
    repository: "github.com/example/supported-catalog",
    treeSha256: sha(`${label}:tree`),
  };
}

function policyInput(): Record<string, unknown> {
  return {
    adapterIds: ["adapter.catalog", "adapter.license"],
    immutableResolverId: "resolver.github-commit-v1",
    licenseBoundary: { kind: "allowlist", licenseIds: ["Apache-2.0", "MIT"] },
    policyRevisionSha256: sha("policy"),
    promotionRule: { kind: "all-required-platforms" },
    protocol: "SourceWatchPolicyV1",
    provider: "github",
    qualificationProfileSha256: sha("profile"),
    releaseSelector: { branch: "main", kind: "branch" },
    repository: "example/supported-catalog",
    requiredPlatforms: [
      { architecture: "amd64", os: "linux" },
      { architecture: "arm64", os: "linux" },
    ],
    sourceId: "example-supported-catalog",
  };
}

function candidateInput(): Record<string, unknown> {
  return {
    discoveredMetadata: {
      event: "pull-request",
      observedAt: "2026-08-17T00:00:00Z",
      pullNumber: 42,
    },
    discoveryWorkflowIdentity: "workflow:catalog-discovery-v1",
    protocol: "CandidateV1",
    sourceId: "example-supported-catalog",
    sourceWatchPolicySha256: sha("source-policy"),
    subject: source(),
    triggerMetadata: { kind: "schedule", value: "nightly" },
  };
}

function bundleInput(): Record<string, unknown> {
  return {
    annexDescriptors: [
      {
        byteLength: 4,
        descriptorId: "annex.receipt",
        mediaType: "application/json",
        sha256: sha("annex"),
        uri: "annex/receipt.json",
      },
    ],
    candidateSha256: sha("candidate-record"),
    compatibilitySha256: sha("compatibility"),
    detectorReceipts: [
      {
        coverageSha256: sha("coverage"),
        detectorId: "detector.catalog",
        receiptSha256: sha("receipt"),
      },
    ],
    effectResultsSha256: sha("effects"),
    licenseSha256: sha("license"),
    profileSha256: sha("profile"),
    protocol: "QualificationBundleV1",
    provenanceSha256: sha("provenance"),
    recipeSha256: sha("recipe"),
    requiredPlatforms: [{ architecture: "amd64", os: "linux" }],
    sbomSha256: sha("sbom"),
    subject: source(),
  };
}

function promotionInput(): Record<string, unknown> {
  return {
    authority: "authority:catalog-promote-v1",
    candidateIdentitySha256: sha("candidate-identity"),
    candidateSha256: sha("candidate-record"),
    enumeratedClosure: [
      {
        componentSha256: sha("component"),
        profileSha256: sha("profile"),
        recipeSha256: sha("recipe"),
        sourceSha256: sha("source"),
      },
    ],
    evidenceReference: "evidence/promotion.json",
    evidenceSha256: sha("evidence"),
    issuedAt: "2026-08-17T00:00:00Z",
    policyRevisionSha256: sha("policy"),
    protocol: "PromotionDecisionV1",
    qualificationBundleSha256: sha("bundle-record"),
    reasonCodes: ["QUALIFICATION_COMPLETE"],
    result: "promoted",
    workflowIdentity: "workflow:catalog-promote-v1",
  };
}

function headInput(): Record<string, unknown> {
  return {
    catalogSha256: sha("catalog"),
    compatibleEffectVersions: ["1"],
    compatibleSchemaVersions: ["1"],
    previousCatalogHeadSha256: sha("head-1"),
    promotionDecisionSha256: sha("promotion"),
    protocol: "CatalogHeadV1",
    sequence: 2,
    signerIdentity: "signer:catalog-release-v1",
    validFrom: "2026-08-17T00:00:00Z",
    validUntil: "2026-08-18T00:00:00Z",
  };
}

function firstRecord(value: unknown): Record<string, unknown> {
  if (
    !Array.isArray(value) ||
    value[0] === undefined ||
    typeof value[0] !== "object" ||
    value[0] === null
  )
    throw new Error("fixture must contain a record");
  return value[0] as Record<string, unknown>;
}

function exactKeys(value: object, expected: string[]): void {
  expect(Object.keys(value).sort()).toEqual([...expected].sort());
}

describe("SourceWatchPolicyV1 and CandidateV1", () => {
  it("models the full closed policy record and schema-sorts data-only arrays", () => {
    const policy = createSourceWatchPolicyV1(policyInput());
    exactKeys(policy, [
      "adapterIds",
      "immutableResolverId",
      "licenseBoundary",
      "policyRevisionSha256",
      "policySha256",
      "promotionRule",
      "protocol",
      "provider",
      "qualificationProfileSha256",
      "releaseSelector",
      "repository",
      "requiredPlatforms",
      "sourceId",
    ]);
    expect(policy.requiredPlatforms).toEqual([
      { architecture: "amd64", os: "linux" },
      { architecture: "arm64", os: "linux" },
    ]);
    expect(Object.isFrozen(policy.requiredPlatforms)).toBe(true);
    expect(canonicalSourceWatchPolicyV1Bytes(policy)).toEqual(
      canonicalSourceWatchPolicyV1Bytes(policy),
    );
    for (const field of [
      "immutableResolverId",
      "policyRevisionSha256",
      "qualificationProfileSha256",
      "repository",
      "sourceId",
    ])
      expect(
        createSourceWatchPolicyV1({
          ...policyInput(),
          [field]: field.endsWith("Sha256")
            ? sha(`changed:${field}`)
            : field === "repository"
              ? "changed/repository"
              : field === "sourceId"
                ? "changed-source-id"
                : field === "immutableResolverId"
                  ? "resolver.changed-v1"
                  : `changed-${field}`,
        }).policySha256,
      ).not.toBe(policy.policySha256);
    for (const malformed of [
      {
        protocol: "SourceWatchPolicyV1",
        allowedRepositories: ["github.com/example/supported-catalog"],
      },
      { ...policyInput(), rollbackOf: sha("forbidden") },
      { ...policyInput(), repository: "Example/supported-catalog" },
      { ...policyInput(), adapterIds: ["adapter.catalog", "adapter.catalog"] },
      { ...policyInput(), releaseSelector: { branch: "main", command: "run" } },
      { ...policyInput(), licenseBoundary: { kind: "allowlist", prose: "not data" } },
      { ...policyInput(), credential: "secret" },
    ])
      expect(() => createSourceWatchPolicyV1(malformed)).toThrow();
  });

  it("keeps discovered metadata out of immutable identity and rejects authorization/signing fields", () => {
    const baseline = createCandidateV1(candidateInput());
    exactKeys(baseline, [
      "candidateIdentitySha256",
      "candidateSha256",
      "discoveredMetadata",
      "discoveryWorkflowIdentity",
      "protocol",
      "sourceId",
      "sourceWatchPolicySha256",
      "subject",
      "triggerMetadata",
    ]);
    const metadataChanged = createCandidateV1({
      ...candidateInput(),
      discoveredMetadata: { event: "webhook", observedAt: "2026-08-17T01:00:00Z", pullNumber: 43 },
      triggerMetadata: { kind: "manual", value: "operator" },
    });
    expect(metadataChanged.candidateIdentitySha256).toBe(baseline.candidateIdentitySha256);
    expect(metadataChanged.candidateSha256).not.toBe(baseline.candidateSha256);
    for (const field of ["commitSha256", "treeSha256", "closureSha256"])
      expect(
        createCandidateV1({
          ...candidateInput(),
          subject: { ...source(), [field]: sha(`changed:${field}`) },
        }).candidateIdentitySha256,
      ).not.toBe(baseline.candidateIdentitySha256);
    for (const field of ["signerIdentity", "authority", "signature", "approval", "credential"])
      expect(() => createCandidateV1({ ...candidateInput(), [field]: "forbidden" })).toThrow();
  });

  it("rejects aliases/hash grammar and parses only canonical closed candidate/policy JSON", () => {
    for (const subject of [
      { ...source(), repository: "main" },
      { ...source(), repository: "latest" },
      { ...source(), repository: "github.com/EXAMPLE/supported-catalog" },
      { ...source(), repository: "github.com/example/../supported-catalog" },
      { ...source(), closureMembers: [{ path: "../escape", sha256: sha("x") }] },
    ])
      expect(() => createCandidateV1({ ...candidateInput(), subject })).toThrow();
    for (const value of [`sha256:${sha("prefix")}`, sha("upper").toUpperCase(), "a".repeat(63), {}])
      expect(() =>
        createCandidateV1({ ...candidateInput(), sourceWatchPolicySha256: value }),
      ).toThrow();
    const candidate = createCandidateV1(candidateInput());
    expect(parseCandidateV1Json(canonicalCandidateV1Bytes(candidate).toString("utf8"))).toEqual(
      candidate,
    );
    for (const text of [
      JSON.stringify({ ...candidate, extra: true }),
      JSON.stringify({ ...candidate, subject: { ...candidate.subject, extra: true } }),
      '{"protocol":"CandidateV1","protocol":"CandidateV1"}',
      `${canonicalCandidateV1Bytes(candidate).toString("utf8")} `,
    ])
      expect(() => parseCandidateV1Json(text)).toThrow();
    const policy = createSourceWatchPolicyV1(policyInput());
    expect(
      parseSourceWatchPolicyV1Json(canonicalSourceWatchPolicyV1Bytes(policy).toString("utf8")),
    ).toEqual(policy);
  });
});

describe("QualificationBundleV1, PromotionDecisionV1, and CatalogHeadV1", () => {
  it("requires complete, closed qualification facets and binds each typed digest", () => {
    const bundle = createQualificationBundleV1(bundleInput());
    expect(bundle.bundleSha256).toMatch(digest);
    expect(Object.isFrozen(bundle.detectorReceipts[0])).toBe(true);
    expect(
      parseQualificationBundleV1Json(canonicalQualificationBundleV1Bytes(bundle).toString("utf8")),
    ).toEqual(bundle);
    for (const field of [
      "candidateSha256",
      "profileSha256",
      "recipeSha256",
      "provenanceSha256",
      "licenseSha256",
      "sbomSha256",
      "compatibilitySha256",
      "effectResultsSha256",
    ])
      expect(
        createQualificationBundleV1({ ...bundleInput(), [field]: sha(`changed:${field}`) })
          .bundleSha256,
      ).not.toBe(bundle.bundleSha256);
    for (const malformed of [
      { ...bundleInput(), sbomSha256: undefined },
      { ...bundleInput(), detectorReceipts: [] },
      { ...bundleInput(), requiredPlatforms: [] },
      { ...bundleInput(), annexDescriptors: [] },
      { ...bundleInput(), extra: true },
      {
        ...bundleInput(),
        detectorReceipts: [{ ...firstRecord(bundleInput().detectorReceipts), extra: true }],
      },
      {
        ...bundleInput(),
        annexDescriptors: [{ ...firstRecord(bundleInput().annexDescriptors), extra: true }],
      },
    ])
      expect(() => createQualificationBundleV1(malformed)).toThrow();
  });

  it("schema-sorts identity arrays by raw UTF-16 code units rather than locale collation", () => {
    const rawSort = (values: readonly string[]): string[] =>
      [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    const candidate = createCandidateV1({
      ...candidateInput(),
      subject: {
        ...source(),
        closureMembers: [
          { path: "catalog/a", sha256: sha("lower") },
          { path: "catalog/Z", sha256: sha("upper") },
          { path: "catalog/_", sha256: sha("underscore") },
        ],
      },
    });
    expect(candidate.subject.closureMembers.map((member) => member.path)).toEqual(
      rawSort(["catalog/a", "catalog/Z", "catalog/_"]),
    );
    const bundle = createQualificationBundleV1({
      ...bundleInput(),
      annexDescriptors: [
        { ...firstRecord(bundleInput().annexDescriptors), descriptorId: "annex.a" },
        { ...firstRecord(bundleInput().annexDescriptors), descriptorId: "annex.Z" },
        { ...firstRecord(bundleInput().annexDescriptors), descriptorId: "annex._" },
      ],
      detectorReceipts: [
        { ...firstRecord(bundleInput().detectorReceipts), detectorId: "detector.a" },
        { ...firstRecord(bundleInput().detectorReceipts), detectorId: "detector.Z" },
        { ...firstRecord(bundleInput().detectorReceipts), detectorId: "detector._" },
      ],
      requiredPlatforms: [
        { architecture: "a-a", os: "linux" },
        { architecture: "a.a", os: "linux" },
        { architecture: "a_a", os: "linux" },
      ],
    });
    const sortedBundle = bundle as unknown as {
      readonly annexDescriptors: readonly Readonly<{ descriptorId: string }>[];
      readonly detectorReceipts: readonly Readonly<{ detectorId: string }>[];
      readonly requiredPlatforms: readonly Readonly<{ architecture: string; os: string }>[];
    };
    expect(sortedBundle.annexDescriptors.map((descriptor) => descriptor.descriptorId)).toEqual(
      rawSort(["annex.a", "annex.Z", "annex._"]),
    );
    expect(sortedBundle.detectorReceipts.map((receipt) => receipt.detectorId)).toEqual(
      rawSort(["detector.a", "detector.Z", "detector._"]),
    );
    expect(
      sortedBundle.requiredPlatforms.map((platform) => `${platform.os}/${platform.architecture}`),
    ).toEqual(rawSort(["linux/a-a", "linux/a.a", "linux/a_a"]));
  });

  it("keeps promotion authority separate from catalog continuity and binds every decision field", () => {
    const decision = createPromotionDecisionV1(promotionInput());
    exactKeys(decision, [
      "authority",
      "candidateIdentitySha256",
      "candidateSha256",
      "enumeratedClosure",
      "evidenceReference",
      "evidenceSha256",
      "issuedAt",
      "policyRevisionSha256",
      "promotionDecisionSha256",
      "protocol",
      "qualificationBundleSha256",
      "reasonCodes",
      "result",
      "workflowIdentity",
    ]);
    for (const field of [
      "candidateIdentitySha256",
      "candidateSha256",
      "qualificationBundleSha256",
      "evidenceSha256",
      "policyRevisionSha256",
      "authority",
      "workflowIdentity",
    ])
      expect(
        createPromotionDecisionV1({ ...promotionInput(), [field]: sha(`changed:${field}`) })
          .promotionDecisionSha256,
      ).not.toBe(decision.promotionDecisionSha256);
    for (const malformed of [
      { ...promotionInput(), sequence: 2 },
      { ...promotionInput(), catalogSha256: sha("wrong-layer") },
      { ...promotionInput(), reasonCodes: [] },
      { ...promotionInput(), workflowIdentity: "workflow:catalog-discovery-v1" },
      { ...promotionInput(), authority: "*" },
      { ...promotionInput(), issuedAt: "2026-02-30T00:00:00Z" },
      { ...promotionInput(), enumeratedClosure: [{ sourceSha256: sha("source") }] },
      {
        ...promotionInput(),
        enumeratedClosure: [
          { ...firstRecord(promotionInput().enumeratedClosure), futureBytes: true },
        ],
      },
    ])
      expect(() => createPromotionDecisionV1(malformed)).toThrow();
    const canonical = canonicalPromotionDecisionV1Bytes(decision).toString("utf8");
    expect(parsePromotionDecisionV1Json(canonical)).toEqual(decision);
    for (const text of [
      `${canonical} `,
      JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(canonical)).reverse())),
      canonical.replace("PromotionDecisionV1", "Promotion\\u0044ecisionV1"),
    ])
      expect(() => parsePromotionDecisionV1Json(text)).toThrow();
    for (const result of ["accepted", "rejected", "pass"])
      expect(() => createPromotionDecisionV1({ ...promotionInput(), result })).toThrow();
  });

  it("puts only continuity/version validity in the head and verifies an external DSSE envelope", () => {
    const head = createCatalogHeadV1(headInput());
    exactKeys(head, [
      "catalogHeadSha256",
      "catalogSha256",
      "compatibleEffectVersions",
      "compatibleSchemaVersions",
      "previousCatalogHeadSha256",
      "promotionDecisionSha256",
      "protocol",
      "sequence",
      "signerIdentity",
      "validFrom",
      "validUntil",
    ]);
    expect(canonicalCatalogHeadV1Bytes(head)).toEqual(canonicalCatalogHeadV1Bytes(head));
    expect(parseCatalogHeadV1Json(canonicalCatalogHeadV1Bytes(head).toString("utf8"))).toEqual(
      head,
    );
    const envelope = createDsseEnvelopeV1({
      payloadType: "application/vnd.in-toto+json",
      recordDigestSha256: head.catalogHeadSha256,
      recordType: "CatalogHeadV1",
      signerIdentity: head.signerIdentity,
      signatures: [{ keyid: "key.catalog.release", sig: "c2lnbmF0dXJl" }],
    });
    exactKeys(envelope, ["payload", "payloadType", "signatures"]);
    expect(envelope.payload).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
    const statement = {
      _type: "https://in-toto.io/Statement/v1",
      predicate: {
        protocol: "SupportedRecordPredicateV1",
        recordType: "CatalogHeadV1",
        signerIdentity: head.signerIdentity,
      },
      predicateType: "https://aih.dev/SupportedRecordV1",
      subject: [
        {
          digest: { sha256: head.catalogHeadSha256 },
          name: "aih-supported/CatalogHeadV1",
        },
      ],
    };
    const statementBytes = Buffer.from(JSON.stringify(statement), "utf8");
    const decodedPayload = Buffer.from(envelope.payload, "base64");
    expect(decodedPayload).toEqual(statementBytes);
    expect(JSON.parse(decodedPayload.toString("utf8"))).toEqual(statement);
    expect(
      parseDsseEnvelopeV1Json(canonicalDsseEnvelopeV1Bytes(envelope).toString("utf8")),
    ).toEqual(envelope);
    const verifyCanonicalPae = vi.fn((request: Record<string, unknown>) => {
      expect(request).toMatchObject({
        expectedRecordDigestSha256: head.catalogHeadSha256,
        expectedRecordType: "CatalogHeadV1",
        expectedSignerIdentity: head.signerIdentity,
        signatures: envelope.signatures,
      });
      expect(request.paeBytes).toEqual(
        Buffer.concat([
          Buffer.from(
            `DSSEv1 ${String(Buffer.byteLength(envelope.payloadType, "utf8"))} ${envelope.payloadType} ${String(decodedPayload.length)} `,
            "utf8",
          ),
          decodedPayload,
        ]),
      );
      return true;
    });
    const envelopeContext = {
      expectedRecordDigestSha256: head.catalogHeadSha256,
      expectedRecordType: "CatalogHeadV1",
      expectedSignerIdentity: head.signerIdentity,
    };
    expect(verifyDsseEnvelopeV1({ envelope, ...envelopeContext }, { verifyCanonicalPae })).toEqual(
      envelope,
    );
    const changedSignature = createDsseEnvelopeV1({
      payloadType: envelope.payloadType,
      recordDigestSha256: head.catalogHeadSha256,
      recordType: "CatalogHeadV1",
      signerIdentity: head.signerIdentity,
      signatures: [{ keyid: "key.catalog.release", sig: "YWx0ZXJuYXRlLXNpZ25hdHVyZQ==" }],
    });
    const verifyChangedSignature = vi.fn(() => true);
    expect(
      verifyDsseEnvelopeV1(
        { envelope: changedSignature, ...envelopeContext },
        { verifyCanonicalPae: verifyChangedSignature },
      ),
    ).toEqual(changedSignature);
    expect(verifyChangedSignature).toHaveBeenCalledWith(
      expect.objectContaining({ signatures: changedSignature.signatures }),
    );
    for (const changed of [
      { ...envelope, payload: "bm90LXRoaXMtc3RhdGVtZW50" },
      { ...envelope, payloadType: "application/json" },
      { ...envelope, signatures: [] },
      { ...envelope, signatures: [{ keyid: "key.catalog.release", sig: "" }] },
      {
        ...envelope,
        signatures: [
          { keyid: "key.catalog.release", sig: "c2lnbmF0dXJl" },
          { keyid: "key.catalog.release", sig: "YW5vdGhlci1zaWc=" },
        ],
      },
      {
        ...envelope,
        payload: Buffer.from(
          JSON.stringify({
            ...statement,
            predicate: { ...statement.predicate, recordType: "CandidateV1" },
          }),
          "utf8",
        ).toString("base64"),
      },
      {
        ...envelope,
        payload: Buffer.from(
          JSON.stringify({
            ...statement,
            predicate: { ...statement.predicate, signerIdentity: "workflow:catalog-discovery-v1" },
          }),
          "utf8",
        ).toString("base64"),
      },
      {
        ...envelope,
        payload: Buffer.from(
          JSON.stringify({
            ...statement,
            subject: [{ ...statement.subject[0], name: "aih-supported/CandidateV1" }],
          }),
          "utf8",
        ).toString("base64"),
      },
      {
        ...envelope,
        payload: Buffer.from(
          JSON.stringify({
            ...statement,
            subject: [{ ...statement.subject[0], digest: { sha256: sha("wrong-subject") } }],
          }),
          "utf8",
        ).toString("base64"),
      },
      {
        ...envelope,
        payload: Buffer.from(
          JSON.stringify({ ...statement, predicateType: "https://aih.dev/OtherRecordV1" }),
          "utf8",
        ).toString("base64"),
      },
      {
        ...envelope,
        payload: Buffer.from(JSON.stringify({ ...statement, extra: true }), "utf8").toString(
          "base64",
        ),
      },
    ])
      expect(() =>
        verifyDsseEnvelopeV1(
          { envelope: changed, ...envelopeContext },
          { verifyCanonicalPae: () => true },
        ),
      ).toThrow();
    for (const malformed of [
      { ...headInput(), candidateSha256: sha("wrong-layer") },
      { ...headInput(), rollbackOf: sha("forbidden") },
      { ...headInput(), protocol: "CatalogHeadV2" },
      { ...headInput(), compatibleSchemaVersions: ["2"] },
      { ...headInput(), validFrom: "2026-08-19T00:00:00Z", validUntil: "2026-08-18T00:00:00Z" },
      { ...headInput(), validFrom: "2026-02-30T00:00:00Z" },
    ])
      expect(() => createCatalogHeadV1(malformed)).toThrow();
  });

  it("uses typed verifier context to preserve last-good on replay, mutation, expiry, or DSSE failure", () => {
    const lastGood = createCatalogHeadV1({
      ...headInput(),
      previousCatalogHeadSha256: sha("genesis"),
      sequence: 1,
    });
    const next = createCatalogHeadV1({
      ...headInput(),
      catalogSha256: sha("catalog-next"),
      previousCatalogHeadSha256: lastGood.catalogHeadSha256,
    });
    const context = {
      expectedAuthority: "authority:catalog-promote-v1",
      expectedCandidateIdentitySha256: sha("candidate-identity"),
      expectedCandidateSha256: sha("candidate-record"),
      expectedCatalogSha256: next.catalogSha256,
      expectedEvidenceSha256: sha("evidence"),
      expectedPolicyRevisionSha256: sha("policy"),
      expectedProfileSha256: sha("profile"),
      expectedPromotionDecisionSha256: next.promotionDecisionSha256,
      expectedQualificationBundleSha256: sha("bundle-record"),
      expectedRecipeSha256: sha("recipe"),
      expectedSignerIdentity: "signer:catalog-release-v1",
      expectedWorkflowIdentity: "workflow:catalog-promote-v1",
    };
    const envelope = createDsseEnvelopeV1({
      payloadType: "application/vnd.in-toto+json",
      recordDigestSha256: next.catalogHeadSha256,
      recordType: "CatalogHeadV1",
      signerIdentity: next.signerIdentity,
      signatures: [{ keyid: "key.catalog.release", sig: "c2lnbmF0dXJl" }],
    });
    const verifyCanonicalBytes = vi.fn((request: Record<string, unknown>) => {
      expect(request).toEqual({
        context,
        envelope,
        expectedSignerIdentity: context.expectedSignerIdentity,
        headBytes: canonicalCatalogHeadV1Bytes(next),
      });
      return true;
    });
    expect(
      verifyCatalogHeadV1({ envelope, head: next, context }, { verifyCanonicalBytes }),
    ).toEqual(next);
    expect(verifyCanonicalBytes).toHaveBeenCalledOnce();
    expect(
      resolveCatalogHeadV1({
        context,
        envelope,
        lastGood,
        next,
        now: "2026-08-17T12:00:00Z",
        verifier: { verifyCanonicalBytes: () => true },
      }),
    ).toEqual({ kind: "advanced", head: next });
    expect(
      resolveCatalogHeadV1({
        context,
        envelope,
        lastGood,
        next,
        now: "2026-08-17T12:00:00Z",
        verifier: { verifyCanonicalBytes: () => false },
      }),
    ).toEqual({ kind: "last-good", head: lastGood });
    for (const rejected of [
      { ...next, sequence: 1, validUntil: "2026-08-20T00:00:00Z" },
      { ...next, sequence: 0 },
      { ...next, sequence: 2, catalogSha256: sha("mutated-catalog") },
      { ...next, previousCatalogHeadSha256: sha("broken") },
      { ...next, compatibleEffectVersions: ["2"] },
      { ...next, compatibleSchemaVersions: ["2"] },
      { ...next, validUntil: "2026-08-17T12:01:00Z" },
    ])
      expect(
        resolveCatalogHeadV1({
          context,
          envelope,
          lastGood,
          next: rejected,
          now: "2026-08-17T12:00:00Z",
          verifier: { verifyCanonicalBytes: () => true },
        }),
      ).toEqual({ kind: "last-good", head: lastGood });

    const selfClaimedSigner = createCatalogHeadV1({
      ...headInput(),
      catalogSha256: next.catalogSha256,
      previousCatalogHeadSha256: lastGood.catalogHeadSha256,
      sequence: next.sequence,
      signerIdentity: "signer:self-claimed-v1",
    });
    const selfClaimedEnvelope = createDsseEnvelopeV1({
      payloadType: "application/vnd.in-toto+json",
      recordDigestSha256: selfClaimedSigner.catalogHeadSha256,
      recordType: "CatalogHeadV1",
      signerIdentity: selfClaimedSigner.signerIdentity,
      signatures: [{ keyid: "key.catalog.release", sig: "c2VsZi1jbGFpbWVk" }],
    });
    expect(() =>
      verifyCatalogHeadV1(
        { envelope: selfClaimedEnvelope, head: selfClaimedSigner, context },
        { verifyCanonicalBytes: () => true },
      ),
    ).toThrow();
  });
});
