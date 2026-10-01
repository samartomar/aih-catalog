import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type BaseRelease, parseBaseRelease } from "./base.js";
import { buildCandidate, type CandidateReport } from "./candidate.js";
import type { ProducerDeclaration } from "./declaration.js";
import { ProducerRefusal, refuse } from "./errors.js";
import { installCandidate, readReleaseDirectory } from "./install.js";
import { assertCandidateIntegrity, checkCandidateFiles, type IntegrityCheck } from "./integrity.js";
import {
  npmVersion,
  type PackedArtifact,
  packStaged,
  stagePackage,
  verifyPacked,
} from "./package.js";
import { renderReview } from "./review.js";
import {
  type CacheCondition,
  type Clock,
  type PhaseContext,
  PhaseRecorder,
  realClock,
  runnerInfo,
  summarize,
  type TimingSummary,
} from "./timing.js";
import type { SourceTree } from "./tree.js";

export interface AcquiredTree extends SourceTree {
  readonly cache?: "hit" | "miss";
  readonly attempts?: number;
  /** True only when the repository identity was verified against GitHub in this run. */
  readonly originVerified: boolean;
}

export interface PrepareOptions {
  /** Package root: manifest, built `dist/release`, schemas and the published `release/`. */
  readonly sourceRoot: string;
  readonly declaration: ProducerDeclaration;
  readonly commit: string;
  readonly acquire: (context: PhaseContext) => Promise<AcquiredTree>;
  /** Where the report, review page, artifact and timing summary are written. */
  readonly outDir: string;
  readonly stageDir?: string;
  readonly advanceProvenance?: boolean;
  /** Replace `sourceRoot/release` with the verified candidate. Off: the candidate stays staged. */
  readonly apply?: boolean;
  /** Optional bounded consumer handoff over the packed artifact (e.g. the Core packed consumer). */
  readonly handoff?: (artifact: PackedArtifact) => Promise<{ ok: boolean; detail?: string }>;
  readonly clock?: Clock;
  readonly detectedAt?: Date;
  readonly condition?: CacheCondition;
  readonly dependencies?: string;
  /** phase name → milliseconds to wait for real and label as SIMULATED. */
  readonly simulate?: Readonly<Record<string, number>>;
  readonly git?: { readonly commit?: string; readonly dirty: boolean };
  /** Test seam passed to the installer. */
  readonly beforeSwap?: () => void;
}

export interface PrepareResult {
  readonly summary: TimingSummary;
  readonly report?: CandidateReport;
  readonly artifact?: PackedArtifact;
  readonly installed: boolean;
}

const stamp = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Prepares one content candidate from an explicit upstream pin: acquire the
 * pinned tree, produce only what the delta affects, check the complete result,
 * pack and verify the real artifact, prepare review material and (on request)
 * swap it in atomically. The path never waits for, requires or records Scan;
 * a refusal leaves the published `release/` exactly as it was.
 */
export async function prepareCandidate(options: PrepareOptions): Promise<PrepareResult> {
  const clock = options.clock ?? realClock;
  const recorder = new PhaseRecorder(clock, options.simulate);
  const startedAt = clock.wall();
  const startedMono = clock.now();
  if (options.detectedAt && options.detectedAt.getTime() > startedAt.getTime()) {
    return refuse("detected-at-invalid", "the delta cannot be detected after preparation started");
  }
  const manifest = JSON.parse(readFileSync(join(options.sourceRoot, "package.json"), "utf8")) as {
    name: string;
    version: string;
    files?: string[];
  };
  const identity = { name: manifest.name, version: manifest.version };
  const stageDir = options.stageDir ?? join(options.outDir, "stage");
  let tree: AcquiredTree | undefined;
  let base: BaseRelease | undefined;
  let report: CandidateReport | undefined;
  let artifact: PackedArtifact | undefined;
  let candidateFiles: ReadonlyMap<string, Buffer> | undefined;
  let installed = false;
  let outcome: TimingSummary["outcome"] = "ready";
  let refusal: { reason: string; message: string } | undefined;
  let failure: unknown;

  try {
    base = await recorder.phase("load-base", (context) => {
      const loaded = parseBaseRelease(readReleaseDirectory(options.sourceRoot));
      context.detail(`${loaded.items.length} released items`);
      return loaded;
    });
    tree = await recorder.phase("fetch-inputs", async (context) => {
      const acquired = await options.acquire(context);
      if (acquired.commit !== options.commit) {
        refuse("commit-mismatch", `acquired ${acquired.commit}, not the pinned ${options.commit}`);
      }
      if ((acquired.attempts ?? 0) > 1) context.retried((acquired.attempts as number) - 1);
      context.detail(
        `${acquired.inventory.paths.size} files; cache ${acquired.cache ?? "not-used"}${acquired.originVerified ? "" : "; origin NOT verified"}`,
      );
      return acquired;
    });
    const built = await recorder.phase("affected-production", (context) => {
      const result = buildCandidate({
        declaration: options.declaration,
        tree: tree as AcquiredTree,
        base: base as BaseRelease,
        package: identity,
        ...(options.advanceProvenance ? { advanceProvenance: true } : {}),
      });
      const { summary } = result.report;
      context.detail(
        `added ${summary.added}, changed ${summary.changed}, removed ${summary.removed}, dependents ${summary["dependent-confirmed"]}, provenance-only ${summary["provenance-only"]}, unchanged ${summary.unchanged}`,
      );
      return result;
    });
    report = built.report;
    candidateFiles = built.files;
    let checks: readonly IntegrityCheck[] = [];
    await recorder.phase("integrity", (context) => {
      checks = assertCandidateIntegrity(built.files, identity).checks;
      context.checks(checks);
    });
    artifact = await recorder.phase("stage-and-pack", () => {
      stagePackage({ sourceRoot: options.sourceRoot, files: built.files, stageDir });
      return packStaged(stageDir, join(options.outDir, "artifact"));
    });
    const packedChecks = await recorder.phase("verify-packed", async (context) => {
      const verified = await verifyPacked({
        artifact: artifact as PackedArtifact,
        files: built.files,
        identity,
        manifest,
      });
      context.checks(verified.checks);
      if (!verified.ok) {
        refuse(
          "packed-verification-failed",
          verified.checks
            .filter((c) => !c.ok)
            .map((c) => c.name)
            .join(", "),
        );
      }
      return verified.checks;
    });
    if (options.handoff) {
      await recorder.phase("consumer-handoff", async (context) => {
        const result = await (options.handoff as NonNullable<PrepareOptions["handoff"]>)(
          artifact as PackedArtifact,
        );
        context.checks([
          {
            name: "core-consumer-handoff",
            ok: result.ok,
            ...(result.detail ? { detail: result.detail } : {}),
          },
        ]);
        if (!result.ok) refuse("handoff-failed", result.detail ?? "the consumer handoff failed");
      });
    } else {
      recorder.skip("consumer-handoff", "no explicit packed Core artifact supplied");
    }
    await recorder.phase("review-preparation", () => {
      mkdirSync(options.outDir, { recursive: true });
      writeFileSync(join(options.outDir, "candidate-report.json"), stamp(report));
      writeFileSync(
        join(options.outDir, "candidate-review.md"),
        renderReview({
          report: report as CandidateReport,
          checks: [...checks, ...packedChecks],
          artifact,
        }),
      );
    });
    if (options.apply) {
      await recorder.phase("install", (context) => {
        if (!(tree as AcquiredTree).originVerified) {
          refuse(
            "origin-unverified",
            "a candidate from an unverified origin cannot replace the published release",
          );
        }
        installCandidate({
          root: options.sourceRoot,
          files: built.files,
          ...(options.beforeSwap ? { beforeSwap: options.beforeSwap } : {}),
        });
        installed = true;
        const after = checkCandidateFiles(readReleaseDirectory(options.sourceRoot), identity);
        context.checks(after.checks);
        if (!after.ok)
          refuse("post-install-check-failed", "the installed release failed its checks");
      });
    } else {
      recorder.skip(
        "install",
        "dry run: the candidate is staged and the published release is untouched",
      );
    }
  } catch (error) {
    if (error instanceof ProducerRefusal) {
      outcome = "refused";
      refusal = { reason: error.reason, message: error.message.slice(0, 1000) };
    } else {
      outcome = "failed";
      refusal = {
        reason: "unexpected-error",
        message: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      };
      failure = error;
    }
  }

  const endedAt = clock.wall();
  const endedMono = clock.now();
  let npm = "unknown";
  try {
    npm = npmVersion();
  } catch {
    npm = "unavailable";
  }
  const summary = summarize({
    recorder,
    startedAt,
    startedMono,
    endedAt,
    endedMono,
    ...(options.detectedAt ? { detectedAt: options.detectedAt } : {}),
    outcome,
    ...(refusal ? { refusal } : {}),
    candidate: {
      ...(options.git?.commit ? { commit: options.git.commit } : {}),
      dirty: options.git?.dirty ?? false,
      ...(artifact ? { artifactSha256: artifact.sha256, artifactBytes: artifact.byteLength } : {}),
    },
    package: identity,
    workload: {
      source: tree?.repository ?? null,
      targetRevision: options.commit,
      baseRevisions: report?.baseRevisions ?? [],
      declaredItems: options.declaration.items.length,
      releasedItemsBefore: base?.items.length ?? null,
      candidateItems: report
        ? report.items.filter((item) => item.state !== "removed").length
        : null,
      candidateFiles: candidateFiles?.size ?? null,
      candidateReleaseBytes: report?.release.byteLength ?? null,
      upstreamInventoryFiles: tree?.inventory.paths.size ?? null,
      delta: report?.summary ?? null,
    },
    runner: runnerInfo(npm),
    cache: {
      condition: options.condition ?? "unspecified",
      dependencies: options.dependencies ?? "not reported by this run",
      sourceObjects: tree?.cache ?? "not-used",
    },
  });
  mkdirSync(options.outDir, { recursive: true });
  writeFileSync(join(options.outDir, "timing-summary.json"), stamp(summary));
  if (failure !== undefined) throw failure;
  return { summary, ...(report ? { report } : {}), ...(artifact ? { artifact } : {}), installed };
}
