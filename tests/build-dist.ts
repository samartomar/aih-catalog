import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

/**
 * Vitest global setup: builds dist/catalog from the current source before any test runs, as
 * `npm run build:dist` does. The packed file list and the repository tools (the port report
 * among them) read the built entry points, so a test run never checks a missing or stale build.
 */
export default function setup(): void {
  for (const argv of [
    ["tools/clean-dist.mjs"],
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"],
  ]) {
    const run = spawnSync(process.execPath, argv, { cwd: root, encoding: "utf8" });
    if (run.status !== 0)
      throw new Error(`building dist/catalog failed: ${run.stdout}${run.stderr}`);
  }
}
