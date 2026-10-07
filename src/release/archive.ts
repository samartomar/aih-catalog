/**
 * Bounded reading of a Catalog package archive: gzip-compressed ustar/pax with
 * the fixed `package/` layout. Ceilings mirror Core's shared material limits so
 * an archive Catalog accepts is one Core can capture. Nothing is extracted to
 * disk and no member is executed.
 */
import { createGunzip } from "node:zlib";
import { ARCHIVE_PACKAGE_PREFIX } from "./contracts.js";
import { safeMemberPath } from "./document.js";
import { AcquisitionFailure } from "./node-errors.js";

export const ARCHIVE_LIMITS = Object.freeze({
  compressedBytes: 64 * 1024 * 1024,
  expandedBytes: 256 * 1024 * 1024,
  regularMembers: 4096,
  memberBytes: 16 * 1024 * 1024,
});

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

/** The path record of a pax extended header; other keys are informational only. */
function paxPath(body: Buffer): string {
  let offset = 0;
  let path: string | undefined;
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset);
    const size = Number(body.subarray(offset, space).toString("ascii"));
    if (
      space <= offset ||
      !Number.isSafeInteger(size) ||
      size <= space - offset ||
      offset + size > body.length
    ) {
      fail("archive-unreadable");
    }
    const record = body.subarray(space + 1, offset + size);
    if (record.at(-1) !== 0x0a) fail("archive-unreadable");
    const equals = record.indexOf(0x3d);
    if (equals < 1) fail("archive-unreadable");
    const key = record.subarray(0, equals).toString("ascii");
    if (key === "path") {
      if (path !== undefined) fail("unsafe-archive-entry");
      try {
        path = fatalUtf8.decode(record.subarray(equals + 1, -1));
      } catch {
        fail("archive-unreadable");
      }
    } else if (
      !["mtime", "atime", "ctime", "uid", "gid", "uname", "gname", "comment", "size"].includes(key)
    ) {
      fail("unsafe-archive-entry");
    }
    offset += size;
  }
  return path ?? fail("unsafe-archive-entry");
}

async function gunzip(bytes: Uint8Array, signal: AbortSignal): Promise<Buffer> {
  const stream = createGunzip();
  const parts: Buffer[] = [];
  let total = 0;
  const done = new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > ARCHIVE_LIMITS.expandedBytes) {
        stream.destroy(new AcquisitionFailure("archive-byte-limit"));
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

export interface PackageArchive {
  /** Package-relative path (prefix removed) → member bytes. */
  readonly files: ReadonlyMap<string, Buffer>;
  /** Package-relative paths of regular members with an executable mode bit. */
  readonly executables: ReadonlySet<string>;
}

/** Reads a whole package archive, refusing anything outside the fixed safe layout. */
export async function readPackageArchive(
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<PackageArchive> {
  const tar = await gunzip(bytes, signal);
  const files = new Map<string, Buffer>();
  const executables = new Set<string>();
  const kinds = new Map<string, "file" | "directory">();
  const folded = new Map<string, string>();
  let offset = 0;
  let pending: string | undefined;
  let regular = 0;
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
      if (pending !== undefined) fail("archive-unreadable");
      break;
    }
    const checksum = octal(header, 148, 8);
    let sum = 0;
    for (let index = 0; index < 512; index += 1)
      sum += index >= 148 && index < 156 ? 32 : (header[index] as number);
    if (checksum !== sum) fail("archive-unreadable");
    const type = text(header, 156, 1) || "0";
    const size = octal(header, 124, 12);
    if (size > ARCHIVE_LIMITS.memberBytes) fail("archive-byte-limit");
    if (offset + size > tar.length) fail("archive-unreadable");
    const body = tar.subarray(offset, offset + size);
    offset += size + ((512 - (size % 512)) % 512);
    if (type === "x") {
      if (pending !== undefined) fail("unsafe-archive-entry");
      pending = paxPath(body);
      continue;
    }
    if (type !== "0" && type !== "5") fail("unsafe-archive-entry");
    const prefix = text(header, 345, 155);
    const name = text(header, 0, 100);
    let path = pending ?? (prefix ? `${prefix}/${name}` : name);
    pending = undefined;
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
    if (type === "0") {
      regular += 1;
      if (regular > ARCHIVE_LIMITS.regularMembers) fail("archive-member-limit");
      files.set(member, Buffer.from(body));
      if (octal(header, 100, 8) & 0o111) executables.add(member);
    }
  }
  return { files, executables };
}
