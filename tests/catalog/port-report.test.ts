import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const bytes = (path: string) => readFileSync(join(root, path));
const json = (path: string) => JSON.parse(bytes(path).toString("utf8"));
const sha256 = (path: string) => createHash("sha256").update(bytes(path)).digest("hex");

const report = json("port-report/report.json");
const maintained = json("port-report/maintained.json");
const remaining = json("port-report/remaining.json");
const aiSetup = json("port-report/ai-setup.json");
const frameworks = readdirSync(join(root, "data"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "qualifications")
  .map((entry) => entry.name)
  .sort();
const itemIds = new Set<string>(
  frameworks.flatMap((framework) =>
    json(`data/${framework}/content.json`).items.map((item: { id: string }) => item.id),
  ),
);

describe("the complete port report", () => {
  it("is regenerated exactly by its tool from the three section reports", () => {
    const run = spawnSync(process.execPath, ["tools/port-report.mjs", "--check"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    expect(report.sections).toEqual({
      aiSetup: { path: "port-report/ai-setup.json", sha256: sha256("port-report/ai-setup.json") },
      maintained: {
        path: "port-report/maintained.json",
        sha256: sha256("port-report/maintained.json"),
      },
      remaining: {
        path: "port-report/remaining.json",
        sha256: sha256("port-report/remaining.json"),
      },
    });
  });

  it("gives every one of the 777 measured items exactly one disposition", () => {
    const ids = maintained.dispositions.map(
      (entry: { baseline: { id: string } }) => entry.baseline.id,
    );
    expect(ids).toHaveLength(777);
    expect(new Set(ids).size).toBe(777);
    expect(report.baseline.items).toBe(777);
    expect(report.baseline.byKind).toEqual({
      agent: 72,
      command: 96,
      document: 5,
      hook: 28,
      "mcp-server": 37,
      rule: 147,
      skill: 392,
    });
    const counts = Object.values(report.baseline.dispositions as Record<string, number>);
    expect(counts.reduce((total, count) => total + count, 0)).toBe(777);
    expect(report.baseline.dispositions.dropped).toBe(21);
  });

  it("maps every disposition to an item that is in the committed data", () => {
    const mapped = [
      ...maintained.dispositions.flatMap((entry: { item?: string }) =>
        entry.item ? [entry.item] : [],
      ),
      ...remaining.dispositions.flatMap((entry: { item?: string; items?: string[] }) => [
        ...(entry.item ? [entry.item] : []),
        ...(entry.items ?? []),
      ]),
    ];
    expect(mapped.length).toBeGreaterThan(700);
    expect(mapped.filter((id: string) => !itemIds.has(id))).toEqual([]);
  });

  it("disposes the earlier release items outside the baseline, including the three left over", () => {
    expect(report.earlier.disposed).toBe(remaining.dispositions.length + 3);
    expect(
      report.earlier.other.map((entry: { earlier: { id: string } }) => entry.earlier.id).sort(),
    ).toEqual([
      "aihq.hook.claude.protect-env",
      "aihq.mcp.claude.graph-fixture",
      "aihq.native-bundle.claude.graph-fixture",
    ]);
    for (const entry of report.earlier.other) {
      expect(entry.disposition).toBe("dropped");
      expect(entry.reason).toMatch(/^[a-z-]+$/);
    }
  });

  it("names every data framework once, by its content file's sha256", () => {
    expect(Object.keys(report.frameworks).sort()).toEqual(frameworks);
    for (const framework of frameworks) {
      expect(report.frameworks[framework].contentSha256).toBe(
        sha256(`data/${framework}/content.json`),
      );
      expect(["maintained", "remaining", "aiSetup"]).toContain(
        report.frameworks[framework].section,
      );
    }
    expect(report.qualifications).toEqual(
      aiSetup.qualifications.map((entry: Record<string, string>) => ({
        aiSetup: entry.aiSetup,
        cell: entry.cell,
        sha256: entry.sha256,
        status: entry.status,
      })),
    );
  });

  it("keeps the recorded deferred and native limits", () => {
    expect(report.limits.native.length).toBeGreaterThan(0);
    expect(report.limits.deferred.length).toBeGreaterThan(0);
    const text = JSON.stringify(report.limits);
    for (const phrase of [
      "native loading",
      "presence",
      "trusted-evidence verification",
      "Extensions",
      "combination qualification",
    ])
      expect(text).toContain(phrase);
  });
});
