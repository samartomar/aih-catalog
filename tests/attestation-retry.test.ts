import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type Result = { status: number | null; stdout: string; stderr: string; error?: Error };
type Dependencies = {
  run: (args: readonly string[], lane?: number) => Result | Promise<Result>;
  wait: (milliseconds: number) => Promise<void>;
  report: (result: Result) => void;
};
type BatchResult = {
  status: number;
  results: readonly {
    subject: string;
    attempts: readonly Result[];
    result: Result;
  }[];
};
type BatchDependencies = Omit<Dependencies, "report"> & {
  reportSubject: (row: BatchResult["results"][number]) => void;
};
type BatchInput = {
  concurrency: number;
  receiptSetPath: string;
  root: string;
  signedCatalogPath: string;
  verifyArgs: readonly string[];
};
const {
  createIsolatedNativeVerifierPool,
  isPathWithinRoot,
  verifyAttestationBatch,
  verifyWithTransientRetries,
} = (await import(pathToFileURL(resolve(".github/verify-attestation-retry.mjs")).href)) as {
  createIsolatedNativeVerifierPool: (
    laneCount: number,
    dependencies: {
      execute: (args: readonly string[], cacheHome: string) => Result | Promise<Result>;
      tempRoot: string;
    },
  ) => {
    close: () => void;
    run: (args: readonly string[], lane: number) => Promise<Result>;
  };
  isPathWithinRoot: (
    root: string,
    subject: string,
    pathTools?: Pick<typeof win32, "isAbsolute" | "relative" | "sep">,
  ) => boolean;
  verifyAttestationBatch: (
    input: BatchInput,
    dependencies: BatchDependencies,
  ) => Promise<BatchResult>;
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
const verifyArgs = [
  "--repo",
  "samartomar/aih-catalog",
  "--source-digest",
  "a".repeat(40),
  "--signer-workflow",
  "samartomar/aih-catalog/.github/workflows/signed-catalog-v2.yml",
  "--source-ref",
  "refs/heads/main",
  "--deny-self-hosted-runners",
];

function batchFixture(
  paths = ["receipts/one.json", "receipts/two.json"],
  missing: readonly string[] = [],
) {
  const root = mkdtempSync(join(tmpdir(), "aih-catalog-attestation-batch-"));
  const signedCatalogPath = "signed-catalog-v2.json";
  const receiptSetPath = "qualification-receipt-set.json";
  writeFileSync(resolve(root, signedCatalogPath), "signed catalog");
  writeFileSync(
    resolve(root, receiptSetPath),
    JSON.stringify({
      entries: paths.map((path, index) => ({ entryId: `entry-${index}`, path })),
      format: "aih-supported-qualification-receipt-set",
      version: 1,
    }),
  );
  for (const path of new Set(paths)) {
    if (!/^receipts\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/u.test(path) || missing.includes(path))
      continue;
    const subject = resolve(root, path);
    mkdirSync(dirname(subject), { recursive: true });
    writeFileSync(subject, path);
  }
  return {
    expectedSubjects: [signedCatalogPath, receiptSetPath, ...paths],
    input: { concurrency: 4, receiptSetPath, root, signedCatalogPath, verifyArgs },
    root,
  };
}

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
    expect(step.match(/node \.github\/verify-attestation-retry\.mjs/gu)).toHaveLength(1);
    expect(step).toContain(
      `node .github/verify-attestation-retry.mjs --batch 8 "$SIGNED_CATALOG_PATH" "$QUALIFICATION_RECEIPT_SET_PATH" -- "\${verify_args[@]}"`,
    );
    for (const flag of [
      "--repo",
      "--source-digest",
      "--signer-workflow",
      "--source-ref refs/heads/main",
      "--deny-self-hosted-runners",
    ])
      expect(step).toContain(flag);
    expect(step).not.toContain("while IFS= read -r receipt");
  });
});

describe("bounded attestation batch", () => {
  it("rejects a Windows cross-volume subject path", () => {
    const root = "C:\\artifact";
    const subject = "D:\\outside\\receipt.json";
    expect(win32.isAbsolute(win32.relative(root, subject))).toBe(true);
    expect(isPathWithinRoot(root, subject, win32)).toBe(false);
  });

  it("keeps native verifier caches private until every child completes", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "aih-catalog-attestation-pool-test-"));
    const cacheHomes: string[] = [];
    const releases: ((result: Result) => void)[] = [];
    try {
      const pool = createIsolatedNativeVerifierPool(2, {
        execute: (_received, cacheHome) => {
          cacheHomes.push(cacheHome);
          return new Promise<Result>((resolveResult) => releases.push(resolveResult));
        },
        tempRoot,
      });
      const children = [pool.run(args, 0), pool.run(args, 1)];
      await new Promise((done) => setTimeout(done, 0));

      expect(new Set(cacheHomes).size).toBe(2);
      expect(cacheHomes.every((cacheHome) => existsSync(cacheHome))).toBe(true);
      expect(() => pool.close()).toThrow(/children are active/u);
      expect(cacheHomes.every((cacheHome) => existsSync(cacheHome))).toBe(true);

      for (const release of releases) release(good);
      await Promise.all(children);
      pool.close();
      expect(cacheHomes.every((cacheHome) => !existsSync(cacheHome))).toBe(true);
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("completes one verifier warm-up before starting the concurrent workers", async () => {
    const fixture = batchFixture();
    const started: string[] = [];
    let releaseWarmup: ((result: Result) => void) | undefined;
    try {
      const batch = verifyAttestationBatch(fixture.input, {
        run: (received) => {
          const subject = received[0];
          if (subject === undefined) throw new Error("expected subject argument");
          started.push(subject);
          return subject === fixture.expectedSubjects[0]
            ? new Promise<Result>((resolveResult) => {
                releaseWarmup = resolveResult;
              })
            : good;
        },
        wait: async () => {},
        reportSubject: () => {},
      });
      await new Promise((done) => setTimeout(done, 0));
      const startedBeforeWarmupFinished = [...started];
      releaseWarmup?.(good);
      expect((await batch).status).toBe(0);
      expect(startedBeforeWarmupFinished).toEqual([fixture.expectedSubjects[0]]);
      expect(started).toHaveLength(fixture.expectedSubjects.length);
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it("assigns each concurrent worker a distinct stable verifier lane", async () => {
    const fixture = batchFixture([
      "receipts/one.json",
      "receipts/two.json",
      "receipts/three.json",
      "receipts/four.json",
      "receipts/five.json",
      "receipts/six.json",
    ]);
    const calls: { lane: number | undefined; subject: string }[] = [];
    const activeLanes = new Set<number | undefined>();
    try {
      const result = await verifyAttestationBatch(fixture.input, {
        run: async (received, lane) => {
          const subject = received[0];
          if (subject === undefined) throw new Error("expected subject argument");
          if (activeLanes.has(lane)) throw new Error("one verifier lane ran concurrent children");
          calls.push({ lane, subject });
          activeLanes.add(lane);
          await new Promise((done) => setTimeout(done, 2));
          activeLanes.delete(lane);
          return good;
        },
        wait: async () => {},
        reportSubject: () => {},
      });
      expect(result.status).toBe(0);
      expect(calls[0]).toEqual({ lane: 0, subject: fixture.expectedSubjects[0] });
      expect(new Set(calls.slice(1).map(({ lane }) => lane))).toEqual(new Set([0, 1, 2, 3]));
      expect(calls).toHaveLength(fixture.expectedSubjects.length);
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it("caps concurrency and fans in one deterministic result for every exact subject", async () => {
    const fixture = batchFixture([
      "receipts/one.json",
      "receipts/two.json",
      "receipts/three.json",
      "receipts/four.json",
      "receipts/five.json",
      "receipts/six.json",
    ]);
    let active = 0;
    let maximumActive = 0;
    const calls: readonly string[][] = [];
    const reported: BatchResult["results"][number][] = [];
    try {
      const result = await verifyAttestationBatch(fixture.input, {
        run: async (received) => {
          active++;
          maximumActive = Math.max(maximumActive, active);
          (calls as string[][]).push([...received]);
          await new Promise((done) => setTimeout(done, 2));
          active--;
          return { ...good, stdout: `verified ${received[0]}` };
        },
        wait: async () => {},
        reportSubject: (row) => reported.push(row),
      });
      expect(maximumActive).toBe(4);
      expect(result.status).toBe(0);
      expect(result.results.map(({ subject }) => subject)).toEqual(fixture.expectedSubjects);
      expect(reported.map(({ subject }) => subject)).toEqual(fixture.expectedSubjects);
      expect(calls).toHaveLength(fixture.expectedSubjects.length);
      expect(calls).toEqual(
        expect.arrayContaining(fixture.expectedSubjects.map((subject) => [subject, ...verifyArgs])),
      );
      expect(result.results.every(({ attempts }) => attempts.length === 1)).toBe(true);
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it.each([
    {
      label: "unsafe",
      paths: ["receipts/one.json", "../outside.json"],
      missing: [],
    },
    {
      label: "duplicate",
      paths: ["receipts/one.json", "receipts/one.json"],
      missing: [],
    },
    {
      label: "missing",
      paths: ["receipts/one.json", "receipts/missing.json"],
      missing: ["receipts/missing.json"],
    },
  ])("rejects $label subjects before starting native verification", async ({ paths, missing }) => {
    const fixture = batchFixture(paths, missing);
    let calls = 0;
    try {
      await expect(
        verifyAttestationBatch(fixture.input, {
          run: () => {
            calls++;
            return good;
          },
          wait: async () => {},
          reportSubject: () => {},
        }),
      ).rejects.toThrow();
      expect(calls).toBe(0);
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it.each([
    "artifact digest mismatch",
    "provenance verification failed",
    "Error: HTTP 403: Forbidden",
  ])("fails the whole batch on permanent native failure: %s", async (stderr) => {
    const fixture = batchFixture();
    const calls: string[] = [];
    try {
      const result = await verifyAttestationBatch(fixture.input, {
        run: (received) => {
          const subject = received[0];
          if (subject === undefined) throw new Error("expected subject argument");
          calls.push(subject);
          return subject === "receipts/one.json" ? { status: 1, stdout: "", stderr } : good;
        },
        wait: async () => {
          throw new Error("permanent failures must not wait");
        },
        reportSubject: () => {},
      });
      expect(result.status).toBe(1);
      expect(result.results).toHaveLength(fixture.expectedSubjects.length);
      expect(calls).toHaveLength(fixture.expectedSubjects.length);
      expect(
        result.results.find(({ subject }) => subject === "receipts/one.json")?.result.status,
      ).toBe(1);
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it("retains bounded transient retries for each subject", async () => {
    const fixture = batchFixture();
    const attempts = new Map<string, number>();
    const waits: number[] = [];
    try {
      const result = await verifyAttestationBatch(fixture.input, {
        run: (received) => {
          const subject = received[0];
          if (subject === undefined) throw new Error("expected subject argument");
          const attempt = (attempts.get(subject) ?? 0) + 1;
          attempts.set(subject, attempt);
          return subject === "receipts/one.json" && attempt === 1 ? transient : good;
        },
        wait: async (milliseconds) => {
          waits.push(milliseconds);
        },
        reportSubject: () => {},
      });
      expect(result.status).toBe(0);
      expect(attempts.get("receipts/one.json")).toBe(2);
      expect(waits).toEqual([2000]);
      expect(
        result.results.find(({ subject }) => subject === "receipts/one.json")?.attempts,
      ).toEqual([transient, good]);
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it("does not report success before the final subject finishes", async () => {
    const fixture = batchFixture(["receipts/last.json"]);
    let releaseLast: ((result: Result) => void) | undefined;
    let settled = false;
    try {
      const batch = verifyAttestationBatch(
        { ...fixture.input, concurrency: 3 },
        {
          run: (received) =>
            received[0] === "receipts/last.json"
              ? new Promise<Result>((resolveResult) => {
                  releaseLast = resolveResult;
                })
              : good,
          wait: async () => {},
          reportSubject: () => {},
        },
      ).then((result) => {
        settled = true;
        return result;
      });
      await new Promise((done) => setTimeout(done, 0));
      expect(settled).toBe(false);
      expect(releaseLast).toBeTypeOf("function");
      releaseLast?.(good);
      expect((await batch).status).toBe(0);
      expect(settled).toBe(true);
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });

  it.each([
    0, 9,
  ])("rejects out-of-range concurrency %i before verification", async (concurrency) => {
    const fixture = batchFixture();
    let calls = 0;
    try {
      await expect(
        verifyAttestationBatch(
          { ...fixture.input, concurrency },
          {
            run: () => {
              calls++;
              return good;
            },
            wait: async () => {},
            reportSubject: () => {},
          },
        ),
      ).rejects.toThrow();
      expect(calls).toBe(0);
    } finally {
      rmSync(fixture.root, { force: true, recursive: true });
    }
  });
});
