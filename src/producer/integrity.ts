import type { CatalogRelease, Json } from "../release/contracts.js";
import { contractSupport } from "../release/contracts.js";
import { type ReleaseExport, verifyPackageRelease } from "../release/node.js";
import { AcquisitionFailure } from "../release/node-errors.js";
import { readRelease } from "../release/reader.js";
import { type AuthoredAllowance, checkAuthoredContent, describeFinding } from "./authored.js";
import type { Record_ } from "./base.js";
import { assertRequiredClosure } from "./candidate.js";
import { ProducerRefusal } from "./errors.js";
import {
  HOOK_RELEASE_PATH,
  NATIVE_BUNDLES_RELEASE_PATH,
  NATIVE_FIXTURE_RELEASE_PATH,
  RELEASE_PATH,
  sha256Hex,
} from "./generate.js";

export interface IntegrityCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
  /** Present on checks that can honestly report they did not run; `ok` is then true. */
  readonly status?: "passed" | "failed" | "not-run";
}

export interface IntegrityResult {
  readonly ok: boolean;
  readonly checks: readonly IntegrityCheck[];
  readonly release?: CatalogRelease;
}

const asRecord = (value: Json | undefined): Record_ => value as Record_;

/** The cheap whole-package questions every candidate must answer, in report order. */
export const INTEGRITY_CHECKS = [
  "release-envelope",
  "package-identity",
  "format-support",
  "member-bytes",
  "recipe-configuration-agreement",
  "inventory-exact",
  "dependency-closure",
  "source-references",
  "provenance-paths",
  "authored-references",
  "authored-placeholders",
] as const;

/** The declared allowances the authored-content checks run with; absent means none. */
export interface IntegrityOptions {
  readonly authored?: readonly AuthoredAllowance[];
}

/**
 * Checks a complete candidate as it would be packed: envelope, identifiers,
 * recipe/configuration agreement, member paths/lengths/hashes, the exact member
 * inventory, required-dependency closure, source provenance and the internal
 * references and generation placeholders of Catalog-authored content. Every
 * check is evaluated so one report names everything that is wrong. It uses the
 * public release reader and the Node package verifier, not a second validator.
 * When the candidate carries the optional 1.1 release, every per-release check
 * covers it too (a failure names the document) and the inventory is the union of
 * both documents' members.
 */
export function checkCandidateFiles(
  files: ReadonlyMap<string, Uint8Array>,
  identity: { readonly name: string; readonly version: string },
  options: IntegrityOptions = {},
): IntegrityResult {
  const checks: IntegrityCheck[] = [];
  const record = (name: string, ok: boolean, detail?: string) =>
    checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });

  if (!files.has(RELEASE_PATH)) {
    record("release-envelope", false, `${RELEASE_PATH} is missing`);
    return { ok: false, checks };
  }
  const documents: { path: string; export: ReleaseExport }[] = [
    { path: RELEASE_PATH, export: "./release.json" },
    ...(files.has(HOOK_RELEASE_PATH)
      ? [{ path: HOOK_RELEASE_PATH, export: "./release-1.1.json" as const }]
      : []),
    ...(files.has(NATIVE_FIXTURE_RELEASE_PATH)
      ? [{ path: NATIVE_FIXTURE_RELEASE_PATH, export: "./release-native-fixture.json" as const }]
      : []),
    ...(files.has(NATIVE_BUNDLES_RELEASE_PATH)
      ? [{ path: NATIVE_BUNDLES_RELEASE_PATH, export: "./release-native-bundles.json" as const }]
      : []),
  ];
  /** Per-release outcomes merged under the stable check names; detail names a 1.1 document. */
  const merged = new Map<string, { ok: boolean; details: string[] }>();
  const note = (path: string, name: string, ok: boolean, detail?: string) => {
    const entry = merged.get(name) ?? { ok: true, details: [] };
    entry.ok &&= ok;
    if (detail) entry.details.push(path === RELEASE_PATH ? detail : `${path}: ${detail}`);
    merged.set(name, entry);
  };
  const emit = (name: string) => {
    const entry = merged.get(name);
    if (entry !== undefined) record(name, entry.ok, entry.details.join("; ") || undefined);
  };
  const releases: { path: string; release: CatalogRelease; items: Record_[] }[] = [];
  const exportsField = Object.fromEntries(documents.map((d) => [d.export, `./${d.path}`]));

  for (const document of documents) {
    const releaseBytes = files.get(document.path) as Uint8Array;
    const read = readRelease(releaseBytes, { expectedSha256: sha256Hex(releaseBytes) });
    if (!read.valid) {
      note(
        document.path,
        "release-envelope",
        false,
        read.diagnostics.map((d) => `${d.reason}${d.path ? ` ${d.path}` : ""}`).join("; "),
      );
      continue;
    }
    note(document.path, "release-envelope", true);
    const release = read.release;
    note(
      document.path,
      "package-identity",
      release.package.name === identity.name && release.package.version === identity.version,
      `${release.package.name}@${release.package.version} vs ${identity.name}@${identity.version}`,
    );
    note(
      document.path,
      "format-support",
      contractSupport.contracts.some((contract) => contract.id === release.schema),
      release.schema,
    );
    const manifest = Buffer.from(JSON.stringify({ ...release.package, exports: exportsField }));
    const verified = (() => {
      try {
        return verifyPackageRelease(
          (path, _limit, expected) => {
            const bytes = path === "package.json" ? manifest : files.get(path);
            if (bytes === undefined) throw new AcquisitionFailure("member-missing", path);
            if (expected !== undefined && bytes.length !== expected) {
              throw new AcquisitionFailure("member-length-mismatch", path);
            }
            return bytes;
          },
          undefined,
          document.export,
        );
      } catch (error) {
        if (error instanceof AcquisitionFailure)
          return { failure: `${error.reason} ${error.path ?? ""}`.trim() };
        throw error;
      }
    })();
    if ("failure" in verified) {
      note(document.path, "member-bytes", false, verified.failure);
      note(
        document.path,
        "recipe-configuration-agreement",
        false,
        "not evaluated: member verification failed",
      );
    } else {
      const describe = (list: typeof verified.diagnostics) =>
        list.map((d) => `${d.reason} ${d.itemId ?? ""} ${d.path ?? ""}`.trim()).join("; ");
      const recipe = verified.diagnostics.filter((d) => d.reason.startsWith("recipe-"));
      const members = verified.diagnostics.filter((d) => !d.reason.startsWith("recipe-"));
      note(document.path, "member-bytes", members.length === 0, describe(members));
      note(document.path, "recipe-configuration-agreement", recipe.length === 0, describe(recipe));
    }
    const parsed = JSON.parse(Buffer.from(releaseBytes).toString("utf8")) as Record_;
    releases.push({
      path: document.path,
      release,
      items: (parsed.items as Json[]).map(asRecord),
    });
  }
  emit("release-envelope");
  if (!(merged.get("release-envelope")?.ok ?? false)) return { ok: false, checks };
  for (const name of [
    "package-identity",
    "format-support",
    "member-bytes",
    "recipe-configuration-agreement",
  ]) {
    emit(name);
  }

  const declared = new Set<string>(documents.map((d) => d.path));
  for (const { items } of releases) {
    for (const item of items) {
      for (const member of [asRecord(item.recipe), ...(item.materials as Json[]).map(asRecord)]) {
        declared.add(member.path as string);
      }
    }
  }
  const stray = [...files.keys()].filter((path) => !declared.has(path)).sort();
  const absent = [...declared].filter((path) => !files.has(path)).sort();
  record(
    "inventory-exact",
    stray.length === 0 && absent.length === 0,
    [
      stray.length ? `undeclared: ${stray.join(", ")}` : "",
      absent.length ? `absent: ${absent.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; "),
  );

  for (const { path, items, release } of releases) {
    try {
      assertRequiredClosure(items);
      note(path, "dependency-closure", true);
    } catch (error) {
      if (!(error instanceof ProducerRefusal)) throw error;
      note(path, "dependency-closure", false, error.message);
    }

    const sources = new Map(release.sources.map((source) => [source.id, source]));
    const referenced = new Set(release.items.flatMap((item) => item.sourceIds));
    const unused = [...sources.keys()].filter((id) => !referenced.has(id));
    note(
      path,
      "source-references",
      unused.length === 0,
      unused.length ? `unreferenced: ${unused.join(", ")}` : undefined,
    );

    const misplaced: string[] = [];
    for (const item of release.items) {
      for (const sourceId of item.sourceIds) {
        const origin = sources.get(sourceId)?.origin;
        if (origin?.kind !== "git") continue;
        const prefix = `release/materials/${origin.repository.replace(/^https:\/\//, "")}/${origin.revision}/`;
        for (const member of item.materials) {
          if (!member.path.startsWith(prefix)) misplaced.push(`${item.id}:${member.id}`);
        }
      }
    }
    note(
      path,
      "provenance-paths",
      misplaced.length === 0,
      misplaced.length ? `outside their pinned revision: ${misplaced.join(", ")}` : undefined,
    );

    const authored = checkAuthoredContent(release, files, options.authored ?? []);
    note(
      path,
      "authored-references",
      authored.references.length === 0,
      authored.references.length
        ? authored.references.map((finding) => `unresolved ${describeFinding(finding)}`).join("; ")
        : undefined,
    );
    note(
      path,
      "authored-placeholders",
      authored.placeholders.length === 0,
      authored.placeholders.length
        ? authored.placeholders
            .map((finding) => `placeholder ${describeFinding(finding)}`)
            .join("; ")
        : undefined,
    );
  }
  for (const name of [
    "dependency-closure",
    "source-references",
    "provenance-paths",
    "authored-references",
    "authored-placeholders",
  ]) {
    emit(name);
  }
  return { ok: checks.every((check) => check.ok), checks, release: releases[0]?.release };
}

/** Throws a refusal naming every failed check; returns the checked release otherwise. */
export function assertCandidateIntegrity(
  files: ReadonlyMap<string, Uint8Array>,
  identity: { readonly name: string; readonly version: string },
  options: IntegrityOptions = {},
): IntegrityResult & { release: CatalogRelease } {
  const result = checkCandidateFiles(files, identity, options);
  if (!result.ok || result.release === undefined) {
    const failed = result.checks.filter((check) => !check.ok);
    throw new ProducerRefusal(
      "integrity-failed",
      failed.map((check) => `${check.name}${check.detail ? ` (${check.detail})` : ""}`).join("; "),
      { checks: result.checks },
    );
  }
  return result as IntegrityResult & { release: CatalogRelease };
}
