import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createReadOnlyEvaluationV1,
  evaluateStaticPilotV1,
  validateOfflineSourceRequestV1,
} from "../../src/supported/pilot-and-offline-source-v1.js";

const sha = (label: string): string => createHash("sha256").update(label).digest("hex");

const superpowersComponents = [
  "runtime:superpowers-plugin",
  "skill:brainstorming",
  "skill:dispatching-parallel-agents",
  "skill:executing-plans",
  "skill:finishing-a-development-branch",
  "skill:receiving-code-review",
  "skill:requesting-code-review",
  "skill:subagent-driven-development",
  "skill:systematic-debugging",
  "skill:test-driven-development",
  "skill:using-git-worktrees",
  "skill:using-superpowers",
  "skill:verification-before-completion",
  "skill:writing-plans",
  "skill:writing-skills",
] as const;

const pilotInput = {
  protocol: "SupportedStaticPilotV1",
  sources: [
    {
      canonicalHost: "github",
      canonicalRepository: "affaan-m/ecc",
      ledgerDisplayRepository: "affaan-m/ECC",
      activeCommit: "623f2c020f052319657674e4e6c29ab5d0ad566b",
      blockedCandidateCommit: "dcbf95bf63dc67701564198df9c3451940a2ca83",
    },
    {
      canonicalHost: "github",
      canonicalRepository: "obra/superpowers",
      activeCommit: "3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9",
    },
  ],
  evidenceRunId: "31922381993",
  exceptionRows: [
    {
      closureMember: "js-yaml@4.3.1",
      policyRevisionSha256: sha("policy"),
      profileSha256: sha("profile"),
      recipeSha256: sha("recipe"),
      subjectSha256: sha("ecc-subject"),
    },
    {
      closureMember: "js-yaml@4.3.1",
      policyRevisionSha256: sha("policy"),
      profileSha256: sha("profile"),
      recipeSha256: sha("recipe"),
      subjectSha256: sha("ecc-subject"),
    },
  ],
  ecc: {
    assembly: "blocked",
    blocked: 28,
    components: 137,
    newBlockedComponentIds: [],
    passed: 109,
    previewGeneratorClosure: ["js-yaml@4.3.1"],
  },
  superpowers: {
    passedComponentIds: [...superpowersComponents],
    total: 15,
  },
  policyRevisionSha256: sha("policy"),
  profileSha256: sha("profile"),
  recipeSha256: sha("recipe"),
};

describe("supported static pilot v1", () => {
  it("returns exactly one acceptance-required ECC exception and the independent 15-row Superpowers set", () => {
    const result = evaluateStaticPilotV1(pilotInput);
    expect(result.superpowers).toEqual({
      passed: 15,
      passedComponentIds: [...superpowersComponents],
      total: 15,
    });
    expect(result.ecc).toEqual({
      assembly: "blocked",
      blocked: 28,
      components: 137,
      newBlockedComponentIds: [],
      passed: 109,
    });
    expect(result.exceptions).toEqual([
      expect.objectContaining({
        activeCommit: "623f2c020f052319657674e4e6c29ab5d0ad566b",
        blockedCandidateCommit: "dcbf95bf63dc67701564198df9c3451940a2ca83",
        canonicalHost: "github",
        canonicalRepository: "affaan-m/ecc",
        closureMember: "js-yaml@4.3.1",
        reasonCode: "ECC_PREVIEW_DEPENDENCY_CLOSURE_UNQUALIFIED",
        state: "acceptance-required",
        evidenceRunId: "31922381993",
        executedDuringPreview: false,
        activePinChanged: false,
        newMaliciousContentFinding: false,
        lockChanged: false,
        promoted: false,
        projectionChanged: false,
      }),
    ]);
    expect(result.exceptions).toHaveLength(1);
    const expectedDedupeKey = createHash("sha256")
      .update(
        Buffer.from(
          JSON.stringify({
            domain: "aih-supported.exception-dedupe-v1",
            value: {
              policyRevisionSha256: sha("policy"),
              reasonCode: "ECC_PREVIEW_DEPENDENCY_CLOSURE_UNQUALIFIED",
              subjectSha256: sha("ecc-subject"),
            },
          }),
          "utf8",
        ),
      )
      .digest("hex");
    expect(result.exceptions[0]?.dedupeKeySha256).toBe(expectedDedupeKey);
    expect(
      evaluateStaticPilotV1({
        ...pilotInput,
        exceptionRows: [...pilotInput.exceptionRows].reverse(),
      }).exceptions,
    ).toEqual(result.exceptions);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("deduplicates exact rows only and never changes active pins, promotion, or projection", () => {
    const baseline = evaluateStaticPilotV1(pilotInput);
    expect(baseline.exceptions).toHaveLength(1);
    for (const field of ["subjectSha256", "policyRevisionSha256"] as const) {
      const row = {
        ...pilotInput.exceptionRows[0],
        [field]: sha(`changed:${field}`),
      };
      const changed = evaluateStaticPilotV1(
        field === "policyRevisionSha256"
          ? {
              ...pilotInput,
              policyRevisionSha256: row.policyRevisionSha256,
              exceptionRows: pilotInput.exceptionRows.map((entry) => ({
                ...entry,
                policyRevisionSha256: row.policyRevisionSha256,
              })),
            }
          : { ...pilotInput, exceptionRows: [pilotInput.exceptionRows[0], row] },
      );
      expect(changed.exceptions).toHaveLength(field === "policyRevisionSha256" ? 1 : 2);
      expect(changed.exceptions.at(-1)?.dedupeKeySha256).not.toBe(
        baseline.exceptions[0]?.dedupeKeySha256,
      );
    }
    for (const field of ["closureMember", "profileSha256", "recipeSha256"] as const) {
      const value = field === "closureMember" ? "yaml@4.3.1" : sha(`inconsistent:${field}`);
      expect(() =>
        evaluateStaticPilotV1({
          ...pilotInput,
          exceptionRows: [{ ...pilotInput.exceptionRows[0], [field]: value }],
        }),
      ).toThrow();
    }
    expect(JSON.stringify(baseline)).not.toMatch(
      /runtime.?install|activate|catalog.?head|promotion|execution/i,
    );
    expect(() => evaluateStaticPilotV1({ ...pilotInput, duplicateException: true })).toThrow();
  });

  it("rejects repository aliases, duplicate identities, fabricated inventory, and a masking Superpowers pass", () => {
    for (const sources of [
      [{ ...pilotInput.sources[0], canonicalRepository: "affaan-m/ECC" }, pilotInput.sources[1]],
      [pilotInput.sources[0], { ...pilotInput.sources[0] }],
    ])
      expect(() => evaluateStaticPilotV1({ ...pilotInput, sources })).toThrow();

    expect(() =>
      evaluateStaticPilotV1({
        ...pilotInput,
        ecc: { ...pilotInput.ecc, newBlockedComponentIds: ["component.new"] },
      }),
    ).toThrow();
    expect(() =>
      evaluateStaticPilotV1({
        ...pilotInput,
        superpowers: { ...pilotInput.superpowers, passedComponentIds: ["skill:brainstorming"] },
      }),
    ).toThrow();
  });
});

describe("offline source request and read-only evaluation v1", () => {
  it("validates immutable offline fixture requests without contacting a provider", () => {
    const provider = { request: vi.fn() };
    const request = validateOfflineSourceRequestV1({
      protocol: "OfflineSourceRequestV1",
      host: "github",
      repository: "affaan-m/ecc",
      commitSha256: sha("commit"),
      treeSha256: sha("tree"),
      closureSha256: sha("closure"),
      closureMembers: [{ path: "catalog/component.json", sha256: sha("member") }],
    });
    const evaluation = createReadOnlyEvaluationV1({ provider, request });
    expect(provider.request).not.toHaveBeenCalled();
    expect(evaluation.capabilities).toEqual({ mutation: false, network: false });
    expect(Object.isFrozen(evaluation)).toBe(true);
  });

  it("fails closed for hostile request aliases, secrets, redirects, mutable refs, and submodules", () => {
    const valid = {
      protocol: "OfflineSourceRequestV1",
      host: "github",
      repository: "affaan-m/ecc",
      commitSha256: sha("commit"),
      treeSha256: sha("tree"),
      closureSha256: sha("closure"),
      closureMembers: [{ path: "catalog/component.json", sha256: sha("member") }],
    };
    for (const changed of [
      { ...valid, host: "https://github.com" },
      { ...valid, host: "github.com@evil.invalid" },
      { ...valid, repository: "affaan-m/../ecc" },
      { ...valid, repository: "affaan-m/ECC" },
      { ...valid, ref: "main" },
      { ...valid, redirectTo: "github/other" },
      { ...valid, token: "secret" },
      { ...valid, authorization: "Bearer secret" },
      { ...valid, closureMembers: [{ path: "../escape", sha256: sha("member") }] },
      {
        ...valid,
        closureMembers: [{ path: "catalog/submodule", sha256: sha("member"), submodule: true }],
      },
      {
        ...valid,
        closureMembers: [
          { path: "catalog/component.json", sha256: sha("member") },
          { path: "catalog/component.json", sha256: sha("member") },
        ],
      },
      {
        ...valid,
        closureMembers: [
          { path: "catalog/component.json", sha256: sha("member") },
          { path: "catalog/component.json", sha256: sha("other-member") },
        ],
      },
      { ...valid, repository: "affaan-m/ecc\r\nHost: evil.invalid" },
    ])
      expect(() => validateOfflineSourceRequestV1(changed)).toThrow();
  });

  it("rejects hostile evaluation wrappers before touching opaque providers or requests", () => {
    let getterCalls = 0;
    const provider = { request: vi.fn() };
    const request = validateOfflineSourceRequestV1({
      protocol: "OfflineSourceRequestV1",
      host: "github",
      repository: "affaan-m/ecc",
      commitSha256: sha("commit"),
      treeSha256: sha("tree"),
      closureSha256: sha("closure"),
      closureMembers: [{ path: "catalog/component.json", sha256: sha("member") }],
    });
    const accessorWrapper = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessorWrapper, "request", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return request;
      },
    });
    Object.defineProperty(accessorWrapper, "provider", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return provider;
      },
    });
    for (const hostile of [
      accessorWrapper,
      Object.assign(Object.create({ provider, request }), {}),
      { provider, request, [Symbol("hidden")]: true },
    ])
      expect(() => createReadOnlyEvaluationV1(hostile)).toThrow();
    expect(getterCalls).toBe(0);
    expect(provider.request).not.toHaveBeenCalled();
  });
});
