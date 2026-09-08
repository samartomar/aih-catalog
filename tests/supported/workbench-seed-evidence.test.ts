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
