import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Refuses to build, check or publish over a candidate Catalog root: one that
 * carries CANDIDATE.json or package.json#aihCandidate (npm run build:candidate
 * writes both into dist-candidate/). Candidate bytes never replace the
 * committed defaults and are never published.
 */
export function candidateMarkersV1(directory) {
  const markers = [];
  if (existsSync(resolve(directory, "CANDIDATE.json"))) markers.push("CANDIDATE.json");
  const manifest = resolve(directory, "package.json");
  if (existsSync(manifest) && Object.hasOwn(JSON.parse(readFileSync(manifest, "utf8")), "aihCandidate"))
    markers.push("package.json#aihCandidate");
  return markers;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const markers = candidateMarkersV1(process.cwd());
  if (markers.length > 0) {
    console.error(
      `refusing: ${process.cwd()} is a candidate @aihq/catalog root (${markers.join(", ")}); candidates are built only by npm run build:candidate and are never built over, checked as the Catalog index, or published`,
    );
    process.exitCode = 1;
  }
}
