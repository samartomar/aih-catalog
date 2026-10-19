/** Bounded, explicit host acquisition for a pinned baseline artifact. */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { BASELINE_ARTIFACT_MAX_BYTES, type ScanBaseline } from "./baseline-contracts.js";
import { coreArchiveUrl, SHA256, safeMemberPath } from "./document.js";
import { sha256Hex } from "./sha256.js";

export async function acquireBaselineArtifact(
  artifact: ScanBaseline["artifact"],
  options: {
    readonly packageRoot?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<Uint8Array> {
  if (
    !artifact ||
    typeof artifact.sha256 !== "string" ||
    !SHA256.test(artifact.sha256) ||
    !Number.isSafeInteger(artifact.byteLength) ||
    artifact.byteLength < 1 ||
    artifact.byteLength > BASELINE_ARTIFACT_MAX_BYTES
  )
    throw new TypeError("baseline-artifact-invalid");
  options.signal?.throwIfAborted();
  const location = artifact.location;
  let bytes: Uint8Array;
  if (location?.kind === "package") {
    if (artifact.byteLength > 16 * 1024 * 1024)
      throw new TypeError("baseline-package-artifact-limit");
    if (!safeMemberPath(location.path) || !options.packageRoot || !isAbsolute(options.packageRoot))
      throw new TypeError("baseline-package-location-invalid");
    const root = realpathSync(options.packageRoot);
    if (lstatSync(options.packageRoot).isSymbolicLink())
      throw new TypeError("baseline-package-link");
    let path = root;
    const segments = location.path.split("/");
    for (const [index, segment] of segments.entries()) {
      path = join(path, segment);
      const stat = lstatSync(path);
      if (
        stat.isSymbolicLink() ||
        (index < segments.length - 1 ? !stat.isDirectory() : !stat.isFile())
      )
        throw new TypeError("baseline-package-link");
    }
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = fstatSync(fd);
      const named = lstatSync(path);
      if (
        !before.isFile() ||
        named.isSymbolicLink() ||
        before.dev !== named.dev ||
        before.ino !== named.ino ||
        before.size !== artifact.byteLength
      )
        throw new TypeError("baseline-artifact-mismatch");
      bytes = new Uint8Array(artifact.byteLength);
      let offset = 0;
      while (offset < bytes.length) {
        options.signal?.throwIfAborted();
        const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
        if (!count) throw new TypeError("baseline-artifact-mismatch");
        offset += count;
      }
      const after = fstatSync(fd);
      if (
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs
      )
        throw new TypeError("baseline-artifact-changed");
    } finally {
      closeSync(fd);
    }
  } else if (location?.kind === "https" && coreArchiveUrl(location.url)) {
    const timeout = AbortSignal.timeout(15000);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    const response = await fetch(location.url, { redirect: "error", signal });
    if (!response.ok || !response.body) throw new TypeError("baseline-download-failed");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > artifact.byteLength) throw new TypeError("baseline-artifact-mismatch");
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel();
    }
    bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
  } else throw new TypeError("baseline-location-invalid");
  if (bytes.length !== artifact.byteLength || sha256Hex(bytes) !== artifact.sha256)
    throw new TypeError("baseline-artifact-mismatch");
  return bytes;
}
