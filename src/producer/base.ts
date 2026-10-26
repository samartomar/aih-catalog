import { baselineMembers } from "../release/baseline-members.js";
import { type CatalogRelease, type Json, preparedReleaseContent } from "../release/contracts.js";
import { readRelease, readReleaseContent } from "../release/reader.js";
import { refuse } from "./errors.js";
import {
  GUIDE_RELEASE_PATH,
  HOOK_RELEASE_PATH,
  NATIVE_BUNDLES_RELEASE_PATH,
  NATIVE_FIXTURE_RELEASE_PATH,
  RELEASE_PATH,
  sha256Hex,
} from "./generate.js";

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
  /** The previously published 1.1 release document, validated, when the base carries one. */
  readonly hookDocument?: Record_;
  /**
   * The native-fixture release documents the base carries, validated, by path. They are pure
   * functions of the package identity, so a candidate renders them again for its own identity.
   */
  /** Pinned Guide content carried unchanged by targeted upstream refreshes. */
  readonly guideDocument?: Record_;
  /** Additional ordinary content manifests preserved by targeted refreshes. */
  readonly contentDocuments?: ReadonlyMap<string, Record_>;
  /**
   * Prepared release 1.7 content awaiting its baseline, by content path, with its
   * content inventory path. Targeted refreshes carry it and re-freeze its inventory.
   */
  readonly preparedDocuments?: ReadonlyMap<string, { document: Record_; inventory: string }>;
  readonly nativeDocuments: ReadonlyMap<string, Record_>;
}

const asRecord = (value: Json | undefined): Record_ => value as Record_;
const memberList = (item: Record_): Record_[] => [
  asRecord(item.recipe),
  ...(item.materials as Json[]).map(asRecord),
];
/** Release 1.6 extended materials address package members by `packagePath`. */
const packagePathOf = (member: Record_): string =>
  String(
    Object.hasOwn(member, "path") ? member.path : (member as Record<string, Json>).packagePath,
  );

export function parseBaseRelease(input: ReadonlyMap<string, Uint8Array>): BaseRelease {
  const files = new Map([...input].map(([path, bytes]) => [path, Buffer.from(bytes)] as const));
  const releaseBytes = files.get(RELEASE_PATH);
  if (releaseBytes === undefined) return refuse("base-invalid", `${RELEASE_PATH} is missing`);
  const document = JSON.parse(releaseBytes.toString("utf8")) as Record_;
  // A compiled release 1.6 base is pre-baseline content; admit it through the
  // content reader. Earlier formats carry no baseline and use full admission.
  const read =
    document.schema === "urn:aihq:catalog:release:1.6.0"
      ? readReleaseContent(releaseBytes, { expectedSha256: sha256Hex(releaseBytes) })
      : readRelease(releaseBytes, { expectedSha256: sha256Hex(releaseBytes) });
  if (!read.valid) {
    return refuse("base-invalid", "the base release document is not a valid release", {
      diagnostics: read.diagnostics.map((d) => d.reason),
    });
  }
  const checkedDocuments = [read.release];
  const items = (document.items as Json[]).map(asRecord);
  const referenced = new Set<string>([RELEASE_PATH]);
  for (const item of items) {
    for (const member of memberList(item)) {
      const path = packagePathOf(member);
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
  let hookDocument: Record_ | undefined;
  const hookBytes = files.get(HOOK_RELEASE_PATH);
  if (hookBytes !== undefined) {
    const hookRead = readRelease(hookBytes, { expectedSha256: sha256Hex(hookBytes) });
    if (!hookRead.valid) {
      return refuse("base-invalid", `the base ${HOOK_RELEASE_PATH} is not a valid release`, {
        diagnostics: hookRead.diagnostics.map((d) => d.reason),
      });
    }
    hookDocument = JSON.parse(hookBytes.toString("utf8")) as Record_;
    checkedDocuments.push(hookRead.release);
    referenced.add(HOOK_RELEASE_PATH);
    for (const item of (hookDocument.items as Json[]).map(asRecord)) {
      for (const member of memberList(item)) {
        const path = packagePathOf(member);
        const bytes = files.get(path);
        if (bytes === undefined) {
          return refuse("base-member-missing", `${path} is declared but absent`, {
            itemId: item.id,
            path,
          });
        }
        if (bytes.length !== member.byteLength || sha256Hex(bytes) !== member.sha256) {
          return refuse(
            "base-member-mismatch",
            `${path} differs from its recorded hash or length`,
            {
              itemId: item.id,
              path,
            },
          );
        }
        referenced.add(path);
      }
    }
  }
  const nativeDocuments = new Map<string, Record_>();
  let guideDocument: Record_ | undefined;
  const contentDocuments = new Map<string, Record_>();
  for (const path of [
    NATIVE_FIXTURE_RELEASE_PATH,
    NATIVE_BUNDLES_RELEASE_PATH,
    GUIDE_RELEASE_PATH,
    "release/release-extensions.json",
    "release/release-ecc.json",
    "release/release-superpowers.json",
    "release/release-anthropic.json",
  ]) {
    const bytes = files.get(path);
    if (bytes === undefined) continue;
    const nativeRead = readRelease(bytes, { expectedSha256: sha256Hex(bytes) });
    if (!nativeRead.valid) {
      return refuse("base-invalid", `the base ${path} is not a valid release`, {
        diagnostics: nativeRead.diagnostics.map((d) => d.reason),
      });
    }
    const nativeDocument = JSON.parse(bytes.toString("utf8")) as Record_;
    checkedDocuments.push(nativeRead.release);
    if (path === GUIDE_RELEASE_PATH) guideDocument = nativeDocument;
    else if (
      path === "release/release-extensions.json" ||
      path === "release/release-ecc.json" ||
      path === "release/release-superpowers.json" ||
      path === "release/release-anthropic.json"
    )
      contentDocuments.set(path, nativeDocument);
    else nativeDocuments.set(path, nativeDocument);
    referenced.add(path);
    for (const item of (nativeDocument.items as Json[]).map(asRecord)) {
      for (const member of memberList(item)) {
        const memberPath = packagePathOf(member);
        const memberBytes = files.get(memberPath);
        if (memberBytes === undefined) {
          return refuse("base-member-missing", `${memberPath} is declared but absent`, {
            itemId: item.id,
            path: memberPath,
          });
        }
        if (memberBytes.length !== member.byteLength || sha256Hex(memberBytes) !== member.sha256) {
          return refuse(
            "base-member-mismatch",
            `${memberPath} differs from its recorded hash or length`,
            { itemId: item.id, path: memberPath },
          );
        }
        referenced.add(memberPath);
      }
    }
  }
  const preparedDocuments = new Map<string, { document: Record_; inventory: string }>();
  for (const entry of preparedReleaseContent) {
    const bytes = files.get(entry.content);
    if (bytes === undefined) continue;
    const prepared = readReleaseContent(bytes, { expectedSha256: sha256Hex(bytes) });
    if (!prepared.valid || prepared.release.schema !== entry.schema) {
      return refuse("base-invalid", `the base ${entry.content} is not valid prepared content`, {
        diagnostics: prepared.valid
          ? [prepared.release.schema]
          : prepared.diagnostics.map((d) => d.reason),
      });
    }
    const document = JSON.parse(bytes.toString("utf8")) as Record_;
    for (const item of (document.items as Json[]).map(asRecord)) {
      for (const member of memberList(item)) {
        const memberPath = packagePathOf(member);
        const memberBytes = files.get(memberPath);
        if (
          memberBytes === undefined ||
          memberBytes.length !== member.byteLength ||
          sha256Hex(memberBytes) !== member.sha256
        )
          return refuse("base-member-mismatch", `${memberPath} is absent or changed`, {
            itemId: item.id,
            path: memberPath,
          });
        referenced.add(memberPath);
      }
    }
    // Its frozen inventory is re-derived by the candidate; any stale copy is replaced.
    referenced.add(entry.content);
    referenced.add(entry.inventory);
    preparedDocuments.set(entry.content, { document, inventory: entry.inventory });
  }
  for (const checked of checkedDocuments) {
    for (const member of baselineMembers(checked)) {
      const bytes = files.get(member.path);
      if (!bytes || bytes.length !== member.byteLength || sha256Hex(bytes) !== member.sha256)
        return refuse("base-member-mismatch", "The base baseline member is absent or changed.", {
          path: member.path,
        });
      referenced.add(member.path);
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
    ...(hookDocument === undefined ? {} : { hookDocument }),
    nativeDocuments,
    ...(guideDocument === undefined ? {} : { guideDocument }),
    contentDocuments,
    preparedDocuments,
  };
}
