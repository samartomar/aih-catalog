import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type BaselineSourceEvidenceV1,
  parseBaselineEvidenceLockV1,
  scanCoverageV1,
  scanOutcomeV1,
  trustCodeClassV1,
} from "../../src/production/catalog/baseline-lock-v1.js";
import { readCoreProductDeclarationsV1 } from "../../src/production/catalog/core-product-declarations-v1.js";
import { prepareSuperpowersCatalogSourceV1 } from "../../src/production/catalog/framework-catalogs-v1.js";
import { canonicalStrictJsonBytesV1, sha256HexV1 } from "../../src/production/strict-json-v1.js";
import {
  type AuthoringCatalogBundleV1,
  validateAuthoringCatalogBundleV1,
} from "../../src/production/workbench/contracts-v1.js";
import {
  packagedReportComponentDigestV1,
  parsePackagedScannerCollectionEvidenceV1,
  projectScannerCollectionEvidenceV1,
} from "../../src/production/workbench/packaged-evidence-v1.js";
import { compilePinnedBaselineV1 } from "../../src/production/workbench/pinned-baseline-v1.js";

// D50 (Core 8dd77e53, NB1 design note (c)): a stored verdict is a label about what the analyzers
// observed, never a decision. Evidence problems are a separate label. Only contradictory evidence
// (an integrity question) is refused.

const TREE = "a".repeat(64);
const COMMIT = "b".repeat(40);
const ANALYZERS = [{ name: "native", version: "1" }];
const FINDING = { code: "trust.external-egress", detail: "fetch() at src/a.ts:1" };
const PROBLEM = { code: "trust.detector-unavailable", detail: "detector semgrep did not run" };

function component(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "skill:alpha",
    paths: ["skills/alpha"],
    treeSha256: TREE,
    verdict: "no-findings",
    analyzers: ANALYZERS,
    findings: [],
    evidenceProblems: [],
    ...overrides,
  };
}

function lock(components: unknown[], schemaVersion: unknown = 2): unknown {
  return {
    schemaVersion,
    sources: [
      {
        id: "superpowers",
        owner: "obra",
        repo: "Superpowers",
        pinnedSha: COMMIT,
        sourceTreeSha256: TREE,
        components,
      },
    ],
  };
}

describe("vendor lock schemaVersion 2", () => {
  it("reads both labels, findings and evidence problems apart", () => {
    const parsed = parseBaselineEvidenceLockV1(
      lock([
        component(),
        component({
          id: "skill:beta",
          verdict: "has-findings",
          findings: [FINDING],
          evidenceProblems: [PROBLEM],
        }),
        component({ id: "skill:gamma", evidenceProblems: [PROBLEM] }),
      ]),
    );
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.sources[0]?.components.map((entry) => entry.verdict)).toEqual([
      "no-findings",
      "has-findings",
      "no-findings",
    ]);
    expect(parsed.sources[0]?.components[1]).toMatchObject({
      findings: [FINDING],
      evidenceProblems: [PROBLEM],
    });
  });

  it("refuses the v1 vocabulary and version with no compatibility reading", () => {
    expect(() => parseBaselineEvidenceLockV1(lock([component()], 1))).toThrow(
      /vendor lock schemaVersion/u,
    );
    expect(() => parseBaselineEvidenceLockV1(lock([component({ verdict: "pass" })]))).toThrow(
      /verdict/u,
    );
    expect(() =>
      parseBaselineEvidenceLockV1(lock([component({ verdict: "blocked", findings: [FINDING] })])),
    ).toThrow(/verdict/u);
    const { evidenceProblems: _omitted, ...withoutProblems } = component();
    expect(() => parseBaselineEvidenceLockV1(lock([withoutProblems]))).toThrow(/evidenceProblems/u);
  });

  it("refuses contradictory evidence: the label must state what the findings are", () => {
    expect(() =>
      parseBaselineEvidenceLockV1(lock([component({ verdict: "has-findings" })])),
    ).toThrow(/has-findings evidence must carry at least one finding/u);
    expect(() => parseBaselineEvidenceLockV1(lock([component({ findings: [FINDING] })]))).toThrow(
      /no-findings evidence must carry no finding/u,
    );
  });

  it("refuses a code stored in the other class", () => {
    expect(() =>
      parseBaselineEvidenceLockV1(
        lock([component({ verdict: "has-findings", findings: [PROBLEM] })]),
      ),
    ).toThrow(/evidence problem trust\.detector-unavailable belongs in evidenceProblems/u);
    expect(() =>
      parseBaselineEvidenceLockV1(
        lock([
          component({
            verdict: "has-findings",
            findings: [{ code: "trust.source-drift", detail: "ref moved" }],
          }),
        ]),
      ),
    ).toThrow(/integrity failure trust\.source-drift is never stored as a finding/u);
    expect(() =>
      parseBaselineEvidenceLockV1(lock([component({ evidenceProblems: [FINDING] })])),
    ).toThrow(/trust\.external-egress is not an evidence problem/u);
  });

  it("classifies trust codes exactly as Core's trustCodeClassV1", () => {
    expect(trustCodeClassV1("trust.untrusted-publisher")).toBe("finding");
    expect(trustCodeClassV1("trust.unpinned-dependency")).toBe("finding");
    expect(trustCodeClassV1("trust.sandbox-smoke-failed")).toBe("evidence-problem");
    expect(trustCodeClassV1("trust.unsigned-source")).toBe("evidence-problem");
    expect(trustCodeClassV1("trust.fetch-metadata-mismatched")).toBe("integrity");
    expect(trustCodeClassV1("toString")).toBeUndefined();
    expect(trustCodeClassV1("cisco.rule")).toBeUndefined();
  });
});

const root = resolve(import.meta.dirname, "..", "..");
const governedTargets = readCoreProductDeclarationsV1(root)
  .hosts.filter((host) => host.policyTarget === true)
  .map((host) => String(host.id));
/** The committed bundle's structure (its own evidence is still v1 until B2), evidence replaced. */
const committed = JSON.parse(
  readFileSync(resolve(root, "defaults", "catalog-authoring-bundle-v1.json"), "utf8"),
).prepared.bundle as {
  assets: Record<
    string,
    { id: string; sourceId: string; sourceRevisionId: string; contentDigest: string }
  >;
};
const asset = Object.values(committed.assets)[0];

function bundle(evidence: Record<string, unknown>): unknown {
  return { ...committed, evidence };
}

function summary(scan: Record<string, unknown>, projectionVersion = "evidence-summary/v2") {
  if (asset === undefined) throw new Error("the committed bundle has no asset");
  const id = `evidence:${asset.id}`;
  return {
    [id]: {
      id,
      projectionVersion,
      subjects: [
        {
          assetId: asset.id,
          sourceId: asset.sourceId,
          sourceRevisionId: asset.sourceRevisionId,
          contentDigest: asset.contentDigest,
        },
      ],
      evidenceDigest: `sha256:${TREE}`,
      coveredPaths: ["skills/x"],
      verification: { state: "unverified" },
      scan,
      qualification: { state: "unknown" },
      findings: ["trust.external-egress: fetch() at src/a.ts:1"],
      evidenceProblems: [],
    },
  };
}

describe("evidence-summary/v2", () => {
  it("reads the neutral outcomes", () => {
    for (const outcome of ["no-findings", "has-findings", "unknown"])
      expect(() =>
        validateAuthoringCatalogBundleV1(
          bundle(summary({ outcome, coverage: "complete" })),
          governedTargets,
        ),
      ).not.toThrow();
    // Findings observed on partial coverage are still stated.
    expect(() =>
      validateAuthoringCatalogBundleV1(
        bundle(summary({ outcome: "has-findings", coverage: "partial" })),
        governedTargets,
      ),
    ).not.toThrow();
  });

  it("refuses v1 and the old outcomes, and a no-findings claim on incomplete coverage", () => {
    expect(() =>
      validateAuthoringCatalogBundleV1(
        bundle(summary({ outcome: "no-findings", coverage: "complete" }, "evidence-summary/v1")),
        governedTargets,
      ),
    ).toThrow(/projection version/u);
    for (const outcome of ["pass", "failed"])
      expect(() =>
        validateAuthoringCatalogBundleV1(
          bundle(summary({ outcome, coverage: "complete" })),
          governedTargets,
        ),
      ).toThrow(/outcome/u);
    expect(() =>
      validateAuthoringCatalogBundleV1(
        bundle(summary({ outcome: "no-findings", coverage: "partial" })),
        governedTargets,
      ),
    ).toThrow(/A no-findings scan requires complete coverage/u);
  });
});

describe("pinned baseline projection", () => {
  function superpowers(): ReturnType<typeof prepareSuperpowersCatalogSourceV1> {
    const parsed = parseBaselineEvidenceLockV1(
      lock([
        component({ id: "skill:alpha", paths: ["skills/alpha"] }),
        component({
          id: "skill:beta",
          paths: ["skills/beta"],
          verdict: "has-findings",
          findings: [FINDING],
          evidenceProblems: [PROBLEM],
        }),
      ]),
    );
    const source = parsed.sources[0] as BaselineSourceEvidenceV1;
    const metadata = (id: string) => ({
      id,
      path: `skills/${id}/SKILL.md`,
      sourceSha256: TREE,
      title: id,
      summary: `${id} summary`,
      usageContext: `${id} usage`,
      allowedTools: [],
    });
    return prepareSuperpowersCatalogSourceV1({
      baseline: {
        id: "superpowers",
        owner: "obra",
        repo: "Superpowers",
        pinnedSha: COMMIT,
        components: [
          { id: "skill:alpha", paths: ["skills/alpha"] },
          { id: "skill:beta", paths: ["skills/beta"] },
        ],
      },
      sourceSnapshot: source,
      contentMetadata: {
        version: 1,
        repository: "obra/Superpowers",
        commit: COMMIT,
        agents: [],
        skills: [metadata("alpha"), metadata("beta")],
      },
    });
  }

  it("carries evidence problems beside findings in the authoring vet", () => {
    const framework = superpowers();
    expect(framework.assets.map((asset) => asset.vet)).toEqual([
      {
        verdict: "no-findings",
        treeSha256: TREE,
        analyzers: ANALYZERS,
        findings: [],
        evidenceProblems: [],
      },
      {
        verdict: "has-findings",
        treeSha256: TREE,
        analyzers: ANALYZERS,
        findings: [FINDING],
        evidenceProblems: [PROBLEM],
      },
    ]);
  });

  it("projects the stored label itself and never names a component failed", () => {
    const framework = superpowers();
    const source = parseBaselineEvidenceLockV1(
      lock([
        component({ id: "skill:alpha", paths: ["skills/alpha"] }),
        component({
          id: "skill:beta",
          paths: ["skills/beta"],
          verdict: "has-findings",
          findings: [FINDING],
          evidenceProblems: [PROBLEM],
        }),
      ]),
    ).sources[0] as BaselineSourceEvidenceV1;
    const compiled = compilePinnedBaselineV1(framework, source);
    const alpha = compiled.evidence["evidence:superpowers/skill:alpha"];
    const beta = compiled.evidence["evidence:superpowers/skill:beta"];
    expect(alpha?.projectionVersion).toBe("evidence-summary/v2");
    expect(alpha?.scan.outcome).toBe("no-findings");
    expect(beta?.scan.outcome).toBe("has-findings");
    expect(beta?.findings).toEqual(["trust.external-egress: fetch() at src/a.ts:1"]);
    // The digested evidence bytes carry both labels.
    const expected = canonicalStrictJsonBytesV1({
      version: "pinned-baseline-evidence/v2",
      source: { repository: "obra/Superpowers", commit: COMMIT },
      asset: { id: "skill:beta", treeSha256: TREE, coveredPaths: ["skills/beta"] },
      verdict: "has-findings",
      analyzers: ANALYZERS,
      findings: [FINDING],
      evidenceProblems: [PROBLEM],
    });
    expect(beta?.evidenceDigest).toBe(`sha256:${sha256HexV1(expected)}`);
    expect(JSON.stringify(compiled)).not.toMatch(/"(?:failed|blocked|pass)"/u);
    const detail = JSON.parse(compiled.detailBytes["detail:superpowers/skill:beta"] ?? "{}");
    expect(detail.version).toBe("pinned-baseline-detail/v2");
    expect(detail.asset.vet.evidenceProblems).toEqual([PROBLEM]);
  });
});

describe("packaged collection evidence projection", () => {
  it("projects the report's own label: has-findings stays has-findings, never failed", () => {
    // The shared D25 fixture (byte-identical in Core): component:first has one finding.
    const { record } = JSON.parse(
      readFileSync(
        resolve(root, "tests", "fixtures", "packaged-evidence-parity", "report-findings.json"),
        "utf8",
      ),
    ) as {
      record: {
        catalog: {
          source: {
            id: string;
            revisionId: string;
            contentDigest: string;
            inputFormat: string;
            upstreamOrigin: { kind: string; locator: string };
          };
        };
        coverage: {
          components: {
            componentId: string;
            subject: { assetId: string; sourceRevisionId: string; contentDigest: string };
          }[];
        };
      };
    };
    const bytes = canonicalStrictJsonBytesV1(record).toString("utf8");
    const [parsed] = parsePackagedScannerCollectionEvidenceV1([
      { bytes, sha256: `sha256:${sha256HexV1(bytes)}` },
    ]);
    if (parsed === undefined) throw new Error("the shared fixture did not parse");
    const source = record.catalog.source;
    const bundle = {
      sources: {
        [source.id]: {
          id: source.id,
          revision: { id: source.revisionId, contentDigest: source.contentDigest },
          inputFormat: source.inputFormat,
          upstreamOrigin: source.upstreamOrigin,
        },
      },
      assets: Object.fromEntries(
        record.coverage.components.map(({ subject }) => [
          subject.assetId,
          {
            id: subject.assetId,
            sourceId: source.id,
            sourceRevisionId: subject.sourceRevisionId,
            contentDigest: subject.contentDigest,
            derivation: "upstream",
          },
        ]),
      ),
    } as unknown as AuthoringCatalogBundleV1;
    const evidence = projectScannerCollectionEvidenceV1(bundle, [parsed]);
    const byComponent = Object.fromEntries(
      record.coverage.components.map(({ componentId, subject }) => [
        componentId,
        evidence[`evidence:${subject.assetId}`],
      ]),
    );
    expect(byComponent["component:first"]).toMatchObject({
      projectionVersion: "evidence-summary/v2",
      scan: { outcome: "has-findings", coverage: "complete" },
    });
    expect(byComponent["component:first"]?.findings).toHaveLength(1);
    expect(byComponent["component:second"]).toMatchObject({
      scan: { outcome: "no-findings" },
      findings: [],
    });
    expect(JSON.stringify(evidence)).not.toMatch(/"(?:failed|blocked|pass)"/u);
  });
});

// D56 (Core 96453911): evidence-summary/v2 carries evidence problems as their own label, right
// after findings with the same bounds; both projections fill it as "<code>: <detail>", at most
// 50 entries of at most 1000 characters, and the pinned-baseline findings take the same caps.
describe("evidence problems in evidence-summary/v2 (D56)", () => {
  const withProblems = (evidenceProblems: unknown) => {
    const value = summary({ outcome: "no-findings", coverage: "complete" });
    for (const entry of Object.values(value))
      (entry as Record<string, unknown>).evidenceProblems = evidenceProblems;
    return value;
  };

  it("requires evidenceProblems, bounded as findings are", () => {
    const valid = [PROBLEM, PROBLEM].map((problem) => `${problem.code}: ${problem.detail}`);
    expect(() =>
      validateAuthoringCatalogBundleV1(bundle(withProblems(valid)), governedTargets),
    ).not.toThrow();
    expect(() =>
      validateAuthoringCatalogBundleV1(
        bundle(withProblems(Array.from({ length: 50 }, () => "x".repeat(1_000)))),
        governedTargets,
      ),
    ).not.toThrow();
    const missing = summary({ outcome: "no-findings", coverage: "complete" });
    for (const entry of Object.values(missing))
      delete (entry as Record<string, unknown>).evidenceProblems;
    expect(() => validateAuthoringCatalogBundleV1(bundle(missing), governedTargets)).toThrow();
    for (const invalid of [
      Array.from({ length: 51 }, () => "x"),
      ["x".repeat(1_001)],
      [""],
      [1],
      "trust.detector-unavailable",
    ])
      expect(() =>
        validateAuthoringCatalogBundleV1(bundle(withProblems(invalid)), governedTargets),
      ).toThrow();
  });

  function compiledBeta(beta: Record<string, unknown>) {
    const source = parseBaselineEvidenceLockV1(
      lock([
        component({ id: "skill:alpha", paths: ["skills/alpha"] }),
        component({ id: "skill:beta", paths: ["skills/beta"], ...beta }),
      ]),
    ).sources[0] as BaselineSourceEvidenceV1;
    const metadata = (id: string) => ({
      id,
      path: `skills/${id}/SKILL.md`,
      sourceSha256: TREE,
      title: id,
      summary: `${id} summary`,
      usageContext: `${id} usage`,
      allowedTools: [],
    });
    const framework = prepareSuperpowersCatalogSourceV1({
      baseline: {
        id: "superpowers",
        owner: "obra",
        repo: "Superpowers",
        pinnedSha: COMMIT,
        components: [
          { id: "skill:alpha", paths: ["skills/alpha"] },
          { id: "skill:beta", paths: ["skills/beta"] },
        ],
      },
      sourceSnapshot: source,
      contentMetadata: {
        version: 1,
        repository: "obra/Superpowers",
        commit: COMMIT,
        agents: [],
        skills: [metadata("alpha"), metadata("beta")],
      },
    });
    return compilePinnedBaselineV1(framework, source).evidence;
  }

  it("fills the pinned-baseline projection from the component's evidence problems", () => {
    const evidence = compiledBeta({ evidenceProblems: [PROBLEM] });
    expect(evidence["evidence:superpowers/skill:alpha"]?.evidenceProblems).toEqual([]);
    expect(evidence["evidence:superpowers/skill:beta"]?.evidenceProblems).toEqual([
      "trust.detector-unavailable: detector semgrep did not run",
    ]);
    expect(evidence["evidence:superpowers/skill:beta"]?.findings).toEqual([]);
  });

  it("caps the pinned-baseline findings and evidence problems at 50 entries of 1000 characters", () => {
    const long = "d".repeat(1_500);
    const evidence = compiledBeta({
      verdict: "has-findings",
      findings: Array.from({ length: 60 }, (_, index) => ({
        code: "trust.external-egress",
        detail: `${index} ${long}`,
      })),
      evidenceProblems: Array.from({ length: 60 }, (_, index) => ({
        code: "trust.detector-unavailable",
        detail: `${index} ${long}`,
      })),
    });
    const beta = evidence["evidence:superpowers/skill:beta"];
    expect(beta?.findings).toHaveLength(50);
    expect(beta?.evidenceProblems).toHaveLength(50);
    expect(beta?.findings[0]).toBe(`trust.external-egress: 0 ${long}`.slice(0, 1_000));
    expect(beta?.evidenceProblems[49]).toBe(
      `trust.detector-unavailable: 49 ${long}`.slice(0, 1_000),
    );
  });

  it("fills the packaged collection projection from the report's evidence problems", () => {
    const long = "p".repeat(1_500);
    const byComponent = projectedParity({
      "component:second": Array.from({ length: 60 }, (_, index) => ({
        code: "trust.detector-unavailable",
        detail: `${index} ${long}`,
      })),
    });
    expect(byComponent["component:first"]?.evidenceProblems).toEqual([]);
    const problems = byComponent["component:second"]?.evidenceProblems;
    expect(problems).toHaveLength(50);
    expect(problems?.[0]).toBe(`trust.detector-unavailable: 0 ${long}`.slice(0, 1_000));
    // A detector that did not run: partial coverage, so the no-findings label cannot stand.
    expect(byComponent["component:second"]?.scan).toMatchObject({
      outcome: "unknown",
      coverage: "partial",
    });
  });

  // Astra step-8 review P2: a report carrying trust.detector-unavailable was projected as
  // complete coverage. Coverage is derived from the coverage-relevant evidence problems, each
  // read as Core states it (src/support/findings.ts); "no-findings requires complete coverage"
  // stays, so a no-findings label on incomplete coverage becomes unknown, the problem stated.
  it("derives scan coverage from what each evidence problem says about the scan", () => {
    const of = (...codes: string[]) =>
      scanCoverageV1(codes.map((code) => ({ code, detail: "detail" })));
    expect(of()).toBe("complete");
    // "The scan ran without this detector, so its coverage is incomplete."
    expect(of("trust.detector-unavailable")).toBe("partial");
    // "The sandbox smoke test did not run / did not complete, so runtime behavior is not covered."
    expect(of("trust.sandbox-smoke-unavailable")).toBe("partial");
    expect(of("trust.sandbox-smoke-failed")).toBe("partial");
    // "The source could not be fetched, so there is nothing to scan yet."
    expect(of("trust.fetch-blocked")).toBe("none");
    expect(of("trust.detector-unavailable", "trust.fetch-blocked")).toBe("none");
    // A missing reviewed pin says nothing about what the analyzers covered.
    expect(of("trust.unsigned-source")).toBe("complete");
    expect(of("trust.unsigned-source", "trust.detector-unavailable")).toBe("partial");
    // A code this table does not know never reads as complete coverage.
    expect(of("trust.not-yet-classified")).toBe("partial");
    expect(scanOutcomeV1("no-findings", "complete")).toBe("no-findings");
    expect(scanOutcomeV1("no-findings", "partial")).toBe("unknown");
    expect(scanOutcomeV1("no-findings", "none")).toBe("unknown");
    expect(scanOutcomeV1("has-findings", "partial")).toBe("has-findings");
    expect(scanOutcomeV1("has-findings", "complete")).toBe("has-findings");
  });

  it("projects a pinned-baseline component whose detector did not run as partial coverage", () => {
    const quiet = compiledBeta({ evidenceProblems: [PROBLEM] });
    expect(quiet["evidence:superpowers/skill:alpha"]?.scan).toMatchObject({
      outcome: "no-findings",
      coverage: "complete",
    });
    expect(quiet["evidence:superpowers/skill:beta"]?.scan).toMatchObject({
      outcome: "unknown",
      coverage: "partial",
    });
    expect(quiet["evidence:superpowers/skill:beta"]?.evidenceProblems).toEqual([
      "trust.detector-unavailable: detector semgrep did not run",
    ]);
    // Findings observed on partial coverage are still stated as has-findings.
    const noisy = compiledBeta({
      verdict: "has-findings",
      findings: [FINDING],
      evidenceProblems: [PROBLEM],
    });
    expect(noisy["evidence:superpowers/skill:beta"]?.scan).toMatchObject({
      outcome: "has-findings",
      coverage: "partial",
    });
    const unpinned = compiledBeta({
      evidenceProblems: [{ code: "trust.unsigned-source", detail: "no reviewed pin" }],
    });
    expect(unpinned["evidence:superpowers/skill:beta"]?.scan).toMatchObject({
      outcome: "no-findings",
      coverage: "complete",
    });
  });

  it("projects packaged collection coverage from the report's evidence problems", () => {
    const partial = projectedParity({ "component:first": [PROBLEM] });
    expect(partial["component:first"]?.scan).toMatchObject({
      outcome: "has-findings",
      coverage: "partial",
    });
    expect(partial["component:second"]?.scan).toMatchObject({
      outcome: "no-findings",
      coverage: "complete",
    });
    const none = projectedParity({
      "component:second": [{ code: "trust.fetch-blocked", detail: "not fetched" }],
    });
    expect(none["component:second"]?.scan).toMatchObject({ outcome: "unknown", coverage: "none" });
    expect(none["component:second"]?.evidenceProblems).toEqual([
      "trust.fetch-blocked: not fetched",
    ]);
    for (const summary of [...Object.values(partial), ...Object.values(none)]) {
      const scan = summary?.scan as { outcome: string; coverage: string };
      expect(scan.outcome === "no-findings" && scan.coverage !== "complete").toBe(false);
    }
  });

  /** The shared parity fixture's record, with evidence problems set per component, projected. */
  function projectedParity(problems: Record<string, Record<string, unknown>[]>) {
    const { record } = JSON.parse(
      readFileSync(
        resolve(root, "tests", "fixtures", "packaged-evidence-parity", "report-findings.json"),
        "utf8",
      ),
    ) as { record: Record<string, unknown> };
    const report = record.report as { components: Record<string, unknown>[] };
    for (const [componentId, evidenceProblems] of Object.entries(problems)) {
      const component = report.components.find((item) => item.id === componentId);
      if (component === undefined) throw new Error(`the shared fixture has no ${componentId}`);
      component.evidenceProblems = evidenceProblems;
      for (const observation of record.observations as Record<string, unknown>[])
        if (observation.componentId === componentId)
          observation.reportComponentDigest = packagedReportComponentDigestV1(component);
    }
    const bytes = canonicalStrictJsonBytesV1(record).toString("utf8");
    const [parsed] = parsePackagedScannerCollectionEvidenceV1([
      { bytes, sha256: `sha256:${sha256HexV1(bytes)}` },
    ]);
    if (parsed === undefined) throw new Error("the changed fixture did not parse");
    const catalog = record.catalog as {
      source: {
        id: string;
        revisionId: string;
        contentDigest: string;
        inputFormat: string;
        upstreamOrigin: { kind: string; locator: string };
      };
    };
    const coverage = record.coverage as {
      components: {
        componentId: string;
        subject: { assetId: string; sourceRevisionId: string; contentDigest: string };
      }[];
    };
    const source = catalog.source;
    const projected = projectScannerCollectionEvidenceV1(
      {
        sources: {
          [source.id]: {
            id: source.id,
            revision: { id: source.revisionId, contentDigest: source.contentDigest },
            inputFormat: source.inputFormat,
            upstreamOrigin: source.upstreamOrigin,
          },
        },
        assets: Object.fromEntries(
          coverage.components.map(({ subject }) => [
            subject.assetId,
            {
              id: subject.assetId,
              sourceId: source.id,
              sourceRevisionId: subject.sourceRevisionId,
              contentDigest: subject.contentDigest,
              derivation: "upstream",
            },
          ]),
        ),
      } as unknown as AuthoringCatalogBundleV1,
      [parsed],
    );
    return Object.fromEntries(
      coverage.components.map(({ componentId, subject }) => [
        componentId,
        projected[`evidence:${subject.assetId}`],
      ]),
    );
  }
});
