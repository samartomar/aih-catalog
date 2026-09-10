import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const delays = Object.freeze([2000, 5000, 10000, 20000, 30000, 30000, 30000]);
const nativeVerify = (args) => spawnSync("gh", ["attestation", "verify", ...args], {
  encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024,
});
const reportNative = (result) => {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) process.stderr.write(`${result.error.message}\n`);
};

/** Retry transport failures only. Every successful result still comes from gh. */
export async function verifyWithTransientRetries(args, {
  run = nativeVerify, wait = setTimeout, report = reportNative,
} = {}) {
  const unchangedArgs = Object.freeze([...args]);
  for (let attempt = 0; ; attempt++) {
    const result = run(unchangedArgs);
    report(result);
    if (result.status === 0) return result;
    if (result.error || result.status === null || attempt >= delays.length ||
        !/^Error: HTTP (?:429|502|503|504):/mu.test(result.stderr ?? "")) return result;
    await wait(delays[attempt]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await verifyWithTransientRetries(process.argv.slice(2));
  process.exitCode = result.status === 0 ? 0 : result.status || 1;
}
