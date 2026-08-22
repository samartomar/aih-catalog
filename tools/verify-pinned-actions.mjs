import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflow = readFileSync(resolve(import.meta.dirname, "../.github/workflows/signed-catalog-v2.yml"), "utf8");
const refs = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^@\s]+)@([0-9a-f]{40})\s*$/gm)].map(
  ([, action, sha]) => ({ action, sha }),
);
if (!refs.length || refs.some(({ action, sha }) => !/^[\w.-]+\/[\w.-]+$/.test(action) || !/^[0-9a-f]{40}$/.test(sha))) {
  throw new Error("invalid pinned action reference");
}
if (!process.argv.includes("--online")) {
  process.stdout.write("Pinned workflow action syntax PASS (offline)\n");
  process.exit(0);
}
for (const { action, sha } of refs) {
  const response = await fetch(`https://api.github.com/repos/${action}/commits/${sha}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "aih-supported-action-pin-check" },
  });
  if (!response.ok) throw new Error(`unresolvable action pin: ${action}@${sha}`);
}
process.stdout.write("Pinned workflow actions resolve PASS\n");
