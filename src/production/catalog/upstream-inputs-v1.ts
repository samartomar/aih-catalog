import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertSafeRelativePosixPathV1, sha256HexV1 } from "../strict-json-v1.js";
import { COMMIT_SHA, exactKeys, literal, record, SHA256_HEX, text } from "../validate-v1.js";

/**
 * `src/production/data/upstream-inputs-v1.json` records what each networked
 * `produce:<name>` step fetched: the repository, the full commit, the sha256 of
 * the committed input file, and the sha256 of every upstream file read whose
 * digest the input file does not already carry. The offline build verifies
 * every recorded input before any generator reads it.
 */
export const UPSTREAM_INPUTS_FILE_V1 = "upstream-inputs-v1.json";
export const UPSTREAM_INPUTS_FORMAT_V1 = "aih-catalog-upstream-inputs";

export interface UpstreamInputRecordV1 {
  repository: string;
  commit: string;
  sha256: string;
  sources: Readonly<Record<string, string>>;
}

export interface UpstreamInputsManifestV1 {
  format: typeof UPSTREAM_INPUTS_FORMAT_V1;
  version: 1;
  files: Readonly<Record<string, UpstreamInputRecordV1>>;
}

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const INPUT_FILE = /^[a-z0-9][a-z0-9.-]*\.json$/u;

export function parseUpstreamInputsManifestV1(value: unknown): UpstreamInputsManifestV1 {
  const input = exactKeys(
    record(value, "upstream inputs"),
    ["format", "version", "files"],
    "upstream inputs",
  );
  literal(input.format, UPSTREAM_INPUTS_FORMAT_V1, "upstream inputs format");
  literal(input.version, 1, "upstream inputs version");
  const files: Record<string, UpstreamInputRecordV1> = {};
  for (const [file, candidate] of Object.entries(record(input.files, "upstream inputs files"))) {
    text(file, "upstream input file", INPUT_FILE);
    if (file === UPSTREAM_INPUTS_FILE_V1) throw new TypeError("upstream inputs cannot list itself");
    const label = `upstream input ${file}`;
    const entry = exactKeys(
      record(candidate, label),
      ["repository", "commit", "sha256", "sources"],
      label,
    );
    const sources: Record<string, string> = {};
    for (const [path, digest] of Object.entries(record(entry.sources, `${label} sources`))) {
      assertSafeRelativePosixPathV1(path, `${label} source path`);
      sources[path] = text(digest, `${label} source ${path}`, SHA256_HEX);
    }
    files[file] = {
      repository: text(entry.repository, `${label} repository`, REPOSITORY),
      commit: text(entry.commit, `${label} commit`, COMMIT_SHA),
      sha256: text(entry.sha256, `${label} sha256`, SHA256_HEX),
      sources,
    };
  }
  return { format: UPSTREAM_INPUTS_FORMAT_V1, version: 1, files };
}

export function productionDataPathV1(root: string, file: string): string {
  return resolve(root, "src", "production", "data", file);
}

export function readUpstreamInputsManifestV1(root: string): UpstreamInputsManifestV1 {
  return parseUpstreamInputsManifestV1(
    JSON.parse(readFileSync(productionDataPathV1(root, UPSTREAM_INPUTS_FILE_V1), "utf8")),
  );
}

export interface VerifiedUpstreamInputV1 {
  provenance: UpstreamInputRecordV1;
  bytes: Buffer;
  json: unknown;
}

/** Reads one recorded input and fails closed unless its bytes match the record. */
export function readVerifiedUpstreamInputV1(
  root: string,
  manifest: UpstreamInputsManifestV1,
  file: string,
): VerifiedUpstreamInputV1 {
  const provenance = manifest.files[file];
  if (provenance === undefined) throw new TypeError(`upstream input ${file} is not recorded`);
  const bytes = readFileSync(productionDataPathV1(root, file));
  if (sha256HexV1(bytes) !== provenance.sha256)
    throw new TypeError(`upstream input ${file} does not match its recorded sha256`);
  const json: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  return { provenance, bytes, json };
}
