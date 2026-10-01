import { expect, it } from "vitest";
import { type Clock, PhaseRecorder, summarize } from "../../src/producer/timing.js";

it("attributes a ceiling miss caused by queue time to the queue", async () => {
  const start = new Date("2026-10-01T00:00:00Z");
  let elapsed = 0;
  const clock: Clock = {
    now: () => elapsed,
    wall: () => new Date(start.getTime() + elapsed),
    sleep: async (ms) => {
      elapsed += ms;
    },
  };
  const recorder = new PhaseRecorder(clock);
  await recorder.phase("fetch-inputs", () => clock.sleep(1_000));
  const summary = summarize({
    recorder,
    startedAt: start,
    startedMono: 0,
    endedAt: clock.wall(),
    endedMono: clock.now(),
    detectedAt: new Date(start.getTime() - 7_200_000),
    outcome: "ready",
    candidate: { dirty: false },
    package: { name: "@aihq/catalog", version: "0.3.0" },
    workload: {},
    runner: {
      os: "fixture",
      osRelease: "fixture",
      arch: "fixture",
      cpus: 1,
      node: "fixture",
      npm: "fixture",
      ci: false,
    },
    cache: { condition: "cold-install", dependencies: "fixture", sourceObjects: "miss" },
  });
  expect(summary.clock.elapsedSeconds).toBe(7_201);
  expect(summary.misses).toEqual([{ phase: "queue", overBySeconds: 3_601 }]);
});
