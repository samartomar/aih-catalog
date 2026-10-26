/** Exact npm acquisition. No npm configuration, installation or package execution. */
import { createHash } from "node:crypto";
import { copyJson, exactFields } from "./boundary.js";
import type { CatalogDiagnostic, ExactSourceIdentity } from "./contracts.js";
import { isRecord } from "./document.js";
import { AcquisitionFailure } from "./node-errors.js";
import { readNpmArchive } from "./npm-archive.js";
import { frozenDiagnostic } from "./package-release.js";
import { checkExactSourceIdentity } from "./source-description.js";
import { readUpstreamObject } from "./upstream-json.js";

/** Scan's published default/ceiling source capture and npm transport bounds. */
export const NPM_SNAPSHOT_LIMITS = Object.freeze({
  sourceEntries: 100_000,
  sourceBytes: 256 * 1024 * 1024,
  archiveBytes: 256 * 1024 * 1024 + 1024 * 100_000 + 2048,
  metadataBytes: 1024 * 1024,
  timeoutMs: 30_000,
});
export interface NpmSnapshotRequest {
  readonly name: string;
  readonly version: string;
  /** Canonical SHA-512 SRI pin over the compressed archive, supplied independently. */
  readonly integrity: string;
}
export interface NpmSnapshotControls {
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
  /** May only tighten the published ceilings. */
  readonly limits?: Partial<Record<keyof typeof NPM_SNAPSHOT_LIMITS, number>>;
}
export interface NpmSnapshot {
  /** SHA-256 of the verified compressed archive, usable as a local producer revision. */
  readonly revision: string;
  readonly files: Readonly<Record<string, Uint8Array>>;
  readonly modes: Readonly<Record<string, number>>;
}
export type NpmSnapshotResult =
  | {
      readonly valid: true;
      readonly identity: Extract<ExactSourceIdentity, { kind: "npm" }>;
      readonly snapshot: NpmSnapshot;
      readonly diagnostics: readonly CatalogDiagnostic[];
    }
  | { readonly valid: false; readonly diagnostics: readonly CatalogDiagnostic[] };
function npmFail(reason: string): never {
  throw new AcquisitionFailure(reason);
}

function httpsUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("https://") ||
    /\s/.test(value)
  )
    return npmFail("npm-invalid-archive-url");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return npmFail("npm-invalid-archive-url");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash)
    return npmFail("npm-invalid-archive-url");
  return url.href;
}

async function download(
  url: string,
  max: number,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetcher(url, { signal, redirect: "error", credentials: "omit" });
  } catch {
    return npmFail(signal.aborted ? "npm-cancelled" : "npm-download-failed");
  }
  if (!response.ok || response.body === null || response.redirected) {
    await response.body?.cancel().catch(() => {});
    return npmFail("npm-download-failed");
  }
  const length = response.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > max)
  ) {
    await response.body.cancel().catch(() => {});
    return npmFail("npm-byte-limit");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let released = false;
  const cancelReader = () => {
    if (released) return;
    released = true;
    // Cancel settles a pending read even when the injected transport ignores signal.
    // Do not await a custom underlying cancel hook: it may itself never settle.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
    chunks.length = 0;
  };
  signal.addEventListener("abort", cancelReader, { once: true });
  if (signal.aborted) cancelReader();
  try {
    for (;;) {
      if (signal.aborted) npmFail("npm-cancelled");
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > max) npmFail("npm-byte-limit");
      chunks.push(chunk.value);
    }
    if (signal.aborted) npmFail("npm-cancelled");
    if (length !== null && Number(length) !== total) npmFail("npm-length-mismatch");
    return Buffer.concat(chunks, total);
  } finally {
    signal.removeEventListener("abort", cancelReader);
    cancelReader();
  }
}

/** Returns ordinary package files, never a Catalog release or an execution authority. */
export async function acquireNpmSnapshot(
  request: NpmSnapshotRequest,
  controls: NpmSnapshotControls = {},
): Promise<NpmSnapshotResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const data = copyJson(request, { maxBytes: 4096, maxDepth: 2 });
    if (!exactFields(data, ["name", "version", "integrity"])) {
      if (isRecord(data) && !Object.hasOwn(data, "integrity")) npmFail("npm-integrity-required");
      npmFail("npm-invalid-request");
    }
    const identity = {
      kind: "npm" as const,
      package: data.name,
      version: data.version,
      integrity: data.integrity,
    };
    const checked = checkExactSourceIdentity(identity);
    if (!checked.valid) {
      const reason = checked.diagnostics[0]?.reason;
      npmFail(
        reason === "version-not-exact"
          ? "npm-version-not-exact"
          : reason === "invalid-integrity"
            ? "npm-invalid-integrity"
            : "npm-invalid-request",
      );
    }
    if (
      typeof data.integrity !== "string" ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(data.integrity) ||
      Buffer.from(data.integrity.slice(7), "base64").toString("base64") !== data.integrity.slice(7)
    )
      npmFail("npm-invalid-integrity");
    const limits: Record<keyof typeof NPM_SNAPSHOT_LIMITS, number> = { ...NPM_SNAPSHOT_LIMITS };
    if (controls.limits !== undefined) {
      const supplied = copyJson(controls.limits, { maxBytes: 1024, maxDepth: 2 });
      if (!isRecord(supplied)) npmFail("npm-invalid-request");
      for (const [key, value] of Object.entries(supplied)) {
        if (
          !Object.hasOwn(limits, key) ||
          typeof value !== "number" ||
          !Number.isSafeInteger(value) ||
          value < 1 ||
          value > NPM_SNAPSHOT_LIMITS[key as keyof typeof limits]
        )
          npmFail("npm-invalid-request");
        limits[key as keyof typeof limits] = value;
      }
    }
    const fetcher = controls.fetch ?? globalThis.fetch;
    if (typeof fetcher !== "function") npmFail("npm-invalid-request");
    controls.signal?.addEventListener("abort", abort, { once: true });
    if (controls.signal?.aborted) abort();
    timer = setTimeout(abort, limits.timeoutMs);
    if (controller.signal.aborted) npmFail("npm-cancelled");
    // Race the entire operation, including a fixture/custom transport that ignores AbortSignal.
    const cancelled = new Promise<never>((_resolve, reject) =>
      controller.signal.addEventListener(
        "abort",
        () => reject(new AcquisitionFailure("npm-cancelled")),
        { once: true },
      ),
    );
    const acquire = async (): Promise<NpmSnapshotResult> => {
      const metadata = readUpstreamObject(
        await download(
          `https://registry.npmjs.org/${encodeURIComponent(data.name as string)}/${encodeURIComponent(data.version as string)}`,
          limits.metadataBytes,
          fetcher,
          controller.signal,
        ),
      );
      if (metadata.name !== data.name || metadata.version !== data.version)
        npmFail("npm-package-identity-mismatch");
      if (!isRecord(metadata.dist) || metadata.dist.integrity !== data.integrity)
        npmFail("npm-integrity-mismatch");
      const bytes = await download(
        httpsUrl(metadata.dist.tarball),
        limits.archiveBytes,
        fetcher,
        controller.signal,
      );
      if (`sha512-${createHash("sha512").update(bytes).digest("base64")}` !== data.integrity)
        npmFail("npm-integrity-mismatch");
      const snapshot = await readNpmArchive(bytes, controller.signal, limits);
      const manifestBytes = snapshot.files["package.json"];
      if (!manifestBytes) npmFail("npm-package-identity-mismatch");
      if (manifestBytes.byteLength > limits.metadataBytes) npmFail("npm-byte-limit");
      const manifest = readUpstreamObject(manifestBytes);
      if (manifest.name !== data.name || manifest.version !== data.version)
        npmFail("npm-package-identity-mismatch");
      return Object.freeze({
        valid: true,
        identity: checked.identity as Extract<ExactSourceIdentity, { kind: "npm" }>,
        snapshot: Object.freeze({
          ...snapshot,
          revision: createHash("sha256").update(bytes).digest("hex"),
        }),
        diagnostics: Object.freeze([]),
      });
    };
    return await Promise.race([acquire(), cancelled]);
  } catch (error) {
    const reason = controller.signal.aborted
      ? "npm-cancelled"
      : error instanceof AcquisitionFailure
        ? error.reason
        : "npm-acquisition-failed";
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        frozenDiagnostic({ reason, message: "Exact npm snapshot acquisition refused." }),
      ]),
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controls.signal?.removeEventListener("abort", abort);
  }
}
