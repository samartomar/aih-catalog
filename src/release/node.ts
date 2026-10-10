/**
 * Node host adapter: `@aihq/catalog/node`.
 *
 * Reads an explicitly selected installed package root, or acquires an exact
 * registry version / reviewed archive, and returns a checked release plus a
 * Core-bindable generic material source. Never installs packages, runs
 * lifecycle scripts, imports package code or resolves implicit dependencies.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ARCHIVE_LIMITS, readPackageArchive } from "./archive.js";
import type { CatalogDiagnostic, CatalogRelease } from "./contracts.js";
import { coreArchiveUrl, ID, isRecord, safeMemberPath } from "./document.js";
import { AcquisitionFailure } from "./node-errors.js";
import { DERIVED_MANIFEST_PATH, deriveProjectContextRelease } from "./project-context.js";
import { isCheckedRelease, readRelease } from "./reader.js";
import { checkRecipeAgreement } from "./recipe-agreement.js";

const PACKAGE_JSON_MAX_BYTES = 1024 * 1024;
const RELEASE_MAX_BYTES = 16 * 1024 * 1024;
const MEMBER_MAX_BYTES = 16 * 1024 * 1024;

/**
 * The release documents a package can export. A caller names one explicitly; the
 * default is always the 1.0 release and is never replaced by 1.1.
 */
export type ReleaseExport =
  | "./release.json"
  | "./release-1.1.json"
  | "./release-native-fixture.json"
  | "./release-native-bundles.json";
const RELEASE_EXPORTS: readonly string[] = [
  "./release.json",
  "./release-1.1.json",
  "./release-native-fixture.json",
  "./release-native-bundles.json",
];
const releaseExport = (value: unknown): ReleaseExport =>
  value === undefined
    ? "./release.json"
    : RELEASE_EXPORTS.includes(value as string)
      ? (value as ReleaseExport)
      : failWith("invalid-request");

export interface InstalledReleaseRequest {
  /** Package export of the release to read; defaults to `./release.json`. */
  readonly release?: ReleaseExport;
  /** Absolute path of the installed package root the caller selected. */
  readonly root: string;
  /** Name of the Core `controls.materialRoots` entry; defaults to `catalog`. */
  readonly sourceInput?: string;
  readonly signal?: AbortSignal;
}

export interface InstalledReleaseResult {
  readonly valid: boolean;
  readonly release?: CatalogRelease;
  readonly source?: { readonly kind: "local"; readonly input: string };
  /** Pass to Core as `controls.materialRoots`; never place it in a portable policy. */
  readonly materialRoots?: Readonly<Record<string, string>>;
  readonly provenance?: {
    readonly kind: "installed";
    readonly package: { readonly name: string; readonly version: string };
    readonly manifestPath: string;
    readonly manifestSha256: string;
  };
  readonly diagnostics: readonly CatalogDiagnostic[];
}

const failWith = (reason: string, path?: string): never => {
  throw new AcquisitionFailure(reason, path);
};

export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** A frozen blocking INPUT_INVALID diagnostic with optional path and itemId. */
const frozenDiagnostic = (fields: {
  reason: string;
  message: string;
  path?: string;
  itemId?: string;
}): CatalogDiagnostic =>
  Object.freeze({
    code: "INPUT_INVALID",
    reason: fields.reason,
    message: fields.message,
    blocking: true,
    ...(fields.path === undefined ? {} : { path: fields.path }),
    ...(fields.itemId === undefined ? {} : { itemId: fields.itemId }),
  });

export function diagnostic(reason: string, path?: string, itemId?: string): CatalogDiagnostic {
  return frozenDiagnostic({
    reason,
    message: MESSAGES[reason] ?? "The package could not be read under the release contract.",
    ...(path === undefined ? {} : { path }),
    ...(itemId === undefined ? {} : { itemId }),
  });
}
const MESSAGES: Record<string, string> = {
  cancelled: "The read was cancelled.",
  "invalid-root": "Expected an absolute installed package root.",
  "root-unavailable": "The selected package root is not a readable directory.",
  "invalid-source-input": "The material source input name is not an identifier.",
  "invalid-package-json": "The package manifest is not bounded JSON with a name and version.",
  "invalid-export": "The package does not export ./release.json at a safe package path.",
  "package-mismatch": "The release describes a different package or version.",
  "member-missing": "A declared member is absent.",
  "member-length-mismatch": "A declared member has a different byte length.",
  "member-sha256-mismatch": "A declared member has different bytes.",
  "unsafe-member": "A declared member is not a regular file inside the package root.",
  "invalid-request":
    "Expected an exact HTTPS registry, package name and version, or a pinned HTTPS archive.",
  timeout: "The acquisition exceeded its time limit.",
  "download-failed": "The download failed or was redirected; redirects are not followed.",
  "registry-metadata-mismatch": "The registry described a different package or version.",
  "invalid-tarball-url":
    "The registry tarball location is not an HTTPS archive URL Core can acquire.",
  "integrity-mismatch": "The archive does not match the supplied subresource integrity.",
  "archive-identity-mismatch": "The archive does not match its pinned SHA-256.",
  "archive-length-mismatch": "The archive length differs from its declaration or pin.",
  "archive-byte-limit": "The archive exceeds the shared acquisition byte limits.",
  "archive-member-limit": "The archive has more regular members than Core can capture.",
  "archive-unreadable": "The archive is not a readable gzip tar.",
  "archive-layout": "Catalog archives use the fixed package/ member layout.",
  "unsafe-archive-entry": "The archive has a link, device, unsafe path or unsupported header.",
  "archive-duplicate-entry":
    "The archive names one member more than once or by a case-folded duplicate.",
  "archive-executable-member": "The archive has an executable member no release item declares.",
  "release-unchecked":
    "Expected a release view returned by readRelease, readInstalledRelease or resolveRelease.",
  "source-input-conflict":
    "The derived material source input already names a source material root.",
  "invalid-material-roots":
    "Source material roots are required: identifiers mapped to absolute paths (an empty map when the source has no local roots).",
  "invalid-output-directory": "Expected an absolute output directory.",
  "output-parent-unavailable": "The output directory's parent is not an existing directory.",
  "unsafe-output-directory": "The output path is not a plain directory (a file, link or junction).",
  "output-not-empty": "The output directory exists and is not empty.",
  "output-overlaps-source": "The output directory overlaps a source material root.",
  "output-write-failed": "The derived release could not be written to the output directory.",
  "output-cleanup-failed":
    "Files this call created in the output directory could not be removed after a failure.",
};

/** True when `child` lies strictly inside `parent`. */
const within = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
/** True when `child` is `parent` or lies inside it. */
const contains = (parent: string, child: string): boolean =>
  relative(parent, child) === "" || within(parent, child);

/**
 * The installed package root each release view from `readInstalledRelease` was read
 * from, so project-context output never lands inside it whatever roots a caller passes.
 */
const installedRoots = new WeakMap<CatalogRelease, string>();

/**
 * Reads one member under a canonical root: every directory is a real directory
 * (no link), the file is regular, unchanged while read and exactly `expected` bytes.
 */
function readMember(root: string, path: string, limit: number, expected?: number): Buffer {
  if (!safeMemberPath(path)) failWith("unsafe-member", path);
  const segments = path.split("/");
  let current = root;
  try {
    for (const segment of segments.slice(0, -1)) {
      current = join(current, segment);
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) failWith("unsafe-member", path);
    }
  } catch (error) {
    if (error instanceof AcquisitionFailure) throw error;
    failWith("member-missing", path);
  }
  const file = join(root, ...segments);
  if (!within(root, file)) failWith("unsafe-member", path);
  let named: ReturnType<typeof lstatSync>;
  try {
    named = lstatSync(file);
  } catch {
    return failWith("member-missing", path);
  }
  if (named.isSymbolicLink() || !named.isFile()) failWith("unsafe-member", path);
  if (named.size > limit) failWith("member-length-mismatch", path);
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(fd);
    if (!before.isFile() || before.ino !== named.ino || before.dev !== named.dev)
      failWith("unsafe-member", path);
    const output = Buffer.alloc(Math.min(before.size, limit) + 1);
    let offset = 0;
    while (offset < output.length) {
      const count = readSync(fd, output, offset, output.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(fd);
    if (offset > limit || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      failWith("member-length-mismatch", path);
    }
    const bytes = output.subarray(0, offset);
    if (expected !== undefined && bytes.length !== expected)
      failWith("member-length-mismatch", path);
    return bytes;
  } catch (error) {
    if (error instanceof AcquisitionFailure) throw error;
    return failWith("member-missing", path);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The package manifest's identity and the chosen release export path, read as data. */
export function packageIdentity(
  bytes: Uint8Array,
  releaseExportName: ReleaseExport = "./release.json",
): {
  name: string;
  version: string;
  releasePath: string;
} {
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return failWith("invalid-package-json", "package.json");
  }
  if (
    !isRecord(manifest) ||
    typeof manifest.name !== "string" ||
    typeof manifest.version !== "string"
  ) {
    return failWith("invalid-package-json", "package.json");
  }
  const exported = isRecord(manifest.exports) ? manifest.exports[releaseExportName] : undefined;
  const releasePath =
    typeof exported === "string" && exported.startsWith("./") ? exported.slice(2) : undefined;
  if (releasePath === undefined || !safeMemberPath(releasePath))
    return failWith("invalid-export", "package.json");
  return { name: manifest.name, version: manifest.version, releasePath };
}

/**
 * Checks a release against its package manifest and every declared recipe and
 * material member supplied by `read` (package-relative path → bytes).
 */
export function verifyPackageRelease(
  read: (path: string, limit: number, expected?: number) => Uint8Array,
  signal?: AbortSignal,
  releaseExportName: ReleaseExport = "./release.json",
): {
  release: CatalogRelease;
  manifestPath: string;
  manifestSha256: string;
  diagnostics: CatalogDiagnostic[];
} {
  const identity = packageIdentity(read("package.json", PACKAGE_JSON_MAX_BYTES), releaseExportName);
  const manifestBytes = read(identity.releasePath, RELEASE_MAX_BYTES);
  const manifestSha256 = sha256(manifestBytes);
  // Integrity here is the installed/archived bytes the host selected; provenance records which.
  const result = readRelease(manifestBytes, { expectedSha256: manifestSha256 });
  if (!result.valid) {
    throw Object.assign(new AcquisitionFailure("release-invalid"), {
      diagnostics: result.diagnostics,
    });
  }
  const release = result.release;
  if (release.package.name !== identity.name || release.package.version !== identity.version) {
    failWith("package-mismatch", identity.releasePath);
  }
  const diagnostics: CatalogDiagnostic[] = [];
  const verified = new Map<string, string>();
  for (const item of release.items) {
    for (const member of [item.recipe, ...item.materials]) {
      if (signal?.aborted) failWith("cancelled");
      const prior = verified.get(member.path);
      // Byte reuse cannot establish agreement with another item's advertised inputs.
      if (prior === `${member.sha256}:${member.byteLength}` && member !== item.recipe) continue;
      try {
        const bytes = read(member.path, MEMBER_MAX_BYTES, member.byteLength);
        if (sha256(bytes) !== member.sha256) failWith("member-sha256-mismatch", member.path);
        verified.set(member.path, `${member.sha256}:${member.byteLength}`);
        if (member === item.recipe) diagnostics.push(...checkRecipeAgreement(item, bytes));
      } catch (error) {
        if (!(error instanceof AcquisitionFailure) || error.reason === "cancelled") throw error;
        diagnostics.push(diagnostic(error.reason, error.path, item.id));
      }
    }
  }
  return { release, manifestPath: identity.releasePath, manifestSha256, diagnostics };
}

export function failureResult(error: unknown): {
  valid: false;
  diagnostics: readonly CatalogDiagnostic[];
} {
  if (!(error instanceof AcquisitionFailure)) throw error;
  const carried = (error as { diagnostics?: readonly CatalogDiagnostic[] }).diagnostics;
  return Object.freeze({
    valid: false,
    diagnostics: Object.freeze(carried ? [...carried] : [diagnostic(error.reason, error.path)]),
  });
}

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const EXACT_VERSION =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SRI = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const METADATA_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface RegistryReleaseRequest {
  /** Package export of the release to read; defaults to `./release.json`. */
  readonly release?: ReleaseExport;
  /** HTTPS registry base, for example https://registry.npmjs.org */
  readonly registry: string;
  readonly package: string;
  /** One exact version; ranges and dist-tags are refused. */
  readonly version: string;
  /** Optional caller-pinned subresource integrity, verified with the registry's own. */
  readonly integrity?: string;
}

export interface ArchiveReleaseRequest {
  /** Package export of the release to read; defaults to `./release.json`. */
  readonly release?: ReleaseExport;
  /** An explicitly reviewed HTTPS tar-gzip archive pinned by SHA-256 and length. */
  readonly archive: {
    readonly url: string;
    readonly sha256: string;
    readonly byteLength: number;
    readonly integrity?: string;
  };
}

export interface AcquisitionControls {
  readonly signal?: AbortSignal;
  /** Network boundary; defaults to the global fetch. Redirects are never followed. */
  readonly fetch?: typeof fetch;
  /** Total acquisition deadline, 1–60,000 ms (default 60,000). */
  readonly timeoutMs?: number;
}

export interface ResolvedReleaseResult {
  readonly valid: boolean;
  readonly release?: CatalogRelease;
  /** Core's generic archive source; configureItem maps members under package/. */
  readonly source?: {
    readonly kind: "archive";
    readonly url: string;
    readonly sha256: string;
    readonly byteLength: number;
  };
  readonly provenance?: {
    readonly kind: "registry" | "archive";
    readonly registry?: string;
    readonly package: string;
    readonly version: string;
    readonly integrity?: string;
    readonly tarball: string;
    readonly archiveSha256: string;
    readonly byteLength: number;
    readonly manifestPath: string;
    readonly manifestSha256: string;
  };
  readonly diagnostics: readonly CatalogDiagnostic[];
}

function registryBase(value: unknown): string | undefined {
  if (!coreArchiveUrl(value)) return undefined;
  const url = new URL(value);
  return url.search === "" ? value.replace(/\/+$/, "") : undefined;
}

/** Verifies the strongest supported SRI algorithm listed; any matching digest suffices. */
function integrityMatches(integrity: string, bytes: Uint8Array): boolean {
  const tokens = integrity
    .trim()
    .split(/\s+/)
    .filter((token) => SRI.test(token));
  for (const algorithm of ["sha512", "sha384", "sha256"]) {
    const listed = tokens.filter((token) => token.startsWith(`${algorithm}-`));
    if (listed.length === 0) continue;
    const digest = `${algorithm}-${createHash(algorithm).update(bytes).digest("base64")}`;
    return listed.includes(digest);
  }
  return false;
}

async function download(
  fetcher: typeof fetch,
  url: string,
  signal: AbortSignal,
  limit: number,
  expectedLength: number | undefined,
  overLimit: string,
): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetcher(url, { signal, redirect: "error", headers: { accept: "*/*" } });
  } catch {
    return failWith(abortReason(signal) ?? "download-failed");
  }
  if (!response.ok || response.body === null) {
    await response.body?.cancel().catch(() => {});
    return failWith("download-failed");
  }
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = /^[0-9]+$/.test(declared) ? Number(declared) : Number.NaN;
    if (
      !Number.isSafeInteger(length) ||
      (expectedLength !== undefined && length !== expectedLength)
    ) {
      await response.body.cancel().catch(() => {});
      return failWith("archive-length-mismatch");
    }
    if (length > limit) {
      await response.body.cancel().catch(() => {});
      return failWith(overLimit);
    }
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch {
        return failWith(abortReason(signal) ?? "download-failed");
      }
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > limit)
        failWith(expectedLength !== undefined ? "archive-length-mismatch" : overLimit);
      parts.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (expectedLength !== undefined && total !== expectedLength) failWith("archive-length-mismatch");
  return Buffer.concat(parts, total);
}

function abortReason(signal: AbortSignal): string | undefined {
  if (!signal.aborted) return undefined;
  return signal.reason instanceof AcquisitionFailure ? signal.reason.reason : "cancelled";
}

/**
 * Acquires an exact registry version or explicitly reviewed archive within the
 * shared bounds, verifies SRI where supplied, archive identity, the fixed
 * `package/` layout and every declared recipe/material member, and returns a
 * pinned Core archive source. Never installs, imports or runs package code.
 */
export async function resolveRelease(
  request: RegistryReleaseRequest | ArchiveReleaseRequest,
  controls: AcquisitionControls = {},
): Promise<ResolvedReleaseResult> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(new AcquisitionFailure("cancelled"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutMs = controls.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetcher = controls.fetch ?? globalThis.fetch;
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > DEFAULT_TIMEOUT_MS ||
      typeof fetcher !== "function"
    ) {
      failWith("invalid-request");
    }
    const exportName = releaseExport((request as { release?: unknown } | undefined)?.release);
    if (controls.signal?.aborted) failWith("cancelled");
    controls.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => controller.abort(new AcquisitionFailure("timeout")), timeoutMs);
    const signal = controller.signal;

    let tarball: string;
    let pinned: { sha256: string; byteLength: number } | undefined;
    const integrities: string[] = [];
    let identity: { package: string; version: string } | undefined;
    let registry: string | undefined;
    if (isRecord(request) && isRecord(request.archive)) {
      const archive = request.archive;
      if (
        !coreArchiveUrl(archive.url) ||
        typeof archive.sha256 !== "string" ||
        !SHA256_HEX.test(archive.sha256) ||
        !Number.isSafeInteger(archive.byteLength) ||
        (archive.byteLength as number) < 1 ||
        (archive.byteLength as number) > ARCHIVE_LIMITS.compressedBytes ||
        (archive.integrity !== undefined &&
          (typeof archive.integrity !== "string" || !SRI.test(archive.integrity)))
      ) {
        failWith("invalid-request");
      }
      tarball = archive.url as string;
      pinned = { sha256: archive.sha256 as string, byteLength: archive.byteLength as number };
      if (typeof archive.integrity === "string") integrities.push(archive.integrity);
    } else {
      const { package: name, version, integrity } = (request ?? {}) as RegistryReleaseRequest;
      registry = registryBase((request as RegistryReleaseRequest)?.registry);
      if (
        registry === undefined ||
        typeof name !== "string" ||
        name.length > 214 ||
        !PACKAGE_NAME.test(name) ||
        typeof version !== "string" ||
        version.length > 256 ||
        !EXACT_VERSION.test(version) ||
        (integrity !== undefined && (typeof integrity !== "string" || !SRI.test(integrity)))
      ) {
        return failWith("invalid-request");
      }
      if (integrity !== undefined) integrities.push(integrity);
      identity = { package: name, version };
      const metadataUrl = `${registry}/${name.replace("/", "%2f")}/${encodeURIComponent(version)}`;
      const metadataBytes = await download(
        fetcher,
        metadataUrl,
        signal,
        METADATA_MAX_BYTES,
        undefined,
        "download-failed",
      );
      let metadata: unknown;
      try {
        metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(metadataBytes));
      } catch {
        failWith("registry-metadata-mismatch");
      }
      if (
        !isRecord(metadata) ||
        metadata.name !== name ||
        metadata.version !== version ||
        !isRecord(metadata.dist)
      ) {
        failWith("registry-metadata-mismatch");
      }
      const dist = (metadata as { dist: Record<string, unknown> }).dist;
      if (!coreArchiveUrl(dist.tarball)) failWith("invalid-tarball-url");
      tarball = dist.tarball as string;
      if (dist.integrity !== undefined) {
        if (typeof dist.integrity !== "string") failWith("registry-metadata-mismatch");
        integrities.push(dist.integrity as string);
      }
    }

    const archiveBytes = await download(
      fetcher,
      tarball,
      signal,
      pinned?.byteLength ?? ARCHIVE_LIMITS.compressedBytes,
      pinned?.byteLength,
      "archive-byte-limit",
    );
    const archiveSha256 = sha256(archiveBytes);
    if (pinned !== undefined && archiveSha256 !== pinned.sha256)
      failWith("archive-identity-mismatch");
    for (const integrity of integrities) {
      if (!integrityMatches(integrity, archiveBytes)) failWith("integrity-mismatch");
    }
    const archive = await readPackageArchive(archiveBytes, signal);
    const checked = verifyPackageRelease(
      (path, limit, expected) => {
        const bytes = archive.files.get(path);
        if (bytes === undefined) return failWith("member-missing", path);
        if (bytes.length > limit || (expected !== undefined && bytes.length !== expected)) {
          failWith("member-length-mismatch", path);
        }
        return bytes;
      },
      signal,
      exportName,
    );
    if (signal.aborted) failWith(abortReason(signal) ?? "cancelled");
    const declared = new Set(
      checked.release.items.flatMap((item) => [
        item.recipe.path,
        ...item.materials.map((member) => member.path),
      ]),
    );
    for (const path of archive.executables) {
      if (!declared.has(path))
        checked.diagnostics.push(diagnostic("archive-executable-member", path));
    }
    const pkg = checked.release.package;
    if (
      identity !== undefined &&
      (pkg.name !== identity.package || pkg.version !== identity.version)
    ) {
      checked.diagnostics.push(diagnostic("package-mismatch", checked.manifestPath));
    }
    if (checked.diagnostics.length > 0) {
      return Object.freeze({ valid: false, diagnostics: Object.freeze(checked.diagnostics) });
    }
    return Object.freeze({
      valid: true,
      release: checked.release,
      source: Object.freeze({
        kind: "archive",
        url: tarball,
        sha256: archiveSha256,
        byteLength: archiveBytes.length,
      }),
      provenance: Object.freeze({
        kind: registry === undefined ? "archive" : "registry",
        ...(registry === undefined ? {} : { registry }),
        package: pkg.name,
        version: pkg.version,
        ...(integrities.length > 0 ? { integrity: integrities[integrities.length - 1] } : {}),
        tarball,
        archiveSha256,
        byteLength: archiveBytes.length,
        manifestPath: checked.manifestPath,
        manifestSha256: checked.manifestSha256,
      }),
      diagnostics: Object.freeze([]),
    });
  } catch (error) {
    return failureResult(error);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controls.signal?.removeEventListener("abort", onAbort);
  }
}

export async function readInstalledRelease(
  request: InstalledReleaseRequest,
): Promise<InstalledReleaseResult> {
  try {
    const { root, sourceInput = "catalog", signal } = (request ?? {}) as InstalledReleaseRequest;
    if (signal?.aborted) failWith("cancelled");
    if (typeof sourceInput !== "string" || sourceInput.length > 128 || !ID.test(sourceInput)) {
      failWith("invalid-source-input");
    }
    const exportName = releaseExport((request as { release?: unknown }).release);
    if (typeof root !== "string" || !isAbsolute(root)) failWith("invalid-root");
    let canonical: string;
    try {
      if (!statSync(root).isDirectory()) failWith("root-unavailable");
      canonical = realpathSync.native(root);
    } catch (error) {
      if (error instanceof AcquisitionFailure) throw error;
      return failWith("root-unavailable");
    }
    const checked = verifyPackageRelease(
      (path, limit, expected) => readMember(canonical, path, limit, expected),
      signal,
      exportName,
    );
    if (signal?.aborted) failWith("cancelled");
    if (checked.diagnostics.length > 0) {
      return Object.freeze({ valid: false, diagnostics: Object.freeze(checked.diagnostics) });
    }
    installedRoots.set(checked.release, canonical);
    return Object.freeze({
      valid: true,
      release: checked.release,
      source: Object.freeze({ kind: "local", input: sourceInput }),
      materialRoots: Object.freeze({ [sourceInput]: canonical }),
      provenance: Object.freeze({
        kind: "installed",
        package: checked.release.package,
        manifestPath: checked.manifestPath,
        manifestSha256: checked.manifestSha256,
      }),
      diagnostics: Object.freeze([]),
    });
  } catch (error) {
    return failureResult(error);
  }
}

const DERIVED_SOURCE_INPUT = "catalog-project-context";

export interface ProjectContextRequest {
  /** The checked source release, for example from `readInstalledRelease`. */
  readonly release: CatalogRelease;
  /** Project-relative directory that receives the shared context, such as `.ai/context`. */
  readonly instructionDirectory: string;
  /**
   * Absolute, caller-owned staging directory: absent (its parent exists) or an existing
   * empty plain directory. Keep it until Core prepare and apply complete.
   */
  readonly outputDirectory: string;
  /**
   * The source release's Core material roots, such as `installed.materialRoots`.
   * Required: the output must not overlap any of them. Pass `{}` explicitly only for
   * a source without local roots, such as an archive resolved by `resolveRelease`.
   */
  readonly sourceMaterialRoots: Readonly<Record<string, string>>;
  /** Name of the Core `controls.materialRoots` entry; defaults to `catalog-project-context`. */
  readonly sourceInput?: string;
  /** Checked once before any work; preparation is synchronous and cannot stop midway. */
  readonly signal?: AbortSignal;
}

export interface PreparedProjectContextResult {
  readonly valid: boolean;
  /** The checked derived release, read back from the bytes written under the output directory. */
  readonly release?: CatalogRelease;
  readonly source?: { readonly kind: "local"; readonly input: string };
  /** Merge with the source's material roots into Core `controls.materialRoots`. */
  readonly materialRoots?: Readonly<Record<string, string>>;
  /** Describes the derivation. It is not an origin or publisher claim for the derived bytes. */
  readonly provenance?: {
    readonly kind: "derived";
    readonly from: {
      readonly package: { readonly name: string; readonly version: string };
      readonly manifestSha256: string;
    };
    readonly renderer: string;
    readonly instructionDirectory: string;
    readonly manifestPath: string;
    readonly manifestSha256: string;
  };
  readonly diagnostics: readonly CatalogDiagnostic[];
}

/** A frozen copy of the source material roots: identifiers mapped to absolute paths. */
function sourceRoots(value: unknown): Readonly<Record<string, string>> {
  const at = "/sourceMaterialRoots";
  if (!isRecord(value)) {
    return failWith("invalid-material-roots", at);
  }
  const copy: Record<string, string> = {};
  for (const [name, path] of Object.entries(value)) {
    if (name.length > 128 || !ID.test(name) || typeof path !== "string" || !isAbsolute(path)) {
      return failWith("invalid-material-roots", at);
    }
    copy[name] = path;
  }
  return Object.freeze(copy);
}

/** True when a realpath failure means the path is absent, so resolution may walk up. */
const missingPath = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
};

/**
 * `path` through its nearest existing ancestor's real path (links and short names
 * resolved). Walks up only while a component is absent; any other resolution error
 * (a permission failure, a link loop, …) fails closed with `reason` at `at` instead
 * of being treated as absent.
 */
function canonicalPath(path: string, reason: string, at: string): string {
  const rest: string[] = [];
  let current = resolve(path);
  for (;;) {
    try {
      return join(realpathSync.native(current), ...rest.reverse());
    } catch (error) {
      if (!missingPath(error)) failWith(reason, at);
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      rest.push(relative(parent, current));
      current = parent;
    }
  }
}

/**
 * Checks the requested output directory and returns its canonical path: absolute,
 * absent with an existing parent or an existing empty plain directory, and disjoint
 * from every source material root.
 */
function outputRoot(
  outputDirectory: unknown,
  roots: readonly string[],
): { path: string; existed: boolean } {
  const at = "/outputDirectory";
  if (typeof outputDirectory !== "string" || !isAbsolute(outputDirectory)) {
    return failWith("invalid-output-directory", at);
  }
  const target = resolve(outputDirectory);
  let named: ReturnType<typeof lstatSync> | undefined;
  try {
    named = lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return failWith("unsafe-output-directory", at);
    }
  }
  let path: string;
  if (named !== undefined) {
    if (named.isSymbolicLink() || !named.isDirectory()) {
      return failWith("unsafe-output-directory", at);
    }
    let entries: number;
    try {
      entries = readdirSync(target).length;
      path = realpathSync.native(target);
    } catch {
      return failWith("unsafe-output-directory", at);
    }
    if (entries > 0) return failWith("output-not-empty", at);
  } else {
    let parent: string;
    try {
      parent = realpathSync.native(dirname(target));
      if (!statSync(parent).isDirectory()) return failWith("output-parent-unavailable", at);
    } catch (error) {
      if (error instanceof AcquisitionFailure) throw error;
      return failWith("output-parent-unavailable", at);
    }
    path = join(parent, relative(dirname(target), target));
  }
  for (const root of roots) {
    const source = canonicalPath(root, "invalid-material-roots", "/sourceMaterialRoots");
    if (contains(source, path) || contains(path, source)) {
      return failWith("output-overlaps-source", at);
    }
  }
  return { path, existed: named !== undefined };
}

/**
 * Writes every file under the output, reporting each directory this call creates.
 * Every derived file lives under one top-level directory (`release/`) and `files`
 * is in path order, so in an existing output the first path reported is that
 * directory and removing it removes everything this call made inside the output.
 */
function writeDerived(
  output: { path: string; existed: boolean },
  files: ReadonlyMap<string, Uint8Array>,
  onCreated: (path: string) => void,
): void {
  if (!output.existed) {
    mkdirSync(output.path);
    onCreated(output.path);
  }
  const made = new Set<string>();
  for (const [path, bytes] of files) {
    const segments = path.split("/");
    let current = output.path;
    for (const segment of segments.slice(0, -1)) {
      current = join(current, segment);
      if (made.has(current)) continue;
      mkdirSync(current);
      made.add(current);
      // In an existing empty output, only the subtree this call creates is removed.
      onCreated(current);
    }
    writeFileSync(join(current, segments[segments.length - 1] as string), bytes, { flag: "wx" });
  }
}

/** Removes what this call created; a failure becomes a diagnostic, never an exception. */
function removeCreated(path: string): CatalogDiagnostic | undefined {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    return undefined;
  } catch {
    return diagnostic("output-cleanup-failed", "/outputDirectory");
  }
}

/**
 * Prepares the authored project context for a consuming project's chosen
 * instruction directory, as a derived release in caller-owned staging output.
 *
 * `deriveProjectContextRelease` renders the derived release (only the context family
 * for that directory and the authored source record, with `metadata.derived`); this
 * adapter checks the output directory, writes the bytes, reads them back and returns
 * the checked release with its local material source. Configure its items with that
 * source and merge `materialRoots` into Core's controls; Core captures recipe
 * identities from those exact bytes.
 *
 * Refuses before writing: an invalid directory, a source whose authored context this
 * renderer does not reproduce, missing source material roots, and an output
 * that is unsafe, non-empty or overlaps a source root. Writes only under
 * `outputDirectory` and on failure removes only what it created. Deterministic for
 * the same source release, renderer and directory. Refusals, write and cleanup
 * failures are returned as diagnostics.
 */
export async function prepareProjectContext(
  request: ProjectContextRequest,
): Promise<PreparedProjectContextResult> {
  // What this call created and removes on failure: the output itself, or release/ in it.
  let created: string | undefined;
  try {
    const {
      release,
      instructionDirectory,
      outputDirectory,
      sourceMaterialRoots,
      sourceInput = DERIVED_SOURCE_INPUT,
      signal,
    } = (request ?? {}) as ProjectContextRequest;
    // The work below is synchronous and bounded (one fixed family), so a signal can
    // only take effect before it starts.
    if (signal?.aborted) return failWith("cancelled");
    if (!isCheckedRelease(release)) return failWith("release-unchecked", "/release");
    if (typeof sourceInput !== "string" || sourceInput.length > 128 || !ID.test(sourceInput)) {
      return failWith("invalid-source-input", "/sourceInput");
    }
    const roots = sourceRoots(sourceMaterialRoots);
    if (Object.hasOwn(roots, sourceInput)) {
      return failWith("source-input-conflict", "/sourceInput");
    }
    const derived = deriveProjectContextRelease(release, instructionDirectory);
    if (!derived.valid) {
      throw Object.assign(new AcquisitionFailure(derived.problems[0]?.reason ?? "invalid"), {
        diagnostics: derived.problems.map((problem) =>
          frozenDiagnostic({
            reason: problem.reason,
            message: problem.message,
            path: problem.path,
          }),
        ),
      });
    }
    const { files, manifest, derivation } = derived.derived;

    const installedRoot = installedRoots.get(release);
    // The installed root is checked beside every caller root, never keyed among them.
    const protectedRoots = Object.values(roots);
    if (installedRoot !== undefined) protectedRoots.push(installedRoot);
    const output = outputRoot(outputDirectory, protectedRoots);
    try {
      writeDerived(output, files, (path) => {
        // The first path reported roots everything this call makes: the output
        // itself, or release/ inside an existing output (see writeDerived).
        created ??= path;
      });
    } catch (error) {
      if (created === undefined && (error as NodeJS.ErrnoException).code === "EEXIST") {
        return failWith("output-not-empty", "/outputDirectory");
      }
      return failWith("output-write-failed", "/outputDirectory");
    }

    // The result describes the bytes actually written, read back and verified.
    let canonical: string;
    try {
      canonical = realpathSync.native(output.path);
    } catch {
      return failWith("output-write-failed", "/outputDirectory");
    }
    const descriptor = new TextEncoder().encode(
      JSON.stringify({
        ...derivation.from.package,
        exports: { "./release.json": `./${DERIVED_MANIFEST_PATH}` },
      }),
    );
    const checked = verifyPackageRelease((path, limit, expected) =>
      path === "package.json" ? descriptor : readMember(canonical, path, limit, expected),
    );
    if (checked.diagnostics.length > 0) {
      throw Object.assign(new AcquisitionFailure("output-write-failed"), {
        diagnostics: checked.diagnostics,
      });
    }
    if (checked.manifestSha256 !== sha256(manifest)) {
      return failWith("output-write-failed", "/outputDirectory");
    }
    return Object.freeze({
      valid: true,
      release: checked.release,
      source: Object.freeze({ kind: "local", input: sourceInput }),
      materialRoots: Object.freeze({ [sourceInput]: canonical }),
      provenance: Object.freeze({
        kind: "derived",
        from: derivation.from,
        renderer: derivation.renderer,
        instructionDirectory: derivation.instructionDirectory,
        manifestPath: DERIVED_MANIFEST_PATH,
        manifestSha256: checked.manifestSha256,
      }),
      diagnostics: Object.freeze([]),
    });
  } catch (error) {
    const cleanup = created === undefined ? undefined : removeCreated(created);
    const result = failureResult(error);
    if (cleanup === undefined) return result;
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([...result.diagnostics, cleanup]),
    });
  }
}
