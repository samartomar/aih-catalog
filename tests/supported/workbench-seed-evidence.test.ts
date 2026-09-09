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
  it("includes exact latest-source assessments without licensing held Anthropic skills or replacing Matt", () => {
    const manifest = read(resolve(root, "defaults/default-catalog-seed-manifest-v2.json"));
    expect(
      manifest.seeds.filter((path: string) => !path.startsWith("workbench/aih/")),
    ).toHaveLength(428);
    const expected: Record<string, { count: number; commit: string }> = {
      anthropic: { count: 14, commit: "41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f" },
      ponytail: { count: 7, commit: "356918eba965ee1eac64bd3a7f0dd02108350de5" },
      superpowers: { count: 14, commit: "b36e0829c6d0140e93cfef2ca599b1b07d4a7797" },
      ecc: { count: 367, commit: "5064474d4d762dc9640234a41617cccb79185cec" },
    };
    for (const [provider, facts] of Object.entries(expected)) {
      const paths = manifest.seeds.filter((path: string) =>
        path.startsWith(`workbench/${provider}/`),
      );
      expect(paths).toHaveLength(facts.count);
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
          installation: false,
          organizationAdmission: "not-authoritative",
        });
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
        commit: "3cca18b368ae95cdbdebbff572ccafa662551015",
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
            expect(evidence.summary).toMatch(/^Unresolved .*canonical finding SHA256 [0-9a-f]{64}/);
            findingCount++;
          }
          if (kind === "gap") expect(evidence.summary).toContain("no runtime safety, clean scan");
        }
      }
    }
    expect(findingCount).toBeGreaterThan(0);
  });
});
