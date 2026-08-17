import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalCandidateV1Bytes,
  canonicalCatalogHeadV1Bytes,
  canonicalQualificationBundleV1Bytes,
  canonicalSourceWatchPolicyV1Bytes,
  createCandidateV1,
  createCatalogHeadV1,
  createPromotionDecisionV1,
  createQualificationBundleV1,
  createSourceWatchPolicyV1,
  parseCandidateV1Json,
  parseCatalogHeadV1Json,
  parsePromotionDecisionV1Json,
  parseQualificationBundleV1Json,
  parseSourceWatchPolicyV1Json,
  resolveCatalogHeadV1,
  verifyCatalogHeadV1,
} from "../../src/supported/records-v1.js";

const sha = (label: string): string => createHash("sha256").update(label).digest("hex");
const digest = /^[a-f0-9]{64}$/;

function source(label = "candidate"): Record<string, unknown> {
  return {
    repository: "github.com/example/supported-catalog",
    commitSha256: sha(`${label}:commit`),
    treeSha256: sha(`${label}:tree`),
    closureSha256: sha(`${label}:closure`),
    closureMembers: [
      { path: "catalog/component.json", sha256: sha(`${label}:component`) },
      { path: "catalog/lock.json", sha256: sha(`${label}:lock`) },
    ],
  };
}

function candidateInput(): Record<string, unknown> {
  return {
    protocol: "CandidateV1",
    subject: source(),
    signerIdentity: "workflow:example/supported-catalog",
    workflowIdentity: "workflow:catalog-verify-v1",
    authority: "source-watch",
    policyRevisionSha256: sha("policy"),
    profileSha256: sha("profile"),
    recipeSha256: sha("recipe"),
    triggers: [{ kind: "pull-request", value: "42" }],
  };
}

function bundleInput(): Record<string, unknown> {
  return {
    protocol: "QualificationBundleV1",
    subject: source(),
    candidateSha256: sha("candidate-record"),
    profileSha256: sha("profile"),
    recipeSha256: sha("recipe"),
    requiredPlatforms: [{ architecture: "amd64", os: "linux" }],
    detectorReceipts: [
      {
        coverageSha256: sha("coverage"),
        detectorId: "detector.catalog",
        receiptSha256: sha("receipt"),
      },
    ],
    provenanceSha256: sha("provenance"),
    licenseSha256: sha("license"),
    sbomSha256: sha("sbom"),
    compatibilitySha256: sha("compatibility"),
    effectResultsSha256: sha("effects"),
    annexDescriptors: [
      {
        byteLength: 4,
        descriptorId: "annex.receipt",
        mediaType: "application/json",
        sha256: sha("annex"),
        uri: "annex/receipt.json",
      },
    ],
  };
}

function promotionInput(): Record<string, unknown> {
  return {
    protocol: "PromotionDecisionV1",
    catalogId: "catalog.supported",
    sequence: 2,
    previousCatalogHeadSha256: sha("head-1"),
    candidateSha256: sha("candidate-record"),
    qualificationBundleSha256: sha("bundle-record"),
    policyRevisionSha256: sha("policy"),
    createdAt: "2026-08-17T00:00:00Z",
    expiresAt: "2026-08-18T00:00:00Z",
  };
}

function headInput(): Record<string, unknown> {
  return {
    protocol: "CatalogHeadV1",
    effectVersion: "1",
    ...promotionInput(),
    signerIdentity: "workflow:example/supported-catalog",
    workflowIdentity: "workflow:catalog-promote-v1",
    signature: { keyId: "test-key", payloadSha256: sha("payload"), signature: "test-signature" },
  };
}

function exactKeys(value: object, expected: string[]): void {
  expect(Object.keys(value).sort()).toEqual([...expected].sort());
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

describe("supported candidate and source-watch policy v1", () => {
  it("binds exact immutable source, authority, and opaque profile/recipe digests", () => {
    const policy = createSourceWatchPolicyV1({
      protocol: "SourceWatchPolicyV1",
      allowedRepositories: ["github.com/example/supported-catalog"],
      allowedAuthorities: ["source-watch"],
      policyRevisionSha256: sha("policy"),
    });
    expect(policy.policySha256).toMatch(digest);
    expect(canonicalSourceWatchPolicyV1Bytes(policy)).toEqual(
      canonicalSourceWatchPolicyV1Bytes(policy),
    );
    expect(Object.isFrozen(policy)).toBe(true);

    const candidate = createCandidateV1(candidateInput());
    exactKeys(candidate, [
      "authority",
      "candidateIdentitySha256",
      "candidateSha256",
      "policyRevisionSha256",
      "profileSha256",
      "protocol",
      "recipeSha256",
      "signerIdentity",
      "subject",
      "triggers",
      "workflowIdentity",
    ]);
    expect(candidate.candidateIdentitySha256).toMatch(digest);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.subject)).toBe(true);
    expect(Object.isFrozen(candidate.subject.closureMembers)).toBe(true);
    expect(JSON.stringify(candidate)).not.toMatch(/approve|accept|signature|head/i);
  });

  it("treats triggers as metadata but changes identity when any security field changes", () => {
    const baseline = createCandidateV1(candidateInput());
    const changedTrigger = createCandidateV1({
      ...candidateInput(),
      triggers: [{ kind: "manual", value: "operator-request" }],
    });
    expect(changedTrigger.candidateIdentitySha256).toBe(baseline.candidateIdentitySha256);

    for (const field of [
      "commitSha256",
      "treeSha256",
      "closureSha256",
      "signerIdentity",
      "workflowIdentity",
      "authority",
      "policyRevisionSha256",
      "profileSha256",
      "recipeSha256",
    ]) {
      const input = structuredClone(candidateInput()) as Record<string, unknown>;
      if (
        field.endsWith("Sha256") &&
        ["commitSha256", "treeSha256", "closureSha256"].includes(field)
      ) {
        (input.subject as Record<string, unknown>)[field] = sha(`changed:${field}`);
      } else input[field] = field.endsWith("Sha256") ? sha(`changed:${field}`) : `changed:${field}`;
      expect(createCandidateV1(input).candidateIdentitySha256, field).not.toBe(
        baseline.candidateIdentitySha256,
      );
    }
  });

  it("rejects mutable aliases, invalid source facets, unknown fields, and forged candidates", () => {
    for (const repository of [
      "main",
      "v1.2.3",
      "latest",
      "https://github.com/example/supported-catalog",
      "github.com/EXAMPLE/supported-catalog",
      "github.com/example/../supported-catalog",
    ])
      expect(() =>
        createCandidateV1({ ...candidateInput(), subject: { ...source(), repository } }),
      ).toThrow();

    for (const input of [
      { ...candidateInput(), accepted: true },
      { ...candidateInput(), subject: { ...source(), ref: "refs/heads/main" } },
      {
        ...candidateInput(),
        subject: { ...source(), closureMembers: [{ path: "../escape", sha256: sha("x") }] },
      },
      {
        ...candidateInput(),
        subject: {
          ...source(),
          closureMembers: [
            { path: "catalog/a", sha256: sha("x") },
            { path: "catalog/a", sha256: sha("y") },
          ],
        },
      },
    ])
      expect(() => createCandidateV1(input)).toThrow();

    const candidate = createCandidateV1(candidateInput());
    expect(() => canonicalCandidateV1Bytes({ ...candidate })).toThrow();
    expect(() =>
      parseCandidateV1Json('{"protocol":"CandidateV1","protocol":"CandidateV1"}'),
    ).toThrow();
    expect(() => parseCandidateV1Json(JSON.stringify({ ...candidate, extra: true }))).toThrow();
  });

  it("rejects sha256 grammar violations and typed security-field swaps", () => {
    const baseline = createCandidateV1(candidateInput());
    for (const value of [
      `sha256:${sha("prefix")}`,
      sha("uppercase").toUpperCase(),
      "a".repeat(63),
      "g".repeat(64),
      { sha256: sha("object") },
    ])
      expect(() => createCandidateV1({ ...candidateInput(), profileSha256: value })).toThrow();
    const swapped = createCandidateV1({
      ...candidateInput(),
      profileSha256: candidateInput().recipeSha256,
      recipeSha256: candidateInput().profileSha256,
    });
    expect(swapped.candidateIdentitySha256).not.toBe(baseline.candidateIdentitySha256);
  });

  it("parses only canonical closed candidate/policy JSON", () => {
    const policy = createSourceWatchPolicyV1({
      protocol: "SourceWatchPolicyV1",
      allowedRepositories: ["github.com/example/supported-catalog"],
      allowedAuthorities: ["source-watch"],
      policyRevisionSha256: sha("policy"),
    });
    const candidate = createCandidateV1(candidateInput());
    expect(parseSourceWatchPolicyV1Json(JSON.stringify(policy))).toEqual(policy);
    expect(parseCandidateV1Json(canonicalCandidateV1Bytes(candidate).toString("utf8"))).toEqual(
      candidate,
    );
    for (const text of [
      JSON.stringify({ ...policy, extra: true }),
      JSON.stringify({ ...candidate, subject: { ...candidate.subject, extra: true } }),
      JSON.stringify({
        ...candidate,
        subject: {
          ...candidate.subject,
          closureMembers: [{ ...candidate.subject.closureMembers[0], extra: true }],
        },
      }),
      '{"protocol":"CandidateV1","protocol":"CandidateV1"}',
    ])
      expect(() =>
        text.includes("SourceWatch")
          ? parseSourceWatchPolicyV1Json(text)
          : parseCandidateV1Json(text),
      ).toThrow();
  });
});

describe("qualification bundle, promotion decision, and catalog head v1", () => {
  it("requires complete unambiguous immutable qualification facets", () => {
    const bundle = createQualificationBundleV1(bundleInput());
    exactKeys(bundle, [
      "annexDescriptors",
      "bundleSha256",
      "candidateSha256",
      "compatibilitySha256",
      "detectorReceipts",
      "effectResultsSha256",
      "licenseSha256",
      "profileSha256",
      "protocol",
      "provenanceSha256",
      "recipeSha256",
      "requiredPlatforms",
      "sbomSha256",
      "subject",
    ]);
    expect(
      canonicalQualificationBundleV1Bytes(bundle).equals(
        canonicalQualificationBundleV1Bytes(bundle),
      ),
    ).toBe(true);
    expect(Object.isFrozen(bundle.detectorReceipts[0])).toBe(true);

    const missing = structuredClone(bundleInput()) as Record<string, unknown>;
    delete missing.sbomSha256;
    expect(() => createQualificationBundleV1(missing)).toThrow();
    for (const field of ["detectorReceipts", "requiredPlatforms", "annexDescriptors"])
      expect(() => createQualificationBundleV1({ ...bundleInput(), [field]: [] })).toThrow();
    expect(() =>
      createQualificationBundleV1({
        ...bundleInput(),
        detectorReceipts: [bundleInput().detectorReceipts, bundleInput().detectorReceipts].flat(),
      }),
    ).toThrow();

    for (const field of [
      "candidateSha256",
      "profileSha256",
      "recipeSha256",
      "provenanceSha256",
      "licenseSha256",
      "sbomSha256",
      "compatibilitySha256",
      "effectResultsSha256",
    ]) {
      expect(
        createQualificationBundleV1({ ...bundleInput(), [field]: sha(`changed:${field}`) })
          .bundleSha256,
      ).not.toBe(bundle.bundleSha256);
    }
    for (const malformed of [
      { ...bundleInput(), extra: true },
      {
        ...bundleInput(),
        requiredPlatforms: [{ architecture: "amd64", os: "linux", extra: true }],
      },
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
    expect(
      parseQualificationBundleV1Json(canonicalQualificationBundleV1Bytes(bundle).toString("utf8")),
    ).toEqual(bundle);
  });

  it("binds promotion/head continuity, monotonicity, windows, and external signature verification", () => {
    const decision = createPromotionDecisionV1(promotionInput());
    const head = createCatalogHeadV1(headInput());
    expect(decision.promotionDecisionSha256).toMatch(digest);
    expect(head.catalogHeadSha256).toMatch(digest);
    expect(canonicalCatalogHeadV1Bytes(head).equals(canonicalCatalogHeadV1Bytes(head))).toBe(true);
    expect(Object.isFrozen(head.signature)).toBe(true);

    const verifyCanonicalBytes = vi.fn((request: Record<string, unknown>) => {
      expect(request).toMatchObject({
        payloadDigestSha256: expect.stringMatching(digest),
        recordType: "CatalogHeadV1",
        signerIdentity: "workflow:example/supported-catalog",
      });
      expect(Buffer.isBuffer(request.payloadBytes)).toBe(true);
      expect(request.payloadBytes).toEqual(canonicalCatalogHeadV1Bytes(head));
      expect(request.payloadDigestSha256).toBe(
        createHash("sha256").update(canonicalCatalogHeadV1Bytes(head)).digest("hex"),
      );
      return true;
    });
    expect(
      verifyCatalogHeadV1(
        {
          expectedCandidateSha256: head.candidateSha256,
          expectedCatalogId: "catalog.supported",
          head,
        },
        { verifyCanonicalBytes },
      ),
    ).toEqual(head);
    expect(verifyCanonicalBytes).toHaveBeenCalledOnce();
    expect(() =>
      verifyCatalogHeadV1(
        {
          expectedCandidateSha256: sha("wrong-candidate"),
          expectedCatalogId: "catalog.supported",
          head,
        },
        { verifyCanonicalBytes: () => true },
      ),
    ).toThrow();
    expect(() =>
      verifyCatalogHeadV1(
        {
          expectedCandidateSha256: head.candidateSha256,
          expectedCatalogId: "catalog.supported",
          head: { ...head, candidateSha256: sha("mutated") },
        },
        { verifyCanonicalBytes: () => true },
      ),
    ).toThrow();
    expect(() =>
      verifyCatalogHeadV1(
        {
          expectedCandidateSha256: head.candidateSha256,
          expectedCatalogId: "catalog.supported",
          head: { ...head, protocol: "CandidateV1" },
        },
        { verifyCanonicalBytes: () => true },
      ),
    ).toThrow();
    expect(() =>
      verifyCatalogHeadV1(
        {
          expectedCandidateSha256: head.candidateSha256,
          expectedCatalogId: "catalog.supported",
          head,
        },
        { verifyCanonicalBytes: () => false },
      ),
    ).toThrow();
    for (const changed of [
      { ...headInput(), sequence: 1 },
      { ...headInput(), previousCatalogHeadSha256: sha("different") },
      { ...headInput(), effectVersion: "2" },
      { ...headInput(), protocol: "CatalogHeadV2" },
      { ...headInput(), createdAt: "2026-08-19T00:00:00Z", expiresAt: "2026-08-18T00:00:00Z" },
      { ...headInput(), expiresAt: "2020-01-01T00:00:00Z" },
      { ...headInput(), rollbackOf: sha("forbidden") },
    ])
      expect(() => createCatalogHeadV1(changed)).toThrow();
    expect(
      parseCatalogHeadV1Json(JSON.stringify({ ...headInput(), expiresAt: "2020-01-01T00:00:00Z" }))
        .expiresAt,
    ).toBe("2020-01-01T00:00:00Z");
    expect(parsePromotionDecisionV1Json(JSON.stringify(decision))).toEqual(decision);
  });

  it("retains the last-good visible head when verification, expiry, or continuity rejects a next head", () => {
    const lastGood = createCatalogHeadV1({
      ...headInput(),
      sequence: 1,
      previousCatalogHeadSha256: sha("genesis"),
    });
    const next = createCatalogHeadV1({
      ...headInput(),
      previousCatalogHeadSha256: lastGood.catalogHeadSha256,
    });
    const accepted = resolveCatalogHeadV1({
      lastGood,
      next,
      now: "2026-08-17T12:00:00Z",
      verifier: { verifyCanonicalBytes: () => true },
    });
    expect(accepted).toEqual({ kind: "advanced", head: next });
    for (const rejected of [
      { ...next, sequence: 1 },
      { ...next, sequence: 1, expiresAt: "2026-08-20T00:00:00Z" },
      { ...next, sequence: 0 },
      { ...next, catalogId: "catalog.other" },
      { ...next, previousCatalogHeadSha256: sha("broken") },
      { ...next, expiresAt: "2026-08-17T12:01:00Z" },
      { ...next, signature: { ...next.signature, signature: "forged" } },
    ]) {
      expect(
        resolveCatalogHeadV1({
          lastGood,
          next: rejected,
          now: "2026-08-17T12:00:00Z",
          verifier: { verifyCanonicalBytes: () => false },
        }),
      ).toEqual({ kind: "last-good", head: lastGood });
    }
    expect(() => parseCatalogHeadV1Json('{"protocol":"CatalogHeadV1",}')).toThrow();
  });
});
