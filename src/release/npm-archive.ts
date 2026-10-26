/** Bounded in-memory npm ustar capture; links and extended headers fail closed. */
import { createGunzip } from "node:zlib";
import { ARCHIVE_PACKAGE_PREFIX, safeMemberPath } from "./document.js";
import { AcquisitionFailure } from "./node-errors.js";

interface Limits {
  readonly archiveBytes: number;
  readonly sourceBytes: number;
  readonly sourceEntries: number;
}

const fail = (reason: string, path?: string): never => {
  throw new AcquisitionFailure(reason, path);
};
const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });

function text(header: Buffer, start: number, length: number): string {
  const field = header.subarray(start, start + length);
  const end = field.indexOf(0);
  try {
    return fatalUtf8.decode(end < 0 ? field : field.subarray(0, end));
  } catch {
    return fail("archive-unreadable");
  }
}

function octal(header: Buffer, start: number, length: number): number {
  const value = text(header, start, length).trim();
  if (!/^[0-7]+$/.test(value)) fail("archive-unreadable");
  const number = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(number)) fail("archive-unreadable");
  return number;
}

async function gunzip(bytes: Uint8Array, signal: AbortSignal, limits: Limits): Promise<Buffer> {
  if (signal.aborted) fail("npm-cancelled");
  const stream = createGunzip();
  const parts: Buffer[] = [];
  let total = 0;
  const done = new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limits.archiveBytes) {
        stream.destroy(new AcquisitionFailure("npm-byte-limit"));
        return;
      }
      parts.push(chunk);
    });
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  const abort = () => stream.destroy(new AcquisitionFailure("cancelled"));
  signal.addEventListener("abort", abort, { once: true });
  try {
    stream.end(bytes);
    await done;
  } catch (error) {
    if (error instanceof AcquisitionFailure) throw error;
    fail(signal.aborted ? "cancelled" : "archive-unreadable");
  } finally {
    signal.removeEventListener("abort", abort);
  }
  return Buffer.concat(parts, total);
}

/** Reads a whole package archive, refusing anything outside the fixed safe layout. */
export async function readNpmArchive(
  bytes: Uint8Array,
  signal: AbortSignal,
  limits: Limits,
): Promise<{
  files: Readonly<Record<string, Uint8Array>>;
  modes: Readonly<Record<string, number>>;
}> {
  const tar = await gunzip(bytes, signal, limits);
  const files = new Map<string, Buffer>();
  const executables = new Set<string>();
  const kinds = new Map<string, "file" | "directory">();
  const folded = new Map<string, string>();
  const explicit = new Set<string>();
  let offset = 0;
  let total = 0;
  for (;;) {
    if (signal.aborted) fail("cancelled");
    if (offset + 512 > tar.length) fail("archive-unreadable");
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      if (
        offset + 512 > tar.length ||
        !tar.subarray(offset, offset + 512).every((byte) => byte === 0)
      ) {
        fail("archive-unreadable");
      }
      if (!tar.subarray(offset + 512).every((byte) => byte === 0)) fail("archive-unreadable");
      break;
    }
    const checksum = octal(header, 148, 8);
    let sum = 0;
    for (let index = 0; index < 512; index += 1)
      sum += index >= 148 && index < 156 ? 32 : (header[index] as number);
    if (checksum !== sum) fail("archive-unreadable");
    const type = text(header, 156, 1) || "0";
    const size = octal(header, 124, 12);
    if (size > limits.sourceBytes) fail("npm-byte-limit");
    if (offset + size > tar.length) fail("archive-unreadable");
    const body = tar.subarray(offset, offset + size);
    offset += size + ((512 - (size % 512)) % 512);
    if (text(header, 257, 6) !== "ustar") fail("archive-unreadable");
    if (type !== "0" && type !== "5") fail("unsafe-archive-entry");
    const prefix = text(header, 345, 155);
    const name = text(header, 0, 100);
    let path = prefix ? `${prefix}/${name}` : name;
    if (type === "5") {
      if (size !== 0) fail("unsafe-archive-entry");
      if (path.endsWith("/")) path = path.slice(0, -1);
    }
    if (!path.startsWith(ARCHIVE_PACKAGE_PREFIX)) {
      if (type === "5" && `${path}/` === ARCHIVE_PACKAGE_PREFIX) continue;
      fail("archive-layout", path.slice(0, 256));
    }
    const member = path.slice(ARCHIVE_PACKAGE_PREFIX.length);
    if (!safeMemberPath(member)) fail("unsafe-archive-entry", path.slice(0, 256));
    if (member.split("/")[0]?.toLowerCase() === ".git") fail("unsafe-archive-entry");
    if (explicit.has(member)) fail("archive-duplicate-entry");
    explicit.add(member);
    const segments = member.split("/");
    segments.forEach((_segment, index) => {
      const partial = segments.slice(0, index + 1).join("/");
      const key = partial.toLowerCase();
      const leaf = index === segments.length - 1;
      const known = folded.get(key);
      if (known !== undefined && known !== partial) fail("archive-duplicate-entry", path);
      folded.set(key, partial);
      const prior = kinds.get(partial);
      if (leaf) {
        if (prior !== undefined && (prior === "file" || type === "0"))
          fail("archive-duplicate-entry", path);
        kinds.set(partial, type === "5" ? "directory" : "file");
      } else if (prior === "file") fail("archive-duplicate-entry", path);
      else kinds.set(partial, "directory");
    });
    if (kinds.size > limits.sourceEntries) fail("npm-entry-limit");
    if (type === "0") {
      total += size;
      if (total > limits.sourceBytes) fail("npm-byte-limit");
      files.set(member, Buffer.from(body));
      if (octal(header, 100, 8) & 0o111) executables.add(member);
    }
  }
  return {
    files: Object.freeze(Object.fromEntries(files)),
    modes: Object.freeze(
      Object.fromEntries(
        [...files.keys()].map((path) => [path, executables.has(path) ? 0o755 : 0o644]),
      ),
    ),
  };
}
