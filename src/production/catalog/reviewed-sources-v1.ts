import { sha256HexV1 } from "../strict-json-v1.js";
import { COMMIT_SHA, exactKeys, list, literal, record, SHA256_HEX, text } from "../validate-v1.js";

/**
 * A hand-reviewed descriptor section names the upstream commit it was reviewed
 * at and the sha256 of every upstream file the review read. The section is
 * emitted only while the selected upstream source is that commit and those
 * bytes; anything else needs a new review, so generation refuses it.
 */
export interface ReviewedSourcesV1 {
  readonly repository: string;
  readonly commit: string;
  readonly sources: readonly { readonly path: string; readonly sha256: string }[];
}

export interface FetchedSourceFileV1 {
  path: string;
  sha256: string;
  bytes: Buffer;
}

/**
 * Reads a produced `{ version: 1, repository, commit, files: [{ path, sha256,
 * bytesBase64 }] }` input: the upstream files a producer fetched at one commit,
 * byte for byte. Every recorded digest must be the digest of its bytes.
 */
export function parseFetchedSourceFilesV1(
  value: unknown,
  label: string,
  repository: string,
): { commit: string; files: FetchedSourceFileV1[] } {
  const input = exactKeys(
    record(value, label),
    ["version", "repository", "commit", "files"],
    label,
  );
  literal(input.version, 1, `${label} version`);
  literal(input.repository, repository, `${label} repository`);
  const commit = text(input.commit, `${label} commit`, COMMIT_SHA);
  const seen = new Set<string>();
  const files = list(input.files, `${label} files`, 1, 64).map((item) => {
    const file = exactKeys(record(item, `${label} file`), ["path", "sha256", "bytesBase64"], label);
    const path = text(file.path, `${label} file path`);
    if (seen.has(path)) throw new TypeError(`${label} carries ${path} twice`);
    seen.add(path);
    const sha256 = text(file.sha256, `${label} ${path} sha256`, SHA256_HEX);
    const base64 = text(file.bytesBase64, `${label} ${path} bytes`);
    const bytes = Buffer.from(base64, "base64");
    if (bytes.toString("base64") !== base64 || sha256HexV1(bytes) !== sha256)
      throw new TypeError(`${label} ${path} does not match its recorded sha256`);
    return { path, sha256, bytes };
  });
  return { commit, files };
}

/**
 * Refuses unless the selected upstream source is exactly what was reviewed: the
 * same repository and commit, and the same set of files with the same sha256.
 * `selected.sources` must carry digests computed from the selected bytes.
 */
export function assertReviewedSourcesV1(
  label: string,
  reviewed: ReviewedSourcesV1,
  selected: ReviewedSourcesV1,
): void {
  const again = "; review it again before generating";
  if (selected.repository !== reviewed.repository)
    throw new TypeError(
      `${label} was reviewed in ${reviewed.repository} but the selected upstream source is ${selected.repository}${again}`,
    );
  if (selected.commit !== reviewed.commit)
    throw new TypeError(
      `${label} was reviewed at ${reviewed.commit} but the selected upstream source is ${selected.commit}${again}`,
    );
  const actual = new Map(selected.sources.map((source) => [source.path, source.sha256]));
  if (actual.size !== selected.sources.length)
    throw new TypeError(`${label}: the selected upstream source names a file twice`);
  const expected = new Set<string>();
  for (const { path, sha256 } of reviewed.sources) {
    expected.add(path);
    const digest = actual.get(path);
    if (digest === undefined)
      throw new TypeError(
        `${label} reviewed ${path} (sha256 ${sha256}) but the selected upstream source at ${selected.commit} does not carry it${again}`,
      );
    if (digest !== sha256)
      throw new TypeError(
        `${label} reviewed ${path} with sha256 ${sha256} but the selected upstream bytes have sha256 ${digest}${again}`,
      );
  }
  for (const { path, sha256 } of selected.sources)
    if (!expected.has(path))
      throw new TypeError(
        `${label} reads ${path} (sha256 ${sha256}), which was not reviewed${again}`,
      );
}
