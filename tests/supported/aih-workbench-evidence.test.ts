import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, it } from "vitest";
import { verifySignedCatalogV2 } from "../../src/index.js";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const sha = (bytes: string | Buffer) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
};

it("verifies the signed AIH successor without replacing retained members or extending expiry", () => {
  const directory = resolve(root, "catalog/workbench-aih-2026-09-09");
  const signed = read(resolve(directory, "signed-catalog-v2.json"));
  const previous = read(resolve(directory, "previous-head.json"));
  const rootKey = read(resolve(root, "catalog/genesis/catalog-signer-root.json"));
  const head = verifySignedCatalogV2({
    signed,
    catalogSignerRoots: [rootKey],
    expectedClaims: previous.claims,
    lastAccepted: previous,
    replay: { acceptedIdentities: [] },
    now: signed.head.validFrom,
  });
  expect(head.sequence).toBe(3);
  expect(head.catalogHeadSha256).toBe(
    "c149358bf6d75cb9d7ee75887bd629921604d1dd78ded382f52ffe341d027e1f",
  );
  expect(head.validUntil).toBe(previous.validUntil);
  const entries = head.entries as Record<string, unknown>[];
  expect(entries).toHaveLength(437);
  expect(previous.entries).toHaveLength(428);
  for (const member of previous.entries) {
    expect(entries.find((item) => item.entryId === member.entryId)).toEqual(member);
  }
});

it("retains ten signed report components and canonical profiles for nine eligible AIH subjects", () => {
  const manifest = read(resolve(root, "defaults/default-catalog-seed-manifest-v2.json"));
  const paths: string[] = manifest.seeds.filter((path: string) =>
    path.startsWith("workbench/aih/"),
  );
  expect(paths).toHaveLength(9);
  expect(manifest.seeds).toHaveLength(447);
  const wrapper = read(
    resolve(root, "defaults/workbench/aih/source-reports/verified-report-wrapper.json"),
  );
  expect(sha(wrapper.bytes)).toBe(wrapper.sha256);
  const report = JSON.parse(wrapper.bytes);
  expect(report.coverage.components).toHaveLength(10);
  expect(report.observations).toHaveLength(10);
  const observations = new Map(
    report.observations.map((item: { componentId: string }) => [item.componentId, item]),
  );
  let findings = 0;
  for (const path of paths) {
    const seedPath = resolve(root, "defaults", path);
    const seed = read(seedPath);
    expect(seed.subject.source).toMatchObject({ type: "aih", release: "0.6.0" });
    const closureBytes = readFileSync(resolve(dirname(seedPath), seed.artifacts.closure), "utf8");
    const closure = JSON.parse(closureBytes);
    expect(closureBytes).toBe(canonical(closure));
    const profileBytes = readFileSync(resolve(dirname(seedPath), seed.artifacts.profile));
    expect(sha(profileBytes)).toBe(seed.subject.source.revision);
    const profile = JSON.parse(profileBytes.toString("utf8"));
    expect(closure.scope).toEqual(profile.scope);
    const observation = observations.get(profile.scanner.component.componentId);
    expect(observation).toMatchObject(profile.scanner.observation);
    expect(seed.qualification.gaps).toHaveLength(1);
    expect(seed.qualification.rights).toHaveLength(1);
    if (seed.subject.id === "github") {
      expect(seed.qualification.findings).toHaveLength(1);
      const finding = read(resolve(dirname(seedPath), seed.qualification.findings[0]));
      expect(finding.summary).toContain("trust.external-egress");
      expect(finding.subjectDigest).toBe(closure.subjectDigest);
      findings++;
    } else expect(seed.qualification.findings).toHaveLength(0);
  }
  expect(findings).toBe(1);
  expect(paths.some((path) => path.includes("usage-metering"))).toBe(false);
});
