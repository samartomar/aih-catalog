import { arch, cpus, platform, release } from "node:os";
import type { IntegrityCheck } from "./integrity.js";

/** The release plan's routine-candidate ceiling, in seconds. */
export const CEILING_SECONDS = 3_600;

export interface Clock {
  /** Monotonic milliseconds. */
  now(): number;
  wall(): Date;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => performance.now(),
  wall: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface PhaseRecord {
  readonly name: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly status: "passed" | "failed" | "skipped";
  /** Automatic retries inside this phase. */
  readonly retries: number;
  readonly detail?: string;
  readonly checks?: readonly IntegrityCheck[];
  /** Waiting this phase was told to simulate; never present unless explicitly requested. */
  readonly simulatedDelayMs?: number;
}

export interface PhaseContext {
  retried(count?: number): void;
  detail(text: string): void;
  checks(list: readonly IntegrityCheck[]): void;
  /** Sleeps for real, so measured elapsed time includes it, and labels it as simulated. */
  simulate(ms: number): Promise<void>;
}

/** Records real elapsed time per phase. It measures; it never estimates. */
export class PhaseRecorder {
  readonly phases: PhaseRecord[] = [];
  constructor(
    readonly clock: Clock = realClock,
    private readonly simulated: Readonly<Record<string, number>> = {},
  ) {}

  async phase<T>(name: string, run: (context: PhaseContext) => Promise<T> | T): Promise<T> {
    const startedAt = this.clock.wall().toISOString();
    const t0 = this.clock.now();
    let retries = 0;
    let detail: string | undefined;
    let checks: readonly IntegrityCheck[] | undefined;
    let simulatedMs = 0;
    const context: PhaseContext = {
      retried: (count = 1) => {
        retries += count;
      },
      detail: (text) => {
        detail = text;
      },
      checks: (list) => {
        checks = list;
      },
      simulate: async (ms) => {
        simulatedMs += ms;
        await this.clock.sleep(ms);
      },
    };
    const finish = (status: "passed" | "failed", note?: string) =>
      this.phases.push({
        name,
        startedAt,
        endedAt: this.clock.wall().toISOString(),
        durationMs: this.clock.now() - t0,
        status,
        retries,
        ...((note ?? detail) === undefined ? {} : { detail: (note ?? detail) as string }),
        ...(checks === undefined ? {} : { checks }),
        ...(simulatedMs > 0 ? { simulatedDelayMs: simulatedMs } : {}),
      });
    try {
      const requested = this.simulated[name];
      if (requested !== undefined) await context.simulate(requested);
      const value = await run(context);
      finish("passed");
      return value;
    } catch (error) {
      finish("failed", error instanceof Error ? error.message.slice(0, 500) : String(error));
      throw error;
    }
  }

  skip(name: string, reason: string): void {
    const at = this.clock.wall().toISOString();
    this.phases.push({
      name,
      startedAt: at,
      endedAt: at,
      durationMs: 0,
      status: "skipped",
      retries: 0,
      detail: reason,
    });
  }
}

export interface RunnerInfo {
  readonly os: string;
  readonly osRelease: string;
  readonly arch: string;
  readonly cpus: number;
  readonly node: string;
  readonly npm: string;
  readonly ci: boolean;
  readonly runner?: string;
}

export function runnerInfo(npm: string): RunnerInfo {
  const ci = process.env.GITHUB_ACTIONS === "true" || process.env.CI === "true";
  return {
    os: platform(),
    osRelease: release(),
    arch: arch(),
    cpus: cpus().length,
    node: process.version,
    npm,
    ci,
    ...(process.env.RUNNER_NAME
      ? { runner: `${process.env.RUNNER_OS ?? ""} ${process.env.RUNNER_NAME}`.trim() }
      : {}),
  };
}

export type CacheCondition = "cold-install" | "retained-cache";

export interface TimingSummary {
  readonly schema: "aihq-catalog-candidate-timing";
  readonly version: 1;
  readonly outcome: "ready" | "refused" | "failed";
  readonly refusal?: { readonly reason: string; readonly message: string };
  readonly candidate: {
    readonly commit?: string;
    readonly dirty: boolean;
    readonly artifactSha256?: string;
    readonly artifactBytes?: number;
  };
  readonly package: { readonly name: string; readonly version: string };
  readonly workload: Readonly<Record<string, unknown>>;
  readonly runner: RunnerInfo;
  readonly cache: {
    readonly condition: CacheCondition | "unspecified";
    readonly dependencies: string;
    readonly sourceObjects: "hit" | "miss" | "not-used";
  };
  readonly queue: {
    readonly detectedAt?: string;
    readonly startedAt: string;
    readonly queuedMs: number | null;
    readonly note: string;
  };
  readonly clock: {
    readonly startedAt: string;
    readonly endedAt: string;
    readonly elapsedMs: number;
    readonly elapsedSeconds: number;
    readonly ceilingSeconds: number;
    readonly withinCeiling: boolean;
    readonly humanWait: string;
  };
  readonly phases: readonly PhaseRecord[];
  readonly retries: { readonly total: number; readonly byPhase: Readonly<Record<string, number>> };
  readonly checks: readonly IntegrityCheck[];
  readonly optionalScan: {
    readonly awaited: false;
    readonly status: "not-awaited";
    readonly note: string;
  };
  readonly misses: readonly { readonly phase: string; readonly overBySeconds: number }[];
  readonly simulated: readonly {
    readonly phase: string;
    readonly delayMs: number;
    readonly label: string;
  }[];
}

export function summarize(input: {
  recorder: PhaseRecorder;
  startedAt: Date;
  startedMono: number;
  endedAt: Date;
  endedMono: number;
  detectedAt?: Date;
  outcome: TimingSummary["outcome"];
  refusal?: { reason: string; message: string };
  candidate: TimingSummary["candidate"];
  package: TimingSummary["package"];
  workload: TimingSummary["workload"];
  runner: RunnerInfo;
  cache: TimingSummary["cache"];
}): TimingSummary {
  const { recorder, startedAt, endedAt } = input;
  const queuedMs = input.detectedAt
    ? Math.max(0, startedAt.getTime() - input.detectedAt.getTime())
    : null;
  const preparationMs = input.endedMono - input.startedMono;
  const elapsedMs = preparationMs + (queuedMs ?? 0);
  const phases = recorder.phases;
  const byPhase: Record<string, number> = {};
  for (const phase of phases) if (phase.retries > 0) byPhase[phase.name] = phase.retries;
  const longest = [...phases].sort((a, b) => b.durationMs - a.durationMs)[0];
  const over = elapsedMs / 1000 - CEILING_SECONDS;
  return {
    schema: "aihq-catalog-candidate-timing",
    version: 1,
    outcome: input.outcome,
    ...(input.refusal ? { refusal: input.refusal } : {}),
    candidate: input.candidate,
    package: input.package,
    workload: input.workload,
    runner: input.runner,
    cache: input.cache,
    queue: {
      ...(input.detectedAt ? { detectedAt: input.detectedAt.toISOString() } : {}),
      startedAt: startedAt.toISOString(),
      queuedMs,
      note: input.detectedAt
        ? "queue is detected-at to start of preparation and is counted in elapsed"
        : "no detection time supplied: the clock starts when preparation starts and queue time is unmeasured",
    },
    clock: {
      startedAt: (input.detectedAt ?? startedAt).toISOString(),
      endedAt: endedAt.toISOString(),
      elapsedMs,
      elapsedSeconds: Math.round(elapsedMs) / 1000,
      ceilingSeconds: CEILING_SECONDS,
      withinCeiling: over <= 0,
      humanWait: "excluded; none occurs inside this run",
    },
    phases,
    retries: { total: Object.values(byPhase).reduce((a, b) => a + b, 0), byPhase },
    checks: phases.flatMap((phase) => phase.checks ?? []),
    optionalScan: {
      awaited: false,
      status: "not-awaited",
      note: "Optional Scan evidence is separate: it is neither awaited nor required, and no result is produced or implied here.",
    },
    misses:
      over > 0 && longest
        ? [{ phase: longest.name, overBySeconds: Math.round(over * 1000) / 1000 }]
        : [],
    simulated: phases
      .filter((phase) => phase.simulatedDelayMs !== undefined)
      .map((phase) => ({
        phase: phase.name,
        delayMs: phase.simulatedDelayMs as number,
        label: "SIMULATED delay requested explicitly; not real work",
      })),
  };
}
