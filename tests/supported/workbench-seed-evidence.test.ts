import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const item = value as Record<string, unknown>;
  return `{${Object.keys(item)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`)
    .join(",")}}`;
};
const digest = (domain: string, value: unknown) =>
  `sha256:${createHash("sha256")
    .update(`${domain}\0${canonical(value)}`)
    .digest("hex")}`;

describe("registered Workbench source assessments", () => {
  it("includes exact refreshed review-only assessments without licensing held Anthropic skills or replacing Matt", () => {
    const manifest = read(resolve(root, "defaults/default-catalog-seed-manifest-v2.json"));
    expect(
      manifest.seeds.filter(
        (path: string) =>
          !path.startsWith("workbench/aih/") &&
          !path.startsWith("workbench/aih-core-0.6.1/") &&
          !path.startsWith("workbench/aih-core-0.6.2/") &&
          !path.startsWith("workbench/npm/"),
      ),
    ).toHaveLength(430);
    const expected: Record<
      string,
      {
        count: number;
        commit: string;
        publication?: string;
        mappedFindings?: number;
        locationCoverageNotices?: number;
        globalCoverageNotices?: number;
      }
    > = {
      anthropic: {
        count: 14,
        commit: "34040c9c568585f6929bedeaad110ad08f079624",
        publication: "2e4ab845e3f07ae266a0353ff59752c594efc1f929f80aa345914e7a42e7583f",
        mappedFindings: 180,
        locationCoverageNotices: 86,
        globalCoverageNotices: 13,
      },
      "ui-ux-pro-max": {
        count: 1,
        commit: "a38d04c3d5c298c851dbe5e6ee1965ee3de42cb5",
        publication: "709f6bcc031fe2a93e461ebe7b57b6a126e0179fcd6b16cb8e98ac9c8ce7068e",
        mappedFindings: 79,
        locationCoverageNotices: 70,
        globalCoverageNotices: 15,
      },
      mattpocock: {
        count: 25,
        commit: "c55ee46073ed923f86ce59a5eb3b6d895095d1b7",
        publication: "ab1a0b3c76d1962970195621fdd906fe200317ef30bef78e25fd0a82f853e518",
        mappedFindings: 31,
        locationCoverageNotices: 1,
        globalCoverageNotices: 13,
      },
      ponytail: {
        count: 7,
        commit: "1d95ff7d39de12d87014ea40d4e22201bddc501b",
        publication: "7651e06f56c4f17a37478fd03980c8b6499bb9db00f7c2a7e056020779666fd0",
        mappedFindings: 70,
        locationCoverageNotices: 8,
        globalCoverageNotices: 2,
      },
      superpowers: {
        count: 15,
        commit: "5bf4e78011075bcfc0dc295f0724994cd123ee71",
        publication: "cf939d5447eaae3e16b2bfa15ebad25620f0953a89d4d5fda51e14844bba288b",
        mappedFindings: 82,
        locationCoverageNotices: 13,
        globalCoverageNotices: 14,
      },
      ecc: { count: 367, commit: "5064474d4d762dc9640234a41617cccb79185cec" },
    };
    for (const [provider, facts] of Object.entries(expected)) {
      const paths = manifest.seeds.filter((path: string) =>
        path.startsWith(`workbench/${provider}/`),
      );
      expect(paths).toHaveLength(facts.count);
      let mappedFindings = 0;
      let locationCoverageNotices = 0;
      for (const path of paths) {
        const seedPath = resolve(root, "defaults", path);
        const seed = read(seedPath);
        expect(seed.subject.source.commit).toBe(facts.commit);
        if (provider === "anthropic")
          expect(["docx", "pdf", "pptx", "xlsx", "doc-coauthoring"]).not.toContain(seed.subject.id);
        expect(
          Object.values(seed.capabilities).every(
            (value) => Array.isArray(value) && value.length === 0,
          ),
        ).toBe(true);
        const closureBytes = readFileSync(
          resolve(dirname(seedPath), seed.artifacts.closure),
          "utf8",
        );
        const closure = JSON.parse(closureBytes);
        expect(closureBytes).toBe(canonical(closure));
        expect(closure.sourceRevisionId).toBe(facts.commit);
        expect(closure.scope.kind).toBe("source-files");
        const report = read(resolve(dirname(seedPath), seed.qualification.report));
        expect(report.subjectDigest).toBe(closure.subjectDigest);
        expect(report.summary).toContain("No finding cleared or report relabeled.");
        expect(report.summary).not.toContain("undefined");
        expect(seed.qualification.rights).toHaveLength(1);
        const right = read(resolve(dirname(seedPath), seed.qualification.rights[0]));
        expect(right.summary).toMatch(/^Applicable (?:MIT|Apache-2.0) notice/);
        expect(right.summary).toContain(
          "No trademark, external-service, or organization-admission rights inferred.",
        );
        expect(read(resolve(dirname(seedPath), seed.artifacts.recipe))).toMatchObject({
          kind: "review-only",
          installation: false,
          organizationAdmission: "not-authoritative",
        });
        if (facts.publication !== undefined) {
          expect(seed.qualification.gaps).toContain("evidence/coverage-gap.json");
          const coverageGap = read(resolve(dirname(seedPath), "evidence/coverage-gap.json"));
          expect(coverageGap.summary).toContain("Unresolved Scanner coverage notifications:");
          expect(report.summary).toContain("Scanner authority none");
          expect(report.summary).toContain("historical observation");
          expect(report.summary).toContain(`Publication sha256:${facts.publication}.`);
          const findingMatch = /Scanner mapped findings: (\d+);/.exec(report.summary);
          const coverageMatch =
            /Unresolved Scanner coverage notifications: (\d+) location-bound and (\d+) global\./.exec(
              coverageGap.summary,
            );
          expect(findingMatch).not.toBeNull();
          expect(coverageMatch).not.toBeNull();
          mappedFindings += Number(findingMatch?.[1]);
          locationCoverageNotices += Number(coverageMatch?.[1]);
          expect(Number(coverageMatch?.[2])).toBe(facts.globalCoverageNotices);
        }
      }
      if (facts.mappedFindings !== undefined) {
        expect(mappedFindings).toBe(facts.mappedFindings);
        expect(locationCoverageNotices).toBe(facts.locationCoverageNotices);
      }
    }
  });

  it("retains exact subjects, canonical source closures, unresolved findings, and review-only scope", () => {
    const manifest = read(resolve(root, "defaults/default-catalog-seed-manifest-v2.json"));
    const paths: string[] = manifest.seeds.filter((path: string) =>
      path.startsWith("workbench/mattpocock/"),
    );
    expect(paths).toHaveLength(25);
    const identities = new Set<string>();
    let findingCount = 0;
    for (const path of paths) {
      const seedPath = resolve(root, "defaults", path);
      const seed = read(seedPath);
      expect(identities.has(seed.entryId)).toBe(false);
      identities.add(seed.entryId);
      expect(seed.subject.source).toMatchObject({
        type: "github",
        repository: "mattpocock/skills",
        commit: "c55ee46073ed923f86ce59a5eb3b6d895095d1b7",
      });
      const sourceDigest = digest("aih-governance-decision-source/v2", seed.subject.source);
      const subjectDigest = digest("aih-governance-decision-subject/v2", {
        id: seed.subject.id,
        kind: seed.subject.kind,
        sourceDigest,
      });
      const closureBytes = readFileSync(resolve(dirname(seedPath), seed.artifacts.closure), "utf8");
      const closure = JSON.parse(closureBytes);
      expect(closureBytes).toBe(canonical(closure));
      expect(closure.subjectDigest).toBe(subjectDigest);
      expect(closure.files.some((file: { path: string }) => file.path === "LICENSE")).toBe(true);
      expect(
        closure.files.some((file: { path: string }) => file.path === seed.subject.source.path),
      ).toBe(true);
      expect(read(resolve(dirname(seedPath), seed.artifacts.recipe))).toMatchObject({
        kind: "review-only",
        installation: false,
        organizationAdmission: "not-authoritative",
      });
      for (const [kind, paths] of Object.entries({
        report: [seed.qualification.report],
        finding: seed.qualification.findings,
        gap: seed.qualification.gaps,
        right: seed.qualification.rights,
      })) {
        for (const evidencePath of paths as string[]) {
          const evidence = read(resolve(dirname(seedPath), evidencePath));
          expect(evidence).toMatchObject({
            kind,
            subjectDigest,
            format: "aih-supported-evidence/v2",
          });
          if (kind === "finding") {
            expect(evidence.summary).toMatch(
              /^Unresolved original annex\/\S+\.json findings: \d+\. Canonical full ordered finding group SHA256 [0-9a-f]{64}\./,
            );
            findingCount++;
          }
          if (kind === "gap")
            expect(evidence.summary).toContain(
              {
                "coverage-gap": "is not a complete or clean scan",
                "publication-1": "Catalog does not re-sign or refresh them",
                "scope-gap": "No runtime safety, clean scan",
              }[evidence.id as string],
            );
        }
      }
    }
    expect(findingCount).toBeGreaterThan(0);
  });
});
