import type { CatalogRelease, Json } from "../release/contracts.js";
import { readRelease } from "../release/reader.js";
import { refuse } from "./errors.js";
import { RELEASE_PATH, sha256Hex } from "./generate.js";

export type Record_ = { [key: string]: Json };

/**
 * The published candidate being advanced: `release/**` as package-relative
 * files. Loading proves it is internally consistent before anything is reused
 * from it, so a damaged base can never be carried into the next candidate.
 */
export interface BaseRelease {
  readonly files: ReadonlyMap<string, Buffer>;
  readonly checked: CatalogRelease;
  readonly sources: readonly Record_[];
  readonly items: readonly Record_[];
  readonly metadata?: Json;
}

const asRecord = (value: Json | undefined): Record_ => value as Record_;
const memberList = (item: Record_): Record_[] => [
  asRecord(item.recipe),
  ...(item.materials as Json[]).map(asRecord),
];

export function parseBaseRelease(input: ReadonlyMap<string, Uint8Array>): BaseRelease {
  const files = new Map([...input].map(([path, bytes]) => [path, Buffer.from(bytes)] as const));
  const releaseBytes = files.get(RELEASE_PATH);
  if (releaseBytes === undefined) return refuse("base-invalid", `${RELEASE_PATH} is missing`);
  const read = readRelease(releaseBytes, { expectedSha256: sha256Hex(releaseBytes) });
  if (!read.valid) {
    return refuse("base-invalid", "the base release document is not a valid release", {
      diagnostics: read.diagnostics.map((d) => d.reason),
    });
  }
  const document = JSON.parse(releaseBytes.toString("utf8")) as Record_;
  const items = (document.items as Json[]).map(asRecord);
  const referenced = new Set<string>([RELEASE_PATH]);
  for (const item of items) {
    for (const member of memberList(item)) {
      const path = member.path as string;
      const bytes = files.get(path);
      if (bytes === undefined) {
        return refuse("base-member-missing", `${path} is declared but absent`, {
          itemId: item.id,
          path,
        });
      }
      if (bytes.length !== member.byteLength || sha256Hex(bytes) !== member.sha256) {
        return refuse("base-member-mismatch", `${path} differs from its recorded hash or length`, {
          itemId: item.id,
          path,
        });
      }
      referenced.add(path);
    }
  }
  const orphans = [...files.keys()].filter((path) => !referenced.has(path)).sort();
  if (orphans.length > 0) {
    return refuse("base-orphan-file", `files not declared by the release: ${orphans.join(", ")}`, {
      orphans,
    });
  }
  return {
    files,
    checked: read.release,
    sources: (document.sources as Json[]).map(asRecord),
    items,
    ...(document.metadata === undefined ? {} : { metadata: document.metadata }),
  };
}
