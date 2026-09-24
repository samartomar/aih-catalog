import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** A refusal with a stable code, so callers and tests can branch on the kind. */
export class CandidateMarkerRefusalV1 extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CandidateMarkerRefusalV1";
    this.code = code;
  }
}

/** Markers and manifests are tiny JSON files; 1 MiB is far above any real one. */
export const CANDIDATE_MARKER_LIMIT_V1 = 1024 * 1024;

/**
 * Bounded read of a marker or manifest: lstat first, so a non-regular file
 * (link, junction, directory) refuses, and a file over the limit refuses
 * before its bytes are read — both typed, naming the file and the limit.
 */
export function readMarkerFileV1(path, limitBytes = CANDIDATE_MARKER_LIMIT_V1) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new CandidateMarkerRefusalV1(
      "candidate-marker-not-regular",
      `${path} is not a regular file; the candidate is refused`,
    );
  if (stat.size > limitBytes)
    throw new CandidateMarkerRefusalV1(
      "candidate-marker-too-large",
      `${path} is ${stat.size} bytes, over the marker limit of ${limitBytes} bytes; the candidate is refused`,
    );
  return readFileSync(path, "utf8");
}

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
  if (existsSync(manifest) && Object.hasOwn(JSON.parse(readMarkerFileV1(manifest)), "aihCandidate"))
    markers.push("package.json#aihCandidate");
  return markers;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let markers = [];
  try {
    markers = candidateMarkersV1(process.cwd());
  } catch (error) {
    console.error(`refusing: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
  if (markers.length > 0) {
    console.error(
      `refusing: ${process.cwd()} is a candidate @aihq/catalog root (${markers.join(", ")}); candidates are built only by npm run build:candidate and are never built over, checked as the Catalog index, or published`,
    );
    process.exitCode = 1;
  }
}
