import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type Result = { status: number | null; stdout: string; stderr: string; error?: Error };
type Dependencies = {
  run: (args: readonly string[]) => Result;
  wait: (milliseconds: number) => Promise<void>;
  report: (result: Result) => void;
};
const { verifyWithTransientRetries } = (await import(
  pathToFileURL(resolve(".github/verify-attestation-retry.mjs")).href
)) as {
  verifyWithTransientRetries: (
    args: readonly string[],
    dependencies: Dependencies,
  ) => Promise<Result>;
};
const good: Result = { status: 0, stdout: "verified", stderr: "" };
const transient: Result = { status: 1, stdout: "", stderr: "Error: HTTP 503: service unavailable" };
const args = [
  "artifact.json",
  "--repo",
  "samartomar/aih-catalog",
  "--source-digest",
  "a".repeat(40),
];

describe("native attestation transient transport retries", () => {
  it("repeats identical native verification after 503/502 and returns only actual success", async () => {
    const results = [transient, { ...transient, stderr: "Error: HTTP 502: Server Error" }, good];
    const calls: readonly string[][] = [];
    const delays: number[] = [];
    const reported: Result[] = [];
    let index = 0;
    const result = await verifyWithTransientRetries(args, {
      run: (received) => {
        (calls as string[][]).push([...received]);
        return results[index++]!;
      },
      wait: async (milliseconds) => {
        delays.push(milliseconds);
      },
      report: (row) => {
        reported.push(row);
      },
    });
    expect(result).toBe(good);
    expect(calls).toEqual([args, args, args]);
    expect(delays).toEqual([2000, 5000]);
    expect(reported).toEqual(results);
  });

  it.each([
    { status: 1, stdout: "", stderr: "signature verification failed" },
    { status: 1, stdout: "", stderr: "Error: HTTP 403: Forbidden" },
    { status: null, stdout: "", stderr: "", error: new Error("native executable missing") },
  ])("does not retry a verification, authorization or native execution failure", async (failure) => {
    let calls = 0;
    const result = await verifyWithTransientRetries(args, {
      run: () => {
        calls++;
        return failure;
      },
      wait: async () => {
        throw new Error("must not wait");
      },
      report: () => {},
    });
    expect(result).toBe(failure);
    expect(calls).toBe(1);
  });

  it("fails closed after eight transient failures with bounded delays", async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await verifyWithTransientRetries(args, {
      run: () => {
        calls++;
        return transient;
      },
      wait: async (milliseconds) => {
        delays.push(milliseconds);
      },
      report: () => {},
    });
    expect(result.status).toBe(1);
    expect(calls).toBe(8);
    expect(delays).toEqual([2000, 5000, 10000, 20000, 30000, 30000, 30000]);
  });

  it("retains all exact policy flags and verifies signed head, manifest and every receipt", () => {
    const workflow = readFileSync(".github/workflows/signed-catalog-v2.yml", "utf8");
    const step = workflow.slice(workflow.indexOf("- name: verify outer attestations"));
    expect(step.match(/node \.github\/verify-attestation-retry\.mjs/gu)).toHaveLength(3);
    for (const flag of [
      "--repo",
      "--source-digest",
      "--signer-workflow",
      "--source-ref refs/heads/main",
      "--deny-self-hosted-runners",
    ])
      expect(step).toContain(flag);
    expect(step).toContain('"$SIGNED_CATALOG_PATH"');
    expect(step).toContain('"$QUALIFICATION_RECEIPT_SET_PATH"');
    expect(step).toContain('"signed-catalog-v2/$receipt"');
  });
});
